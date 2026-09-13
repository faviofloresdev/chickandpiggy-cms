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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function maskEmail(email) {
  const [localPart, domain] = String(email || '').split('@');
  if (!localPart || !domain) return '';
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${'•'.repeat(Math.max(3, localPart.length - visible.length))}@${domain}`;
}

function renderPage({ title, message, token, confirm = false }) {
  const form = confirm
    ? `<form method="post" action="/api/newsletter-subscriptions/unsubscribe" style="margin:28px 0 0">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit" style="display:inline-block;padding:14px 22px;border:0;background:#9277cc;color:#fff;font:700 14px Arial,sans-serif;cursor:pointer">Unsubscribe</button>
      </form>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#fdfaf8;color:#2d2a32;font-family:Arial,Helvetica,sans-serif">
  <main style="max-width:560px;margin:48px auto;padding:0 20px">
    <section style="background:#fff;border:1px solid #eee7e2;padding:36px">
      <p style="margin:0 0 30px;font:22px Georgia,serif">Chick &amp; Piggy</p>
      <h1 style="margin:0 0 16px;font:normal 34px/1.2 Georgia,serif">${escapeHtml(title)}</h1>
      <p style="margin:0;color:#56515b;font-size:16px;line-height:1.7">${escapeHtml(message)}</p>
      ${form}
    </section>
  </main>
</body></html>`;
}

function sendHtml(ctx, status, html) {
  ctx.set('Cache-Control', 'no-store');
  ctx.status = status;
  ctx.type = 'html';
  ctx.body = html;
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

  async confirmUnsubscribe(ctx) {
    const token = String(ctx.query?.token || '').trim();
    try {
      const subscription = await strapi
        .service('api::newsletter-subscription.newsletter-subscription')
        .getUnsubscribeTarget(token);
      sendHtml(ctx, 200, renderPage({
        title: 'Unsubscribe from emails?',
        message: `${maskEmail(subscription.email)} will stop receiving Chick & Piggy marketing emails.`,
        token,
        confirm: true,
      }));
    } catch (err) {
      sendHtml(ctx, err.status || 400, renderPage({
        title: 'This link is no longer valid',
        message: 'The unsubscribe link may be outdated. Contact us if you still need help.',
      }));
    }
  },

  async unsubscribe(ctx) {
    const token = String(ctx.request.body?.token || '').trim();
    try {
      const result = await strapi
        .service('api::newsletter-subscription.newsletter-subscription')
        .unsubscribe(token);

      if (String(ctx.get('content-type')).includes('application/json')) {
        ctx.status = 200;
        ctx.body = { ok: true, status: result.status, changed: result.changed };
        return;
      }

      sendHtml(ctx, 200, renderPage({
        title: 'You’re unsubscribed',
        message: `${maskEmail(result.email)} will no longer receive Chick & Piggy marketing emails.`,
      }));
    } catch (err) {
      if (String(ctx.get('content-type')).includes('application/json')) {
        ctx.status = err.status || 400;
        ctx.body = { ok: false, error: err.message || 'Unable to unsubscribe' };
        return;
      }

      sendHtml(ctx, err.status || 400, renderPage({
        title: 'We couldn’t update your preference',
        message: 'The unsubscribe link may be outdated. Contact us if you still need help.',
      }));
    }
  },
};
