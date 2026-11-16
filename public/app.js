/* global io, google */
import { LANGS, t, setLang, getLang, pickInitialLang, applyI18n } from './i18n.js';
import { createSfx } from './sfx.js';
import { initAds, onScreen as adsOnScreen, onMatchEnd as adsOnMatchEnd, maybeInterstitial } from './ads.js';
const $ = id => document.getElementById(id);

// Web'de sunucu aynı adreste; Android uygulamasında config.js içindeki adrese bağlanılır
const CFG = window.MB_CONFIG || {};
const API = CFG.apiBase || '';
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const Plugins = window.Capacitor?.Plugins || {};
const socket = API ? io(API, { transports: ['websocket'] }) : io();
const state = { user: null, teams: [], countries: [], myTeam: null, timers: [], mode: 'cc', role: 'club' };

// ---------- Yardımcılar ----------
function show(name) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== `screen-${name}`; });
  window.scrollTo(0, 0);
  adsOnScreen(name);
}
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* yok say */ } },
};
const norm = s => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emit = (ev, data) => new Promise(res => socket.emit(ev, data, res));

// ---------- Ayarlar ----------
const PICK_SEC = 25, ROUND_SEC = 90, WINS_NEEDED = 3;
const settings = {
  sound: store.get('sound') !== '0',
  vibration: store.get('vibration') !== '0',
};
setLang(pickInitialLang(store.get('lang')));
state.mode = store.get('mode') === 'nc' ? 'nc' : 'cc';

function translatePage() {
  applyI18n(document, { pick: PICK_SEC, round: ROUND_SEC, wins: WINS_NEEDED });
  if (state.user) renderUser(state.user);
}

function renderSettings() {
  $('lang-grid').innerHTML = LANGS.map(l =>
    `<button role="radio" aria-checked="${l.code === getLang()}" data-lang="${l.code}"><span class="lang-code">${l.code.toUpperCase()}</span>${esc(l.name)}</button>`).join('');
  $('toggle-sound').setAttribute('aria-checked', settings.sound);
  $('toggle-vibration').setAttribute('aria-checked', settings.vibration);
  $('account-group').hidden = !state.user;
  if (state.user) $('account-line').textContent = t('signed_in_as', { name: state.user.name });
}

let settingsReturn = 'login';
document.querySelectorAll('[data-go="settings"]').forEach(b => b.addEventListener('click', () => {
  settingsReturn = state.user ? 'home' : 'login';
  renderSettings();
  show('settings');
}));
$('settings-back').addEventListener('click', () => (settingsReturn === 'home' ? goHome() : show('login')));

$('lang-grid').addEventListener('click', e => {
  const b = e.target.closest('[data-lang]');
  if (!b) return;
  setLang(b.dataset.lang);
  store.set('lang', b.dataset.lang);
  translatePage();
  renderSettings();
});
for (const key of ['sound', 'vibration']) {
  $(`toggle-${key}`).addEventListener('click', () => {
    settings[key] = !settings[key];
    store.set(key, settings[key] ? '1' : '0');
    renderSettings();
    if (key === 'sound' && settings.sound) sfx('pick');
    if (key === 'vibration' && settings.vibration) buzz(40);
  });
}

// ---------- Ses ve titreşim ----------
const sfx = createSfx(() => settings.sound);
function buzz(pattern) {
  if (!settings.vibration) return;
  if (NATIVE && Plugins.Haptics) {
    const ms = Array.isArray(pattern) ? pattern.reduce((a, b, i) => (i % 2 ? a : a + b), 0) : pattern;
    Plugins.Haptics.vibrate({ duration: Math.min(ms, 400) }).catch(() => {});
    return;
  }
  // Tarayıcı, kullanıcı sayfaya hiç dokunmadan titreşime izin vermez
  if (!navigator.vibrate || navigator.userActivation?.hasBeenActive === false) return;
  try { navigator.vibrate(pattern); } catch { /* desteklenmiyor */ }
}
// Tüm butonlarda hafif tık sesi
document.addEventListener('click', e => { if (e.target.closest('.btn, .chip, .mode-card, .lang-grid button')) sfx('click'); });

