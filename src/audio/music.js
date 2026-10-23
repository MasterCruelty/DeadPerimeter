// Procedural music. One small generative track per state — title,
// command center, siege, sortie, finale, victory / defeat stings — each
// a sustained drone (a few oscillators that live as long as the track)
// plus short notes scheduled ~0.25 s ahead on the AudioContext clock.
// Tracks crossfade when the state changes; siege, sortie and finale
// follow an intensity (0..1) that tickMusic() reads from the fight.
//
// Routing: track bus (+ echo send) → music bus → voice duck → the
// engine's master, so the sound on/off button silences it too. MUSIC
// on/off is a separate, remembered setting.
import { getAM } from './AudioEngine.js';
import { WX } from '../constants.js';

const KEY = 'dp-music';
let _on = true;
try { const v = localStorage.getItem(KEY); if (v !== null) _on = v === '1'; } catch { /* storage blocked */ }
export const isMusicOn = () => _on;
export function setMusicOn(b) {
  _on = !!b;
  try { localStorage.setItem(KEY, _on ? '1' : '0'); } catch { /* storage blocked */ }
}

// The AudioContext may only start after a user gesture: no music (and no
// context) before the first click or key press.
let _gesture = false;
if (typeof window !== 'undefined') {
  const g = () => {
    _gesture = true;
    window.removeEventListener('pointerdown', g, true);
    window.removeEventListener('keydown', g, true);
  };
  window.addEventListener('pointerdown', g, true);
  window.addEventListener('keydown', g, true);
}

// Ducking under radio voices. A spoken line holds the duck until it ends
// (12 s safety); the procedural chatter only pulses it for `ms`.
let _voice = false, _voiceAt = 0, _pulseUntil = 0;
export function duckMusic(on, ms) {
  const now = performance.now();
  if (ms) { if (on) _pulseUntil = Math.max(_pulseUntil, now + ms); return; }
  _voice = on; _voiceAt = now;
}
const ducked = now => (_voice && now - _voiceAt < 12000) || now < _pulseUntil;

// ── Harmony ──────────────────────────────────────────────────────
// Everything sits on D. Chords are a root offset + quality; each state
// walks its own table so the loop never settles into a fixed order.
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const D = 38;                                  // D2
const CH = {
  i:   { r: 0,  q: [0, 3, 7] },
  VI:  { r: -4, q: [0, 4, 7] },
  VII: { r: -2, q: [0, 4, 7] },
  iv:  { r: 5,  q: [0, 3, 7] },
  v:   { r: 7,  q: [0, 3, 7] },
  II:  { r: 1,  q: [0, 4, 7] },
};
const WALK_CALM = { i: ['VI', 'iv', 'VII', 'VI'], VI: ['VII', 'i', 'iv'], VII: ['i', 'i', 'VI'], iv: ['i', 'VI', 'v'], v: ['i', 'VI'], II: ['i'] };
const WALK_DARK = { i: ['VI', 'II', 'iv', 'VI'], VI: ['II', 'i', 'v'], VII: ['i', 'II'], iv: ['II', 'i'], v: ['i', 'VI', 'II'], II: ['i', 'i', 'VI'] };
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];
const pick = a => a[Math.floor(Math.random() * a.length)];
const deg = (scale, i) => scale[((i % 7) + 7) % 7] + 12 * Math.floor(i / 7);

// ── Voices (short-lived nodes, one osc + gain [+ filter] each) ───
function note(tr, t, midi, dur, o = {}) {
  const c = tr.mx.ctx;
  const osc = c.createOscillator(); osc.type = o.type || 'triangle'; osc.frequency.value = hz(midi);
  if (o.detune) osc.detune.value = o.detune;
  const g = c.createGain(), vol = o.vol || 0.05, att = o.att || 0.01;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(att + 0.02, dur));
  let last = osc;
  if (o.cut) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.cut; f.Q.value = o.q || 0.8; osc.connect(f); last = f; }
  last.connect(g); g.connect(o.dry ? tr.dry : tr.bus);
  osc.start(t); osc.stop(t + dur + 0.05);
}
function kick(tr, t, vol, low = 32, len = 0.42) {
  const c = tr.mx.ctx;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(low, t + len * 0.8);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g); g.connect(tr.dry); o.start(t); o.stop(t + len + 0.05);
}
function hat(tr, t, vol, f = 7000, len = 0.05) {
  const c = tr.mx.ctx;
  const s = c.createBufferSource(); s.buffer = tr.mx.am._nb;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = f;
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(hp); hp.connect(g); g.connect(tr.dry);
  s.start(t, Math.random() * 3, len + 0.02);
}

