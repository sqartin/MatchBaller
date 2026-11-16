// Tek oyuncu sıraya girer; insan rakip yokken bot rakip gelmeli ve maçı oynamalı.
// Kullanım: node scripts/e2e-bot.mjs [cc|nc]
import { io } from 'socket.io-client';
const mode = process.argv[2] === 'nc' ? 'nc' : 'cc';
const URL = process.env.URL || 'http://localhost:3000';
const ok = (cond, msg) => { console.log(cond ? 'OK  ' : 'HATA', msg); if (!cond) process.exitCode = 1; };
const s = io(URL);
await new Promise(r => s.on('connect', r));
await new Promise(r => s.emit('auth', { guestId: 'e2e-solo' + Math.random().toString(36).slice(2), name: 'Solo' }, r));
const t0 = Date.now();
s.emit('queue:join', { mode });
const found = await new Promise(r => s.once('match:found', r));
const rp = await new Promise(r => s.once('round:pick', r));
ok(!('isBot' in found.opponent), `${((Date.now() - t0) / 1000).toFixed(1)} sn sonra rakip geldi (bot, etiketsiz): ${found.opponent.name}, mod ${found.mode}, rolüm ${rp.role}`);
s.emit('pick', { id: rp.role === 'country' ? 'Q43' : 'Q495299' }, () => {});
const teams = await new Promise(r => s.once('match:teams', r));
ok(teams.teams.every(x => x.team), `seçimler: ${teams.teams.map(x => `${x.kind}:${x.team.name}${x.random ? ' (rastgele)' : ''}`).join(' vs ')}`);
let wrong = 0;
s.on('opponent:attempt', () => wrong++);
const end = await new Promise(r => s.once('round:end', r));
ok(true, `raund 1 bitti: ${end.reason} / ben ${end.result}${end.player ? ` / ${end.player}` : ''} / botun yanlışları: ${wrong} / skor ${end.score.me}-${end.score.opp}`);
process.exit();
