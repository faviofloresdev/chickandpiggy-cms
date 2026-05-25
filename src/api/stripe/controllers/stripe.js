const { sanitize } = require('../../checkout/utils/validate');

module.exports = {
  async checkout(ctx) {
    try {
      const payload = sanitize(ctx.request.body);
      const hasCustomerEmail = Boolean(payload.customer?.email);
      const hasSelectedShippingOption = Boolean(payload.shipping?.selectedShippingOptionId);

      const result =
        hasCustomerEmail && hasSelectedShippingOption
          ? await strapi.service('api::checkout.checkout').paymentIntent(payload)
          : await strapi.service('api::checkout.checkout').quote(payload);

      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('stripe.checkout compatibility error', err);
    }
  },

  async webhook(ctx) {
    try {
      const result = await strapi.service('api::checkout.checkout').handleWebhook(ctx);
      ctx.body = result;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = { error: err.message };
      strapi.log.error('stripe.webhook compatibility error', err);
    }
  },
};
