module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/stripe/checkout',
      handler: 'stripe.checkout',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/stripe/webhook',
      handler: 'stripe.webhook',
      config: {
        auth: false,
      },
    },
  ],
};
