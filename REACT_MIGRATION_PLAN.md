# Robinity Intelligence — React geçiş planı

## 1. Amaç ve kapsam

Tüm kullanıcı arayüzlerini tek React uygulamasında toplamak; mevcut görsel kimliği, analiz geçmişini, admin kimlik doğrulamasını ve contract işlemlerini korumak. Bu doküman uygulama planıdır; geçiş henüz yapılmış değildir.

Kapsam: landing, intelligence, admin girişi, deployment ve curve yönetimi, API Infrastructure Monitor, mevcut test konsolu ve yasal sayfa. Node backend ve Solidity contractları frontend geçişi nedeniyle yeniden yazılmayacak veya deploy edilmeyecek.

React uygulamasının tarayıcıya yüklenmesi için tek bir `index.html` kabuğu bulunması normaldir. Sayfa içeriği, formlar, durumlar ve etkileşimler React componentlerinden üretilecek. HTML stringlerini React içine yerleştirmek, iframe kullanmak veya mevcut inline scriptleri çalıştırmak geçiş sayılmayacak.

## 2. Mevcut durum ve taşınacak davranışlar

| Kaynak | Mevcut yapı | Taşınacak işler |
|---|---|---|
| `app/landing.html` | HTML, inline CSS ve script | Presale görünümü, curve hesabı, ETH/USD dönüşümü, bölüm navigasyonu, rewards, footer |
| `app/landing-effects/src/scene.js` | Three.js, global DOM seçicileri | React yaşam döngüsüne bağlı sahne ve kaynak temizliği |
| `app/risk-ui/src/App.jsx` | React, bağımsız root | Analiz girdisi, komutlar, geçmiş, ikonlar, kademeli rapor ve loading |
| `app/risk-ui/src/CreatorInsights.jsx` | React | Creator analizinin mevcut davranışı |
| `app/admin.html` | HTML ve inline script | Wallet + TOTP, ağ/deployment seçimi, deploy, fund, sale/claim, treasury, log, API monitor |
| `app/index.html` | Bağımsız test konsolu | Testnet durum, quote, allocation, buy/claim, treasury ve işlem geçmişi |
| `app/legal.html` | Statik HTML | Terms, privacy ve risk metinleri, anchor bağlantıları |
| `scripts/serve-app.js` | HTTP server ve API | React build sunumu, route fallback, mevcut endpoint sözleşmeleri |
| `scripts/risk-creator.js`, `risk-metadata.js` | Backend servisleri | API bağlantılarının ve kullanım kayıtlarının korunması |

Şu an `build:risk` ve `build:landing` ayrı çıktılar üretiyor. React Router ve Vite mevcut package dosyasında bulunmuyor. Intelligence dışındaki ekranlar React state yerine DOM'a doğrudan yazıyor.

Önemli mevcut sınırlar:

- Landing satın alma ve X bağlama kontrolleri şu an gerçek işlem/OAuth akışına bağlı değil. Geçiş bunları kendiliğinden canlı hale getirmeyecek.
- Landing hedefi $100.000; eski test konsolunda $100 hedefli farklı deployment mevcut. Bunlar aynı veri modeliymiş gibi birleştirilmeyecek.
- Analiz geçmişi localStorage'da; deployment ve admin aktiviteleri backend'de. Mevcut veriler silinmeyecek.
- API monitor şifreli kayıt tutuyor ancak kayıtlı anahtarları sağlayıcı isteklerine seçip uygulayan katman yok. Mevcut sayaç bazı istekleri sağlayıcı adıyla bir kayda atfediyor; bu gerçek anahtar kullanımının kanıtı değil.
- Monitor'un aylık yüzdesi birikimli sayaçtan hesaplanıyor; dönem sıfırlama ve kredi birimi ayrımı yok. Bu haliyle doğru aylık kota raporu kabul edilmeyecek.
- Monitor'daki provider/label verileri `innerHTML` içinde kullanılıyor. React metin render'ına geçişte bu enjeksiyon yüzeyi kapatılacak.

## 3. Hedef teknoloji ve route yapısı

Önerilen yapı: React + TypeScript, Vite, React Router, mevcut ethers ve Three.js. Backend verisinin cache/yenileme/iptal yönetimi için TanStack Query kullanılacak. Bağımlılık sürümleri kurulum sırasında uyumluluk kontrolüyle seçilip lockfile'a sabitlenecek. Redux başlangıçta gerekli değil.

