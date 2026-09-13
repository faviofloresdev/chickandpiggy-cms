'use strict';

const { sendTemplateEmail, normalizeEmail } = require('./resend-email');
const {
  buildUnsubscribeUrl,
} = require('../api/newsletter-subscription/utils/unsubscribe-token');

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

function buildNewsletterSubscriptionVariables({ subscription, contactEmail, unsubscribeUrl }) {
  return {
    CONTACT_EMAIL: String(contactEmail || '').trim(),
    SUBSCRIBER_EMAIL: String(subscription?.email || '').trim(),
    SUBSCRIBED_AT: formatDateTime(subscription?.subscribedAt),
    SOURCE: String(subscription?.source || 'home').trim(),
    NOTES: String(subscription?.notes || '').trim(),
    UNSUBSCRIBE_URL: String(unsubscribeUrl || '').trim(),
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

function buildTrackingUrl(carrier, trackingNumber) {
  const normalizedCarrier = String(carrier || '').trim().toLowerCase();
  const normalizedTrackingNumber = String(trackingNumber || '').trim();
  if (!normalizedTrackingNumber) return '';
  const encoded = encodeURIComponent(normalizedTrackingNumber);
  if (normalizedCarrier.includes('ups')) return `https://www.ups.com/track?loc=en_US&tracknum=${encoded}`;
  if (normalizedCarrier.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (normalizedCarrier.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  return '';
}

function buildShippingTemplateVariables({ order, contactEmail }) {
  const shippingOptionLabel =
    order?.shippingOption?.label ||
    order?.shippingOption?.name ||
    order?.shippingOptionId ||
    '';

  return {
    CONTACT_EMAIL: String(contactEmail || '').trim(),
    ORDER_ID: String(order?.id || '').trim(),
    ORDER_NUMBER: String(order?.orderNumber || order?.id || '').trim(),
    CUSTOMER_NAME: String(order?.customerName || '').trim(),
    CUSTOMER_EMAIL: String(order?.customerEmail || '').trim(),
    CARRIER: String(order?.carrier || '').trim(),
    TRACKING_NUMBER: String(order?.trackingNumber || '').trim(),
    TRACKING_URL: buildTrackingUrl(order?.carrier, order?.trackingNumber),
    SHIPPED_AT: formatDateTime(order?.shippedAt || order?.updatedAt),
    SHIPPING_OPTION: String(shippingOptionLabel).trim(),
    SHIPPING_ADDRESS: formatAddress(order?.shippingAddress),
    ORDER_TOTAL: formatCurrency(order?.totalAmount, order?.currency),
    ORDER_CURRENCY: String(order?.currency || 'usd').toUpperCase(),
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

function buildInternalOrderNotificationIdempotencyKey(order) {
  const paymentIntentId = String(order?.paymentIntentId || 'unknown').trim();
  return `order-notification-${order?.id || 'unknown'}-${paymentIntentId}`.slice(0, 256);
}

function buildNewsletterIdempotencyKey(subscription) {
  const email = String(subscription?.email || 'unknown').trim();
  const subscribedAt = String(subscription?.subscribedAt || '').trim() || new Date().toISOString();
  return `newsletter-subscription-${email}-${subscribedAt}`.slice(0, 256);
}

function buildShippingConfirmationIdempotencyKey(order) {
  const trackingNumber = String(order?.trackingNumber || 'unknown').trim();
  return `shipping-confirmation-${order?.id || 'unknown'}-${trackingNumber}`.slice(0, 256);
}

async function updateOrderNotificationMetadata(strapi, order, notificationKey, updates) {
  const currentMetadata = order?.metadata || {};
  const currentNotifications = currentMetadata.notifications || {};
  const currentNotification = currentNotifications[notificationKey] || {};

  const metadata = {
    ...currentMetadata,
    notifications: {
      ...currentNotifications,
      [notificationKey]: {
        ...currentNotification,
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
      unsubscribeUrl: buildUnsubscribeUrl(subscription),
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
  const normalizedContactEmail = normalizeEmail(contactEmail);

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

    let internalNotification = null;
    if (normalizedContactEmail && normalizedContactEmail !== customerEmail) {
      internalNotification = await sendTemplateEmail({
        to: normalizedContactEmail,
        templateId: process.env.RESEND_ORDER_TEMPLATE_ID || ORDER_TEMPLATE_ID,
        idempotencyKey: buildInternalOrderNotificationIdempotencyKey(order),
        variables: templateVariables,
        tags: [
          { name: 'flow', value: 'checkout_internal' },
          { name: 'order_id', value: String(order.id) },
        ],
      });
    }

    await updateOrderNotificationMetadata(strapi, order, 'orderConfirmation', {
      sentAt: new Date().toISOString(),
      resendEmailId: result.id || null,
      templateId: result.templateId,
      to: customerEmail,
      internalNotification: internalNotification?.skipped
        ? null
        : {
            sentAt: new Date().toISOString(),
            resendEmailId: internalNotification?.id || null,
            to: internalNotification?.to || [normalizedContactEmail].filter(Boolean),
          },
      failedAt: null,
      failureMessage: null,
    });

    return {
      ...result,
      internalNotification,
    };
  } catch (error) {
    await updateOrderNotificationMetadata(strapi, order, 'orderConfirmation', {
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

async function sendShippingConfirmation(strapi, orderId) {
  const order = await strapi.entityService.findOne('api::order.order', orderId);
  if (!order?.id) return { skipped: true, reason: 'order_not_found' };

  const alreadySentAt = order?.metadata?.notifications?.shippingConfirmation?.sentAt;
  if (alreadySentAt) return { skipped: true, reason: 'already_sent' };

  const customerEmail = normalizeEmail(order.customerEmail);
  if (!customerEmail) return { skipped: true, reason: 'missing_customer_email' };
  if (!order.carrier || !order.trackingNumber) {
    return { skipped: true, reason: 'missing_shipping_details' };
  }

  const templateId = String(process.env.RESEND_SHIPPING_TEMPLATE_ID || '').trim();
  if (!templateId) return { skipped: true, reason: 'missing_shipping_template_id' };

  const contactEmail = await getContactEmail(strapi);
  try {
    const result = await sendTemplateEmail({
      to: customerEmail,
      templateId,
      idempotencyKey: buildShippingConfirmationIdempotencyKey(order),
      variables: buildShippingTemplateVariables({ order, contactEmail }),
      tags: [
        { name: 'flow', value: 'shipping_confirmation' },
        { name: 'order_id', value: String(order.id) },
      ],
    });

    if (result.skipped) return result;
    await updateOrderNotificationMetadata(strapi, order, 'shippingConfirmation', {
      sentAt: new Date().toISOString(),
      resendEmailId: result.id || null,
      templateId: result.templateId,
      to: customerEmail,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      failedAt: null,
      failureMessage: null,
    });
    return result;
  } catch (error) {
    await updateOrderNotificationMetadata(strapi, order, 'shippingConfirmation', {
      failedAt: new Date().toISOString(),
      failureMessage: error.message,
      templateId,
      to: customerEmail,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
    }).catch((metadataError) => {
      strapi.log.error('notification.shippingConfirmation metadata update failed', metadataError);
    });
    throw error;
  }
}

module.exports = {
  buildTrackingUrl,
  buildShippingTemplateVariables,
  buildNewsletterSubscriptionVariables,
  buildOrderTemplateVariables,
  notifyNewsletterSubscription,
  sendOrderConfirmation,
  sendShippingConfirmation,
};
