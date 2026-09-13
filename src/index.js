'use strict';

const { orderNumber } = require('./api/order/utils/admin-order');

async function backfillAdministrativeOrderFields(strapi) {
  let migrated = 0;
  while (true) {
    const orders = await strapi.entityService.findMany('api::order.order', {
      filters: { orderNumber: { $null: true } },
      sort: ['id:asc'],
      limit: 100,
    });
    if (!orders.length) break;
    for (const order of orders) {
      await strapi.entityService.update('api::order.order', order.id, {
        data: {
          orderNumber: orderNumber(order),
          fulfillmentStatus: order.fulfillmentStatus || 'pending_preparation',
          paymentState: order.paymentState || (order.status === 'paid' ? 'paid' : order.status === 'failed' ? 'failed' : 'pending'),
        },
      });
      migrated += 1;
    }
  }
  if (migrated) strapi.log.info(`Backfilled administrative fields for ${migrated} orders`);
}

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    try {
      await backfillAdministrativeOrderFields(strapi);
    } catch (error) {
      strapi.log.error('Could not backfill administrative order fields', error);
    }
  },
};
