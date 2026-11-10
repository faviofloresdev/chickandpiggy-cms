'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { applyApprovedCopy } = require('../scripts/apply-approved-copy.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-copy-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'test.db');
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, document_id TEXT, locale TEXT, published_at INTEGER,
      updated_at INTEGER, slug TEXT, name TEXT, description TEXT, meta_title TEXT, base_price INTEGER);
    INSERT INTO products VALUES (1,'example',NULL,NULL,10,'example-soap','Original name','Old copy',NULL,8);
    INSERT INTO products VALUES (2,'example',NULL,20,10,'example-soap','Original name','Old copy',NULL,8);
    CREATE TABLE files (id INTEGER PRIMARY KEY, url TEXT);
    INSERT INTO files VALUES (1,'/uploads/example.png');
    CREATE TABLE files_related_mph (file_id INTEGER, related_id INTEGER);
    INSERT INTO files_related_mph VALUES (1,1),(1,2);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER);
    INSERT INTO orders VALUES (1,25);
  `);
  db.close();
  const manifest = {format: 1, databaseEngine: 'sqlite', entries: ['draft','published'].map(status => ({
    table: 'products', documentId: 'example', locale: null, status, slug: 'example-soap',
    fields: {description: {before: 'Old copy', after: 'Approved copy'}, meta_title: {before: null, after: 'Example soap'}},
  }))};
  return {databasePath, manifest};
}

test('preview does not change the database or create a backup', async t => {
  const options = fixture(t);
  const original = fs.readFileSync(options.databasePath);
  const result = await applyApprovedCopy(options);
  assert.equal(result.pendingVersions, 2);
  assert.equal(result.updatedVersions, 0);
  assert.equal(result.backupPath, undefined);
  assert.deepEqual(fs.readFileSync(options.databasePath), original);
});

test('apply preserves images, orders, identity and prices; backs up originals and is repeatable', async t => {
  const options = fixture(t);
  const result = await applyApprovedCopy({...options, apply: true});
  assert.equal(result.updatedVersions, 2);
  const db = new Database(options.databasePath, {readonly:true});
  const backup = new Database(result.backupPath, {readonly:true});
  try {
    for (const table of ['files','files_related_mph','orders']) {
      assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), backup.prepare(`SELECT * FROM ${table}`).all());
    }
    const originals = backup.prepare('SELECT * FROM products ORDER BY id').all();
    const updated = db.prepare('SELECT * FROM products ORDER BY id').all();
    for (let i = 0; i < originals.length; i++) {
      assert.equal(updated[i].description, 'Approved copy');
      assert.equal(updated[i].meta_title, 'Example soap');
      for (const key of Object.keys(originals[i])) if (!['description','meta_title','updated_at'].includes(key)) assert.equal(updated[i][key], originals[i][key]);
    }
  } finally { db.close(); backup.close(); }
  const repeated = await applyApprovedCopy({...options, apply:true});
  assert.equal(repeated.updatedVersions, 0);
  assert.equal(repeated.backupPath, undefined);
});

test('a newer client edit aborts the entire update, including other versions', async t => {
  const options = fixture(t);
  const db = new Database(options.databasePath);
  db.prepare('UPDATE products SET description = ? WHERE id = 2').run('New client edit');
  const original = db.prepare('SELECT * FROM products ORDER BY id').all();
  db.close();
  await assert.rejects(applyApprovedCopy({...options, apply:true}), /Content conflict/);
  const check = new Database(options.databasePath, {readonly:true});
  assert.deepEqual(check.prepare('SELECT * FROM products ORDER BY id').all(), original);
  check.close();
});

test('refuses non-copy fields and missing or duplicate targets', async t => {
  const options = fixture(t);
  const forbidden = structuredClone(options.manifest);
  forbidden.entries[0].fields.base_price = {before: '8', after:'0'};
  await assert.rejects(applyApprovedCopy({...options, manifest:forbidden, apply:true}), /not editable/);
  const missing = structuredClone(options.manifest);
  missing.entries[0].documentId = 'missing';
  await assert.rejects(applyApprovedCopy({...options, manifest:missing, apply:true}), /Expected exactly one/);
  const duplicate = structuredClone(options.manifest);
  duplicate.entries.push(duplicate.entries[0]);
  await assert.rejects(applyApprovedCopy({...options, manifest:duplicate, apply:true}), /Duplicate/);
});
