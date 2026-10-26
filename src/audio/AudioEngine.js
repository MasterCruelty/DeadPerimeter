import { wbase } from '../data/weapons.js';
// Procedural Web Audio engine. No external samples.
// Source of truth: PROJECT_STATE.md §10.

let _AM = null;

// ±k random factor around 1.
const vary = k => 1 + (Math.random() * 2 - 1) * k;

// Gun report families (see shot()). crack: high-passed transient
// [Hz, s, vol]; body: the blast [Hz, Q, s, vol, sweep-to Hz], `boom`
// makes it a low-pass (shotguns); body2: a second blast band; thump:
// [f0, f1, s, vol]; tail: send into the shared reverb; mech: receiver
// clatter partials; bolt: delay of the bolt cycle after the shot; lvl:
// overall level against the rest of the mix.
const GUN = {
  pistol:   { lvl: 1.5, crack: [2800, 0.008, 0.40], body: [1300, 0.9, 0.085, 0.95], thump: [160, 60, 0.07, 0.20], tail: 0.20,
              mech: [3300, 5200], mechV: 0.07 },
  revolver: { crack: [2400, 0.012, 0.55], body: [820, 0.8, 0.15, 1.15], body2: [2100, 1.2, 0.05, 0.4], thump: [118, 42, 0.13, 0.45], tail: 0.42 },
  smg:      { lvl: 2.4, crack: [3400, 0.005, 0.28], body: [1750, 1.1, 0.055, 0.72], thump: [190, 85, 0.045, 0.12], tail: 0.12,
              mech: [4100, 6300], mechV: 0.06 },
  rifle:    { lvl: 1.8, crack: [3600, 0.014, 0.55], body: [980, 0.85, 0.13, 0.95], thump: [96, 36, 0.16, 0.36], tail: 0.34 },
  ak:       { lvl: 1.4, crack: [2700, 0.016, 0.55], body: [700, 0.7, 0.16, 1.0], body2: [330, 1.4, 0.12, 0.55], thump: [78, 30, 0.2, 0.48], tail: 0.4 },
  // Wall turret: a belt-fed 7.62 with the receiver chattering.
  mg:       { lvl: 1.5, crack: [3000, 0.012, 0.5], body: [640, 0.75, 0.12, 0.95], body2: [1500, 1.6, 0.04, 0.3], thump: [70, 30, 0.14, 0.5], tail: 0.26,
              mech: [1850, 3200], mechV: 0.06 },
  shotgun:  { lvl: 1.15, crack: [2000, 0.01, 0.4], body: [2600, 0.6, 0.28, 1.35, 380], boom: true, thump: [74, 26, 0.26, 0.72], tail: 0.55 },
  dbarrel:  { crack: [1800, 0.012, 0.45], body: [2200, 0.6, 0.34, 1.45, 300], boom: true, doubled: true, thump: [62, 22, 0.32, 0.85], tail: 0.65 },
  hunting:  { crack: [3800, 0.02, 0.6], body: [620, 0.75, 0.2, 1.0], thump: [66, 26, 0.24, 0.6], tail: 0.6, bolt: 0.5 },
  sniper:   { crack: [4400, 0.024, 0.7], body: [540, 0.7, 0.22, 1.05], body2: [1900, 1.0, 0.04, 0.35], thump: [56, 22, 0.28, 0.7], tail: 0.75, bolt: 0.55 },
};

