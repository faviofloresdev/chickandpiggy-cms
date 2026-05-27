const { createValidationError } = require('../api/checkout/utils/validate');
const { recordSecurityMetric } = require('../api/checkout/utils/http');

const RATE_LIMIT_STORE = new Map();

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function getAllowedOrigins(env) {
  const configured = [
    ...parseList(env('PUBLIC_API_ALLOWED_ORIGINS')),
    env('FRONTEND_URL'),
    env('CLIENT_URL'),
    env('STORE_URL'),
    env('APP_URL'),
  ].filter(Boolean);

  return Array.from(new Set(configured));
}

function getClientIp(ctx) {
  return String(ctx.request.ip || ctx.ip || 'unknown');
}

function buildRateKey(ctx, rule) {
  const extraKey = typeof rule.key === 'function' ? rule.key(ctx) : '';
  return [rule.name, getClientIp(ctx), extraKey].filter(Boolean).join(':');
}

function consumeRateLimit(ctx, rule) {
  const key = buildRateKey(ctx, rule);
  const now = Date.now();
  const windowStart = now - rule.windowMs;
  const previous = RATE_LIMIT_STORE.get(key) || [];
  const next = previous.filter((timestamp) => timestamp > windowStart);
  next.push(now);
  RATE_LIMIT_STORE.set(key, next);

  ctx.set('X-RateLimit-Limit', String(rule.max));
  ctx.set('X-RateLimit-Remaining', String(Math.max(rule.max - next.length, 0)));
  ctx.set('X-RateLimit-Window-Ms', String(rule.windowMs));

  if (next.length > rule.max) {
    const err = new Error('Rate limit exceeded');
    err.status = 429;
    err.code = 'RATE_LIMITED';
    throw err;
  }
}

function assertAllowedOrigin(ctx, allowedOrigins) {
  const origin = ctx.get('origin');
  if (!origin) {
    const err = new Error('Missing Origin header');
    err.status = 403;
    err.code = 'ORIGIN_REQUIRED';
    throw err;
  }

  if (!allowedOrigins.includes(origin)) {
    const err = new Error(`Origin ${origin} is not allowed`);
    err.status = 403;
    err.code = 'ORIGIN_FORBIDDEN';
    throw err;
  }
}

function assertNoCookiesForPublicMutation(ctx) {
  if (!ctx.get('cookie')) {
    return;
  }

  const err = createValidationError('Cookie-backed requests are not supported for this endpoint');
  err.status = 403;
  err.code = 'COOKIE_NOT_ALLOWED';
  throw err;
}

function assertInternalToken(ctx, env) {
  const expected = env('CHECKOUT_INTERNAL_API_KEY');
  const provided = ctx.get('x-internal-api-key');

  if (!expected) {
    const err = new Error('Internal API key not configured');
    err.status = 503;
    err.code = 'INTERNAL_KEY_MISSING';
    throw err;
  }

  if (!provided || provided !== expected) {
    const err = new Error('Invalid internal API key');
    err.status = 403;
    err.code = 'INTERNAL_KEY_INVALID';
    throw err;
  }
}

function matchRule(rules, ctx) {
  return rules.find((rule) => {
    if (!rule.methods.includes(ctx.method)) {
      return false;
    }

    return rule.path.test(ctx.path);
  });
}

module.exports = (config, { strapi }) => {
  const allowedOrigins = getAllowedOrigins((key) => process.env[key] || '');
  const allowPublicDiscountLookup = parseBoolean(process.env.PUBLIC_DISCOUNT_LOOKUP_ENABLED, false);
  const allowLegacyStripeProxy = parseBoolean(process.env.PUBLIC_LEGACY_STRIPE_ENABLED, false);
  const allowPublicShippingOrigin = parseBoolean(process.env.PUBLIC_SHIPPING_ORIGIN_ENABLED, false);
  const rules = [
    {
      name: 'discount_lookup',
      path: /^\/api\/(checkout\/discount\/|discount\/|discounts\/code\/)/,
      methods: ['GET'],
      windowMs: 60 * 1000,
      max: 20,
      requireAllowedOrigin: true,
      enabled: allowPublicDiscountLookup,
      logContext: 'discount_lookup',
      key: (ctx) => ctx.params?.code || '',
    },
    {
      name: 'discount_apply',
      path: /^\/api\/(checkout\/discount|discount|discounts\/apply)$/,
      methods: ['POST'],
      windowMs: 60 * 1000,
      max: 10,
      requireAllowedOrigin: true,
      rejectCookies: true,
      logContext: 'discount_apply',
      key: (ctx) => ctx.request.body?.discountCode || '',
    },
    {
      name: 'checkout_quote',
      path: /^\/api\/checkout\/quote$/,
      methods: ['POST'],
      windowMs: 60 * 1000,
      max: 15,
      requireAllowedOrigin: true,
      rejectCookies: true,
      logContext: 'checkout_quote',
    },
    {
      name: 'payment_intent',
      path: /^\/api\/checkout\/payment-intent$/,
      methods: ['POST'],
      windowMs: 60 * 1000,
      max: 6,
      requireAllowedOrigin: true,
      rejectCookies: true,
      logContext: 'payment_intent',
    },
    {
      name: 'legacy_stripe_checkout',
      path: /^\/api\/stripe\/checkout$/,
      methods: ['POST'],
      windowMs: 60 * 1000,
      max: 6,
      requireAllowedOrigin: true,
      rejectCookies: true,
      enabled: allowLegacyStripeProxy,
      logContext: 'legacy_stripe_checkout',
    },
    {
      name: 'checkout_labels',
      path: /^\/api\/checkout\/labels$/,
      methods: ['POST'],
      windowMs: 60 * 1000,
      max: 5,
      requireInternalToken: true,
      logContext: 'checkout_labels',
    },
    {
      name: 'public_shipping_origin',
      path: /^\/api\/shipping-origins\/active$/,
      methods: ['GET'],
      windowMs: 60 * 1000,
      max: 15,
      requireAllowedOrigin: true,
      enabled: allowPublicShippingOrigin,
      logContext: 'public_shipping_origin',
    },
  ];

  return async (ctx, next) => {
    if (ctx.method === 'OPTIONS') {
      return next();
    }

    const rule = matchRule(rules, ctx);
    if (!rule) {
      return next();
    }

    try {
      if (rule.enabled === false) {
        const err = new Error('Endpoint is disabled');
        err.status = 404;
        err.code = 'ENDPOINT_DISABLED';
        throw err;
      }

      if (rule.requireAllowedOrigin) {
        assertAllowedOrigin(ctx, allowedOrigins);
      }

      if (rule.rejectCookies) {
        assertNoCookiesForPublicMutation(ctx);
      }

      if (rule.requireInternalToken) {
        assertInternalToken(ctx, (key) => process.env[key]);
      }

      consumeRateLimit(ctx, rule);
      recordSecurityMetric(`${rule.logContext}.accepted`, ctx);
      return next();
    } catch (err) {
      recordSecurityMetric(`${rule.logContext}.rejected`, ctx, {
        reason: err.code || err.message,
      });
      throw err;
    }
  };
};
