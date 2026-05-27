'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/newsletter-subscriptions',
      handler: 'newsletter-subscription.subscribe',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
