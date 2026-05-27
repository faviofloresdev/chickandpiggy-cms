const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const unparsedBodySymbol = Symbol.for('unparsedBody');
const REUSABLE_PAYMENT_INTENT_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

module.exports = {
  async createOrUpdatePaymentIntent({ amount, currency = 'usd', metadata = {}, paymentIntentId }) {
    if (!stripe) {
      throw new Error('Stripe secret key not configured');
    }

    const params = {
      amount: Math.round(amount),
      currency,
      metadata,
    };

    if (paymentIntentId) {
      const existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (REUSABLE_PAYMENT_INTENT_STATUSES.has(existingIntent.status)) {
        return stripe.paymentIntents.update(paymentIntentId, params);
      }

      strapi.log.warn(
        `stripe.paymentIntent stale intent detected; creating replacement. paymentIntentId=${paymentIntentId} status=${existingIntent.status}`
      );
    }

    return stripe.paymentIntents.create(params);
  },

  async constructWebhookEvent(ctx) {
    if (!stripe) {
      throw new Error('Stripe secret key not configured');
    }

    const signature = ctx.request.headers['stripe-signature'];
    if (!signature) {
      const err = new Error('Missing Stripe signature');
      err.status = 400;
      throw err;
    }

    const rawBody = ctx.request.body?.[unparsedBodySymbol];
    if (!rawBody) {
      const err = new Error('Raw request body not available for Stripe webhook');
      err.status = 500;
      throw err;
    }

    return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  },
};
