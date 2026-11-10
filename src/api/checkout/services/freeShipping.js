'use strict';

const FREE_SHIPPING_OPTION_ID = 'free_shipping_zip';

function normalizePostalCode(value) {
  return String(value || '').trim().toUpperCase();
}

function buildFreeShippingOption(destination = {}) {
  const normalizedPostalCode = normalizePostalCode(destination.postalCode);

  return {
    id: FREE_SHIPPING_OPTION_ID,
    label: 'Free Shipping',
    amount: 0,
    carrier: 'internal',
    service: 'free_shipping_zip',
    estimatedDays: null,
    deliveryEstimateText: 'Free shipping available for this ZIP code',
    fingerprint: `free-shipping:${normalizedPostalCode || 'unknown'}`,
    tags: ['cheapest', 'fastest', 'recommended'],
  };
}

function buildFreeShippingRates(destination = {}) {
  const option = buildFreeShippingOption(destination);

  return {
    fingerprint: `free-shipping-rates:${normalizePostalCode(destination.postalCode) || 'unknown'}`,
    packageSnapshot: null,
    shippingOptions: [option],
    shippingHighlights: {
      cheapest: option,
      fastest: option,
      recommended: option,
    },
    cacheHit: false,
    durationMs: 0,
  };
}

module.exports = {
  FREE_SHIPPING_OPTION_ID,
  buildFreeShippingOption,
  buildFreeShippingRates,
};
