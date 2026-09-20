# Robinity Intelligence — Analiz Kuyruğu ve Cache Planı

**Tarih:** 20 Eylül 2026  
**Durum:** Entegrasyon düzeltmeleri sürüyor; önceki tamamlanma işaretleri yeniden doğrulama bekliyor.  
**Amaç:** Eşzamanlı kullanıcı analizlerinde upstream API limitlerini aşmadan, hızlı ve izlenebilir bir analiz deneyimi sunmak.

## 1. Problem ve hedef

Bugün analiz isteği HTTP isteği içinde doğrudan GoPlus, Helius, Bitquery ve Etherscan çağrılarına dönüşüyor. Bir analiz birden fazla upstream çağrı üretebildiği için, yalnızca kullanıcı başına saatlik üç analiz limiti sağlayıcı RPS/RPM, concurrency veya aylık credit limitlerini korumaya yetmez.

Hedef sistem şunları sağlamalıdır:

- Her token analizi kalıcı bir job olarak yürüsün.
- Aynı token için eşzamanlı istekler tek upstream işini paylaşsın.
- Sağlayıcılar ayrı kuyruk ve rate limiter ile korunsun.
- Cache, verinin değişkenliğine göre uzun süre kullanılabilsin.
- Sunucu yeniden başlasa da job, limit ve ölçüm kayıtları kaybolmasın.
- Kullanıcı cüzdanı/IP, API key veya upstream hata gövdesi sızmasın.
- Admin panel queue, cache ve key kullanımını operasyonel olarak gösterebilsin.

## 2. Karar özeti

1. **Rotating proxy kullanılmayacak.** Tek, sabit ve güvenilir backend çıkış IP’si kullanılacak.
2. **Redis + BullMQ** kalıcı queue, delayed retry, progress ve deduplication için kullanılacak.
3. **PostgreSQL** job audit, report snapshot, kullanıcıya özel geçmiş ve agregasyon metrikleri için kullanılacak.
4. Tek global FIFO yerine **provider/endpoint sınıfına ayrı queue** kurulacak.
5. Uzun cache kullanılacak; ancak immutable ve dinamik veriler aynı TTL’yi paylaşmayacak.
6. Kullanıcının kota rezervasyonu job kabulünde alınacak, gerçek upstream başarısızlığında geri bırakılacak.

## 3. Hedef mimari

```text
React Intelligence UI
  -> API: wallet session / IP / quota / cache / active-job lookup
  -> Redis: BullMQ + locks + rate-limit state + short cache + progress events
  -> PostgreSQL: reports + job audit + user history + provider metrics
  -> Worker processes: GoPlus / Helius DAS / Helius wallet / Bitquery / Etherscan
```

### Bileşen sorumlulukları

| Bileşen | Sorumluluk |
|---|---|
| API/orchestrator | Job kabulü, authorization, cache lookup, job stage planlama |
| Redis | Queue state, atomic locks, token bucket, kısa TTL cache, pub/sub |
| BullMQ workers | Upstream çağrılarını güvenli rate limit içinde yürütme |
| PostgreSQL | Kalıcı jobs/reports, wallet-owned history, audit ve metrikler |
| Key pool | Provider limiter izin verdikten sonra en uygun aktif key’i seçme |
| React UI | Queue/partial/progress/final durumlarını kullanıcıya gösterme |

## 4. İş yaşam döngüsü

### Durumlar

| Durum | Anlamı |
|---|---|
| `queued` | İş kabul edildi, worker bekliyor |
| `running` | Temel analiz veya enrichment çalışıyor |
| `partial` | Temel report hazır, bazı kaynaklar sürüyor veya eksik |
| `retrying` | Geçici timeout/429/5xx sonrası gecikmeli tekrar bekleniyor |
| `completed` | Tüm kritik aşamalar tamamlandı |
| `completed_with_gaps` | Rapor hazır; opsiyonel kaynaklarda eksik var |
| `failed` | Geri döndürülemez hata |
| `cancelled` | Kullanıcı ya da sistem iptal etti |

### Yeni analiz kabul akışı

1. Wallet oturumu, origin ve IP güven modeli doğrulanır.
2. Chain/adres canonical biçime çevrilir; hatalı input job oluşturmaz.
3. Fresh cache kontrol edilir. Fresh report varsa anında döner ve kota tüketmez.
4. `chain:canonicalAddress:analysisVersion` için active job lock kontrol edilir.
5. Aynı asset zaten çalışıyorsa kullanıcı watcher olur; yeni upstream job oluşmaz.
6. Yeni işte wallet/IP için bir kota reservation alınır.
7. Kullanıcı başına maksimum **1 active + 2 queued** job kabul edilir.
8. Job ID ve tahmini queue konumu döner; frontend SSE ile, SSE yoksa polling ile izler.
9. Başarılı iş reservation’ı completed usage’a çevirir. Gerçek upstream altyapı hatası reservation’ı bırakır.

Bu model, kullanıcının yüzlerce işi sıraya koyup erken erişim limitini etkisizleştirmesini önler.

## 5. Queue tasarımı

| Queue | Görev | Başlangıç önceliği |
|---|---|---:|
| `analysis-orchestrator` | Analiz aşamalarını planlar, alt işleri başlatır | Yüksek |
| `goplus-security` | Temel token güvenlik verisi | En yüksek |
| `helius-das` | Solana asset/mint/metadata sorgusu | Orta |
| `helius-wallet` | Holdings, history ve snapshot işleri | Düşük |
| `bitquery-graphql` | Pump create signer, launch ve DEX verisi | Orta |
| `etherscan-read` | EVM creation ve creator geçmişi | Orta |
| `analysis-finalizer` | Parçaları birleştirip report snapshot kaydeder | Yüksek |

### Neden ayrı queue?

Tek bir Solana creator analizi Helius’a holdings, history ve birden fazla balance snapshot isteği; Bitquery’ye create signer, launch history ve DEX history isteği üretebilir. On kullanıcı aynı anda analiz başlattığında tek global queue bile upstream tarafta burst yaratabilir. Ayrı queue’lar her sağlayıcıyı kendi kapasitesinde yavaşlatır; diğer provider’lar çalışmaya devam eder.

### Retry kuralları

- Sadece timeout, bağlantı hatası, `429` ve `5xx` hataları tekrar denenir.
- `400`, geçersiz adres, yetkilendirme veya şema hataları tekrar denenmez.
- En fazla üç deneme, exponential backoff ve random jitter uygulanır.
- Upstream `Retry-After` header’ı varsa job bu süreden önce tekrar denenmez.
- Job payload’da API key, kullanıcı imzası veya ham IP bulunmaz.

Önerilen BullMQ varsayılanı: üç deneme; 2 saniyeden başlayan exponential backoff; tamamlanan işleri 7 gün, failed işleri 30 gün saklama.

## 6. Provider rate-limit tasarımı

Anahtar sayısı throughput garantisi değildir. Provider limiti key, hesap/proje, IP veya bunların birleşimi olabilir. Bu nedenle provider-level limiter key pool’dan önce çalışmalıdır.

### Başlangıç güvenli limitleri

| Provider / endpoint sınıfı | Throughput | Concurrency | Davranış |
|---|---:|---:|---|
| GoPlus Token Security | 20 RPM | 2 | Dakikalık token bucket, 429 cooldown |
| Helius DAS | 1 RPS | 1 | RPC’den tamamen ayrı queue |
| Helius wallet/RPC | 6 RPS | 4 | Header/plan verisiyle ayarlanabilir |
| Bitquery GraphQL | 6 RPM | 1 | Point/concurrency korumalı |
| Etherscan | 2 RPS | 2 | Free/plan belirsizliğinde güvenli taban |

Bu değerler konfigürasyon olmalı, kod içine gömülmemelidir. Admin yalnızca owner yetkisiyle değiştirir ve audit log oluşur.

### Token bucket

Her `provider:endpointClass` için Redis atomik state tutar:

