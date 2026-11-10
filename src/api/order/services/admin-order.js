'use strict';

const stripeService = require('../../checkout/services/stripeService');
const { sendShippingConfirmation } = require('../../../services/notification-service');
const {
  TRANSITIONS,
  createError,
  orderNumber,
  paymentStateFromStripe,
  recordChange,
} = require('../utils/admin-order');

const ORDER_FIELDS = [
  'id', 'documentId', 'orderNumber', 'createdAt', 'updatedAt', 'currency', 'subtotal',
  'discountAmount', 'taxAmount', 'shippingAmount', 'totalAmount', 'items', 'customerName',
  'customerEmail', 'customerPhone', 'shippingAddress', 'billingAddress', 'shippingOption',
  'paymentIntentId', 'paymentStatus', 'paymentState', 'paidAt', 'fulfillmentStatus', 'carrier',
  'trackingNumber', 'shippedAt', 'deliveredAt',
];

function serialize(order, includeHistory = false) {
  const result = {};
  for (const field of ORDER_FIELDS) result[field] = order[field] ?? null;
  result.orderNumber = orderNumber(order);
  result.paymentState = order.paymentState || (order.status === 'paid' ? 'paid' : order.status === 'failed' ? 'failed' : 'pending');
  result.fulfillmentStatus = order.fulfillmentStatus || 'pending_preparation';
  if (includeHistory) result.changeHistory = order.changeHistory || [];
  return result;
}

async function persistOrderNumber(order) {
  if (order.orderNumber) return order;
  return strapi.entityService.update('api::order.order', order.id, {
    data: { orderNumber: orderNumber(order) },
  });
}

async function syncPayment(order) {
  if (!order.paymentIntentId) return order;
  const paymentIntent = await stripeService.retrievePaymentIntent(order.paymentIntentId);
  const paymentState = paymentStateFromStripe(paymentIntent);
  const updates = {
    paymentStatus: paymentIntent.status,
    paymentState,
  };
  if (paymentState === 'paid' && !order.paidAt) updates.paidAt = new Date().toISOString();

  if (order.paymentState !== paymentState || order.paymentStatus !== paymentIntent.status) {
    const updated = await strapi.entityService.update('api::order.order', order.id, { data: updates });
    if (order.paymentState !== paymentState) {
      await recordChange(order.id, {
        changeType: 'payment', previousValue: order.paymentState || 'pending', newValue: paymentState,
        actorName: 'Stripe', actorRole: 'stripe', note: 'Synchronized from Stripe',
      });
    }
    return updated;
  }
  return order;
}