export class AudioEngine {
  // `ctx` is only passed to render offline (an OfflineAudioContext).
  constructor(ctx) {
    this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    // Master bus → soft limiter so stacked gunfire (2× speed, big
    // volleys) doesn't clip.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10; this.limiter.knee.value = 8; this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.18;
    this.limiter.connect(this.ctx.destination);
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.limiter);
    this._muted = false; this._duck = 1;
    this.fx = this.ctx.createGain(); this.fx.gain.value = 0.9; this.fx.connect(this.master);
    this.bg = this.ctx.createGain(); this.bg.gain.value = 0;   this.bg.connect(this.master);
    this.bgRunning = false; this.bgNodes = []; this.beatTO = null; this.lastGroan = 0; this.lastHit = 0;
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this._nb = b;
    // Gunshot tails go to one shared reverb per space instead of a
    // delay chain per shot. Outdoors: long and dark, with slap-backs
    // off the blocks. Indoors: short and boxy.
    this.tailOut = this._space(1.6, 0.03, [[0.11, 0.5], [0.24, 0.3], [0.43, 0.15]], 1500, 2.4, 0.5);
    this.tailIn  = this._space(0.4, 0.003, [[0.011, 0.6], [0.019, 0.5], [0.031, 0.4], [0.047, 0.25]], 2400, 1.6, 0.55);
  }
  _ns() { const s = this.ctx.createBufferSource(); s.buffer = this._nb; s.loop = true; return s; }
  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
  mute(on) { this._muted = on; this._applyMaster(); }
  // Pause ducking: keep a faint bed instead of hard silence.
  duck(on) { this._duck = on ? 0.18 : 1; this._applyMaster(); }
  _applyMaster() { this.master.gain.setTargetAtTime(this._muted ? 0 : 0.55 * this._duck, this.ctx.currentTime, 0.08); }
  // Per-sound output: optional stereo pan (-1 left … +1 right) from the
  // source's position on screen.
  _out(pan) {
    if (!pan || !this.ctx.createStereoPanner) return this.fx;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.8; p.connect(this.fx);
    return p;
  }
  // Throttles use the audio clock: gameplay clocks differ between the
  // siege (fast-forwardable), sorties and cinematics.
  get _t() { return this.ctx.currentTime * 1000; }
  // Siege drum bed. The procedural music (music.js) replaces it while
  // MUSIC is on (musicBed).
  startBg() {
    if (this.bgRunning || this.musicBed) return; this.bgRunning = true;
    this.bg.gain.setTargetAtTime(0.36, this.ctx.currentTime, 1.4);
    const w = this._ns(), wf = this.ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 160;
    const wg = this.ctx.createGain(); wg.gain.value = 0.12; w.connect(wf); wf.connect(wg); wg.connect(this.bg); w.start();
    const d1 = this.ctx.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = 55;
    const df = this.ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 250; df.Q.value = 1.6;
    const dg = this.ctx.createGain(); dg.gain.value = 0.30; d1.connect(df); df.connect(dg); dg.connect(this.bg); d1.start();
    const d2 = this.ctx.createOscillator(); d2.type = 'sine'; d2.frequency.value = 82.4;
    const d2g = this.ctx.createGain(); d2g.gain.value = 0.13; d2.connect(d2g); d2g.connect(this.bg); d2.start();
    this.bgNodes = [w, d1, d2]; this._beat();
  }
  stopBg() {
    if (!this.bgRunning) return; this.bgRunning = false; clearTimeout(this.beatTO);
    this.bg.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
    setTimeout(() => { this.bgNodes.forEach(n => { try { n.stop(); } catch (e) {} }); this.bgNodes = []; }, 3500);
  }
  _beat() {
    if (!this.bgRunning) return; this._kick(0.26);
    this.beatTO = setTimeout(() => {
      if (!this.bgRunning) return; this._kick(0.12);
      this.beatTO = setTimeout(() => {
        if (!this.bgRunning) return; this._kick(0.20);
        this.beatTO = setTimeout(() => { if (this.bgRunning) this._beat(); }, 680 + Math.random() * 320);
      }, 510 + Math.random() * 190);
    }, 860 + Math.random() * 300);
  }
  _kick(v) {
    if (!this.bgRunning) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(88, t); o.frequency.exponentialRampToValueAtTime(24, t + 0.40);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.50);
    o.connect(g); g.connect(this.bg); o.start(t); o.stop(t + 0.55);
  }
  // Gun reports. Each shot layers a transient crack, a band-limited
  // blast (the body), a low thump and, for some guns, receiver clatter,
  // then sends into the shared tail of the space it was fired in
  // (`indoor`: rooms and buildings on sorties). Pitch, decay, level and
  // the noise read position change on every shot so sustained fire
  // never sounds like a loop. Found guns without their own entry fall
  // back on their handling class.
  shot(wk, pan, indoor) {
    const key = GUN[wk] ? wk : GUN[wbase(wk)] ? wbase(wk) : 'rifle', G = GUN[key];
    const t = this.ctx.currentTime;
    const p = vary(0.05), dk = vary(0.1), lv = vary(0.09) * (G.lvl || 1);
    const q = this._shotGate(key, t + G.body[2] * 2 * dk);
    if (!q) return;
    const out = this._out(pan);
    const [cf, cd, cv] = G.crack;
    this._burst(t, 'highpass', cf * p, 0.7, cd * dk, cv * lv, out);
    const [bf, bq, bd, bv, bf1] = G.body, ft = G.boom ? 'lowpass' : 'bandpass';
    const body = this._burst(t + Math.random() * 0.002, ft, bf * p, bq, bd * dk, bv * lv, out, bf1 && bf1 * p);
    if (G.body2) { const [f, q2, d, v] = G.body2; this._burst(t, 'bandpass', f * p, q2, d * dk, v * lv, out); }
    // Second powder burn a hair later: the double barrel's fat report.
    if (G.doubled) this._burst(t + 0.009, ft, bf * 0.8 * p, bq, bd * 0.7 * dk, bv * 0.5 * lv, out, bf1 && bf1 * p);
    const [tf0, tf1, td, tv] = G.thump;
    this._sweep(t, tf0 * p, tf1, td * dk, tv * lv, out);
    const send = this.ctx.createGain(); send.gain.value = G.tail * lv;
    body.connect(send); send.connect(indoor ? this.tailIn : this.tailOut);
    if (q < 2) return;                          // heavy fire: no extras
    if (G.mech) this._metal(t + 0.012, G.mech.map(f => f * p), 0.03, G.mechV * lv, pan);
    if (key === 'shotgun') this.pump(pan, 0.33);
    if (G.bolt) this.boltCycle(pan, G.bolt);
  }
  // Live gunshot voices, as end times on the audio clock. Two reports
  // of the same gun in the same instant play once; past 8 voices the
  // extras drop, past 16 new shots are skipped.
  _shotGate(key, end) {
    const now = this.ctx.currentTime;
    this._shots = (this._shots || []).filter(s => s.end > now);
    if (this._shots.length >= 16) return 0;
    if (this._shots.some(s => s.key === key && now - s.at < 0.016)) return 0;
    this._shots.push({ key, at: now, end });
    return this._shots.length > 8 ? 1 : 2;
  }
  // Bolt-action rifle cycled after the shot.
  boltCycle(pan, at = 0.45) {
    const t = this.ctx.currentTime + at;
    this._metal(t, [2800, 4200], 0.03, 0.16, pan);
    this._scrape(t + 0.03, 0.1, 1800, 3200, 0.1, pan); this._scrape(t + 0.16, 0.09, 3200, 1700, 0.1, pan);
    this._metal(t + 0.25, [2100, 3400, 5200], 0.04, 0.26, pan);
  }
  // Noise burst through one filter (optionally swept to f1) with a
  // fast attack and an exponential decay. Returns its gain for sends.
  _burst(at, type, f, q, dur, vol, out, f1) {
    const n = this._ns(), fl = this.ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, at); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    n.connect(fl); fl.connect(g); g.connect(out); n.start(at, Math.random() * 3.5); n.stop(at + dur + 0.02);
    return g;
  }
  // Pitch drop from f0 to f1: the thump of a shot, a blow landing.
  _sweep(at, f0, f1, dur, vol, out, type = 'sine') {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + dur + 0.02);
  }
  // Struck body: a click rung through band-passes. High Q rings like
  // metal, low Q knocks like wood.
  _ring(at, freqs, q, dur, vol, out) {
    if (!this._clicks) {
      this._clicks = [0, 1, 2, 3].map(() => {
        const l = Math.ceil(this.ctx.sampleRate * 0.01), b = this.ctx.createBuffer(1, l, this.ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / l);
        return b;
      });
    }
    const s = this.ctx.createBufferSource(); s.buffer = this._clicks[Math.floor(Math.random() * 4)];
    freqs.forEach((f, k) => {
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * vary(0.03); bp.Q.value = q;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(vol * Math.sqrt(q) / (k + 1), at); g.gain.exponentialRampToValueAtTime(0.001, at + dur * (1.3 - k * 0.15));
      s.connect(bp); bp.connect(g); g.connect(out);
    });
    s.start(at);
  }
  // Shared reverb for one space: a convolver on a decaying noise
  // impulse (after `pre` s) with a few discrete reflections, darkened
  // by a low-pass.
  _space(len, pre, taps, lp, k, vol) {
    const sr = this.ctx.sampleRate, n = Math.ceil(sr * len), ir = this.ctx.createBuffer(2, n, sr), i0 = Math.floor(pre * sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = i0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - i0) / (n - i0), k) * 0.3;
      taps.forEach(([at, g]) => {
        const s = Math.floor((at + c * 0.006) * sr);
        for (let j = 0; j < 240 && s + j < n; j++) d[s + j] += (Math.random() * 2 - 1) * g * (1 - j / 240);
      });
    }
    const cv = this.ctx.createConvolver(); cv.buffer = ir;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const g = this.ctx.createGain(); g.gain.value = vol;
    cv.connect(f); f.connect(g); g.connect(this.fx);
    return cv;
  }
  // Shotgun pump: fore-end racked back, then slammed forward.
  pump(pan, at = 0) {
    const t = this.ctx.currentTime + at;
    this._scrape(t, 0.09, 1600, 2800, 0.14, pan); this._metal(t + 0.09, [1900, 3000, 4400], 0.05, 0.36, pan); this._thunk(t + 0.09, 200, 0.06, 0.3, pan);
    this._scrape(t + 0.16, 0.07, 2800, 1500, 0.12, pan); this._metal(t + 0.23, [2200, 3500, 5300], 0.05, 0.42, pan); this._thunk(t + 0.23, 260, 0.05, 0.26, pan);
  }
  // Reloads are built from mechanical layers — mag release click, mag
  // sliding out, the new one seating (a thunk), the charging handle /
  // slide / bolt — timed across the weapon's reload time.
  reload(w, dur = 1600) {
    const t = this.ctx.currentTime, d = dur / 1000;
    const b = { ak: 'rifle', smg: 'rifle', hunting: 'bolt', sniper: 'bolt', revolver: 'revolver', dbarrel: 'break' }[w] || wbase(w) || w;
    if (b === 'pistol') {
      this._metal(t, [3400, 5100, 6900], 0.03, 0.22);                       // mag release
      this._scrape(t + 0.04, 0.09, 2600, 1400, 0.10);                       // mag out
      this._scrape(t + d * 0.45, 0.07, 1500, 2600, 0.10);
      this._thunk(t + d * 0.45 + 0.07, 210, 0.07, 0.34); this._metal(t + d * 0.45 + 0.07, [2600, 4300], 0.03, 0.2);
      this._metal(t + d * 0.8, [2100, 3300, 5600], 0.05, 0.36); this._thunk(t + d * 0.8, 260, 0.05, 0.2);   // slide release
    } else if (b === 'revolver') {
      this._metal(t, [2900, 4400], 0.04, 0.24);                              // cylinder out
      for (let k = 0; k < 4; k++) this._metal(t + 0.12 + k * 0.05 + Math.random() * 0.03, [5200 + k * 300, 7400], 0.05, 0.08);  // brass drops
      for (let k = 0; k < 6; k++) this._metal(t + d * 0.35 + k * d * 0.06, [3600, 5800], 0.025, 0.12);
      this._metal(t + d * 0.86, [2200, 3500, 5000], 0.05, 0.38); this._thunk(t + d * 0.86, 240, 0.05, 0.2);   // swing shut
    } else if (b === 'shotgun') {
      const n = 4;
      for (let k = 0; k < n; k++) {
        const at = t + 0.08 + k * (d * 0.7 / n);
        this._scrape(at, 0.06, 1200, 2200, 0.08); this._thunk(at + 0.06, 300, 0.05, 0.28); this._metal(at + 0.06, [2500, 3900], 0.03, 0.16);
      }
      this.pump(undefined, d * 0.78);
    } else if (b === 'break') {
      this._metal(t, [1800, 2900, 4100], 0.06, 0.34); this._thunk(t, 160, 0.08, 0.3);           // break open
      this._scrape(t + 0.1, 0.12, 2400, 1200, 0.08);
      [0.4, 0.55].forEach(f => { this._thunk(t + d * f, 320, 0.05, 0.26); this._metal(t + d * f, [2700], 0.03, 0.12); });
      this._metal(t + d * 0.85, [1900, 3100, 4600], 0.06, 0.42); this._thunk(t + d * 0.85, 180, 0.07, 0.34);   // snap shut
    } else if (b === 'bolt') {
      this._metal(t, [2800, 4200], 0.03, 0.22);                                            // bolt up
      this._scrape(t + 0.06, 0.14, 1800, 3200, 0.14); this._metal(t + 0.2, [2300, 3600], 0.04, 0.3);  // back
      this._thunk(t + d * 0.5, 230, 0.06, 0.3); this._metal(t + d * 0.5, [3000, 4700], 0.03, 0.16);   // rounds in
      this._scrape(t + d * 0.78, 0.12, 3200, 1700, 0.14); this._metal(t + d * 0.78 + 0.12, [2100, 3400, 5200], 0.05, 0.4);  // forward + down
    } else {
      // Rifle / AK / SMG: mag release, mag out, mag seated, charging handle back + forward.
      this._metal(t, [3100, 4700, 6200], 0.03, 0.24);
      this._scrape(t + 0.05, 0.13, 1900, 900, 0.12);
      this._scrape(t + d * 0.42, 0.08, 900, 1900, 0.12);
      this._thunk(t + d * 0.42 + 0.08, 180, 0.08, 0.4); this._metal(t + d * 0.42 + 0.08, [2400, 3900], 0.035, 0.22);
      this._scrape(t + d * 0.74, 0.08, 2600, 1500, 0.14); this._metal(t + d * 0.74 + 0.08, [2700, 4100], 0.03, 0.2);
      this._metal(t + d * 0.74 + 0.2, [2000, 3100, 5200], 0.05, 0.46); this._thunk(t + d * 0.74 + 0.2, 240, 0.05, 0.24);
    }
  }
  // Metal impact: a noise burst rung through a few high-Q resonances.
  _metal(at, freqs, dur, vol, pan) {
    const out = this._out(pan);
    const l = Math.ceil(this.ctx.sampleRate * 0.012);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / l);
    freqs.forEach((f, k) => {
      const s = this.ctx.createBufferSource(); s.buffer = b;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (0.97 + Math.random() * 0.06); bp.Q.value = 18;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(vol * 1.5 / (k + 1), at); g.gain.exponentialRampToValueAtTime(0.001, at + dur * (1.4 - k * 0.2));
      s.connect(bp); bp.connect(g); g.connect(out); s.start(at);
    });
  }
  // Low knock of parts seating.
  _thunk(at, f, dur, vol, pan) {
    const out = this._out(pan);
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.55, at + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol * 0.5, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g); g.connect(out); o.start(at); o.stop(at + dur + 0.02);
  }
  // Metal sliding on metal: band-passed noise sweeping between f0 and f1.
  _scrape(at, dur, f0, f1, vol, pan) {
    const out = this._out(pan);
    const n = this._ns();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5;
    bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + dur * 0.2); g.gain.linearRampToValueAtTime(0, at + dur);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(at, Math.random() * 3); n.stop(at + dur + 0.02);
  }
  shell() {
    const t = this.ctx.currentTime; const l = Math.ceil(this.ctx.sampleRate * 0.05);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / l) * 0.38;
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2700;
    const g = this.ctx.createGain(); g.gain.value = 0.16;
    s.connect(hp); hp.connect(g); g.connect(this.fx); s.start(t);
  }
  hit(_now, pan) {
    const now = this._t;
    if (now - this.lastHit < 85) return; this.lastHit = now;
    const t = this.ctx.currentTime; const l = Math.ceil(this.ctx.sampleRate * 0.09);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / l);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 680;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.26, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    s.connect(lp); lp.connect(g); g.connect(this._out(pan)); s.start(t);
  }
  // ── Zombie voices ──────────────────────────────────────────────
  // A small vocal tract: glottal source (sawtooth + breath noise) with
  // a random pitch tremor, a waveshaper for the rasp, a fast "gurgle"
  // in the throat, then three moving formant filters (the mouth shape)
  // and an envelope. Throats are bigger than a living one: formants
  // sit ~20% lower.
  _curve(k) {
    this._curves = this._curves || {};
    if (this._curves[k]) return this._curves[k];
    const n = 1024, c = new Float32Array(n), th = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / th; }
    return (this._curves[k] = c);
  }
  _voice({ f = [90, 70, 80], dur = 1.2, v0 = 'U', v1 = 'O', rasp = 4, gurgle = 0, gRate = 22, breath = 0.3, vol = 0.3, sub = 0, at = 0, pan } = {}) {
    const VOW = { A: [760, 1150, 2400], O: [470, 820, 2300], U: [330, 690, 2200], E: [480, 1650, 2400], AE: [640, 1500, 2350] };
    const t = this.ctx.currentTime + at, out = this._out(pan);
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f[0], t); o.frequency.linearRampToValueAtTime(f[1], t + dur * 0.4); o.frequency.linearRampToValueAtTime(f[2], t + dur);
    // Pitch tremor: slow noise into the frequency.
    const jn = this._ns(), jl = this.ctx.createBiquadFilter(); jl.type = 'lowpass'; jl.frequency.value = 16;
    const jg = this.ctx.createGain(); jg.gain.value = f[0] * 5;   // filtered noise is ~0.02 RMS → ~±10% pitch wander
    jn.connect(jl); jl.connect(jg); jg.connect(o.frequency);
    const src = this.ctx.createGain(); src.gain.value = 1; o.connect(src);
    let so = null;
    if (sub) { so = this.ctx.createOscillator(); so.type = 'square'; so.frequency.setValueAtTime(f[0] / 2, t); so.frequency.linearRampToValueAtTime(f[2] / 2, t + dur);
      const sg = this.ctx.createGain(); sg.gain.value = sub; so.connect(sg); sg.connect(src); }
    const bn = this._ns(), bbp = this.ctx.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 1400; bbp.Q.value = 0.6;
    const bg = this.ctx.createGain(); bg.gain.value = breath; bn.connect(bbp); bbp.connect(bg); bg.connect(src);
    const ws = this.ctx.createWaveShaper(); ws.curve = this._curve(rasp); ws.oversample = '2x';
    src.connect(ws);
    // Gurgle: amplitude wobble at gRate.
    const gv = this.ctx.createGain(); gv.gain.value = 1 - gurgle * 0.5;
    if (gurgle > 0) { const l = this.ctx.createOscillator(); l.frequency.value = gRate * (0.85 + Math.random() * 0.3); const lg = this.ctx.createGain(); lg.gain.value = gurgle * 0.5; l.connect(lg); lg.connect(gv.gain); l.start(t); l.stop(t + dur + 0.05); }
    ws.connect(gv);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol, t + Math.min(0.06, dur * 0.15));
    env.gain.setValueAtTime(vol * 0.85, t + dur * 0.6); env.gain.linearRampToValueAtTime(0, t + dur);
    [0, 1, 2].forEach(k => {
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = [7, 9, 11][k];
      bp.frequency.setValueAtTime(VOW[v0][k] * 0.8, t); bp.frequency.linearRampToValueAtTime(VOW[v1][k] * 0.8, t + dur);
      const fg = this.ctx.createGain(); fg.gain.value = [1.4, 0.8, 0.35][k];
      gv.connect(bp); bp.connect(fg); fg.connect(env);
    });
    // Some unfiltered rasp on top so it bites.
    const raw = this.ctx.createBiquadFilter(); raw.type = 'highpass'; raw.frequency.value = 900;
    const rg = this.ctx.createGain(); rg.gain.value = 0.07; gv.connect(raw); raw.connect(rg); rg.connect(env);
    env.connect(out);
    o.start(t); jn.start(t, Math.random() * 3); bn.start(t, Math.random() * 3); if (so) so.start(t);
    const end = t + dur + 0.05; o.stop(end); jn.stop(end); bn.stop(end); if (so) so.stop(end);
  }
  zombieDie(type, pan) {
    // A mine or a shotgun can drop several at once: voice two of them,
    // the rest just hit the ground.
    const now = this._t;
    if (now - (this._dieWin ?? -1e9) > 90) { this._dieWin = now; this._dieN = 0; }
    if (++this._dieN > 2) { this._thunk(this.ctx.currentTime + 0.1, 90, 0.18, 0.4, pan); return; }
    const k = type === 'brute' ? 0.55 : type === 'tank' ? 0.7 : type === 'runner' ? 1.3 : 1;
    // Choked death rattle, then the body hitting the ground.
    this._voice({ f: [120 * k, 90 * k, 55 * k], dur: 0.8, v0: 'A', v1: 'U', rasp: 6, gurgle: 0.9, gRate: 13, breath: 0.45, vol: 0.38, sub: type === 'brute' || type === 'tank' ? 0.5 : 0, pan });
    this._thunk(this.ctx.currentTime + 0.55, 90, 0.18, 0.4, pan);
  }
  groan(_now, type, pan) {
    const now = this._t;
    if (now - this.lastGroan < 650 + Math.random() * 500) return; this.lastGroan = now;
    const r = Math.random();
    if (type === 'runner') {                     // shrieking, enraged
      this._voice({ f: [170 + r * 60, 260 + r * 50, 150], dur: 0.75, v0: 'AE', v1: 'A', rasp: 7, gurgle: 0.25, breath: 0.25, vol: 0.3, pan });
    } else if (type === 'tank' || type === 'brute') {
      this._voice({ f: [62 + r * 10, 50, 58], dur: 1.6, v0: 'O', v1: 'U', rasp: 5, gurgle: 0.4, gRate: 16, breath: 0.35, vol: 0.38, sub: 0.6, pan });
    } else if (type === 'spitter') {
      this._voice({ f: [120, 95, 110], dur: 0.9, v0: 'E', v1: 'U', rasp: 5, gurgle: 0.95, gRate: 31, breath: 0.5, vol: 0.28, pan });
    } else {                                     // walker: hungry, angry growl
      const angry = r < 0.45;
      this._voice(angry
        ? { f: [110 + r * 40, 150 + r * 30, 90], dur: 0.9, v0: 'A', v1: 'O', rasp: 7, gurgle: 0.4, gRate: 20, breath: 0.3, vol: 0.32, pan }
        : { f: [85 + r * 25, 68, 78], dur: 1.3, v0: 'U', v1: 'O', rasp: 4.5, gurgle: 0.55, gRate: 18, breath: 0.4, vol: 0.3, sub: 0.25, pan });
    }
  }
  // Human enemies (bandits, raiders, Compact troopers): clean voices,
  // no gurgle or rattle. `deep` lowers the pitch a little for variety.
  humanDie(pan, deep = Math.random()) {
    const now = this._t;
    if (now - (this._hDieWin ?? -1e9) > 90) { this._hDieWin = now; this._hDieN = 0; }
    if (++this._hDieN > 2) { this._thunk(this.ctx.currentTime + 0.1, 90, 0.18, 0.4, pan); return; }
    const k = 1.15 - deep * 0.3;
    // Cry cut short, then the body hitting the ground.
    this._voice({ f: [170 * k, 135 * k, 85 * k], dur: 0.5, v0: 'A', v1: 'U', rasp: 1.6, breath: 0.2, vol: 0.34, pan });
    this._thunk(this.ctx.currentTime + 0.4, 90, 0.18, 0.4, pan);
  }
  humanShout(pan, deep = Math.random()) {
    const now = this._t;
    if (now - (this._lastShout ?? -1e9) < 900) return; this._lastShout = now;
    const k = 1.1 - deep * 0.25;
    // Battle cry while charging: rising "HAA".
    this._voice({ f: [125 * k, 185 * k, 160 * k], dur: 0.55, v0: 'E', v1: 'A', rasp: 2.4, breath: 0.25, vol: 0.32, pan });
  }
  humanHurt(pan) {
    const now = this._t;
    if (now - (this._lastHHurt ?? -1e9) < 220) return; this._lastHHurt = now;
    this._voice({ f: [150, 130, 115], dur: 0.2, v0: 'U', v1: 'U', rasp: 1.4, breath: 0.25, vol: 0.28, pan });
  }
  zombieAtk(pan) {
    const now = this._t;
    if (now - (this._lastAtk ?? -1e9) < 140) return; this._lastAtk = now;
    // Rabid snarl + the bite / blow landing.
    this._voice({ f: [140, 230, 120], dur: 0.42, v0: 'A', v1: 'U', rasp: 9, gurgle: 0.45, gRate: 26, breath: 0.35, vol: 0.4, pan });
    const t = this.ctx.currentTime + 0.12; const l = Math.ceil(this.ctx.sampleRate * 0.15);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / l, 0.75);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.42, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    s.connect(lp); lp.connect(g); g.connect(this._out(pan)); s.start(t);
  }
  // Melee by weapon: the swing, then the blow landing near the end of
  // it. `miss`: the swing alone. Pitch and level shift a little per
  // swing; a pile-up of hits in one instant plays three at most.
  melee(type, pan, miss) {
    const now = this._t;
    if (now - (this._melWin ?? -1e9) > 70) { this._melWin = now; this._melN = 0; }
    if (++this._melN > 3) return;
    const t = this.ctx.currentTime, out = this._out(pan), p = vary(0.06), v = vary(0.12);
    if (type === 'machete') {
      // Long blade: heavier whoosh, a chop and the edge ringing.
      this._whoosh(t, 0.17, 1500 * p, 4000 * p, 1.1, 0.26 * v, out);
      if (miss) return;
      const at = t + 0.1;
      this._burst(at, 'bandpass', 1700 * p, 1.2, 0.05, 0.28 * v, out);
      this._burst(at + 0.004, 'lowpass', 900 * p, 0.7, 0.1, 0.24 * v, out, 260);
      this._sweep(at, 170 * p, 80, 0.08, 0.2 * v, out);
      this._ring(at, [3100 * p, 4650 * p, 6300 * p], 24, 0.16, 0.04 * v, out);
    } else if (type === 'bat') {
      // Wood: low whoosh, a hollow knock (a few low-Q body modes) on a
      // dry crack. No blade ring.
      this._whoosh(t, 0.2, 520 * p, 1400 * p, 0.9, 0.3 * v, out);
      if (miss) return;
      const at = t + 0.11;
      this._burst(at, 'bandpass', 2600 * p, 1, 0.012, 0.18 * v, out);
      this._ring(at, [240 * p, 590 * p, 1120 * p, 1830 * p], 7, 0.11, 0.09 * v, out);
      this._sweep(at, 125 * p, 60, 0.12, 0.28 * v, out);
      this._burst(at, 'lowpass', 520 * p, 0.8, 0.07, 0.18 * v, out);
    } else if (type === 'axe') {
      // Fire axe: slow heavy whoosh, a deep meaty chop and the head
      // clanging.
      this._whoosh(t, 0.27, 380 * p, 1200 * p, 0.8, 0.34 * v, out);
      if (miss) return;
      const at = t + 0.14;
      this._burst(at, 'lowpass', 700 * p, 0.9, 0.15, 0.26 * v, out, 190);
      this._burst(at, 'bandpass', 1300 * p, 1, 0.05, 0.2 * v, out);
      this._sweep(at, 96 * p, 40, 0.2, 0.3 * v, out);
      this._ring(at + 0.003, [1150 * p, 1720 * p, 2580 * p, 3900 * p], 26, 0.22, 0.035 * v, out);
    } else {
      // Knife: quick light swish, a short wet stab.
      this._whoosh(t, 0.1, 2600 * p, 5800 * p, 1.6, 0.17 * v, out);
      if (miss) return;
      const at = t + 0.06;
      this._burst(at, 'lowpass', 1100 * p, 1.4, 0.075, 0.36 * v, out, 300);
      this._sweep(at, 300 * p, 120, 0.05, 0.14 * v, out, 'triangle');
    }
  }
  // Melee weapon breaking: wood splinters (bat), a blade snapping and
  // the piece clattering down; the fire axe's handle splinters and the
  // head drops.
  meleeBreak(type, pan) {
    const t = this.ctx.currentTime + 0.12, out = this._out(pan), p = vary(0.05);
    if (type === 'bat' || type === 'axe') {
      this._burst(t, 'bandpass', 1400 * p, 2, 0.04, 0.34, out);
      for (let k = 0; k < 8; k++) this._burst(t + Math.random() * 0.14, 'bandpass', 1800 + Math.random() * 3200, 1.5, 0.006 + Math.random() * 0.01, 0.2 * (1 - k / 10), out);
      this._ring(t, [330 * p, 760 * p], 5, 0.05, 0.12, out);
      if (type === 'bat') this._sweep(t + 0.34, 180, 90, 0.06, 0.2, out);
      else { this._ring(t + 0.34, [900 * p, 1450 * p, 2300 * p], 28, 0.25, 0.05, out); this._sweep(t + 0.34, 150, 70, 0.08, 0.3, out); }
    } else {
      this._burst(t, 'bandpass', 5200 * p, 0.9, 0.008, 0.3, out);
      this._ring(t, [3600 * p, 5400 * p, 7900 * p], 30, 0.09, 0.05, out);
      this._ring(t + 0.28, [2700 * p, 4100 * p], 22, 0.07, 0.035, out);
      this._ring(t + 0.41, [2900 * p, 4300 * p], 22, 0.05, 0.022, out);
    }
  }
  // Air moved by a swing: band-passed noise sweeping f0 → f1, swelling
  // to the middle of the arc.
  _whoosh(at, dur, f0, f1, q, vol, out) {
    const n = this._ns(), bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, at); bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + dur * 0.55); g.gain.linearRampToValueAtTime(0, at + dur);
    n.connect(bp); bp.connect(g); g.connect(out); n.start(at, Math.random() * 3.5); n.stop(at + dur + 0.02);
  }
  // Explosion (mines): sub thump + noise burst with a long tail.
  explosion(pan) {
    const t = this.ctx.currentTime; const out = this._out(pan);
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(22, t + 0.9);
    const og = this.ctx.createGain(); og.gain.setValueAtTime(1.1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 1.05);
    const n = this._ns();
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
    const ng = this.ctx.createGain(); ng.gain.setValueAtTime(0.9, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 1.35);
    setTimeout(() => this.crackle(), 250);
  }
  // Frag grenade: the mine blast plus a sharp supersonic crack and
  // fragments pattering down.
  grenade(pan) {
    this.explosion(pan);
    const t = this.ctx.currentTime; const out = this._out(pan);
    const l = Math.ceil(this.ctx.sampleRate * 0.12);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / l, 3);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = this.ctx.createGain(); g.gain.value = 0.7;
    s.connect(hp); hp.connect(g); g.connect(out); s.start(t);
    for (let i = 0; i < 5; i++) this._thunk(t + 0.35 + Math.random() * 0.5, 300 + Math.random() * 300, 0.03, 0.08, pan);
  }
  // Pin pulled + spoon flying off.
  pin(pan) {
    const t = this.ctx.currentTime;
    this._metal(t, [3200, 5100], 0.03, 0.22, pan);
    this._metal(t + 0.11, [2400, 3900, 6100], 0.06, 0.16, pan);
  }
  // Grenade bouncing on the ground.
  clink(pan) {
    if (this._t - (this._lastClink ?? -1e9) < 60) return; this._lastClink = this._t;
    const t = this.ctx.currentTime;
    this._metal(t, [1500, 2600], 0.04, 0.16, pan); this._thunk(t, 180, 0.04, 0.18, pan);
  }
  // Dodge roll: cloth and gear swish, then the shoulder hitting the ground.
  roll(pan) {
    const t = this.ctx.currentTime;
    this._scrape(t, 0.22, 500, 1400, 0.16, pan);
    this._thunk(t + 0.18, 110, 0.12, 0.34, pan);
  }
  // Gun slung / drawn.
  swap(pan) {
    const t = this.ctx.currentTime;
    this._scrape(t, 0.08, 900, 1800, 0.1, pan);
    this._metal(t + 0.07, [1900, 3100], 0.04, 0.2, pan); this._thunk(t + 0.07, 220, 0.05, 0.2, pan);
  }
  // Brute / mini-boss: a deep, enraged bellow from a huge throat.
  roar(pan) {
    if (this._t - (this._lastRoar ?? -1e9) < 600) return; this._lastRoar = this._t;
    this._voice({ f: [78, 104, 60], dur: 1.9, v0: 'A', v1: 'O', rasp: 10, gurgle: 0.35, gRate: 14, breath: 0.45, vol: 0.46, sub: 0.8, pan });
    this._voice({ f: [150, 205, 120], dur: 1.5, v0: 'AE', v1: 'A', rasp: 8, gurgle: 0.2, breath: 0.3, vol: 0.2, at: 0.08, pan });
  }
  // Spitter: wet gurgle + spit.
  spit(pan) {
    const t = this.ctx.currentTime; const out = this._out(pan);
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(80, t + 0.2);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 32;
    const lg = this.ctx.createGain(); lg.gain.value = 40; lfo.connect(lg); lg.connect(o.frequency);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 3;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(bp); bp.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + 0.28); lfo.stop(t + 0.28);
  }
  // Loot found: two soft rising notes.
  pickup() {
    [660, 990].forEach((f, i) => {
      const t = this.ctx.currentTime + i * 0.07;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.13, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.2);
    });
  }
  // Heavy crate hitting the ground.
  thud() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.4);
    this.lastHit = 0; this.hit(0);
  }
  // Radio static bed for transmissions (looping, band-limited noise
  // with slow fades). level 0..1.
  staticStart(level = 0.5) {
    if (this._static) return;
    const t = this.ctx.currentTime;
    const n = this._ns();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.045 * level, t, 0.4);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.35;
    const lg = this.ctx.createGain(); lg.gain.value = 0.015 * level; lfo.connect(lg); lg.connect(g.gain);
    n.connect(bp); bp.connect(g); g.connect(this.fx); n.start(t); lfo.start(t);
    this._static = { n, g, lfo };
  }
  staticStop() {
    if (!this._static) return;
    const s = this._static; s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(() => { try { s.n.stop(); s.lfo.stop(); } catch (e) {} }, 1500);
    this._static = null;
  }
  // Squelch "kch" at the start / end of a radio line.
  squelch() { this._radioClick(this.ctx.currentTime, 0.06); }
  baseHit() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(56, t); o.frequency.exponentialRampToValueAtTime(17, t + 0.58);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.82, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.68);
    o.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.72);
    this.lastHit = 0; this.hit(0);
  }
  waveCleared() {
    [392, 523, 659, 784].forEach((f, i) => {
      const t = this.ctx.currentTime + i * 0.19;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.20, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
      o.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.38);
    });
  }

  // ── Cinematic / ambient loops ─────────────────────────────────
  // Looping helicopter rotor: low turbine drone + LFO-modulated blade
  // slap noise. intensity 0..1 controls overall volume (close vs far).
  heliStart(intensity = 0.8) {
    if (this._heli) return;
    const t = this.ctx.currentTime;
    const drone = this.ctx.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 96;
    const droneFil = this.ctx.createBiquadFilter(); droneFil.type = 'lowpass'; droneFil.frequency.value = 320;
    const droneG = this.ctx.createGain(); droneG.gain.value = 0;
    droneG.gain.setTargetAtTime(0.22 * intensity, t, 0.6);
    drone.connect(droneFil); droneFil.connect(droneG); droneG.connect(this.fx); drone.start(t);
    const noise = this._ns();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 280; bp.Q.value = 1.6;
    const noiseG = this.ctx.createGain(); noiseG.gain.value = 0;
    const baseG = 0.16 * intensity;
    noiseG.gain.setTargetAtTime(baseG, t, 0.6);
    const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 18;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = baseG * 0.85;
    lfo.connect(lfoG); lfoG.connect(noiseG.gain);
    noise.connect(bp); bp.connect(noiseG); noiseG.connect(this.fx);
    noise.start(t); lfo.start(t);
    this._heli = { drone, droneG, noise, noiseG, lfo };
  }
  heliStop() {
    if (!this._heli) return;
    const h = this._heli; const t = this.ctx.currentTime;
    h.droneG.gain.setTargetAtTime(0, t, 0.5);
    h.noiseG.gain.setTargetAtTime(0, t, 0.5);
    const handle = h;
    setTimeout(() => {
      try { handle.drone.stop(); handle.noise.stop(); handle.lfo.stop(); } catch (e) {}
    }, 1800);
    this._heli = null;
  }

  // Two-tone wailing police siren (one full ramp up + down cycle).
  siren() {
    const t = this.ctx.currentTime; const dur = 1.4;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(620, t);
    o.frequency.linearRampToValueAtTime(880, t + 0.45);
    o.frequency.linearRampToValueAtTime(620, t + 0.90);
    o.frequency.linearRampToValueAtTime(880, t + 1.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.30, t + 0.08);
    g.gain.setValueAtTime(0.30, t + dur - 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.fx); o.start(t); o.stop(t + dur + 0.05);
  }

  // Distressed human scream, ~0.55 s. Uses bandpass to sit in the
  // vocal range without sounding too "synth".
  scream() {
    const t = this.ctx.currentTime; const dur = 0.55;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.linearRampToValueAtTime(940, t + 0.18);
    o.frequency.linearRampToValueAtTime(640, t + dur);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.30, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(bp); bp.connect(g); g.connect(this.fx); o.start(t); o.stop(t + dur + 0.05);
  }

  // Short fire crackle: random pops through a high bandpass.
  crackle() {
    const t = this.ctx.currentTime; const l = Math.ceil(this.ctx.sampleRate * 0.22);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) {
      const env = Math.pow(1 - i / l, 1.4);
      d[i] = (Math.random() < 0.07 ? (Math.random() * 2 - 1) : 0) * env * 0.9;
    }
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = 0.28;
    s.connect(bp); bp.connect(g); g.connect(this.fx); s.start(t);
  }

  // Looping wind: low-passed noise with a slow LFO sweeping the cutoff
  // so it audibly "gusts".
  windStart(intensity = 0.6) {
    if (this._wind) return;
    const t = this.ctx.currentTime;
    const noise = this._ns();
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const lp2 = this.ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 720;
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(0.13 * intensity, t, 1.0);
    const lfo = this.ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.18;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 200;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    noise.connect(lp); lp.connect(lp2); lp2.connect(g); g.connect(this.fx);
    noise.start(t); lfo.start(t);
    this._wind = { noise, g, lfo };
  }
  windStop() {
    if (!this._wind) return;
    const w = this._wind; const t = this.ctx.currentTime;
    w.g.gain.setTargetAtTime(0, t, 0.8);
    setTimeout(() => { try { w.noise.stop(); w.lfo.stop(); } catch (e) {} }, 2500);
    this._wind = null;
  }

  // Low urban hum: distant traffic + electrical buzz. Looping.
  cityHumStart() {
    if (this._cityHum) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58;
    const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 87;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(0.07, t, 1.4);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.fx);
    o.start(t); o2.start(t);
    this._cityHum = { o, o2, g };
  }
  cityHumStop() {
    if (!this._cityHum) return;
    const h = this._cityHum; const t = this.ctx.currentTime;
    h.g.gain.setTargetAtTime(0, t, 1.0);
    setTimeout(() => { try { h.o.stop(); h.o2.stop(); } catch (e) {} }, 2400);
    this._cityHum = null;
  }

  // Stylised radio chatter — does NOT try to articulate real words.
  // Instead it produces the *cadence* of a soldier on a tactical
  // radio: a click-open, 3–6 vowel-formant buzz "syllables" at slightly
  // varying pitch (prosody), then a click-close, all sitting in the
  // 300–3000 Hz radio band so it reads as comms rather than music.
  // The actual line is shown as a subtitle in the HUD.
  //
  //   pitch:    'low' | 'mid' | 'high'    (speaker timbre)
  //   syllables: 2–6                       (line length cue)
  //   urgent:   bool                       (louder + faster)
  radioChatter({ syllables = 4, pitch = 'mid', urgent = false } = {}) {
    const t0 = this.ctx.currentTime;
    // pitch can be a preset string or an explicit Hz number (used for
    // per-soldier voice differentiation). Adult male range.
    const baseF = typeof pitch === 'number'
      ? 95 + Math.max(0, Math.min(1, (pitch - 115) / 120)) * 70   // soldier voicePitch 115–235 → 95–165 Hz
      : pitch === 'low' ? 100 : pitch === 'high' ? 150 : 122;
    const vol = urgent ? 0.3 : 0.24, pace = urgent ? 0.82 : 1.0;
    const VOW = [[730, 1090, 2440], [530, 1840, 2480], [390, 2000, 2550], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410]];
    // Radio chain: band-limited, slightly overdriven.
    const radio = this.ctx.createBiquadFilter(); radio.type = 'bandpass'; radio.frequency.value = 1300; radio.Q.value = 0.5;
    const ws = this.ctx.createWaveShaper(); ws.curve = this._curve(2.2);
    const bus = this.ctx.createGain(); bus.gain.value = 1;
    bus.connect(ws); ws.connect(radio); radio.connect(this.fx);
    this._radioClick(t0, 0.05);
    let cursor = t0 + 0.09;
    const n = Math.max(2, Math.min(7, syllables + 1));
    for (let i = 0; i < n; i++) {
      // Consonant: a short noise burst (s / t / k / f).
      if (Math.random() < 0.7) {
        const cl = (0.025 + Math.random() * 0.04) * pace;
        const cn = this._ns(), cf = this.ctx.createBiquadFilter(); cf.type = Math.random() < 0.5 ? 'highpass' : 'bandpass';
        cf.frequency.value = 2500 + Math.random() * 3500; cf.Q.value = 1;
        const cg = this.ctx.createGain(); cg.gain.setValueAtTime(vol * 0.35, cursor); cg.gain.exponentialRampToValueAtTime(0.001, cursor + cl);
        cn.connect(cf); cf.connect(cg); cg.connect(bus); cn.start(cursor, Math.random() * 3); cn.stop(cursor + cl + 0.01);
        cursor += cl * 0.8;
      }
      // Vowel: glottal pulse train through three formants, with the
      // phrase's pitch falling gently (and rising at the end if urgent).
      const vl = (0.09 + Math.random() * 0.09) * pace;
      const decl = 1 - 0.18 * (i / n) + (urgent && i === n - 1 ? 0.15 : 0);
      const f0 = baseF * decl * (1 + (Math.random() - 0.5) * 0.12);
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, cursor); o.frequency.linearRampToValueAtTime(f0 * (0.94 + Math.random() * 0.1), cursor + vl);
      const v = VOW[Math.floor(Math.random() * VOW.length)];
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, cursor); g.gain.linearRampToValueAtTime(vol, cursor + 0.015);
      g.gain.setValueAtTime(vol * 0.9, cursor + vl - 0.025); g.gain.linearRampToValueAtTime(0, cursor + vl);
      v.forEach((ff, k) => {
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * (0.95 + Math.random() * 0.1); bp.Q.value = [6, 8, 10][k];
        const fg = this.ctx.createGain(); fg.gain.value = [1.3, 0.7, 0.3][k];
        o.connect(bp); bp.connect(fg); fg.connect(g);
      });
      g.connect(bus); o.start(cursor); o.stop(cursor + vl + 0.02);
      cursor += vl + (Math.random() < 0.25 ? 0.07 : 0.015) * pace;
    }
    this._radioClick(cursor + 0.04, 0.04);
  }
  _radioClick(at, dur) {
    const l = Math.max(1, Math.ceil(this.ctx.sampleRate * dur));
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / l, 1.6);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = this.ctx.createGain(); g.gain.value = 0.22;
    s.connect(hp); hp.connect(g); g.connect(this.fx); s.start(at);
  }

  // Title-card musical sting: ascending power-chord chime, fades 1.6 s.
  titleSting() {
    const t = this.ctx.currentTime;
    [55, 110, 165, 220, 330].forEach((f, i) => {
      const ts = t + i * 0.08;
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.30, ts);
      g.gain.exponentialRampToValueAtTime(0.001, ts + 1.6);
      o.connect(lp); lp.connect(g); g.connect(this.fx); o.start(ts); o.stop(ts + 1.65);
    });
  }
}