// ── Drone: lives for the whole track ─────────────────────────────
// voices: [semitones above D2, waveform, level, follows the chord?]
function mkDrone(tr, voices, cut) {
  const c = tr.mx.ctx, t = c.currentTime;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 1.2;
  f.connect(tr.bus);
  const oscs = voices.map(([off, type, vol, follow], i) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = hz(D + off);
    o.detune.value = (i % 2 ? 6 : -4);
    const g = c.createGain(); g.gain.value = vol;
    o.connect(g); g.connect(f); o.start(t);
    return { o, g, off, follow };
  });
  // Tension voice: a minor second over the root, faded in when the wall
  // is failing (siege) or kept silent.
  const to = c.createOscillator(); to.type = 'sawtooth'; to.frequency.value = hz(D + 13);
  const tg = c.createGain(); tg.gain.value = 0; to.connect(tg); tg.connect(f); to.start(t);
  return { f, oscs, to, tg, nodes: [f, tg, ...oscs.map(x => x.g)], srcs: [to, ...oscs.map(x => x.o)] };
}
function retune(tr, t, root) {
  if (!tr.drone) return;
  tr.drone.oscs.forEach(v => { if (v.follow) v.o.frequency.setTargetAtTime(hz(D + v.off + root), t, 0.5); });
}
function cutTo(tr, t, hzv, tc = 0.8) { if (tr.drone) tr.drone.f.frequency.setTargetAtTime(hzv, t, tc); }

// Chord change every `bars` bars, on the downbeat.
function harmony(tr, t, s, bars, walk) {
  if (s % (16 * bars) !== 0) return;
  if (s > 0) tr.chord = pick(walk[tr.chord] || ['i']);
  retune(tr, t, CH[tr.chord].r);
}
const chordTone = (tr, k) => { const c = CH[tr.chord]; return c.r + c.q[((k % 3) + 3) % 3] + 12 * Math.floor(k / 3); };
// Sparse melody: a random walk over the scale with long rests.
function melody(tr, t, base, scale, dur, o) {
  tr.mel = Math.max(-2, Math.min(9, tr.mel + pick([-2, -1, -1, 1, 1, 2, 0, -3, 3])));
  note(tr, t, base + deg(scale, tr.mel), dur, o);
}
const newArp = rests => Array.from({ length: 8 }, () => (Math.random() < rests ? -1 : Math.floor(Math.random() * 5)));

