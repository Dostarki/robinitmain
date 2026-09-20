/**
 * Provider Workers — BullMQ Processor'lar
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 5, P3
 *
 * Her provider kendi queue'sunda, kendi rate limiter'ı ile çalışır.
 * Worker upstream çağrıdan önce token ister. Token yoksa busy loop
 * yapmak yerine BullMQ delayed job olarak doğru zamana ertelenir.
 *
 * Retry kuralları (Bölüm 5):
 *   - Sadece timeout, bağlantı hatası, 429 ve 5xx tekrar denenir
 *   - 400, geçersiz adres, yetkilendirme tekrar denenmez
 *   - Upstream Retry-After header'ı varsa job bu süreden önce denenmez
 */

const { rateLimiter } = require('./rate-limiter');
const { createWorker, getQueue } = require('./queue-factory');
const { updateJob, findJob, saveReport, recordProviderMetric } = require('./job-repository');
const { cacheSet, cacheGet, releaseRefreshLock } = require('./cache-adapter');
const { JOB_STATES, RETRY_POLICY, PROVIDER_LIMITS } = require('./config');
const { DelayedError, UnrecoverableError } = require('bullmq');

/**
 * Provider worker wrapper — rate limit ve retry logic ile sarmalayarak
 * her provider'ın aynı pattern'ı kullanmasını sağlar.
 *
 * @param {string} queueName - Queue adı
 * @param {Function} upstreamFn - Gerçek upstream çağrı fonksiyonu
 * @param {object} opts - Ek seçenekler
 */
function createProviderWorker(queueName, upstreamFn, opts = {}) {
  const config = PROVIDER_LIMITS[queueName];
  if (!config) throw new Error(`No provider config for queue: ${queueName}`);

  return createWorker(queueName, async (bullJob, token) => {
    const { jobId, chain, address, assetKey, taskType } = bullJob.data;
    const startTime = Date.now();
    let statusCode = null;
    let leaseId = null;
    let renewal = null;
    const cacheAddress = queueName === 'helius-wallet' ? bullJob.data.creatorAddress : address;

    try {
      if (taskType && cacheAddress) {
        const cached = await cacheGet(taskType, chain, cacheAddress);
        if (cached?.freshness === 'fresh' && cached.value != null) return cached.value;
      }
      // 1. Rate limit token iste
      const permit = await rateLimiter.acquire(queueName);
      leaseId = permit.leaseId;

      if (!permit.allowed) {
        // Token yok — BullMQ delayed job olarak ertele
        const delayMs = Math.max(1000, permit.retryAfterMs);
        console.log(`[Worker:${queueName}] Rate limited, delaying ${delayMs}ms`);

        await bullJob.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
      }

      // 2. Upstream çağrı
      if (leaseId) renewal = setInterval(() => rateLimiter.renew(queueName, leaseId).catch(() => {}), 20000);
      try {
        const result = await upstreamFn(bullJob.data);
        statusCode = 200;

        // 3. Rate limiter token'ı bırak (başarılı)
        clearInterval(renewal);
        await rateLimiter.release(queueName, leaseId);

        // 4. Provider metriği kaydet
        const latencyMs = Date.now() - startTime;
        recordProviderMetric({
          provider: config.provider,
          endpointClass: config.endpointClass,
          keyId: bullJob.data.keyId || 'default',
          latencyMs,
          success: true,
          statusCode: 200,
        });

        // 5. Sonucu cache'e yaz
        if (result && taskType && cacheAddress) {
          // A cache write failure must not repeat a successful provider request.
          await cacheSet(taskType, chain, cacheAddress, result).catch(() => {});
        }

        return result;

      } catch (error) {
        // Upstream hata
        clearInterval(renewal);
        await rateLimiter.release(queueName, leaseId);

        statusCode = parseStatusCode(error);
        const latencyMs = Date.now() - startTime;

        recordProviderMetric({
          provider: config.provider,
          endpointClass: config.endpointClass,
          keyId: bullJob.data.keyId || 'default',
          latencyMs,
          success: false,
          statusCode,
        });

        // 429 sonrası cooldown
        if (statusCode === 429) {
          const retryAfterHeader = parseRetryAfter(error);
          await rateLimiter.setCooldown(queueName, config.cooldownMs, retryAfterHeader);
        }

        // Non-retryable hatalar
        if (RETRY_POLICY.nonRetryableStatuses.includes(statusCode)) {
          throw new NonRetryableError(error.message, statusCode);
        }

        // Retryable hatalar
        if (RETRY_POLICY.retryableStatuses.includes(statusCode) || isNetworkError(error)) {
          throw error; // BullMQ retry mekanizmasına bırak
        }

        // Diğer hatalar — non-retryable
        throw new NonRetryableError(error.message, statusCode);
      }

    } catch (error) {
      if (error instanceof NonRetryableError) {
        // BullMQ'ya tekrar denememesini söyle
        throw new UnrecoverableError('Provider request cannot be retried');
      }
      throw error;
    }
  }, {
    concurrency: config.concurrency,
  });
}

