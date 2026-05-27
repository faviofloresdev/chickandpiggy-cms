const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitize } = require('../../src/api/checkout/utils/validate');

test('sanitize accepts only the strict checkout shape', () => {
  const payload = sanitize({
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
      googleValidatedAddress: true,
    },
    checkoutSessionToken: 'token',
  });

  assert.deepEqual(payload.items[0], {
    productId: '12',
    variantId: '34',
    quantity: 2,
    selectedOptions: [{ optionValueId: '7' }],
  });
  assert.equal(payload.shipping.selectedShippingOptionId, 'ground');
  assert.equal(payload.checkoutSessionToken, 'token');
});

test('sanitize accepts documentId values for product and variant identifiers', () => {
  const payload = sanitize({
    items: [
      {
        productId: 'hsu9m45e6nw417mx9nkyzh7j',
        variantId: 'variant-doc-123',
        quantity: 1,
        selectedOptions: [],
      },
    ],
  });

  assert.deepEqual(payload.items[0], {
    productId: 'hsu9m45e6nw417mx9nkyzh7j',
    variantId: 'variant-doc-123',
    quantity: 1,
    selectedOptions: [],
  });
});

test('sanitize rejects unexpected item fields', () => {
  assert.throws(
    () =>
      sanitize({
        items: [
          {
            productId: '12',
            quantity: 1,
            shippingDetails: { weight: 1 },
          },
        ],
      }),
    /unsupported fields/
  );
});

test('sanitize rejects top-level extras', () => {
  assert.throws(
    () =>
      sanitize({
        items: [],
        totals: { total: 10 },
      }),
    /unsupported fields/
  );
});
