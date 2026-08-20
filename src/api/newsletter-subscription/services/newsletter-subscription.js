'use strict';

const { createCoreService } = require('@strapi/strapi').factories;
const { notifyNewsletterSubscription } = require('../../../services/notification-service');

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

function formatErrorForLog(error) {
  if (!error) {
    return null;
  }

  return {
    message: error.message || 'Unknown error',
    status: error.status || null,
    details: error.details || null,
  };
}

function logNotificationResult(strapi, subscription, result) {
  if (result?.skipped) {
    strapi.log.warn('newsletter-subscription notification skipped', {
      email: subscription.email,
      reason: result.reason || 'unknown',
    });
    return;
  }

  strapi.log.info('newsletter-subscription notification sent', {
    email: subscription.email,
    resendEmailId: result?.id || null,
    templateId: result?.templateId || null,
    to: result?.to || [],
  });
}

async function sendNewsletterNotification(strapi, subscription) {
  try {
    const result = await notifyNewsletterSubscription(strapi, subscription);
    logNotificationResult(strapi, subscription, result);
    return result;
  } catch (error) {
    strapi.log.error(
      'newsletter-subscription notification error',
      formatErrorForLog(error)
    );
    throw error;
  }
}

function buildNotificationSummary(result, fallback = 'not_attempted') {
  if (!result) {
    return {
      state: fallback,
    };
  }

  if (result.skipped) {
    return {
      state: 'skipped',
      reason: result.reason || 'unknown',
    };
  }

  return {
    state: 'sent',
    templateId: result.templateId || null,
    resendEmailId: result.id || null,
    to: result.to || [],
  };
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
        strapi.log.info('newsletter-subscription already subscribed', {
          email: normalized.email,
        });
        return {
          created: false,
          statusCode: 200,
          body: {
            ok: true,
            status: 'subscribed',
            created: false,
            notification: buildNotificationSummary(null, 'already_subscribed'),
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

      let notificationResult = null;
      try {
        notificationResult = await sendNewsletterNotification(strapi, normalized);
      } catch (error) {
        // The subscription should still succeed even if the notification fails.
      }

      return {
        created: false,
        statusCode: 200,
        body: {
          ok: true,
          status: 'subscribed',
          created: false,
          notification: buildNotificationSummary(notificationResult, 'failed'),
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

          let notificationResult = null;
          try {
            notificationResult = await sendNewsletterNotification(strapi, normalized);
          } catch (error) {
            // The subscription should still succeed even if the notification fails.
          }

          return {
            created: false,
            statusCode: 200,
            body: {
              ok: true,
              status: 'subscribed',
              created: false,
              notification: buildNotificationSummary(notificationResult, 'failed'),
            },
          };
        }

        return {
          created: false,
          statusCode: 200,
          body: {
            ok: true,
            status: racedExisting.status === 'unsubscribed' ? 'subscribed' : racedExisting.status,
            created: false,
            notification: buildNotificationSummary(null, 'not_attempted'),
          },
        };
      }

      throw err;
    }

    let notificationResult = null;
    try {
      notificationResult = await sendNewsletterNotification(strapi, normalized);
    } catch (error) {
      // The subscription should still succeed even if the notification fails.
    }

    return {
      created: true,
      statusCode: 201,
      body: {
        ok: true,
        status: 'subscribed',
        created: true,
        notification: buildNotificationSummary(notificationResult, 'failed'),
      },
    };
  },
}));
