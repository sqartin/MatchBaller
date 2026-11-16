// Android uygulaması için web dosyalarını hazırlar: public/ -> www/
// Uygulama, oyun sunucusuna APP_API_BASE adresinden bağlanır.
//
// Ortam değişkenleri:
//   APP_API_BASE          (zorunlu) yayındaki sunucu, örn. https://match-baller.onrender.com
//   GOOGLE_CLIENT_ID      Google girişi için WEB client ID (sunucudakiyle aynı)
//   ADMOB_BANNER_ID       AdMob banner reklam birimi   (yoksa Google'ın TEST birimi)
//   ADMOB_INTERSTITIAL_ID AdMob geçiş reklamı birimi   (yoksa Google'ın TEST birimi)
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = rel => fileURLToPath(new URL(rel, root));

const apiBase = (process.env.APP_API_BASE || '').replace(/\/+$/, '');
// Yerel test için APP_ALLOW_HTTP=1 ile http:// de kabul edilir (yayın derlemesinde asla kullanma)
if (!/^https:\/\//.test(apiBase) && !(process.env.APP_ALLOW_HTTP === '1' && /^http:\/\//.test(apiBase))) {
  console.error('APP_API_BASE gerekli ve https:// ile başlamalı (örn. https://match-baller.onrender.com)');
  process.exit(1);
}

// Google'ın resmi TEST reklam birimleri: gerçek kimlikler verilmezse bunlar kullanılır (para kazandırmaz, hesabı riske atmaz)
const TEST = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
};
const ads = {
  banner: process.env.ADMOB_BANNER_ID || TEST.banner,
  interstitial: process.env.ADMOB_INTERSTITIAL_ID || TEST.interstitial,
  testing: !process.env.ADMOB_BANNER_ID || !process.env.ADMOB_INTERSTITIAL_ID,
};

await rm(path('www'), { recursive: true, force: true });
await cp(path('public'), path('www'), { recursive: true });
// Uygulamada service worker ve çevrimdışı önbellek gerekmez (dosyalar zaten uygulamanın içinde)
await rm(path('www/sw.js'), { force: true });

// socket.io istemcisini uygulamanın içine koy (web'de sunucu bu yolu kendisi verir)
await mkdir(path('www/socket.io'), { recursive: true });
await cp(path('node_modules/socket.io-client/dist/socket.io.min.js'), path('www/socket.io/socket.io.js'));

await writeFile(path('www/config.js'), `// build-app.mjs tarafından üretildi
window.MB_CONFIG = ${JSON.stringify({
  apiBase,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  ads,
}, null, 2)};
`);

console.log(`www/ hazır. Sunucu: ${apiBase}. Reklamlar: ${ads.testing ? 'TEST birimleri' : 'gerçek birimler'}.`);
// Kontrol: index.html config.js'i yüklüyor mu
const html = await readFile(path('www/index.html'), 'utf8');
if (!html.includes('config.js')) console.warn('Uyarı: index.html config.js yüklemiyor');
