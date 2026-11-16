// Ses efektleri: hepsi Web Audio ile anında üretilir, ses dosyası indirilmez.
// Kullanım: const play = createSfx(() => ayarlarSesAcikMi); play('whistle');
//
// Not: gürültü (noise) tabanlı tribün sesi hışırtı gibi duyulduğu için kaldırıldı.
// Tüm sesler yumuşak dalga biçimleriyle (sine/triangle) ve yumuşak giriş-çıkışla yapılır;
// sert kare/testere dalgası kullanılmaz.

let ctx, master;

function init() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  if (!master) {
    // Hafif alçak geçiren filtre + kompresör: tiz uçları yumuşatır, ses patlamasını önler
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(lp).connect(comp).connect(ctx.destination);
  }
}

const now = () => ctx.currentTime;

// Yumuşak zarf: tıkırtısız başlar ve biter
function envelope(g, t, attack, peak, dur) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0, t + Math.max(attack, dur * 0.35), dur * 0.25);
}

function tone(freq, start, dur, { type = 'sine', vol = 0.18, slideTo, attack = 0.012 } = {}) {
  const t = now() + start;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  envelope(g, t, attack, vol, dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur * 2 + 0.1);
}

// Zil gibi tını: temel ton + yumuşak bir üst ton
function bell(freq, start, dur, vol = 0.16) {
  tone(freq, start, dur, { vol });
  tone(freq * 2, start, dur * 0.6, { vol: vol * 0.25 });
}

// Akor: aynı anda birkaç nota
function chord(freqs, start, dur, vol = 0.1) {
  freqs.forEach(f => tone(f, start, dur, { type: 'triangle', vol, attack: 0.03 }));
}

// Hakem düdüğü: temiz tiz ton + hafif titreşim (vibrato), hışırtı yok
function whistle(start, dur, vol = 0.12) {
  const t = now() + start;
  const o = ctx.createOscillator(), g = ctx.createGain();
  const vib = ctx.createOscillator(), vibGain = ctx.createGain();
  o.type = 'sine'; o.frequency.value = 2300;
  vib.type = 'sine'; vib.frequency.value = 22; vibGain.gain.value = 45;
  vib.connect(vibGain).connect(o.frequency);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.setValueAtTime(vol, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(master);
  o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
}

// Notalar (Hz)
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5;
const G4 = 392, A4 = 440, F4 = 349.23, E4 = 329.63, D4 = 293.66, C4 = 261.63;

const SOUNDS = {
  click: () => tone(700, 0, 0.06, { vol: 0.08 }),
  pick: () => { bell(E5, 0, 0.18); bell(A5, 0.07, 0.22); },
  oppPicked: () => tone(440, 0, 0.16, { vol: 0.12, slideTo: 660 }),
  tick: () => tone(1000, 0, 0.05, { vol: 0.07 }),
  matchFound: () => { whistle(0, 0.16); whistle(0.24, 0.4); chord([C5, E5, G5], 0.7, 0.5, 0.07); },
  count: () => bell(G5, 0, 0.25, 0.18),
  go: () => { whistle(0, 0.55); chord([C5, E5, G5, C6], 0.05, 0.6, 0.08); },
  wrong: () => { tone(A4, 0, 0.14, { type: 'triangle', vol: 0.16 }); tone(F4, 0.12, 0.24, { type: 'triangle', vol: 0.16 }); },
  pass: () => { tone(G4, 0, 0.12, { type: 'triangle', vol: 0.12 }); tone(E4, 0.1, 0.18, { type: 'triangle', vol: 0.12 }); },
  oppPassed: () => tone(E5, 0, 0.18, { vol: 0.1, slideTo: C5 }),
  roundWin: () => {
    [C5, E5, G5, C6].forEach((f, i) => bell(f, i * 0.09, 0.3, 0.15));
    chord([C5, E5, G5], 0.4, 0.7, 0.07);
  },
  roundLoss: () => [G4, F4, E4].forEach((f, i) => tone(f, i * 0.17, 0.32, { type: 'triangle', vol: 0.14 })),
  roundDraw: () => { whistle(0, 0.45); },
  matchWin: () => {
    whistle(0, 0.22); whistle(0.3, 0.22); whistle(0.6, 0.8);
    const melody = [C5, E5, G5, C6, G5, C6];
    melody.forEach((f, i) => bell(f, 1.5 + i * 0.14, 0.35, 0.15));
    chord([C5, E5, G5, C6], 1.5 + melody.length * 0.14, 1.1, 0.08);
  },
  matchLoss: () => {
    whistle(0, 0.22); whistle(0.3, 0.22); whistle(0.6, 0.8);
    [A4, G4, F4, D4, C4].forEach((f, i) => tone(f, 1.5 + i * 0.22, 0.4, { type: 'triangle', vol: 0.13 }));
  },
};

export function createSfx(enabled) {
  return kind => {
    if (!enabled() || !SOUNDS[kind]) return;
    try { init(); SOUNDS[kind](); } catch { /* ses desteklenmiyorsa sessiz devam */ }
  };
}