// Arması olmayan kulüpler için: kulübe özgü renkte, baş harfli forma.
const SKIP = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'sk', 'fk', 'cd', 'club', 'de', 'and', 'the', 'football']);
function kit(team) {
  const words = team.name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w && !SKIP.has(w.toLowerCase()));
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toLocaleUpperCase('tr');
  let h = 0;
  for (const c of team.id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="crest-fallback" style="--kit:${h}">${esc(initials)}</span>`;
}
function crest(team) {
  if (team.flag) return `<img class="crest crest-flag" src="${esc(team.flag)}" alt="" loading="lazy">`;
  if (!team.logo) return kit(team);
  const fallback = kit(team).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<img class="crest" src="${esc(team.logo)}" alt="" loading="lazy" onerror="this.outerHTML='${fallback}'">`;
}
function setAvatar(el, user) {
  if (user.picture) { el.style.backgroundImage = `url("${user.picture}")`; el.textContent = ''; }
  else { el.style.backgroundImage = ''; el.textContent = user.name[0]?.toUpperCase() || '?'; }
}

// ---------- Giriş ----------
async function login(payload, { silent = false } = {}) {
  const r = await emit('auth', payload);
  if (!r.ok) {
    if (payload.sessionToken) store.del('session');            // süresi dolmuş/iptal edilmiş anahtar
    if (!silent) $('login-error').textContent = t('login_failed');
    return false;
  }
  state.user = r.user;
  if (r.sessionToken) store.set('session', JSON.stringify({ token: r.sessionToken }));
  goHome();
  return true;
}

function savedSession() {
  try { return JSON.parse(store.get('session') || 'null'); } catch { return null; }
}

$('guest-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('guest-name').value.trim();
  if (!name) return;
  const guestId = store.get('guestId') || crypto.randomUUID();
  store.set('guestId', guestId);
  await login({ guestId, name });
});

async function setupNativeGoogle(clientId) {
  const SocialLogin = Plugins.SocialLogin;
  if (!SocialLogin) { $('or-line').hidden = true; return; }
  await SocialLogin.initialize({ google: { webClientId: clientId } });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-white btn-google';
  btn.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.4-4.7 7.1l7.3 5.7c4.3-4 7.1-9.9 7.1-17.3z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg><span></span>';
  btn.querySelector('span').textContent = t('google_continue');
  btn.addEventListener('click', async () => {
    try {
      const res = await SocialLogin.login({ provider: 'google', options: { scopes: ['profile', 'email'] } });
      const idToken = res?.result?.idToken;
      if (idToken) await login({ googleCredential: idToken });
    } catch { $('login-error').textContent = t('login_failed'); }
  });
  $('google-btn').replaceChildren(btn);
}