// ─── Orchestrator Worker ────────────────────────────────────────────────────

/**
 * Ana orchestrator worker — analiz aşamalarını planlar.
 * analysis-orchestrator queue'sundaki job'ları işler.
 */
function createOrchestratorWorker(opts = {}) {
  const { keyPool, riskAccess } = opts;

  return createWorker('analysis-orchestrator', async (bullJob) => {
    const { jobId, chain, address, assetKey, reservation, isRefresh } = bullJob.data;

    // Job durumunu running'e güncelle
    updateJob(jobId, {
      status: JOB_STATES.RUNNING,
      stage: 'security',
      startedAt: Date.now(),
    });

    const stages = [];
    const errors = [];

    try {
      // ── Stage 1: GoPlus Security ──────────────────────────────────────
      await bullJob.updateProgress(10);
      updateJob(jobId, { stage: 'security', progress: 10 });

      let securityResult = null;
      try {
        const securityQueue = getQueue('goplus-security');
        const securityJob = await securityQueue.add('security-check', {
          jobId, chain, address, assetKey,
          taskType: 'goplus-security-signals',
        }, { priority: 1 });

        securityResult = await securityJob.waitUntilFinished(
          require('./queue-factory').getQueueEvents('goplus-security'),
          60000 // 60s timeout
        );
        stages.push({ name: 'goplus-security', status: 'completed' });
      } catch (err) {
        errors.push({ stage: 'goplus-security', error: err.message });
        stages.push({ name: 'goplus-security', status: 'failed' });
      }
      if (!securityResult) throw new Error('Required security source is unavailable');

      // ── Stage 2: Creator Verification ─────────────────────────────────
      await bullJob.updateProgress(30);
      updateJob(jobId, { stage: 'verification', progress: 30 });

      let creatorResult = null;
      if (chain === 'solana') {
        // Bitquery + Helius DAS
        try {
          const bitqueryQueue = getQueue('bitquery-graphql');
          const bitqueryJob = await bitqueryQueue.add('creator-lookup', {
            jobId, chain, address, assetKey,
            taskType: 'pump-create-signer',
          }, { priority: 3 });

          creatorResult = await bitqueryJob.waitUntilFinished(
            require('./queue-factory').getQueueEvents('bitquery-graphql'),
            30000
          );
          stages.push({ name: 'bitquery-creator', status: 'completed' });
        } catch (err) {
          errors.push({ stage: 'bitquery-creator', error: err.message });
          stages.push({ name: 'bitquery-creator', status: 'failed' });

          // Fallback: Helius DAS
          try {
            const dasQueue = getQueue('helius-das');
            const dasJob = await dasQueue.add('das-lookup', {
              jobId, chain, address, assetKey,
              taskType: 'token-metadata',
            }, { priority: 3 });

            creatorResult = await dasJob.waitUntilFinished(
              require('./queue-factory').getQueueEvents('helius-das'),
              30000
            );
            stages.push({ name: 'helius-das', status: 'completed' });
          } catch (dasErr) {
            errors.push({ stage: 'helius-das', error: dasErr.message });
            stages.push({ name: 'helius-das', status: 'failed' });
          }
        }
      } else {
        // EVM: Etherscan
        try {
          const ethQueue = getQueue('etherscan-read');
          const ethJob = await ethQueue.add('contract-creation', {
            jobId, chain, address, assetKey,
            taskType: 'evm-creation',
          }, { priority: 3 });

          creatorResult = await ethJob.waitUntilFinished(
            require('./queue-factory').getQueueEvents('etherscan-read'),
            30000
          );
          stages.push({ name: 'etherscan-creation', status: 'completed' });
        } catch (err) {
          errors.push({ stage: 'etherscan-creation', error: err.message });
          stages.push({ name: 'etherscan-creation', status: 'failed' });
        }
      }

      // ── Stage 3: Creator Wallet Analysis ──────────────────────────────
      await bullJob.updateProgress(50);
      updateJob(jobId, { stage: 'creator', progress: 50 });

      // ── Stage 4: Wallet Activity ──────────────────────────────────────
      await bullJob.updateProgress(70);
      updateJob(jobId, { stage: 'wallet', progress: 70 });

      let walletResult = null;
      if (chain === 'solana' && creatorResult?.creator?.address) {
        try {
          const walletQueue = getQueue('helius-wallet');
          const walletJob = await walletQueue.add('wallet-analysis', {
            jobId, chain, address, assetKey,
            creatorAddress: creatorResult.creator.address,
            taskType: 'wallet-holdings',
          }, { priority: 4 });

          walletResult = await walletJob.waitUntilFinished(
            require('./queue-factory').getQueueEvents('helius-wallet'),
            45000
          );
          stages.push({ name: 'helius-wallet', status: 'completed' });
        } catch (err) {
          errors.push({ stage: 'helius-wallet', error: err.message });
          stages.push({ name: 'helius-wallet', status: 'failed' });
        }
      }

      // ── Stage 5: Finalizing ───────────────────────────────────────────
      await bullJob.updateProgress(90);
      updateJob(jobId, { stage: 'finalizing', progress: 90 });

      // Report birleştirme
      const report = assembleReport({
        chain, address, assetKey,
        security: securityResult,
        creator: creatorResult,
        wallet: walletResult,
        stages,
        errors,
      });

      // Report'u kaydet
      saveReport(report);
      await cacheSet('full-report', chain, address, report);

      // Stale refresh ise lock'u bırak
      if (isRefresh) {
        await releaseRefreshLock('full-report', chain, address);
      }

      // Job durumunu güncelle
      const hasGaps = errors.length > 0;
      const finalStatus = hasGaps ? JOB_STATES.COMPLETED_WITH_GAPS : JOB_STATES.COMPLETED;

      updateJob(jobId, {
        status: finalStatus,
        stage: 'completed',
        progress: 100,
        completedAt: Date.now(),
      });

      // Kota reservation'ı commit et (Bölüm 4, madde 9)
      if (reservation && riskAccess) {
        riskAccess.commit(reservation);
      }

      await bullJob.updateProgress(100);

      return { status: finalStatus, report };

    } catch (err) {
      // Job failed
      updateJob(jobId, {
        status: JOB_STATES.FAILED,
        errorCode: 'ORCHESTRATION_ERROR',
        errorMessage: err.message, // Server-only, kullanıcıya verilmez
        completedAt: Date.now(),
      });

      // Kota reservation'ı geri bırak (Bölüm 4, madde 9)
      if (reservation && riskAccess) {
        riskAccess.release(reservation);
      }

      throw err;
    }
  }, {
    concurrency: 2,
    lockDuration: 120000, // Orchestrator daha uzun sürebilir
  });
}

