/**
 * BullMQ Queue Factory
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 5
 *
 * Her provider/endpoint sınıfı için ayrı queue oluşturur.
 * Neden ayrı queue: On kullanıcı aynı anda analiz başlattığında tek global
 * queue bile upstream tarafta burst yaratabilir. Ayrı queue'lar her
 * sağlayıcıyı kendi kapasitesinde yavaşlatır.
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const { createBullMQConnection } = require('./redis-client');
const { QUEUES, RETRY_POLICY } = require('./config');

/** Oluşturulan queue'ları tut */
const queues = new Map();
const workers = new Map();
const queueEvents = new Map();

/**
 * Tekil queue instance'ı döner, yoksa oluşturur.
 * @param {string} name - Queue adı (config.QUEUES key'i)
 * @returns {Queue}
 */
function getQueue(name) {
  if (queues.has(name)) return queues.get(name);

  if (!QUEUES[name]) {
    throw new Error(`Unknown queue: ${name}. Valid queues: ${Object.keys(QUEUES).join(', ')}`);
  }

  const queue = new Queue(name, {
    connection: createBullMQConnection(name),
    defaultJobOptions: {
      attempts: RETRY_POLICY.maxAttempts,
      backoff: {
        type: RETRY_POLICY.backoffType,
        delay: RETRY_POLICY.initialBackoffMs,
        jitter: 0.25,
      },
      removeOnComplete: {
        age: Math.floor(RETRY_POLICY.completedRetentionMs / 1000),
      },
      removeOnFail: {
        age: Math.floor(RETRY_POLICY.failedRetentionMs / 1000),
      },
    },
  });

  queues.set(name, queue);
  return queue;
}

/**
 * Belirli queue için worker oluşturur.
 * @param {string} name - Queue adı
 * @param {Function} processor - Job processor fonksiyonu
 * @param {object} opts - Ek worker seçenekleri
 * @returns {Worker}
 */
function createWorker(name, processor, opts = {}) {
  if (workers.has(name)) {
    console.warn(`[Queue:${name}] Worker already exists, returning existing`);
    return workers.get(name);
  }

  if (!QUEUES[name]) {
    throw new Error(`Unknown queue: ${name}`);
  }

  const worker = new Worker(name, processor, {
    connection: createBullMQConnection(name),
    concurrency: opts.concurrency || 1,
    // Locks, worker crash sonrası stuck job kurtarılabilsin (Bölüm 12)
    lockDuration: opts.lockDuration || 30000,
    stalledInterval: opts.stalledInterval || 15000,
    ...opts,
  });

  worker.on('completed', (job) => {
    console.log(`[Worker:${name}] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker:${name}] Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[Worker:${name}] Job ${jobId} stalled — recovering`);
  });

  worker.on('error', (err) => {
    console.error(`[Worker:${name}] Error:`, err.message);
  });

  workers.set(name, worker);
  return worker;
}

/**
 * Queue event listener oluşturur (SSE progress için kullanılır).
 * @param {string} name - Queue adı
 * @returns {QueueEvents}
 */
function getQueueEvents(name) {
  if (queueEvents.has(name)) return queueEvents.get(name);

  const events = new QueueEvents(name, {
    connection: createBullMQConnection(name),
  });

  queueEvents.set(name, events);
  return events;
}

/**
 * Tüm queue başına waiting, active, delayed, completed, failed sayılarını döner.
 * Admin panel (Bölüm 11) için.
 */
async function getAllQueueStats() {
  const stats = {};
  for (const [name, queue] of queues) {
    try {
      const [waiting, active, delayed, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getDelayedCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);
      stats[name] = { waiting, active, delayed, completed, failed };
    } catch (err) {
      stats[name] = { error: err.message };
    }
  }
  return stats;
}

/**
 * Graceful shutdown: Tüm worker'ları durdur, queue'ları kapat.
 */
async function shutdownAll() {
  console.log('[QueueFactory] Shutting down all workers and queues...');

  // Önce worker'ları durdur
  const workerPromises = [];
  for (const [name, worker] of workers) {
    console.log(`[QueueFactory] Closing worker: ${name}`);
    workerPromises.push(worker.close());
  }
  await Promise.allSettled(workerPromises);
  workers.clear();

  // QueueEvents'leri kapat
  const eventPromises = [];
  for (const [name, events] of queueEvents) {
    eventPromises.push(events.close());
  }
  await Promise.allSettled(eventPromises);
  queueEvents.clear();

  // Queue'ları kapat
  const queuePromises = [];
  for (const [name, queue] of queues) {
    console.log(`[QueueFactory] Closing queue: ${name}`);
    queuePromises.push(queue.close());
  }
  await Promise.allSettled(queuePromises);
  queues.clear();

  console.log('[QueueFactory] All shut down.');
}

module.exports = {
  getQueue,
  createWorker,
  getQueueEvents,
  getAllQueueStats,
  shutdownAll,
  queues,
  workers,
};
