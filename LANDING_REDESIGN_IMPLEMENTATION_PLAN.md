# Robinity Intelligence — Landing & Legal Implementation Plan

Tarih: 18 Eylül 2026  
Durum: Uygulama başladı; tamamlanan kalemler aşağıdaki ilerleme listesinde işaretlenir.  
Kapsam: Landing, ortak public navigation/footer, legal merkezi, curve sunumu ve bu alanların teknik kalitesi.  
Dil: Plan Türkçe; kullanıcıya görünen tüm metinler İngilizce.

## Uygulama ilerlemesi

- [x] Mevcut landing, curve ve legal metinlerinin teknik/içerik denetimi
- [x] Yeni React landing bilgi mimarisi ve İngilizce ilk copy seti
- [x] Ortak public header, aktif bölüm navigasyonu ve profesyonel footer
- [x] Ürün odaklı statik Evidence Field görseli ve erişilebilir tab etkileşimi
- [x] Token overview, doğrulanmamış alanlar için açık durum, boş The Tape durumu
- [x] Curve explorer'ın integral tabanlı matematiği, cap davranışı ve USD/ETH dönüşümü
- [x] Legal Center'ın okunabilir belge düzeni ve gerçek/verifiye edilmemiş bilgi ayrımı
- [x] İlk React bundle derlemesi
- [x] Methodology sayfası: skor yönü, hesap yaklaşımı, kapsam ve sınırlar
- [x] Three.js Evidence Field derinlik katmanı, reduced-motion ve statik SVG/HTML fallback
- [x] Evidence Field ve Intelligence için rota/bileşen bazlı lazy-loading altyapısı
- [x] Admin/ethers kodunun bağımsız lazy chunk'a ayrılması ve route doğrulaması
- [x] Legal Center belgeleri için doğrudan açılabilen public React route'ları
- [x] Curve'un açık yüzeyinde kontrastı koruyan adaptif floating navigation
- [x] Legacy landing/admin giriş kodunun kaldırılması ve modüler React route doğrulaması
- [x] Temiz build output, hash'li entry asset'leri ve generated HTML shell ile cache dayanıklılığı
- [x] Curve matematiğinin arayüzden ayrılması ve sınır/cap testlerinin otomatikleştirilmesi
- [x] ETH/USD quote için güncellik, hata ve erişilebilir canlı durum gösterimi
- [x] Masaüstü + mobil görsel QA ve ince yerleşim düzeltmeleri
- [x] Browser incelemesine göre sabit navigation katmanı, Evidence Field yerleşimi ve token görseli düzeltmeleri
  - Marka logosu 28px'lik brand kutusunda taşıyordu: `.ri-brand img` → `width:100%;height:auto;display:block`.
  - Mobil floating nav (≤820px) marka satırıyla çakışıyordu: `top` 10px → 56px, bölüm altından başlıyor.
  - Landing yıldız/kare arka planı `main` içinden çıkarılıp tüm sayfayı kapsayan fixed page backdrop katmanına taşındı.
- [x] Gerçek deployment/event kaynağıyla The Tape ve satın alma akışının bağlanması
  - Yeni `GET /api/public/state`: yalnızca `network==="mainnet"` ve doğrulanmış deployment alanlarını döner; admin/l iç alanları sızdırmaz.
  - Landing'e `SaleStatus` (ri-sale) bölümü: salı kayıt yoksa dürüstçe "No verified sale is currently published"; kayıt varsa ağ, adresler, satış durumu. Sayfa, kayıtlı deployment olmadan aktif satış butonu sunmaz (plan §4.4).
  - Tape zaten `/api/public/state`'ten yönlendirilen confirm edilmiş `/api/public/tape` kaynağından besleniyor.
- [x] Methodology, token sale, rewards rules ve route'ların tamamlanması
  - Legal Center belgeleri eklendi: `token-sale` (Token Sale Terms), `rewards` (Engagement Rewards Rules), `cookies` (Cookies & Storage); taslak ve "işletmeci doğrulaması bekliyor" çerçevesiyle.
  - `/contact` route'u (`ContactPage`) ve footer bağlantıları (`/legal/token-sale`, `/legal/rewards`, `/contact`) eklendi.
- [ ] İşletmeci kimliği, saklama süreleri ve yetkili hukuki inceleme sonrası legal yayın onayı
  - **BLOKLI**: Yayın öncesi gereken bilgiler (işletmeci kimliği, saklama süreleri, yetkili hukuki inceleme) işletmeciden gelmedi. Uydurma kimlik/başvuru kanalı yayınlanmaz; `/contact` ve dokümanlarda "operator identity pending verification" durumu gösteriliyor.