// ─── Finalizer Worker ───────────────────────────────────────────────────────

function createFinalizerWorker() {
  return createWorker('analysis-finalizer', async (bullJob) => {
    const { jobId, chain, address, assetKey, parts } = bullJob.data;

    const report = assembleReport({ chain, address, assetKey, ...parts });
    saveReport(report);
    await cacheSet('full-report', chain, address, report);

    updateJob(jobId, {
      status: JOB_STATES.COMPLETED,
      stage: 'completed',
      progress: 100,
      completedAt: Date.now(),
    });

    return report;
  }, { concurrency: 2 });
}

// ─── Report Assembly ────────────────────────────────────────────────────────

function assembleReport({ chain, address, assetKey, security, creator, wallet, stages, errors }) {
  const now = Date.now();
  return {
    assetKey,
    chain,
    address,
    version: require('./config').ANALYSIS_VERSION,

    // Security data
    security: security || null,

    // Creator data
    creator: creator?.creator || null,
    launches: creator?.launches || null,
    exchangeUsage: creator?.exchangeUsage || null,

    // Wallet data
    balances: wallet?.balances || null,
    movements: wallet?.movements || null,
    balanceHistory: wallet?.balanceHistory || null,

    // Metadata
    stages: stages || [],
    coverage: (errors || []).map(e => ({
      stage: e.stage,
      state: 'unavailable',
      note: 'Provider data temporarily unavailable.',
    })),

    // Timestamps — raporun statik ve dinamik parçaları ayrı zaman damgaları taşır
    timestamps: {
      security: security ? now : null,
      creator: creator ? now : null,
      wallet: wallet ? now : null,
      assembled: now,
    },

    savedAt: now,
  };
}

// ─── Yardımcı sınıflar ─────────────────────────────────────────────────────

class NonRetryableError extends UnrecoverableError {
  constructor(message, statusCode) {
    super(message);
    this.name = 'NonRetryableError';
    this.statusCode = statusCode;
  }
}

function parseStatusCode(error) {
  if (error.statusCode) return error.statusCode;
  const match = error.message?.match(/(\d{3})/);
  return match ? Number(match[1]) : null;
}

function parseRetryAfter(error) {
  const value = error.retryAfter;
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function isNetworkError(error) {
  return error.name === 'TimeoutError' ||
    error.name === 'AbortError' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT';
}

module.exports = {
  createProviderWorker,
  createOrchestratorWorker,
  createFinalizerWorker,
  assembleReport,
  NonRetryableError,
};