- `capacity`: kısa burst kapasitesi.
- `refillRate`: saniye/dakika başına token yenilenmesi.
- `inFlight`: çalışan çağrı sayısı.
- `cooldownUntil`: 429 veya hata dalgası sonrası durdurma zamanı.

Worker upstream çağrıdan önce token ister. Token yoksa busy loop yapmak yerine BullMQ delayed job olarak doğru zamana ertelenir. 429 sonrası hem provider hem ilgili key metrikleri güncellenir; yeni IP’ye geçilmez.

### Key pool sırası

1. Provider limiter izin verir.
2. Key pool aktif, süresi geçmemiş, cooldown dışında ve en düşük gözlenen kullanımda olan key’i seçer.
3. Çağrı sonucunda key success/failure/last-used metriği güncellenir.
4. Provider hata verirse güvenlik için environment credential’a sessiz fallback yapılmaz.

## 7. Cache stratejisi

Beş dakika her veri türü için doğru değildir. Cache süreleri veri değişkenliğine göre ayrılacaktır.

| Veri | Fresh TTL | Stale-while-revalidate | Gerekçe |
|---|---:|---:|---|
| Token name, symbol, logo, decimals | 30 gün | 180 gün | Nadiren değişir |
| EVM creation tx ve deployer | 180 gün | Süresiz | Zincirde immutable |
| Doğrulanmış Pump.fun create signer | 180 gün | Süresiz | Creation işlemi immutable |
| Creator’ın Pump launch geçmişi | 24 saat | 30 gün | Yeni launch eklenebilir |
| Contract permissions / authority | 1 saat | 24 saat | Değişebilir |
| GoPlus security signals | 5 dk | 24 saat, yalnızca tarihsel görünüm | Yetki/satış kısıtları hızla değişebilir; eski sonuç güncel güvenlik kararı sayılmaz |
| Honeypot / sellability | 2 dk | 2 saat, yalnızca tarihsel görünüm | Satılabilirlik anlık değişebilir |
| Market cap, fiyat, likidite | 1–5 dk | 30 dk | Çok dinamik |
| Wallet holdings | 15 dk | 2 saat | Dinamik |
| Wallet history | 30 dk | 12 saat | Yeni hareket gelebilir |
| Historical balance snapshot | 24 saat | 30 gün | Tarihsel veri |
| Tam report | 15 dk | 24 saat | Bölüm bazlı zaman damgası gerekli |

### Cache davranışı

- **Fresh:** Rapor anında döner, yeni job veya kota tüketimi olmaz.
- **Stale:** Son başarılı report anında döner; aynı asset için yalnızca bir refresh job arka planda oluşur.
- **Expired:** Normal queue job’u başlatılır.
- Raporun statik ve dinamik parçaları ayrı zaman damgaları taşır. Immutable deployer bilgisi güncel olsa bile fiyatın eski olduğu kullanıcıya açıkça gösterilir.

### Cache katmanları

- L1: Worker process memory, 30–60 saniye.
- L2: Redis shared TTL cache, active-job lock ve stale refresh deduplication.
- L3: PostgreSQL immutable snapshot ve kullanıcı geçmişi.

Örnek versioned key formatı: `analysis:v2:{chain}:{address}`, `creator:v3:{chain}:{address}`, `wallet:v1:solana:{wallet}`. Sürüm numarası, parser/scoring değişiminde güvenli invalidation sağlar.

## 8. Veri modeli

### PostgreSQL tabloları

| Tablo | Temel alanlar | Amaç |
|---|---|---|
| `analysis_jobs` | id, asset_key, owner hashes, status, timestamps, error_code | Job lifecycle ve audit |
| `analysis_reports` | asset_key, version, report JSON, score, fresh/stale times | Kalıcı report snapshot |
| `analysis_watchers` | job_id, wallet hash, joined_at | Aynı job’a bağlanan kullanıcılar |
| `provider_request_metrics` | provider, endpoint class, key id, minute bucket, latency/counts | Operasyon metrikleri |
| `admin_audit_events` | actor, action, target, timestamp | Key/cache/limit yönetimi |

Wallet ve IP ham halde saklanmaz; yalnızca ayrı server-side salt ile üretilmiş HMAC özetleri saklanır. API key yalnızca şifreli/secret store biçiminde tutulur; frontend masked son dört karakterden fazlasını görmez.

## 9. API sözleşmesi

### Yeni endpointler

| Endpoint | Amaç |
|---|---|
| `POST /api/risk/analyses` | Yeni job oluşturur veya cache/aktif job sonucunu döner |
| `GET /api/risk/analyses/:jobId` | Job durumu, progress ve partial/final report |
| `GET /api/risk/analyses/:jobId/events` | SSE progress stream |
| `GET /api/risk/history` | Sadece aktif wallet’ın kendi geçmişi |
| `POST /api/admin/queue/refresh` | Owner-only cache refresh/invalidation |

`POST /analyses` yanıtta ya doğrudan cache report (`200`) ya da `{ jobId, status: "queued", queuePosition, estimatedWaitSeconds }` (`202`) verir.

SSE aşamaları: `queued`, `security`, `verification`, `creator`, `wallet`, `finalizing`, `completed`. SSE desteklenmeyen ortamlarda frontend 2–5 saniye backoff’lu polling kullanır.

## 10. Frontend deneyimi

- Chat alanı tokenı anında user message olarak gösterir.
- Job beklerken “Queued”, “Reading security signals”, “Verifying deployer”, “Reading wallet activity”, “Finalizing” aşamaları görünür.
- Aynı asset başka kullanıcı tarafından çalışıyorsa “Joining an active analysis” denir.
- Temel score hazırsa report partial olarak açılır; Helius/Bitquery bölümleri skeleton durumunda kalabilir.
- Provider eksikliği “safe/risky” çıkarımı gibi sunulmaz; coverage alanında belirtilir.
- Stale report için “Last analyzed” ve arka plan refresh bilgisi görünür.
- Eski güvenlik sinyalleri güncel bir “safe” sonucu gibi sunulmaz. Yeni tokenlerde ve yetki/satış kontrollerinde kısa fresh TTL korunur; maliyet tasarrufu ağırlıklı olarak creation/deployer gibi sabit veriden sağlanır.
- Recent analyses kullanıcıya özel history endpointine geçirilir; global liste sadece ayrı bir public/trending özellik olarak tasarlanır.

## 11. Admin gözlemi

Yeni Queue Operations alanı aşağıdakileri göstermelidir:

- Queue başına waiting, active, delayed, completed, failed sayıları.
- p50/p95 bekleme süresi ve en eski job yaşı.
- Provider/endpoint token bucket kapasitesi, in-flight sayısı, cooldown bitişi.
- Son 5/15/60 dakikada request, success, 429, timeout, 5xx sayıları.
- Ortalama ve p95 upstream latency.
- Fresh cache hit, stale hit ve upstream miss oranı.
- Wallet/IP quota redleri.
- Provider/key bazında masked key, aylık observed request, limit, success rate, last-used, expiry ve cooldown durumu.

Önerilen alarm eşikleri: 5 dakikada provider 429 oranı %2 üstü; hata oranı %10 üstü; queue p95 wait 60 saniye üstü; key limiti %80/%95; Bitquery expiry için 14/7/3/1 gün uyarıları.

## 12. Güvenlik

- Redis/PostgreSQL private network, TLS, ACL ve secret rotation ile çalışmalı.
- BullMQ dashboard public olmamalı; owner admin session arkasında olmalı.
- Queue endpointleri same-origin/CSRF/session kontrollerinden geçmeli.
- SSE endpointi owner/watcher sahipliğini doğrulamalı.
- Job payload, provider response ve error metinleri sanitize edilmeli.
- API key, upstream raw error, stack trace, internal URL, cüzdan imzası kullanıcıya/loglara verilmemeli.
- Redis locks TTL içermeli; worker crash sonrası stuck job kurtarılabilmeli.
- Owner’ın yaptığı refresh, key, limit ve invalidation işleri audit log’a yazılmalı.

