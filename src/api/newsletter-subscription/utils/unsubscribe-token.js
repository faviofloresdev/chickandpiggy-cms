'use strict';

const crypto = require('node:crypto');

const MIN_SECRET_LENGTH = 32;

function configurationError(message) {
  const error = new Error(message);
  error.status = 503;
  error.code = 'NEWSLETTER_UNSUBSCRIBE_NOT_CONFIGURED';
  return error;
}

function invalidTokenError() {
  const error = new Error('Invalid or expired unsubscribe link');
  error.status = 400;
  error.code = 'INVALID_UNSUBSCRIBE_TOKEN';
  return error;
}

function resolveSecret(secret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET) {
  const value = String(secret || '').trim();
  if (value.length < MIN_SECRET_LENGTH) {
    throw configurationError(
      `NEWSLETTER_UNSUBSCRIBE_SECRET must contain at least ${MIN_SECRET_LENGTH} characters`
    );
  }
  return value;
}

function normalizeSubscription(subscription) {
  const email = String(subscription?.email || '').trim().toLowerCase();
  const subscribedAt = String(subscription?.subscribedAt || '').trim();
  if (!email || !subscribedAt) throw invalidTokenError();
  return { email, subscribedAt };
}

function sign(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function createUnsubscribeToken(subscription, secret) {
  const resolvedSecret = resolveSecret(secret);
  const normalized = normalizeSubscription(subscription);
  const encodedPayload = Buffer.from(
    JSON.stringify({ email: normalized.email, subscribedAt: normalized.subscribedAt }),
    'utf8'
  ).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, resolvedSecret)}`;
}

function verifyUnsubscribeToken(token, secret) {
  const resolvedSecret = resolveSecret(secret);
  const [encodedPayload, providedSignature, extra] = String(token || '').split('.');
  if (!encodedPayload || !providedSignature || extra) throw invalidTokenError();

  const expectedSignature = sign(encodedPayload, resolvedSecret);
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw invalidTokenError();
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return normalizeSubscription(payload);
  } catch (error) {
    if (error?.code === 'INVALID_UNSUBSCRIBE_TOKEN') throw error;
    throw invalidTokenError();
  }
}

function buildUnsubscribeUrl(subscription, options = {}) {
  const baseUrl = String(
    options.baseUrl || process.env.NEWSLETTER_UNSUBSCRIBE_BASE_URL || ''
  ).trim();
  if (!baseUrl) {
    throw configurationError('NEWSLETTER_UNSUBSCRIBE_BASE_URL is required');
  }

  let url;
  try {
    url = new URL('/api/newsletter-subscriptions/unsubscribe', baseUrl);
  } catch (error) {
    throw configurationError('NEWSLETTER_UNSUBSCRIBE_BASE_URL must be a valid absolute URL');
  }
  url.searchParams.set('token', createUnsubscribeToken(subscription, options.secret));
  return url.toString();
}

module.exports = {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
};
