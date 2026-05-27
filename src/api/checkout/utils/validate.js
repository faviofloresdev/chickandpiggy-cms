function createValidationError(message, details = {}) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'INVALID_REQUEST';
  err.details = details;
  return err;
}

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createValidationError(`"${fieldName}" must be an object`);
  }
}

function assertStrictKeys(value, allowedKeys, fieldName) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw createValidationError(`"${fieldName}" contains unsupported fields`, {
      fieldName,
      unknownKeys,
    });
  }
}

function normalizeString(value, fieldName, { required = false, lowercase = false, uppercase = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw createValidationError(`"${fieldName}" is required`);
    }
    return '';
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw createValidationError(`"${fieldName}" must be a string`);
  }

  let normalized = String(value).trim();
  if (lowercase) {
    normalized = normalized.toLowerCase();
  }
  if (uppercase) {
    normalized = normalized.toUpperCase();
  }

  if (required && !normalized) {
    throw createValidationError(`"${fieldName}" is required`);
  }

  return normalized;
}

function normalizeBoolean(value, fieldName) {
  if (value == null) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw createValidationError(`"${fieldName}" must be a boolean`);
  }

  return value;
}

function normalizePositiveInteger(value, fieldName, { required = false, max = null } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw createValidationError(`"${fieldName}" is required`);
    }
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createValidationError(`"${fieldName}" must be a positive integer`);
  }

  if (max != null && parsed > max) {
    throw createValidationError(`"${fieldName}" exceeds the allowed maximum`);
  }

  return parsed;
}

function normalizeIdentifier(value, fieldName, options = {}) {
  const parsed = normalizePositiveInteger(value, fieldName, options);
  return parsed == null ? null : String(parsed);
}

function normalizeEntityIdentifier(value, fieldName, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) {
      throw createValidationError(`"${fieldName}" is required`);
    }
    return '';
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw createValidationError(`"${fieldName}" must be a string`);
  }

  const normalized = String(value).trim();
  if (required && !normalized) {
    throw createValidationError(`"${fieldName}" is required`);
  }

  if (!normalized) {
    return '';
  }

  return normalized;
}

function normalizeOption(option, index) {
  const fieldName = `items[${index}].selectedOptions[]`;
  assertPlainObject(option, fieldName);
  assertStrictKeys(option, ['optionValueId'], fieldName);

  return {
    optionValueId: normalizeIdentifier(option.optionValueId, `${fieldName}.optionValueId`, { required: true }),
  };
}

function normalizeItem(item, index) {
  const fieldName = `items[${index}]`;
  assertPlainObject(item, fieldName);
  assertStrictKeys(item, ['productId', 'variantId', 'quantity', 'selectedOptions'], fieldName);

  const selectedOptions = item.selectedOptions == null
    ? []
    : Array.isArray(item.selectedOptions)
      ? item.selectedOptions.map((entry) => normalizeOption(entry, index))
      : (() => {
          throw createValidationError(`"${fieldName}.selectedOptions" must be an array`);
        })();

  return {
    productId: normalizeEntityIdentifier(item.productId, `${fieldName}.productId`, { required: true }),
    variantId: normalizeEntityIdentifier(item.variantId, `${fieldName}.variantId`),
    quantity: normalizePositiveInteger(item.quantity, `${fieldName}.quantity`, { required: true, max: 50 }),
    selectedOptions,
  };
}

function normalizeAddress(address, fieldName, { includeShippingOption = false } = {}) {
  assertPlainObject(address, fieldName);

  const allowedKeys = [
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
    'googleValidatedAddress',
  ];

  if (includeShippingOption) {
    allowedKeys.push('selectedShippingOptionId');
  }

  assertStrictKeys(address, allowedKeys, fieldName);

  const normalized = {
    addressLine1: normalizeString(address.addressLine1, `${fieldName}.addressLine1`),
    addressLine2: normalizeString(address.addressLine2, `${fieldName}.addressLine2`),
    city: normalizeString(address.city, `${fieldName}.city`),
    state: normalizeString(address.state, `${fieldName}.state`),
    postalCode: normalizeString(address.postalCode, `${fieldName}.postalCode`),
    country: normalizeString(address.country || 'US', `${fieldName}.country`, { uppercase: true }),
    googleValidatedAddress: normalizeBoolean(address.googleValidatedAddress, `${fieldName}.googleValidatedAddress`),
  };

  if (includeShippingOption) {
    normalized.selectedShippingOptionId = normalizeString(
      address.selectedShippingOptionId,
      `${fieldName}.selectedShippingOptionId`
    );
  }

  return normalized;
}

function normalizeCustomer(customer) {
  assertPlainObject(customer, 'customer');
  assertStrictKeys(customer, ['name', 'email', 'phone'], 'customer');

  return {
    name: normalizeString(customer.name, 'customer.name'),
    email: normalizeString(customer.email, 'customer.email', { lowercase: true }),
    phone: normalizeString(customer.phone, 'customer.phone'),
  };
}

function sanitize(payload) {
  if (payload == null) {
    return {};
  }

  assertPlainObject(payload, 'payload');
  assertStrictKeys(payload, [
    'items',
    'customer',
    'shipping',
    'billing',
    'paymentIntentId',
    'discountCode',
    'checkoutSessionToken',
    'orderId',
  ], 'payload');

  const normalized = {};

  if (payload.items != null) {
    if (!Array.isArray(payload.items)) {
      throw createValidationError('"items" must be an array');
    }
    normalized.items = payload.items.map((item, index) => normalizeItem(item, index));
  }

  if (payload.customer != null) {
    normalized.customer = normalizeCustomer(payload.customer);
  }

  if (payload.shipping != null) {
    normalized.shipping = normalizeAddress(payload.shipping, 'shipping', { includeShippingOption: true });
  }

  if (payload.billing != null) {
    normalized.billing = normalizeAddress(payload.billing, 'billing');
  }

  if (payload.paymentIntentId != null) {
    normalized.paymentIntentId = normalizeString(payload.paymentIntentId, 'paymentIntentId');
  }

  if (payload.discountCode != null) {
    normalized.discountCode = normalizeString(payload.discountCode, 'discountCode', { uppercase: true });
  }

  if (payload.checkoutSessionToken != null) {
    normalized.checkoutSessionToken = normalizeString(payload.checkoutSessionToken, 'checkoutSessionToken');
  }

  if (payload.orderId != null) {
    normalized.orderId = normalizePositiveInteger(payload.orderId, 'orderId');
  }

  return normalized;
}

module.exports = {
  createValidationError,
  sanitize,
};
