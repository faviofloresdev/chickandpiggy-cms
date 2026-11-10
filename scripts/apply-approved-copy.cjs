'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const FIELDS = {
  landings: ['hero_title', 'hero_title_accent', 'hero_title_highlight', 'hero_subtitle', 'hero_button_text', 'meta_title', 'meta_description'],
  featured_products: ['featured_product_title', 'featured_product_top_button_label', 'featured_product_bottom_button_label'],
  footers: ['footer_message_under_business_name'],
  products: ['description', 'meta_title', 'meta_description'],
  faqs: ['faq_question', 'faq_response'],
};

function validateManifest(manifest) {
  if (manifest.format !== 1 || manifest.databaseEngine !== 'sqlite' || !Array.isArray(manifest.entries) || !manifest.entries.length) {
    throw new Error('Expected a version 1 SQLite copy manifest with entries.');
  }
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!Object.hasOwn(FIELDS, entry.table) || typeof entry.documentId !== 'string' || !entry.documentId ||
        !['draft', 'published'].includes(entry.status) || !(entry.locale === null || typeof entry.locale === 'string') ||
        !entry.fields || typeof entry.fields !== 'object' || Array.isArray(entry.fields) || !Object.keys(entry.fields).length) {
      throw new Error('Invalid copy target.');
    }
    const identity = JSON.stringify([entry.table, entry.documentId, entry.status, entry.locale]);
    if (seen.has(identity)) throw new Error('Duplicate copy target.');
    seen.add(identity);
    for (const [field, values] of Object.entries(entry.fields)) {
      if (!FIELDS[entry.table].includes(field)) throw new Error(`Field is not editable by this tool: ${entry.table}.${field}`);
      if (!values || !(values.before === null || typeof values.before === 'string') || typeof values.after !== 'string') {
        throw new Error(`Invalid text values for ${entry.table}.${field}`);
      }
    }
  }
}

function plan(db, manifest) {
  const updates = [];
  for (const entry of manifest.entries) {
    const rows = db.prepare(`SELECT * FROM ${entry.table} WHERE document_id = ? AND (published_at IS NULL) = ? AND locale IS ?`)
      .all(entry.documentId, entry.status === 'draft' ? 1 : 0, entry.locale);
    if (rows.length !== 1) throw new Error(`Expected exactly one ${entry.status} record for ${entry.table}:${entry.documentId}; found ${rows.length}.`);
    const row = rows[0];
    if (entry.slug !== undefined && row.slug !== entry.slug) throw new Error('Product slug does not match the manifest.');
    const changes = {};
    for (const [field, values] of Object.entries(entry.fields)) {
      if (!Object.hasOwn(row, field)) throw new Error(`Missing database column: ${entry.table}.${field}`);
      if (row[field] === values.after) continue;
      if (row[field] !== values.before) {
        throw new Error(`Content conflict in ${entry.table}:${entry.documentId}.${field}. No changes applied.`);
      }
      changes[field] = values.after;
    }
    if (Object.keys(changes).length) updates.push({ table: entry.table, id: row.id, changes });
  }
  return updates;
}

async function applyApprovedCopy({ databasePath, manifest, apply = false }) {
  validateManifest(manifest);
  const target = path.resolve(databasePath);
  if (!fs.statSync(target).isFile()) throw new Error('Database path must point to an existing SQLite file.');
  const db = new Database(target, { readonly: !apply, fileMustExist: true });
  try {
    const pending = plan(db, manifest);
    const result = { mode: apply ? 'apply' : 'preview', databasePath: target, pendingVersions: pending.length,
      pendingFields: pending.reduce((total, row) => total + Object.keys(row.changes).length, 0), updatedVersions: 0 };
    if (!apply || !pending.length) return result;

    // Keep the complete local backup private; its contents never enter the manifest or logs.
    const backupDirectory = fs.mkdtempSync(`${target}.before-copy-`);
    fs.chmodSync(backupDirectory, 0o700);
    result.backupPath = path.join(backupDirectory, 'data.db');
    await db.backup(result.backupPath);
    fs.chmodSync(result.backupPath, 0o600);

    result.updatedVersions = db.transaction(() => {
      // Recheck under a write lock, in case content changed while making the backup.
      const updates = plan(db, manifest);
      for (const row of updates) {
        const fields = Object.keys(row.changes);
        const updated = db.prepare(`UPDATE ${row.table} SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
          .run(...fields.map(field => row.changes[field]), Date.now(), row.id);
        if (updated.changes !== 1) throw new Error('Unexpected update count; transaction rolled back.');
        const saved = db.prepare(`SELECT * FROM ${row.table} WHERE id = ?`).get(row.id);
        if (fields.some(field => saved[field] !== row.changes[field])) throw new Error('Verification failed; transaction rolled back.');
      }
      return updates.length;
    }).immediate();
    return result;
  } finally {
    db.close();
  }
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply' && !options.apply) options.apply = true;
    else if (['--database', '--manifest'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--') && !options[flag]) options[flag] = args[++i];
    else throw new Error(`Invalid or repeated argument: ${flag}`);
  }
  if (!options['--database'] || !options['--manifest']) {
    throw new Error('Usage: node scripts/apply-approved-copy.cjs --database /path/to/data.db --manifest /private/content-update.json [--apply]. SQLite only; default is read-only preview.');
  }
  const manifest = JSON.parse(fs.readFileSync(options['--manifest'], 'utf8'));
  const result = await applyApprovedCopy({ databasePath: options['--database'], manifest, apply: options.apply });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { applyApprovedCopy };
