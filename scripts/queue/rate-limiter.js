const crypto = require('node:crypto');
const { getCacheConnection } = require('./redis-client');
const { PROVIDER_LIMITS } = require('./config');

// Per-request leases expire after a crashed worker; releases cannot affect other requests.
const ACQUIRE = `
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local rate = tonumber(ARGV[3])
local maximum = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local inflight = redis.call('ZCARD', KEYS[2])
local cooldown = tonumber(redis.call('HGET', KEYS[1], 'cooldownUntil') or 0)
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or capacity)
local last = tonumber(redis.call('HGET', KEYS[1], 'lastRefill') or now)
tokens = math.min(capacity, tokens + math.max(0, now-last)/1000*rate)
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'lastRefill', now)
redis.call('PEXPIRE', KEYS[1], math.max(86400000,cooldown-now+60000))
if cooldown > now then return {0,cooldown-now,tostring(tokens),inflight,cooldown} end
if inflight >= maximum then return {0,1000,tostring(tokens),inflight,cooldown} end
if tokens < 1 then return {0,math.ceil((1-tokens)/rate*1000),tostring(tokens),inflight,cooldown} end
tokens = tokens-1
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens))
redis.call('ZADD', KEYS[2], now+tonumber(ARGV[6]), ARGV[5])
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6])*2)
return {1,0,tostring(tokens),inflight+1,cooldown}
`;
const COOLDOWN = `
local untilTime = math.max(tonumber(ARGV[1]),tonumber(redis.call('HGET',KEYS[1],'cooldownUntil') or 0))
redis.call('HSET',KEYS[1],'cooldownUntil',untilTime)
redis.call('PEXPIRE',KEYS[1],math.max(86400000,untilTime-tonumber(ARGV[2])+60000))
return untilTime
`;
class ProviderRateLimiter {
  constructor({ connection = getCacheConnection, now = Date.now, leaseMs = 60000 } = {}) {
    Object.assign(this, { connection, now, leaseMs });
  }
  _key(name) {
    if (!PROVIDER_LIMITS[name]) throw Error('Unknown provider limiter');
    return `ratelimit:{${name}}`;
  }
  async acquire(name) {
    if (!process.env.DATABASE_URL && !process.env.REDIS_HOST) {
      return { allowed: true, retryAfterMs: 0, tokens: 10, inFlight: 0, cooldownUntil: 0, leaseId: crypto.randomUUID() };
    }
    try {
      const config = PROVIDER_LIMITS[name], key = this._key(name), leaseId = crypto.randomUUID();
      const result = await this.connection().eval(ACQUIRE, 2, key, key+':leases',
        this.now(), config.burstCapacity, config.refillRate, config.concurrency, leaseId, this.leaseMs);
      return { allowed: Number(result[0]) === 1, retryAfterMs: Number(result[1]),
        tokens: Number(result[2]), inFlight: Number(result[3]), cooldownUntil: Number(result[4]),
        leaseId: Number(result[0]) === 1 ? leaseId : null };
    } catch (err) {
      if (!process.env.DATABASE_URL) {
        return { allowed: true, retryAfterMs: 0, tokens: 10, inFlight: 0, cooldownUntil: 0, leaseId: crypto.randomUUID() };
      }
      throw err;
    }
  }
  async release(name, leaseId) {
    if (!leaseId) return;
    try {
      return await this.connection().zrem(this._key(name)+':leases', leaseId);
    } catch (err) {
      if (!process.env.DATABASE_URL) return;
      throw err;
    }
  }
  async renew(name, leaseId) {
    if (!leaseId) return;
    try {
      return await this.connection().eval(`
        local deadline=redis.call('ZSCORE',KEYS[1],ARGV[1])
        if not deadline or tonumber(deadline)<=tonumber(ARGV[2]) then return 0 end
        redis.call('ZADD',KEYS[1],tonumber(ARGV[2])+tonumber(ARGV[3]),ARGV[1])
        redis.call('PEXPIRE',KEYS[1],tonumber(ARGV[3])*2)
        return 1
      `, 1, this._key(name)+':leases', leaseId, this.now(), this.leaseMs);
    } catch (err) {
      if (!process.env.DATABASE_URL) return 1;
      throw err;
    }
  }
  async setCooldown(name, durationMs, retryAfterMs) {
    try {
      const now = this.now();
      return await this.connection().eval(COOLDOWN, 1, this._key(name),
        now+Math.max(durationMs || PROVIDER_LIMITS[name].cooldownMs, retryAfterMs || 0), now);
    } catch (err) {
      if (!process.env.DATABASE_URL) return;
      throw err;
    }
  }
  async snapshot() {
    const redis = this.connection(), output = {};
    for (const [name, config] of Object.entries(PROVIDER_LIMITS)) {
      const key = this._key(name);
      await redis.zremrangebyscore(key+':leases', '-inf', this.now());
      const state = await redis.hgetall(key);
      output[name] = { ...config, tokens: Number(state.tokens ?? config.burstCapacity),
        inFlight: await redis.zcard(key+':leases'), cooldownUntil: Number(state.cooldownUntil || 0) };
    }
    return output;
  }
}
module.exports = { ProviderRateLimiter, rateLimiter: new ProviderRateLimiter() };
