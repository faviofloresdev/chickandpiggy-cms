function normalizeString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeInteger(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeItem(item = {}) {
  return {
    id: item.id != null ? String(item.id) : null,
    productId: item.productId != null ? String(item.productId) : null,
    variantId: item.variantId != null ? String(item.variantId) : null,
    quantity: normalizeInteger(item.quantity, 1),
    selectedOptions: item.selectedOptions && typeof item.selectedOptions === 'object' ? item.selectedOptions : {},
    shippingDetails: item.shippingDetails && typeof item.shippingDetails === 'object'
      ? {
          weight: Number(item.shippingDetails.weight) || null,
          weightUnit: normalizeString(item.shippingDetails.weightUnit || 'LB').toUpperCase(),
          length: Number(item.shippingDetails.length) || null,
          width: Number(item.shippingDetails.width) || null,
          height: Number(item.shippingDetails.height) || null,
          dimensionUnit: normalizeString(item.shippingDetails.dimensionUnit || 'IN').toUpperCase(),
        }
      : undefined,
  };
}

function sanitizeAddress(address = {}) {
  return {
    addressLine1: normalizeString(address.addressLine1),
    addressLine2: normalizeString(address.addressLine2),
    city: normalizeString(address.city),
    state: normalizeString(address.state),
    postalCode: normalizeString(address.postalCode || address.zipCode),
    country: normalizeString(address.country || 'US').toUpperCase(),
    googleValidatedAddress: Boolean(address.googleValidatedAddress),
  };
}

function sanitize(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const allowed = {
    items: Array.isArray(payload.items) ? payload.items.map(sanitizeItem) : [],
  };

  if (payload.customer) {
    allowed.customer = {
      name: normalizeString(payload.customer.name || payload.customer.fullName || payload.customer.fullname),
      email: normalizeString(payload.customer.email).toLowerCase(),
      phone: normalizeString(payload.customer.phone),
    };
  }

  if (payload.shipping) {
    allowed.shipping = {
      ...sanitizeAddress(payload.shipping),
      selectedShippingOptionId: normalizeString(payload.shipping.selectedShippingOptionId, ''),
    };
  }

  if (payload.billing) {
    allowed.billing = sanitizeAddress(payload.billing);
  }

  if (payload.paymentIntentId) {
    allowed.paymentIntentId = normalizeString(payload.paymentIntentId);
  }

  const discountCode = normalizeString(payload.discountCode || payload.discount?.code);
  if (discountCode) {
    allowed.discountCode = discountCode.toUpperCase();
  }

  if (payload.orderId != null) {
    allowed.orderId = Number.parseInt(payload.orderId, 10) || null;
  }

  return allowed;
}

module.exports = { sanitize };