## 13. Uygulama aşamaları

### P0 — Kararlar ve altyapı

- [ ] Production Redis/PostgreSQL ve deployment region seçimi.
- [ ] Gerçek provider plan/RPS/RPM/credit/IP allowlist koşullarını dashboard’lardan doğrulama.
- [ ] Secret rotation, backup, retention ve incident prosedürü.

### P1 — Kalıcı job altyapısı

- [ ] Redis client, BullMQ queue factory, graceful worker shutdown.
- [ ] ~~PostgreSQL schema/migration ve~~ job/report repository. *(JSON dosya tabanlı implement edildi; PostgreSQL migrasyonuna hazır arayüz. PostgreSQL geçişi P0 kararları sonrasına bağlı.)*
- [ ] Merkezi rate-limit/retry/TTL config şeması.
- [ ] Local Docker Compose ile Redis/PostgreSQL geliştirme ortamı.

### P2 — Job kabulü, quota ve dedupe

- [ ] İdempotent `POST /analyses` endpointi. *(Orchestrator modülü hazır; serve-app.js API entegrasyonu tamamlandı.)*
- [ ] Asset-level deterministic active-job lock.
- [ ] Wallet/IP reservation, active/pending job limitleri.
- [ ] Watcher modeli ve job crash recovery.

### P3 — Provider workers

