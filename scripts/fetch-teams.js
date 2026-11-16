// Wikidata'dan futbol kulüplerini indirir -> data/teams.json
// Kullanım: npm run fetch-teams [-- --min-sitelinks=8]
//
// İki aşama: tek dev sorgu zaman aşımına uğruyor.
//  1) Kulüp kimlikleri + ünlülük. "Erkek futbol takımı" gibi alt türler de dahil (Chelsea, Barcelona…).
//  2) Ad, ülke ve arma bilgisi, 300'lük gruplar halinde.
import { readFile, writeFile } from 'node:fs/promises';

const minArg = process.argv.find(a => a.startsWith('--min-sitelinks='));
const MIN_SITELINKS = minArg ? Number(minArg.split('=')[1]) : 8;
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'MatchBallerGame/0.1 (football trivia game)';

async function sparql(query, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    });
    if (res.ok) {
      try { return JSON.parse(await res.text()).results.bindings; } catch { /* yarım/bozuk cevap, tekrar */ }
    }
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error('Wikidata sorgusu başarısız');
}

const detailQuery = ids => `SELECT ?club ?en ?tr ?countryLabel ?logo WHERE {
  VALUES ?club { ${ids.map(x => `wd:${x}`).join(' ')} }
  OPTIONAL { ?club rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?club rdfs:label ?tr FILTER(LANG(?tr) = "tr") }
  OPTIONAL { ?club wdt:P17 ?country . ?country rdfs:label ?countryLabel FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?club wdt:P154 ?logo }
}`;

// Bozuk cevap veren grubu ikiye böl; tek kulüpte de bozuksa o kulübü atla.
async function details(ids) {
  try {
    return await sparql(detailQuery(ids), ids.length > 1 ? 2 : 3);
  } catch {
    if (ids.length === 1) { console.log(`\n  ${ids[0]} atlandı`); return []; }
    const mid = Math.ceil(ids.length / 2);
    return [...await details(ids.slice(0, mid)), ...await details(ids.slice(mid))];
  }
}

// 1) Kimlikler
const idRows = await sparql(`SELECT ?club ?sl WHERE {
  ?club wdt:P31/wdt:P279* wd:Q476028 ;
        wikibase:sitelinks ?sl .
  FILTER(?sl >= ${MIN_SITELINKS})
  FILTER NOT EXISTS { ?club wdt:P576 ?dissolved }
}`);
// Milli takımlar (A, genç, kadın) kulüp değil. Ayrı sorguyla bulup çıkar (aynı sorguda zaman aşımı oluyor).
const nationalRows = await sparql(`SELECT DISTINCT ?t WHERE {
  ?cls wdt:P279* wd:Q6979593 .
  ?t wdt:P31 ?cls .
}`);
const national = new Set(nationalRows.map(r => r.t.value.split('/').pop()));
console.log(`${national.size} milli takım hariç tutulacak`);
const pop = new Map();
for (const r of idRows) {
  const id = r.club.value.split('/').pop();
  if (!national.has(id)) pop.set(id, Number(r.sl.value));
}
const ids = [...pop.keys()];
console.log(`${ids.length} kulüp kimliği`);

// 2) Ayrıntılar
const byId = new Map();
for (let i = 0; i < ids.length; i += 300) {
  const rows = await details(ids.slice(i, i + 300));
  for (const b of rows) {
    const id = b.club.value.split('/').pop();
    const name = b.tr?.value || b.en?.value;
    if (!name || /^Q\d+$/.test(name) || byId.has(id)) continue;
    // FIFA dışı bölge seçkileri (Laponya, Tibet…) Wikidata'da milli takım olarak işaretli değil
    if (/mill[iî] futbol takımı|national (association )?football team/i.test(`${name} ${b.en?.value || ''}`)) continue;
    byId.set(id, {
      id,
      name,
      en: b.en?.value && b.en.value !== name ? b.en.value : undefined,
      country: b.countryLabel?.value || '',
      logo: b.logo ? `${b.logo.value.replace('http://', 'https://')}?width=96` : undefined,
      pop: pop.get(id),
    });
  }
  process.stdout.write(`\rayrıntılar: ${Math.min(i + 300, ids.length)}/${ids.length}`);
}
console.log();

const teams = [...byId.values()].sort((a, b) => b.pop - a.pop);
const out = new URL('../data/teams.json', import.meta.url);
let old = [];
try { old = JSON.parse(await readFile(out, 'utf8')); } catch { /* ilk çalıştırma */ }
// Wikipedia'dan bulunmuş armaları koru (fetch-logos sonra eksikleri tamamlar)
const oldLogo = new Map(old.map(t => [t.id, t.logo]));
for (const t of teams) if (!t.logo && oldLogo.get(t.id)) t.logo = oldLogo.get(t.id);
if (teams.length < old.length * 0.8) throw new Error(`Şüpheli az kulüp (${teams.length} < ${old.length}), dosya korunuyor`);
await writeFile(out, JSON.stringify(teams));
console.log(`${teams.length} takım kaydedildi -> data/teams.json`);