async function setupGoogle() {
  const { googleClientId: serverClientId } = await fetch(`${API}/api/config`).then(r => r.json());
  const googleClientId = CFG.googleClientId || serverClientId;
  if (!googleClientId) { $('or-line').hidden = true; return; }
  if (NATIVE) return setupNativeGoogle(googleClientId);
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  google.accounts.id.initialize({
    client_id: googleClientId,
    locale: getLang(),
    callback: async ({ credential }) => { await login({ googleCredential: credential }); },
  });
  google.accounts.id.renderButton($('google-btn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 300, locale: getLang() });
}

$('delete-account-btn').addEventListener('click', async () => {
  if (!confirm(t('delete_confirm'))) return;
  const r = await emit('account:delete', {});
  if (!r?.ok) return;
  store.del('session');
  store.del('guestId');
  if (window.google?.accounts) google.accounts.id.disableAutoSelect();
  state.user = null;
  alert(t('account_deleted'));
  show('login');
});

socket.on('account:deleted', () => {
  store.del('session');
  store.del('guestId');
  state.user = null;
  clearTimers();
  show('login');
});

$('logout-btn').addEventListener('click', async () => {
  await emit('logout', { sessionToken: savedSession()?.token });
  store.del('session');
  if (window.google?.accounts) google.accounts.id.disableAutoSelect();
  if (NATIVE) Plugins.SocialLogin?.logout?.({ provider: 'google' }).catch(() => {});
  state.user = null;
  show('login');
});

// ---------- Lig, kupa, sıra ----------
const LEAGUE_MIN = [0, 150, 400, 800, 1500]; // sunucudaki eşiklerle aynı
function setLeague(el, idx) {
  el.className = `league-badge lg-${idx}`;
  el.textContent = t(`league_${idx}`);
}
function renderLadder(trophies, idx) {
  $('league-ladder').innerHTML = LEAGUE_MIN.map((min, i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : 'next';
    return `<div class="ladder-step ${cls}"><span class="league-badge lg-${i}">${esc(t(`league_${i}`))}</span><small>${min}</small></div>`;
  }).join('');
  const next = LEAGUE_MIN[idx + 1];
  if (next) $('league-ladder').insertAdjacentHTML('beforeend', `<p class="ladder-next">${esc(t('to_next_league', { n: next - trophies, league: t(`league_${idx + 1}`) }))}</p>`);
}

// ---------- Ana ekran & profil ----------
function renderUser(u) {
  state.user = { ...state.user, ...u };
  u = state.user;
  if (u.league != null) {
    setLeague($('home-league'), u.league);
    setLeague($('profile-league'), u.league);
    $('home-trophies').textContent = u.trophies;
    $('profile-trophies').textContent = u.trophies;
    $('home-rank').textContent = u.rank ? `#${u.rank}` : '';
    $('profile-rank').textContent = u.rank ? t('rank_n', { n: u.rank }) : '';
    $('st-best').textContent = u.bestStreak ?? 0;
    renderLadder(u.trophies, u.league);
  }
  $('home-name').textContent = u.name;
  setAvatar($('home-avatar'), u);
  $('home-record').textContent = u.wins + u.draws + u.losses
    ? t('record', { w: u.wins, d: u.draws, l: u.losses })
    : t('record_empty');
  $('profile-name').textContent = u.name;
  setAvatar($('profile-avatar'), u);
  $('st-w').textContent = u.wins; $('st-d').textContent = u.draws; $('st-l').textContent = u.losses;
}
async function goHome() {
  clearTimers();
  const r = await emit('profile');
  if (r.ok) renderUser(r.user);
  show('home');
}
async function goProfile() {
  const r = await emit('profile');
  if (r.ok) renderUser(r.user);
  show('profile');
}
$('open-profile').addEventListener('click', goProfile);

// ---------- Sıralama ----------
let lbPeriod = 'all';
function lbRow(r, me) {
  const av = r.picture
    ? `<span class="avatar" style="background-image:url('${esc(r.picture)}')"></span>`
    : `<span class="avatar">${esc((r.name[0] || '?').toUpperCase())}</span>`;
  return `<li class="lb-row${me ? ' is-me' : ''}">
    <span class="lb-rank">${r.rank}</span>${av}
    <span class="lb-name">${esc(r.name)}${me ? ` <em>${esc(t('you'))}</em>` : ''}<span class="league-badge lg-${r.league}">${esc(t(`league_${r.league}`))}</span></span>
    <span class="lb-wins"><b>${r.wins}</b><small>${esc(t('wins_short'))}</small></span>
  </li>`;
}
async function loadLeaderboard() {
  document.querySelectorAll('.tabs [data-period]').forEach(b => b.setAttribute('aria-selected', b.dataset.period === lbPeriod));
  $('lb-list').innerHTML = '';
  $('podium').innerHTML = '';
  const data = await emit('leaderboard', { period: lbPeriod });
  if (!data) return;
  const meId = state.user?.id;
  const ranked = data.top.filter(r => r.wins > 0);
  // ilk 3: kürsü (2 - 1 - 3 dizilişi)
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  $('podium').innerHTML = podium.map(r => `
    <div class="pod pod-${r.rank}${r.id === meId ? ' is-me' : ''}">
      ${r.picture ? `<span class="avatar" style="background-image:url('${esc(r.picture)}')"></span>` : `<span class="avatar">${esc((r.name[0] || '?').toUpperCase())}</span>`}
      <span class="pod-name">${esc(r.name)}</span>
      <span class="pod-wins">${r.wins}</span>
      <span class="pod-block">${r.rank}</span>
    </div>`).join('');
  $('lb-list').innerHTML = ranked.slice(3).map(r => lbRow(r, r.id === meId)).join('')
    || (ranked.length ? '' : `<li class="lb-empty">${esc(t('no_players'))}</li>`);
  const meShown = ranked.some(r => r.id === meId);
  $('lb-me').hidden = !data.me || meShown;
  if (data.me) $('lb-me').innerHTML = `<ol class="lb-list">${lbRow(data.me, true)}</ol>`;
}
function openLeaderboard() { show('leaderboard'); loadLeaderboard(); }
$('lb-btn').addEventListener('click', openLeaderboard);
$('home-stats').addEventListener('click', openLeaderboard);
document.querySelectorAll('.tabs [data-period]').forEach(b => b.addEventListener('click', () => { lbPeriod = b.dataset.period; loadLeaderboard(); }));
$('profile-btn').addEventListener('click', goProfile);
document.querySelectorAll('[data-go="home"]').forEach(b => b.addEventListener('click', async () => {
  if (b.closest('#screen-result')) await maybeInterstitial();
  goHome();
}));

// ---------- Mod seçimi & rakip arama ----------
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => startSearch(b.dataset.mode)));

