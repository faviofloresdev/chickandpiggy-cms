const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNewsletterSubscriptionVariables,
  buildOrderTemplateVariables,
} = require('../../src/services/notification-service');

test('buildNewsletterSubscriptionVariables maps newsletter payload to template vars', () => {
  const variables = buildNewsletterSubscriptionVariables({
    subscription: {
      email: 'person@example.com',
      source: 'home',
      subscribedAt: '2026-07-30T13:45:00.000Z',
      notes: 'Interested in launches',
    },
    contactEmail: 'contact@example.com',
    unsubscribeUrl: 'https://cms.example.com/api/newsletter-subscriptions/unsubscribe?token=signed',
  });

  assert.equal(variables.CONTACT_EMAIL, 'contact@example.com');
  assert.equal(variables.SUBSCRIBER_EMAIL, 'person@example.com');
  assert.equal(variables.SOURCE, 'home');
  assert.equal(variables.NOTES, 'Interested in launches');
  assert.match(variables.UNSUBSCRIBE_URL, /token=signed$/);
  assert.ok(variables.SUBSCRIBED_AT.length > 0);
});

test('buildOrderTemplateVariables formats order totals and summaries', () => {
  const variables = buildOrderTemplateVariables({
    order: {
      id: 42,
      status: 'paid',
      paymentStatus: 'succeeded',
      currency: 'usd',
      subtotal: 25,
      discountAmount: 5,
      taxAmount: 1.5,
      shippingAmount: 4.99,
      totalAmount: 26.49,
      customerName: 'Jane Doe',
      customerEmail: 'jane@example.com',
      customerPhone: '555-1234',
      shippingOption: { label: 'USPS Ground Advantage' },
      shippingAddress: {
        addressLine1: '123 Main St',
        city: 'Miami',
        state: 'FL',
        postalCode: '33101',
        country: 'US',
      },
      billingAddress: {
        addressLine1: '123 Main St',
        city: 'Miami',
        state: 'FL',
        postalCode: '33101',
        country: 'US',
      },
      order_items: [
        {
          quantity: 2,
          subtotal: 20,
          product: {
            name: 'Plush Toy',
          },
        },
        {
          quantity: 1,
          subtotal: 5,
          product: {
            title: 'Sticker Pack',
          },
        },
      ],
      paidAt: '2026-07-30T13:45:00.000Z',
    },
    contactEmail: 'contact@example.com',
  });

  assert.equal(variables.CONTACT_EMAIL, 'contact@example.com');
  assert.equal(variables.ORDER_ID, '42');
  assert.equal(variables.CUSTOMER_EMAIL, 'jane@example.com');
  assert.equal(variables.ITEM_COUNT, 3);
  assert.match(variables.ORDER_TOTAL, /\$/);
  assert.match(variables.ITEMS_SUMMARY, /Plush Toy x2/);
  assert.match(variables.ITEMS_SUMMARY, /Sticker Pack x1/);
});

test('buildOrderTemplateVariables keeps internal contact email available for purchase notifications', () => {
  const variables = buildOrderTemplateVariables({
    order: {
      id: 77,
      status: 'paid',
      paymentStatus: 'succeeded',
      customerEmail: 'buyer@example.com',
      order_items: [],
    },
    contactEmail: 'store@example.com',
  });

  assert.equal(variables.CONTACT_EMAIL, 'store@example.com');
  assert.equal(variables.CUSTOMER_EMAIL, 'buyer@example.com');
});
