const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const unparsedBodySymbol = Symbol.for('unparsedBody');

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
      // attempt update
      const pi = await stripe.paymentIntents.update(paymentIntentId, params);
      return pi;
    }

    const pi = await stripe.paymentIntents.create(params);
    return pi;
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
