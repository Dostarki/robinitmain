# Analysis queue: installation and acceptance

## Required private configuration

Configure `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` and, when required, `REDIS_USERNAME`/`REDIS_TLS` in the server environment. Never use frontend-prefixed variables or commit credentials. Redis and PostgreSQL must be reachable by the Node server on a private network. Use separate production credentials and an encrypted PostgreSQL connection per the hosting provider's requirements.

These connections are NOT configured in the current application environment. WSL test services do not automatically provide a working Windows server connection. Production provider, region, credentials, real provider-account budgets and a notification delivery channel have not been selected or verified.

## VPS Hızlı Dağıtım (Tek Tuşla Kurulum)

VPS ortamında (Ubuntu 22.04 / 24.04 veya Debian 12) kuyruk ve önbellek sistemini başlatmak için:

```bash
# 1. Proje dizinine gidin ve kurulum scriptini çalıştırın:
chmod +x deploy-vps.sh
sudo ./deploy-vps.sh
```

Bu script sırasıyla:
- Docker, Docker Compose ve Node.js sürümlerini denetler.
- `.env` yoksa otomatik olarak 32 baytlık rastgele şifrelerle `.env` oluşturur (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `ADMIN_AUTH_MASTER_KEY`).
- `docker compose up -d redis postgres` ile veritabanı ve Redis'i başlatır, sağlık kontrollerini bekler.
- `node scripts/queue/migrate.js` ile PostgreSQL tablolarını oluşturur.
- `npm run build` ile React frontend'ini derler.
- `robinity.service` systemd birimini kurar ve başlatır.
- `node scripts/queue/check-vps-health.js` ile tüm bileşenleri doğrular.

### Nginx ve SSL Kurulumu
1. `nginx-robinity.conf` dosyasını sunucuya kopyalayın:
   ```bash
   sudo cp nginx-robinity.conf /etc/nginx/sites-available/robinity.conf
   sudo ln -s /etc/nginx/sites-available/robinity.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
2. SSL sertifikası (Let's Encrypt):
   ```bash
   sudo certbot --nginx -d yourdomain.com
   ```

### Sağlık Kontrolü
Herhangi bir zamanda dağıtım durumunu doğrulamak için:
```bash
npm run health
# veya
node scripts/queue/check-vps-health.js
```

## Migration and startup

1. Back up the existing database; preserve application `data/` and the authentication encryption key.
2. Run `node scripts/queue/migrate.js` with migration privileges. This creates the queue schema without importing or assigning legacy shared reports to users.
3. Run the application with normal runtime database credentials. `QUEUE_AUTO_MIGRATE=1` is available for disposable local environments only; leave it unset in production.
4. Build with `npm run build`, then start `node scripts/serve-app.js`. Deploy frontend and backend together. The new frontend cannot use the old direct-analysis server.
5. Check authenticated `/api/admin/queue/stats`. A missing database/Redis dependency is an outage, not an empty healthy queue. Do not enable direct fallback.

## Current topology

- PostgreSQL is authoritative for jobs, immutable reports, watcher access, quotas and outbox.
- BullMQ executes durable jobs; replay uses an unchanged job ID. A reconciliation pass repairs missing queue entries for active DB jobs and settles terminal failures.
- SSE streams read durable DB snapshots every two seconds; the React client also polls every three seconds. This intentionally replaces process-local event delivery and survives missed notifications. Redis pub/sub is not required by this path.
- Completed report reuse lasts at most two minutes, bounded by the security analysis timestamp. Invalidation changes PostgreSQL cache eligibility, so another process cannot reuse an obsolete full report from L1.
- Every analysis HTTP call (including GoPlus token authentication, public validators and metadata) uses the Redis provider gate. Key rotation does not create extra provider capacity. The gate rejects unrecognized hosts and disallows redirects.
- Current full analysis workers share one API process (four worker slots). Do not horizontally scale API instances until shared authentication sessions, key accounting and creator daily-budget storage replace their existing process/JSON state. Multiple API processes are not production-ready merely because job storage is shared.

## Acceptance checks

Run the isolated legacy suite and Node regression suites. Real integration tests require Redis plus PostgreSQL. Existing Linux tests use peer-authenticated `postgres` and random `ri_test_*` schemas/queues. Never substitute application schema names into their cleanup statements.

1. Wallet A submits; wallet B cannot read A's job without explicitly joining that asset's analysis.
2. Three successful or reserved jobs exhaust hourly wallet/IP allowance; failed jobs release capacity.
3. Disconnect/reconnect SSE; the saved terminal report remains available through authorized polling.
4. Disable Redis: no direct provider request should bypass the gate. Restore service and confirm pending outbox/recovery delivery.
5. Kill and restart a real worker process while active; verify BullMQ stalled-job recovery and no duplicate committed quota. This destructive process-level drill remains a staging acceptance item.
6. Run real wallet-auth browser checks and a small provider-backed canary after dashboard limits are confirmed. The 60-job load test uses mock provider responses and is not proof of upstream capacity.

## Monitoring and rollback

The authenticated API infrastructure panel includes durable job states, BullMQ counts, provider in-flight permits and cooldowns. Existing per-key meters remain *locally observed requests*, not provider billing usage. Connection errors retain an explicit unavailable/stale indication. External email/webhook alerts are not configured.

Retain queue IDs while an outbox acknowledgement may be retried. Automated queue/report retention is not yet scheduled; review growth before a public launch. Do not purge active queues. On rollback, deploy the matching frontend/backend pair and keep PostgreSQL/outbox intact; do not re-enable unrestricted direct analysis to mask an outage.
