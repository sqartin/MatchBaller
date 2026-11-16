// İlerleme sistemi: kupa, lig, galibiyet serisi, haftalık galibiyet ve sıralama.
import { randomUUID } from 'node:crypto';

// Kupa: galibiyet +30 (3+ seride +10 bonus), beraberlik +5, mağlubiyet -20 (0'ın altına düşmez)
export const TROPHY = { win: 30, streakBonus: 10, draw: 5, loss: -20 };

// Lig eşikleri (kupa). İstemci aynı sırayla ad ve renk gösterir.
export const LEAGUES = [0, 150, 400, 800, 1500];
export const leagueOf = trophies => LEAGUES.reduce((idx, min, i) => (trophies >= min ? i : idx), 0);

// ISO hafta anahtarı: "2026-W47"
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Eski kayıtlara yeni alanları ekler */
export function ensureFields(u) {
  // Diğer oyunculara gösterilen kimlik. Gizli giriş kimliği (u.id, misafirlerde guestId'yi içerir) asla dışarı verilmez.
  u.publicId ??= randomUUID();
  u.wins ??= 0; u.losses ??= 0; u.draws ??= 0;
  u.trophies ??= u.wins * TROPHY.win; // eski oyunculara galibiyetleri kadar başlangıç kupası
  u.streak ??= 0; u.bestStreak ??= 0;
  u.week ??= { key: weekKey(), wins: 0 };
  return u;
}

/** Maç sonucu kaydı; değişiklikleri döner */
export function applyResult(u, result) {
  ensureFields(u);
  const before = { trophies: u.trophies, league: leagueOf(u.trophies) };
  const wk = weekKey();
  if (u.week.key !== wk) u.week = { key: wk, wins: 0 };

  let delta;
  if (result === 'win') {
    u.wins++; u.week.wins++;
    u.streak = u.streak >= 0 ? u.streak + 1 : 1;
    delta = TROPHY.win + (u.streak >= 3 ? TROPHY.streakBonus : 0);
  } else if (result === 'loss') {
    u.losses++;
    u.streak = 0;
    delta = TROPHY.loss;
  } else {
    u.draws++;
    delta = TROPHY.draw;
  }
  u.bestStreak = Math.max(u.bestStreak, u.streak);
  u.trophies = Math.max(0, u.trophies + delta);
  return {
    trophyDelta: u.trophies - before.trophies,
    trophies: u.trophies,
    league: leagueOf(u.trophies),
    prevLeague: before.league,
    streak: u.streak,
    streakBonus: result === 'win' && u.streak >= 3,
  };
}

/**
 * Sıralama. period: 'all' (toplam galibiyet) | 'week' (bu haftaki galibiyet)
 * Eşitlikte kupa, sonra kayıt tarihi belirler.
 */
export function leaderboard(users, { period = 'all', meId, limit = 50, exclude = new Set() }) {
  const wk = weekKey();
  const score = u => (period === 'week' ? (u.week?.key === wk ? u.week.wins : 0) : u.wins);
  const list = Object.values(users)
    .filter(u => !exclude.has(u.id))
    .map(ensureFields)
    .filter(u => score(u) > 0 || u.id === meId)
    .sort((a, b) => score(b) - score(a) || b.trophies - a.trophies || (a.createdAt || 0) - (b.createdAt || 0));
  const row = (u, i) => ({
    rank: i + 1, id: u.publicId, name: u.name, picture: u.picture || null,
    wins: score(u), trophies: u.trophies, league: leagueOf(u.trophies), streak: u.streak,
  });
  const meIndex = list.findIndex(u => u.id === meId);
  return {
    period,
    total: list.length,
    top: list.slice(0, limit).map(row),
    me: meIndex >= 0 ? row(list[meIndex], meIndex) : null,
  };
}