// ── Track definitions ────────────────────────────────────────────
// bpm(tr) is read every step, so tempo follows the intensity.
const DEFS = {
  title: {
    bpm: () => 64, level: 0.9, echo: 0.45, cut: 420, walk: WALK_CALM,
    drone: [[0, 'sawtooth', 0.05, true], [-12, 'sine', 0.13, true], [7, 'sawtooth', 0.025, true]],
    step(tr, t, s) {
      harmony(tr, t, s, 4, WALK_CALM);
      if (s % 16 === 0) cutTo(tr, t, 320 + Math.random() * 320, 2);
      if (s % 128 === 0) tr.arp = newArp(0.4);
      if (s % 2 === 0) {
        const k = tr.arp[(s >> 1) % 8];
        if (k >= 0) note(tr, t, 62 + chordTone(tr, k), 0.55, { vol: 0.04, cut: 1700 });
      }
      if (s % 4 === 0 && Math.random() < 0.16) melody(tr, t, 74, MINOR, 1.8, { type: 'sine', vol: 0.03, att: 0.04 });
    },
  },
  command: {
    bpm: () => 56, level: 0.75, echo: 0.35, cut: 280, walk: WALK_CALM,
    drone: [[0, 'sawtooth', 0.045, true], [-12, 'sine', 0.12, false], [7, 'triangle', 0.03, true]],
    step(tr, t, s) {
      harmony(tr, t, s, 4, WALK_CALM);
      if (s % 16 === 0) cutTo(tr, t, 220 + Math.random() * 200, 2.5);
      // Soft pulse on the beat, like a monitor in the next room.
      if (s % 4 === 0 && (s % 16 === 0 || Math.random() < 0.6)) note(tr, t, 50 + CH[tr.chord].r, 0.3, { type: 'sine', vol: s % 16 === 0 ? 0.06 : 0.035 });
      if (s % 8 === 6 && Math.random() < 0.3) hat(tr, t, 0.012, 5200, 0.03);
      if (s % 8 === 0 && Math.random() < 0.12) melody(tr, t, 69, MINOR, 2.4, { type: 'sine', vol: 0.028, att: 0.08 });
    },
  },
  siege: {
    bpm: tr => 84 + 32 * tr.mx.I, level: 0.85, echo: 0.25, cut: 320, walk: WALK_CALM,
    drone: [[0, 'sawtooth', 0.05, true], [-12, 'sine', 0.13, false], [7, 'sawtooth', 0.025, true]],
    step(tr, t, s) {
      const I = tr.mx.I, boss = tr.mx.boss;
      harmony(tr, t, s, I > 0.5 || boss ? 2 : 4, boss || I > 0.7 ? WALK_DARK : WALK_CALM);
      if (s % 4 === 0) {
        cutTo(tr, t, 300 + 1400 * I + (boss ? 300 : 0), 0.6);
        tr.drone.tg.gain.setTargetAtTime(tr.mx.low ? 0.035 : 0, t, 1.2);
      }
      const b = s % 16;
      // Heartbeat in the lulls, four on the floor in a surge.
      if (I < 0.35) { if (b === 0 || b === 3) kick(tr, t, b === 0 ? 0.32 : 0.2); }
      else if (s % 4 === 0) kick(tr, t, 0.26 + 0.18 * I);
      if (I > 0.2 && s % 2 === 0) {
        const up = b === 6 || b === 14;
        note(tr, t, D + CH[tr.chord].r + (up ? 12 : 0), 0.2, { type: 'sawtooth', vol: 0.03 + 0.045 * I, cut: 420 + 1500 * I, q: 3, dry: true });
      }
      if (I > 0.5 && b % 4 === 2) hat(tr, t, 0.03);
      if (I > 0.8 && s % 2 === 1) hat(tr, t, 0.012, 9000, 0.03);
      // Boss on the field: a tritone stab twice a bar.
      if (boss && (b === 0 || b === 10)) {
        note(tr, t, 62 + CH[tr.chord].r, 0.35, { type: 'square', vol: 0.025, cut: 1400 });
        note(tr, t, 68 + CH[tr.chord].r, 0.35, { type: 'square', vol: 0.02, cut: 1400 });
      }
      if (I < 0.25) { if (s % 4 === 0 && Math.random() < 0.12) melody(tr, t, 69, MINOR, 1.6, { type: 'sine', vol: 0.03, att: 0.03 }); }
      else if (s % 2 === 0 && Math.random() < 0.12 + 0.12 * I) melody(tr, t, 62, boss ? PHRYG : MINOR, 0.3, { vol: 0.035, cut: 2200 });
    },
  },
  sortie: {
    bpm: tr => 58 + 34 * tr.mx.I, level: 0.8, echo: 0.55, cut: 220, walk: WALK_DARK,
    drone: [[0, 'sawtooth', 0.045, true], [-12, 'sine', 0.12, false], [13, 'sine', 0.008, false]],
    step(tr, t, s) {
      const I = tr.mx.I;
      harmony(tr, t, s, 4, WALK_DARK);
      if (s % 4 === 0) cutTo(tr, t, 200 + 900 * I, 0.7);
      const b = s % 16;
      // Distant pings when it's quiet: the city, empty.
      if (s % 2 === 0 && Math.random() < 0.05 * (1 - I) + 0.015) note(tr, t, 74 + deg(PHRYG, Math.floor(Math.random() * 7)), 2.4, { type: 'sine', vol: 0.028, att: 0.02 });
      if (I > 0.15) {
        if (b === 0 || b === 3 || (I > 0.6 && (b === 8 || b === 11))) kick(tr, t, 0.16 + 0.2 * I);
        if (s % 2 === 0) note(tr, t, D + CH[tr.chord].r, 0.22, { type: 'sawtooth', vol: 0.05 * I, cut: 300 + 900 * I, q: 2, dry: true });
      }
      if (I > 0.5 && b % 4 === 2) hat(tr, t, 0.02, 6000, 0.04);
    },
  },
  finale: {
    bpm: tr => 96 + 18 * tr.mx.I, level: 0.9, echo: 0.3, cut: 500, walk: WALK_CALM,
    drone: [[0, 'sawtooth', 0.05, true], [-12, 'sine', 0.12, true], [7, 'sawtooth', 0.03, true]],
    step(tr, t, s) {
      const I = tr.mx.I;
      harmony(tr, t, s, 2, I > 0.6 ? WALK_DARK : WALK_CALM);
      if (s % 4 === 0) cutTo(tr, t, 500 + 1200 * I, 0.6);
      if (s % 64 === 0) tr.arp = newArp(0.25);
      const b = s % 16;
      if (s % 4 === 0 && !(b === 12 && Math.random() < 0.3)) kick(tr, t, 0.24 + 0.14 * I);
      if (s % 2 === 0) note(tr, t, D + CH[tr.chord].r + (b % 8 === 4 ? 7 : 0), 0.18, { type: 'sawtooth', vol: 0.045 + 0.03 * I, cut: 600 + 1200 * I, q: 3, dry: true });
      if (b % 4 === 2) hat(tr, t, 0.025);
      // Lead motif: the bar's arp shape, an octave up, held a little.
      if (s % 2 === 0) { const k = tr.arp[(s >> 1) % 8]; if (k >= 0 && Math.random() < 0.55) note(tr, t, 62 + chordTone(tr, k), 0.4, { vol: 0.035, cut: 2400 }); }
    },
  },
  victory: {
    bpm: () => 64, level: 0.95, echo: 0.45, cut: 520,
    drone: [[0, 'sawtooth', 0.04, true], [-12, 'sine', 0.12, true], [7, 'sawtooth', 0.025, true]],
    sting(tr, t) {
      // D major add9 swell, then a rising arpeggio.
      [50, 54, 57, 62, 64].forEach((m, i) => note(tr, t + i * 0.05, m, 5.5, { vol: 0.05, att: 1.4, cut: 1600 }));
      [62, 66, 69, 74, 78, 81, 86].forEach((m, i) => note(tr, t + 0.5 + i * 0.16, m, 1.4, { type: 'sine', vol: 0.045 }));
      kick(tr, t, 0.35, 28, 1.2);
    },
    // After the sting, the title theme carries on.
    step(tr, t, s) { if (t > tr.t0 + 6.5) DEFS.title.step(tr, t, s); },
  },
  defeat: {
    bpm: () => 50, level: 0.9, echo: 0.5, cut: 200,
    drone: [[-12, 'sine', 0.12, false], [0, 'sawtooth', 0.03, false]],
    sting(tr, t) {
      kick(tr, t, 0.5, 24, 2.2);
      hat(tr, t, 0.04, 400, 2.5);
      [57, 53, 50, 49].forEach((m, i) => note(tr, t + 0.4 + i * 0.95, m, 1.8, { type: 'triangle', vol: 0.06, att: 0.05, cut: 900 }));
      // The drone dies away with the last note.
      tr.bus.gain.setTargetAtTime(0.0001, t + 5, 1.5);
    },
    step() {},
  },
};

