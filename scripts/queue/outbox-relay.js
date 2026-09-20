// Retain completed queue IDs until their outbox row is acknowledged. A crash
// after Redis accepts an enqueue must replay that SAME ID, not a second job.
class OutboxRelay {
  constructor({ store, queue }) {
    this.store = store;
    this.queue = queue;
    this.flushing = null;
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  async run() {
    const jobs = await this.store.pendingOutbox();
    let sent = 0;
    for (const job of jobs) {
      if (!['queued', 'running', 'retrying', 'partial'].includes(job.status)) {
        await this.store.markSent(job.id);
        continue;
      }
      // Redis receives only an opaque DB ID: no IP, wallet or provider secrets.
      await this.queue.add('analysis', { jobId: job.id }, {
        jobId: job.id, removeOnComplete: false, removeOnFail: false,
        attempts: 3, backoff: { type: 'exponential', delay: 3000 },
      });
      await this.store.markSent(job.id);
      sent++;
    }
    return sent;
  }
}
module.exports = { OutboxRelay };
