// Uçtan uca test: iki sahte oyuncu.
//  - Kulüp-Kulüp: 3 raund alan kazanır, skor, 3-2-1 geri sayım, öneriler, id ile tahmin
//  - Ülke-Kulüp: roller, ülke seçimi, rakip çıkınca hükmen galibiyet
import { io } from 'socket.io-client';
const URL = process.env.URL || 'http://localhost:3000';
const uid = () => Math.random().toString(36).slice(2);
const mk = name => new Promise(r => { const s = io(URL); s.on('connect', () => s.emit('auth', { guestId: 'e2e-' + name + uid(), name }, () => r(s))); });
const call = (s, ev, data) => new Promise(r => s.emit(ev, data, r));
const once = (s, ev) => new Promise(r => s.once(ev, r));
const ok = (cond, msg) => { console.log(cond ? 'OK  ' : 'HATA', msg); if (!cond) process.exitCode = 1; };

// ---------- Kulüp – Kulüp, 3 raund ----------
console.log('--- Kulüp – Kulüp');
const a = await mk('Ali'), b = await mk('Ayse');
const fa = once(a, 'match:found'), pa = once(a, 'round:pick');
a.emit('queue:join', { mode: 'cc' }); b.emit('queue:join', { mode: 'cc' });
const found = await fa;
ok(found.winsNeeded === 3 && !('isBot' in found.opponent), `eşleşti, ${found.winsNeeded} olan kazanır, rakip: ${found.opponent.name}`);
const p1 = await pa;
ok(p1.round === 1 && p1.pickMs === 25000 && p1.score.me === 0, `raund 1, seçim ${p1.pickMs / 1000} sn, skor ${p1.score.me}-${p1.score.opp}`);

const sug = await call(b, 'suggest', { q: 'rud' });
const rud = sug.find(p => p.name.includes('Rüdiger'));
ok(!!rud, `öneri "rud": ${sug.slice(0, 3).map(p => p.name).join(', ')}`);

let matchEnd;
const endA = once(a, 'match:end'), endB = once(b, 'match:end');
for (let round = 1; round <= 3; round++) {
  if (round > 1) {
    const rp = await once(b, 'round:pick');
    ok(rp.round === round && rp.score.me === round - 1, `raund ${round} seçimi, skor ${rp.score.me}-${rp.score.opp}`);
  }
  await call(a, 'pick', { id: 'Q8682' });                       // Real Madrid
  if (round === 1) ok(!(await call(b, 'pick', { id: 'Q8682' })).ok, 'aynı kulüp engellendi');
  const cd = once(b, 'round:countdown'), st = once(b, 'round:start');
  const t0 = Date.now();
  await call(b, 'pick', { id: 'Q9616' });                       // Chelsea
  const c = await cd;
  ok(c.ms === 3000 && Date.now() - t0 < 500, `3-2-1 geri sayım başladı (${c.ms} ms)`);
  await st;
  ok(Date.now() - t0 >= 2900, `raund geri sayımdan sonra başladı (${Date.now() - t0} ms)`);
  if (round === 1) {
    const w = await call(a, 'guess', { text: 'Messi' });
    ok(w.ok && !w.correct, 'yanlış tahmin reddedildi');
  }
  const re = once(b, 'round:end');
  const g = await call(b, 'guess', { text: rud.name, id: rud.id });
  const r = await re;
  ok(g.correct && r.result === 'win' && r.score.me === round, `raund ${round}: ${r.player} → skor ${r.score.me}-${r.score.opp}${r.matchOver ? ' (maç bitti)' : ''}`);
}
[matchEnd] = await Promise.all([endB, endA]);
ok(matchEnd.result === 'win' && matchEnd.score.me === 3 && matchEnd.score.opp === 0, `maç sonu: ${matchEnd.result} ${matchEnd.score.me}-${matchEnd.score.opp}`);
ok(matchEnd.progress?.trophyDelta === 30 && matchEnd.progress.streak === 1, `kupa: +${matchEnd.progress?.trophyDelta}, toplam ${matchEnd.progress?.trophies}, seri ${matchEnd.progress?.streak}, lig ${matchEnd.progress?.league}`);
const lose = await endA;
ok(lose.progress?.trophyDelta === 0 && lose.result === 'loss', `kaybeden: ${lose.progress?.trophyDelta} kupa (0'ın altına düşmez)`);
const lb = await call(b, 'leaderboard', { period: 'all' });
const lbw = await call(b, 'leaderboard', { period: 'week' });
ok(!lb.me && !lb.top.some(r => r.name === 'Ayse') && Array.isArray(lbw.top), `sıralama çalışıyor (${lb.total} gerçek oyuncu); test hesabı sıralamada görünmüyor`);
ok(!lb.top.some(r => r.wins === 0), 'sıralamada galibiyeti olmayan yok');

