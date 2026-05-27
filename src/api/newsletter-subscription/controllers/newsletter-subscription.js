'use strict';

const rateLimitStore = new Map();

function getClientIp(ctx) {
  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return ctx.request.ip || ctx.ip || 'unknown';
}

function isAuthorized(ctx) {
  const expectedToken = process.env.NEWSLETTER_SUBSCRIPTION_TOKEN;
  if (!expectedToken) {
    return true;
  }

  const authHeader = String(ctx.request.headers.authorization || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerToken = String(ctx.request.headers['x-newsletter-token'] || '').trim();

  return bearerToken === expectedToken || headerToken === expectedToken;
}

function checkRateLimit(ctx) {
  const maxRequests = Number.parseInt(process.env.NEWSLETTER_RATE_LIMIT_MAX || '10', 10);
  const windowMs = Number.parseInt(process.env.NEWSLETTER_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10);
  const now = Date.now();
  const key = getClientIp(ctx);
  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return null;
  }

  if (current.count >= maxRequests) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }

  current.count += 1;
  return null;
}

module.exports = {
  async subscribe(ctx) {
    try {
      if (!isAuthorized(ctx)) {
        ctx.status = 401;
        ctx.body = { ok: false, error: 'Unauthorized' };
        return;
      }

      if (!process.env.NEWSLETTER_SUBSCRIPTION_TOKEN) {
        const retryAfterSeconds = checkRateLimit(ctx);
        if (retryAfterSeconds) {
          ctx.set('Retry-After', String(retryAfterSeconds));
          ctx.status = 429;
          ctx.body = { ok: false, error: 'Too many requests' };
          return;
        }
      }

      const payload = ctx.request.body?.data && typeof ctx.request.body.data === 'object'
        ? ctx.request.body.data
        : ctx.request.body;

      const result = await strapi
        .service('api::newsletter-subscription.newsletter-subscription')
        .subscribe(payload);

      ctx.status = result.statusCode;
      ctx.body = result.body;
    } catch (err) {
      ctx.status = err.status || 400;
      ctx.body = {
        ok: false,
        error: err.message || 'Unable to subscribe to newsletter',
      };
      strapi.log.error('newsletter-subscription.subscribe error', err);
    }
  },
};
