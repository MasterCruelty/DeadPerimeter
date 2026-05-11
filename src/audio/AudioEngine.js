// Procedural Web Audio engine. No external samples.
// Source of truth: PROJECT_STATE.md §10.

let _AM = null;

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
    this.fx = this.ctx.createGain(); this.fx.gain.value = 0.9; this.fx.connect(this.master);
    this.bg = this.ctx.createGain(); this.bg.gain.value = 0;   this.bg.connect(this.master);
    this.bgRunning = false; this.bgNodes = []; this.beatTO = null; this.lastGroan = 0; this.lastHit = 0;
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this._nb = b;
  }
  _ns() { const s = this.ctx.createBufferSource(); s.buffer = this._nb; s.loop = true; return s; }
  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
  mute(on) { this.master.gain.setTargetAtTime(on ? 0 : 0.55, this.ctx.currentTime, 0.05); }
  startBg() {
    if (this.bgRunning) return; this.bgRunning = true;
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
  shot(w) {
    const t = this.ctx.currentTime;
    const dur = w === 'shotgun' ? 0.32 : w === 'rifle' ? 0.22 : 0.13;
    const vol = w === 'shotgun' ? 1.25 : w === 'rifle' ? 0.95 : 0.70;
    const fc  = w === 'shotgun' ? 360  : w === 'rifle' ? 880  : 1650;
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.4);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = w === 'shotgun' ? 0.4 : 0.85;
    const gn = this.ctx.createGain(); gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur * 2.4);
    src.connect(bp); bp.connect(gn); gn.connect(this.fx); src.start(t);
    if (w !== 'pistol') {
      const s = this.ctx.createOscillator(); s.type = 'sine';
      s.frequency.setValueAtTime(w === 'shotgun' ? 72 : 50, t); s.frequency.exponentialRampToValueAtTime(15, t + 0.24);
      const sg = this.ctx.createGain(); sg.gain.setValueAtTime(w === 'shotgun' ? 0.7 : 0.40, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
      s.connect(sg); sg.connect(this.fx); s.start(t); s.stop(t + 0.32);
    }
  }
  reload(w, dur) {
    this._click(510, 0.44, 0.08);
    setTimeout(() => this._click(330, 0.52, 0.07), dur * 0.46);
    setTimeout(() => { this._click(970, 0.62, 0.04); setTimeout(() => this._click(710, 0.38, 0.035), 80); }, dur * 0.82);
  }
  _click(freq, vol, dur) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const og = this.ctx.createGain(); og.gain.setValueAtTime(vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(og); og.connect(this.fx); o.start(t); o.stop(t + dur + 0.01);
    const nl = Math.ceil(this.ctx.sampleRate * dur);
    const nb = this.ctx.createBuffer(1, nl, this.ctx.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nl; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nl);
    const ns = this.ctx.createBufferSource(); ns.buffer = nb;
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 2.1; nf.Q.value = 4;
    const ng = this.ctx.createGain(); ng.gain.value = vol * 0.32;
    ns.connect(nf); nf.connect(ng); ng.connect(this.fx); ns.start(t);
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
  hit(now) {
    if (now - this.lastHit < 85) return; this.lastHit = now;
    const t = this.ctx.currentTime; const l = Math.ceil(this.ctx.sampleRate * 0.09);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / l);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 680;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.26, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    s.connect(lp); lp.connect(g); g.connect(this.fx); s.start(t);
  }
  zombieDie(type) {
    const t = this.ctx.currentTime; const f = type === 'tank' ? 52 : type === 'runner' ? 108 : 78;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f + Math.random() * 28, t); o.frequency.exponentialRampToValueAtTime(f * 0.33, t + 0.68);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 310; bp.Q.value = 2.4;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.40, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.74);
    o.connect(bp); bp.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.78);
  }
  groan(now, type) {
    if (now - this.lastGroan < 2800) return; this.lastGroan = now;
    const t = this.ctx.currentTime;
    const f = type === 'tank' ? 50 + Math.random() * 16 : type === 'runner' ? 98 + Math.random() * 38 : 70 + Math.random() * 32;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.70, t + 0.58); o.frequency.linearRampToValueAtTime(f * 0.84, t + 1.12);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 370; bp.Q.value = 3.0;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28, t + 0.09);
    g.gain.linearRampToValueAtTime(0.18, t + 0.58); g.gain.linearRampToValueAtTime(0, t + 1.08);
    o.connect(bp); bp.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 1.12);
  }
  zombieAtk() {
    const t = this.ctx.currentTime; const l = Math.ceil(this.ctx.sampleRate * 0.15);
    const b = this.ctx.createBuffer(1, l, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / l, 0.75);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.48, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    s.connect(lp); lp.connect(g); g.connect(this.fx); s.start(t);
  }
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
}

export function getAM() {
  if (!_AM) {
    try { _AM = new AudioEngine(); } catch (e) { return null; }
  }
  if (_AM.ctx.state === 'suspended') _AM.ctx.resume();
  return _AM;
}

export function processSounds(q, am, mutedRef) {
  if (!am || mutedRef.current) { q.length = 0; return; }
  q.forEach(e => {
    switch (e.t) {
      case 'shot':   am.shot(e.w);           break;
      case 'shell':  am.shell();             break;
      case 'reload': am.reload(e.w, e.dur);  break;
      case 'hit':    am.hit(e.now);          break;
      case 'zdie':   am.zombieDie(e.zt);     break;
      case 'groan':  am.groan(e.now, e.zt);  break;
      case 'zatk':   am.zombieAtk();         break;
      case 'bhit':   am.baseHit();           break;
      case 'wclr':   am.waveCleared();       break;
    }
  });
  q.length = 0;
}
