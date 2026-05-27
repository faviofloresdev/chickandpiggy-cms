const crypto = require('crypto');

const DEFAULT_TTL_MS = Number.parseInt(process.env.CHECKOUT_SESSION_TTL_MS || `${15 * 60 * 1000}`, 10) || 15 * 60 * 1000;

function getSessionSecret() {
  return (
    process.env.CHECKOUT_SESSION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.APP_KEYS?.split(',').map((key) => key.trim()).find(Boolean) ||
    null
  );
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function normalizeString(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeItems(items = []) {
  return items
    .map((item) => ({
      productId: String(item.productId || ''),
      variantId: String(item.variantId || ''),
      quantity: Number(item.quantity) || 0,
      selectedOptions: Array.isArray(item.selectedOptions)
        ? item.selectedOptions
            .map((option) => String(option.optionValueId || ''))
            .filter(Boolean)
            .sort()
        : [],
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function buildScope(payload = {}) {
  return {
    items: normalizeItems(payload.items || []),
    shipping: {
      addressLine1: normalizeString(payload.shipping?.addressLine1),
      city: normalizeString(payload.shipping?.city),
      state: normalizeString(payload.shipping?.state),
      postalCode: normalizeString(payload.shipping?.postalCode),
      country: normalizeString(payload.shipping?.country || 'us'),
    },
  };
}

function signPayload(serializedPayload, secret) {
  return base64UrlEncode(
    crypto.createHmac('sha256', secret).update(serializedPayload).digest()
  );
}

function createCheckoutSessionToken(payload, options = {}) {
  const secret = getSessionSecret();
  if (!secret) {
    const err = new Error('Checkout session secret not configured');
    err.status = 503;
    err.code = 'CHECKOUT_SESSION_SECRET_MISSING';
    throw err;
  }

  const now = Date.now();
  const body = {
    scope: buildScope(payload),
    issuedAt: now,
    expiresAt: now + (options.ttlMs || DEFAULT_TTL_MS),
  };

  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signature = signPayload(encodedBody, secret);
  return `${encodedBody}.${signature}`;
}

function verifyCheckoutSessionToken(token, payload) {
  const secret = getSessionSecret();
  if (!secret) {
    const err = new Error('Checkout session secret not configured');
    err.status = 503;
    err.code = 'CHECKOUT_SESSION_SECRET_MISSING';
    throw err;
  }

  const [encodedBody, signature] = String(token || '').split('.');
  if (!encodedBody || !signature) {
    const err = new Error('Checkout session token is invalid');
    err.status = 403;
    err.code = 'CHECKOUT_SESSION_INVALID';
    throw err;
  }

  const expectedSignature = signPayload(encodedBody, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    const err = new Error('Checkout session signature mismatch');
    err.status = 403;
    err.code = 'CHECKOUT_SESSION_INVALID';
    throw err;
  }

  let body;
  try {
    body = JSON.parse(base64UrlDecode(encodedBody));
  } catch (error) {
    const err = new Error('Checkout session payload is malformed');
    err.status = 403;
    err.code = 'CHECKOUT_SESSION_INVALID';
    throw err;
  }

  if (!body?.expiresAt || Date.now() > Number(body.expiresAt)) {
    const err = new Error('Checkout session has expired');
    err.status = 403;
    err.code = 'CHECKOUT_SESSION_EXPIRED';
    throw err;
  }

  const expectedScope = buildScope(payload);
  if (JSON.stringify(body.scope) !== JSON.stringify(expectedScope)) {
    const err = new Error('Checkout session does not match this cart');
    err.status = 403;
    err.code = 'CHECKOUT_SESSION_SCOPE_MISMATCH';
    throw err;
  }

  return body;
}

module.exports = {
  buildScope,
  createCheckoutSessionToken,
  verifyCheckoutSessionToken,
};
