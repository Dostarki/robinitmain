const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');

// Explicitly migrated; importing this module never modifies a database.
class PostgresStore {
  constructor({ connectionString, pool, schema = 'robinity_queue' } = {}) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error('Invalid queue schema');
    this.pool = pool || new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    this.schema = schema;
  }
  async migrate() {
    const s = this.schema;
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS ${s};
      CREATE TABLE IF NOT EXISTS ${s}.jobs (
        id uuid PRIMARY KEY, asset text NOT NULL, chain text NOT NULL, address text NOT NULL,
        wallet text NOT NULL, ip text NOT NULL, status text NOT NULL DEFAULT 'queued',
        created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
        report jsonb, stage text NOT NULL DEFAULT 'queued', progress integer NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS active_asset ON ${s}.jobs(asset)
        WHERE status IN ('queued','running','retrying','partial');
      CREATE INDEX IF NOT EXISTS wallet_created ON ${s}.jobs(wallet,created_at);
      CREATE INDEX IF NOT EXISTS ip_created ON ${s}.jobs(ip,created_at);
      ALTER TABLE ${s}.jobs ADD COLUMN IF NOT EXISTS cache_valid boolean NOT NULL DEFAULT true;
      CREATE TABLE IF NOT EXISTS ${s}.watchers (
        job_id uuid REFERENCES ${s}.jobs(id) ON DELETE CASCADE, wallet text NOT NULL,
        PRIMARY KEY(job_id,wallet)
      );
      CREATE TABLE IF NOT EXISTS ${s}.outbox (
        job_id uuid PRIMARY KEY REFERENCES ${s}.jobs(id) ON DELETE CASCADE,
        sent_at timestamptz
      );
    `);
  }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Short admission/dispatch transactions share one DB lock across API instances.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.schema]);
      const result = await fn(client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async submit({ asset, chain, address, wallet, ip }) {
    if (![asset, chain, address, wallet, ip].every(v => typeof v === 'string' && v.length && v.length < 256)) throw Error('Invalid job identity');
    const s = this.schema;
    return this.transaction(async client => {
      const active = await client.query(`SELECT * FROM ${s}.jobs WHERE asset=$1 AND status IN ('queued','running','retrying','partial')`, [asset]);
      if (active.rowCount) {
        await client.query(`INSERT INTO ${s}.watchers VALUES ($1,$2) ON CONFLICT DO NOTHING`, [active.rows[0].id, wallet]);
        return { job: active.rows[0], joined: true };
      }
      const usage = await client.query(`SELECT count(*)::integer AS count FROM ${s}.jobs
        WHERE (wallet=$1 OR ip=$2) AND (
          status IN ('queued','running','retrying','partial') OR
          (status IN ('completed','completed_with_gaps') AND completed_at > now()-interval '1 hour'))`, [wallet, ip]);
      if (usage.rows[0].count >= 3) return { denied: 'hourly_limit' };
      const waiting = await client.query(`SELECT count(*)::integer AS count FROM ${s}.jobs WHERE wallet=$1 AND status='queued'`, [wallet]);
      if (waiting.rows[0].count >= 2) return { denied: 'queue_limit' };
      const id = randomUUID();
      const created = await client.query(`INSERT INTO ${s}.jobs(id,asset,chain,address,wallet,ip) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [id, asset, chain, address, wallet, ip]);
      // Job + quota reservation + outbox are committed together.
      await client.query(`INSERT INTO ${s}.outbox(job_id) VALUES ($1)`, [id]);
      return { job: created.rows[0], joined: false };
    });
  }
  async claim(id) {
    const s = this.schema;
    return this.transaction(async client => {
      const result = await client.query(`SELECT * FROM ${s}.jobs WHERE id=$1`, [id]);
      const job = result.rows[0];
      if (!job || !['queued','running','retrying','partial'].includes(job.status)) return false;
      const occupied = await client.query(`SELECT id FROM ${s}.jobs WHERE wallet=$1 AND id<>$2 AND status IN ('running','partial')`, [job.wallet, id]);
      if (occupied.rowCount) return false;
      await client.query(`UPDATE ${s}.jobs SET status='running' WHERE id=$1`, [id]); return true;
    });
  }
  async complete(id, report, gaps = false) {
    return this.pool.query(`UPDATE ${this.schema}.jobs SET status=$2, report=$3, completed_at=now(), stage='completed',progress=100
      WHERE id=$1 AND status IN ('queued','running','retrying','partial')`, [id, gaps ? 'completed_with_gaps' : 'completed', JSON.stringify(report)]);
  }
  async fail(id) {
    return this.pool.query(`UPDATE ${this.schema}.jobs SET status='failed', completed_at=now()
      WHERE id=$1 AND status IN ('queued','running','retrying','partial')`, [id]);
  }
  async status(id, wallet) {
    const { rows } = await this.pool.query(`SELECT id,chain,address,status,stage,progress,report,created_at,completed_at FROM ${this.schema}.jobs j
      WHERE id=$1 AND (wallet=$2 OR EXISTS (SELECT 1 FROM ${this.schema}.watchers w WHERE w.job_id=j.id AND w.wallet=$2))`, [id,wallet]);
    return rows[0] || null;
  }
  async history(wallet) {
    const { rows } = await this.pool.query(`SELECT report FROM ${this.schema}.jobs j WHERE report IS NOT NULL
      AND (wallet=$1 OR EXISTS (SELECT 1 FROM ${this.schema}.watchers w WHERE w.job_id=j.id AND w.wallet=$1))
      ORDER BY completed_at DESC LIMIT 50`, [wallet]);
    return rows.map(r => r.report);
  }
  async pendingOutbox() {
    return (await this.pool.query(`SELECT j.* FROM ${this.schema}.outbox o JOIN ${this.schema}.jobs j ON j.id=o.job_id WHERE o.sent_at IS NULL ORDER BY j.created_at LIMIT 100`)).rows;
  }
  async job(id) { return (await this.pool.query(`SELECT * FROM ${this.schema}.jobs WHERE id=$1`, [id])).rows[0]; }
  async active() { return (await this.pool.query(`SELECT id FROM ${this.schema}.jobs WHERE status IN ('queued','running','retrying','partial') ORDER BY created_at LIMIT 1000`)).rows; }
  async access(wallet,ip) {
    const {rows} = await this.pool.query(`SELECT count(*)::integer AS used FROM ${this.schema}.jobs WHERE (wallet=$1 OR ip=$2) AND (status IN ('queued','running','retrying','partial') OR (status IN ('completed','completed_with_gaps') AND completed_at>now()-interval '1 hour'))`,[wallet,ip]);
    return {limit:3, used:rows[0].used, remaining:Math.max(0,3-rows[0].used)};
  }
  async progress(id, stage, progress) {
    await this.pool.query(`UPDATE ${this.schema}.jobs SET stage=$2, progress=$3 WHERE id=$1 AND status='running'`, [id, stage, progress]);
  }
  async stats() {
    return (await this.pool.query(`SELECT status,count(*)::integer AS count, min(created_at) AS oldest FROM ${this.schema}.jobs GROUP BY status`)).rows;
  }
  async fresh(asset, wallet) {
    return this.transaction(async client => {
      const { rows } = await client.query(`SELECT * FROM ${this.schema}.jobs WHERE asset=$1 AND cache_valid=true AND status IN ('completed','completed_with_gaps') AND completed_at>now()-interval '2 minutes' AND (report->>'analyzedAt')::numeric > extract(epoch from now()-interval '2 minutes')*1000 ORDER BY completed_at DESC LIMIT 1`, [asset]);
      if (!rows[0]) return null;
      await client.query(`INSERT INTO ${this.schema}.watchers VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id,wallet]);
      return rows[0].report;
    });
  }
  async invalidate(chain,address) { await this.pool.query(`UPDATE ${this.schema}.jobs SET cache_valid=false WHERE chain=$1 AND address=$2`, [chain,address]); }
  async markSent(id) { await this.pool.query(`UPDATE ${this.schema}.outbox SET sent_at=now() WHERE job_id=$1`, [id]); }
  // Retention cleanup: completed > completedDays, failed > failedDays (plan §5)
  async cleanup(completedDays = 7, failedDays = 30) {
    const s = this.schema;
    const result = await this.pool.query(`
      DELETE FROM ${s}.jobs WHERE
        (status IN ('completed','completed_with_gaps') AND completed_at < now() - make_interval(days => $1))
        OR (status = 'failed' AND completed_at < now() - make_interval(days => $2))
    `, [completedDays, failedDays]);
    return result.rowCount;
  }
  // Provider-level metrics aggregation for admin panel (plan §11)
  async providerMetrics() {
    const s = this.schema;
    const { rows } = await this.pool.query(`
      SELECT status, stage, count(*)::integer AS count,
        min(created_at) AS oldest, max(completed_at) AS newest,
        avg(EXTRACT(EPOCH FROM (completed_at - created_at)))::numeric(10,2) AS avg_duration_sec,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)))::numeric(10,2) AS p95_duration_sec
      FROM ${s}.jobs WHERE completed_at > now() - interval '1 hour'
      GROUP BY status, stage ORDER BY count DESC
    `);
    return rows;
  }
  async close() { await this.pool.end(); }
}
module.exports = { PostgresStore };
