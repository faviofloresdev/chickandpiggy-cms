const { sanitize } = require('../../checkout/utils/validate');
const { respondWithSanitizedError } = require('../../checkout/utils/http');

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
      respondWithSanitizedError(ctx, err, 'stripe.checkout compatibility error', ctx.request.body);
    }
  },

  async webhook(ctx) {
    try {
      const result = await strapi.service('api::checkout.checkout').handleWebhook(ctx);
      ctx.body = result;
    } catch (err) {
      respondWithSanitizedError(ctx, err, 'stripe.webhook compatibility error');
    }
  },
};
