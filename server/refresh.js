// Statik veri dosyalarını (kulüpler, armalar, futbolcular) günde bir kez yeniler.
// Maç cevapları zaten her maçta Wikidata'dan canlı çekilir; bu sadece listeler için.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DAY = 24 * 60 * 60 * 1000;
const STEPS = ['fetch-teams.js', 'fetch-logos.js', 'fetch-countries.js', 'fetch-players.js'];
const scriptPath = f => fileURLToPath(new URL(`../scripts/${f}`, import.meta.url));
let running = false;

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath(script)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${script}: ${err.trim().split('\n').pop()}`))));
  });
}

async function refresh(onDone) {
  if (running) return;
  running = true;
  console.log('Veri yenileme başladı (arka planda)');
  try {
    for (const s of STEPS) await run(s);
    await onDone();
  } catch (e) {
    console.error('Veri yenileme hatası, eski veriyle devam:', e.message);
  } finally {
    running = false;
  }
}

export async function scheduleRefresh(onDone) {
  if (process.env.AUTO_REFRESH === '0') return;
  let age = Infinity;
  try { age = Date.now() - (await stat(fileURLToPath(new URL('../data/players.json', import.meta.url)))).mtimeMs; } catch { /* yok */ }
  setTimeout(() => {
    refresh(onDone);
    setInterval(() => refresh(onDone), DAY);
  }, Math.max(0, DAY - age));
}