| Yeni route | Ekran | Eski adresin davranışı |
|---|---|---|
| `/` | Landing | Mevcut kök test konsolu `/console` adresine taşınır |
| `/landing` | Landing alias | `/` adresine yönlenir |
| `/intelligence` | Risk analizi | `/risk.html` ve `/risk` yönlenir |
| `/admin/login` | Wallet ve authenticator girişi | Oturumsuz admin isteklerinin hedefi |
| `/admin` | Deployment ve curve yönetimi | `/admin.html` yönlenir |
| `/admin/infrastructure` | API monitor | Admin menüsünden erişilir |
| `/console` | Eski test konsolu | `/index.html` buraya yönlenir |
| `/legal` | Yasal içerikler | `/legal.html` yönlenir; hash korunur |
| Diğer adresler | 404 ekranı | Bilinmeyen adres landing gibi görünmez |

`/landing.html#curve`, `#movement`, `#engagement` gibi bağlantılar korunacak. SPA route değişiminde scroll ve focus yönetilecek. `/api/*` veya eksik asset istekleri SPA HTML fallback'ine düşmeyecek.

## 4. Dosya ve component mimarisi

```text
web/
  index.html
  src/
    main.tsx
    app/                 # router, providers, error boundary
    layouts/             # PublicLayout, IntelligenceLayout, AdminLayout
    components/ui/       # Button, Field, Dialog, Card, Status, Table
    features/
      landing/           # Hero, Presale, Tape, CurveExplorer, Mechanics, Rewards
      intelligence/      # Composer, History, Report, CreatorInsights
      auth/              # WalletSignIn, TotpChallenge, TotpEnrollment
      deployments/       # selector, form, sequential deploy flow
      curve/             # status, buy/claim, funding, treasury
      infrastructure/    # provider cards, key form, quota, audit
      console/           # explicit legacy testnet configuration
      legal/
    hooks/               # wallet, ETH price, section navigation
    services/            # API client, chain configuration, contract adapters
    styles/              # tokens, shared base, scoped component styles
    types/
  public/assets/
scripts/
  serve-app.js
  ...existing backend services
src/                     # existing Solidity sources remain here
data/                    # private runtime state, never a public asset directory
```

Her sayfaya aynı header zorlanmayacak: marka ve UI bileşenleri ortak, intelligence sidebar'ı ve admin navigasyonu kendi layout'larında olacak. Route'lar lazy yüklenerek admin ABI/bytecode ve Three.js'in her kullanıcıya başlangıçta yüklenmesi engellenecek.

## 5. Veri ve durum yönetimi

- Form girdileri component state'inde string tutulacak. ETH/token işlem değerleri ethers parse/format ve bigint ile dönüştürülecek; transaction miktarları JavaScript float üzerinden hesaplanmayacak.
- Sunucu verisi query cache'inde tutulacak. Mutation sonrası yalnızca ilgili sorgular yenilenecek.
- Sorgu kimlikleri ağ, chainId, deploymentId, contract adresi ve gerektiğinde wallet adresini içerecek. Ağ/deployment değişince eski istek iptal edilecek; geç dönen cevap yeni ekrana yazılmayacak.
- Seçili deployment ve işlemdeki deployment ayrı tutulacak. Pending işlemin logu kullanıcı başka deployment seçse de ilk deployment'a bağlı kalacak.
- Wallet context yalnızca provider, hesap ve ağ bilgisini yönetecek. API admin oturumu backend cookie'si üzerinden doğrulanacak.
- TOTP, API key ve imza ticket'ları localStorage/query persistence/loglara yazılmayacak.
- Mevcut analiz storage anahtarları okunacak; yeni format gerekiyorsa versiyonlu, tekrar çalıştırılması güvenli migration uygulanacak. Başarılı doğrulamadan önce eski kayıtlar kaldırılmayacak.
- Shared admin state'in ilk alımı tamamlanmadan kullanıcı boş deployment listesiyle işlem yapamayacak. Polling görünür ve oturumu geçerli sayfalarda çalışacak.

## 6. Sayfa bazlı uygulama

### Landing

