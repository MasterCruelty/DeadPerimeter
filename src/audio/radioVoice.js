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
  }
}

export function isRadioVoiceEnabled() { return _enabled && isRadioVoiceAvailable(); }

export function setRadioVoiceEnabled(b) {
  _enabled = !!b;
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
function ttsPitch(pitch) {
  if (typeof pitch === 'number') {
    return Math.max(0.6, Math.min(1.4, 0.8 + (pitch - 130) / 90 * 0.4));
  }
  if (pitch === 'low')  return 0.78;
  if (pitch === 'high') return 1.18;
  return 1.0;
}

// Pick a deterministic English voice per pitch tier so each speaker
// stays consistent across a run. Falls back to first available voice
// if no English voices are present on the system.
function pickVoice(pitch) {
  if (!_voices || _voices.length === 0) return null;
  const en = _voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
  const pool = en.length > 0 ? en : _voices;
  let idx = 1;
  if (pitch === 'low')  idx = 0;
  else if (pitch === 'high') idx = 2;
  return pool[idx % pool.length];
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
  if (!isRadioVoiceEnabled()) return false;
  if (!text) return false;
  try {
    const c = clean(text);
    if (!c) return false;

    const ctx = ensureCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }

    // Rapid bursts: cancel anything in flight so we don't queue 4 lines
    // back-to-back and lag behind the on-screen subtitle.
    try { window.speechSynthesis.cancel(); } catch {}
    stopHiss();

    radioClick(ctx.currentTime, 0.05, opts.urgent ? 0.26 : 0.20);
    startHiss(opts.urgent ? 0.07 : 0.05);

    const u = new SpeechSynthesisUtterance(c);
    u.pitch = ttsPitch(opts.pitch);
    u.rate  = opts.urgent ? 1.18 : 1.04;
    u.volume = 0.95;
    const v = pickVoice(opts.pitch);
    if (v) u.voice = v;

    u.onend = () => {
      const t = (_ctx && _ctx.currentTime) || 0;
      radioClick(t + 0.04, 0.04, 0.18);
      stopHiss();
    };
    u.onerror = () => { stopHiss(); };

    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    stopHiss();
    return false;
  }
}
