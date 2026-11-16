// Tahmin eşleştirme: aksan/büyük harf/küçük yazım hatası toleranslı.

export function normalize(s) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/đ/g, 'd').replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const tolerance = len => (len >= 12 ? 2 : len >= 6 ? 1 : 0);
const close = (a, b) => a === b || levenshtein(a, b) <= tolerance(b.length);

/**
 * Tahmini oyuncu listesinde arar. Bulursa oyuncuyu döner, yoksa null.
 * Tam ad, takma ad veya (listede tekse) soyadı kabul edilir.
 */
export function findPlayer(guess, players) {
  const g = normalize(guess);
  if (g.length < 3) return null;

  for (const p of players) {
    const names = [p.name, ...p.alts].map(normalize).filter(n => n.length >= 3);
    if (names.some(n => close(g, n))) return p;
  }

  // Sadece soyad yazıldıysa: listede o soyadla tek kişi varsa kabul et.
  const bySurname = players.filter(p => {
    const parts = normalize(p.name).split(' ');
    return parts.length > 1 && close(g, parts[parts.length - 1]);
  });
  return bySurname.length === 1 ? bySurname[0] : null;
}

// Wikidata'da bazen Latin adların içine benzer görünen Yunanca/Kiril harfler karışıyor ("Αrda Güler").
// Ad Latin harf içeriyorsa bu harfleri Latin karşılığıyla değiştir.
const LOOKALIKE = { Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  ο: 'o', ν: 'v', А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y' };
export function fixLabel(name) {
  if (!/[A-Za-z]/.test(name)) return name;
  return name.replace(/[Ͱ-ϿЀ-ӿ]/g, ch => LOOKALIKE[ch] ?? ch);
}
