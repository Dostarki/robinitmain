/**
 * Analysis Orchestrator — Job Kabul, Quota, Dedupe, Cache Lookup
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 4, 9
 *
 * Yeni analiz kabul akışı (Bölüm 4):
 *   1. Wallet oturumu, origin ve IP güven modeli doğrulanır.
 *   2. Chain/adres canonical biçime çevrilir; hatalı input job oluşturmaz.
 *   3. Fresh cache kontrol edilir. Fresh report varsa anında döner ve kota tüketmez.
 *   4. chain:canonicalAddress:analysisVersion için active job lock kontrol edilir.
 *   5. Aynı asset zaten çalışıyorsa kullanıcı watcher olur; yeni upstream job oluşmaz.
 *   6. Yeni işte wallet/IP için bir kota reservation alınır.
 *   7. Kullanıcı başına maks 1 active + 2 queued job kabul edilir.
 *   8. Job ID ve tahmini queue konumu döner.
 *   9. Başarılı iş reservation'ı completed usage'a çevirir.
 */

const crypto = require('crypto');
const { getAddress } = require('ethers');
const { getQueue } = require('./queue-factory');
const { cacheGet, cacheSet, recordCacheHit, acquireRefreshLock } = require('./cache-adapter');
const {
  createJob, updateJob, findJob, findActiveJobByAsset,
  countUserJobs, queuePosition, addWatcher,
  saveReport, findReport, checkFreshness,
  auditLog, canReadJob,
} = require('./job-repository');
const { JOB_STATES, USER_LIMITS, CACHE_TTL, ANALYSIS_VERSION } = require('./config');

// ─── Yardımcı fonksiyonlar ──────────────────────────────────────────────────

const SUPPORTED_CHAINS = {
  solana: null,
  ethereum: '1',
  bsc: '56',
  base: '8453',
  arbitrum: '42161',
  optimism: '10',
  polygon: '137',
};

/**
 * Chain/address canonical biçime çevrilir (madde 2).
 */
