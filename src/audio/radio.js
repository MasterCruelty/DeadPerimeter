// Tactical-radio chatter helper. Picks one line from a category,
// schedules the procedural radio voice on the state's soundQ, and
// stores a subtitle (state.radioMsg) for the HUD to render.
//
// When the Web Speech API is available + voice is enabled, the line
// is spoken aloud instead — see speakRadio() in radioVoice.js. The
// procedural buzz is suppressed in that case so the listener hears
// click-hiss-voice-click rather than buzz+voice on top of each other.
//
// Lines are very short on purpose — they have to read at a glance
// during siege / mission UI.

import { speakOrChatter } from './radioVoice.js';
import { t } from '../i18n/index.js';
import { NPCS } from '../data/quests.js';
import { COMPACT } from '../data/faction.js';

// Named voices on the net besides the squad: the survivors at the fort,
// the Compact's colonel and Central Command. `pitch` / `female` steer
// the TTS voice; the panel draws their portrait (render/portrait.js).
export const SPEAKERS = {
  reyes:   { name: NPCS.reyes.name, color: NPCS.reyes.color, pitch: 'high', female: true },
  hale:    { name: NPCS.hale.name,  color: NPCS.hale.color,  pitch: 'low' },
  jun:     { name: NPCS.jun.name,   color: NPCS.jun.color,   pitch: 'mid' },
  voss:    { name: COMPACT.leader,  color: COMPACT.color,    pitch: 'mid', female: true },
  command: { name: 'Central Command', color: '#ff9a70',      pitch: 'low' },
};

export const RADIO_LINES = {
  advance:   ['Moving up!',     'Pushing forward!', 'On the move!',  'Advancing!',         'Squad, forward!'],
  retreat:   ['Falling back!',  'Pulling back!',    'Cover me!',     'Back to the wall!',  'Withdrawing!'],
  reload:    ['Reloading!',     'Mag out!',         'Switching mags!','Cover, reloading!', 'Last one in!'],
  hurt:      ["I'm hit!",       'Took one!',        'Medic!',        "I'm bleeding!",      'They got me!'],
  kill:      ['Got him!',       'Target down!',     'One less!',     'Clear!',             'Hostile down!'],
  evacIn:    ['Black Hawk inbound', 'Bird on approach', 'Eyes on the LZ'],
  evacBoard: ["Door's open!",   'Move move move!',  'Get them aboard!', 'Last call, civvies!'],
  evacOut:   ['Wheels up!',     'Going home!',      'RTB confirmed',    'Omega, we have them'],
  deploy:    ['Manning the wall!', 'Defensive positions!', 'Ready up!'],
  lowAmmo:   ['Almost dry!',    'Running low!',     'Ammo!',         'Cover, I\'m out!'],
  baseHit:   ['Wall took a hit!','Breach attempt!', 'They\'re at the gate!'],
  // Last-stand lines for the game-over cinematic.
  // Sortie start: Hale on the fort's radio.
  sortieOut: ['Radio check. Get what you need and get back to the van.',
              'Hale here. Keep the chatter short and the van close.',
              'We keep the gate warm for you. Eyes open out there.'],
  defeat:    ['I\'m out!',      'They\'re everywhere!', 'For Fort Omega!', 'Cover me!',
              'Mag dry!',       'Tell my family...',    'Hold the line!',  'No more rounds!'],
};

const PITCHES = ['low', 'mid', 'high'];

// Radio log: the last scripted lines (events, NPCs, transmissions) for
// the command center and the pause screen. Kept in memory only; lines
// are stored in English with their params and translated on display.
const LOG_MAX = 40;
const LOG = [];
export const radioLog = () => LOG;
export const clearRadioLog = () => { LOG.length = 0; };
export function logRadio(e) {
  LOG.unshift({ ...e, when: Date.now() });
  if (LOG.length > LOG_MAX) LOG.length = LOG_MAX;
}