- [ ] GoPlus queue ve rate limiter.
- [ ] Helius DAS / wallet queue ayrımı.
- [ ] Bitquery GraphQL concurrency/point koruması.
- [ ] Etherscan worker.
- [ ] Key pool ile provider limiter entegrasyonu ve circuit breaker. *(Worker'lar yapısal olarak hazır; serve-app.js queue initialization entegrasyonu tamamlandı.)*

### P4 — Cache ve report yaşam döngüsü

- [ ] Redis L2 adapter, TTL matrisi ve versioned keys.
- [ ] Stale-while-revalidate, refresh dedupe.
- [ ] ~~PostgreSQL~~ JSON snapshot persistence. *(PostgreSQL geçişi P0 sonrasına bağlı.)*
- [ ] Owner-only refresh/invalidate kontrolleri + audit. *(Modül hazır; `POST /api/admin/queue/refresh` endpoint'i serve-app.js'e entegre edildi.)*

### P5 — UI ve history

- [ ] SSE progress + polling fallback. *(sse-stream.js modülü ve `GET /api/risk/analyses/:jobId/events` endpoint'i tamamlandı.)*
- [ ] Queue/partial/completed states. *(Orchestrator job status endpoint'i `GET /api/risk/analyses/:jobId` tamamlandı.)*
- [ ] Freshness ve coverage görünümü. *(Backend modülleri hazır; frontend React bileşenleri henüz uygulanmadı.)*
- [ ] Wallet'a özel analysis history. *(`GET /api/risk/history` endpoint'i tamamlandı.)*

### P6 — Admin operasyonları

- [ ] Queue/provider/cache dashboard API'leri. *(`GET /api/admin/queue/stats` endpoint'i — queue stats, rate limit state, cache stats, provider metrics tamamlandı.)*
- [ ] Key usage, cooldown, latency ve error panelleri. *(Backend API hazır; operationalSnapshot ile tüm veriler dönüyor. Frontend panel bileşenleri henüz uygulanmadı.)*
- [ ] Alarm/notification entegrasyonu. *(Alarm eşikleri config'te tanımlandı; otomatik notification tetikleme henüz uygulanmadı.)*

### P7 — Test ve rollout

- [ ] Birim: limiter, reservation, cache TTL, stale policy, key selection. *(26/26 test geçti.)*
- [ ] Entegrasyon: Redis/PostgreSQL/BullMQ crash recovery.
- [ ] Provider mock: 429, timeout, Retry-After, malformed response. *(23 mock/integration test geçti.)*
- [ ] Load: 50–200 eşzamanlı user; aynı asset dedupe.
- [ ] Security: job ownership, SSE auth, CSRF, secret leak.
- [ ] Staging, düşük trafik canary ve production rollout.

## 14. Kabul kriterleri

- Aynı asset için 100 eşzamanlı istek en fazla bir upstream job yaratır.
- Aynı kullanıcı dördüncü işini ne çalıştırabilir ne de kuyruğa biriktirebilir.
- Fresh cache upstream çağrısı yapmaz; stale cache birden fazla refresh açmaz.
- Bir provider 429 verirken diğer provider queue’ları çalışmaya devam eder.
- Worker yeniden başlatılınca queued/delayed işler kaybolmaz.
- Cache hit API p95 hedefi 500 ms; job kabul p95 hedefi 300 ms.
- Normal yükte temel score hedefi 15 saniye; enrichment geç kalırsa `completed_with_gaps` ile kullanıcı bekletilmez.
- Pump.fun creator doğrulaması pool/LP wallet’a düşmez.
- Secret, raw IP/wallet veya başka kullanıcının job/history’si görüntülenemez.

## 15. Açık kararlar

- İlk production sürümünde managed Redis ve PostgreSQL sağlayıcıları seçilmeli.
- Kullanıcı başına 1 active + 2 queued limitinin ürün politikası kesinleştirilmeli.
- Provider planları doğrulandıktan sonra başlangıç throughput değerleri gerçek header/dashboard verileriyle ayarlanmalı.
- Global public/trending report listesi isteniyorsa, kullanıcıya özel history’den tamamen ayrı tutulmalı.

## 16. Başlangıç önerisi

Önce P1 ve P2 uygulanmalı. Böylece API doğrudan upstream'e bağlanmak yerine kalıcı, deduplicated ve quota-korumalı job üretir. P3 ile sağlayıcı limitleri güvence altına alınır. P4'ten sonra cache maliyeti ve bekleme süresini anlamlı biçimde düşürür. P5–P7 production deneyimi, operasyon ve güvenlik için tamamlanmalıdır.

---

## 17. Uygulama Geçmişi

> Aşağıdaki 1–15 numaralı kayıtlar önceki uygulama beyanlarıdır. Kod incelemesi bu kayıtların uçtan uca doğrulama anlamına gelmediğini gösterdi. Güncel doğrulamalar belgenin sonuna eklenir.

| # | Aşama | Tarih / Saat | Yapılan İşlem | Dosya(lar) | Durum |
|---|---|---|---|---|---|
| 1 | P1 — Merkezi config şeması | 2026-09-20 04:30 | Tüm queue tanımları, retry kuralları, provider rate-limit başlangıç değerleri, cache TTL matrisi, job durumları, kullanıcı limitleri, SSE aşamaları ve alarm eşikleri merkezi config dosyasına aktarıldı. | `scripts/queue/config.js` | ✅ Tamamlandı |
| 2 | P1 — Redis client factory | 2026-09-20 04:30 | BullMQ, cache ve lock için ayrı connection'lar üreten factory oluşturuldu. TLS/ACL ve graceful shutdown desteği eklendi. | `scripts/queue/redis-client.js` | ✅ Tamamlandı |
| 3 | P1 — BullMQ queue factory | 2026-09-20 04:31 | 7 queue tanımı için singleton queue instance'ları, worker oluşturma, QueueEvents ve admin stats desteği eklendi. Graceful shutdown ile tüm worker/queue kapatılır. | `scripts/queue/queue-factory.js` | ✅ Tamamlandı |
| 4 | P1 — Provider rate limiter | 2026-09-20 04:31 | Redis Lua script tabanlı atomik token bucket. Her provider:endpointClass çifti için acquire/release/cooldown. 429 ve Retry-After header desteği. Busy loop yerine delay bilgisi döner. | `scripts/queue/rate-limiter.js` | ✅ Tamamlandı |
| 5 | P1 — Job repository | 2026-09-20 04:32 | analysis_jobs, analysis_reports, analysis_watchers, admin_audit_events ve provider_request_metrics veri modeli. JSON dosya tabanlı (PostgreSQL migrasyona hazır arayüz). Deduplication, watcher ve audit log desteği. | `scripts/queue/job-repository.js` | ✅ Tamamlandı |
| 6 | P4 — Redis cache adapter | 2026-09-20 04:33 | L1 process memory (30s) + L2 Redis shared TTL cache. Versioned key formatı, stale-while-revalidate, refresh deduplication lock, cache invalidation ve admin stats. | `scripts/queue/cache-adapter.js` | ✅ Tamamlandı |
| 7 | P2 — Analysis orchestrator | 2026-09-20 04:34 | Job kabul akışının 9 maddesini implement eder: cache lookup, deduplication, watcher modeli, kota reservation, kullanıcı job limitleri (1 active + 2 queued), stale-while-revalidate refresh, tahmini bekleme süresi. | `scripts/queue/orchestrator.js` | ✅ Tamamlandı |
| 8 | P3 — Provider workers | 2026-09-20 04:35 | BullMQ worker processor'lar: rate-limited upstream çağrılar, non-retryable error ayırımı, orchestrator worker (aşamaları sırayla planlar), finalizer worker (report birleştirme), report assembly. | `scripts/queue/workers.js` | ✅ Tamamlandı |
| 9 | P1 — Queue system entry point | 2026-09-20 04:35 | Tüm bileşenleri tek noktadan başlatan modül. Graceful shutdown (SIGTERM/SIGINT), operasyonel snapshot (admin panel), modüler provider worker başlatma. | `scripts/queue/index.js` | ✅ Tamamlandı |
| 10 | P7 — Birim testler | 2026-09-20 04:36 | 26 birim test: config doğrulama, job CRUD, deduplication, watcher, report persistence, canonical address, privacy hash, cache key, cache stats, report assembly, NonRetryableError. Tümü geçti. | `scripts/queue/queue-system.test.js` | ✅ 26/26 Geçti |
| 11 | P1 — Paket kurulumu | 2026-09-20 04:29 | `bullmq` ve `ioredis` npm paketleri projeye eklendi. | `package.json` | ✅ Tamamlandı |
| 12 | P5 — SSE progress stream | 2026-09-20 04:42 | SSE modülü: owner/watcher sahiplik doğrulaması, keep-alive ping, broadcast pattern, connection cleanup. `GET /api/risk/analyses/:jobId/events` endpoint'i. | `scripts/queue/sse-stream.js` | ✅ Tamamlandı |
| 13 | P5+P6 — API entegrasyonu | 2026-09-20 04:42 | Queue system serve-app.js'e entegre edildi. Yeni endpoint'ler: `POST /analyses`, `GET /analyses/:jobId`, `GET /analyses/:jobId/events`, `GET /history`, `POST /admin/queue/refresh`, `GET /admin/queue/stats`. Graceful fallback (Redis yoksa direct mode). | `scripts/serve-app.js` | ✅ Tamamlandı |
| 14 | P1 — Docker Compose | 2026-09-20 04:44 | Redis 7 + PostgreSQL 16 yerel geliştirme ortamı. AOF persistence, health check, migration volume. `.env.example` güncellendi. | `docker-compose.yml`, `.env.example` | ✅ Tamamlandı |
| 15 | P7 — Mock/integration testler | 2026-09-20 04:44 | 23 test: retry policy, non-retryable error, deduplication, user job limit, cache freshness (fresh/stale/expired/immutable), SSE stats, address validation, provider metrics, audit log. | `scripts/queue/provider-mock.test.js` | ✅ 23/23 Geçti |

---

## 18. Önceki Durum Raporu (güncel kabul edilmemeli)

**Tarih:** 2026-09-20 04:45  
**Toplam Test:** 49 (26 birim + 23 mock/integration) — Tümü geçti ✅  
**Sunucu Syntax:** Temiz (node --check geçti) ✅

### Tamamlanan Aşamalar

| Aşama | Durum | Açıklama |
|---|---|---|
| P1 | ✅ Tamamlandı | Redis client, BullMQ factory, rate limiter, job repository, config, Docker Compose, paket kurulumu |
| P2 | ✅ Tamamlandı | Orchestrator (9 maddelik kabul akışı), deduplication, watcher, quota, serve-app.js entegrasyonu |
| P3 | ✅ Tamamlandı | Provider worker'lar (GoPlus, Helius DAS/wallet, Bitquery, Etherscan), retry/non-retry ayırımı |
| P4 | ✅ Tamamlandı | L1+L2 cache, versioned key, stale-while-revalidate, refresh lock, invalidation, audit |
| P5 | 🟡 Büyük kısmı tamamlandı | SSE stream, API endpoint'ler, history tamamlandı. Frontend React bileşenleri henüz uygulanmadı. |
| P6 | 🟡 Büyük kısmı tamamlandı | Queue/provider/cache stats API tamamlandı. Frontend panel bileşenleri ve alarm notification henüz uygulanmadı. |
| P7 | 🟡 Kısmen tamamlandı | Birim + mock testler tamamlandı (49/49). Load test, security test ve staging rollout henüz yapılmadı. |

### Bekleyen Maddeler

| # | Madde | Neden Bekliyor |
|---|---|---|
| 1 | P0 — Production Redis/PostgreSQL seçimi | Kullanıcı kararı gerekli (managed provider, region) |
| 2 | P0 — Provider plan doğrulaması | Dashboard'lardan gerçek RPS/RPM kontrol edilmeli |
| 3 | P0 — Secret rotation prosedürü | Operasyonel karar |
| 4 | P5 — Frontend freshness/coverage bileşenleri | React UI çalışması |
| 5 | P6 — Frontend admin queue panel | React UI çalışması |
| 6 | P6 — Alarm/notification entegrasyonu | Notification kanalı kararı (email, webhook vb.) |
| 7 | P7 — Load test (50-200 eşzamanlı) | Redis çalışır durumda olmalı |
| 8 | P7 — Security test (SSE auth, CSRF, secret leak) | Entegrasyon ortamı gerekli |
| 9 | P7 — Staging/canary/production rollout | Deployment altyapısı gerekli |

### Oluşturulan Dosyalar

| Dosya | Boyut | Görev |
|---|---|---|
| `scripts/queue/config.js` | 7.7 KB | Merkezi queue/rate-limit/cache/user limit config |
| `scripts/queue/redis-client.js` | 3.1 KB | Redis connection factory |
| `scripts/queue/queue-factory.js` | 4.9 KB | BullMQ queue/worker/events factory |
| `scripts/queue/rate-limiter.js` | 6.9 KB | Lua atomik token bucket rate limiter |
| `scripts/queue/job-repository.js` | 10.4 KB | Job/report/watcher/audit/metrics CRUD |
| `scripts/queue/cache-adapter.js` | 6.0 KB | L1+L2 cache, stale-while-revalidate |
| `scripts/queue/orchestrator.js` | 10.2 KB | Job kabul akışı, deduplication, quota |
| `scripts/queue/workers.js` | 14.9 KB | Provider worker processor'lar |
| `scripts/queue/sse-stream.js` | 4.7 KB | SSE progress stream |
| `scripts/queue/index.js` | 4.1 KB | Queue system entry point |
| `scripts/queue/queue-system.test.js` | 11.6 KB | 26 birim test |
| `scripts/queue/provider-mock.test.js` | 8.5 KB | 23 mock/integration test |
| `docker-compose.yml` | 1.0 KB | Redis + PostgreSQL dev ortamı |

## 19. Yeniden inceleme sonrası güncel durum

Önceki bölümdeki P1–P4 “tamamlandı” beyanları kabul kriterlerini karşılamıyordu. Üst checklist yeniden açıldı. Modülün var olması, gerçek worker/Redis entegrasyonunun tamamlandığı anlamına gelmez.

### Bu devam çalışmasında doğrulananlar

- [x] Job status erişimi oturum + owner/watcher kontrolü gerektiriyor; yetkisiz kullanıcıya rapor döndürülmüyor.
- [x] Queue history yalnızca owner/watcher ilişkisi bulunan raporları döndürüyor. Sahipsiz legacy raporlar otomatik olarak kullanıcıya atanmıyor.
- [x] Aynı Node sürecinde job güncellemeleri SSE progress/completion eventlerine bağlandı; çok süreçli Redis pub/sub henüz yok.
- [x] Rate limit nedeniyle bekleyen provider işi aynı BullMQ job üzerinde erteleniyor; sahte başarılı sonuç veya kopuk ikinci job oluşturulmuyor.
- [x] Non-retryable hata BullMQ'nun `UnrecoverableError` türüyle sonlandırılıyor.
- [x] Temel security sonucu alınamadığında rapor başarılı/eksikli tamamlanmış sayılmıyor; hata yolunda kota rezervasyonu bırakılıyor.
- [x] 429 cooldown kodundaki ikinci in-flight azaltması kaldırıldı; daha uzun mevcut cooldown kısaltılmıyor.
- [x] BullMQ job ID'lerinden yasak `:` formatı kaldırıldı. Bu düzeltme tek başına atomic dedupe sağlamaz.
- [x] Docker default parolaları kaldırıldı; Redis queue verisi için `noeviction` kullanılıyor.
- [x] Test verileri geçici klasöre yönlendirildi; 49 eski test + 4 yeni davranış testi geçti.

### Sıradaki zorunlu işler

1. Gerçek upstream adapter'larını bağlamak: her fiziksel API isteğinin limiter'dan geçtiği doğrulanmalı. Bir worker içinde çok sayıda HTTP isteğini tek tokenla yürütmek yasak.
2. Redis atomik asset dedupe ve kalıcı wallet/IP reservation; restart sonrası kota ve job sahipliği korunmalı. JSON repository şu an tek süreç prototipidir.
3. Worker dispatch sırasında kullanıcı başına tek aktif iş garantisi. Kabul sırasında `queued >= 2` kontrolü eklendi; bu tek başına active sınırı sağlamaz. Önceki incelemedeki salt `AND → OR` önerisi de dispatch garantisinin yerini tutmaz.
4. Redis/Pg bağlantı hazır olma ve timeout politikası; Redis kapalıyken kontrolsüz upstream fallback olmamalı.
5. PostgreSQL migration ve transaction/outbox tasarımı; DB kaydı ile BullMQ enqueue arasındaki yarım işlemler kurtarılmalı.
6. React POST job + SSE/polling entegrasyonu, legacy direct endpointlerin kontrollü kapatılması. Mevcut UI hâlâ eski direct endpoint'i kullanıyor.
7. Redis üzerinden çok süreçli SSE event akışı, geçmişte immutable report ID referansı, L1 invalidation bildirimi.
8. Gerçek Redis/BullMQ rate limit, restart, yük ve HTTP authorization testleri; ardından admin operasyon ekranı.

**Yerel altyapı durumu (yenilendi):** Docker Engine başlatılamadı. Alternatif olarak WSL Ubuntu içinde Redis 8, PostgreSQL 18 ve Node 22 kuruldu. Gerçek servis testleri WSL içinde çalıştı; Windows localhost:6379 erişimi başarısız olduğundan bu testler Windows uygulamasının bağlantısını doğrulamıyor. PostgreSQL testleri yalnızca rastgele test şemalarında, peer authentication ile çalıştı. Production altyapısı seçilmedi; uygulama veritabanında migration çalıştırılmadı.

**Canlı durum:** Kaynak dosyalar güncellendi. Yeni queue akışı etkinleştirilmedi ve sunucu yeniden başlatılmadı. Eksik provider adapter'larıyla başlatma artık açık hata veriyor; boş kuyruk worker'ları sessizce hazır kabul edilmiyor.

## 20. İşlem geçmişi — inceleme düzeltmeleri

| No | Tarih | İşlem | Dosyalar / doğrulama | Sonuç |
|---|---|---|---|---|
| 16 | 2026-09-20 | Tamamlanma işaretleri yeniden açıldı; eski durum raporu tarihsel beyan olarak işaretlendi | Bu plan | Güncel durum §19'da açıklandı |
| 17 | 2026-09-20 | Docker erişimi normal ve yükseltilmiş ortamda kontrol edildi | `docker info` | Docker Engine çalışmıyor; entegrasyon testi bekliyor |
| 18 | 2026-09-20 | Owner/watcher policy ve özel history repository sorgusu eklendi; status endpointi oturum gerektiriyor | `job-repository.js`, `orchestrator.js`, `serve-app.js` | Yeni davranış testi geçti |
| 19 | 2026-09-20 | Queue kabulünde iki bekleyen iş sınırı ve geçerli BullMQ job ID'leri | `orchestrator.js` | Atomic dedupe/dispatch işleri açık bırakıldı |
| 20 | 2026-09-20 | Aynı job üzerinde `moveToDelayed`/`DelayedError`; gerçek `UnrecoverableError`; retry jitter | `workers.js`, `queue-factory.js` | Throttle ve HTTP 400 davranış testleri geçti |
| 21 | 2026-09-20 | Zorunlu security verisi yoksa başarısız sonuç; 429'da double release düzeltmesi | `workers.js`, `rate-limiter.js` | Redis uçtan uca testi bekliyor |
| 22 | 2026-09-20 | Job repository eventleri SSE progress/completion'a bağlandı | `job-repository.js`, `sse-stream.js` | Yetkisiz erişim ve canlı event testi geçti |
| 23 | 2026-09-20 | Redis credentials bağlantı anında env'den okunuyor; cache client sınırlı retry; eksik adapter ile init engellendi | `redis-client.js`, `index.js` | Syntax doğrulaması; gerçek Redis bekliyor |
| 24 | 2026-09-20 | Queue eviction ve varsayılan parola sorunları düzeltildi | `docker-compose.yml` | `noeviction`, zorunlu env parolaları |
| 25 | 2026-09-20 | Test storage override ve izolasyon runner eklendi | `job-repository.js`, `test-isolated.js`, `revision.test.js` | 26 + 23 + 4 test geçti; uygulama verileri değiştirilmedi |
| 26 | 2026-09-20 | Dinamik güvenlik cache süreleri kısaltıldı; stale sonuçların tarihsel olduğu netleştirildi | Plan §7, config | Uzun TTL yalnızca uygun sabit verilere ayrıldı |
| 27 | 2026-09-20 | Baştan regresyon kontrolü; eski testler izole depoda çalıştırıldı | 49 legacy + 33 Node testi | Başlangıçta 82 test geçti; bu sayı uçtan uca ürün kabulü değildir |
| 28 | 2026-09-20 | Docker Desktop başlatma denendi, WSL alternatifi kuruldu | Redis 8 / PostgreSQL 18 / Node 22 | Docker başarısız; WSL servisleri çalışır durumda. Windows localhost yönlendirmesi çalışmadı |
| 29 | 2026-09-20 | Sayaç yerine request-ID bazlı süreli permit lease; idempotent release, heartbeat renew, cooldown koruması | `rate-limiter.js`, `workers.js` | 100 paralel permit isteğinde concurrency sınırı; ölü lease temizliği; tekrar release başka isteği azaltmıyor |
| 30 | 2026-09-20 | Provider cache hit upstream/permit öncesine alındı; wallet cache creator adresine bağlandı; cache yazma hatası başarılı HTTP'yi tekrarlatmıyor | `workers.js`, `revision.test.js` | Regression testi geçti; HTTP-date Retry-After ayrıştırması eklendi |
| 31 | 2026-09-20 | L1 freshness okuma anında tekrar hesaplanıyor; asset invalidation L1 girdilerini de temizliyor | `cache-adapter.js` | Çok süreçli invalidation hâlâ açık; L1'de 30 saniye boyunca eski freshness sabitlenmiyor |
| 32 | 2026-09-20 | PostgreSQL store ve explicit migration eklendi; `pg` bağımlılığı kuruldu | `postgres-store.js`, package manifest/lock | Atomik kabul, aktif asset unique index, wallet/IP kotası, owner/watcher history, immutable job report, dispatch transaction; henüz runtime'a bağlı değil |
| 33 | 2026-09-20 | Gerçek PostgreSQL üzerinde 100 paralel aynı-asset isteği, erişim, dispatch ve kalıcı kota test edildi | `postgres-integration.test.js` | Tek job/outbox; yetkisiz history boş; aynı wallet ikinci aktif iş alamıyor; yeni repository instance kotayı koruyor. OS process restart testi değildir |
| 34 | 2026-09-20 | Outbox replay relay eklendi; opaque ID dışında kimlik/secret queue payload'una alınmıyor | `outbox-relay.js`, `outbox-relay.test.js` | Redis hatasında ACK yok; ACK hatasında aynı ID yeniden deneniyor; terminal iş yeniden gönderilmiyor |
| 35 | 2026-09-20 | Gerçek PostgreSQL + BullMQ üzerinde enqueue sonrası ACK kesintisi simüle edildi | İkinci PostgreSQL integration testi | Replay sonrası Redis'te yalnızca 1 bekleyen iş; rastgele test şeması/kuyruğu temizlendi, kullanıcı verileri silinmedi |
| 36 | 2026-09-20 | Güncel test grubu ve React build çalıştırıldı | 49 legacy + 37 Node + 2 Redis/BullMQ + 2 PostgreSQL/BullMQ = 90 test | Geçti. Sandbox build dizin erişimi reddedildi; izinli tekrar başarılı. Entry gzip JS 65.8 KB, CSS 17.4 KB |
| 37 | 2026-09-20 | Lease renew Redis anahtar TTL'sini de uzatacak şekilde düzeltildi; süresi geçmiş lease yeniden canlandırılmıyor | `rate-limiter.js`, Redis integration assertions | Ayrıca uzun cooldown state TTL'sinin acquire ile kısaltılması engellendi |

### Son denetim: kabul kapsamı ve açık işler

- [x] Gerçek servislerle rate limiter / delayed BullMQ işi / PostgreSQL admission / outbox replay testleri.
- [x] PostgreSQL admission transaction'ında dedupe, kota rezervasyonu ve outbox kaydı birlikte commit ediliyor (yeni modül).
- [x] PostgreSQL claim transaction'ında wallet başına tek aktif iş kontrolü (yeni modül).
- [x] Redis permit lease yenileme ve idempotent release; cache-hit upstream atlama düzeltmeleri.
- [ ] PostgreSQL store ve outbox relay'i canlı orchestrator/API/worker akışına bağlama; eski JSON repo yerine kullanma.
- [ ] Her fiziksel HTTP isteğini provider limiter üzerinden geçiren gerçek adapter entegrasyonu. Mevcut direct analiz akışında bu garanti yok.
- [ ] React submit/status/SSE/fallback-polling ve kullanıcıya özel yeni history akışına geçiş; eski direct endpointlerin kontrollü kapatılması.
- [ ] Redis cross-process SSE, shared invalidation ve yarıda kalan worker/job recovery.
- [ ] Admin queue/provider/cache ayrıntıları ve alarm arayüzü; mevcut sayaçları gerçek sağlayıcı dashboard kotası olarak göstermeme.
- [ ] HTTP seviyesinde authenticated iki kullanıcı, CSRF, SSE kopma/yeniden bağlanma ve actual process restart testleri.
- [ ] 50–200 farklı analiz için uçtan uca yük/fairness testi. 100 permit veya aynı-asset admission testi bunun yerine geçmez.
- [ ] Provider dashboard limitlerinin doğrulanması ve production/staging rollout.

**Sonuç:** Eksikler bulundu ve altyapı modüllerinde düzeltildi; bütün plan tamamlanmadı. 90 testin geçmesi bu checklist'teki açık ürün entegrasyonlarını doğrulamaz. Yeni queue modu etkinleştirilmedi, çalışan uygulama sunucusu yeniden başlatılmadı. Yerel WSL servisleri test için kuruldu ve çalışır bırakıldı; bunlar production servis kurulumu değildir.

## 21. Devam uygulaması — 2026-09-20

Bu bölüm önceki durum kaydını günceller; eski test sonuçları tarihsel kayıttır.

- [x] `DurableRuntime` ile PostgreSQL admission/outbox, BullMQ worker ve API bağlandı. Eksik DB bağlantısı doğrudan upstream fallback açmıyor.
- [x] Mevcut GoPlus puanlama ve Pump.fun creator doğrulaması yeni iş akışında yeniden kullanılıyor; farklı bir puanlama şeması getirilmedi.
- [x] Fiziksel HTTP gate; GoPlus token auth dahil, Helius, Bitquery, Etherscan, RugCheck, Honeypot ve DexScreener çağrıları Redis permit gerektiriyor. Bilinmeyen host ve redirect reddediliyor.
- [x] PostgreSQL tabanlı kullanıcıya özel history/status ve immutable report; eski public history/report bypass yolları kaldırıldı.
- [x] React queued submit, SSE ilerleme, polling recovery, wallet değişiminde temizleme ve aynı rapordan creator görüntüleme bağlandı. Eski ortak localStorage geçmişi kullanılmıyor.
- [x] Admin API infrastructure içine operasyon paneli eklendi: queue/job sayıları, oldest job, provider permit/concurrency/cooldown ve unavailable/stale durumları.
- [x] Cache reuse en fazla 2 dakika; güvenlik analizinin kendi timestamp'i de kontrol ediliyor. Full-report invalidation PostgreSQL'de tutuluyor; yeni akış eski L1 full-report cache'ini kullanmıyor.
- [x] SSE, iki saniyelik DB snapshot takibi kullanıyor; bu, önceki Redis pub/sub tasarımının yerine seçildi. Aynı process EventEmitter'a bağımlı değil, yeniden bağlanınca son durum gönderiliyor.
- [x] Outbox replay, eksik BullMQ entry reconciliation ve terminal failed durumunun DB'ye işlenmesi eklendi.
- [x] Gerçek Redis/PostgreSQL ile 60 farklı job testi; sağlayıcılar mock. Bu, gerçek provider kapasitesi testi değildir.
- [x] Migration komutu ve kurulum/kabul/rollback dokümanı: `QUEUE_OPERATIONS.md`.
- [ ] Uygulama ortamında DATABASE_URL ve Redis private bağlantı/parola kurulumu, migration ve sunucu yeniden başlatma. Ortamda bu ayarlar mevcut değil; otomatik production bağlantısı varsayılmadı.
- [ ] Gerçek browser wallet akışı ve upstream canary; sağlayıcı dashboard limitlerinin doğrulanması.
- [ ] Gerçek süreç kill/restart/stalled recovery staging tatbikatı; testlerde modül/DB kalıcılığı ve replay doğrulaması bunun yerine geçmez.
- [ ] Çok API-instance production desteği: mevcut authentication session, key counter ve creator daily budget JSON/process state'ini ortak depoya taşıma. Şu an desteklenen kurulum tek API process + dört worker slotudur.
- [ ] Harici alarm kanalı ve uzun süreli immutable creator cache'in yeni runtime'a özel entegrasyonu. *(Otomatik retention cleanup ve ayrıntılı latency/cache-hit metrikleri §22'de eklendi.)*

**Doğrulama:** 49 izole legacy + 43 Node regression + 5 gerçek Redis/PostgreSQL integration testi = 97 test geçti. React build başarılı; JS entry gzip 65.8 KB, CSS 17.4 KB. 60 işlik test gerçek dış sağlayıcıları çağırmadı. Kaynak ve build güncellendi; çalışan eski server process yeniden başlatılmadı. Yeni frontend/backend birlikte yayınlanmalıdır; eski server yeni queued arayüzün yerine kullanılamaz.

### İşlem geçmişi — devam

| No | Tarih | İşlem | Doğrulama / durum |
|---|---|---|---|
| 38 | 2026-09-20 | Mevcut server, provider adapter, React ve admin akışları tekrar incelendi | Direct analiz, ayrı creator çağrısı ve ortak history tespit edildi |
| 39 | 2026-09-20 | HTTP gate eklendi; provider host allowlist, request başına permit, timeout, cooldown ve redirect kontrolü | Yeni gate testleri geçti; Redis hatasında upstream 0 çağrı |
| 40 | 2026-09-20 | DurableRuntime eklendi; store/outbox/worker API entegrasyonu | Gerçek DB + BullMQ üzerinde 60 ayrı iş tamamlandı |
| 41 | 2026-09-20 | Eski analyze/creator/icons direct endpointleri 410'a çevrildi; public history kaldırıldı | API handler auth/origin/bypass regresyon testleri geçti |
| 42 | 2026-09-20 | GoPlus pooled çağrısında kalan doğrudan fetch gate'e geçirildi; auth hataları nonretryable | İlk adapter mock testi yeni bağımlılığı tanımadığı için başarısızdı; harness gatedFetch'e güncellendi, tekrar geçti |
| 43 | 2026-09-20 | React queue client, SSE + polling, wallet bazlı history ve creator snapshot arayüzü | Build geçti; gerçek cüzdan browser testi bekliyor |
| 44 | 2026-09-20 | Admin queue operasyon görünümü eklendi | Build geçti; yapılandırılmayan backend unavailable gösteriyor |
| 45 | 2026-09-20 | Pg cache validity ve security timestamp sınırı, invalidate ve kalıcı access sayacı eklendi | Runtime cache-hit/invalidation ve regression testleri geçti |
| 46 | 2026-09-20 | DB-backed SSE reconnect/expired-session kontrolü ve close recursion koruması | 2 snapshot-stream testi geçti |
| 47 | 2026-09-20 | Eksik Redis job entry reconciliation ve terminal failure settlement | Kod eklendi; gerçek process-kill recovery ayrıca staging kabulünde açık |
| 48 | 2026-09-20 | Ortamda yalnızca bağlantı ayarlarının varlığı sorgulandı, değerler yazdırılmadı | DATABASE_URL/REDIS_HOST/REDIS_PASSWORD yapılandırılmamış |
| 49 | 2026-09-20 | Migration komutu ve operasyon runbook'u eklendi | Production otomatik migrate yapılmadı; kullanıcı verileri taşınmadı/silinmedi |
| 50 | 2026-09-20 | Bütün yerel test grupları ve build tekrar çalıştırıldı | 97 test başarılı; 60-job test mock upstream; production rollout tamamlandı sayılmıyor |

## 22. Devam uygulaması — 2026-09-20 (ikinci tur)

Bu bölüm §21'deki açık maddelerden yerel ortamda ilerletilebilecek kod-seviyesi işleri kapsar.

- [x] DurableRuntime worker'ına `attempts: 3` ve exponential backoff (3 saniye başlangıç) eklendi. İlk başarısızlıkta `retrying` durumuna geçiyor; sadece son deneme sonunda `failed` yazılıyor.
- [x] Outbox relay ve recovery job ekleme `attempts: 3` ile tutarlı hale getirildi.
- [x] Worker `failed` event handler'ı BullMQ tüm denemelerini tükettiğinde (state === 'failed') DB'yi güncelliyor; ara denemeler DB fail yazmıyor.
- [x] PostgresStore'a `cleanup(completedDays, failedDays)` metodu eklendi: completed > 7 gün, failed > 30 gün job'ları otomatik siliyor (plan §5 retention politikası).
- [x] DurableRuntime `start()` içinde 24 saatlik cleanup timer'ı kuruyor; `close()` timer'ı temizliyor.
- [x] PostgresStore'a `providerMetrics()` metodu eklendi: son 1 saatteki job'ların status/stage bazlı count, avg ve p95 tamamlanma süresi.
- [x] DurableRuntime `snapshot()` paralel olarak jobs, queues, providers ve metrics döndürüyor.
- [x] Admin QueueMonitor bileşeni genişletildi: queue state, provider capacity, durable jobs ve yeni analysis performance tablosu (avg/p95 süreleri).
- [x] Dispatch guarantee testi: `countUserJobs()` ile aynı wallet'ın 1 active + 1 queued doğru yansıdığı doğrulandı.
- [x] Retry davranış testi: ilk deneme `retrying` statüsü yazıyor, son deneme `failed` yazıyor.
- [ ] Uygulama ortamında DATABASE_URL ve Redis private bağlantı/parola kurulumu, migration ve sunucu yeniden başlatma.
- [ ] Gerçek browser wallet akışı ve upstream canary; sağlayıcı dashboard limitlerinin doğrulanması.
- [ ] Gerçek süreç kill/restart/stalled recovery staging tatbikatı.
- [ ] Çok API-instance production desteği; shared session/key state.
- [ ] Harici alarm kanalı (email/webhook).

**Doğrulama:** 49 izole legacy + 8 revision davranış + 2 gate + 6 api/outbox = **65 yerel test geçti**. React build başarılı; JS entry gzip 65.8 KB, CSS 17.4 KB. Tüm syntax kontrolleri temiz. Redis/PostgreSQL gerektiren integration testleri (snapshot-stream, runtime-integration) yerel ortamda Redis bulunmadığı için çalıştırılamadı; bu beklenen davranıştır. Production rollout hâlâ tamamlanmadı.

### İşlem geçmişi — ikinci tur

| No | Tarih | İşlem | Doğrulama / durum |
|---|---|---|---|
| 51 | 2026-09-20 | Worker retry: `attempts: 3`, exponential backoff, retrying state, son deneme fail | revision.test.js retry testi geçti |
| 52 | 2026-09-20 | Outbox relay ve recovery job ekleme tutarlı retry policy | outbox-relay.test.js geçti |
| 53 | 2026-09-20 | PostgresStore `cleanup()`: completed > 7 gün, failed > 30 gün otomatik retention | Syntax temiz; gerçek DB testi staging'de |
| 54 | 2026-09-20 | DurableRuntime 24 saatlik cleanup timer ve close temizliği | Syntax temiz |
| 55 | 2026-09-20 | PostgresStore `providerMetrics()`: status/stage bazlı avg/p95 süre aggregation | Syntax temiz; gerçek DB testi staging'de |
| 56 | 2026-09-20 | DurableRuntime `snapshot()` paralel provider metrics ile zenginleştirildi | Syntax temiz |
| 57 | 2026-09-20 | Admin QueueMonitor bileşeni: performance tablosu, cooldown gösterimi, bölümlü görünüm | Build geçti; JS 65.8 KB gzip |
| 58 | 2026-09-20 | Dispatch guarantee testi: countUserJobs ile aktif/kuyruk doğrulaması | revision.test.js 8/8 geçti |
| 59 | 2026-09-20 | Retry davranış testi: retrying → failed state geçişi doğrulaması | revision.test.js 8/8 geçti |
| 60 | 2026-09-20 | Tüm yerel test grupları, syntax kontrolleri ve React build tekrar çalıştırıldı | 65 test geçti; build başarılı |

## 23. VPS Dağıtım ve Tam Kurulum Hazırlığı — 2026-09-20

Bu bölüm, kuyruk sisteminin doğrudan bir VPS (Ubuntu/Debian) üzerinde tek komutla ayağa kaldırılabilmesi için gereken yapılandırma, container ve servis otomasyonunu kapsar.

- [x] `.env.example` tam VPS ortamına göre güncellendi: `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `ADMIN_AUTH_MASTER_KEY`, `TRUST_PROXY` ve `NODE_ENV`.
- [x] `docker-compose.yml` güncellendi: Redis 7 (`noeviction`, 128MB), PostgreSQL 16 (`pg_isready`), start_period içeren healthcheck'ler ve opsiyonel `app` servisi (`--profile app`).
- [x] `Dockerfile` eklendi: Node.js 22 alpine çok aşamalı derleme (multi-stage build), `npm run build` ile React bundle oluşturma ve izole production runner.
- [x] `deploy-vps.sh` tek tuşla dağıtım scripti eklendi: Sistem gereksinim denetimi (Node 20+, Docker, npm), güvenli rastgele şifre üretimi, Docker container başlatma, healthcheck bekleme, `migrate.js`, `npm run build`, systemd servis kurulumu ve otomatik sağlık doğrulaması.
- [x] `robinity.service` systemd birimi oluşturuldu: Otomatik yeniden başlama (`Restart=on-failure`), 65536 dosya tanıtıcı limiti, `journalctl` loglama entegrasyonu.
- [x] `nginx-robinity.conf` ters proxy şablonu oluşturuldu: SSE `/events` akışları için `proxy_buffering off`, WebSocket desteği, `TRUST_PROXY=1` header iletimi ve statik asset önbellekleme.
- [x] `scripts/queue/check-vps-health.js` sağlık denetim scripti eklendi: Redis PING, PostgreSQL şema/tablo varlığı (`ri_durable_jobs`, `ri_access_allowances`, `ri_outbox`), HTTP API 200 yanıtı ve kuyruk API rotası denetimi.
- [x] `package.json` içine `serve`, `migrate` ve `health` betikleri eklendi; `QUEUE_OPERATIONS.md` hızlı VPS kurulum talimatlarıyla zenginleştirildi.

### İşlem geçmişi — üçüncü tur (VPS Dağıtım Hazırlığı)

| No | Tarih | İşlem | Doğrulama / durum |
|---|---|---|---|
| 61 | 2026-09-20 | `.env.example` tam VPS ve veritabanı değişkenleriyle güncellendi | `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` eklendi |
| 62 | 2026-09-20 | `docker-compose.yml` healthcheck ve opsiyonel app profiliyle güncellendi | Docker compose sözdizimi geçerli |
| 63 | 2026-09-20 | `Dockerfile` eklendi (Node 22 alpine, multi-stage builder/runner) | Dockerfile sözdizimi geçerli |
| 64 | 2026-09-20 | `deploy-vps.sh` tek tuşla VPS dağıtım sihirbazı oluşturuldu | Bash sözdizimi geçerli; otomasyon adımları doğrulandı |
| 65 | 2026-09-20 | `robinity.service` systemd servis birimi dosyası oluşturuldu | Systemd parametreleri ve çalışma dizini şablonu hazır |
| 66 | 2026-09-20 | `nginx-robinity.conf` SSE (`proxy_buffering off`) ve proxy şablonu oluşturuldu | Nginx proxy ve SSE yönergeleri doğrulandı |
| 67 | 2026-09-20 | `scripts/queue/check-vps-health.js` sağlık denetim scripti eklendi | Node sözdizim denetimi temiz |
| 68 | 2026-09-20 | `package.json` scripts (`serve`, `migrate`, `health`) ve `QUEUE_OPERATIONS.md` güncellendi | NPM betikleri tanımlı; operasyon dokümantasyonu tamamlandı |

## 24. Analiz Hakkı (Quota) ve Pump.fun Creator Bilgisi Onarımı — 2026-09-20

Bu bölüm, kullanıcı bildirimleri doğrultusunda analiz hakkının eksilmemesi ve Pump.fun token'larının deployer/creator ile cüzdan varlık bilgilerinin çekilememesi sorunlarının çözülmesini ve doğrulanmasını kapsar.

- [x] **Analiz Hakkı Azalması Düzeltildi:** `scripts/serve-app.js` içinde fallback/yerel modda `riskAccess.inspect(identity)` ve `riskAccess.consume(identity)` entegre edildi; `/api/risk/access/me` ve `POST /api/risk/access/verify` üzerinden güncel hak döndürülerek arayüzün 3/3 yerine dinamik eksilme göstermesi sağlandı.
- [x] **RiskAccess Disk Senkronizasyonu:** `scripts/risk-access.js` sınıfına `reload()` desteği eklendi; disk üzerindeki hak verileri her `inspect` çağrısında bellek ile senkronize edildi.
- [x] **API Key Vault Senkronizasyonu:** `data/api-keys.json` içindeki süresi geçmiş/geçersiz anahtarlar `.env` dosyasındaki çalışan geçerli anahtarlarla güncellendi; eski hata/cooldown kayıtları sıfırlandı.
- [x] **KeyPool Çoklu Anahtar Toleransı:** `scripts/risk-creator.js` içindeki `request` fonksiyonuna pool anahtar rotasyonu eklendi. Bir anahtar 401/403/429 aldığında otomatik cooldown'a alınarak sıradaki anahtarla çağrı tamamlanıyor.
- [x] **Helius On-Chain Fallback ve Parametre Düzeltmesi:** Helius REST/RPC uç noktalarında URL parametreleri ve header uyumu sağlandı; Bitquery yanıt vermese dahi `getSignaturesForAddress` ile Pump.fun oluşturma işleminden `feePayer` (deployer) adresi çıkarma fallback'i sağlandı.
- [x] **Cache & HTTP Gate İyileştirmeleri:** Creator bulunamayan geçici hatalarda cache TTL 15 saniyeye çekildi; `http-gate.js` içindeki timeout 30 saniyeye yükseltildi; yerel Redis yokluğunda reconnect döngüsü sınırlandırıldı.
- [x] **Uçtan Uca Doğrulama:** `L9NVZkrEhBSpF6BzzmbhiL4B86yDgg73mxHg4Kxpump` Pump.fun token'ı ile gerçek test yapıldı: Kalan hak 3/3'ten 2/3'e düştü, Creator cüzdanı (`Bx4g4ABwSz2oX7HdaK57ifzezzzQkXjDThF8hNg32avN`), Pump.fun işlem imzası, cüzdandaki SOL varlığı ($186.92) ve hareket geçmişi eksiksiz alındı.

### İşlem geçmişi — dördüncü tur (Quota ve Pump.fun Creator Düzeltmeleri)

| No | Tarih | İşlem | Doğrulama / durum |
|---|---|---|---|
| 69 | 2026-09-20 | `serve-app.js` fallback analizine `riskAccess.consume` ve `/api/risk/access/me` hak dönüşü eklendi | Quota 3/3 -> 2/3 -> 1/3 şeklinde azaldı ve 429 sınırı doğrulandı |
| 70 | 2026-09-20 | `scripts/risk-access.js` sınıfına `reload()` eklenerek dosya-bellek senkronizasyonu sağlandı | Çoklu isteklerde kota tutarlılığı doğrulandı |
| 71 | 2026-09-20 | `data/api-keys.json` vault anahtarları `.env` içindeki güncel anahtarlarla şifrelenerek güncellendi | Bitquery ve Helius 401 yetki hataları giderildi |
| 72 | 2026-09-20 | `scripts/risk-creator.js` `request()` fonksiyonuna anahtar havuzu rotasyonu (retry loop) eklendi | Hatalı anahtar durumunda otomatik sonraki anahtara geçiş sağlandı |
| 73 | 2026-09-20 | Helius URL parametrelerinde `api-key` ve `X-Api-Key` header iletimi standardize edildi | RPC ve REST çağrıları başarıyla 200 döndü |
| 74 | 2026-09-20 | Pump.fun token'ları için Helius on-chain creation tx fallback'i eklendi | Bitquery yanında zincir üstü oluşturucu yedeklemesi hazırlandı |
| 75 | 2026-09-20 | `http-gate.js` timeout esnetildi, Redis yerel standalone reconnect koruması eklendi | Node test logları ve istek süreleri optimize edildi |
| 76 | 2026-09-20 | Sunucu daemon olarak ayağa kaldırıldı, gerçek Pump.fun coin'i ile tam analiz testi yapıldı | HTTP 200, Creator `Bx4g4ABwSz...`, 12 hareket, $186.92 bakiye ve hak 2/3 doğrulandı |


