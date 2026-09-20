const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function decrypt(value, keyFn) {
  const masterKey = typeof keyFn === "function" ? keyFn() : keyFn;
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

class KeyPool {
  constructor({ apiKeysPath, keyFn, env }) {
    this.apiKeysPath = apiKeysPath;
    this.keyFn = keyFn;
    this.env = env || {};
    this.pools = new Map();
    this.usagePath = apiKeysPath ? apiKeysPath + '.usage.json' : null;
    this.metrics = {};
    try { this.metrics = JSON.parse(fs.readFileSync(this.usagePath, 'utf8')); } catch {}
    this.reload();
    this.lastReload = Date.now();
    this._writeTimer = null;
  }

  _scheduleWrite() {
    if (!this.usagePath) return;
    for (const pool of this.pools.values()) for (const entry of pool) {
      const fields = ['requestCount', 'successCount', 'month', 'monthlyRequests', 'monthlySuccesses', 'trackedSince', 'lastUsedAt', 'cooldownUntil', 'consecutiveErrors', 'lastStatus', 'lastErrorAt', 'configuredLimit', 'configuredExpiry'];
      this.metrics[entry.metricId] = Object.fromEntries(fields.map(field => [field, entry[field]]));
    }
    const temp = this.usagePath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.metrics), { mode: 0o600 });
    fs.renameSync(temp, this.usagePath);
    return;
  }

  reload() {
    this.pools.clear();
    const now = Date.now();

    // 1. Vault key'lerini oku ve deşifre et (varsa)
    if (this.apiKeysPath) {
      try {
        const state = JSON.parse(fs.readFileSync(this.apiKeysPath, "utf8"));
        for (const item of state.keys || []) {
          if (!item.provider || !item.encrypted) continue;
          let secret;
          try { secret = decrypt(item.encrypted, this.keyFn); } catch { continue; }

          const pool = this.pools.get(item.provider) || [];
          pool.push({
            keyId: item.id,
            secret,
            label: item.label || "",
            source: "vault",
            active: item.active !== false,
            monthlyLimit: Number(item.monthlyLimit || 0),
            requestCount: Number(item.requestCount || 0),
            successCount: Number(item.successCount || 0),
            lastUsedAt: item.lastUsedAt != null ? Number(item.lastUsedAt) : null,
            cooldownUntil: item.cooldownUntil != null ? Number(item.cooldownUntil) : null,
            expiresAt: item.expiresAt != null ? Number(item.expiresAt) : null,
            consecutiveErrors: Number(item.consecutiveErrors || 0),
          });
          this.pools.set(item.provider, pool);
        }
      } catch {}
    }

    // 2. .env fallback key'lerini ekle (vault'ta yoksa)
    const envMappings = [
      ["Helius", this.env.HELIUS_API_KEY],
      ["Etherscan", this.env.ETHERSCAN_API_KEY],
      ["Bitquery", this.env.BITQUERY_ACCESS_TOKEN, Date.parse(this.env.BITQUERY_FREE_TRIAL_UNTIL || "") || null],
    ];

    for (const mapping of envMappings) {
      const provider = mapping[0];
      const secret = mapping[1];
      const expiresAt = mapping[2];
      if (!secret) continue;
      const pool = this.pools.get(provider) || [];
      if (pool.some(e => e.secret === secret)) continue;
      pool.push({
        keyId: "env-" + provider.toLowerCase(),
        secret,
        label: ".env",
        source: "env",
        active: true,
        monthlyLimit: 0,
        requestCount: 0,
        successCount: 0,
        lastUsedAt: null,
        cooldownUntil: null,
        expiresAt: expiresAt || null,
        consecutiveErrors: 0,
      });
      this.pools.set(provider, pool);
    }

    // 3. GoPlus .env key'lerini de ekle (GOPLUS_ACCESS_TOKEN veya app_key+app_secret)
    const goplusEnv = {
      provider: "GoPlus",
      secret: this.env.GOPLUS_ACCESS_TOKEN || null,
    };
    if (goplusEnv.secret) {
      const pool = this.pools.get("GoPlus") || [];
      if (!pool.some(e => e.secret === goplusEnv.secret)) {
        pool.push({
          keyId: "env-goplus",
          secret: goplusEnv.secret,
          label: ".env",
          source: "env",
          active: true,
          monthlyLimit: 0,
          requestCount: 0,
          successCount: 0,
          lastUsedAt: null,
          cooldownUntil: null,
          expiresAt: null,
          consecutiveErrors: 0,
        });
      }
      this.pools.set("GoPlus", pool);
    }

    // 4. GoPlus app_key/app_secret'ini de parametre olarak destekle
    const goplusAppKey = this.env.GOPLUS_APP_KEY;
    const goplusAppSecret = this.env.GOPLUS_APP_SECRET;
    if (goplusAppKey && goplusAppSecret) {
      const pool = this.pools.get("GoPlus") || [];
      if (!pool.some(e => e.secret === goplusAppKey && e.label === "vault-app")) {
        pool.push({
          keyId: "vault-app-goplus",
          secret: goplusAppKey,
          label: "vault-app",
          source: "env",
          kind: "app",
          appSecret: goplusAppSecret,
          active: true,
          monthlyLimit: 0,
          requestCount: 0,
          successCount: 0,
          lastUsedAt: null,
          cooldownUntil: null,
          expiresAt: null,
          consecutiveErrors: 0,
        });
      }
      this.pools.set("GoPlus", pool);
    }

    this.lastReload = now;
    for (const [provider, pool] of this.pools) for (const entry of pool) {
      entry.metricId = crypto.createHash('sha256').update(provider + ':' + entry.keyId + ':' + entry.secret).digest('hex');
      Object.assign(entry, this.metrics[entry.metricId] || { month: new Date().toISOString().slice(0, 7), monthlyRequests: 0, monthlySuccesses: 0, trackedSince: now });
      if (entry.configuredLimit != null) entry.monthlyLimit = entry.configuredLimit;
      if (entry.configuredExpiry !== undefined) entry.expiresAt = entry.configuredExpiry;
      entry.inFlight = 0;
    }
  }

  state(entry) {
    const month = new Date().toISOString().slice(0, 7);
    if (entry.month !== month) Object.assign(entry, { month, monthlyRequests: 0, monthlySuccesses: 0 });
    if (entry.active === false) return 'paused';
    if (entry.expiresAt && entry.expiresAt <= Date.now()) return 'expired';
    if (entry.cooldownUntil > Date.now()) return 'cooldown';
    if (entry.monthlyLimit > 0 && (entry.monthlyRequests || 0) + (entry.inFlight || 0) >= entry.monthlyLimit) return 'quota reached';
    return 'ready';
  }

  configure(keyId, monthlyLimit, expiresAt) {
    const entry = [...this.pools.values()].flat().find(e => e.keyId === keyId);
    if (!entry) return false;
    Object.assign(entry, { monthlyLimit, configuredLimit: monthlyLimit, expiresAt, configuredExpiry: expiresAt });
    this._scheduleWrite();
    return true;
  }

  getKey(provider) {
    const pool = this.pools.get(provider);
    if (!pool || !pool.length) return null;

    const now = Date.now();
    const eligible = pool.filter(entry => this.state(entry) === 'ready');

    if (!eligible.length) return null;

    // Least requests this UTC month, including outstanding requests. LRU breaks ties.
    eligible.sort((a, b) => ((a.monthlyRequests || 0) + (a.inFlight || 0)) - ((b.monthlyRequests || 0) + (b.inFlight || 0)) || (a.lastUsedAt || 0) - (b.lastUsedAt || 0));

    const selected = eligible[0];
    selected.lastUsedAt = now;
    selected.inFlight = (selected.inFlight || 0) + 1;
    return { keyId: selected.keyId, secret: selected.secret, kind: selected.kind, appSecret: selected.appSecret };
  }

  recordUsage(keyId, success, details = {}) {
    let found = false;
    for (const [, pool] of this.pools) {
      for (const entry of pool) {
        if (entry.keyId === keyId) {
          this.state(entry);
          entry.inFlight = Math.max(0, (entry.inFlight || 0) - 1);
          entry.monthlyRequests = (entry.monthlyRequests || 0) + 1;
          entry.monthlySuccesses = (entry.monthlySuccesses || 0) + Number(success);
          entry.lastStatus = details.status || null;
          if (!success) entry.lastErrorAt = Date.now();
          entry.requestCount = Number(entry.requestCount || 0) + 1;
          if (success) {
            entry.successCount = Number(entry.successCount || 0) + 1;
            entry.consecutiveErrors = 0;
            entry.cooldownUntil = null;
          } else {
            entry.consecutiveErrors = Number(entry.consecutiveErrors || 0) + 1;
            if (entry.consecutiveErrors >= 3 || [401, 403, 429].includes(details.status)) {
              entry.cooldownUntil = Date.now() + 60_000;
            }
            if (entry.consecutiveErrors >= 5) {
              entry.cooldownUntil = Date.now() + 300_000;
            }
            if (entry.consecutiveErrors >= 8) {
              entry.cooldownUntil = Date.now() + 900_000;
            }
          }
          entry.lastUsedAt = Date.now();
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) this._scheduleWrite();
  }

  hasKeys(provider) {
    return (this.pools.get(provider) || []).some(entry => this.state(entry) === 'ready');
  }

  snapshot() {
    return [...this.pools].flatMap(([provider, pool]) => pool.map(entry => {
      const state = this.state(entry);
      const total = pool.reduce((sum, item) => { this.state(item); return sum + (item.monthlyRequests || 0); }, 0);
      return { id: entry.keyId, provider, label: entry.label, source: entry.source, masked: '••••' + entry.secret.slice(-4), active: entry.active !== false, inPool: true, state,
        monthlyLimit: entry.monthlyLimit || 0, requestCount: entry.requestCount || 0, successCount: entry.successCount || 0,
        monthlyRequests: entry.monthlyRequests || 0, monthlySuccesses: entry.monthlySuccesses || 0,
        quotaPercent: entry.monthlyLimit > 0 ? (entry.monthlyRequests || 0) / entry.monthlyLimit * 100 : null,
        trafficPercent: total > 0 ? (entry.monthlyRequests || 0) / total * 100 : null,
        month: entry.month, trackedSince: entry.trackedSince, lastUsedAt: entry.lastUsedAt, lastStatus: entry.lastStatus,
        lastErrorAt: entry.lastErrorAt, expiresAt: entry.expiresAt, cooldownUntil: entry.cooldownUntil, consecutiveErrors: entry.consecutiveErrors || 0 };
    }));
  }

  isInPool(keyId) {
    for (const [, pool] of this.pools) {
      if (pool.some(e => e.keyId === keyId)) return true;
    }
    return false;
  }

  status() {
    const now = Date.now();
    const result = {};
    for (const [provider, pool] of this.pools) {
      const active = pool.filter(e => this.state(e) === 'ready');
      const inCooldown = pool.filter(e => e.cooldownUntil && e.cooldownUntil > now);
      const expired = pool.filter(e => e.expiresAt && e.expiresAt <= now);
      result[provider] = {
        total: pool.length,
        active: active.length,
        inCooldown: inCooldown.length,
        expired: expired.length,
        totalRequests: pool.reduce((sum, e) => sum + (e.requestCount || 0), 0),
      };
    }
    return result;
  }
}

module.exports = { KeyPool };
