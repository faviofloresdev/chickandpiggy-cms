'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../../src/api/newsletter-subscription/utils/unsubscribe-token');
const controller = require('../../src/api/newsletter-subscription/controllers/newsletter-subscription');

const SECRET = 'test-secret-with-at-least-32-characters';
const SUBSCRIPTION = {
  email: 'Person@Example.com',
  subscribedAt: '2026-09-13T12:00:00.000Z',
};

test('unsubscribe tokens are signed and bound to the subscription timestamp', () => {
  const token = createUnsubscribeToken(SUBSCRIPTION, SECRET);
  assert.deepEqual(verifyUnsubscribeToken(token, SECRET), {
    email: 'person@example.com',
    subscribedAt: SUBSCRIPTION.subscribedAt,
  });
  assert.throws(
    () => verifyUnsubscribeToken(`${token.slice(0, -1)}x`, SECRET),
    /Invalid or expired unsubscribe link/
  );
});

test('unsubscribe URL contains only a signed token', () => {
  const url = new URL(buildUnsubscribeUrl(SUBSCRIPTION, {
    baseUrl: 'https://cms.example.com/admin',
    secret: SECRET,
  }));
  assert.equal(url.origin, 'https://cms.example.com');
  assert.equal(url.pathname, '/api/newsletter-subscriptions/unsubscribe');
  assert.ok(url.searchParams.get('token'));
  assert.equal(url.searchParams.has('email'), false);
});

test('unsubscribe URL reuses STRAPI_URL from the CMS environment', () => {
  const previousUrl = process.env.STRAPI_URL;
  const previousSecret = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
  process.env.STRAPI_URL = 'https://cms.example.com';
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = SECRET;
  try {
    const url = new URL(buildUnsubscribeUrl(SUBSCRIPTION));
    assert.equal(url.origin, 'https://cms.example.com');
  } finally {
    if (previousUrl === undefined) delete process.env.STRAPI_URL;
    else process.env.STRAPI_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.NEWSLETTER_UNSUBSCRIBE_SECRET;
    else process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = previousSecret;
  }
});

test('confirmation GET does not unsubscribe until the form is submitted', async () => {
  let unsubscribeCalls = 0;
  const service = {
    async getUnsubscribeTarget() {
      return { email: 'person@example.com' };
    },
    async unsubscribe() {
      unsubscribeCalls += 1;
      return { email: 'person@example.com', status: 'unsubscribed', changed: true };
    },
  };
  global.strapi = { service: () => service };

  const getContext = {
    query: { token: 'signed-token' },
    set() {},
  };
  await controller.confirmUnsubscribe(getContext);
  assert.equal(getContext.status, 200);
  assert.match(getContext.body, /method="post"/);
  assert.equal(unsubscribeCalls, 0);

  const postContext = {
    request: { body: { token: 'signed-token' } },
    get: () => 'application/x-www-form-urlencoded',
    set() {},
  };
  await controller.unsubscribe(postContext);
  assert.equal(postContext.status, 200);
  assert.match(postContext.body, /You’re unsubscribed/);
  assert.equal(unsubscribeCalls, 1);

  delete global.strapi;
});
