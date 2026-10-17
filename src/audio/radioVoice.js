// Web Speech API wrapper that speaks radio chatter with a tactical-comm
// envelope around it (kssst click-open, low-volume hiss during, click-
// close on completion). The TTS voice itself can't be filtered — the
// Speech API doesn't expose the audio as a WebAudio node — so we sell
// the "radio transmission" feel via the noise envelope and tweaked
// pitch / rate on the utterance.
//
// Browsers without speechSynthesis just see speakRadio() return false;
// callers (radio.js) fall back to the existing procedural buzz.

let _initialized = false;
let _enabled = true;
let _voices = [];
let _ctx = null;
let _hissNode = null;
let _current = null;     // utterance in flight
let _fails = 0;          // consecutive utterances that never started
let _ttsBroken = false;  // engine produces nothing: use chatter instead

const STORAGE_KEY = 'fortomega_radioVoice';

export function isRadioVoiceAvailable() {
  return typeof window !== 'undefined' && !!window.speechSynthesis;
}

export function initRadioVoice() {
  if (_initialized) return;
  _initialized = true;
  try {
    const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
    _enabled = v === null ? true : v === '1';
  } catch {}
  if (isRadioVoiceAvailable()) {
    _voices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      _voices = window.speechSynthesis.getVoices();
    };
    // Mobile browsers only allow speech once speak() ran inside a user
    // gesture: prime the engine with a silent utterance on first input.
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch {}
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }
}

export function isRadioVoiceEnabled() { return _enabled && isRadioVoiceAvailable(); }

export function setRadioVoiceEnabled(b) {
  _enabled = !!b;
  if (_enabled) { _ttsBroken = false; _fails = 0; }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, _enabled ? '1' : '0');
    }
  } catch {}
  if (!_enabled) {
    try { window.speechSynthesis?.cancel(); } catch {}
    stopHiss();
  }
}

function ensureCtx() {
  if (_ctx) return _ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _ctx = new AC();
  } catch { return null; }
  return _ctx;
}

// Quick burst of band-limited white noise — the "kssst" of a PTT click.
function radioClick(at, dur, gain = 0.20) {
  const ctx = _ctx; if (!ctx) return;
  const l = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const b = ctx.createBuffer(1, l, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < l; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / l, 1.6);
  const s = ctx.createBufferSource(); s.buffer = b;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
  const g = ctx.createGain(); g.gain.value = gain;
  s.connect(hp); hp.connect(g); g.connect(ctx.destination); s.start(at);
}

// Looped bandpassed white noise — the carrier hiss under live speech.
function startHiss(volume = 0.05) {
  const ctx = _ctx; if (!ctx || _hissNode) return;
  const bufLen = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 2200; bp.Q.value = 0.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.04);
  s.connect(bp); bp.connect(g); g.connect(ctx.destination);
  s.start();
  _hissNode = { source: s, gain: g };
}

function stopHiss() {
  if (!_hissNode || !_ctx) return;
  try {
    const t = _ctx.currentTime;
    _hissNode.gain.gain.cancelScheduledValues(t);
    _hissNode.gain.gain.setValueAtTime(_hissNode.gain.gain.value, t);
    _hissNode.gain.gain.linearRampToValueAtTime(0, t + 0.08);
    const src = _hissNode.source;
    setTimeout(() => { try { src.stop(); } catch {} }, 200);
  } catch {}
  _hissNode = null;
}

// Map our pitch indicator (string or Hz) to a SpeechSynthesisUtterance.pitch.
// Kept in a narrow band: TTS engines turn anything past ~±10% into a
// cartoon. Speakers are told apart by voice, not by pitch.
function ttsPitch(pitch) {
  if (typeof pitch === 'number') {
    return Math.max(0.9, Math.min(1.06, 0.97 + (pitch - 150) / 90 * 0.08));
  }
  if (pitch === 'low')  return 0.92;
  if (pitch === 'high') return 1.04;
  return 0.98;
}

