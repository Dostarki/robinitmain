/**
 * SSE Progress Stream
 * ANALYSIS_QUEUE_CACHE_IMPLEMENTATION_PLAN — Bölüm 9, P5
 *
 * SSE aşamaları: queued, security, verification, creator, wallet, finalizing, completed.
 * SSE desteklenmeyen ortamlarda frontend 2–5 saniye backoff'lu polling kullanır.
 *
 * SSE endpointi owner/watcher sahipliğini doğrulamalı (Bölüm 12).
 */

const { findJob, getWatchers, jobEvents } = require('./job-repository');
const { JOB_STATES, SSE_STAGES } = require('./config');

/**
 * Aktif SSE bağlantılarını job bazında takip eder.
 * Map<jobId, Set<response>>
 */
const sseConnections = new Map();
jobEvents.on('updated', job => {
  if ([JOB_STATES.COMPLETED, JOB_STATES.COMPLETED_WITH_GAPS, JOB_STATES.FAILED, JOB_STATES.CANCELLED].includes(job.status)) {
    broadcastCompletion(job.id, job.status);
  } else {
    broadcastProgress(job.id, job.stage, job.progress, { status: job.status });
  }
});

/**
 * SSE response başlatır.
 * @param {http.ServerResponse} response
 * @param {string} jobId
 * @param {string} walletHash - Bağlantı sahibinin wallet hash'i
 * @returns {boolean} Bağlantı kuruldu mu
 */
function startSSE(response, jobId, walletHash) {
  const job = findJob(jobId);
  if (!job) return false;

  // Sahiplik doğrulama (Bölüm 12): Owner veya watcher olmalı
  const isOwner = job.ownerWalletHash === walletHash;
  const isWatcher = getWatchers(jobId).some(w => w.walletHash === walletHash);
  if (!isOwner && !isWatcher) return false;

  // SSE headers
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx proxy uyumluluğu
  });

  // İlk event: Mevcut durum
  sendSSEEvent(response, 'status', {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
  });

  // Job zaten tamamlanmışsa, son durumu gönder ve kapat
  if ([JOB_STATES.COMPLETED, JOB_STATES.COMPLETED_WITH_GAPS, JOB_STATES.FAILED, JOB_STATES.CANCELLED].includes(job.status)) {
    sendSSEEvent(response, 'done', {
      jobId: job.id,
      status: job.status,
    });
    response.end();
    return true;
  }

  // Bağlantıyı kaydet
  if (!sseConnections.has(jobId)) {
    sseConnections.set(jobId, new Set());
  }
  sseConnections.get(jobId).add(response);

  // Bağlantı kapandığında temizle
  response.on('close', () => {
    const connections = sseConnections.get(jobId);
    if (connections) {
      connections.delete(response);
      if (connections.size === 0) sseConnections.delete(jobId);
    }
  });

  // Keep-alive ping (30 saniyede bir)
  const pingInterval = setInterval(() => {
    try {
      response.write(': ping\n\n');
    } catch {
      clearInterval(pingInterval);
    }
  }, 30000);

  response.on('close', () => clearInterval(pingInterval));

  return true;
}

/**
 * SSE event gönderir.
 */
function sendSSEEvent(response, eventType, data) {
  try {
    response.write(`event: ${eventType}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Bağlantı kapanmış olabilir
  }
}

/**
 * Bir job'a bağlı tüm SSE client'lara progress bildirir.
 * Worker'lardan çağrılır.
 */
function broadcastProgress(jobId, stage, progress, extra = {}) {
  const connections = sseConnections.get(jobId);
  if (!connections || connections.size === 0) return;

  const data = {
    jobId,
    stage,
    progress,
    timestamp: Date.now(),
    ...extra,
  };

  for (const response of connections) {
    sendSSEEvent(response, 'progress', data);
  }
}

/**
 * Job tamamlandığında tüm SSE client'lara bildirir ve bağlantıları kapatır.
 */
function broadcastCompletion(jobId, status, report = null) {
  const connections = sseConnections.get(jobId);
  if (!connections || connections.size === 0) return;

  const data = {
    jobId,
    status,
    timestamp: Date.now(),
    hasReport: !!report,
  };

  for (const response of connections) {
    sendSSEEvent(response, 'done', data);
    try { response.end(); } catch {}
  }

  sseConnections.delete(jobId);
}

/**
 * Admin: Aktif SSE bağlantı sayısı.
 */
function getSSEStats() {
  let totalConnections = 0;
  for (const connections of sseConnections.values()) {
    totalConnections += connections.size;
  }
  return {
    activeJobs: sseConnections.size,
    totalConnections,
  };
}

module.exports = {
  startSSE,
  broadcastProgress,
  broadcastCompletion,
  getSSEStats,
  sseConnections,
};
