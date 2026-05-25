'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::shipping-origin.shipping-origin', ({ strapi }) => ({
  async active(ctx) {
    try {
      const origin = await strapi.service('api::shipping-origin.shipping-origin').getActiveOrigin();
      ctx.body = { data: origin };
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('shipping-origin.active error', err);
    }
  },
}));