function startSearch(mode = state.mode) {
  state.mode = mode;
  store.set('mode', mode);
  clearTimers();
  socket.emit('queue:join', { mode });
  show('search');
  const t0 = Date.now();
  $('search-time').textContent = t('seconds', { n: 0 });
  state.timers.push(setInterval(() => { $('search-time').textContent = t('seconds', { n: Math.floor((Date.now() - t0) / 1000) }); }, 1000));
}
$('play-btn').addEventListener('click', () => show('mode'));
$('again-btn').addEventListener('click', async () => { await maybeInterstitial(); startSearch(state.mode); });

// Paylaş: telefonun paylaşım menüsü (WhatsApp, Instagram…); yoksa panoya kopyala
$('share-btn').addEventListener('click', async () => {
  if (!lastMatch) return;
  const { result, score, rank, opponent } = lastMatch;
  const text = t(`share_${result}`, { me: score.me, opp: score.opp, name: opponent || '', rank: rank || '-' });
  const data = { title: 'Match Baller', text, url: CFG.shareUrl || API || location.origin };
  try {
    if (NATIVE && Plugins.Share) await Plugins.Share.share({ ...data, dialogTitle: t('share') });
    else if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(`${text} ${data.url}`); $('share-btn').textContent = t('copied'); setTimeout(() => { $('share-btn').textContent = t('share'); }, 1500); }
  } catch { /* kullanıcı vazgeçti */ }
});
$('cancel-search').addEventListener('click', () => { socket.emit('queue:leave'); goHome(); });
socket.on('queue:error', code => { alert(t(code)); goHome(); });

// ---------- Kulüp / ülke seçimi ----------
async function loadList(kind) {
  if (kind === 'country') {
    if (!state.countries.length) {
      state.countries = (await fetch(`${API}/api/countries`).then(r => r.json()))
        .map(c => ({ ...c, key: norm(`${c.name} ${c.en || ''}`) }));
    }
    return;
  }
  if (state.teams.length) return;
  state.teams = (await fetch(`${API}/api/teams`).then(r => r.json()))
    .map(x => ({ ...x, key: norm(`${x.name} ${x.en || ''} ${x.country}`) }));
}

