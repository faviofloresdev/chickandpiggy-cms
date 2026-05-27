const { sanitize } = require('../utils/validate');
const { respondWithSanitizedError } = require('../utils/http');

module.exports = {
  async discount(ctx) {
    try {
      const payload = sanitize({
        items: ctx.request.body?.items,
        shipping: ctx.request.body?.shipping,
        discountCode: ctx.params.code || ctx.request.body?.discountCode,
        checkoutSessionToken: ctx.request.body?.checkoutSessionToken,
      });
      const result = await strapi.service('api::checkout.checkout').discount(payload);
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'checkout.discount error', ctx.request.body);
    }
  },

  async quote(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').quote(payload);
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'checkout.quote error', ctx.request.body);
    }
  },

  async paymentIntent(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').paymentIntent(payload);
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'checkout.paymentIntent error', ctx.request.body);
    }
  },

  async webhook(ctx) {
    try {
      const result = await strapi.service('api::checkout.checkout').handleWebhook(ctx);
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'checkout.webhook error');
    }
  },

  async createLabel(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').enqueueLabelCreation({
        orderId: payload.orderId,
      });
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'checkout.createLabel error', ctx.request.body);
    }
  },
};