// ---------- Ülke – Kulüp ----------
console.log('--- Ülke – Kulüp');
const c = await mk('Can'), d = await mk('Deniz');
const pc = once(c, 'round:pick'), pd = once(d, 'round:pick');
c.emit('queue:join', { mode: 'nc' });
d.emit('queue:join', { mode: 'cc' });               // farklı mod: eşleşmemeli
await new Promise(r => setTimeout(r, 400));
d.emit('queue:join', { mode: 'nc' });
const [rc, rd] = await Promise.all([pc, pd]);
ok(rc.role !== rd.role, `roller: Can=${rc.role}, Deniz=${rd.role}`);
const countryP = rc.role === 'country' ? c : d, clubP = rc.role === 'country' ? d : c;
ok(!(await call(clubP, 'pick', { id: 'Q43' })).ok, 'kulüp seçen ülke seçemez');
await call(countryP, 'pick', { id: 'Q43' });          // Türkiye
const teams2 = once(c, 'match:teams'), start2 = once(clubP, 'round:start');
await call(clubP, 'pick', { id: 'Q8682' });           // Real Madrid
const tm = await teams2;
ok(tm.teams.some(x => x.kind === 'country' && x.team.flag), `seçimler: ${tm.teams.map(x => `${x.kind}:${x.team.name}`).join(', ')}`);
await start2;
const re2 = once(countryP, 'round:end');
const g2 = await call(clubP, 'guess', { text: 'arda guler' });
const r2 = await re2;
ok(g2.correct && r2.result === 'loss' && r2.player === 'Arda Güler', `Arda Güler doğru, rakip tarafında: ${r2.result}, skor ${r2.score.me}-${r2.score.opp}`);
const rp2 = await once(c, 'round:pick');
ok(rp2.role !== rc.role, `raund 2'de roller değişti: Can=${rp2.role}`);

// Pas: ikisi de pas derse raund puansız biter, yeni raund başlar
const st3 = once(c, 'round:start');
await call(countryP, 'pick', { id: 'Q8682' });   // roller değişti: önce kulüp seçen artık ülke seçiyor olabilir
await call(clubP, 'pick', { id: 'Q155' });         // Brezilya
await Promise.race([st3, new Promise(r => setTimeout(r, 30000))]);
const oppPassed = once(d, 'opponent:passed');
ok((await call(c, 'pass', {})).ok, 'Can pas dedi');
await oppPassed;
ok(true, 'Deniz: "rakip pas dedi" bildirimi gitti');
const rePass = once(c, 'round:end');
await call(d, 'pass', {});
const rpEnd = await rePass;
ok(rpEnd.reason === 'pass' && rpEnd.result === 'draw' && rpEnd.score.me + rpEnd.score.opp === 1, `ikisi de pas: ${rpEnd.reason}, skor değişmedi ${rpEnd.score.me}-${rpEnd.score.opp}`);
const rp3 = await once(c, 'round:pick');
ok(rp3.round === 3, `yeni raund başladı: raund ${rp3.round}`);
const forfeit = once(countryP, 'match:end');
clubP.disconnect();
const fe = await forfeit;
ok(fe.result === 'win' && fe.forfeit, `rakip çıktı: ${fe.result} (hükmen), skor ${fe.score.me}-${fe.score.opp}`);
process.exit();
