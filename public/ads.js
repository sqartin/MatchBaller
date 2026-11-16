// AdMob reklamları (sadece Android uygulamasında; web sürümünde hiçbir şey yapmaz).
//
// Kurallar (AdMob politikalarına uygun ve oyuncuyu bıktırmayacak şekilde):
//  - Banner sadece menü ekranlarında (ana ekran, profil, sıralama, ayarlar). Maç sırasında asla.
//  - Geçiş (tam ekran) reklamı sadece maç bittikten sonra, sonuç ekranından çıkarken;
//    en sık 2 maçta bir ve en az 3 dakika arayla.
//  - AB/AEA kullanıcıları için Google'ın onay formu (GDPR) reklamdan önce gösterilir.

const cfg = window.MB_CONFIG?.ads;
const AdMob = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.AdMob : null;
const enabled = !!(AdMob && cfg);

const MENU_SCREENS = new Set(['home', 'profile', 'leaderboard', 'settings', 'mode']);
const INTERSTITIAL_EVERY = 2;
const INTERSTITIAL_MIN_GAP_MS = 3 * 60 * 1000;

let ready = false;
let bannerShown = false;
let bannerLoaded = false;
let interstitialReady = false;
let matchesSinceAd = 0;
let lastInterstitialAt = 0;

async function prepareInterstitial() {
  if (!ready) return;
  try {
    await AdMob.prepareInterstitial({ adId: cfg.interstitial, isTesting: cfg.testing });
    interstitialReady = true;
  } catch { interstitialReady = false; }
}

export async function initAds() {
  if (!enabled) return;
  try {
    await AdMob.initialize({ initializeForTesting: cfg.testing });
    // GDPR / onay formu
    const info = await AdMob.requestConsentInfo();
    if (info?.isConsentFormAvailable && info.status === 'REQUIRED') await AdMob.showConsentForm();
    ready = true;
    // Banner yüksekliği kadar alt boşluk bırak ki içerik reklamın altında kalmasın
    AdMob.addListener('bannerAdSizeChanged', size => {
      document.documentElement.style.setProperty('--ad-h', `${size?.height || 0}px`);
    });
    prepareInterstitial();
  } catch (e) {
    console.warn('Reklamlar başlatılamadı', e);
  }
}

/** Ekran değişince çağrılır: banner sadece menü ekranlarında görünür */
export async function onScreen(name) {
  if (!ready) return;
  const want = MENU_SCREENS.has(name);
  try {
    if (want && !bannerShown) {
      if (bannerLoaded) await AdMob.resumeBanner();
      else {
        await AdMob.showBanner({ adId: cfg.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: cfg.testing });
        bannerLoaded = true;
      }
      bannerShown = true;
      document.body.classList.add('has-banner');
    } else if (!want && bannerShown) {
      await AdMob.hideBanner();
      bannerShown = false;
      document.body.classList.remove('has-banner');
    }
  } catch { /* reklam yüklenemezse oyun etkilenmez */ }
}

/** Maç bitince çağrılır */
export function onMatchEnd() {
  matchesSinceAd++;
}

/** Sonuç ekranından çıkarken: uygunsa geçiş reklamını göster, sonra devam et */
export async function maybeInterstitial() {
  if (!ready || !interstitialReady) return;
  if (matchesSinceAd < INTERSTITIAL_EVERY || Date.now() - lastInterstitialAt < INTERSTITIAL_MIN_GAP_MS) return;
  try {
    interstitialReady = false;
    await AdMob.showInterstitial();
    matchesSinceAd = 0;
    lastInterstitialAt = Date.now();
  } catch { /* gösterilemezse sorun değil */ }
  prepareInterstitial();
}

export const adsEnabled = enabled;
