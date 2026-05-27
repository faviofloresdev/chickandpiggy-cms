'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

const UID = 'api::newsletter-subscription.newsletter-subscription';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSource(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'home';
}

function normalizeNotes(value) {
  if (value == null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
}

function normalizeSubscribedAt(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

async function findByEmail(strapi, email) {
  const entries = await strapi.entityService.findMany(UID, {
    filters: {
      email: {
        $eq: email,
      },
    },
    limit: 1,
  });

  return Array.isArray(entries) ? entries[0] : entries;
}

module.exports = createCoreService(UID, ({ strapi }) => ({
  normalizePayload(payload = {}) {
    const email = normalizeEmail(payload.email);

    return {
      email,
      isValidEmail: isValidEmail(email),
      source: normalizeSource(payload.source),
      subscribedAt: normalizeSubscribedAt(payload.subscribedAt),
      notes: normalizeNotes(payload.notes),
    };
  },

  async subscribe(payload = {}) {
    const normalized = this.normalizePayload(payload);

    if (!normalized.isValidEmail) {
      const err = new Error('Invalid email');
      err.status = 400;
      throw err;
    }

    const existing = await findByEmail(strapi, normalized.email);
    if (existing?.id) {
      if (existing.status === 'subscribed') {
        return {
          created: false,
          statusCode: 200,
          body: {
            ok: true,
            status: 'subscribed',
          },
        };
      }

      await strapi.entityService.update(UID, existing.id, {
        data: {
          email: normalized.email,
          status: 'subscribed',
          source: normalized.source,
          subscribedAt: normalized.subscribedAt,
          ...(normalized.notes ? { notes: normalized.notes } : {}),
        },
      });

      return {
        created: false,
        statusCode: 200,
        body: {
          ok: true,
          status: 'subscribed',
        },
      };
    }

    try {
      await strapi.entityService.create(UID, {
        data: {
          email: normalized.email,
          status: 'subscribed',
          source: normalized.source,
          subscribedAt: normalized.subscribedAt,
          ...(normalized.notes ? { notes: normalized.notes } : {}),
        },
      });
    } catch (err) {
      const racedExisting = await findByEmail(strapi, normalized.email);
      if (racedExisting?.id) {
        if (racedExisting.status === 'unsubscribed') {
          await strapi.entityService.update(UID, racedExisting.id, {
            data: {
              status: 'subscribed',
              source: normalized.source,
              subscribedAt: normalized.subscribedAt,
              ...(normalized.notes ? { notes: normalized.notes } : {}),
            },
          });
        }

        return {
          created: false,
          statusCode: 200,
          body: {
            ok: true,
            status: racedExisting.status === 'unsubscribed' ? 'subscribed' : racedExisting.status,
          },
        };
      }

      throw err;
    }

    return {
      created: true,
      statusCode: 201,
      body: {
        ok: true,
        status: 'subscribed',
      },
    };
  },
}));
