const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FREE_SHIPPING_OPTION_ID,
  buildFreeShippingRates,
} = require('../../src/api/checkout/services/freeShipping');

test('buildFreeShippingRates returns a zero-cost shipping option for eligible ZIP flows', () => {
  const result = buildFreeShippingRates({
    postalCode: '34102',
  });

  assert.equal(result.shippingOptions.length, 1);
  assert.equal(result.shippingOptions[0].id, FREE_SHIPPING_OPTION_ID);
  assert.equal(result.shippingOptions[0].amount, 0);
  assert.equal(result.shippingHighlights.cheapest.id, FREE_SHIPPING_OPTION_ID);
  assert.equal(result.shippingHighlights.fastest.id, FREE_SHIPPING_OPTION_ID);
  assert.equal(result.shippingHighlights.recommended.id, FREE_SHIPPING_OPTION_ID);
});
