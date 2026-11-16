// Güvenlik testi:
//  1) Gizli giriş kimliği (guestId / Google kimliği) diğer oyunculara gitmemeli
//  2) Sıralamada görülen kimlikle başkasının hesabına girilememeli
//  3) Kısa/tahmin edilebilir misafir kimliği reddedilmeli
//  4) Aynı hesap iki cihazda açıkken hesap silinince sunucu çökmemeli
import { io } from 'socket.io-client';
const URL = process.env.URL || 'http://localhost:3000';
const ok = (cond, msg) => { console.log(cond ? 'OK  ' : 'HATA', msg); if (!cond) process.exitCode = 1; };
const conn = () => new Promise(r => { const s = io(URL, { forceNew: true }); s.on('connect', () => r(s)); });
const call = (s, ev, data) => new Promise(r => s.emit(ev, data, r));
const once = (s, ev) => new Promise(r => s.once(ev, r));
const rid = () => 'e2e-sec-' + Math.random().toString(36).slice(2) + Date.now();

// 1) Maç bilgisinde gizli kimlik yok
const aId = rid(), bId = rid();
const a = await conn(), b = await conn();
const authA = await call(a, 'auth', { guestId: aId, name: 'Gizli' });
await call(b, 'auth', { guestId: bId, name: 'Rakip' });
ok(!JSON.stringify(authA).includes(aId) && !authA.user.id.startsWith('guest:'), `girişte dönen kimlik herkese açık: ${authA.user.id.slice(0, 8)}…`);
const fb = once(b, 'match:found'), pb = once(b, 'round:pick');
a.emit('queue:join', { mode: 'cc' }); b.emit('queue:join', { mode: 'cc' });
const found = await fb; await pb;
ok(!JSON.stringify(found).includes(aId) && !found.opponent.id.startsWith('guest:'), 'rakibe gönderilen bilgide gizli kimlik yok');
const teams = once(b, 'match:teams');
await call(a, 'pick', { id: 'Q8682' }); await call(b, 'pick', { id: 'Q9616' });
const tm = await teams;
ok(!JSON.stringify(tm).includes(aId) && tm.teams.every(x => !String(x.userId).startsWith('guest:')), 'takım seçimi bilgisinde gizli kimlik yok');

// 2) Sıralamadaki kimliklerle giriş yapılamaz
const lb = await call(b, 'leaderboard', { period: 'all' });
const leaked = lb.top.filter(r => String(r.id).startsWith('guest:') || String(r.id).startsWith('g:'));
ok(leaked.length === 0, `sıralamada gizli kimlik yok (${lb.top.length} satır)`);
if (lb.top[0]) {
  const thief = await conn();
  const steal = await call(thief, 'auth', { guestId: lb.top[0].id, name: 'Hirsiz' });
  const prof = steal.ok ? await call(thief, 'profile', {}) : null;
  ok(!prof?.ok || prof.user.wins === 0, 'sıralamadaki kimlikle başkasının istatistiklerine erişilemedi');
  thief.disconnect();
}

// 3) Kısa misafir kimliği reddedilir
const shortTry = await conn();
const sr = await call(shortTry, 'auth', { guestId: 'abc', name: 'Kisa' });
ok(!sr.ok, 'kısa misafir kimliği reddedildi');
shortTry.disconnect();

// 4) İki cihazda açık hesap silinince sunucu ayakta kalır
const cId = rid();
const phone = await conn(), tablet = await conn();
await call(phone, 'auth', { guestId: cId, name: 'IkiCihaz' });
await call(tablet, 'auth', { guestId: cId, name: 'IkiCihaz' });
const kicked = once(tablet, 'account:deleted');
ok((await call(phone, 'account:delete', {})).ok, 'hesap silindi');
await kicked;
ok(true, 'diğer cihaza "hesap silindi" bildirimi gitti');
const after = await call(tablet, 'profile', {});
ok(!after.ok, 'diğer cihazdaki oturum kapandı');
tablet.emit('queue:join', { mode: 'cc' });
const health = await fetch(`${URL}/healthz`).then(r => r.text()).catch(() => 'ÇÖKTÜ');
ok(health === 'ok', `sunucu ayakta: ${health}`);
process.exit();
