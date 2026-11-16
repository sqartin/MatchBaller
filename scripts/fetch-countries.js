// Ülke-Kulüp modu için ülke listesi (bayraklı) -> data/countries.json
// Bağımsız devletler + futbolda ayrı yarışan İngiltere, İskoçya, Galler, Kuzey İrlanda.
// İki aşama: önce kimlikler, sonra ayrıntılar (tek sorgu zaman aşımına uğruyor).
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'MatchBallerGame/0.1 (football trivia game)';
const FOOTBALL_NATIONS = ['Q21', 'Q22', 'Q25', 'Q26', 'Q55', 'Q35']; // England, Scotland, Wales, N. Ireland, Hollanda, Danimarka (Wikidata'da egemen devlet olarak değil)

async function sparql(query) {
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) return JSON.parse(await res.text()).results.bindings;
    } catch { /* zaman aşımı ya da yarım cevap, tekrar */ }
    await new Promise(r => setTimeout(r, 3000 * (a + 1)));
  }
  throw new Error('Wikidata sorgusu başarısız');
}

// 1) Kimlikler
const idRows = await sparql(`SELECT DISTINCT ?c WHERE { ?c wdt:P31 wd:Q3624078 . FILTER NOT EXISTS { ?c wdt:P576 ?end } }`);
const ids = [...new Set([...idRows.map(r => r.c.value.split('/').pop()), ...FOOTBALL_NATIONS])];
console.log(`${ids.length} ülke kimliği`);

// 2) Ayrıntılar
const flagUrl = u => `${u.replace('http://', 'https://')}?width=96`;
const byId = new Map();
for (let i = 0; i < ids.length; i += 100) {
  const rows = await sparql(`SELECT ?c ?en ?tr ?flag ?sl WHERE {
    VALUES ?c { ${ids.slice(i, i + 100).map(x => `wd:${x}`).join(' ')} }
    ?c wikibase:sitelinks ?sl .
    OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en) = "en") }
    OPTIONAL { ?c rdfs:label ?tr FILTER(LANG(?tr) = "tr") }
    OPTIONAL { ?c wdt:P41 ?flag }
  }`);
  for (const b of rows) {
    const id = b.c.value.split('/').pop();
    if (byId.has(id)) continue; // birden çok bayrak kaydı varsa ilki
    const name = b.tr?.value || b.en?.value;
    if (!name) continue;
    byId.set(id, {
      id,
      name,
      en: b.en?.value && b.en.value !== name ? b.en.value : undefined,
      flag: b.flag ? flagUrl(b.flag.value) : undefined,
      pop: Number(b.sl.value),
    });
  }
}

// Futbolda öne çıkan ülkeler listenin başında; süre dolunca rastgele ülke de bunlardan seçilir.
const FOOTBALL_FIRST = [
  'Q155', 'Q414', 'Q142', 'Q183', 'Q29', 'Q38', 'Q21', 'Q55', 'Q45', 'Q31', 'Q43', 'Q77', 'Q224',
  'Q739', 'Q96', 'Q30', 'Q1028', 'Q1041', 'Q1033', 'Q1008', 'Q117', 'Q1009', 'Q35', 'Q34', 'Q36',
  'Q403', 'Q39', 'Q40', 'Q22', 'Q25', 'Q17', 'Q884', 'Q298', 'Q736', 'Q419', 'Q213', 'Q218', 'Q41',
];
const rank = id => { const i = FOOTBALL_FIRST.indexOf(id); return i < 0 ? Infinity : i; };
const countries = [...byId.values()]
  .map(c => (rank(c.id) < Infinity ? { ...c, football: true } : c))
  .sort((a, b) => rank(a.id) - rank(b.id) || b.pop - a.pop);
const out = new URL('../data/countries.json', import.meta.url);
let oldCount = 0;
try { oldCount = JSON.parse(await readFile(out, 'utf8')).length; } catch { /* ilk */ }
if (countries.length < oldCount * 0.9) throw new Error('Şüpheli az ülke, dosya korunuyor');
await writeFile(out, JSON.stringify(countries));
console.log(`${countries.length} ülke kaydedildi (${countries.filter(c => c.flag).length} bayraklı)`);
