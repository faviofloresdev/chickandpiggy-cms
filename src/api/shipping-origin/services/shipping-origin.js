'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

function buildEnvOrigin() {
  const label = process.env.SHIPPING_ORIGIN_LABEL || 'Los Angeles, CA';

  return {
    id: null,
    documentId: null,
    name: label,
    label,
    addressLine1: process.env.SHIPPING_ORIGIN_ADDRESS_LINE_1 || '',
    addressLine2: process.env.SHIPPING_ORIGIN_ADDRESS_LINE_2 || '',
    city: process.env.SHIPPING_ORIGIN_CITY || 'Los Angeles',
    state: process.env.SHIPPING_ORIGIN_STATE || 'CA',
    postalCode: process.env.SHIPPING_ORIGIN_POSTAL || '90001',
    country: process.env.SHIPPING_ORIGIN_COUNTRY || 'US',
    active: true,
    isDefault: true,
    source: 'env',
  };
}

module.exports = createCoreService('api::shipping-origin.shipping-origin', ({ strapi }) => ({
  async getActiveOrigin() {
    const entries = await strapi.entityService.findMany('api::shipping-origin.shipping-origin', {
      filters: { active: true },
      sort: [{ isDefault: 'desc' }, { id: 'asc' }],
      limit: 1,
    });

    const origin = Array.isArray(entries) ? entries[0] : entries;
    if (origin) {
      return {
        ...origin,
        source: 'cms',
      };
    }

    return buildEnvOrigin();
  },
}));
