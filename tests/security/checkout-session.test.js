const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CHECKOUT_SESSION_SECRET = 'test-checkout-session-secret';

const {
  createCheckoutSessionToken,
  verifyCheckoutSessionToken,
} = require('../../src/api/checkout/utils/session');

test('checkout session token validates for the same cart and address', () => {
  const payload = {
    items: [
      {
        productId: '12',
        variantId: '34',
        quantity: 2,
        selectedOptions: [{ optionValueId: '7' }],
      },
    ],
    shipping: {
      addressLine1: '123 Main St',
      city: 'Miami',
      state: 'FL',
      postalCode: '33101',
      country: 'US',
      selectedShippingOptionId: 'ground',
    },
  };

  const token = createCheckoutSessionToken(payload, { ttlMs: 60_000 });
  const decoded = verifyCheckoutSessionToken(token, payload);

  assert.ok(decoded.expiresAt > decoded.issuedAt);
});

test('checkout session token rejects cart tampering', () => {
  const payload = {
    items: [{ productId: '12', quantity: 1, selectedOptions: [] }],
    shipping: {
      addressLine1: '123 Main St',
      city: 'Miami',
      state: 'FL',
      postalCode: '33101',
      country: 'US',
    },
  };

  const token = createCheckoutSessionToken(payload, { ttlMs: 60_000 });

  assert.throws(
    () =>
      verifyCheckoutSessionToken(token, {
        ...payload,
        items: [{ productId: '12', quantity: 3, selectedOptions: [] }],
      }),
    /does not match this cart/
  );
});
