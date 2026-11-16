# Match Baller'ı Play Store'a koyma rehberi

Uygulama bir **Trusted Web Activity (TWA)** olarak yayınlanır: telefonda gerçek bir Android uygulaması gibi
simgesiyle açılır, adres çubuğu olmaz; içeride Chrome motoru çalışır. Bu yüzden Google ile giriş, ses,
titreşim ve paylaşım olduğu gibi çalışır.

Sıra önemli: **önce sunucu internette yayında olmalı**, sonra Android paketi oluşturulur.

---

## 1. Sunucuyu yayına al (HTTPS)

Uygulama telefondan bu sunucuya bağlanır. Sunucu sürekli açık olmalı ve kullanıcı verisi için **kalıcı disk** gerekir
(yoksa her güncellemede sıralama ve istatistikler silinir).

Projede hazır `Dockerfile` var. Docker destekleyen herhangi bir serviste çalışır. Önerilen ayarlar:

| Ayar | Değer |
|---|---|
| Port | `3000` (servis `PORT` verirse otomatik kullanılır) |
| Kalıcı disk (volume) | `/data` klasörüne bağla, 1 GB yeter |
| Ortam değişkeni `DATA_DIR` | `/data` |
| Ortam değişkeni `GOOGLE_CLIENT_ID` | Google Cloud'daki web client ID |
| Sağlık kontrolü yolu | `/healthz` |

Yayına alınca elinde `https://<alan-adın>` gibi bir adres olur. Kontrol et:
- `https://<alan-adın>` → oyun açılıyor mu
- `https://<alan-adın>/privacy.html` → gizlilik politikası açılıyor mu

**Google girişi için:** Google Cloud Console → Google Auth Platform → Clients → web client → **Authorized JavaScript origins**
listesine `https://<alan-adın>` ekle.

**Gizlilik politikası:** `public/privacy.html` içindeki `[İLETİŞİM E-POSTASI]` / `[CONTACT EMAIL]` yerlerine
kullanıcıların ulaşabileceği bir e-posta yaz.

## 2. Android paketini oluştur (PWABuilder ile, bilgisayara bir şey kurmadan)

1. https://www.pwabuilder.com adresine git, sitenin adresini (`https://<alan-adın>`) yaz, **Start**.
2. **Package for stores → Android → Generate Package**.
3. Ayarlar:
   - **Package ID:** `com.matchballer.app` (sonradan değiştirilemez; kendine özgü bir şey seçebilirsin)
   - **App name:** Match Baller
   - **Launcher name:** Match Baller
   - **Display mode:** Standalone, **Orientation:** Portrait
   - **Signing key:** "Create new" (yeni anahtar oluştur)
4. İnen zip içinde şunlar olur:
   - `*.aab` → Play Console'a yükleyeceğin dosya
   - `signing.keystore` ve `signing-key-info.txt` → **bunları güvenli bir yere yedekle.** Kaybedersen uygulamayı güncelleyemezsin.
   - `assetlinks.json` → içindeki `sha256_cert_fingerprints` değerine bir sonraki adımda ihtiyacın var.

## 3. Uygulamayı siteye bağla (adres çubuğu görünmesin)

Sunucuya iki ortam değişkeni ekle ve yeniden başlat:

```
ANDROID_PACKAGE=com.matchballer.app
ANDROID_SHA256=AA:BB:CC:...   (PWABuilder'ın verdiği parmak izi)
```

Play Console, uygulamayı kendi anahtarıyla yeniden imzalar. Yükledikten sonra
**Play Console → Test ve yayın → Uygulama bütünlüğü → Uygulama imzalama** sayfasındaki **SHA-256** parmak izini de
virgülle ekle:

```
ANDROID_SHA256=PWABUILDER_PARMAK_IZI,PLAY_PARMAK_IZI
```

Kontrol: `https://<alan-adın>/.well-known/assetlinks.json` bu bilgileri göstermeli.
Bu adım atlanırsa uygulama açılır ama üstte bir adres çubuğu görünür.

## 4. Play Console

1. https://play.google.com/console → geliştirici hesabı (tek seferlik 25 USD). Yeni kişisel hesaplarda yayından önce
   **en az 12 test kullanıcısıyla 14 gün kapalı test** zorunlu; bunu baştan planla.
2. **Uygulama oluştur:** ad "Match Baller", varsayılan dil Türkçe, tür **Oyun**, ücretsiz.
3. **Mağaza girişi:** metinler ve görseller `store/listing.md` ve `store/` klasöründe hazır.
4. **Uygulama içeriği:** gizlilik politikası URL'si, reklam yok, içerik derecelendirme ve veri güvenliği formları
   (cevaplar `store/listing.md` sonunda), hedef yaş grubu 13+.
5. **Test → Kapalı test:** yeni sürüm oluştur, `.aab` dosyasını yükle, test kullanıcılarını ekle.
6. Test süresi dolunca **Üretim**'e sürüm gönder ve incelemeye yolla.

## 5. Güncellemeler

- Oyunda yapılan değişiklikler (yeni özellik, tasarım) **sadece sunucuya** yüklenir; kullanıcılar uygulamayı açınca
  yeni sürümü görür. Play Store'a tekrar yüklemek gerekmez.
- Sadece uygulama adı, simgesi ya da paket ayarları değişirse PWABuilder'da **aynı imza anahtarıyla** yeni `.aab`
  oluşturup sürüm kodunu artırarak yükle.
