'use strict';

const { sendTemplateEmail, normalizeEmail } = require('./resend-email');

const NEWSLETTER_TEMPLATE_ID = '99999999999999';
const ORDER_TEMPLATE_ID = '888888888888';

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  }).format(date);
}

function formatCurrency(value, currency = 'usd') {
  const amount = Number(value || 0);
  const normalizedCurrency = String(currency || 'usd').toUpperCase();

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(amount);
  } catch (error) {
    return `${normalizedCurrency} ${amount.toFixed(2)}`;
  }
}

function formatAddress(address) {
  if (!address || typeof address !== 'object') {
    return '';
  }

  return [
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state].filter(Boolean).join(', '),
    address.postalCode,
    address.country,
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' | ');
}

function summarizeItems(items = []) {
  return items
    .map((item) => {
      const name =
        item?.product?.name ||
        item?.product?.title ||
        item?.title ||
        'Item';
      const quantity = Number(item?.quantity || 0);
      const subtotal = formatCurrency(item?.subtotal || 0);
      return `${name} x${quantity} (${subtotal})`;
    })
    .join(', ');
}

function buildNewsletterSubscriptionVariables({ subscription, contactEmail }) {
  return {
    CONTACT_EMAIL: String(contactEmail || '').trim(),
    SUBSCRIBER_EMAIL: String(subscription?.email || '').trim(),
    SUBSCRIBED_AT: formatDateTime(subscription?.subscribedAt),
    SOURCE: String(subscription?.source || 'home').trim(),
    NOTES: String(subscription?.notes || '').trim(),
  };
}

function buildOrderTemplateVariables({ order, contactEmail }) {
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  const shippingOptionLabel =
    order?.shippingOption?.label ||
    order?.shippingOption?.name ||
    order?.shippingOptionId ||
    '';

  return {
    CONTACT_EMAIL: String(contactEmail || '').trim(),
    ORDER_ID: String(order?.id || '').trim(),
    ORDER_DATE: formatDateTime(order?.paidAt || order?.updatedAt || order?.createdAt),
    ORDER_STATUS: String(order?.status || '').trim(),
    PAYMENT_STATUS: String(order?.paymentStatus || '').trim(),
    CUSTOMER_NAME: String(order?.customerName || '').trim(),
    CUSTOMER_EMAIL: String(order?.customerEmail || '').trim(),
    CUSTOMER_PHONE: String(order?.customerPhone || '').trim(),
    ORDER_CURRENCY: String(order?.currency || 'usd').toUpperCase(),
    ORDER_SUBTOTAL: formatCurrency(order?.subtotal, order?.currency),
    ORDER_DISCOUNT: formatCurrency(order?.discountAmount, order?.currency),
    ORDER_TAX: formatCurrency(order?.taxAmount, order?.currency),
    ORDER_SHIPPING: formatCurrency(order?.shippingAmount, order?.currency),
    ORDER_TOTAL: formatCurrency(order?.totalAmount, order?.currency),
    SHIPPING_OPTION: String(shippingOptionLabel).trim(),
    SHIPPING_ADDRESS: formatAddress(order?.shippingAddress),
    BILLING_ADDRESS: formatAddress(order?.billingAddress),
    ITEM_COUNT: items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0),
    ITEMS_SUMMARY: summarizeItems(items),
  };
}

async function getContactEmail(strapi) {
  const contact = await strapi.db.query('api::contact.contact').findOne({
    select: ['contactEmail'],
  });

  return normalizeEmail(contact?.contactEmail);
}

function buildOrderConfirmationIdempotencyKey(order) {
  const paymentIntentId = String(order?.paymentIntentId || 'unknown').trim();
  return `order-confirmation-${order?.id || 'unknown'}-${paymentIntentId}`.slice(0, 256);
}

function buildNewsletterIdempotencyKey(subscription) {
  const email = String(subscription?.email || 'unknown').trim();
  const subscribedAt = String(subscription?.subscribedAt || '').trim() || new Date().toISOString();
  return `newsletter-subscription-${email}-${subscribedAt}`.slice(0, 256);
}

async function updateOrderNotificationMetadata(strapi, order, updates) {
  const currentMetadata = order?.metadata || {};
  const currentNotifications = currentMetadata.notifications || {};
  const currentOrderConfirmation = currentNotifications.orderConfirmation || {};

  const metadata = {
    ...currentMetadata,
    notifications: {
      ...currentNotifications,
      orderConfirmation: {
        ...currentOrderConfirmation,
        ...updates,
      },
    },
  };

  return strapi.entityService.update('api::order.order', order.id, {
    data: {
      metadata,
    },
  });
}

async function notifyNewsletterSubscription(strapi, subscription) {
  const contactEmail = await getContactEmail(strapi);
  if (!contactEmail) {
    return { skipped: true, reason: 'missing_contact_email' };
  }

  return sendTemplateEmail({
    to: contactEmail,
    templateId: process.env.RESEND_NEWSLETTER_TEMPLATE_ID || NEWSLETTER_TEMPLATE_ID,
    idempotencyKey: buildNewsletterIdempotencyKey(subscription),
    variables: buildNewsletterSubscriptionVariables({
      subscription,
      contactEmail,
    }),
    tags: [
      { name: 'flow', value: 'newsletter' },
      { name: 'source', value: 'home' },
    ],
  });
}

async function sendOrderConfirmation(strapi, orderId) {
  const order = await strapi.entityService.findOne('api::order.order', orderId, {
    populate: {
      order_items: true,
    },
  });

  if (!order?.id) {
    return { skipped: true, reason: 'order_not_found' };
  }

  const alreadySentAt = order?.metadata?.notifications?.orderConfirmation?.sentAt;
  if (alreadySentAt) {
    return { skipped: true, reason: 'already_sent' };
  }

  const customerEmail = normalizeEmail(order.customerEmail);
  if (!customerEmail) {
    return { skipped: true, reason: 'missing_customer_email' };
  }

  const contactEmail = await getContactEmail(strapi);
  const templateVariables = buildOrderTemplateVariables({
    order,
    contactEmail,
  });

  try {
    const result = await sendTemplateEmail({
      to: customerEmail,
      templateId: process.env.RESEND_ORDER_TEMPLATE_ID || ORDER_TEMPLATE_ID,
      idempotencyKey: buildOrderConfirmationIdempotencyKey(order),
      variables: templateVariables,
      tags: [
        { name: 'flow', value: 'checkout' },
        { name: 'order_id', value: String(order.id) },
      ],
    });

    if (result.skipped) {
      return result;
    }

    await updateOrderNotificationMetadata(strapi, order, {
      sentAt: new Date().toISOString(),
      resendEmailId: result.id || null,
      templateId: result.templateId,
      to: customerEmail,
      failedAt: null,
      failureMessage: null,
    });

    return result;
  } catch (error) {
    await updateOrderNotificationMetadata(strapi, order, {
      failedAt: new Date().toISOString(),
      failureMessage: error.message,
      templateId: process.env.RESEND_ORDER_TEMPLATE_ID || ORDER_TEMPLATE_ID,
      to: customerEmail,
    }).catch((metadataError) => {
      strapi.log.error('notification.orderConfirmation metadata update failed', metadataError);
    });

    throw error;
  }
}

module.exports = {
  buildNewsletterSubscriptionVariables,
  buildOrderTemplateVariables,
  notifyNewsletterSubscription,
  sendOrderConfirmation,
};
