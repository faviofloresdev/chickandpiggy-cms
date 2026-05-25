module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/checkout/discount/:code',
      handler: 'checkout.discount',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/checkout/discount',
      handler: 'checkout.discount',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/checkout/quote',
      handler: 'checkout.quote',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/checkout/payment-intent',
      handler: 'checkout.paymentIntent',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/checkout/webhook',
      handler: 'checkout.webhook',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/checkout/labels',
      handler: 'checkout.createLabel',
      config: { auth: false, policies: [] },
    },
  ],
};
