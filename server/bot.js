// Bot rakip: sırada belli bir süre insan rakip bulunamazsa devreye girer.
// Sunucuya sıradan bir oyuncu gibi socket.io ile bağlanır; oyuncu onu normal bir rakip olarak görür.
// Zorluk: raundların yaklaşık üçte ikisinde 20-75 sn arasında doğru cevabı bulur, arada birkaç yanlış dener.
import { io as connect } from 'socket.io-client';

const BOT_NAMES = ['Kaan', 'Mert', 'Elif', 'Deniz', 'Arda', 'Zeynep', 'Emre', 'Selin', 'Burak', 'Ece',
  'Leo', 'Sofia', 'Mateo', 'Lena', 'Luca', 'Nina', 'Jonas', 'Lucas', 'Marta', 'Diego'];
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
// İnsan gibi görünsün: bazen sayı ekli kullanıcı adı
const botName = () => {
  const n = pickOne(BOT_NAMES);
  return Math.random() < 0.4 ? `${n}${Math.floor(rand(7, 99))}` : n;
};

/**
 * @param {object} o
 * @param {number} o.port           sunucu portu
 * @param {string} o.secret         bot girişini doğrulayan gizli anahtar
 * @param {string} o.mode           'cc' | 'nc'
 * @param {() => {clubs: string[], countries: string[], decoys: string[]}} o.pool  seçilecek kulüp/ülke ve yanlış tahmin isimleri
 * @param {(botUserId: string) => Promise<{id: string, name: string}[] | null>} o.answersFor  botun maçındaki doğru cevaplar
 */
export function spawnBot({ port, secret, mode, pool, answersFor }) {
  const s = connect(`http://127.0.0.1:${port}`, { reconnection: false, transports: ['websocket'] });
  let roundTimers = [];
  const later = (ms, fn) => roundTimers.push(setTimeout(fn, ms));
  const clearRound = () => { roundTimers.forEach(clearTimeout); roundTimers = []; };
  const quit = () => { clearRound(); s.disconnect(); };
  let userId;
  let matched = false;

  s.on('connect', () => {
    s.emit('auth', { botSecret: secret, name: botName() }, r => {
      if (!r?.ok) return quit();
      userId = r.user.id;
      s.emit('queue:join', { mode });
    });
  });

  // Kimse eşleşmezse (insan oyuncu vazgeçtiyse) bot da ayrılır
  setTimeout(() => { if (!matched) quit(); }, 20_000);

  s.on('match:found', () => { matched = true; });

  s.on('round:pick', ({ role }) => {
    clearRound();
    const choices = role === 'country' ? pool().countries : pool().clubs;
    const tryPick = (left = 4) => s.emit('pick', { id: pickOne(choices) }, r => { if (!r?.ok && left) tryPick(left - 1); });
    later(rand(3000, 10000), tryPick);
  });

  let willSolve = false;
  // Rakip pas derse: çözmeye niyetli değilse kısa bir süre sonra o da pas der
  s.on('opponent:passed', () => {
    if (!willSolve || Math.random() < 0.3) later(rand(1500, 5000), () => s.emit('pass', {}, () => {}));
  });

  s.on('round:start', async () => {
    willSolve = Math.random() < 0.65;
    const answers = await answersFor(userId);
    if (!answers?.length) return;
    const solveAt = rand(20_000, 75_000);
    const wrongCount = Math.floor(rand(1, 4));
    for (let i = 0; i < wrongCount; i++) {
      later(rand(6000, solveAt - 2000), () => s.emit('guess', { text: pickOne(pool().decoys) }, () => {}));
    }
    if (willSolve) {
      const p = pickOne(answers);
      later(solveAt, () => s.emit('guess', { text: p.name, id: p.id }, () => {}));
    }
  });

  s.on('round:end', clearRound);
  s.on('match:end', () => setTimeout(quit, 500));
  s.on('disconnect', clearRound);
  return { quit };
}
