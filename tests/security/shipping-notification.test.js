'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShippingTemplateVariables,
  buildTrackingUrl,
} = require('../../src/services/notification-service');

test('shipping notification builds carrier tracking links safely', () => {
  assert.equal(
    buildTrackingUrl('UPS', '1Z 999'),
    'https://www.ups.com/track?loc=en_US&tracknum=1Z%20999'
  );
  assert.equal(buildTrackingUrl('Unknown', 'ABC123'), '');
});

test('shipping notification exposes the required template variables', () => {
  const variables = buildShippingTemplateVariables({
    contactEmail: 'support@example.com',
    order: {
      id: 42,
      orderNumber: 'CP-2026-000042',
      customerName: 'Customer',
      customerEmail: 'customer@example.com',
      carrier: 'USPS',
      trackingNumber: '9400 1000',
      shippedAt: '2026-09-13T12:00:00.000Z',
      shippingAddress: { addressLine1: '123 Main St', city: 'Miami', state: 'FL', postalCode: '33101', country: 'US' },
      totalAmount: 25,
      currency: 'usd',
    },
  });

  assert.equal(variables.ORDER_NUMBER, 'CP-2026-000042');
  assert.equal(variables.CARRIER, 'USPS');
  assert.equal(variables.TRACKING_NUMBER, '9400 1000');
  assert.match(variables.TRACKING_URL, /9400%201000$/);
  assert.equal(variables.ORDER_TOTAL, '$25.00');
});
