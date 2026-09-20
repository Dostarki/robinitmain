const path = require('node:path');
const http = require('node:http');
const { Pool } = require('pg');
const Redis = require('ioredis');

try { process.loadEnvFile(path.join(__dirname, '..', '..', '.env')); } catch (e) {
  if (e.code !== 'ENOENT') console.warn('Uyarı: .env dosyası okunamadı:', e.message);
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

async function checkRedis() {
  process.stdout.write('  [1/4] Redis Bağlantısı... ');
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD || undefined;

  const redis = new Redis({
    host,
    port,
    password,
    db: Number(process.env.REDIS_DB || 0),
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong === 'PONG') {
      console.log(`${GREEN}BAŞARILI${RESET} (${host}:${port})`);
      await redis.quit();
      return true;
    }
    throw new Error('Beklenmeyen yanıt: ' + pong);
  } catch (err) {
    console.log(`${RED}BAŞARISIZ${RESET} - ${err.message}`);
    try { redis.disconnect(); } catch {}
    return false;
  }
}

async function checkPostgres() {
  process.stdout.write('  [2/4] PostgreSQL Bağlantısı ve Şema... ');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log(`${RED}BAŞARISIZ${RESET} - DATABASE_URL ortam değişkeni tanımlı değil`);
    return false;
  }

  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  try {
    const res = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname = current_schema()');
    const tables = res.rows.map(r => r.tablename);
    const required = ['ri_durable_jobs', 'ri_access_allowances', 'ri_outbox'];
    const missing = required.filter(t => !tables.includes(t));

    if (missing.length === 0) {
      console.log(`${GREEN}BAŞARILI${RESET} (Tablolar hazır: ${required.join(', ')})`);
      await pool.end();
      return true;
    } else {
      console.log(`${YELLOW}EKSİK TABLOLAR${RESET} - Bulunamayanlar: ${missing.join(', ')}`);
      console.log(`        Çözüm: 'node scripts/queue/migrate.js' çalıştırın.`);
      await pool.end();
      return false;
    }
  } catch (err) {
    console.log(`${RED}BAŞARISIZ${RESET} - ${err.message}`);
    try { await pool.end(); } catch {}
    return false;
  }
}

async function checkApi() {
  process.stdout.write('  [3/4] Node.js Web/API Sunucusu (Port 4173)... ');
  const port = Number(process.env.TEST_PANEL_PORT || 4173);

  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/risk/access/me`, { timeout: 4000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`${GREEN}BAŞARILI${RESET} (HTTP 200 OK)`);
          resolve(true);
        } else {
          console.log(`${RED}BAŞARISIZ${RESET} (HTTP ${res.statusCode}: ${body.slice(0, 80)})`);
          resolve(false);
        }
      });
    });

    req.on('error', err => {
      console.log(`${RED}BAŞARISIZ${RESET} - Sunucu yanıt vermiyor (${err.message})`);
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`${RED}ZAMAN AŞIMI${RESET} - Port ${port} yanıt vermedi`);
      resolve(false);
    });
  });
}

async function checkQueueStats() {
  process.stdout.write('  [4/4] Kuyruk Servisi Durumu... ');
  const port = Number(process.env.TEST_PANEL_PORT || 4173);

  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/admin/queue/stats`, { timeout: 4000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        // Admin yetkisi olmadan 401 beklenir, 503 kuyruğun hazır olmadığını gösterir
        if (res.statusCode === 401) {
          console.log(`${GREEN}BAŞARILI${RESET} (Kuyruk API rotası aktif, yetki kontrolü devrede)`);
          resolve(true);
        } else if (res.statusCode === 503) {
          console.log(`${YELLOW}UYARI${RESET} (HTTP 503: Kuyruk sistemi henüz başlatılamadı veya DB/Redis kapalı)`);
          resolve(false);
        } else if (res.statusCode === 404) {
          console.log(`${RED}BAŞARISIZ${RESET} (HTTP 404: Eski sunucu çalışıyor, kuyruk rotaları yüklenmemiş!)`);
          resolve(false);
        } else {
          console.log(`${GREEN}AKTİF${RESET} (HTTP ${res.statusCode})`);
          resolve(true);
        }
      });
    });

    req.on('error', () => {
      console.log(`${YELLOW}ATLANDI${RESET} (Sunucu kapalı)`);
      resolve(false);
    });
  });
}

async function main() {
  console.log(`\n${CYAN}====================================================${RESET}`);
  console.log(`${CYAN}   Robinity Intelligence — VPS Sağlık Denetimi      ${RESET}`);
  console.log(`${CYAN}====================================================${RESET}\n`);

  const r = await checkRedis();
  const p = await checkPostgres();
  const a = await checkApi();
  const q = await checkQueueStats();

  console.log(`\n----------------------------------------------------`);
  if (r && p && a && q) {
    console.log(`${GREEN}✔ TÜM KONTROLLER BAŞARILI! Sistem VPS'te canlıya hazır.${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${RED}✖ BAZI KONTROLLER BAŞARISIZ OLDU.${RESET}`);
    console.log(`Lütfen yukarıdaki hata mesajlarını ve çözüm önerilerini inceleyin.\n`);
    process.exit(1);
  }
}

main();
