const net = require('net');

const memoryStore = new Map();
const redisState = {
  attempted: false,
  available: false,
  config: null,
};

function getLogger() {
  return global.strapi?.log;
}

function toNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRedisConfig() {
  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) {
    return null;
  }

  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      timeoutMs: toNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, 1000),
    };
  } catch (error) {
    getLogger()?.warn?.(`Invalid REDIS_URL. Falling back to memory cache. ${error.message}`);
    return null;
  }
}

async function pingRedis(config) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Redis ping timed out'));
    }, config.timeoutMs);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function ensureRedisState() {
  if (redisState.attempted) {
    return redisState.available;
  }

  redisState.attempted = true;
  const config = getRedisConfig();
  if (!config) {
    return false;
  }

  try {
    await pingRedis(config);
    redisState.available = true;
    redisState.config = config;
    getLogger()?.info?.('Shipping cache Redis detected. Using Redis-aware mode when a client is available.');
  } catch (error) {
    getLogger()?.warn?.(`Redis unavailable for shipping cache. Falling back to memory cache. ${error.message}`);
    redisState.available = false;
  }

  return redisState.available;
}

function readMemoryEntry(key) {
  const cached = memoryStore.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return cached.value;
}

function writeMemoryEntry(key, value, ttlMs) {
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function encodeBulk(value) {
  const stringValue = String(value);
  return `$${Buffer.byteLength(stringValue)}\r\n${stringValue}\r\n`;
}

function encodeCommand(parts) {
  return `*${parts.length}\r\n${parts.map(encodeBulk).join('')}`;
}

function parseRedisResponse(raw) {
  if (!raw) {
    return null;
  }

  const type = raw[0];
  if (type === '+') {
    return raw.slice(1).split('\r\n')[0];
  }

  if (type === ':') {
    return Number.parseInt(raw.slice(1).split('\r\n')[0], 10);
  }

  if (type === '$') {
    const lengthLineEnd = raw.indexOf('\r\n');
    const length = Number.parseInt(raw.slice(1, lengthLineEnd), 10);
    if (length === -1) {
      return null;
    }

    return raw.slice(lengthLineEnd + 2, lengthLineEnd + 2 + length);
  }

  if (type === '-') {
    throw new Error(raw.slice(1).split('\r\n')[0]);
  }

  return null;
}

async function sendRedisCommand(parts) {
  const config = redisState.config;
  if (!config) {
    throw new Error('Redis is not configured');
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Redis command timed out'));
    }, config.timeoutMs);
    let buffer = '';
    let authenticated = !config.password;

    function cleanup() {
      clearTimeout(timeout);
      socket.end();
    }

    function writeCommand(commandParts) {
      socket.write(encodeCommand(commandParts));
    }

    socket.on('connect', () => {
      if (config.password) {
        const authParts = config.username
          ? ['AUTH', config.username, config.password]
          : ['AUTH', config.password];
        writeCommand(authParts);
      } else {
        writeCommand(parts);
      }
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      try {
        const parsed = parseRedisResponse(buffer);
        if (!authenticated) {
          authenticated = true;
          buffer = '';
          writeCommand(parts);
          return;
        }

        cleanup();
        resolve(parsed);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    socket.on('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

module.exports = {
  async get(key) {
    await ensureRedisState();
    if (redisState.available) {
      try {
        const raw = await sendRedisCommand(['GET', key]);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        getLogger()?.warn?.(`Redis GET failed for shipping cache. Falling back to memory. ${error.message}`);
      }
    }

    return readMemoryEntry(key);
  },

  async set(key, value, ttlMs) {
    await ensureRedisState();
    if (redisState.available) {
      try {
        await sendRedisCommand(['SET', key, JSON.stringify(value), 'PX', String(ttlMs)]);
        return value;
      } catch (error) {
        getLogger()?.warn?.(`Redis SET failed for shipping cache. Falling back to memory. ${error.message}`);
      }
    }

    writeMemoryEntry(key, value, ttlMs);
    return value;
  },

  async del(key) {
    if (redisState.available) {
      try {
        await sendRedisCommand(['DEL', key]);
      } catch (error) {
        getLogger()?.warn?.(`Redis DEL failed for shipping cache. ${error.message}`);
      }
    }

    memoryStore.delete(key);
  },

  async remember(key, ttlMs, factory) {
    const cached = await this.get(key);
    if (cached != null) {
      return { value: cached, cacheHit: true };
    }

    const value = await factory();
    await this.set(key, value, ttlMs);
    return { value, cacheHit: false };
  },
};
