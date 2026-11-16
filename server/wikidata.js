// Maç cevaplarını Wikidata'dan canlı çeker.
//  - Kulüp-Kulüp: iki kulüpte de oynamış futbolcular
//  - Ülke-Kulüp: o ülkenin vatandaşı / o ülke adına oynayan ve o kulüpte oynamış futbolcular
import { fixLabel } from './match.js';
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'MatchBallerGame/0.1 (football trivia game)';
const cache = new Map(); // anahtar -> { at, promise }
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 saat: yeni transferler gecikmeden yansısın

// Not: wdt:P54 sadece "en iyi sıradaki" kaydı verir. Mevcut kulübü "tercihli" işaretli
// futbolcularda eski kulüpler kaybolur. Bu yüzden tüm (eskimiş olmayan) kayıtlara bakılır.
const playedFor = (v, club) => `
    ?p p:P54 ?${v} . ?${v} ps:P54 wd:${club} .
    FILTER NOT EXISTS { ?${v} wikibase:rank wikibase:DeprecatedRank }`;

// Ülke: vatandaşlık (P27) ya da sporda temsil ettiği ülke (P1532).
// P1532 sayesinde İngiltere/İskoçya gibi futbol ülkeleri de çalışır.
const fromCountry = country => `
    { ?p wdt:P27 wd:${country} } UNION { ?p wdt:P1532 wd:${country} }`;

const TAIL = `
    ?p wdt:P31 wd:Q5 .
    ?p rdfs:label ?label FILTER(LANG(?label) = "en")
    OPTIONAL { ?p skos:altLabel ?alt FILTER(LANG(?alt) IN ("en", "tr")) }
    OPTIONAL { ?p wdt:P18 ?img }
  } GROUP BY ?p ?label`;
const HEAD = 'SELECT DISTINCT ?p ?label (SAMPLE(?img) AS ?image) (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {';

function buildQuery(a, b) {
  if (a.kind === 'club' && b.kind === 'club') return HEAD + playedFor('s1', a.id) + playedFor('s2', b.id) + TAIL;
  const club = a.kind === 'club' ? a : b;
  const country = a.kind === 'country' ? a : b;
  return HEAD + playedFor('s1', club.id) + fromCountry(country.id) + `
    ?p wdt:P106 wd:Q937857 .` + TAIL;
}

async function runQuery(a, b) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(buildQuery(a, b))}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
      const json = await res.json();
      return json.results.bindings.map(r => ({
        id: r.p.value.split('/').pop(),
        name: fixLabel(r.label.value),
        alts: r.alts?.value ? r.alts.value.split('|') : [],
        image: r.image?.value ? `${r.image.value.replace('http://', 'https://')}?width=200` : null,
      }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** a, b: { kind: 'club' | 'country', id: 'Q…' } */
export function getAnswers(a, b) {
  const key = [`${a.kind}:${a.id}`, `${b.kind}:${b.id}`].sort().join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = runQuery(a, b);
  promise.catch(() => cache.delete(key)); // hatalıysa tekrar denenebilsin
  cache.set(key, { at: Date.now(), promise });
  return promise;
}