export function getAM() {
  if (!_AM) {
    try { _AM = new AudioEngine(); } catch (e) { return null; }
  }
  if (_AM.ctx.state === 'suspended') _AM.ctx.resume();
  return _AM;
}

// camX: current camera scroll; events carrying a world `x` are panned
// by where they happen on screen (viewport width 900).
export function processSounds(q, am, mutedRef, camX = null, zoom = 1) {
  if (!am || mutedRef.current) { q.length = 0; return; }
  const pan = e => (camX === null || typeof e.x !== 'number') ? 0 : Math.max(-1, Math.min(1, ((e.x - camX) * zoom - 450) / 450));
  q.forEach(e => {
    switch (e.t) {
      case 'shot':
      case 'fire':   am.shot(e.w, pan(e), e.in); break;
      case 'shell':  am.shell();             break;
      case 'reload': am.reload(e.w, e.dur);  break;
      case 'hit':    am.hit(e.now, pan(e));  break;
      case 'zdie':   am.zombieDie(e.zt, pan(e)); break;
      case 'groan':  am.groan(e.now, e.zt, pan(e)); break;
      case 'zatk':   am.zombieAtk(pan(e));   break;
      case 'hdie':   am.humanDie(pan(e), e.deep); break;
      case 'hshout': am.humanShout(pan(e), e.deep); break;
      case 'hhurt':  am.humanHurt(pan(e));   break;
      case 'slash':
      case 'melee':  am.melee(e.m, pan(e));  break;
      case 'mbreak': am.meleeBreak(e.m, pan(e)); break;
      case 'explosion': am.explosion(pan(e)); break;
      case 'grenade': am.grenade(pan(e)); break;
      case 'pin':    am.pin(pan(e));         break;
      case 'clink':  am.clink(pan(e));       break;
      case 'roll':   am.roll(pan(e));        break;
      case 'swish':  am.melee(e.m, pan(e), true); break;
      case 'swap':   am.swap(pan(e));        break;
      case 'roar':   am.roar(pan(e));        break;
      case 'spit':   am.spit(pan(e));        break;
      case 'pickup': am.pickup();            break;
      case 'thud':   am.thud();              break;
      case 'staticStart': am.staticStart(e.level); break;
      case 'staticStop':  am.staticStop();   break;
      case 'squelch': am.squelch();          break;
      case 'bhit':   am.baseHit();           break;
      case 'wclr':   am.waveCleared();       break;
      // Cinematic / ambient
      case 'heliStart':   am.heliStart(e.intensity); break;
      case 'heliStop':    am.heliStop();             break;
      case 'siren':       am.siren();                break;
      case 'scream':      am.scream();               break;
      case 'crackle':     am.crackle();              break;
      case 'windStart':   am.windStart(e.intensity); break;
      case 'windStop':    am.windStop();             break;
      case 'cityHum':     am.cityHumStart();         break;
      case 'cityHumStop': am.cityHumStop();          break;
      case 'titleSting':  am.titleSting();           break;
      case 'chatter':     am.radioChatter(e);        break;
    }
  });
  q.length = 0;
}