function canonicalAddress(chain, address) {
  if (!Object.hasOwn(SUPPORTED_CHAINS, chain)) return null;
  if (typeof address !== 'string') return null;

  const trimmed = address.trim();
  if (chain === 'solana') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) ? trimmed : null;
  }

  try {
    return getAddress(trimmed).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Deterministic asset key (madde 4).
 */
function assetKey(chain, address) {
  return `${chain}:${address}:${ANALYSIS_VERSION}`;
}

/**
 * Privacy hash — HMAC ile wallet/IP hashleme (Bölüm 8).
 */
function privacyHash(value, salt) {
  return crypto.createHmac('sha256', salt).update(String(value)).digest('base64url');
}

// ─── Ana Orchestrator ───────────────────────────────────────────────────────

class AnalysisOrchestrator {
  /**
   * @param {object} opts
   * @param {Function} opts.hashSalt - Server-side salt sağlayıcı
   * @param {object} opts.riskAccess - RiskAccess instance
   */
  constructor({ hashSalt, riskAccess }) {
    this.hashSalt = hashSalt;
    this.riskAccess = riskAccess;
  }

  /**
   * Yeni analiz isteği işler (POST /api/risk/analyses).
   *
   * @param {object} params
   * @param {string} params.chain
   * @param {string} params.address
   * @param {string} params.walletAddress - Oturum sahibi wallet
   * @param {string} params.clientIp
   * @returns {{ status: number, body: object }}
   */
  async submitAnalysis({ chain, address, walletAddress, clientIp }) {
    // Madde 2: Canonical biçim
    const canonical = canonicalAddress(chain, address);
    if (!canonical) {
      return { status: 400, body: { error: 'Enter a valid token address for the selected network.' } };
    }

    const key = assetKey(chain, canonical);
    const salt = typeof this.hashSalt === 'function' ? this.hashSalt() : this.hashSalt;
    const walletHash = privacyHash(walletAddress, salt);
    const ipHash = privacyHash(clientIp, salt);

    // Madde 3: Fresh cache kontrol
    try {
      const cached = await cacheGet('full-report', chain, canonical);
      if (cached && cached.freshness === 'fresh') {
        recordCacheHit('fresh');
        return {
          status: 200,
          body: {
            report: cached.value,
            source: 'cache',
            freshness: 'fresh',
            savedAt: cached.savedAt,
          },
        };
      }

      // Stale cache: Hemen dön ama arka planda refresh başlat
      if (cached && cached.freshness === 'stale') {
        recordCacheHit('stale');

        // Refresh deduplication: Aynı asset için yalnızca bir refresh
        const lockAcquired = await acquireRefreshLock('full-report', chain, canonical);
        if (lockAcquired) {
          // Background refresh job oluştur
          this._enqueueRefreshJob(chain, canonical, key, walletHash, ipHash).catch(err => {
            console.error('[Orchestrator] Background refresh failed:', err.message);
          });
        }

        return {
          status: 200,
          body: {
            report: cached.value,
            source: 'cache',
            freshness: 'stale',
            savedAt: cached.savedAt,
            refreshing: lockAcquired,
          },
        };
      }
    } catch (err) {
      // Cache hatası, devam et
      console.error('[Orchestrator] Cache lookup error:', err.message);
    }

    recordCacheHit('expired');

    // Madde 4-5: Active job lock kontrol — deduplication
    const activeJob = findActiveJobByAsset(key);
    if (activeJob) {
      // Kullanıcıyı watcher olarak ekle
      addWatcher(activeJob.id, walletHash);
      return {
        status: 202,
        body: {
          jobId: activeJob.id,
          status: activeJob.status,
          stage: activeJob.stage,
          progress: activeJob.progress,
          queuePosition: activeJob.status === JOB_STATES.QUEUED ? queuePosition(activeJob.id) : 0,
          joined: true,
          message: 'Joining an active analysis',
        },
      };
    }

    // Madde 6: Kota reservation
    const identity = { wallet: walletHash, ip: ipHash };
    const access = this.riskAccess.begin(identity);
    if (!access.allowed) {
      return {
        status: 429,
        body: {
          error: 'Early access currently allows up to 3 analyses per hour. Please try again after your access window resets.',
          access,
        },
      };
    }

    // Madde 7: Kullanıcı başına job limiti kontrol
    const userJobs = countUserJobs(walletHash);
    if (userJobs.queued >= USER_LIMITS.maxQueuedJobs) {
      this.riskAccess.release(access.reservation);
      return {
        status: 429,
        body: {
          error: `Maximum concurrent analyses reached (${USER_LIMITS.maxActiveJobs} active + ${USER_LIMITS.maxQueuedJobs} queued). Please wait for a current analysis to complete.`,
          active: userJobs.active,
          queued: userJobs.queued,
        },
      };
    }

    // Madde 8: Job oluştur ve queue'a ekle
    const job = createJob({
      assetKey: key,
      chain,
      address: canonical,
      ownerWalletHash: walletHash,
      ownerIpHash: ipHash,
    });

    // BullMQ job'u oluştur
    try {
      const queue = getQueue('analysis-orchestrator');
      const bullJob = await queue.add('analyze', {
        jobId: job.id,
        chain,
        address: canonical,
        assetKey: key,
        reservation: access.reservation,
      }, {
        jobId: job.id,
        priority: 1,
      });

      updateJob(job.id, { bullmqJobId: bullJob.id });
    } catch (err) {
      // Queue hatası durumunda temizle
      this.riskAccess.release(access.reservation);
      updateJob(job.id, { status: JOB_STATES.FAILED, errorMessage: 'Queue unavailable' });
      return {
        status: 503,
        body: { error: 'Analysis service is temporarily unavailable. Please try again.' },
      };
    }

    return {
      status: 202,
      body: {
        jobId: job.id,
        status: JOB_STATES.QUEUED,
        queuePosition: queuePosition(job.id),
        estimatedWaitSeconds: this._estimateWait(queuePosition(job.id)),
      },
    };
  }

  /**
   * Job durumunu sorgular (GET /api/risk/analyses/:jobId).
   */
  getJobStatus(jobId, walletHash) {
    if (!canReadJob(jobId, walletHash)) return { status: 404, body: { error: 'Analysis not found' } };
    const job = findJob(jobId);
    if (!job) return { status: 404, body: { error: 'Analysis not found' } };

    const result = {
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      chain: job.chain,
      address: job.address,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    // Tamamlanmışsa report'u da ekle
    if (job.status === JOB_STATES.COMPLETED || job.status === JOB_STATES.COMPLETED_WITH_GAPS) {
      const report = findReport(job.assetKey);
      if (report) result.report = report;
    }

    // Hata varsa
    if (job.status === JOB_STATES.FAILED) {
      result.errorCode = job.errorCode;
      // Kullanıcıya güvenli hata mesajı (Bölüm 12: raw error verilmez)
      result.error = 'Analysis could not be completed. Please try again later.';
    }

    if (job.status === JOB_STATES.QUEUED) {
      result.queuePosition = queuePosition(job.id);
      result.estimatedWaitSeconds = this._estimateWait(result.queuePosition);
    }

    return { status: 200, body: result };
  }

  /**
   * Arka plan refresh job'u oluşturur (stale-while-revalidate).
   */
  async _enqueueRefreshJob(chain, address, key, walletHash, ipHash) {
    const job = createJob({
      assetKey: key,
      chain,
      address,
      ownerWalletHash: walletHash,
      ownerIpHash: ipHash,
    });

    const queue = getQueue('analysis-orchestrator');
    await queue.add('refresh', {
      jobId: job.id,
      chain,
      address,
      assetKey: key,
      isRefresh: true,
    }, {
      jobId: job.id,
      priority: 5, // Düşük öncelik
    });

    updateJob(job.id, { bullmqJobId: job.id });
  }

  /**
   * Tahmini bekleme süresi (saniye).
   */
  _estimateWait(position) {
    if (position <= 0) return 5;
    // Her pozisyon ~15 saniye (temel score hedefi)
    return Math.min(300, position * 15);
  }
}

module.exports = { AnalysisOrchestrator, canonicalAddress, assetKey, privacyHash };
