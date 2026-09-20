const { Queue, Worker, DelayedError, UnrecoverableError } = require('bullmq');
const { PostgresStore } = require('./postgres-store');
const { OutboxRelay } = require('./outbox-relay');
const { createBullMQConnection } = require('./redis-client');
const { canonicalAddress, assetKey, privacyHash } = require('./orchestrator');
const { rateLimiter } = require('./rate-limiter');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class DurableRuntime {
  constructor({ hashSalt, analyze, enrich, store, connection, queueName = 'ri-analysis-v3' }) {
    Object.assign(this, { hashSalt, analyze, enrich });
    this.store = store || new PostgresStore({ connectionString: process.env.DATABASE_URL });
    this.connection = connection || createBullMQConnection('durable-runtime');
    this.queue = new Queue(queueName, { connection: this.connection });
    this.relay = new OutboxRelay({ store: this.store, queue: this.queue });
    this.queueName = queueName;
    this.streams = new Set();
  }
  async start({ migrate = false } = {}) {
    if (migrate) await this.store.migrate();
    await this.store.stats(); // Migration must exist; do not fall back to JSON.
    await this.queue.waitUntilReady();
    this.worker = new Worker(this.queueName, async (job, token) => {
      const saved = await this.store.job(job.data.jobId);
      if (!saved || ['completed','completed_with_gaps','failed'].includes(saved.status)) return;
      if (!await this.store.claim(saved.id)) {
        await job.moveToDelayed(Date.now() + 1000, token); throw new DelayedError();
      }
      try {
        await this.store.progress(saved.id, 'security', 15);
        const report = await this.analyze(saved.chain, saved.address);
        if (!report || !Number.isFinite(report.score)) throw Error('Security report unavailable');
        await this.store.progress(saved.id, 'creator', 65);
        let insights = null;
        try { insights = await this.enrich(report); } catch { /* optional coverage */ }
        const result = { ...report, id: saved.id, insights, savedAt: Date.now(), coverage: insights ? [] : ['Creator data unavailable'] };
        if (insights?.creator?.address) result.creatorAddress = insights.creator.address;
        await this.store.complete(saved.id, result, !insights);
      } catch (error) {
        if ([400,401,403].includes(error.statusCode)) { await this.store.fail(saved.id); throw new UnrecoverableError('Provider request rejected'); }
        // Only mark as failed on the last attempt; earlier failures allow BullMQ retry
        const maxAttempts = job.opts.attempts || 3;
        if (job.attemptsMade + 1 >= maxAttempts) await this.store.fail(saved.id);
        else await this.store.progress(saved.id, 'retrying', job.attemptsMade * 30);
        throw Error('Analysis could not be completed');
      }
    }, { connection: this.connection, concurrency: 4, maxStalledCount: 2,
         attempts: 3, backoff: { type: 'exponential', delay: 3000 } });
    this.worker.on('error', () => { this.lastError = 'Worker connection unavailable'; });
    this.worker.on('failed', async (job, err) => {
      // Only settle as failed when BullMQ has exhausted all attempts
      if (job && (await job.getState().catch(() => '') === 'failed')) await this.store.fail(job.data.jobId).catch(() => {});
    });
    const flush = () => this.relay.flush().then(() => { this.lastError = null; }).catch(() => { this.lastError = 'Queue delivery unavailable'; });
    this.timer = setInterval(flush, 2000); this.timer.unref();
    this.recoveryTimer = setInterval(() => this.recover().catch(() => { this.lastError = 'Recovery unavailable'; }),30000);
    this.recoveryTimer.unref();
    // Retention cleanup: completed > 7 days, failed > 30 days (plan §5)
    this.cleanupTimer = setInterval(() => this.store.cleanup().catch(() => {}), 24 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
    await this.recover();
    await flush();
    return this;
  }
  async recover() {
    for (const row of await this.store.active()) {
      const job = await this.queue.getJob(row.id);
      if (!job) await this.queue.add('analysis',{jobId:row.id},{jobId:row.id,removeOnComplete:false,removeOnFail:false,attempts:3,backoff:{type:'exponential',delay:3000}});
      else if (await job.getState() === 'failed') await this.store.fail(row.id);
    }
  }
  async submitAnalysis({ chain, address, walletAddress, clientIp }) {
    const canonical = canonicalAddress(chain, address);
    if (!canonical) return { status: 400, body: { error: 'Enter a valid token address for the selected network.' } };
    const salt = typeof this.hashSalt === 'function' ? this.hashSalt() : this.hashSalt;
    const wallet = privacyHash(walletAddress, salt), ip = privacyHash(clientIp, salt), asset = assetKey(chain,canonical);
    const cached = await this.store.fresh(asset,wallet);
    if (cached) return { status: 200, body: { report: { ...cached, cached: true }, freshness: 'fresh' } };
    const result = await this.store.submit({ chain,address:canonical,asset,wallet,ip });
    if (result.denied) return { status: 429, body: { error: result.denied === 'hourly_limit' ? 'Early access currently allows up to 3 analyses per hour. Please try again after your access window resets.' : 'You already have two analyses waiting. Please wait for them to finish.' } };
    this.relay.flush().catch(() => { this.lastError = 'Queue delivery unavailable'; });
    return { status: 202, body: { jobId: result.job.id, status: result.job.status, joined: result.joined } };
  }
  async getJobStatus(id, wallet) {
    const job = UUID.test(id) && await this.store.status(id,wallet);
    return job ? { status: 200, body: { ...job, jobId: job.id, error: job.status === 'failed' ? 'Analysis could not be completed. Please try again later.' : undefined } } : { status:404, body:{error:'Analysis not found'} };
  }
  // DB-backed SSE snapshots work across processes without an in-memory event dependency.
  // Durable snapshots also recover missed events on reconnect; polling uses the same authorization.
  async stream(response, id, wallet, authorized) {
    const first = await this.getJobStatus(id,wallet);
    if (first.status !== 200 || this.streams.size >= 100) return false;
    response.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
    let closed = false, previous = '';
    const close = () => { if (closed) return; closed = true; clearTimeout(timer); this.streams.delete(close); response.end(); };
    let timer;
    this.streams.add(close); response.on('close', close);
    const tick = async () => {
      if (closed) return;
      try {
        if (!authorized()) return close();
        const result = await this.getJobStatus(id,wallet);
        if (result.status !== 200) return close();
        const text = JSON.stringify(result.body);
        if (text !== previous) { response.write(`event: progress\ndata: ${text}\n\n`); previous = text; }
        else response.write(': heartbeat\n\n');
        if (['completed','completed_with_gaps','failed'].includes(result.body.status)) return close();
      } catch { return close(); }
      timer = setTimeout(tick,2000);
    };
    await tick(); return true;
  }
  async snapshot() {
    const [jobs, queues, providers, metrics] = await Promise.all([
      this.store.stats(), this.queue.getJobCounts(), rateLimiter.snapshot(),
      this.store.providerMetrics().catch(() => []),
    ]);
    return { jobs, queues, providers, metrics, deliveryError: this.lastError, timestamp: Date.now() };
  }
  async close() {
    clearInterval(this.timer); clearInterval(this.recoveryTimer); clearInterval(this.cleanupTimer); for (const close of this.streams) close();
    await this.worker?.close(); await this.queue.close(); await this.connection.quit(); await this.store.close();
  }
}
module.exports = { DurableRuntime };
