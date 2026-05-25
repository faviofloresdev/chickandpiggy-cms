const cartService = require('./cartService');
const taxService = require('./taxService');
const shippingService = require('./shippingService');
const stripeService = require('./stripeService');
const labelQueue = require('./shipping/labelQueue');

function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireShippingAddress(shipping, { requireAddressLine1 = true } = {}) {
  if (!shipping) {
    throw createError('Shipping address is required');
  }

  const requiredFields = ['city', 'state', 'postalCode', 'country'];
  if (requireAddressLine1) {
    requiredFields.unshift('addressLine1');
  }

  for (const field of requiredFields) {
    if (!shipping[field]) {
      throw createError(`Shipping field "${field}" is required`);
    }
  }

  const normalizedCountry = String(shipping.country || '').toUpperCase();
  const normalizedPostalCode = String(shipping.postalCode || '').trim();
  if (normalizedCountry === 'US' && !/^\d{5}(-\d{4})?$/.test(normalizedPostalCode)) {
    throw createError('Shipping postalCode must be a complete US ZIP code');
  }
}

function requireCustomer(customer) {
  if (!customer?.name) {
    throw createError('Customer name is required');
  }

  if (!customer?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw createError('Customer email is required');
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeComparableString(value) {
  return String(value || '').trim().toLowerCase();
}

function buildItemSummary(items = []) {
  return items.map((item) => `${item.title} x${item.quantity}`).join('|');
}

function normalizeTotals({
  subtotalCents,
  discountCents = 0,
  taxableSubtotalCents = subtotalCents,
  taxCents,
  shippingCents,
  currency = 'usd',
}) {
  return {
    subtotal: subtotalCents / 100,
    discount: discountCents / 100,
    taxableSubtotal: taxableSubtotalCents / 100,
    tax: taxCents / 100,
    shipping: shippingCents / 100,
    total: (taxableSubtotalCents + taxCents + shippingCents) / 100,
    currency,
  };
}

function buildOrderData({ payload, cart, customerRecord, discount, selectedShippingOption, totals, paymentIntent }) {
  return {
    paymentIntentId: paymentIntent?.id || null,
    clientSecret: paymentIntent?.client_secret || null,
    paymentStatus: paymentIntent?.status || 'requires_payment_method',
    status: 'pending',
    currency: totals.currency,
    discountCode: discount?.code || null,
    discountAmount: discount?.amount || 0,
    discountSnapshot: discount || null,
    subtotal: totals.subtotal,
    taxableSubtotal: totals.taxableSubtotal,
    taxAmount: totals.tax,
    shippingAmount: totals.shipping,
    totalAmount: totals.total,
    totals,
    items: cart.items,
    customerName: payload.customer?.name || '',
    customerEmail: payload.customer?.email || '',
    customerPhone: payload.customer?.phone || '',
    customer: customerRecord?.id || null,
    shippingAddress: payload.shipping,
    billingAddress: payload.billing || payload.shipping,
    shippingOptionId: selectedShippingOption.id,
    shippingOption: selectedShippingOption,
    discount: discount?.id || null,
    metadata: {
      destinationState: payload.shipping?.state || '',
      shippingOptionId: selectedShippingOption.id,
      itemSummary: buildItemSummary(cart.items),
      discountCode: discount?.code || '',
    },
  };
}

async function recreateOrderItems(orderId, items) {
  await strapi.db.query('api::order-item.order-item').deleteMany({
    where: {
      order: orderId,
    },
  });

  for (const item of items) {
    await strapi.entityService.create('api::order-item.order-item', {
      data: {
        order: orderId,
        quantity: item.quantity,
        unitPrice: item.unitPrice / 100,
        subtotal: item.lineTotal / 100,
        product: item.productSnapshot,
      },
    });
  }
}

async function findOrderByPaymentIntentId(paymentIntentId) {
  if (!paymentIntentId) {
    return null;
  }

  const orders = await strapi.entityService.findMany('api::order.order', {
    filters: {
      paymentIntentId,
    },
    limit: 1,
  });

  return Array.isArray(orders) ? orders[0] || null : orders || null;
}

async function findReusablePendingOrder({ payload, cart, selectedShippingOption }) {
  const customerEmail = normalizeEmail(payload?.customer?.email);
  if (!customerEmail) {
    return null;
  }

  const orders = await strapi.entityService.findMany('api::order.order', {
    filters: {
      customerEmail: {
        $eqi: customerEmail,
      },
      status: 'pending',
    },
    sort: ['updatedAt:desc'],
    limit: 10,
  });

  const itemSummary = buildItemSummary(cart.items);
  const shippingAddress = payload?.shipping || {};
  const shippingOptionId = selectedShippingOption?.id || '';

  const candidates = Array.isArray(orders) ? orders : [orders];
  return candidates.find((order) => {
    if (!order?.id) {
      return false;
    }

    return (
      normalizeComparableString(order.customerEmail) === customerEmail &&
      normalizeComparableString(order.shippingOptionId) === normalizeComparableString(shippingOptionId) &&
      normalizeComparableString(order.metadata?.itemSummary) === normalizeComparableString(itemSummary) &&
      normalizeComparableString(order.shippingAddress?.addressLine1) === normalizeComparableString(shippingAddress.addressLine1) &&
      normalizeComparableString(order.shippingAddress?.postalCode) === normalizeComparableString(shippingAddress.postalCode) &&
      normalizeComparableString(order.shippingAddress?.state) === normalizeComparableString(shippingAddress.state)
    );
  }) || null;
}

async function upsertOrder({ payload, cart, customerRecord, discount, selectedShippingOption, totals, paymentIntent, existingOrderRecord = null }) {
  const orderData = buildOrderData({
    payload,
    cart,
    customerRecord,
    discount,
    selectedShippingOption,
    totals,
    paymentIntent,
  });

  let order;
  const existingOrderId = payload.orderId || null;
  const existingOrder =
    existingOrderRecord ||
    (existingOrderId && await strapi.entityService.findOne('api::order.order', existingOrderId).catch(() => null)) ||
    await findOrderByPaymentIntentId(paymentIntent?.id || payload.paymentIntentId);

  if (existingOrder?.id) {
    order = await strapi.entityService.update('api::order.order', existingOrder.id, {
      data: orderData,
    });
  } else {
    order = await strapi.entityService.create('api::order.order', {
      data: orderData,
    });
  }

  await recreateOrderItems(order.id, cart.items);
  return order;
}

async function upsertCustomerFromPayload(payload) {
  return strapi.service('api::customer.customer').upsertFromCheckout({
    customer: payload.customer,
    shippingAddress: payload.shipping,
    billingAddress: payload.billing || payload.shipping,
  });
}

async function resolveCheckoutDiscount(payload, subtotalCents) {
  if (!payload?.discountCode) {
    return null;
  }

  return strapi.service('api::discount.discount').resolveDiscount({
    code: payload.discountCode,
    subtotalCents,
  });
}

async function updateOrderLabelState(orderId, updates) {
  const order = await strapi.entityService.findOne('api::order.order', orderId);
  if (!order) {
    throw createError('Order not found', 404);
  }

  const metadata = {
    ...(order.metadata || {}),
    shippingLabel: {
      ...((order.metadata || {}).shippingLabel || {}),
      ...updates,
    },
  };

  return strapi.entityService.update('api::order.order', orderId, {
    data: {
      metadata,
    },
  });
}

function hasTaxAddress(shipping) {
  return Boolean(
    shipping?.city &&
    shipping?.state &&
    shipping?.postalCode &&
    shipping?.country
  );
}

module.exports = {
  async discount(payload) {
    if (!payload?.discountCode) {
      throw createError('Discount code is required');
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      const discount = await strapi.service('api::discount.discount').inspectDiscount({
        code: payload.discountCode,
      });

      return {
        discount,
        items: [],
        totals: null,
      };
    }

    const cart = await cartService.validateAndCalculate(payload.items);
    const discount = await resolveCheckoutDiscount(payload, cart.subtotal);
    const taxableSubtotalCents = Math.max(0, cart.subtotal - (discount?.amountCents || 0));
    const tax = hasTaxAddress(payload.shipping)
      ? await taxService.calculateTax(taxableSubtotalCents, payload.shipping)
      : { amount: 0, rate: 0 };

    const totals = normalizeTotals({
      subtotalCents: cart.subtotal,
      discountCents: discount?.amountCents || 0,
      taxableSubtotalCents,
      taxCents: tax.amount,
      shippingCents: 0,
    });

    return {
      discount,
      items: cart.items,
      totals,
    };
  },

  async quote(payload) {
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw createError('Cart must contain at least one item');
    }

    requireShippingAddress(payload.shipping);

    // Validate items and recalc subtotal (in cents)
    const { items, shipping } = payload;
    const cart = await cartService.validateAndCalculate(items);
    const discount = await resolveCheckoutDiscount(payload, cart.subtotal);
    const taxableSubtotalCents = Math.max(0, cart.subtotal - (discount?.amountCents || 0));

    const tax = await taxService.calculateTax(taxableSubtotalCents, shipping);

    // Build shipments (don't assume front-end selection yet)
    const origin = await shippingService.getOrigin();
    const shippingRates = await shippingService.getRates({ origin, destination: shipping, items: cart.items }).catch((err) => {
      strapi.log.error('shipping.getRates failed', err);
      return null; // allow quote to continue if carriers fail; handled below
    });

    if (!shippingRates?.shippingOptions || shippingRates.shippingOptions.length === 0) {
      throw createError('No shipping rates available', 502);
    }

    const totals = normalizeTotals({
      subtotalCents: cart.subtotal,
      discountCents: discount?.amountCents || 0,
      taxableSubtotalCents,
      taxCents: tax.amount,
      shippingCents: 0,
    });

    return {
      items: cart.items,
      discount,
      totals,
      originLabel: origin.label,
      shippingFingerprint: shippingRates.fingerprint,
      packageSnapshot: shippingRates.packageSnapshot,
      shippingOptions: shippingRates.shippingOptions,
      shippingHighlights: shippingRates.shippingHighlights,
      shippingCacheHit: shippingRates.cacheHit,
    };
  },

  async paymentIntent(payload) {
    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw createError('Cart must contain at least one item');
    }

    requireShippingAddress(payload.shipping);
    requireCustomer(payload.customer);

    const { items, shipping, customer } = payload;

    const cart = await cartService.validateAndCalculate(items);
    const discount = await resolveCheckoutDiscount(payload, cart.subtotal);
    const taxableSubtotalCents = Math.max(0, cart.subtotal - (discount?.amountCents || 0));
    const tax = await taxService.calculateTax(taxableSubtotalCents, shipping);
    const origin = await shippingService.getOrigin();
    const shippingRates = await shippingService.getRates({ origin, destination: shipping, items: cart.items });
    const shippingOptions = shippingRates.shippingOptions;

    const selected = shippingOptions.find((s) => s.id === shipping.selectedShippingOptionId);
    if (!selected) {
      throw createError('Selected shipping option not valid');
    }

    const shippingAmount = Math.round(selected.amount * 100);
    const totals = normalizeTotals({
      subtotalCents: cart.subtotal,
      discountCents: discount?.amountCents || 0,
      taxableSubtotalCents,
      taxCents: tax.amount,
      shippingCents: shippingAmount,
    });

    let order = null;
    if (payload.orderId) {
      order = await strapi.entityService.findOne('api::order.order', payload.orderId);
    } else if (payload.paymentIntentId) {
      order = await findOrderByPaymentIntentId(payload.paymentIntentId);
    } else {
      order = await findReusablePendingOrder({
        payload: {
          ...payload,
          customer,
        },
        cart,
        selectedShippingOption: selected,
      });
    }

    const customerRecord = await upsertCustomerFromPayload({
      ...payload,
      customer,
    });

    const metadata = {
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer?.phone || '',
      destinationState: shipping?.state || '',
      shippingOptionId: selected.id,
      itemSummary: buildItemSummary(cart.items),
      discountCode: discount?.code || '',
      discountAmount: String(discount?.amount || 0),
      orderId: order?.id ? String(order.id) : '',
      shippingFingerprint: shippingRates.fingerprint,
    };

    const paymentIntent = await stripeService.createOrUpdatePaymentIntent({
      amount: Math.round(totals.total * 100),
      currency: 'usd',
      metadata,
      paymentIntentId: payload.paymentIntentId || order?.paymentIntentId || undefined,
    });

    order = await upsertOrder({
      payload: {
        ...payload,
        customer,
      },
      cart,
      customerRecord,
      discount,
      selectedShippingOption: selected,
      totals,
      paymentIntent,
      existingOrderRecord: order,
    });

    if (!metadata.orderId) {
      await stripeService.createOrUpdatePaymentIntent({
        amount: Math.round(totals.total * 100),
        currency: 'usd',
        metadata: {
          ...metadata,
          orderId: String(order.id),
        },
        paymentIntentId: paymentIntent.id,
      });
    }

    return {
      orderId: order.id,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      items: cart.items,
      discount,
      shippingOptions,
      shippingHighlights: shippingRates.shippingHighlights,
      selectedShippingOption: selected,
      totals,
    };
  },

  async enqueueLabelCreation({ orderId }) {
    if (!orderId) {
      throw createError('orderId is required');
    }

    await updateOrderLabelState(orderId, {
      status: 'queued',
      requestedAt: new Date().toISOString(),
    });

    labelQueue.enqueue(async () => {
      await updateOrderLabelState(orderId, {
        status: 'processing',
        processingStartedAt: new Date().toISOString(),
      });

      try {
        await updateOrderLabelState(orderId, {
          status: 'stored',
          generatedAt: new Date().toISOString(),
          provider: process.env.SHIPPING_LABEL_PROVIDER || null,
        });
      } catch (error) {
        await updateOrderLabelState(orderId, {
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: error.message,
        });
        throw error;
      }
    }).catch((error) => {
      strapi.log.error('checkout.labelQueue error', error);
    });

    return {
      queued: true,
      orderId,
    };
  },

  async handleWebhook(ctx) {
    const event = await stripeService.constructWebhookEvent(ctx);

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const [order] = await strapi.entityService.findMany('api::order.order', {
        filters: { paymentIntentId: paymentIntent.id },
        populate: { discount: true },
        limit: 1,
      });

      if (order) {
        await strapi.entityService.update('api::order.order', order.id, {
          data: {
            status: 'paid',
            paymentStatus: paymentIntent.status,
            paidAt: new Date(paymentIntent.created * 1000).toISOString(),
            metadata: {
              ...(order.metadata || {}),
              stripeChargeId: paymentIntent.latest_charge || null,
            },
          },
        });
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      const [order] = await strapi.entityService.findMany('api::order.order', {
        filters: { paymentIntentId: paymentIntent.id },
        limit: 1,
      });

      if (order) {
        await strapi.entityService.update('api::order.order', order.id, {
          data: {
            status: 'failed',
            paymentStatus: paymentIntent.status,
            metadata: {
              ...(order.metadata || {}),
              paymentFailureMessage: paymentIntent.last_payment_error?.message || null,
            },
          },
        });
      }
    }

    return { received: true };
  },
};
