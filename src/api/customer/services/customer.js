'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

module.exports = createCoreService('api::customer.customer', ({ strapi }) => ({
  async upsertFromCheckout({ customer, shippingAddress, billingAddress }) {
    const email = normalizeEmail(customer?.email);
    if (!email) {
      throw new Error('Customer email is required');
    }

    const existing = await strapi.entityService.findMany('api::customer.customer', {
      filters: {
        email: {
          $eqi: email,
        },
      },
      limit: 1,
    });

    const found = Array.isArray(existing) ? existing[0] : existing;
    const data = {
      name: customer?.name || '',
      email,
      phone: customer?.phone || '',
      shippingAddress: shippingAddress || null,
      billingAddress: billingAddress || null,
      metadata: {
        lastCheckoutAt: new Date().toISOString(),
      },
    };

    if (found?.id) {
      return strapi.entityService.update('api::customer.customer', found.id, {
        data,
      });
    }

    return strapi.entityService.create('api::customer.customer', {
      data,
    });
  },
}));
