const allProviders = [
  require('./shipping/providers/fedex'),
  require('./shipping/providers/ups'),
  require('./shipping/providers/usps'),
];
const cacheStore = require('./shipping/cacheStore');
const { buildRateFingerprint, buildServiceFingerprint } = require('./shipping/fingerprint');
const { buildHighlights } = require('./shipping/quoteSelection');

const inFlightRateRequests = new Map();
const RATE_CACHE_TTL_MS = Number.parseInt(process.env.SHIPPING_RATE_CACHE_TTL_MS || `${30 * 60 * 1000}`, 10) || 30 * 60 * 1000;

function formatProviderError(reason) {
  if (!reason) {
    return 'Unknown carrier error';
  }

  const baseMessage = reason.message || String(reason);
  const detailText =
    typeof reason.details === 'string'
      ? reason.details
      : reason.details
        ? JSON.stringify(reason.details)
        : '';

  if (!detailText) {
    return baseMessage;
  }

  const compactDetails = detailText.replace(/\s+/g, ' ').trim().slice(0, 400);
  return `${baseMessage} | details: ${compactDetails}`;
}

function filterBestRates(rates, requestFingerprint) {
  const byService = new Map();

  for (const rate of rates) {
    const amount = Number(rate?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const key = `${String(rate?.carrier || '').trim().toLowerCase()}::${String(rate?.service || '').trim().toLowerCase()}`;
    const existing = byService.get(key);
    if (!existing || amount < existing.amount) {
      byService.set(key, {
        ...rate,
        amount,
        fingerprint: buildServiceFingerprint({
          requestFingerprint,
          carrier: rate?.carrier,
          service: rate?.service,
        }),
      });
    }
  }

  const deduped = Array.from(byService.values()).sort((a, b) => {
    const amountDelta = a.amount - b.amount;
    if (amountDelta !== 0) {
      return amountDelta;
    }

    return (a.estimatedDays || 999) - (b.estimatedDays || 999);
  });

  return buildHighlights(deduped);
}

async function getOrigin() {
  const origin = await strapi.service('api::shipping-origin.shipping-origin').getActiveOrigin();

  return {
    city: origin.city,
    state: origin.state,
    postalCode: origin.postalCode,
    country: origin.country,
    label: origin.label,
  };
}

module.exports = {
  getOrigin,
  async enqueueLabelCreation({ orderId }) {
    return strapi.service('api::checkout.checkout').enqueueLabelCreation({ orderId });
  },

  // payload: { origin, destination, items }
  async getRates(payload) {
    const { fingerprint, packageSnapshot } = buildRateFingerprint(payload);
    const cacheKey = `shipping:rates:${fingerprint}`;
    const cached = await cacheStore.get(cacheKey);
    if (cached) {
      strapi.log.info(`Shipping quote cache hit. fingerprint=${fingerprint}`);
      return {
        ...cached,
        cacheHit: true,
      };
    }

    if (inFlightRateRequests.has(cacheKey)) {
      strapi.log.info(`Shipping quote deduplicated. fingerprint=${fingerprint}`);
      return inFlightRateRequests.get(cacheKey);
    }

    const requestPromise = (async () => {
      const providers = allProviders.filter((provider) => {
        if (typeof provider.isConfigured !== 'function') {
          return true;
        }

        const configured = provider.isConfigured();
        if (!configured) {
          strapi.log.info(`Carrier provider skipped: ${provider.name || 'unknown'} is not configured`);
        }

        return configured;
      });

      if (providers.length === 0) {
        const err = new Error('No shipping carriers are configured');
        err.status = 503;
        throw err;
      }

      const quoteStartedAt = Date.now();
      const calls = providers.map((provider) =>
        Promise.resolve()
          .then(async () => {
            const providerStartedAt = Date.now();
            const rates = await provider.getRates(payload);
            strapi.log.info(
              `Carrier response time. carrier=${provider.name || 'unknown'} durationMs=${Date.now() - providerStartedAt} rates=${Array.isArray(rates) ? rates.length : 0}`
            );
            return rates;
          })
          .then((rates) => ({
            provider: provider.name || 'unknown',
            rates,
          }))
          .catch((error) => {
            const wrapped = new Error(error?.message || 'Carrier provider failed');
            wrapped.providerName = provider.name || 'unknown';
            wrapped.cause = error;
            wrapped.details = error?.details;
            throw wrapped;
          })
      );
      const settled = await Promise.allSettled(calls);
      const rates = [];
      const failures = [];
      for (const s of settled) {
        if (s.status === 'fulfilled' && Array.isArray(s.value?.rates)) {
          rates.push(...s.value.rates);
        } else if (s.status === 'rejected') {
          const providerName = s.reason?.providerName || 'unknown';
          const formatted = formatProviderError(s.reason?.cause || s.reason);
          failures.push(`${providerName}: ${formatted}`);
          strapi.log.warn(`Carrier provider failed: ${providerName}. ${formatted}`);
        }
      }

      if (rates.length === 0) {
        const detailSuffix = failures.length ? ` Failures: ${failures.join(' || ')}` : '';
        const err = new Error(`No shipping rates returned by carriers.${detailSuffix}`);
        err.status = 502;
        throw err;
      }

      const highlights = filterBestRates(rates, fingerprint);
      const response = {
        fingerprint,
        packageSnapshot,
        shippingOptions: highlights.options,
        shippingHighlights: {
          cheapest: highlights.cheapest,
          fastest: highlights.fastest,
          recommended: highlights.recommended,
        },
        cacheHit: false,
        durationMs: Date.now() - quoteStartedAt,
      };

      await cacheStore.set(cacheKey, response, RATE_CACHE_TTL_MS);
      strapi.log.info(
        `Shipping rates resolved. fingerprint=${fingerprint} received=${rates.length} returned=${highlights.options.length} durationMs=${response.durationMs}`
      );

      return response;
    })();

    inFlightRateRequests.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      inFlightRateRequests.delete(cacheKey);
    }
  },
};
