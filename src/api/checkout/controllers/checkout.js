const { sanitize } = require('../utils/validate');

module.exports = {
  async discount(ctx) {
    try {
      const payload = sanitize({
        ...ctx.request.body,
        ...ctx.request.query,
        discountCode: ctx.params.code || ctx.request.query?.code || ctx.request.body?.discountCode,
      });
      const result = await strapi.service('api::checkout.checkout').discount(payload);
      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('checkout.discount error', err);
    }
  },

  async quote(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').quote(payload);
      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('checkout.quote error', err);
    }
  },

  async paymentIntent(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const result = await strapi.service('api::checkout.checkout').paymentIntent(payload);
      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('checkout.paymentIntent error', err);
    }
  },

  async webhook(ctx) {
    try {
      const result = await strapi.service('api::checkout.checkout').handleWebhook(ctx);
      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('checkout.webhook error', err);
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
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('checkout.createLabel error', err);
    }
  },
};
