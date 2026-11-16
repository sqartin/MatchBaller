// Otomatik tamamlama: yazılan harflerle başlayan futbolcular, en ünlüden başlayarak.
// Liste seçilen takımlardan bağımsızdır, yani doğru cevabı ele vermez.
import { readFile } from 'node:fs/promises';
import { normalize, fixLabel } from './match.js';

let index = [];

export async function reloadPlayers() {
  const raw = JSON.parse(await readFile(new URL('../data/players.json', import.meta.url), 'utf8'));
  // raw zaten ünlülüğe göre sıralı (s = Wikipedia dil sayısı)
  index = raw.map(p => {
    const name = fixLabel(p.n);
    const full = normalize(name);
    return { id: p.id, name, image: p.i || null, full, words: full.split(' ') };
  });
}
await reloadPlayers();

export const playerCount = () => index.length;

/** q: kullanıcının yazdığı metin. Ad, soyad ya da tam adın başı eşleşir. */
export function suggest(q, limit = 8) {
  const nq = normalize(String(q).slice(0, 40));
  if (!nq) return [];
  const multi = nq.includes(' ');
  const out = [];
  for (const p of index) {
    const hit = p.full.startsWith(nq)
      || (multi ? p.full.includes(` ${nq}`) : p.words.some(w => w.startsWith(nq)));
    if (hit) {
      out.push({ id: p.id, name: p.name, image: p.image });
      if (out.length === limit) break;
    }
  }
  return out;
}
