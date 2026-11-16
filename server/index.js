import express from 'express';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { OAuth2Client } from 'google-auth-library';
import { getAnswers } from './wikidata.js';
import { findPlayer } from './match.js';
import { suggest, playerCount, reloadPlayers } from './players.js';
import { scheduleRefresh } from './refresh.js';
import { spawnBot } from './bot.js';
import { ensureFields, applyResult, leagueOf, leaderboard } from './progress.js';

const PORT = Number(process.env.PORT) || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const PICK_MS = 25_000;
const COUNTDOWN_MS = 3_000;        // seçimler bitince 3-2-1
const ROUND_MS = 90_000;
const BETWEEN_ROUNDS_MS = 5_000;   // raund sonucu ekranda kalma süresi
const WINS_NEEDED = 3;             // 3 raund alan maçı kazanır
const MAX_ROUNDS = 9;              // beraberliklerle sonsuza gitmesin
const GUESS_COOLDOWN_MS = 700;
const BOT_AFTER_MS = Number(process.env.BOT_AFTER_MS) || 15_000; // bu kadar beklenince bot rakip gelir
const BOT_SECRET = randomBytes(16).toString('hex');

const dataUrl = f => new URL(`../data/${f}`, import.meta.url);
// Kullanıcı verisi kalıcı bir diskte durmalı (sunucu yeniden kurulunca silinmesin): DATA_DIR=/data
const USERS_FILE = process.env.DATA_DIR ? pathToFileURL(join(process.env.DATA_DIR, 'users.json')) : dataUrl('users.json');
let teams, teamById, popularTeams;
let countries, countryById, popularCountries;
async function loadTeams() {
  teams = JSON.parse(await readFile(dataUrl('teams.json'), 'utf8'));
  teamById = new Map(teams.map(t => [t.id, t]));
  popularTeams = teams.slice(0, 300);
  countries = JSON.parse(await readFile(dataUrl('countries.json'), 'utf8'));
  countryById = new Map(countries.map(c => [c.id, c]));
  popularCountries = countries.filter(c => c.football);
}
await loadTeams();

// Modlar: cc = Kulüp-Kulüp, nc = Ülke-Kulüp (bir oyuncu ülke, diğeri kulüp seçer)
const MODES = ['cc', 'nc'];
const lookup = kind => (kind === 'country' ? countryById : teamById);

// Kulüp, arma ve futbolcu listelerini her gün Wikidata/Wikipedia'dan yenile
scheduleRefresh(async () => {
  await loadTeams();
  await reloadPlayers();
  console.log(`Veriler yenilendi: ${teams.length} kulüp, ${countries.length} ülke, ${playerCount()} futbolcu`);
});

// ---------- Kullanıcılar (basit JSON dosyası) ----------
// Bot hesapları normal misafir gibi görünür (istemci botu ayırt edemez); sadece sunucu bilir.
const botIds = new Set();
let users = {};
try { users = JSON.parse(await readFile(USERS_FILE, 'utf8')); } catch { /* ilk çalıştırma */ }
let saveTimer;
const saveUsers = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const real = Object.fromEntries(Object.entries(users).filter(([id]) => !botIds.has(id)));
    writeFile(USERS_FILE, JSON.stringify(real, null, 2)).catch(err => console.error('users.json yazılamadı:', err.message));
  }, 300);
};
const publicUser = u => {
  ensureFields(u);
  return {
    id: u.id, name: u.name, picture: u.picture, wins: u.wins, losses: u.losses, draws: u.draws,
    trophies: u.trophies, league: leagueOf(u.trophies), streak: u.streak, bestStreak: u.bestStreak,
  };
};
const rankOf = id => leaderboard(users, { meId: id, exclude: botIds, limit: 0 }).me?.rank ?? null;