class Track {
  constructor(mx, name) {
    const c = mx.ctx, t = c.currentTime, def = DEFS[name];
    this.mx = mx; this.def = def; this.name = name; this.t0 = t;
    this.bus = c.createGain(); this.bus.gain.value = 0.0001;
    this.bus.gain.setTargetAtTime(def.level, t, 0.7);
    this.bus.connect(mx.out);
    this.send = c.createGain(); this.send.gain.value = def.echo;
    this.bus.connect(this.send); this.send.connect(mx.echoIn);
    // Percussion and bass skip the echo.
    this.dry = c.createGain(); this.dry.gain.value = def.level; this.dry.connect(mx.out);
    this.chord = 'i'; this.mel = 3; this.arp = newArp(0.35);
    this.step = 0; this.next = t + 0.08; this.dead = 0;
    this.drone = def.drone ? mkDrone(this, def.drone, def.cut) : null;
    retune(this, t, 0);
    if (def.sting) def.sting(this, t + 0.05);
  }
  run(now, until) {
    if (this.next < now - 0.1) this.next = now + 0.05;      // tab was asleep: skip, don't burst
    while (this.next < until) {
      if (!this.dead) this.def.step(this, this.next, this.step);
      this.next += 15 / this.def.bpm(this);
      this.step++;
    }
  }
  stop(fade = 1.8) {
    if (this.dead) return;
    const t = this.mx.ctx.currentTime;
    [this.bus, this.dry].forEach(g => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0.0001, t, fade / 4); });
    this.dead = t + fade + 0.6;
  }
  dispose() {
    if (this.drone) this.drone.srcs.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
    [this.bus, this.send, this.dry, ...(this.drone ? this.drone.nodes : [])].forEach(n => { try { n.disconnect(); } catch { /* gone */ } });
  }
}

