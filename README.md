# Match Baller

Online, 1'e 1 futbol bilgi düellosu (mobil web / PWA).
İki oyuncu 25 saniyede birer kulüp seçer. İki kulüpte de oynamış bir futbolcuyu ilk yazan kazanır.

## Çalıştırma

```bash
npm install
npm start
```

Tarayıcıda http://localhost:3000 adresini aç. Test için iki sekme aç ya da `node scripts/bot.mjs` ile bir test rakibi başlat.

## Veri

- `data/teams.json`: Wikidata'dan indirilen ~5500 aktif futbol kulübü. Güncellemek için `npm run fetch-teams` komutunu çalıştır (`-- --min-sitelinks=3` ile daha küçük kulüpler de gelir).
- Ortak futbolcular maç başında Wikidata'dan (P54 "oynadığı takım") canlı sorgulanır, sonuç önbelleğe alınır.
- `data/teams.json` armaları: önce Wikidata, eksikler Wikipedia makalesinin ana görselinden (`npm run fetch-logos`). 5506 kulübün 5216'sında arma var, kalanlarda baş harfli forma gösterilir.
- `data/players.json`: otomatik tamamlama için ~92 bin futbolcu, ünlülüğe göre sıralı, fotoğraflı olanlar Commons'tan (`npm run fetch-players`).
- `data/users.json`: oyuncu profilleri ve G/B/M istatistikleri.
- Sunucu kulüp, arma ve futbolcu listelerini günde bir kez kendisi yeniler (`server/refresh.js`). Kapatmak için `AUTO_REFRESH=0`.
- Maç cevapları her maçta Wikidata'dan canlı çekilir (6 saat önbellek). Wikidata topluluk tarafından güncellenir; çok yeni transferler birkaç gün gecikebilir.

## Maç akışı

- Maç **ilk 3 raundu alan** tarafından kazanılır (en fazla 9 raund; sonra skora bakılır). Skor maç boyunca üstte görünür.
- Her raund: 25 sn seçim → ikisi de seçince **3-2-1** geri sayım → 90 sn tahmin → 5 sn raund sonucu.
- Ülke-Kulüp modunda roller her raund yer değiştirir. Maç sırasında çıkan oyuncu hükmen kaybeder.
- Ses efektleri (`public/sfx.js`) Web Audio ile anında üretilir; ses dosyası yoktur. Ayarlardan kapatılabilir.

## Sıralama, kupa ve ligler

- **Sıralama:** tüm zamanlar (toplam galibiyet) ve bu hafta (pazartesi sıfırlanır). İlk 3 kürsüde; oyuncunun kendi sırası her zaman görünür.
- **Kupa:** galibiyet +30 (3+ maçlık seride +10 bonus), beraberlik +5, mağlubiyet -20 (0'ın altına inmez).
- **Ligler:** Amatör 0, Yarı Profesyonel 150, Profesyonel 400, Yıldız 800, Efsane 1500 kupa (`server/progress.js`).
- **Paylaş:** maç sonucu telefonun paylaşım menüsüyle (WhatsApp, Instagram…) paylaşılır; menü yoksa panoya kopyalanır.
- Botlar ve otomatik test hesapları (`guestId` `e2e-` ile başlayan) kaydedilmez, sıralamada görünmez.

## Modlar

- **Kulüp – Kulüp:** iki oyuncu da kulüp seçer; iki kulüpte de oynamış futbolcu aranır.
- **Ülke – Kulüp:** biri ülke, diğeri kulüp seçer (roller rastgele). O ülkenin vatandaşı ya da o ülke adına oynayan (Wikidata P27/P1532) ve o kulüpte oynamış futbolcu aranır.
- `data/countries.json`: bağımsız devletler + İngiltere, İskoçya, Galler, Kuzey İrlanda, Hollanda, Danimarka (`npm run fetch-countries`).

## Bot rakip

Sırada 15 saniye içinde insan rakip bulunamazsa bot rakip gelir. Bot sıradan bir oyuncu adıyla görünür; istemci botu ayırt edemez. Bot maçların yaklaşık üçte ikisinde 20-75 sn içinde doğru cevabı bulur. Süreyi değiştirmek için `BOT_AFTER_MS` (ms). Bot maçları da G/B/M istatistiğine sayılır.

> Aynı tarayıcıdaki sekmeler aynı hesabı paylaşır; bir hesap kendisiyle eşleşmez. İki kişilik testi iki farklı tarayıcı / gizli pencere / telefonla yap.

## Diller

Arayüz Türkçe, İngilizce, İspanyolca ve Almanca. Çeviriler `public/i18n.js` içinde; yeni dil için oraya bir blok ekle.

> Kulüp armaları tescilli markadır. Wikipedia'daki çoğu arma "adil kullanım" ile yüklenmiştir; uygulamayı mağazada yayınlamadan önce kullanım hakkını kontrol et.

## Google ile giriş

1. Google Cloud Console'da bir proje aç. APIs & Services, Credentials, "OAuth client ID" (Web application) oluştur.
2. "Authorized JavaScript origins" alanına sitenin adresini ekle (ör. `http://localhost:3000`).
3. `.env.example` dosyasını `.env` olarak kopyala, `GOOGLE_CLIENT_ID=` satırına ID'yi yapıştır, `npm start` ile başlat.

Client ID yoksa sadece misafir girişi görünür.

## Test

`node scripts/e2e.mjs`: iki sahte oyuncuyla eşleşme, aynı takım engeli, yanlış ve doğru tahmin. Sunucu açık olmalı.

## Play Store

Adım adım yayın rehberi: [PLAY_STORE.md](PLAY_STORE.md). Mağaza metinleri ve görseller: `store/`.

## Telefona uygulama olarak

- Şimdilik: telefondan siteyi açıp "Ana ekrana ekle".
- Mağaza için: Capacitor ile `public/` Android/iOS uygulamasına sarılır. Sunucu internette barındırılmalı (Render, Railway, Fly.io vb.).