function renderTeamList() {
  const isCountry = state.role === 'country';
  const source = isCountry ? state.countries : state.teams;
  const q = norm($('team-search').value.trim());
  const words = q.split(/\s+/).filter(Boolean);
  const list = (words.length ? source.filter(x => words.every(w => x.key.includes(w))) : source).slice(0, 60);
  const sub = x => (isCountry ? (x.en || '') : x.country);
  $('team-list').innerHTML = list.length
    ? list.map(x => `<li><button data-id="${x.id}" aria-pressed="${state.myTeam === x.id}">${crest(x)}<span>${esc(x.name)}<small>${esc(sub(x))}</small></span></button></li>`).join('')
    : `<li class="muted">${esc(t(isCountry ? 'no_country' : 'no_team'))}</li>`;
}
$('team-search').addEventListener('input', renderTeamList);

$('team-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  $('pick-error').textContent = '';
  const r = await emit('pick', { id: btn.dataset.id });
  if (!r.ok) { $('pick-error').textContent = t(r.error); buzz(60); return; }
  state.myTeam = btn.dataset.id;
  renderTeamList();
  sfx('pick'); buzz(30);
  $('pick-error').textContent = t('selected_wait');
});

// ---------- Maç: 3 raund alan kazanır ----------
function renderScore(score, round) {
  $('sb-me').textContent = score.me;
  $('sb-opp').textContent = score.opp;
  if (round) $('sb-round').textContent = t('round_n', { n: round });
}
function bumpScore(side) {
  const el = $(side === 'me' ? 'sb-me' : 'sb-opp');
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function setInMatch(on) {
  document.body.classList.toggle('in-match', on);
  $('scorebar').hidden = !on;
}

socket.on('match:found', ({ mode, opponent }) => {
  clearTimers();
  state.mode = mode;
  state.opponent = opponent;
  $('sb-me-name').textContent = state.user.name;
  setAvatar($('sb-me-avatar'), state.user);
  $('sb-opp-name').textContent = opponent.name;
  setAvatar($('sb-opp-avatar'), opponent);
  renderScore({ me: 0, opp: 0 }, 1);
  setInMatch(true);
  sfx('matchFound'); buzz([60, 40, 60]);
});

socket.on('round:pick', async ({ round, role, opponentRole, pickMs, score }) => {
  clearTimers();
  hideOverlays();
  state.role = role;
  state.myTeam = null;
  renderScore(score, round);
  $('pick-title').textContent = t(role === 'country' ? 'pick_country_title' : 'pick_title');
  $('team-search').placeholder = t(role === 'country' ? 'country_search_ph' : 'team_search_ph');
  $('pick-opp').textContent = state.opponent.name;
  $('opp-role').textContent = state.mode === 'nc' ? `(${t(opponentRole === 'country' ? 'picks_country' : 'picks_club')})` : '';
  $('opp-picked').hidden = true;
  $('pick-error').textContent = '';
  $('team-search').value = '';
  $('team-list').innerHTML = '';
  show('pick');
  await loadList(role);
  renderTeamList();

  const end = Date.now() + pickMs;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const sec = Math.ceil(left / 1000);
    if (sec !== tick.last && sec <= 5 && sec > 0) sfx('tick');
    tick.last = sec;
    $('pick-count').textContent = sec;
    $('pick-bar').style.transform = `scaleX(${left / pickMs})`;
    document.querySelector('.board').classList.toggle('urgent', left < 5000);
  };
  tick();
  state.timers.push(setInterval(tick, 100));
});
socket.on('opponent:picked', () => { $('opp-picked').hidden = false; sfx('oppPicked'); });

