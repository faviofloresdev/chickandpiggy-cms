'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { respondWithSanitizedError } = require('../../checkout/utils/http');

module.exports = createCoreController('api::shipping-origin.shipping-origin', ({ strapi }) => ({
  async active(ctx) {
    try {
      const origin = await strapi.service('api::shipping-origin.shipping-origin').getActiveOrigin();
      ctx.body = { data: origin };
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'shipping-origin.active error');
    }
  },
}));