function upsertUser(id, name, picture) {
  users[id] ??= { id, name, picture, wins: 0, losses: 0, draws: 0, createdAt: Date.now() };
  ensureFields(users[id]);
  Object.assign(users[id], { name, picture: picture || users[id].picture });
  saveUsers();
  return users[id];
}

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ---------- HTTP ----------
const app = express();
app.set('trust proxy', 1);
app.get('/healthz', (_req, res) => res.send('ok'));
// Android (Trusted Web Activity) doğrulaması: uygulama bu siteyi tam ekran, adres çubuğu olmadan açabilsin
app.get('/.well-known/assetlinks.json', (_req, res) => {
  const pkg = process.env.ANDROID_PACKAGE;
  const fingerprints = (process.env.ANDROID_SHA256 || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!pkg || !fingerprints.length) return res.status(404).json([]);
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
  }]);
});
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), {
  setHeaders: (res, file) => { if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get('/api/config', (_req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));
app.get('/api/teams', (_req, res) => res.sendFile(fileURLToPath(dataUrl('teams.json'))));
app.get('/api/countries', (_req, res) => res.sendFile(fileURLToPath(dataUrl('countries.json'))));

const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

// ---------- Sıra ----------
const queues = { cc: [], nc: [] }; // moda göre ayrı sıra
const rooms = new Map();

function removeFromQueue(socket) {
  for (const q of Object.values(queues)) {
    const i = q.indexOf(socket);
    if (i >= 0) q.splice(i, 1);
  }
}

function tryMatch(mode) {
  const queue = queues[mode];
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (!a.connected) { queue.unshift(b); continue; }
    if (!b.connected) { queue.unshift(a); continue; }
    startMatch(a, b, mode);
  }
}

// ---------- Bot rakip ----------
function scheduleBot(socket, mode) {
  clearTimeout(socket.data.botTimer);
  socket.data.botTimer = setTimeout(() => {
    if (!queues[mode].includes(socket) || !socket.connected) return; // bu arada insan rakip bulundu
    spawnBot({
      port: PORT,
      secret: BOT_SECRET,
      mode,
      pool: () => ({
        clubs: popularTeams.slice(0, 150).map(t => t.id),
        countries: popularCountries.map(c => c.id),
        decoys: ['Lionel Messi', 'Cristiano Ronaldo', 'Neymar', 'Kylian Mbappé', 'Zlatan Ibrahimović', 'Luka Modrić', 'Mohamed Salah', 'Robert Lewandowski'],
      }),
      answersFor: async botId => {
        const room = [...rooms.values()].find(r => r.players.some(p => p.data.user?.id === botId));
        return room ? room.answersReady : null;
      },
    });
  }, BOT_AFTER_MS);
}

// ---------- Maç: 3 raund alan kazanır ----------
const uidOf = s => s.data.user.id;
const other = (room, s) => room.players.find(x => x !== s);

function startMatch(a, b, mode) {
  for (const s of [a, b]) clearTimeout(s.data.botTimer);
  const room = {
    id: randomUUID(),
    mode,
    players: [a, b],
    score: { [uidOf(a)]: 0, [uidOf(b)]: 0 },
    round: 0,
    phase: 'idle',
  };
  rooms.set(room.id, room);
  for (const s of room.players) {
    s.data.roomId = room.id;
    s.join(room.id);
    s.emit('match:found', { mode, opponent: publicUser(other(room, s).data.user), winsNeeded: WINS_NEEDED });
  }
  // Ülke-Kulüp: ilk raundda ülkeyi kimin seçeceği rastgele, sonra her raund roller değişir
  room.countryPickerIndex = Math.floor(Math.random() * 2);
  startRound(room);
}

function startRound(room) {
  room.round++;
  room.phase = 'pick';
  room.picks = {};
  room.roles = {};
  room.lastGuess = {};
  room.attempts = {};
  room.passes = new Set();   // pas diyenler; ikisi de derse raund biter
  room.answers = null;
  room.answersReady = null;
  const countryPicker = room.mode === 'nc' ? room.players[(room.countryPickerIndex + room.round - 1) % 2] : null;
  for (const s of room.players) room.roles[uidOf(s)] = s === countryPicker ? 'country' : 'club';

  for (const s of room.players) {
    const opp = other(room, s);
    s.emit('round:pick', {
      round: room.round,
      role: room.roles[uidOf(s)],
      opponentRole: room.roles[uidOf(opp)],
      pickMs: PICK_MS,
      score: { me: room.score[uidOf(s)], opp: room.score[uidOf(opp)] },
    });
  }
  room.timer = setTimeout(() => finishPicking(room), PICK_MS + 300);
}

function randomPick(kind, excludeId) {
  const pool = kind === 'country' ? popularCountries : popularTeams;
  let x;
  do { x = pool[Math.floor(Math.random() * pool.length)]; } while (x.id === excludeId);
  return x.id;
}

function finishPicking(room) {
  if (room.phase !== 'pick') return;
  clearTimeout(room.timer);
  room.phase = 'countdown';
  const [a, b] = room.players;
  for (const s of room.players) {
    const uid = uidOf(s);
    if (!room.picks[uid]) room.picks[uid] = { id: randomPick(room.roles[uid], room.picks[uidOf(other(room, s))]?.id), random: true };
  }
  const teamsPayload = room.players.map(s => {
    const uid = uidOf(s);
    const kind = room.roles[uid];
    return { userId: uid, kind, team: lookup(kind).get(room.picks[uid].id), random: room.picks[uid].random || false };
  });
  io.to(room.id).emit('match:teams', { mode: room.mode, round: room.round, teams: teamsPayload });
  io.to(room.id).emit('round:countdown', { ms: COUNTDOWN_MS });

  // Cevaplar geri sayım sırasında arka planda yüklenir
  const sideOf = s => ({ kind: room.roles[uidOf(s)], id: room.picks[uidOf(s)].id });
  const round = room.round;
  room.answersReady = getAnswers(sideOf(a), sideOf(b))
    .then(answers => {
      if (room.round !== round) return null;
      room.answers = answers;
      if (room.phase === 'play' && answers.length === 0) endRound(room, { reason: 'none' });
      return answers;
    })
    .catch(err => {
      console.error('Wikidata hatası:', err.message);
      if (room.round === round && room.phase === 'play') endRound(room, { reason: 'error' });
      return null;
    });

  room.timer = setTimeout(() => {
    room.phase = 'play';
    io.to(room.id).emit('round:start', { round: room.round, roundMs: ROUND_MS });
    if (room.answers && room.answers.length === 0) return endRound(room, { reason: 'none' });
    room.timer = setTimeout(() => endRound(room, { reason: 'timeout' }), ROUND_MS + 300);
  }, COUNTDOWN_MS);
}

function endRound(room, { reason, winnerSocket = null, player = null }) {
  if (room.phase !== 'play' && room.phase !== 'countdown') return;
  room.phase = 'roundover';
  clearTimeout(room.timer);
  if (winnerSocket) room.score[uidOf(winnerSocket)]++;

  const leader = room.players.find(s => room.score[uidOf(s)] >= WINS_NEEDED);
  const matchOver = !!leader || room.round >= MAX_ROUNDS;
  const sample = (room.answers || []).slice(0, 12).map(p => p.name);
  for (const s of room.players) {
    const opp = other(room, s);
    s.emit('round:end', {
      round: room.round,
      reason,
      result: !winnerSocket ? 'draw' : s === winnerSocket ? 'win' : 'loss',
      player: player?.name || null,
      playerImage: player?.image || null,
      answerCount: room.answers?.length ?? 0,
      sample,
      score: { me: room.score[uidOf(s)], opp: room.score[uidOf(opp)] },
      matchOver,
    });
  }
  room.timer = setTimeout(() => (matchOver ? endMatch(room) : startRound(room)), BETWEEN_ROUNDS_MS);
}

function endMatch(room, { forfeitBy = null } = {}) {
  if (room.phase === 'over') return;
  room.phase = 'over';
  clearTimeout(room.timer);
  const [a, b] = room.players;
  let winner = null;
  if (forfeitBy) winner = other(room, forfeitBy);
  else if (room.score[uidOf(a)] !== room.score[uidOf(b)]) winner = room.score[uidOf(a)] > room.score[uidOf(b)] ? a : b;

  const progress = {};
  for (const s of room.players) {
    const result = !winner ? 'draw' : s === winner ? 'win' : 'loss';
    progress[uidOf(s)] = applyResult(users[uidOf(s)], result);
  }
  saveUsers();

  for (const s of room.players) {
    if (s === forfeitBy) continue;
    const opp = other(room, s);
    s.emit('match:end', {
      result: !winner ? 'draw' : s === winner ? 'win' : 'loss',
      forfeit: !!forfeitBy,
      score: { me: room.score[uidOf(s)], opp: room.score[uidOf(opp)] },
      me: { ...publicUser(users[uidOf(s)]), rank: rankOf(uidOf(s)) },
      progress: progress[uidOf(s)],
    });
  }
  for (const s of room.players) {
    s.leave(room.id);
    s.data.roomId = null;
  }
  rooms.delete(room.id);
}

io.on('connection', socket => {
  socket.on('auth', async (payload, ack) => {
    try {
      let user;
      if (payload?.googleCredential) {
        if (!googleClient) throw new Error('Google girişi sunucuda ayarlı değil');
        const ticket = await googleClient.verifyIdToken({ idToken: payload.googleCredential, audience: GOOGLE_CLIENT_ID });
        const p = ticket.getPayload();
        user = upsertUser(`g:${p.sub}`, p.name || 'Oyuncu', p.picture);
      } else if (payload?.botSecret === BOT_SECRET) {
        const id = `guest:${randomUUID()}`;
        botIds.add(id);
        user = upsertUser(id, String(payload.name || 'Oyuncu').slice(0, 20), null);
      } else if (payload?.guestId && payload?.name) {
        const id = `guest:${String(payload.guestId).slice(0, 64)}`;
        const name = String(payload.name).trim().slice(0, 20) || 'Misafir';
        // Otomatik test hesapları (e2e-…) kaydedilmez ve sıralamada görünmez
        if (String(payload.guestId).startsWith('e2e-')) botIds.add(id);
        user = upsertUser(id, name, null);
      } else {
        throw new Error('Geçersiz giriş');
      }
      socket.data.user = user;
      ack?.({ ok: true, user: publicUser(user) });
    } catch (err) {
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on('profile', (_p, ack) => {
    if (!socket.data.user) return ack?.({ ok: false });
    ack?.({ ok: true, user: { ...publicUser(users[uidOf(socket)]), rank: rankOf(uidOf(socket)) } });
  });

  // Play Store kuralı: kullanıcı hesabını uygulama içinden kalıcı olarak silebilmeli
  socket.on('account:delete', (_p, ack) => {
    if (!socket.data.user) return ack?.({ ok: false });
    const id = uidOf(socket);
    removeFromQueue(socket);
    const room = rooms.get(socket.data.roomId);
    if (room) endMatch(room, { forfeitBy: socket });
    delete users[id];
    saveUsers();
    socket.data.user = null;
    console.log('Hesap silindi');
    ack?.({ ok: true });
  });

  socket.on('leaderboard', ({ period } = {}, ack) => {
    if (!socket.data.user) return ack?.(null);
    ack?.(leaderboard(users, { period: period === 'week' ? 'week' : 'all', meId: uidOf(socket), exclude: botIds }));
  });

  socket.on('queue:join', ({ mode = 'cc' } = {}) => {
    if (!MODES.includes(mode)) mode = 'cc';
    if (!socket.data.user || socket.data.roomId) return;
    removeFromQueue(socket);
    // aynı hesap iki sekmede kendisiyle eşleşmesin
    if (Object.values(queues).some(q => q.some(s => uidOf(s) === uidOf(socket)))) {
      return socket.emit('queue:error', 'already_queued');
    }
    queues[mode].push(socket);
    socket.emit('queue:joined', { mode });
    tryMatch(mode);
    if (!botIds.has(uidOf(socket))) scheduleBot(socket, mode);
  });

  socket.on('queue:leave', () => { clearTimeout(socket.data.botTimer); removeFromQueue(socket); });

  socket.on('pick', ({ id } = {}, ack) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== 'pick') return ack?.({ ok: false, error: 'pick_closed' });
    const kind = room.roles[uidOf(socket)];
    if (!lookup(kind).has(id)) return ack?.({ ok: false, error: kind === 'country' ? 'country_unknown' : 'team_unknown' });
    const opp = other(room, socket);
    if (room.mode === 'cc' && room.picks[uidOf(opp)]?.id === id) return ack?.({ ok: false, error: 'team_taken' });
    room.picks[uidOf(socket)] = { id };
    ack?.({ ok: true });
    opp.emit('opponent:picked');
    if (Object.keys(room.picks).length === 2) finishPicking(room);
  });

  socket.on('suggest', ({ q } = {}, ack) => {
    if (!socket.data.user || typeof q !== 'string') return ack?.([]);
    ack?.(suggest(q));
  });

  socket.on('guess', async ({ text, id } = {}, ack) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== 'play' || typeof text !== 'string') return ack?.({ ok: false });
    const now = Date.now();
    const uid = uidOf(socket);
    if (now - (room.lastGuess[uid] || 0) < GUESS_COOLDOWN_MS) return ack?.({ ok: false, error: 'too_fast' });
    room.lastGuess[uid] = now;

    const round = room.round;
    const answers = await room.answersReady; // cevaplar henüz gelmediyse bekle
    if (!answers || room.phase !== 'play' || room.round !== round) return ack?.({ ok: false });
    room.attempts[uid] = (room.attempts[uid] || 0) + 1;

    const player = (typeof id === 'string' && answers.find(p => p.id === id))
      || findPlayer(text.slice(0, 60), answers);
    if (player) {
      ack?.({ ok: true, correct: true });
      return endRound(room, { reason: 'found', winnerSocket: socket, player });
    }
    ack?.({ ok: true, correct: false });
    other(room, socket).emit('opponent:attempt', { count: room.attempts[uid] });
  });

  // Pas: ikisi de pas derse raund puansız biter, yeni raund başlar. Pas diyen yine tahmin yapabilir.
  socket.on('pass', (_p, ack) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.phase !== 'play') return ack?.({ ok: false });
    room.passes.add(uidOf(socket));
    ack?.({ ok: true });
    other(room, socket).emit('opponent:passed');
    if (room.passes.size === 2) endRound(room, { reason: 'pass' });
  });

  socket.on('disconnect', () => {
    clearTimeout(socket.data.botTimer);
    removeFromQueue(socket);
    const room = rooms.get(socket.data.roomId);
    if (room) endMatch(room, { forfeitBy: socket });
  });
});

http.listen(PORT, () => {
  console.log(`Match Baller çalışıyor: http://localhost:${PORT} (${teams.length} kulüp, ${playerCount()} futbolcu)`);
  if (!GOOGLE_CLIENT_ID) console.log('GOOGLE_CLIENT_ID yok: sadece misafir girişi açık.');
});