socket.on('match:teams', ({ mode, teams }) => {
  clearTimers();
  $('game-hint').textContent = t(mode === 'nc' ? 'game_hint_nc' : 'game_hint');
  const mine = teams.find(x => x.userId === state.user.id);
  const theirs = teams.find(x => x.userId !== state.user.id);
  const side = (s, who) => `${crest(s.team)}<span>${esc(s.team.name)}<small>${esc(s.kind === 'country' ? t('country') : s.team.country)}</small></span><span class="who">${esc(who)}${s.random ? ` (${esc(t('random'))})` : ''}</span>`;
  $('side-me').innerHTML = side(mine, t('you'));
  $('side-opp').innerHTML = side(theirs, state.opponent.name);
  $('game-count').textContent = String(ROUND_SEC);
  $('ring').style.strokeDashoffset = 0;
  $('ring').style.stroke = '';
  $('tries').innerHTML = '';
  $('opp-attempts').textContent = '';
  $('guess-input').value = '';
  $('guess-input').disabled = $('guess-btn').disabled = true;
  resetPass();
  show('game');
});

// 3 - 2 - 1 - Başla!
socket.on('round:countdown', ({ ms }) => {
  const box = $('countdown');
  const num = $('countdown-num');
  const steps = ['3', '2', '1', t('go')];
  const stepMs = ms / 3;
  box.hidden = false;
  steps.forEach((label, i) => {
    state.timers.push(setTimeout(() => {
      num.textContent = label;
      num.classList.toggle('go', i === 3);
      num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
      if (i < 3) { sfx('count'); buzz(30); } else { sfx('go'); buzz([80, 40, 120]); }
    }, i * stepMs));
  });
  state.timers.push(setTimeout(() => { box.hidden = true; }, ms + 550));
});

// ---------- Pas: ikisi de pas derse yeni raund ----------
const pass = { me: false, opp: false };
function renderPass() {
  const btn = $('pass-btn');
  btn.textContent = t(pass.me ? 'passed_me' : 'pass');
  btn.classList.toggle('is-passed', pass.me);
  $('pass-status').textContent = pass.opp ? t('passed_opp', { name: state.opponent.name })
    : pass.me ? t('pass_wait') : '';
}
function resetPass() {
  pass.me = false; pass.opp = false;
  $('pass-btn').disabled = true;
  renderPass();
}
$('pass-btn').addEventListener('click', async () => {
  if (pass.me) return;
  $('pass-btn').disabled = true;
  const r = await emit('pass', {});
  if (!r?.ok) { $('pass-btn').disabled = false; return; }
  pass.me = true;
  sfx('pass'); buzz(40);
  renderPass();
});
socket.on('opponent:passed', () => {
  pass.opp = true;
  sfx('oppPassed');
  renderPass();
});

socket.on('round:start', ({ roundMs }) => {
  $('guess-input').disabled = $('guess-btn').disabled = false;
  $('pass-btn').disabled = pass.me;
  $('guess-input').focus();
  const end = Date.now() + roundMs;
  const C = 276.5;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const sec = Math.ceil(left / 1000);
    if (sec !== tick.last && sec <= 5 && sec > 0) sfx('tick');
    tick.last = sec;
    $('game-count').textContent = sec;
    $('ring').style.strokeDashoffset = C * (1 - left / roundMs);
    $('ring').style.stroke = left < 10000 ? 'var(--red)' : '';
  };
  tick();
  state.timers.push(setInterval(tick, 250));
});

// ---------- Otomatik tamamlama ----------
const sug = { seq: 0, timer: null, items: [], active: -1 };

