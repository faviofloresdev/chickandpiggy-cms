'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { sanitize } = require('../../checkout/utils/validate');
const { respondWithSanitizedError } = require('../../checkout/utils/http');

module.exports = createCoreController('api::discount.discount', ({ strapi }) => ({
  async lookup(ctx) {
    try {
      const result = await strapi.service('api::discount.discount').inspectDiscount({
        code: ctx.params.code,
      });
      ctx.body = { discount: result };
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'discount.lookup error');
    }
  },

  async apply(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').discount(payload);
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'discount.apply error', ctx.request.body);
    }
  },
}));
