const fs = require('fs');

class RiskAccess {
  constructor({ filePath = null, now = () => Date.now(), windowMs = 60 * 60 * 1000, limit = 3 } = {}) {
    Object.assign(this, { filePath, now, windowMs, limit });
    this.pending = new Map();
    this.reload();
  }
  reload() {
    if (!this.filePath) return;
    try { this.events = JSON.parse(fs.readFileSync(this.filePath, 'utf8')).events || []; } catch { this.events = []; }
  }
  prune(now = this.now()) { this.events = this.events.filter(event => event.at > now - this.windowMs); }
  inspect({ wallet, ip }, now = this.now()) {
    this.reload();
    this.prune(now);
    const matching = this.events.filter(event => event.wallet === wallet || event.ip === ip).sort((a, b) => a.at - b.at);
    const resetAt = matching.length ? matching[0].at + this.windowMs : null;
    return { allowed: matching.length < this.limit, used: matching.length, limit: this.limit, remaining: Math.max(0, this.limit - matching.length), resetAt };
  }
  consume(identity, now = this.now()) {
    const state = this.inspect(identity, now);
    if (!state.allowed) return state;
    this.events.push({ ...identity, at: now });
    if (this.events.length > 100000) this.prune(now);
    if (this.filePath) {
      const temporary = this.filePath + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ events: this.events }), { mode: 0o600 });
      fs.renameSync(temporary, this.filePath);
    }
    return { ...state, used: state.used + 1, remaining: state.remaining - 1, resetAt: state.resetAt || now + this.windowMs };
  }
  begin(identity, now = this.now()) {
    const base = this.inspect(identity, now);
    for (const [id, pending] of this.pending) if (pending.at <= now - 5 * 60 * 1000) this.pending.delete(id);
    const pending = [...this.pending.values()].filter(event => event.wallet === identity.wallet || event.ip === identity.ip).length;
    if (base.used + pending >= this.limit) return { ...base, allowed: false, remaining: 0 };
    const reservation = Math.random().toString(36).slice(2) + now.toString(36);
    this.pending.set(reservation, { ...identity, at: now });
    return { ...base, used: base.used + pending, remaining: this.limit - base.used - pending - 1, reservation };
  }
  commit(reservation, now = this.now()) {
    const identity = this.pending.get(reservation); if (!identity) return null;
    this.pending.delete(reservation);
    return this.consume(identity, now);
  }
  release(reservation) { return this.pending.delete(reservation); }
}
module.exports = { RiskAccess };