function initials(name) {
  const w = name.split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toLocaleUpperCase('tr');
}
function face(p, cls = 'face') {
  const fb = `<span class="${cls} face-fallback">${esc(initials(p.name))}</span>`;
  return p.image
    ? `<img class="${cls}" src="${esc(p.image)}" alt="" loading="lazy" onerror="this.outerHTML='${fb.replace(/"/g, '&quot;')}'">`
    : fb;
}
function closeSuggest() {
  sug.items = []; sug.active = -1;
  $('suggest').hidden = true; $('suggest').innerHTML = '';
  $('guess-input').setAttribute('aria-expanded', 'false');
}
function renderSuggest() {
  const ul = $('suggest');
  if (!sug.items.length) return closeSuggest();
  ul.innerHTML = sug.items.map((p, i) =>
    `<li role="option" aria-selected="${i === sug.active}"><button type="button" data-i="${i}">${face(p)}<span>${esc(p.name)}</span></button></li>`).join('');
  ul.hidden = false;
  $('guess-input').setAttribute('aria-expanded', 'true');
}

$('guess-input').addEventListener('input', () => {
  clearTimeout(sug.timer);
  const q = $('guess-input').value.trim();
  if (!q) return closeSuggest();
  sug.timer = setTimeout(async () => {
    const my = ++sug.seq;
    const items = await emit('suggest', { q });
    if (my !== sug.seq || $('guess-input').value.trim() !== q) return; // eski cevap
    sug.items = items; sug.active = -1;
    renderSuggest();
  }, 80);
});

$('guess-input').addEventListener('keydown', e => {
  if (!sug.items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = sug.items.length;
    sug.active = e.key === 'ArrowDown' ? (sug.active + 1) % n : (sug.active <= 0 ? n - 1 : sug.active - 1);
    renderSuggest();
  } else if (e.key === 'Enter' && sug.active >= 0) {
    e.preventDefault();
    sendGuess(sug.items[sug.active]);
  } else if (e.key === 'Escape') closeSuggest();
});

// pointerdown: input odağını kaybetmeden seç (mobil klavye kapanmasın)
$('suggest').addEventListener('pointerdown', e => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  e.preventDefault();
  sendGuess(sug.items[Number(b.dataset.i)]);
});

async function sendGuess(pick) {
  const input = $('guess-input');
  const text = pick ? pick.name : input.value.trim();
  if (!text) return;
  ++sug.seq; clearTimeout(sug.timer);
  closeSuggest();
  // Cevap listesi henüz yükleniyorsa sunucu bekletir; bu sırada butonda durum göster
  const btn = $('guess-btn');
  const slow = setTimeout(() => { btn.textContent = t('checking'); btn.disabled = true; }, 400);
  const r = await emit('guess', { text, id: pick?.id });
  clearTimeout(slow);
  btn.textContent = t('send'); btn.disabled = false;
  if (!r.ok) return;
  if (!r.correct) {
    $('tries').insertAdjacentHTML('beforeend', `<li>${esc(text)}</li>`);
    sfx('wrong'); buzz(120);
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    input.value = '';
    input.focus();
  }
}

$('guess-form').addEventListener('submit', e => { e.preventDefault(); sendGuess(null); });

socket.on('opponent:attempt', ({ count }) => {
  $('opp-attempts').textContent = t('opp_attempts', { name: state.opponent.name, n: count });
});

const reasonText = (reason, result, p) =>
  reason === 'found' ? t(result === 'win' ? 'r_found_win' : 'r_found_loss', { p })
    : reason === 'none' && state.mode === 'nc' ? t('r_none_nc') : t(`r_${reason}`);

function hideOverlays() {
  $('countdown').hidden = true;
  $('round-result').hidden = true;
}

