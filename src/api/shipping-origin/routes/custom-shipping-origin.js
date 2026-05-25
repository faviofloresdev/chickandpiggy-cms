module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/shipping-origins/active',
      handler: 'shipping-origin.active',
      config: { auth: false, policies: [] },
    },
  ],
};