1. Mevcut markup gerçek JSX componentlerine ayrılır; pastel mavi/turuncu tema ve logo korunur.
2. Akış hero → presale → tape → curve → mechanics → engagement → footer olarak korunur.
3. Curve matematiği DOM'dan bağımsız saf fonksiyonlara çıkarılır. 200M arz, $0.0001 başlangıç ve $0.0009 bitiş fiyatıyla toplam integral $100.000 olmalıdır.
4. Sold miktarı `s` için spot fiyat `p0 + k*s`; alınan miktar `q` için maliyet `p(s)*q + k*q²/2` olarak hesaplanır. Kalan arz sınırı, sıfır miktar ve dolu curve ele alınır.
5. ETH fiyatı ortak hook üzerinden timestamp, loading, stale ve error durumlarıyla sunulur. Kur alınamazsa sabit kurla sonuç üretilmez. ETH/USD toggle miktarın ekonomik değerini korur.
6. Glass navigasyon IntersectionObserver ve sayfa sonu kuralıyla aktif bölümü belirler; Rewards/Mechanics çakışması mobilde de kontrol edilir.
7. Three.js ref ile bağlanır; unmount'ta RAF, observer, event listener, geometry, material ve renderer temizlenir. Reduced motion ve WebGL yokluğu için statik görünüm kullanılır.
8. Rewards/X ve presale'nin mevcut bağlantı durumu korunur; sahte hesap bağlantısı veya başarılı satın alma gösterilmez.

### Intelligence

Mevcut React kodu tekrar yazılmak yerine ortak uygulamaya aktarılır. Bağımsız `createRoot` kaldırılır; sayfa export edilir. Address/Pump.fun ayrıştırma, network seçimi, `!help`, `!clear`, `!refresh`, ikonlar, hover skorları, creator bilgileri ve kademeli rapor korunur. Eski cevapların yeni analizin üzerine yazılması AbortController veya request kimliğiyle engellenir. Animasyonlar ekran okuyucuya tüm metni tekrar tekrar okutmaz.

### Admin girişi ve oturum

Auth durumları açık biçimde modellenir: checking → signed out → signing → enrollment/challenge → authenticated. Sayfa yenilemede `/api/admin/me` okunur. 401/403 durumunda admin cache'i temizlenir, polling durur, giriş ekranı gösterilir. Wallet hesabı değişirse ayrıcalıklı işlemler durdurulur ve yeniden kimlik doğrulaması gerekir.

Role tabanlı React görünürlüğüne ek olarak bütün yetkiler backend'de doğrulanır. Owner-only admin ekleme kuralı korunur. Oturum sonlandırma endpoint'i eklenerek çıkış işlemi cookie ve sunucu oturumunu iptal eder.

### Deployment ve curve yönetimi

- Deployment selector, yeni deployment formu ve ağ seçimi bağımsız component olur.
- Tek deploy butonu token → receipt → curve → receipt → shared kayıt sırasını yürütür. Token başarılı, curve başarısız olduğunda token adresi korunur ve devam adımı sunulur; tekrar tıklama ikinci token deploy etmez.
- İsim/symbol controlled input olur; polling kullanıcının yazdığı taslağı sıfırlamaz.
- Set token + fund işlemi adımlara ayrılır; kısmi başarının durumu ve tx hash kaydedilir.
- Sale ve claim durumları on-chain okunur; bilinmeyen durum closed sayılmaz. İşlem onaylandıktan sonra durum yenilenir.
- Buy, claim, rate ve treasury işlemlerinde bağlı chain, contract ve yetki kontrol edilir. Çift tıklama engellenir; tüm işlemler wallet onayına bağlıdır.
- Ortak activity log ağ/deployment/işlem durumu filtrelerini ve aktör bilgisini korur.
- Mainnet veya testnet üzerinde otomatik deploy/transfer test amacıyla yapılmaz. Doğrulama mock veya yerel geliştirme zinciriyle yapılır.

### API Infrastructure Monitor

Bu sayfa `/admin/infrastructure` altında gerçek React ekranı olur. Ancak tamamlanmış sayılması için mevcut backend eksikleri de giderilir:

1. Sabit provider kataloğu oluşturulur; her provider'ın credential alanları tanımlanır. GoPlus app key + app secret ile access token farklı türlerdir.
2. Backend credential resolver, seçili aktif vault kaydını gerçek adapter'a bağlar. Ortam değişkeni fallback kuralı açık olur; paused kaydın arkasından sessizce env key ile devam edilmez.
3. Provider yalnız allowlist'teki host/endpoint'lere istek atar. Formdan key test URL'si kabul edilmez.
4. İstek kaydı kullanılan credential kimliği, provider, endpoint kategorisi, sonuç, süre ve timestamp içerir. Secret, query-string key veya ham upstream hata gövdesi kaydedilmez.
5. Tüm provider yolları kapsanır: ana analiz, creator analizi ve metadata. Aynı provider için kullanılan başka anahtarın çağrıları yeni eklenen key'e yazılmaz.
6. Requests ve credits ayrı tutulur. Plan kotası, dönem başlangıcı/bitişi, harici kullanımın sayılıp sayılmadığı gösterilir. Provider kota API'si yoksa değer açıkça uygulamada takip edilen tahmin olarak sunulur; bilinmeyen kullanım 0% yapılmaz.
7. Son başarılı çağrı, auth hatası, 429, key son değiştirme ve bilinen expiry gösterilir. Auth hatası, kota dolması ve network hatası farklı aksiyon önerir.
8. Key ekleme/rotation password alanlı dialog üzerinden yapılır. Maskeli liste döner; secret okuma endpoint'i olmaz. Kaydetme tamamlanınca form ve geçici secret state temizlenir.
9. Owner mutasyonları backend'de kontrol edilir; tüm adminler yalnız maskeli durum ve kullanım görebilir. Değişiklikler secretsiz audit kaydına yazılır.
10. Rotation geçmiş kullanım/audit verisini silmez. Eski key kaydı ve yeni sürüm ilişkilendirilir; önceki key'in sağlayıcı tarafında iptali ayrı bir işlemdir.