// Display name (translated) and colour for a radioMsg or log entry.
export function speakerInfo(m) {
  const npc = m && m.who && m.who.npc && SPEAKERS[m.who.npc];
  if (npc) return { name: t(npc.name), color: npc.color };
  return { name: (m && m.name) || t('Radio'), color: m && m.who && m.who.soldier ? '#8aff8a' : '#9ad0ff' };
}

// The bits of a soldier the portrait needs (render/portrait.js mirrors
// drawSoldierBody's look from these).
const soldierWho = s => ({
  name: s.name, id: s.lookId ?? s.origId ?? s.id, veteran: !!s.veteran, civilian: !!s.civilian, compact: !!s.compact,
  police: !!s.police, swat: !!s.swat, bandit: !!s.bandit, jacket: s.jacket || null, colonel: !!s.colonel,
});

// pushRadio(state, category, opts?)
//   state:    gs (siege) or m (mission) — anything with a soundQ array
//   category: a key from RADIO_LINES
//   opts:
//     speaker:  a soldier object (with .voicePitch) — when supplied the
//               line is voiced in that individual's pitch (Hz). Name is
//               prepended to the subtitle so the player can tell who's
//               on the radio.
//     from:     a SPEAKERS id ('hale', 'voss', 'command'...) for lines
//               spoken by someone outside the squad
//     pitch:    'low'|'mid'|'high'|number  override (skips speaker pitch)
//     urgent:   boolean (louder + faster cadence)
//     line:     explicit text override (skips the random pick); English,
//               may hold {placeholders} filled from opts.params
//     params:   values for the line's {placeholders}
//     cooldown: minimum ms between any two pushes on this state (default 1300)
//
// Stores the chosen line on state.radioMsg = { text, line, params,
// name, who, at, dur } so the HUD radio panel can render it. Scripted
// lines (explicit `line` or an NPC speaker) also go to the radio log.
export function pushRadio(state, category, opts = {}) {
  if (!state) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const cd = opts.cooldown ?? 1300;
  if (state._lastRadioAt && (now - state._lastRadioAt) < cd) return;
  state._lastRadioAt = now;

  const pool = RADIO_LINES[category];
  if (!pool || pool.length === 0) return;
  const text = opts.line || pool[Math.floor(Math.random() * pool.length)];
  const npc = opts.from && SPEAKERS[opts.from];
  // Pitch precedence: explicit opts.pitch > speaker.voicePitch > NPC > hash-of-text.
  let pitch;
  if (opts.pitch !== undefined) {
    pitch = opts.pitch;
  } else if (opts.speaker && typeof opts.speaker.voicePitch === 'number') {
    pitch = opts.speaker.voicePitch;
  } else if (npc) {
    pitch = npc.pitch;
  } else {
    let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    pitch = PITCHES[Math.abs(h) % PITCHES.length];
  }
  // Prepend the speaker's name when one was provided so the subtitle
  // reads like a real radio callout ("Bravo: I'm hit!").
  const name = (opts.speaker && opts.speaker.name) || (npc && npc.name) || null;
  const subtitle = name ? `${npc ? t(name) : name}: ${t(text, opts.params)}` : t(text, opts.params);
  const who = opts.speaker ? { soldier: soldierWho(opts.speaker) } : npc ? { npc: opts.from } : null;

  state.radioMsg = {
    text: subtitle, line: text, params: opts.params, name, who, npc: !!npc,
    at: now, dur: opts.dur || 2200, category, urgent: !!opts.urgent,
  };
  // The log keeps the people on the net, not squad chatter (opts.log forces it).
  if (npc || opts.log) logRadio({ line: text, params: opts.params, name, who, npc: !!npc, category });
  if (!state.soundQ) state.soundQ = [];

  // Prefer real TTS; procedural chatter when it's off or fails. Speak
  // the bare line (no "Bravo:" prefix) since the HUD shows the speaker.
  speakOrChatter(text, { pitch, urgent: !!opts.urgent, voice: name, female: !!(npc && npc.female), params: opts.params }, state.soundQ);
}