module.exports = {
  async list(params) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 25));
    const filters = { $and: [] };
    if (params.fulfillmentStatus) filters.$and.push({ fulfillmentStatus: params.fulfillmentStatus });
    if (params.paymentState) filters.$and.push({ paymentState: params.paymentState });
    if (params.dateFrom) filters.$and.push({ createdAt: { $gte: params.dateFrom } });
    if (params.dateTo) filters.$and.push({ createdAt: { $lte: params.dateTo } });
    if (params.search) {
      filters.$and.push({
        $or: [
          { orderNumber: { $containsi: params.search } },
          { customerName: { $containsi: params.search } },
          { customerEmail: { $containsi: params.search } },
        ],
      });
    }
    const normalizedFilters = filters.$and.length ? filters : undefined;
    const [orders, total] = await Promise.all([
      strapi.entityService.findMany('api::order.order', {
        filters: normalizedFilters, sort: ['createdAt:desc'], start: (page - 1) * pageSize, limit: pageSize,
      }),
      strapi.entityService.count('api::order.order', { filters: normalizedFilters }),
    ]);
    const numbered = await Promise.all(orders.map(persistOrderNumber));
    return { data: numbered.map((order) => serialize(order)), meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  },

  async detail(id) {
    let order = await strapi.entityService.findOne('api::order.order', id, {
      populate: { changeHistory: { sort: ['changedAt:desc'] }, order_items: true },
    });
    if (!order) throw createError('Order not found', 404);
    order = await persistOrderNumber(order);
    order = await syncPayment(order);
    order = await strapi.entityService.findOne('api::order.order', order.id, {
      populate: { changeHistory: { sort: ['changedAt:desc'] }, order_items: true },
    });
    const result = serialize(order, true);
    result.orderItems = order.order_items || [];
    return result;
  },

  async update(id, payload, actor) {
    const allowed = ['fulfillmentStatus', 'carrier', 'trackingNumber', 'shippedAt', 'deliveredAt', 'note'];
    const extra = Object.keys(payload || {}).filter((key) => !allowed.includes(key));
    if (extra.length) throw createError(`Unsupported fields: ${extra.join(', ')}`);

    let order = await strapi.entityService.findOne('api::order.order', id);
    if (!order) throw createError('Order not found', 404);
    order = await syncPayment(order);
    const updates = {};
    const nextStatus = payload.fulfillmentStatus;
    if (nextStatus && nextStatus !== (order.fulfillmentStatus || 'pending_preparation')) {
      const previousStatus = order.fulfillmentStatus || 'pending_preparation';
      if (!TRANSITIONS[previousStatus]?.includes(nextStatus)) throw createError(`Transition ${previousStatus} -> ${nextStatus} is not allowed`, 409);
      if (nextStatus === 'cancelled' && actor.role !== 'admin') throw createError('Only administrators can cancel orders', 403);
      if (nextStatus === 'shipped') {
        if (order.paymentState !== 'paid') throw createError('Only paid orders can be shipped', 409);
        const carrier = payload.carrier ?? order.carrier;
        const trackingNumber = payload.trackingNumber ?? order.trackingNumber;
        if (!carrier || !trackingNumber) throw createError('Carrier and tracking number are required before shipping');
        updates.shippedAt = payload.shippedAt || order.shippedAt || new Date().toISOString();
      }
      if (nextStatus === 'delivered') updates.deliveredAt = payload.deliveredAt || order.deliveredAt || new Date().toISOString();
      updates.fulfillmentStatus = nextStatus;
    }

    for (const field of ['carrier', 'trackingNumber', 'shippedAt', 'deliveredAt']) {
      if (payload[field] !== undefined) updates[field] = payload[field] || null;
    }
    if (!Object.keys(updates).length) throw createError('No changes supplied');
    const updated = await strapi.entityService.update('api::order.order', order.id, { data: updates });

    if (updates.fulfillmentStatus) {
      await recordChange(order.id, {
        changeType: 'fulfillment', previousValue: order.fulfillmentStatus || 'pending_preparation',
        newValue: updates.fulfillmentStatus, actorName: actor.name, actorEmail: actor.email || null,
        actorRole: actor.role, note: payload.note || null,
      });
    }
    const shippingChanged = ['carrier', 'trackingNumber'].some(
      (field) => updates[field] !== undefined && updates[field] !== order[field]
    );
    if (shippingChanged) {
      await recordChange(order.id, {
        changeType: 'shipping', previousValue: JSON.stringify({ carrier: order.carrier, trackingNumber: order.trackingNumber }),
        newValue: JSON.stringify({ carrier: updated.carrier, trackingNumber: updated.trackingNumber }),
        actorName: actor.name, actorEmail: actor.email || null, actorRole: actor.role, note: payload.note || null,
      });
    }
    if (updates.fulfillmentStatus === 'shipped') {
      try {
        const notificationResult = await sendShippingConfirmation(strapi, order.id);
        if (notificationResult?.skipped && notificationResult.reason !== 'already_sent') {
          strapi.log.warn(
            `notification.shippingConfirmation skipped ${JSON.stringify({
              orderId: order.id,
              reason: notificationResult.reason,
            })}`
          );
        }
      } catch (error) {
        strapi.log.error(
          `notification.shippingConfirmation error ${JSON.stringify({
            orderId: order.id,
            message: error.message,
          })}`
        );
      }
    }
    return this.detail(order.id);
  },
};
