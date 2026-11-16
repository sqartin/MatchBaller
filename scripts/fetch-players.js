// Otomatik tamamlama için futbolcu dizini: ad, fotoğraf, ünlülük (Wikipedia dil sayısı).
// Doğru cevapları sızdırmaz: tüm ünlü futbolcular listede, seçilen takımlardan bağımsız.
// Kullanım: npm run fetch-players [-- --min-sitelinks=6]
import { readFile, writeFile } from 'node:fs/promises';

const minArg = process.argv.find(a => a.startsWith('--min-sitelinks='));
const MIN = minArg ? Number(minArg.split('=')[1]) : 6;
const UA = 'MatchBallerGame/0.1 (football trivia game)';

// Ünlülüğe göre dilimler: tek sorguda zaman aşımı olmasın
const BANDS = [[MIN, MIN], [MIN + 1, MIN + 1], [MIN + 2, MIN + 2], [MIN + 3, MIN + 3], [MIN + 4, MIN + 4], [MIN + 5, MIN + 5], [MIN + 6, MIN + 7], [MIN + 8, MIN + 10], [MIN + 11, MIN + 15], [MIN + 16, MIN + 25], [MIN + 26, 1000]];

async function band(lo, hi) {
  const q = `SELECT ?p ?label ?img ?sl WHERE {
    ?p wdt:P106 wd:Q937857 ; wikibase:sitelinks ?sl .
    FILTER(?sl >= ${lo} && ?sl <= ${hi})
    ?p rdfs:label ?label FILTER(LANG(?label) = "en")
    OPTIONAL { ?p wdt:P18 ?img }
  }`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    });
    if (res.ok) { try { return JSON.parse(await res.text()).results.bindings; } catch { console.log(`  ${lo}-${hi}: yarım cevap`); } }
    else console.log(`  ${lo}-${hi}: HTTP ${res.status}`);

    await new Promise(r => setTimeout(r, 5000));
  }
  if (lo === hi) return lightBand(lo);
  const mid = Math.floor((lo + hi) / 2);
  return [...await band(lo, mid), ...await band(mid + 1, hi)];
}

// Ağır sorgu zaman aşımına uğrarsa: önce sadece ad, sonra fotoğraflar küçük gruplar halinde.
async function json(q) {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } });
    try { if (res.ok) return JSON.parse(await res.text()).results.bindings; } catch { /* yarım cevap */ }
    await new Promise(r => setTimeout(r, 4000));
  }
  return null;
}
async function lightBand(sl) {
  const rows = await json(`SELECT ?p ?label ?sl WHERE { ?p wdt:P106 wd:Q937857 ; wikibase:sitelinks ?sl . FILTER(?sl = ${sl}) ?p rdfs:label ?label FILTER(LANG(?label) = "en") }`);
  if (!rows) { console.log(`  ${sl}: atlandı`); return []; }
  const imgs = new Map();
  const ids = rows.map(r => r.p.value.split('/').pop());
  for (let i = 0; i < ids.length; i += 300) {
    const part = await json(`SELECT ?p ?img WHERE { VALUES ?p { ${ids.slice(i, i + 300).map(x => 'wd:' + x).join(' ')} } ?p wdt:P18 ?img }`) || [];
    for (const r of part) imgs.set(r.p.value, r.img);
  }
  return rows.map(r => ({ ...r, img: imgs.get(r.p.value) }));
}

const byId = new Map();
for (const [lo, hi] of BANDS) {
  const rows = await band(lo, hi);
  for (const r of rows) {
    const id = r.p.value.split('/').pop();
    if (byId.has(id)) continue;
    const img = r.img?.value
      ? r.img.value.replace('http://', 'https://') + '?width=80'
      : undefined;
    byId.set(id, { id, n: r.label.value, i: img, s: Number(r.sl.value) });
  }
  console.log(`${lo}-${hi}: ${rows.length} satır, toplam ${byId.size}`);
}

const players = [...byId.values()].sort((a, b) => b.s - a.s);
const out = new URL('../data/players.json', import.meta.url);
let oldCount = 0;
try { oldCount = JSON.parse(await readFile(out, 'utf8')).length; } catch { /* ilk çalıştırma */ }
if (players.length < oldCount * 0.9) throw new Error(`Şüpheli az futbolcu (${players.length} < ${oldCount}), dosya korunuyor`);
await writeFile(out, JSON.stringify(players));
console.log(`${players.length} futbolcu kaydedildi -> data/players.json (${players.filter(p => p.i).length} fotoğraflı)`);
