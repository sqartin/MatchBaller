// Wikidata'da arması olmayan kulüplerin armasını Wikipedia makalesinin ana görselinden bulur.
// data/teams.json dosyasını yerinde günceller. Kullanım: npm run fetch-logos
import { readFile, writeFile } from 'node:fs/promises';

const UA = 'MatchBallerGame/0.1 (football trivia game)';
const file = new URL('../data/teams.json', import.meta.url);
const teams = JSON.parse(await readFile(file, 'utf8'));
const missing = teams.filter(t => !t.logo);
console.log(`${missing.length} kulübün arması eksik`);

const WIKIS = ['en', 'tr', 'de', 'es', 'it', 'fr', 'pt'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sparql(query) {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  return (await res.json()).results.bindings;
}

// 1) Her kulüp için Wikipedia makale adları (dil sırasına göre)
const articles = new Map(); // id -> {lang: title}
for (let i = 0; i < missing.length; i += 400) {
  const ids = missing.slice(i, i + 400).map(t => `wd:${t.id}`).join(' ');
  const rows = await sparql(`SELECT ?club ?article ?lang WHERE {
    VALUES ?club { ${ids} }
    ?article schema:about ?club ; schema:inLanguage ?lang ; schema:isPartOf ?site .
    FILTER(?lang IN (${WIKIS.map(w => `"${w}"`).join(',')}))
    FILTER(CONTAINS(STR(?site), "wikipedia.org"))
  }`);
  for (const r of rows) {
    const id = r.club.value.split('/').pop();
    const title = decodeURIComponent(r.article.value.split('/wiki/')[1]).replace(/_/g, ' ');
    if (!articles.has(id)) articles.set(id, {});
    articles.get(id)[r.lang.value] = title;
  }
  process.stdout.write(`\rmakale adları: ${Math.min(i + 400, missing.length)}/${missing.length}`);
}
console.log();

// 2) Her dil için PageImages API ile ana görsel (pilicense=any: Wikipedia'daki adil kullanım logoları dahil)
async function pageImages(lang, titles) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1`
    + `&prop=pageimages&piprop=thumbnail&pithumbsize=120&pilicense=any&titles=${encodeURIComponent(titles.join('|'))}`;
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.status !== 429) break;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
    process.stdout.write(` [429, ${wait / 1000}s bekleniyor]`);
    await sleep(wait);
  }
  if (!res.ok) throw new Error(`${lang}wiki ${res.status}`);
  const json = await res.json();
  const map = new Map();
  const back = new Map();
  for (const n of json.query?.normalized || []) back.set(n.to, n.from);
  for (const r of json.query?.redirects || []) back.set(r.to, back.get(r.from) || r.from);
  for (const p of json.query?.pages || []) {
    if (p.thumbnail?.source) map.set(back.get(p.title) || p.title, p.thumbnail.source);
  }
  return map;
}

let found = 0;
for (const lang of WIKIS) {
  const todo = missing.filter(t => !t.logo && articles.get(t.id)?.[lang]);
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const imgs = await pageImages(lang, batch.map(t => articles.get(t.id)[lang]));
    for (const t of batch) {
      const src = imgs.get(articles.get(t.id)[lang]);
      // Stadyum/kadro fotoğrafı değil arma olsun: svg/png tercih, jpg'yi ele
      if (src && !/\.jpe?g/i.test(src)) { t.logo = src; found++; }
    }
    await sleep(1000);
  }
  console.log(`${lang}: toplam ${found} arma bulundu`);
}

await writeFile(file, JSON.stringify(teams));
console.log(`Bitti. Armalı kulüp: ${teams.filter(t => t.logo).length}/${teams.length}`);