### Test konsolu ve legal

Test konsolu `/console` altında ayrı testnet config ile korunur. Hardcoded legacy deployment landing'in canlı config'ine taşınmaz. Legal sayfası ortak footer ile React'e geçirilir; `#terms`, `#privacy`, `#risks` bağlantıları çalışır. Kullanıcıya görünen yeni metinler İngilizce olur; mevcut konsoldaki Türkçe metinler anlam korunarak İngilizceye çevrilir.

## 7. Güvenlik ve sunum

React'e geçmek tek başına güvenlik sağlamaz. Mevcut wallet + TOTP girişinin sunucu kontrolleri korunup test edilecek.

- Tüm admin mutasyonlarında tutarlı Origin/CSRF doğrulaması, JSON content type ve body boyut sınırı uygulanır. Mevcut key ekleme dışındaki endpoint'lerin de kapsanması gerekir.
- Auth denemeleri IP ve challenge/ticket bazında sınırlandırılır. Yanlış uzunlukta TOTP kontrollü reddedilir; ticket expiry, nonce tek kullanımı ve TOTP tekrar kullanım politikası test edilir.
- Session doğrulamasında admin yetkisinin hâlâ geçerli olduğu kontrol edilir. Production cookie Secure, HttpOnly ve SameSite olacak; HTTPS ortamı doğrulanır.
- API anahtarları AES-GCM ile saklanır; master key web kökü, frontend env veya bundle'a alınmaz. Dosya izinleri Windows ACL ve production ortamında ayrıca doğrulanır; `mode: 0600` tek başına Windows erişim politikası garantisi değildir.
- Admin verileri, data dizini, `.env`, server kaynakları ve private source map'ler statik sunulmaz. Anahtarlar Vite public env değişkenlerine konulmaz.
- React string render'ı kullanılır; API/provider verileri `dangerouslySetInnerHTML` içine konulmaz.
- CDN'den çalıştırılan ethers scripti npm import'una taşınır. CSP inline script gerektirmeyecek biçimde düzenlenir; frame-ancestors, nosniff ve referrer policy eklenir.
- Admin JavaScript'inin gizli olması güvenlik sınırı değildir. Gizli veri ve işlem yetkisi sunucuda korunur. Admin bundle'ının da yetkisiz indirilmemesi istenirse ayrı authenticated asset sunumu gerekir; lazy loading bunu sağlamaz.

## 8. Build, CSS ve servis akışı

Vite dev server `/api` isteklerini Node backend'e proxy eder; cookie/origin davranışı development ortamında doğrulanır. Production'da aynı origin altında Node API ve React build sunulur. `npm run dev`, `build`, `typecheck` ve ilgili test komutları tanımlanır.

`site-theme.css` renk/font/spacing tokenlarının kaynağı olur. Landing'in global `.topbar`, `.brand`, `body` gibi kuralları CSS Modules veya sayfa scope'una alınır. Intelligence CSS'i route değişince landing'i etkilemez. Logo ve fontlar ortak asset yönetimine geçer. Hashed assetler uzun cache; HTML ve hassas API yanıtları uygun no-cache/no-store politikası kullanır.

Backend yalnız tanımlı sayfa route'larında shell döndürür. Eski adres yönlendirmeleri query ve fragment bilgisini korur. Deep link yenilemesi çalışır. Public landing/legal için metadata korunur; gerekirse React'ten prerender çıktısı üretilir, bu ikinci bir elle yönetilen HTML arayüzü oluşturmaz.

## 9. Uygulama aşamaları ve çıkış kriterleri

