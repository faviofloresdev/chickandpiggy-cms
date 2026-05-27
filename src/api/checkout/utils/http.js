const SENSITIVE_KEYS = new Set([
  'email',
  'customerEmail',
  'phone',
  'customerPhone',
  'addressLine1',
  'addressLine2',
  'shippingAddress',
  'billingAddress',
  'postalCode',
]);

function maskString(value, { keepStart = 1, keepEnd = 1 } = {}) {
  const normalized = String(value || '');
  if (normalized.length <= keepStart + keepEnd) {
    return '*'.repeat(Math.max(normalized.length, 3));
  }

  return `${normalized.slice(0, keepStart)}***${normalized.slice(-keepEnd)}`;
}

function maskSensitiveValue(key, value) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    if (key === 'email' || key === 'customerEmail') {
      const [user, domain] = String(value).split('@');
      if (!domain) {
        return maskString(value);
      }
      return `${maskString(user, { keepStart: 1, keepEnd: 0 })}@${domain}`;
    }

    if (key === 'phone' || key === 'customerPhone') {
      return maskString(value, { keepStart: 0, keepEnd: 2 });
    }

    if (key === 'postalCode') {
      return maskString(value, { keepStart: 2, keepEnd: 0 });
    }

    return maskString(value, { keepStart: 1, keepEnd: 0 });
  }

  return '[redacted]';
}

function maskPayload(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => maskPayload(entry));
  }

  if (!value || typeof value !== 'object') {
    return SENSITIVE_KEYS.has(key) ? maskSensitiveValue(key, value) : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => {
      if (SENSITIVE_KEYS.has(entryKey)) {
        return [entryKey, maskSensitiveValue(entryKey, entryValue)];
      }

      return [entryKey, maskPayload(entryValue, entryKey)];
    })
  );
}

function toInternalErrorLog(err) {
  return {
    message: err?.message || 'Unknown error',
    status: err?.status || 500,
    code: err?.code || null,
    details: err?.details || null,
    stack: err?.stack || null,
  };
}

function getPublicErrorMessage(err) {
  const status = err?.status || 500;

  if (status === 400) {
    return 'Invalid request payload.';
  }
  if (status === 403) {
    return 'Request not allowed.';
  }
  if (status === 404) {
    return 'Requested resource was not found.';
  }
  if (status === 429) {
    return 'Too many requests. Please try again later.';
  }
  if (status >= 500) {
    return 'Unable to process the request right now.';
  }

  return 'Request could not be completed.';
}

function respondWithSanitizedError(ctx, err, context, payload) {
  ctx.status = err?.status || 500;
  ctx.body = { error: getPublicErrorMessage(err) };

  if (process.env.NODE_ENV !== 'production') {
    ctx.body.debug = {
      message: err?.message || 'Unknown error',
      code: err?.code || null,
      details: err?.details || null,
    };
  }

  const logPayload = payload ? { payload: maskPayload(payload) } : {};
  strapi.log.error(
    `${context} ${JSON.stringify({
      ...logPayload,
      error: toInternalErrorLog(err),
    })}`
  );
}

function recordSecurityMetric(event, ctxOrMeta, details = {}) {
  const isContextObject = typeof ctxOrMeta?.get === 'function' || ctxOrMeta?.request;
  const ctx = isContextObject ? ctxOrMeta : null;
  const meta = ctx ? details : ctxOrMeta || {};

  strapi.log.warn(
    `security.metric ${JSON.stringify({
      event,
      path: ctx?.path || meta.path || null,
      method: ctx?.method || meta.method || null,
      ip: ctx?.request?.ip || meta.ip || null,
      userAgent: ctx ? ctx.get('user-agent') || null : meta.userAgent || null,
      origin: ctx ? ctx.get('origin') || null : meta.origin || null,
      ...meta,
    })}`
  );
}

module.exports = {
  maskPayload,
  recordSecurityMetric,
  respondWithSanitizedError,
};
