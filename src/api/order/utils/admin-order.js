'use strict';

const crypto = require('node:crypto');

const FULFILLMENT_STATES = ['pending_preparation', 'preparing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATES = ['pending', 'paid', 'failed', 'refunded'];
const TRANSITIONS = {
  pending_preparation: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertInternalAdmin(ctx) {
  const expected = process.env.ADMIN_INTERNAL_API_KEY;
  if (!expected) throw createError('Administrative API is not configured', 503);
  if (!safeEqual(ctx.get('x-admin-api-key'), expected)) throw createError('Forbidden', 403);

  const role = String(ctx.get('x-admin-role') || '').toLowerCase();
  if (!['admin', 'operator'].includes(role)) throw createError('Invalid administrative role', 403);
  return {
    name: decodeURIComponent(ctx.get('x-admin-name') || 'Administrator'),
    email: decodeURIComponent(ctx.get('x-admin-email') || ''),
    role,
  };
}

function paymentStateFromStripe(paymentIntent) {
  if (!paymentIntent) return 'pending';
  const refunded = Number(paymentIntent.latest_charge?.amount_refunded || 0) > 0;
  if (refunded) return 'refunded';
  if (paymentIntent.status === 'succeeded') return 'paid';
  if (paymentIntent.status === 'canceled' || paymentIntent.status === 'requires_payment_method' && paymentIntent.last_payment_error) return 'failed';
  return 'pending';
}

function orderNumber(order) {
  return order.orderNumber || `CP-${new Date(order.createdAt || Date.now()).getUTCFullYear()}-${String(order.id).padStart(6, '0')}`;
}

async function recordChange(orderId, change) {
  return strapi.entityService.create('api::order-change.order-change', {
    data: { order: orderId, changedAt: new Date().toISOString(), ...change },
  });
}

module.exports = {
  FULFILLMENT_STATES,
  PAYMENT_STATES,
  TRANSITIONS,
  createError,
  assertInternalAdmin,
  paymentStateFromStripe,
  orderNumber,
  recordChange,
};