| Aşama | Çıktı | Tamamlanma kriteri |
|---|---|---|
| 0 — Referans | Sayfa/endpoint/storage envanteri, masaüstü ve mobil referanslar | Her mevcut kontrolün karşılığı ve mevcut sınırlaması yazılı |
| 1 — Temel | Vite, TS, router, providers, asset/CSS yapısı | Build/typecheck başarılı; deep link ve 404 çalışıyor |
| 2 — Intelligence + legal | Mevcut React'in entegrasyonu, legal componentleri | Analiz geçmişi korunuyor; komutlar ve anchor'lar çalışıyor |
| 3 — Landing | JSX bölümler, curve math, fiyat hook'u, Three.js | Matematik ve dönüşümler doğru; görünüm/section davranışları korunuyor |
| 4 — Auth + admin | Auth state, deployment, curve, activity | Oturum/role, kısmi deploy, ağ izolasyonu testleri geçiyor |
| 5 — Infrastructure | React monitor + gerçek provider credential/usage bağlantısı | Key gerçek çağrıda kullanılıyor; secret sızmıyor; kota doğru etiketleniyor |
| 6 — Console | Legacy console React'e taşınmış | Eski testnet config ile read/write adapter davranışları korunuyor |
| 7 — Geçiş | Node build sunumu, eski route yönlendirmeleri | Tüm route ve mobil kontroller başarılı, eski UI scriptleri kullanılmıyor |

Her aşama tamamlanana kadar mevcut çalışan sayfalar erişilebilir tutulur. Son geçişten sonra eski HTML/inline scriptler ve kullanılmayan risk enhancement dosyaları referans taramasıyla tespit edilir; yalnız artık kullanılmayan dosyalar kaldırılır. Runtime verisi, secretlar ve contract kaynakları bu temizliğe dahil değildir.

## 10. Doğrulama planı

### İşlev ve veri

- Curve integralinin $100.000, bitiş arzının 200M olması; başlangıç/orta/dolu curve, fazla miktar, boş/negatif girdi, ETH/USD round-trip.
- Analiz adres/link ayrıştırma, mevcut localStorage geçmişini açma, token ikonu fallback, komutlar, timeout ve başarısız provider.
- Yeni deployment adı/symbol taslağının refresh/polling ile kaybolmaması.
- Wallet hesabı/ağ/deployment değişiminde stale verinin görünmemesi.
- Token deploy başarı + curve deploy başarısızlığı sonrası aynı token ile devam; çift gönderim engeli.
- Yeni API key ile adapter'a gerçek credential seçimi (mock upstream), pause ve rotation, dönem sınırında sayaç, unknown quota ve kredi birimi.

### Güvenlik

- Oturumsuz istek 401; admin role ile owner mutasyonu 403; yanlış Origin reddedilir.
- TOTP brute-force sınırı, malformed kod, expired ticket, replay ve session expiry.
- Provider adı/label içine HTML payload koyulduğunda metin olarak görünmesi.
- Secretın API cevapları, uygulama logları, frontend build ve browser persistent storage içinde bulunmaması (sahte test secretlarıyla).
- `/data`, `.env`, traversal ve yanlış asset yollarının özel dosya döndürmemesi.
- Log out sonrası API erişiminin ve polling'in durması.

### Görsel ve yaşam döngüsü

360/390 px mobil, tablet ve desktop genişliklerinde kontrol. Sayfalar arası geçişte CSS sızıntısı, hamburger/history erişimi, tablo taşması, dialog focus, klavye kullanımı ve hata/loading durumları incelenir. StrictMode altında çift effect çalışması ikinci transaction, iki polling timer veya iki WebGL sahnesi oluşturmamalı. Route çıkışında RAF, listener ve fetch temizliği doğrulanır.

## 11. Yayına geçiş ve geri dönüş

Veri dosyaları değiştirilmeden önce erişimi sınırlı yedek alınır; secret yedekleri public/output klasörüne konulmaz. Geçiş ayrı build dizininde hazırlanır. Kabul kontrollerinden sonra server'ın frontend hedefi değiştirilir. Önceki build geri dönüş için saklanır. Backend şema değişiklikleri eski veriyi okuyacak şekilde versiyonlanır; rollback kullanım/audit geçmişini sıfırlamaz.

Tamamlanma tanımı: bütün sayfalar gerçek React componentleriyle çalışır, eski bağlantılar açılır, mevcut veriler korunur, admin işlemleri backend yetkilerinden geçer, API monitor anahtarları gerçek isteklere bağlanır ve kullanım tahmini ile doğrulanmış sağlayıcı kotası ayırt edilir. Uygulama geçişi tek başına blockchain işlemi göndermez veya yeni API aboneliği açmaz.
