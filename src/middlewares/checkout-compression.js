'use strict';

const zlib = require('zlib');

function shouldCompress(ctx, body) {
  if (!ctx.path.startsWith('/api/checkout')) {
    return false;
  }

  if (!body || Buffer.isBuffer(body) || typeof body === 'string') {
    return false;
  }

  const acceptEncoding = String(ctx.request.headers['accept-encoding'] || '');
  return /\bbr\b|\bgzip\b/i.test(acceptEncoding);
}

module.exports = () => {
  return async (ctx, next) => {
    await next();

    if (!shouldCompress(ctx, ctx.body)) {
      return;
    }

    const raw = Buffer.from(JSON.stringify(ctx.body));
    const acceptEncoding = String(ctx.request.headers['accept-encoding'] || '').toLowerCase();
    const useBrotli = acceptEncoding.includes('br');
    const compressed = useBrotli ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw);

    ctx.set('Content-Encoding', useBrotli ? 'br' : 'gzip');
    ctx.set('Content-Type', 'application/json; charset=utf-8');
    ctx.set('Vary', 'Accept-Encoding');
    ctx.body = compressed;
  };
};