// Voices worth hearing: neural / natural ones first, then the plain
// system voices; macOS novelty voices and old formant synths are out.
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|organ|trinoids|whisper|wobble|zarvox|jester|superstar|junior|ralph|kathy|fred|princess|grand(ma|pa)|rocko|eddy|flo\b|reed|sandy|shelley|espeak/i;
const MALE = /\bmale\b|daniel|arthur|guy|ryan|christopher|eric|roger|steffan|thomas|aaron|oliver|george|david|mark|james|rishi|alex\b|tom\b|liam|brian|andrew|william|connor|mitchell|prabhat|davis|tony|jason/i;
const FEMALE = /female|samantha|victoria|karen|zira|susan|hazel|aria|jenny|moira|tessa|fiona|libby|sonia|serena|ava|allison|emma|michelle|natasha|clara|google us english/i;
function scoreVoice(v) {
  const n = v.name || '';
  let sc = 0;
  if (/natural|neural|online|premium|enhanced/i.test(n)) sc += 6;
  if (/google/i.test(n)) sc += 2;
  if (MALE.test(n)) sc += 3;
  if (FEMALE.test(n)) sc -= 2;
  if (/en[-_](us|gb|au|ie|ca)/i.test(v.lang || '')) sc += 1;
  return sc;
}
function rankedVoices() {
  if (!_voices || _voices.length === 0) return [];
  const en = _voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en') && !NOVELTY.test(v.name || ''));
  const pool = en.length ? en : _voices.filter(v => !NOVELTY.test(v.name || ''));
  return pool.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

// A consistent voice per speaker: the speaker's name picks one of the
// best few voices, so the squad doesn't all sound the same.
function pickVoice(pitch, key) {
  const pool = rankedVoices();
  if (!pool.length) return null;
  const top = pool.slice(0, Math.min(4, pool.length));
  let h = 0; const s = String(key ?? pitch ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return top[Math.abs(h) % top.length];
}

// Strip emojis / pictographs that TTS reads literally ("squared latin
// capital S" etc) and collapse whitespace.
function clean(text) {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[☀-➿]/g, '')
    .replace(/[★☆◆■◇▲▼]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Speak a radio line. Returns true if the TTS path took over (caller
// should suppress the procedural buzz), false otherwise.
//
//   opts.pitch:  'low'|'mid'|'high'|<number>  speaker tier
//   opts.urgent: boolean                      louder hiss, faster rate
export function speakRadio(text, opts = {}) {
  if (!isRadioVoiceEnabled() || _ttsBroken) return false;
  if (!text) return false;
  try {
    const c = clean(text);
    if (!c) return false;

    const ctx = ensureCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }

    // Rapid bursts: cut the line in flight so we don't queue 4 lines
    // back-to-back and lag behind the on-screen subtitle. Only cancel
    // when something is actually queued: Chrome can swallow a speak()
    // issued right after a no-op cancel().
    const ss = window.speechSynthesis;
    if (_current) _current._superseded = true;
    if (ss.speaking || ss.pending) { try { ss.cancel(); } catch {} }
    try { ss.resume(); } catch {}          // un-stick a paused queue
    stopHiss();

    radioClick(ctx.currentTime, 0.05, opts.urgent ? 0.26 : 0.20);
    startHiss(opts.urgent ? 0.07 : 0.05);

    const u = new SpeechSynthesisUtterance(c);
    u.pitch = ttsPitch(opts.pitch);
    u.rate  = opts.urgent ? 1.1 : 1.0;
    u.volume = 0.95;
    const v = pickVoice(opts.pitch, opts.voice);
    if (v) u.voice = v;

    // speak() can "succeed" and still produce nothing (no voices
    // installed, synthesis-failed, engine stuck). Detect that and hand
    // the line back to the caller's fallback (procedural chatter);
    // after repeated failures stop trying TTS for this session.
    let started = false, failed = false;
    const fail = () => {
      if (started || failed || u._superseded) return;
      failed = true; stopHiss();
      if (++_fails >= 2) _ttsBroken = true;
      if (opts.onFail) { try { opts.onFail(); } catch {} }
    };
    u.onstart = () => { started = true; _fails = 0; };
    u.onend = () => {
      const t = (_ctx && _ctx.currentTime) || 0;
      radioClick(t + 0.04, 0.04, 0.18);
      stopHiss();
      if (_current === u) _current = null;
    };
    u.onerror = e => {
      stopHiss();
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
      fail();
    };
    setTimeout(fail, 1200);

    _current = u;                          // Chrome GCs unreferenced utterances
    ss.speak(u);
    return true;
  } catch (e) {
    stopHiss();
    return false;
  }
}

// Speak a line, or play the procedural radio chatter on `soundQ` when
// TTS is off, unavailable or fails at runtime.
export function speakOrChatter(text, opts, soundQ) {
  const chatter = () => soundQ && soundQ.push({
    t: 'chatter', pitch: opts.pitch ?? 'mid', urgent: !!opts.urgent,
    syllables: Math.max(2, Math.min(6, Math.round((text || '').length / 5))),
  });
  if (!speakRadio(text, { ...opts, onFail: chatter })) chatter();
}
