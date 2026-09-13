'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShippingTemplateVariables,
  buildTrackingUrl,
} = require('../../src/services/notification-service');
const {
  renderShippingConfirmationHtml,
  renderShippingConfirmationText,
} = require('../../src/services/templates/shipping-confirmation');

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

test('bundled shipping template renders HTML and plain text safely', () => {
  const variables = {
    ORDER_NUMBER: 'CP-42',
    CUSTOMER_NAME: '<Customer>',
    CARRIER: 'UPS',
    TRACKING_NUMBER: '1Z999',
    TRACKING_URL: 'https://www.ups.com/track?tracknum=1Z999',
    SHIPPING_ADDRESS: '123 Main St',
    SHIPPED_AT: 'Sep 13, 2026',
    CONTACT_EMAIL: 'support@example.com',
  };
  const html = renderShippingConfirmationHtml(variables);
  const text = renderShippingConfirmationText(variables);

  assert.match(html, /Your order is on the way!/);
  assert.match(html, /&lt;Customer&gt;/);
  assert.doesNotMatch(html, /Hi <Customer>/);
  assert.match(html, /Track your package/);
  assert.match(text, /Tracking number: 1Z999/);
});
