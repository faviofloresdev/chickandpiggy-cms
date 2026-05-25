const tokenCache = new Map();
const metadataRequestCache = new Map();

function getLogger() {
  return global.strapi?.log;
}

function buildUrl(url, query = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      target.searchParams.set(key, String(value));
    }
  }
  return target.toString();
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await response.json().catch(() => null) : await response.text().catch(() => '');

  if (!response.ok) {
    const error = new Error(`Carrier request failed with status ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number.parseInt(process.env.CARRIER_HTTP_TIMEOUT_MS || '15000', 10) || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    getLogger()?.info?.(
      `Carrier HTTP request completed. method=${options.method || 'GET'} durationMs=${Date.now() - startedAt} url=${url}`
    );
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Carrier request timed out after ${timeoutMs}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }

    getLogger()?.warn?.(
      `Carrier HTTP request failed. method=${options.method || 'GET'} durationMs=${Date.now() - startedAt} url=${url} error=${error.message}`
    );
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(error) {
  const status = Number(error?.status);
  return !status || status >= 500 || status === 429 || status === 408 || status === 504;
}

async function withRetry(fn, { retryKey = 'carrier-request' } = {}) {
  const maxRetries = Number.parseInt(process.env.CARRIER_HTTP_MAX_RETRIES || '2', 10) || 2;
  const baseDelayMs = Number.parseInt(process.env.CARRIER_HTTP_RETRY_BASE_MS || '300', 10) || 300;
  const errors = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      errors.push(error);
      const retryable = shouldRetry(error);
      if (attempt >= maxRetries || !retryable) {
        error.retryAttempts = attempt;
        throw error;
      }

      const delayMs = baseDelayMs * (2 ** attempt);
      getLogger()?.warn?.(
        `Retrying carrier request. key=${retryKey} attempt=${attempt + 1} delayMs=${delayMs} error=${error.message}`
      );
      await sleep(delayMs);
    }
  }

  throw errors[errors.length - 1];
}

async function postJson(url, payload, { headers = {}, retryKey } = {}) {
  return withRetry(async () => {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
    });

    return parseResponse(response);
  }, { retryKey: retryKey || url });
}

async function postForm(url, formData, { headers = {}, retryKey } = {}) {
  return withRetry(async () => {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...headers,
      },
      body: new URLSearchParams(formData).toString(),
    });

    return parseResponse(response);
  }, { retryKey: retryKey || url });
}

async function getJson(url, { headers = {}, query = {}, retryKey } = {}) {
  return withRetry(async () => {
    const response = await fetchWithTimeout(buildUrl(url, query), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });

    return parseResponse(response);
  }, { retryKey: retryKey || buildUrl(url, query) });
}

function shouldReuseToken(cached) {
  return cached && cached.token && cached.expiresAt && cached.expiresAt > Date.now() + 60_000;
}

async function getCachedToken(cacheKey, factory) {
  const cached = tokenCache.get(cacheKey);
  if (shouldReuseToken(cached)) {
    return cached.token;
  }

  const tokenData = await factory();
  const expiresInSeconds = Number(tokenData.expires_in || tokenData.expiresIn || 3600);
  const nextValue = {
    token: tokenData.access_token || tokenData.accessToken,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  tokenCache.set(cacheKey, nextValue);
  return nextValue.token;
}

async function getCachedMetadata(cacheKey, factory) {
  const cached = metadataRequestCache.get(cacheKey);
  const ttlMs = Number.parseInt(process.env.SHIPPING_METADATA_CACHE_TTL_MS || `${24 * 60 * 60 * 1000}`, 10)
    || 24 * 60 * 60 * 1000;

  if (cached?.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await factory();
  metadataRequestCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

module.exports = {
  getCachedMetadata,
  getCachedToken,
  getJson,
  postForm,
  postJson,
};
