'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

function normalizePostalCode(value) {
  return String(value || '').trim().toUpperCase();
}

module.exports = createCoreService('api::free-shipping-zip.free-shipping-zip', ({ strapi }) => ({
  async isEligible(postalCode) {
    const normalizedPostalCode = normalizePostalCode(postalCode);
    if (!normalizedPostalCode) {
      return false;
    }

    const entries = await strapi.entityService.findMany('api::free-shipping-zip.free-shipping-zip', {
      filters: {
        postalCode: {
          $eqi: normalizedPostalCode,
        },
        active: true,
      },
      limit: 1,
    });

    const match = Array.isArray(entries) ? entries[0] : entries;
    return Boolean(match);
  },

  async listActivePostalCodes() {
    const entries = await strapi.entityService.findMany('api::free-shipping-zip.free-shipping-zip', {
      filters: {
        active: true,
      },
      sort: [{ postalCode: 'asc' }],
    });

    return (Array.isArray(entries) ? entries : [entries])
      .filter(Boolean)
      .map((entry) => normalizePostalCode(entry.postalCode))
      .filter(Boolean);
  },
}));
