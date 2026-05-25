module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/discount',
      handler: 'discount.apply',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/discount/:code',
      handler: 'discount.lookup',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/discounts/code/:code',
      handler: 'discount.lookup',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/discounts/apply',
      handler: 'discount.apply',
      config: { auth: false, policies: [] },
    },
  ],
};