- [x] Build manifest/hash cache stratejisi ve üretim performans ölçümü
  - `manifest.json` oluşturuluyor: entry JS/CSS, tüm assets (hash'li), gzip boyutları, `generatedAt`.
  - Cache stratejisi: hash'li JS/CSS → `public, max-age=31536000, immutable`; HTML shell → `no-cache, must-revalidate`; API → `no-store`; statik → 1 saat.
  - Gzip bütçe raporu (plan §10): Entry JS 65.8 KB (bütçe 180 KB) ✓ · Entry CSS 13.8 KB (bütçe 35 KB) ✓ · Lazy chunk'lar ayrı ölçülür.

## 1. Karar özeti

Yeni yön: **ürün odaklı, editoryal bir araştırma platformu**. Finansal verilerin ciddiyetini taşıyan, fakat borsa terminali kadar kalabalık olmayan bir tasarım.

Profesyonellik daha fazla parıltıdan gelmeyecek. Özgün bir kompozisyon, gerçek ürün görüntüsü, belirgin tipografik hiyerarşi, açıklayıcı içerik, tutarlı etkileşimler ve doğrulanabilir işletme bilgileri birlikte çalışacak.

Ana kararlar:

- Soyut partikül bulutu hero'nun ana konusu olmaktan çıkacak. Yerine token → kontroller → bulgular ilişkisini anlatan, ürüne özel bir görsel sistem gelecek.
- Three.js bu sistemin arkasındaki ince derinlik katmanı olacak; okunabilir rapor ve kontroller HTML/SVG olarak kalacak.
- Her bölüm kutu içine alınmayacak. Editoryal anlatım, tam genişlik veri alanı, ürün gösterimi ve daha sakin metin bölümleri dönüşümlü kullanılacak.
- Pastel mavi ve kayısı korunacak; sürekli gradyan, neon, tekrar eden cam kartlar ve dev logo kullanılmayacak.
- Ürün önce anlaşılacak; token, curve ve rewards bundan sonra açıklanacak. Satın alma → işlem akışı → curve sırası korunacak.
- Legal içerik tek uzun sayfada birkaç paragraf olmaktan çıkacak. Kimliği, sürümü, kapsamı ve başvuru kanalları belli bir belge merkezi olacak.
- Şirket, lisans, denetim, ortaklık ve canlı ağ durumu hakkında doğrulanmamış hiçbir iddia yayınlanmayacak.

## 2. Mevcut uygulamada tespit edilen sorunlar

Bu bölüm kaynak kod incelemesine dayanır; uygulama aşamasında ayrıca masaüstü ve mobil ekran görüntüsü denetimi yapılacak.

| Mevcut durum | Etki | Yapılacak değişiklik |
| --- | --- | --- |
| Hero'da genel slogan + soyut parçacık sahnesi | Ürünün ne yaptığı görsel olarak anlaşılmıyor | Ürünün gerçek rapor modelinden üretilen açıklayıcı bir kompozisyon |
| Curve, mechanics ve rewards benzer kartlar | Hiyerarşi ve sayfa ritmi zayıf | Bölüm amacına göre farklı fakat aynı sistemden türeyen düzenler |
| Ürün kapsamı, skor mantığı ve veri eksikleri çok az açıklanıyor | Kullanıcı neden kullanacağını ve neye güveneceğini anlayamıyor | Ürün walkthrough'u, metodoloji özeti ve sınırlar |
| Landing'de hâlâ `200M TEST` metni var | Marka bütünlüğü bozuluyor | Görünen marka adı merkezi içerik kaynağından gelecek; ticker ayrıca doğrulanacak |
| `ParticleCloud`, eski `CubeScene` adı altında kullanılıyor | Deneme kodları üst üste birikmiş | Yeni sahne ayrı bileşen; kullanılmayan küp/orbit stilleri kaldırılacak |
| Three.js ve intelligence uygulaması ana girişe statik import ediliyor | Landing için gereksiz başlangıç yükü | Rota ve sahne bazlı yükleme |
| Genel `.panel`, `h1`, `.eyebrow` stilleri ve override katmanları | Sayfalar arası stil çakışması riski | Tasarım token'ları + kapsamı belirli bileşen stilleri |
| Curve'de toplanan USD oranı doğrudan satılan token oranına çevriliyor | Artan fiyat modelinde yanlış sonuç | Entegralin tersinden satılan arzı hesaplama |
| USD/ETH tuşu yalnızca modu değiştiriyor | Girilmiş tutarın ekonomik karşılığı değişiyor | Aynı değeri koruyan birim dönüşümü |
| ETH kuru bir kez alınıyor; hata durumu yeterli değil | Eski veya eksik veri canlı gibi görünebilir | Yenileme, zaman damgası, stale/error durumları |
| Privacy metni browser geçmişine vurgu yapıyor; backend de rapor kaydediyor | Bildirim gerçek veri akışını yeterince açıklamıyor | Veri envanteri üzerinden yeniden yazım |
| Legal iletişim yalnızca X | Kurumsal iletişim ve hak talepleri belirsiz | Gerçek işletmeci kimliği ve çalışan iletişim kanalları |

Tasarım revizyonu admin yetkilerini, mevcut deployment kayıtlarını, API anahtarlarını veya analiz geçmişini sıfırlamayacak. Kontrat deploy etmek bu işin parçası değil.

## 3. Tasarım sistemi

### 3.1 Görsel karakter

Referans karakter: araştırma yayını + kaliteli finansal ürün. Arayüzün özgün öğesi, **sinyallerin bir rapora dönüşmesini anlatan ince çizgili veri diyagramı** olacak.

Kullanılmayacaklar: rastgele gezegen/küre/küp, her kartta glow, gradient başlıklar, süresiz dönen logolar, sahte canlı sayaçlar, dekoratif kod yağmuru, kanıtsız güven rozetleri, eşit büyüklükte sonsuz bento kart dizileri.

### 3.2 Renk token'ları

Başlangıç paleti aşağıdaki gibidir. Eşleştirmeler kontrast testinden geçmeden son değer kabul edilmeyecek.

| Token | Değer | Kullanım |
| --- | --- | --- |
| `canvas` | `#14181B` | Ana koyu zemin |
| `surface` | `#1C2226` | Rapor ve veri yüzeyleri |
| `surface-raised` | `#252D32` | Hover, seçili kontrol, floating nav |
| `text` | `#F0EEE8` | Ana metin |
| `text-muted` | `#ACB5BB` | İkincil açıklama; ana bilgi yerine kullanılmaz |
| `line` | `#39434A` | Dekoratif ayırıcılar; form sınırları ayrıca test edilir |
| `blue` | `#9BB6CB` | Veri vurgusu, seçili durum, bağlantı |
| `apricot` | `#DDAE8B` | Birincil CTA ve curve'de yeni alım aralığı |
| `paper` | `#EAE7DF` | Metodoloji ve legal'in açık okuma yüzeyi |
| `paper-ink` | `#20282D` | Açık zemin metni |
| `paper-muted` | `#56626A` | Açık zemin ikincil metni |
| `success / warning / danger` | `#9DC5AF / #D9BE83 / #E4A0A0` | Bulgular; mutlaka metin ve ikonla birlikte |

Yaklaşık görsel alan dağılımı: %85 nötr, %10 mavi, %5 kayısı. Bu bir ölçüm zorunluluğu değil, doygunluğu sınırlayan tasarım kuralı.

Arka plan kareleri 64 px desktop / 40 px mobile aralıklı, tek piksellik ve %3–5 opaklıkta olacak. Metinlerin arkasında yerel maske ile zayıflatılacak. Kareler bütün sayfada aynı koordinat sistemine bağlı olacak; her bölümde yeniden başlayan rastgele desen olmayacak.

### 3.3 Tipografi

- Ana aile: Manrope, self-host WOFF2; 400, 500, 600, 700. Lisans dosyası korunacak.
- Veri ailesi: IBM Plex Mono, self-host; yalnızca kontrat adresleri, eksen değerleri, zamanlar ve teknik meta bilgiler.
- Hero: desktop 64–72 px / 1.04; tablet 52 px; mobile 38–42 px. En fazla üç satır.
- Bölüm başlığı: 38–44 px / 1.12; mobile 28–32 px.
- Alt başlık: 22–26 px / 1.25.
- Gövde: 17–18 px / 1.65; mobile en az 16 px.
- Meta: 12–13 px / 1.5. Kritik bilgi 10 px gibi küçük puntolara indirilmeyecek.
- Legal gövde: 17 px / 1.8, yaklaşık 65–72 karakter satır uzunluğu.
- Sayısal metriklerde tabular numerals; değişen sayılar düzeni oynatmayacak.
- Bütün başlıklara aşırı negatif tracking uygulanmayacak; yalnızca büyük başlıklarda yaklaşık `-0.035em`.

### 3.4 Yerleşim ve bileşen dili

- İçerik maksimum genişliği 1200 px; desktop 12, tablet 8, mobile 4 sütun.
- Kenar boşluğu: desktop 48–64 px, tablet 32 px, mobile 20 px; 320 px genişlikte 16 px.
- Spacing ölçeği: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 px.
- Bölüm aralıkları desktop 112–128 px, mobile 64–80 px.
- Buton/input radius 8 px; rapor yüzeyi 12 px. Tam yuvarlak yalnızca navigasyon ve küçük durum işaretleri.
- Kart kenarlıkları ince; gölge yalnızca gerçekten yüzen öğelerde. Her yüzeye gölge eklenmez.
- Minimum dokunma alanı 44×44 px. İkonlar tutarlı tek bir 1.5–1.75 px çizgi ailesinden.
- Logo orijinal oranıyla kullanılacak; genişlik/yükseklik sabit kutuya zorlanarak kırpılmayacak. Tek renk dark-on-light varyantı markanın şeklini değiştirmeden üretilecek.
- Mobilde içerik yeniden sıralanacak; yalnızca masaüstü kartları alt alta dizmekle yetinilmeyecek.

## 4. Landing bilgi mimarisi ve içerik

Nihai akış:

1. Header ve kalıcı kompakt navigation.
2. Hero: ürün vaadi + ürüne özel görsel.
3. Intelligence walkthrough ve kapsam.
4. Token overview / satın alma alanı.
5. The Tape: doğrulanmış işlem akışı.
6. Etkileşimli curve.
7. Mechanics ve kısa FAQ.
8. Engagement Rewards — son ana bölüm.
9. Kurumsal/legal footer.

Metodoloji özeti walkthrough içine yerleşecek; ek bir uzun pazarlama bölümü oluşturulmayacak. Tam metodoloji ayrı sayfaya bağlanacak.

### 4.1 Header ve navigation

- Logo ve marka header'da; header normal belge akışında kalıp scroll ile kaybolacak.
- `Overview` ve `Intelligence` bağlantıları üst ortada ince bir floating navigation olarak kalacak. Public nav'da Admin olmayacak.
- Geniş ekranda hero içeriğini kapatmayacak; mobilde marka satırının altında başlayacak ve kaydırmada güvenli üst boşlukla sabitlenecek.
- Sayfa içi `Curve / Mechanics / Rewards` yönlendirmeleri token bölümünün girişinde daha küçük bir section navigator olarak bulunacak. İki navigasyon aynı yükseklikte üst üste binmeyecek.
- Aktif bölüm, tanımlı okuma çizgisi ve sayfa sonu kuralıyla hesaplanacak. Rewards'a tıklamak mechanics'i aktif bırakmayacak.
- Açık/koyu bölüm bilgisi `data-surface` üzerinden yönetilecek. Raster piksel örneklemesi veya yalnızca `mix-blend-mode` kullanılmayacak.
- Açık zeminde koyu, koyu zeminde açık yazı; seçili öğede pastel mavi vurgu + küçük alt çizgi. Kontrast dekoratif blur'a bağımlı olmayacak.
- Anchor hedefleri için `scroll-margin-top`; klavye focus'u görünür; reduced-motion'da anlık kaydırma.

### 4.2 Hero — anlatım ve görsel

Yerleşim: solda 5 sütun metin, sağda 7 sütun ürün görseli. Eşit iki kutu değil; sağdaki diagram kontrollü şekilde kolon dışına taşabilir, fakat yatay scroll oluşturamaz.

Önerilen İngilizce metin:

> TOKEN RESEARCH, WITH CONTEXT  
> Look beyond the ticker.  
> Review token security signals, creator activity and the evidence behind each score—before deciding what to do next.

CTA: `Open Intelligence`  
İkincil bağlantı: `Explore the token`

Alt yardımcı metin: `Coverage varies by network and available data.`

Görsel: bir token merkezinden üç ince yol çıkar: `Contract`, `Liquidity`, `Creator`. Sağda gerçek rapor bileşenlerinden oluşan kısa bir bulgu özeti görünür. Bir bulgu seçildiğinde açıklama değişir. Bu üç başlık, yalnızca ilgili network'te gerçekten desteklenen alanları gösterir.

- Gerçek rapor kullanılacaksa zaman damgası ve ağı bulunur; ekran açılınca otomatik ücretli/API tüketen tarama yapılmaz.
- Demo veri kullanılacaksa küçük ama okunabilir `Example report` etiketi bulunur. Örnek puan gerçek bir token'a atfedilmez.
- Görselde birden çok büyük logo veya marka tekrarları olmaz.
- Canvas kapalı olsa da rapor anlaşılır; görsel dekorasyon bilgi taşımak için zorunlu değildir.

### 4.3 Intelligence walkthrough

Başlık: `From an address to a clearer picture.`

Üç tab; her biri farklı bir gerçek ürün kesitini gösterir:

1. `Security signals` — `Inspect permissions, trading restrictions and liquidity warnings in one report.`
2. `Creator context` — `Review available creator activity and associated token history.`
3. `Score breakdown` — `See which findings affect the score and where evidence is missing.`

Tab alanının altında metodoloji özeti:

> Scores summarize available evidence. They do not guarantee safety. A higher score indicates fewer detected risk signals—not the absence of risk.

`Read the methodology` bağlantısı; metodoloji sürümü, güncellik ve eksik kapsam durumları açıklanacak. Provider ayrıntıları hero'yu kalabalıklaştırmaz; fakat üçüncü taraf verisini kendi üretilmiş araştırmamız veya tamamlanmış özel altyapımız gibi sunmayız. Atıf/lisans koşulları ayrıca kontrol edilir.

Ürün görüntüsü mevcut React rapor bileşeninin sunum varyantından üretilecek; ürünle ilgisiz stok dashboard çizilmeyecek. Mobile'da tab paneli tek sütun ve yatay taşmasız olacak.

### 4.4 Token overview ve satın alma alanı

Başlık: `The token, in numbers.`

Doğrulanmış proje planı:

| Alan | Görünen değer |
| --- | --- |
| Total supply | 1,000,000,000 |
| Presale allocation | 200,000,000 · 20% |
| Engagement Rewards | 50,000,000 · 5% |
| Curve target | $100,000 |

Kalan %75 için kullanım alanı uydurulmayacak. Boş kısmı dağıtılmış gibi gösteren donut çizilmeyecek. Gerekirse `Remaining allocation: not yet announced` denilecek; bu görünür ifade içerik onayına sunulacak.

Marka adı Robinity Intelligence. Token ticker'ı, deploy edilmiş kontrat sembolü ve pazarlama markası aynı şey değildir. Doğrulanmadan yeni ticker icat edilmeyecek veya gerçek kontrat sembolü sessizce değiştirilmeyecek.

Token utility'si için açık bir karar kapısı: analiz erişimi, kredi, indirim, üyelik veya başka bir hak gerçekten uygulanmış mı? Uygulanmadıysa token tutmanın bu hakları verdiği yazılmaz. Bu eksikliği tasarım değil ürün kararı çözer.

Satın alma bileşeninde ağ, token adresi, curve adresi, satış durumu, güncel quote, minimum alınacak miktar ve imza öncesi özet olacak. Mevcut backend/kontrat gerçekten hazır değilse pazarlama sayfası aktif satış varmış gibi buton sunmayacak. Mainnet etiketi yalnızca doğrulanmış chain ID ve deployment konfigürasyonundan üretilecek.

### 4.5 The Tape

Satın alma alanının hemen altında; curve'den önce yatay, sakin bir tablo:

`Time / Wallet / Amount / Tokens / Transaction`

- Seçili deployment ve chain'e ait doğrulanmış olaylar; ağlar birbirine karışmaz.
- Kısa cüzdan adresi + explorer bağlantısı; gereksiz kişisel profil üretimi yok.
- Boşsa `No confirmed activity yet.`; servis hatası boş listeymiş gibi gösterilmez.
- Fake işlemler, hızlandırılmış ticker, sahte alıcı sayısı yok.
- Mobilde miktar ve token ön planda, detaylar açılır satırda.

### 4.6 Curve — sayfanın ana etkileşimi

Başlık: `See how your entry changes along the curve.`

Açıklama:

> The published curve allocates 200 million tokens as the marginal price rises from $0.0001 to $0.0009. Explore the token amount and average price for a contribution at different stages.

Grafik 7 sütun; kontrol ve sonuç alanı 5 sütun. Desktop'ta geniş eksenler, mobile'da grafik yukarıda. Kaydırıcı, güncel nokta ve alım aralığı aynı hesap modelinden güncellenecek.

- X ekseni: tokens sold. Y ekseni: marginal price in USD. Bu eksenlerde çizgi doğrusaldır.
- Slider: raised USD. USD slider oranını doğrudan grafik X koordinatına vermek yanlıştır; satılan token hesaplanır.
- Kayısı alan: yeni alımın kapsadığı bölüm; mavi nokta: alım öncesi konum.
- Sonuçlar: token quantity, average price, next marginal price, raised after, remaining allocation.
- Tooltip hem mouse hem klavye ile erişilebilir. Durum yalnızca renkle anlatılmaz.
- ETH/USD toggle mevcut ekonomik tutarı korur; `100 USD` → kur üzerinden ETH karşılığı.
- Kur en fazla 60 saniye aralıkla görünür sayfada yenilenir; güncelleme zamanı gösterilir. Eşikler veri kaynağına göre ayarlanır; hata/eskime gizlenmez.
- Kullanıcı giriş yaparken kur güncellenmesi rakamı sürekli zıplatmaz: giriş birimindeki tutar korunur; quote zaman damgası ayrıca görünür.
- Canlı satış quote'u ile keşif aracı ayrı veri tipleridir; keşif çıktısı imzalanabilir kesin on-chain quote gibi gösterilmez.

#### Matematik ve test şartları

`S = 200,000,000`, `p0 = 0.0001`, `p1 = 0.0009`, `k = (p1 - p0) / S`.

```text
p(s) = p0 + k*s
R(s) = p0*s + (k*s*s)/2
s(R) = (sqrt(p0*p0 + 2*k*R) - p0) / k

acceptedUSD = min(requestedUSD, R(S) - R(s))
tokens = s(R(s) + acceptedUSD) - s
averagePrice = acceptedUSD / tokens   // tokens > 0 ise
nextPrice = p(s + tokens)
```

Sınır testleri: `R(0)=0`, `R(50M)=$10,000`, `R(100M)=$30,000`, `R(200M)=$100,000`. Son noktada yeni allocation sıfırdır. Negatif/NaN girişler reddedilir. Cap aşımında sadece kabul edilen tutar kullanılır; kontratın gerçek davranışı revert ise işlem yolu aynı davranışa uyar, varsayımsal refund vaadi yazılmaz.

Ekran matematiği için saf fonksiyonlar; kontrat miktarları için decimals-aware bigint/fixed-point kullanılacak. Bu USD modeli, deploy edilmiş kontratın ETH fiyat mekanizmasıyla ayrıca karşılaştırılacak; spot kur gösterimi kontrata otomatik oracle eklemez.

### 4.7 Mechanics ve FAQ

Başlık: `What happens when you participate.`

Numaralı, açık zeminli editoryal alan; tekrarlayan kartlar yerine sol tarafta kısa başlıklar, sağda açıklamalar:

1. Network and contract verification.
2. Quote and wallet approval.
3. Allocation, claim conditions and transaction records.

Her cümle gerçek kontrat davranışıyla doğrulanacak. Claim koşulları, treasury'nin erken para çekme yetkisi, sale/claim pause yetkileri, upgrade veya owner rolleri varsa saklanmayacak.

FAQ: skor garanti midir; hangi ağlar desteklenir; eksik veri nasıl gösterilir; curve fiyatı nasıl hesaplanır; token ne hak sağlar; rewards nasıl hesaplanır. Bilinmeyen konular için uydurma cevap yerine açık ürün kararı gerekecek.

### 4.8 Engagement Rewards

Son ana bölüm; mechanics ile arasında desktop en az 112 px boşluk ve belirgin yeni başlık kompozisyonu olacak. Kısa bölüm olsa bile active-section mantığı sayfa sonunda Rewards'ı doğru seçecek; çözüm yalnızca gereksiz boşluk eklemek olmayacak.

Başlık: `Contribute to the conversation.`

> 50 million tokens are reserved for Engagement Rewards. Eligible contributions earn points; allocations are proportional to each participant’s share of valid points.

İllüstrasyon: contribution → eligible points → allocation. Genel sosyal medya ikon yığını değil.

Formül: `allocation = 50,000,000 × validUserPoints / totalValidPoints`. Toplam puan sıfırsa dağıtım hesabı yapılmaz. Dağıtımın tamamının ne zaman ve hangi kampanyaya ait olduğu kararlaştırılmadan tarih veya hak garantisi verilmez.

X bağlantısı gerçekten hazırsa `Connect X`; değilse `Follow updates` → resmi X hesabı. Puanlar, eligibility, anti-sybil kuralları, itiraz süreci ve kampanya koşullarına bağlantı bulunacak. Fake connect/puan ekranı yapılmaz.

### 4.9 Footer

Header menüsünü tekrar eden dev sitemap olmayacak. Kompakt marka alanı + belgeler + iletişim:

- Logo, Robinity Intelligence, kısa ürün tanımı.
- X logosu → `https://x.com/robinityint`; erişilebilir isim: `Robinity Intelligence on X`.
- Terms, Privacy, Risk disclosures, Methodology, Contact.
- Cookie preferences yalnızca gerçekten ilgili tercih yönetimi varsa.
- Gerçek işletmeci bilgisi, doğru telif sahibi ve gerekli kayıt bilgileri.
- Kısa risk uyarısı; kritik satış riskleri yalnızca footer'a gömülmez.

## 5. Three.js ve motion sistemi

### Ana sahne: Evidence Field

Özel sanat yönü: koyu zeminde sığ perspektifli bir veri düzlemi; üç anlamlı bağlantı hattı ve rapor panelinin arkasında düşük yoğunluklu derinlik. Token inceleme konseptini taşır; blockchain ağı üzerinde canlı trafik varmış izlenimi vermez.

Varlıklar:

- Orijinal logo: küçük bir kimlik işareti; dev merkez objesi değil.
- SVG tabanlı üç veri yolu ve sade nokta bağlantıları.
- Three.js tarafında 3–5 ince düzlem/çizgi katmanı; gerekirse az sayıda instanced nokta.
- HTML rapor overlay: gerçek tipografi ve erişilebilir kontroller.
- WebGL yoksa aynı kompozisyonun statik SVG versiyonu; boş kutu yok.

| Etkileşim | Tanım | Sınır |
| --- | --- | --- |
| İlk giriş | Diyagram hatları, ardından bulgu alanı görünür | Toplam 900 ms; ana başlık/CTA başlangıçta görünür |
| Pointer | Çok hafif perspektif/parallax | En fazla 3° ve 6 px; touch'ta kapalı |
| Bulgu seçimi | İlgili yol ve açıklama odaklanır | 180–240 ms; gereksiz zoom yok |
| Ambient | Çok düşük genlikli derinlik değişimi | 10–14 saniye; hareketi kapatma seçeneği |
| Bölüm girişi | Kısa opacity + 8–12 px translate | 280–400 ms, bir kez |
| Buton hover | Renk/sınır ve 1 px yükselme | 140–180 ms |
| Curve değişimi | Nokta ve alan birlikte hareket eder | Sürüklerken gecikmesiz; bırakınca en fazla 160 ms |

`prefers-reduced-motion` için parallax, ambient, çizgi çizilme ve smooth-scroll kapalı. Uzun otomatik hareket için durdurma kontrolü olacak. Animasyon kapalıyken içerik aynı kalacak. [W3C reduced-motion tekniği](https://www.w3.org/WAI/WCAG21/Techniques/css/C39.html)

Performans: sahne lazy-load; ekran dışında/sekme gizliyken RAF durur; DPR üst sınırı 1.5; resize ve pointer işlemleri sınırlı; geometry/material/renderer temizliği zorunlu. Düşük performansta statik sürüme düşer. Global bloom/postprocessing başlangıç sürümünde yok. Efekt hedefi ürünü açıklamak; ekranı meşgul etmek değil.

## 6. Legal merkezi: gerçek kurumsallık

### 6.1 Temel yaklaşım

Profesyonel legal sayfası uzun ve ağır bir metin değildir: kimin işlettiğini, ne sunduğunu, hangi verinin neden işlendiğini ve sorun olduğunda kime ulaşılacağını açıkça söyler.

Şirket henüz kurulmadıysa kurulmuş gibi gösterilmeyecek. Gerçek işletmeci belirtilir; gerekli kimlik ve hukuki yapı netleşmeden satış yayını tamamlanmış sayılmaz. Hayali adres, `Ltd.`, lisans numarası, audit rozeti veya partner logosu eklenmez.

Bu bölüm hukuki görüş değil, belge ve uygulama gereksinimidir. Uygulanacak hukuk; işletmeci ülkesi, hedef pazarlar, token niteliği ve sunulan faaliyetlere göre yetkin hukuk danışmanıyla belirlenir. GDPR/MiCA her projeye otomatik uygulanıyor varsayılmaz. Sadece `not financial advice` yazmak mevzuat yükümlülüklerini ortadan kaldırmaz.

### 6.2 Sayfa yapısı

Planlanan route'lar:

| Route | İçerik |
| --- | --- |
| `/legal` | Legal center, işletmeci özeti, belge listesi, iletişim |
| `/legal/terms` | Terms of Use |
| `/legal/privacy` | Privacy Notice |
| `/legal/risks` | Risk Disclosures |
| `/legal/token-sale` | Satış varsa Token Sale Terms |
| `/legal/rewards` | Kampanya varsa Engagement Rewards Rules |
| `/legal/cookies` | Gerçek cookie/storage envanteri ve gerekiyorsa tercihler |
| `/methodology` | Skor, kapsam, veri kaynakları ve sınırlamalar |
| `/contact` | Gerçek destek, privacy ve güvenlik iletişim kanalları |

Yeni route'lar mevcut sunucunun SPA whitelist'ine eklenecek; doğrudan açma ve yenileme test edilecek. Eski `/legal#privacy` gibi linkler doğru belgeye taşınacak. Taslak veya boş belgeler yayın menüsünde görünmeyecek.

Legal tasarımı:

- Açık `paper` okuma yüzeyi, koyu metin; marka navigation'ı adaptif.
- Sol tarafta sticky içerik listesi, sağda 720 px civarı belge. Mobilde açılır içerik listesi.
- Başlık altında version, effective date, last updated, operator ve kısa kapsam özeti.
- Numaralı başlıklar, maddeye doğrudan bağlantı, okunabilir tablolar.
- Kısa özet ile tam şartlar açık biçimde ayrılır; özet hukuki metin yerine geçmez.
- Print stylesheet; PDF gerekiyorsa aynı içerikten üretilir, ayrı ve çelişen kopya tutulmaz.
- Değişiklik geçmişi ve eski sürüme erişim; geçerli sürüm açıkça belirtilir.

### 6.3 Belge içerik şartları

**Terms of Use:** gerçek taraflar; hizmet kapsamı; uygunluk koşulları; kullanım kuralları; veri lisansları/fikri haklar; üçüncü taraflar; cüzdan imzaları; hizmet kesintileri; şikâyet süreci; sona erme; değişiklik bildirimi. Sorumluluk sınırları, uyuşmazlık yeri ve zorunlu kullanıcı hakları yerel hukuka göre yazılır; keyfi ülke veya kapsamlı feragat kopyalanmaz.

**Privacy Notice:** veriler, amaçlar, uygulanıyorsa hukuki dayanaklar; kullanıcı girdileri ve teknik loglar; browser geçmişi ve sunucu raporları arasındaki fark; admin kimlik doğrulama ve API credential verileri; alıcılar/sağlayıcılar; ülke dışı aktarımlar; somut saklama süreleri veya belirleme ölçütleri; silme/erişim talepleri; güvenlik iletişimi. Kamuya açık cüzdan verisi olması kişisel veri analizini gereksiz yapmaz. Uygulanabilir GDPR durumları için bilgi kategorileri EDPB rehberiyle eşleştirilecek. [EDPB: bireylerin hakları ve şeffaflık](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en)

**Risk Disclosures:** skorun denetim/garanti olmadığı; verinin eksik veya eski olabileceği; kontrat/likidite/creator analiz sınırları; volatilite, slippage, gas, MEV, ağ kesintileri; admin yetkileri; treasury çekim yetkisi varsa kapsamı; claim kısıtları; tokenların değer kaybı. Riskler gerçekten mevcut ürün ve kontrata göre seçilir.

**Token Sale Terms:** satıcı, kontrat/ağ, satılan hak, fiyatlama, cap, kabul edilen varlık, quote geçerliliği, claim/vesting, satışın durması, fiili kontratın fazla ödeme davranışı, fonların kontrolü, vergi ve uygunluk süreçleri. On-chain parametreler ile pazarlama metni karşılaştırılır. AB'ye yönelik faaliyet varsa MiCA kapsamı ayrıca değerlendirilir; ilgili pazarlama kuralları adil, açık ve yanıltıcı olmayan iletişim ister. Bu belge tek başına uyumluluk kanıtı değildir. [ESMA: MiCA Article 7](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-7-marketing-communications)

**Rewards Rules:** organizatör; kampanya dönemi; uygunluk; puanlama; geçersiz faaliyet/sybil kuralları; puan itirazı; dağıtım formülü; doğrulama ve dağıtım zamanı; X OAuth izinleri ve bağlantı kaldırma; platformla resmi ortaklık olup olmadığı. Proje X'in onayladığı bir kampanya gibi sunulmaz.

**Cookies/storage:** zorunlu session cookie, localStorage ve üçüncü taraf istekleri gerçek envanterden listelenir. Gerekmeyen cookie banner eklenmez; gerekli tercih/consent varsa isteğe bağlı izleyiciler onaydan önce yüklenmez. `Reject` ve `Accept` eşit erişilebilirlikte olur; tercih sonradan değiştirilebilir. Bölgesel gereklilikler ayrıca değerlendirilir.

### 6.4 Gerçek veri akışının çıkarılması

Uygulama öncesi aşağıdaki tablo her gerçek veri alanı için doldurulacak:

`Data field → purpose → storage location → recipient → retention → deletion path → access role`

İncelenecek yüzeyler: analiz endpoint'leri, rapor dosyası, localStorage, admin oturumu/TOTP, API key saklama, işlem logları, X bağlantısı, dış font/ikon kaynakları, ETH fiyat isteği ve hata izleme. Secret değerleri bu belgeye, tasarım ekranına veya public bundle'a yazılmaz.

Saklama süreleri teknik silme işiyle desteklenir. Yapılmayan otomatik silme veya şifreleme işlemi yapılıyormuş gibi vaat edilmez. Veri sahibinin erişim/silme talebi için gerçek işleyiş ve blockchain verisinin silinemeyen niteliği açıklanır.

### 6.5 Kullanıcıdan/işletmeciden gereken bilgiler

Yayın öncesi gerekli; tasarım taslağını hazırlamayı engellemez:

1. İşletmecinin hukuki adı, şirket var mı, kayıt ülkesi ve varsa kayıt numarası.
2. Yayınlanması gereken gerçek adres ve tebligat/iletişim yöntemi.
3. Çalışan destek ve privacy e-posta adresleri; güvenlik bildirim kanalı.
4. Hedef ülkeler ve kullanıma/satışa ilişkin kısıtlar.
5. Canlı kontratlar, chain ID, token sembolü, treasury ve owner yetkileri.
6. Token'ın gerçek utility'si ve kullanıcıya verdiği haklar.
7. Rewards takvimi, puan kuralları, itiraz sorumlusu.
8. Veri saklama kararları ve kullanılan servislerin sözleşme/atıf koşulları.

Şirket hissinin ölçütü bu bilgilerin doğruluğu ve işleyen iletişimdir; metin uzunluğu veya sertifika benzeri dekorlar değildir.

## 7. Teknik uygulama planı

### 7.1 React modülerleştirme

Önerilen yapı, mevcut esbuild altyapısı korunarak başlanacak:

```text
app/web/src/
  app/                 route resolution, public layout, error boundary
  components/brand/    Logo, PublicHeader, FloatingNav, Footer
  components/ui/       Button, Tabs, Status, Disclosure, Field
  pages/landing/       Hero, ProductWalkthrough, TokenOverview,
                       Purchase, ActivityTape, CurveExplorer,
                       Mechanics, Engagement
  pages/legal/         LegalIndex, LegalDocument, LegalTOC
  scenes/              EvidenceField, StaticEvidenceField
  lib/                 curveMath, formatters, quoteState
  hooks/               useEthRate, useActiveSection, useMotionPreference
  content/             landing.en, legal documents and metadata
  styles/              tokens, reset, type, page-scoped styles
```

- `main.jsx` yalnızca giriş ve route bootstrap; bütün ürün tek dosyada tutulmaz.
- Curve slider/grafik iletişimi window event yerine ortak React state/props ile yapılır.
- Landing/legal içeriği ayrı içerik dosyalarında; aynı sayılar farklı bileşenlerde tekrar yazılmaz.
- Esbuild ESM splitting ve dinamik import ile sahne/intelligence/admin ayrılır. Yeni framework zorunlu değil.
- Landing düzenlenirken risk ve admin CSS regression testleri yapılır; shared token değişikliği kör biçimde bütün siteye uygulanmaz.
- Eski deney stilleri ancak kullanım taramasından sonra temizlenir. Arşiv public webroot dışında kalır.

### 7.2 Veri ve hata durumları

Her remote veri bileşeni için loading, ready, empty, partial, stale, error durumları tanımlanacak. Yükleme animasyonu gerçek işleme bağlı olacak; kullanıcının beklemesini uzatan yapay gecikme eklenmeyecek.

Token logosu ve API metinleri güvenilmeyen veri kabul edilir: URL/şema doğrulama, güvenli render, görsel fallback. Yeni HTML içerik enjeksiyonu açılmaz. Explorer linkleri doğrulanmış chain config üzerinden üretilir.

Public arayüzde admin linki olmaması erişim kontrolü değildir. Mevcut server-side auth/authorization korunur; bu redesign hiçbir admin API'sini public yapmaz.

### 7.3 Build ve cache

JS/CSS dosyaları content-hash ile üretilir; HTML manifest üzerinden doğru bundle'a bağlanır. Üretimde hashed asset uzun cache, HTML revalidation; geliştirmede no-store. Deploy atomik yapılır; eski HTML'in işaret ettiği eski hashed dosyalar kısa geçiş süresince korunur. Kullanıcıya sürekli URL query ekletmek veya hard-refresh yaptırmak çözüm değildir.

## 8. Üretilecek tasarım varlıkları

Uygulamaya başlanmadan teslim listesi:

1. Renk, tipografi, spacing, grid, radius, ikon, focus ve motion token dokümanı.
2. 1440 px desktop ve 390 px mobile tam landing tasarımı; 768 px adaptasyon kuralları.
3. Hero'nun statik art-direction kompozisyonu ve üç etkileşim durumu.
4. Evidence Field sahne storyboard'u; WebGL ve statik fallback.
5. Gerçek veri şemasına bağlı örnek rapor, veri kaynağı ve güncellik etiketi.
6. Curve default, dolu, sınıra yakın, cap, kur hatası ve USD/ETH durumları.
7. The Tape boş/başarılı/hata/mobile görünümü.
8. Navigation açık/koyu zemin, scroll ve mobile durumları.
9. Legal index, uzun belge, TOC, print, document history tasarımları.
10. İngilizce copy deck; bütün CTA, hata, boş durum ve erişilebilirlik metinleri.
11. Asset/license envanteri: logo, fontlar, ikonlar, görüntüler; doğrulanmamış üçüncü taraf marka kullanımı yok.

Her bir varlık aynı token sistemini kullanacak. Yalnızca güzel bir hero screenshot'ı tasarım teslimi sayılmayacak.

## 9. Aşamalı iş planı ve çıkış kriterleri

| Faz | İşler | Tamamlanma koşulu |
| --- | --- | --- |
| 0 — Doğrulama | Mevcut ekranlar, veri akışı, kontrat/utility gerçekleri, legal eksikler | İddia/veri kaynağı matrisi; kayıtlar değişmeden baseline |
| 1 — İçerik ve wireframe | Sayfa sırası, İngilizce copy, CTA ve mobil akış | Kullanıcı ürün, token ve risk ilişkisini anlayabiliyor |
| 2 — Art direction | Token'lar, desktop/mobile tasarım, statik hero, legal örneği | Hareket olmadan da güçlü ve tutarlı görsel tasarım |
| 3 — React temel yapı | Bileşen ayırma, scoped styles, nav/footer, route'lar | Intelligence/admin görsel veya işlevsel regresyonu yok |
| 4 — Ürün/veri alanları | Walkthrough, purchase state, tape, doğru curve matematiği | Testler ve gerçek veri durumları geçiyor |
| 5 — Motion | Evidence Field, microinteraction, fallback | Reduced-motion ve düşük performans yolları çalışıyor |
| 6 — Legal | Gerçek envanterden metinler, belge merkezi, version/history | İşletmeci onayı + gerekli hukuki değerlendirme; sahte beyan yok |
| 7 — QA/yayın | Görsel, erişilebilirlik, performans, cache, doğrudan route testleri | Aşağıdaki kabul listesi tamam |

Önce düşük detaylı akış, sonra statik yüksek kalite tasarım onaylanacak. Three.js işi statik tasarımın yerini tutmayacak. Eksik işletmeci bilgisi legal yayınını durdurabilir; diğer tasarım işleri ilerleyebilir.

## 10. Kabul ve test listesi

### Görsel ve içerik

- 320, 390, 768, 1024, 1440, 1920 px genişliklerde taşma, kesik metin ve üst üste binme yok.
- %200 zoom, uzun başlık, uzun adres ve loading/error durumları test edilir.
- Bütün kullanıcı metinleri İngilizce; gereksiz AI sloganı yok; marka/ticker ayrımı doğru.
- Bölümler aynı kart şablonunun tekrarı gibi görünmüyor; hero ürünün ne yaptığını anlatıyor.
- Mainnet, live sale, kullanıcı sayısı, audit ve utility iddialarının her biri doğrulanmış kaynağa bağlı.
- Rewards son ana bölüm; section linkleri tıklandığında ve manual scroll'da doğru aktif.

### İşlev ve erişilebilirlik

- Klavye ile tüm link, tab, grafik kontrolü ve accordion kullanılabilir.
- Normal metinde en az 4.5:1, büyük metinde 3:1 kontrast hedefi; kontrol/focus sınırları da ayrıca test edilir.
- Aktif, riskli, loading ve eksik durumlar yalnızca renge bağlı değil.
- Hareket azaltma açıkken içerik kaybolmaz; canvas hatasında sayfa işlevsel kalır.
- Curve entegral testleri, birim değiştirme, kur hatası, cap ve precision testleri geçer.
- Remote content güvenli render edilir; secret/admin verileri public bundle veya API'den sızmaz.

### Performans ve işletim

- Hedef bütçeler: ilk landing JS, lazy Three.js ve diğer rotalar hariç, gzip yaklaşık 180 KB altında; kritik CSS gzip 35 KB altında. Ölçülerek revize edilir, doğrulanmadan başarı iddiası yapılmaz.
- Hedef Web Vitals: LCP ≤2.5 s, CLS ≤0.1, INP ≤200 ms. Laboratuvar sonuçları gerçek kullanıcı ölçümü yerine geçmez.
- Sahne ekran dışında GPU döngüsü çalıştırmaz; mount/unmount sonrası canvas/listener birikmez.
- API hatasında sahte veri veya sıfır risk gösterilmez; stale durumu görünür.
- `/landing`, tüm legal route'lar, `/intelligence` doğrudan açılır ve refresh'te çalışır.
- Yeni build normal yenilemede görünür; eski asset referansı 404 üretmez.
- Mevcut deploymentlar, geçmiş analizler, admin kayıtları ve anahtarlar korunur.

## 11. Önceliklendirme

**P0:** veri/matematik doğruluğu; gerçek ürün/satış durumu; erişim güvenliğinin korunması; legal yanlış beyanların kaldırılması.

**P1:** yeni içerik akışı; tipografi ve grid; ürün görseli; doğru navigation; mobil; legal merkezi ve gerçek iletişim bilgileri.

**P2:** Three.js derinliği, ince etkileşimler, print polish ve gelişmiş geçişler.

Başarı ölçütü: Kullanıcı ilk ekranda ürünün ne yaptığını, devamında skorun sınırlarını ve token mekaniklerini anlayabilmeli; legal merkeze girdiğinde kiminle muhatap olduğunu ve haklarını nasıl kullanacağını bulabilmeli. Dekoratif efektler bu anlayışı desteklemeli, onun yerine geçmemeli.
