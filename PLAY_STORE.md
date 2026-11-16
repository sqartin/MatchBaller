# Match Baller'ı Play Store'a koyma rehberi (Capacitor + AdMob)

Uygulama **Capacitor** ile paketlenmiş gerçek bir Android uygulamasıdır: oyun dosyaları uygulamanın içindedir,
oyun sunucusuna (Render) internet üzerinden bağlanır. Reklamlar **Google AdMob** ile gösterilir.
Uygulama bu bilgisayarda değil, **GitHub Actions** üzerinde derlenir; hiçbir şey kurman gerekmez.

Sıra:
1. Kod GitHub'a → 2. Sunucu Render'da → 3. İmza anahtarı → 4. Google girişi (Android) → 5. AdMob →
6. GitHub'da derleme → 7. Play Console

---

## 1. Kodu GitHub'a yükle
GitHub'da boş bir depo aç ve kodu yükle.

## 2. Sunucuyu Render'da yayına al
1. https://dashboard.render.com → **New → Blueprint** → GitHub deposunu seç. `render.yaml` her şeyi kurar
   (Docker, Frankfurt, `/data` kalıcı disk, `/healthz`).
2. Ortam değişkenlerini gir: `GOOGLE_CLIENT_ID` (web client ID).
3. Yayına girince adresin olur: `https://match-baller-xxxx.onrender.com`. Kontrol et:
   - `/` oyun açılıyor mu, `/privacy.html` açılıyor mu.
4. `public/privacy.html` içindeki `[İLETİŞİM E-POSTASI]` / `[CONTACT EMAIL]` yerlerine bir e-posta yaz.
5. Google Cloud → Google Auth Platform → Clients → web client → **Authorized JavaScript origins** listesine
   Render adresini ekle (web sürümünde Google girişi için).

## 3. Uygulama imza (yükleme) anahtarı
Bu bilgisayarda bir kere çalıştır (Java kurulu). Şifreleri sen belirle ve bir yere yaz:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Sonra dosyayı metne çevir (GitHub'a gizli değer olarak koymak için):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.keystore")) | Set-Clipboard
```

`upload.keystore` dosyasını ve şifreleri **güvenli bir yere yedekle**. Depoya asla koyma (`.gitignore` zaten engelliyor).
Play App Signing açık olduğu için bu anahtarı kaybedersen Play desteğinden sıfırlatabilirsin, ama uğraştırır.

SHA-1 parmak izini al (4. adım için):

```bash
keytool -list -v -keystore upload.keystore -alias upload
```

## 4. Google girişi (Android)
Uygulama içi tarayıcıda Google girişi çalışmaz; yerel giriş kullanılır. Google Cloud'da **Android** tipi
bir client daha gerekir:

1. Google Auth Platform → Clients → **Create client** → **Android**
2. Package name: `com.matchballer.app`
3. SHA-1: 3. adımdaki yükleme anahtarının SHA-1'i
4. Play Console'a ilk yüklemeden sonra **Uygulama bütünlüğü → Uygulama imzalama** sayfasındaki
   **uygulama imzalama anahtarı SHA-1**'i ile **ikinci bir Android client** daha oluştur
   (Play'den indirilen uygulama bu anahtarla imzalanır; bu yapılmazsa mağazadan kurulan uygulamada giriş çalışmaz).

Uygulama, giriş için yine **web client ID**'yi kullanır (sunucu bu kimliği doğrular); Android client'lar sadece izin içindir.

## 5. AdMob
1. https://admob.google.com → hesap aç → **Uygulamalar → Uygulama ekle** → Android, "Play'de yayında değil".
2. **Uygulama kimliği** (`ca-app-pub-…~…`) ve iki **reklam birimi** oluştur:
   - **Banner** (menülerde gösterilir)
   - **Geçiş reklamı / Interstitial** (2 maçta bir, maç bittikten sonra)
3. **Gizlilik ve mesajlaşma → GDPR** mesajı oluştur ve yayınla (AB kullanıcıları için onay formu; uygulama bunu otomatik gösterir).
4. Render'a `ADMOB_PUBLISHER_ID=pub-xxxxxxxxxxxxxxxx` ekle → `https://<render-adresin>/app-ads.txt` dosyası otomatik oluşur.
   Play Console'da geliştirici web sitesi olarak Render adresini yaz.

> AdMob kimlikleri verilmeden derlenen uygulama **Google'ın test reklamlarını** gösterir. Bu güvenlidir ama gelir getirmez.
> Kendi gerçek reklamlarına **asla kendin tıklama**; AdMob hesabı kapatılabilir. Test için kendi telefonunu
> AdMob'da **test cihazı** olarak ekle.

## 6. GitHub'da derle
GitHub deposu → **Settings → Secrets and variables → Actions**:

| Tür | Ad | Değer |
|---|---|---|
| Variable | `APP_API_BASE` | `https://match-baller-xxxx.onrender.com` |
| Variable | `GOOGLE_CLIENT_ID` | web client ID |
| Variable | `ADMOB_APP_ID` | `ca-app-pub-…~…` |
| Variable | `ADMOB_BANNER_ID` | `ca-app-pub-…/…` |
| Variable | `ADMOB_INTERSTITIAL_ID` | `ca-app-pub-…/…` |
| Secret | `KEYSTORE_BASE64` | 3. adımda panoya kopyalanan metin |
| Secret | `KEYSTORE_PASSWORD` | anahtar deposu şifresi |
| Secret | `KEY_ALIAS` | `upload` |
| Secret | `KEY_PASSWORD` | anahtar şifresi |

Sonra **Actions → Android AAB → Run workflow**. 5-10 dakika sonra çalıştırmanın sayfasındaki **Artifacts**
bölümünden `app-release.aab` dosyasını indir. Her çalıştırmada sürüm kodu otomatik artar.

## 7. Play Console
1. https://play.google.com/console → geliştirici hesabı (tek seferlik ücret). Yeni kişisel hesaplarda yayından önce
   **en az 12 test kullanıcısıyla 14 gün kapalı test** zorunlu.
2. **Uygulama oluştur:** "Match Baller", varsayılan dil Türkçe, **Oyun**, ücretsiz.
3. **Mağaza girişi:** metinler ve görseller `store/listing.md` ve `store/` klasöründe.
4. **Uygulama içeriği:** gizlilik politikası URL'si (`/privacy.html`), **Reklam içerir: Evet**, içerik derecelendirme,
   veri güvenliği (cevaplar `store/listing.md` sonunda), hedef yaş 13+,
   **Reklam kimliği** beyanı: Evet, reklam için kullanılıyor.
5. **Test → Kapalı test:** yeni sürüm → `.aab` yükle → test kullanıcılarını ekle.
6. 4. adımın son maddesi: Play imzalama SHA-1'i ile ikinci Android client'ı oluştur.
7. Test süresi dolunca **Üretim**'e gönder.

## Güncellemeler
- **Sunucu tarafı** (eşleşme, puanlama, veriler): GitHub'a gönder → Render otomatik yayınlar. Uygulamayı güncellemek gerekmez.
- **Arayüz** (ekranlar, tasarım, sesler, metinler): uygulamanın içinde olduğu için 6. adımı tekrar çalıştır
  ve yeni `.aab`'yi Play Console'a yükle.
