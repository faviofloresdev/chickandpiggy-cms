'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { sanitize } = require('../../checkout/utils/validate');

module.exports = createCoreController('api::discount.discount', ({ strapi }) => ({
  async lookup(ctx) {
    try {
      const result = await strapi.service('api::discount.discount').inspectDiscount({
        code: ctx.params.code,
      });
      ctx.body = { discount: result };
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('discount.lookup error', err);
    }
  },

  async apply(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').discount(payload);
      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('discount.apply error', err);
    }
  },
}));