// Raund sonucu: oyun ekranının üstünde kart, birkaç saniye sonra sıradaki raund
socket.on('round:end', ({ reason, result, player, playerImage, sample, answerCount, score, matchOver }) => {
  clearTimers();
  closeSuggest();
  $('guess-input').disabled = $('guess-btn').disabled = true;
  $('pass-btn').disabled = true;
  $('countdown').hidden = true;
  const card = $('round-result');
  card.className = `round-result ${result}`;
  $('rr-title').textContent = t(`round_${result}`);
  $('rr-text').textContent = reasonText(reason, result, player);
  const photo = $('rr-photo');
  photo.hidden = !playerImage;
  photo.onerror = () => { photo.hidden = true; };
  if (playerImage) photo.src = playerImage; else photo.removeAttribute('src');
  $('rr-sample').innerHTML = answerCount && reason !== 'found'
    ? `${esc(t('sample_list', { n: answerCount }))} <strong>${sample.slice(0, 6).map(esc).join(', ')}</strong>`
    : '';
  $('rr-next').textContent = matchOver ? '' : t('next_round');
  card.hidden = false;
  renderScore(score);
  if (result === 'win') bumpScore('me');
  if (result === 'loss') bumpScore('opp');
  if (!matchOver) {
    sfx(result === 'win' ? 'roundWin' : result === 'loss' ? 'roundLoss' : 'roundDraw');
    buzz(result === 'win' ? [60, 40, 60] : 200);
  }
});

// Kupa sayacı yukarı/aşağı sayarak dolar
function countUp(el, from, to, ms = 900) {
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let lastMatch = null;

socket.on('match:end', ({ result, forfeit, score, me, progress }) => {
  adsOnMatchEnd();
  lastMatch = { result, score, rank: me?.rank, opponent: state.opponent?.name };
  clearTimers();
  closeSuggest();
  hideOverlays();
  setInMatch(false);
  renderUser(me);
  $('result-photo').hidden = true;
  $('result-title').textContent = t(result);
  $('result-score').textContent = `${score.me} – ${score.opp}`;
  $('result-text').textContent = forfeit ? t('r_forfeit') : t(`match_${result}`, { name: state.opponent.name });
  $('result-card').className = `card-flash ${result}`;
  $('result-sample').innerHTML = '';
  const pc = $('progress-card');
  pc.hidden = !progress;
  if (progress) {
    const d = progress.trophyDelta;
    pc.className = `progress-card ${d >= 0 ? 'up' : 'down'}`;
    $('pc-delta').textContent = d >= 0 ? `+${d}` : String(d);
    $('pc-total').innerHTML = `${esc(t('trophies_total'))}: <b id="pc-total-n">${progress.trophies - d}</b>${me?.rank ? ` · #${me.rank}` : ''}`;
    setTimeout(() => countUp($('pc-total-n'), progress.trophies - d, progress.trophies), 700);
    $('pc-streak').hidden = progress.streak < 2;
    $('pc-streak').textContent = progress.streakBonus ? t('streak_bonus', { n: progress.streak }) : t('streak_line', { n: progress.streak });
    const up = progress.league > progress.prevLeague, down = progress.league < progress.prevLeague;
    $('pc-league').hidden = !up && !down;
    $('pc-league').className = `pc-league ${up ? 'up' : 'down'}`;
    if (up || down) $('pc-league').textContent = t(up ? 'league_up' : 'league_down', { league: t(`league_${progress.league}`) });
    if (up) setTimeout(() => sfx('pick'), 1600);
  }
  sfx(result === 'win' ? 'matchWin' : result === 'loss' ? 'matchLoss' : 'roundDraw');
  buzz(result === 'win' ? [80, 60, 80, 60, 250] : 300);
  show('result');
});

// ---------- Başlat ----------
socket.on('connect', async () => {
  const s = savedSession();
  if (s?.token) return login({ sessionToken: s.token }, { silent: true });
  // eski sürümden kalan misafir oturumu
  if (s?.guestId) return login({ guestId: s.guestId, name: s.name }, { silent: true });
});
socket.on('disconnect', () => { if (state.user) { clearTimers(); hideOverlays(); setInMatch(false); show('home'); } });

translatePage();
setupGoogle().catch(() => {});
if (!NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
// Uygulamada gizlilik sayfası sunucudan açılır
if (API) document.querySelectorAll('a[href="/privacy.html"]').forEach(a => { a.href = `${API}/privacy.html`; });
initAds();
