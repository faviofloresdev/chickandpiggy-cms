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
    {
      method: 'GET',
      path: '/newsletter-subscriptions/unsubscribe',
      handler: 'newsletter-subscription.confirmUnsubscribe',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/newsletter-subscriptions/unsubscribe',
      handler: 'newsletter-subscription.unsubscribe',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