class Music {
  constructor(am) {
    const c = this.ctx = am.ctx;
    this.am = am;
    this.out = c.createGain(); this.out.gain.value = 0.55;
    this.duckG = c.createGain(); this.duckG.gain.value = 1;
    this.out.connect(this.duckG); this.duckG.connect(am.master);
    // Shared feedback echo for the tonal voices.
    this.echoIn = c.createGain();
    const d = c.createDelay(1.5); d.delayTime.value = 0.43;
    const fb = c.createGain(); fb.gain.value = 0.36;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    this.echoIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(this.out);
    this.tracks = []; this.cur = null; this.state = 'none';
    this.I = 0; this.boss = false; this.low = false; this.isDucked = false;
    this.timer = setInterval(() => this.pump(), 60);
  }
  set(state) {
    if (state === this.state) return;
    this.state = state;
    if (this.cur) this.cur.stop();
    this.cur = DEFS[state] ? new Track(this, state) : null;
    if (this.cur) this.tracks.push(this.cur);
  }
  pump() {
    const c = this.ctx;
    if (c.state !== 'running') return;
    const now = c.currentTime;
    const d = ducked(performance.now());
    if (d !== this.isDucked) { this.isDucked = d; this.duckG.gain.setTargetAtTime(d ? 0.32 : 1, now, d ? 0.06 : 0.5); }
    this.tracks.forEach(tr => tr.run(now, now + 0.25));
    this.tracks = this.tracks.filter(tr => {
      if (tr.dead && now > tr.dead) { tr.dispose(); return false; }
      return true;
    });
  }
}

// ── State machine, fed by the game ───────────────────────────────
function stateFor(scr, finale, tier) {
  switch (scr) {
    case 'menu': case 'gameover': return 'title';
    case 'management': case 'expedition': case 'placement': case 'vaccine-briefing': case 'transmission': return 'command';
    case 'siege': return 'siege';
    case 'mission': return finale ? 'finale' : 'sortie';
    case 'defeat': return 'defeat';
    // The victory screen also closes a lost convoy: that one gets the defeat sting.
    case 'victory': return tier === 'failure' ? 'defeat' : 'victory';
    default: return 'none';                  // intro, evac, extraction: their own soundtrack
  }
}

// Siege heat: how many are up, how many are in rifle range of the
// wall, and whether the wall is being hit right now (shake).
function siegeHeat(gs) {
  const pool = gs.isHumanWave ? gs.humans : gs.zombies;
  let live = 0, near = 0;
  (pool || []).forEach(e => { if (e.state !== 'dead') { live++; if (e.x < WX + 760) near++; } });
  const I = gs.waveComplete ? 0
    : Math.min(1, live / 18) * 0.3 + Math.min(1, near / 6) * 0.45 + (gs.shakeTimer > 0 ? 0.25 : 0);
  return {
    I,
    boss: !!(gs.boss && gs.boss.state !== 'dead'),
    low: (gs.baseHp || 0) / (gs.baseMaxHp || 1) < 0.3,
  };
}
// Sortie heat: what's awake and close to the squad leader.
function sortieHeat(m) {
  const sx = m.soldier ? m.soldier.x : 0;
  let n = 0, boss = false;
  (m.zombies || []).forEach(z => {
    if (!z.activated || z.state === 'dead' || Math.abs(z.x - sx) > 420) return;
    n += z.type === 'tank' || z.boss ? 2 : 1;
    if (z.boss) boss = true;
  });
  (m.humans || []).forEach(h => { if (h.hostile && h.state !== 'dead' && Math.abs(h.x - sx) < 480) n++; });
  return { I: m.state === 'active' ? Math.min(1, n / 5) : 0, boss, low: false };
}

let _mx = null, _wasOn = _on;
// Called a few times a second from the game: picks the state and feeds
// the intensity. Cheap when nothing changes.
export function tickMusic({ scr, gs, m, finale, tier, paused, muted }) {
  const want = !_gesture || muted || !_on ? 'none' : stateFor(scr, finale, tier);
  const am = _mx ? _mx.am : (_gesture ? getAM() : null);
  if (!am) return;
  // The old siege drum bed stands in for the music when MUSIC is off.
  am.musicBed = _on;
  if (_on && am.bgRunning) am.stopBg();
  if (!_on && _wasOn && scr === 'siege' && !paused && !muted) am.startBg();
  _wasOn = _on;
  if (!_mx) { if (want === 'none') return; _mx = new Music(am); }
  _mx.set(want);
  const h = want === 'siege' && gs ? siegeHeat(gs) : (want === 'sortie' || want === 'finale') && m ? sortieHeat(m) : { I: 0, boss: false, low: false };
  // Rise fast, settle slowly.
  _mx.I += (h.I - _mx.I) * (h.I > _mx.I ? 0.3 : 0.06);
  _mx.boss = h.boss; _mx.low = h.low;
}

export const musicDebug = () => (_mx ? { state: _mx.state, I: +_mx.I.toFixed(2), boss: _mx.boss, low: _mx.low, tracks: _mx.tracks.length, ducked: _mx.isDucked } : null);
if (import.meta.env && import.meta.env.DEV && typeof window !== 'undefined') window.__dpMusic = musicDebug;
