'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TRANSITIONS, paymentStateFromStripe } = require('../../src/api/order/utils/admin-order');

test('fulfillment transitions do not permit skipping operational steps', () => {
  assert.deepEqual(TRANSITIONS.pending_preparation, ['preparing', 'cancelled']);
  assert.equal(TRANSITIONS.pending_preparation.includes('shipped'), false);
  assert.deepEqual(TRANSITIONS.shipped, ['delivered']);
  assert.deepEqual(TRANSITIONS.delivered, []);
});

test('Stripe payment state normalization recognizes refunds and failures', () => {
  assert.equal(paymentStateFromStripe({ status: 'succeeded', latest_charge: { amount_refunded: 0 } }), 'paid');
  assert.equal(paymentStateFromStripe({ status: 'succeeded', latest_charge: { amount_refunded: 100 } }), 'refunded');
  assert.equal(paymentStateFromStripe({ status: 'requires_payment_method', last_payment_error: { message: 'declined' } }), 'failed');
  assert.equal(paymentStateFromStripe({ status: 'processing' }), 'pending');
});
