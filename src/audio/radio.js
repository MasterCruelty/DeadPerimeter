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

import { isRadioVoiceEnabled, speakRadio } from './radioVoice.js';

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
  defeat:    ['I\'m out!',      'They\'re everywhere!', 'For Fort Omega!', 'Cover me!',
              'Mag dry!',       'Tell my family...',    'Hold the line!',  'No more rounds!'],
};

const PITCHES = ['low', 'mid', 'high'];

// pushRadio(state, category, opts?)
//   state:    gs (siege) or m (mission) — anything with a soundQ array
//   category: a key from RADIO_LINES
//   opts:
//     speaker:  a soldier object (with .voicePitch) — when supplied the
//               line is voiced in that individual's pitch (Hz). Name is
//               prepended to the subtitle so the player can tell who's
//               on the radio.
//     pitch:    'low'|'mid'|'high'|number  override (skips speaker pitch)
//     urgent:   boolean (louder + faster cadence)
//     line:     explicit text override (skips the random pick)
//     cooldown: minimum ms between any two pushes on this state (default 1300)
//
// Stores the chosen line on state.radioMsg = { text, at, dur } so
// the HUD layer can render the subtitle.
export function pushRadio(state, category, opts = {}) {
  if (!state) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const cd = opts.cooldown ?? 1300;
  if (state._lastRadioAt && (now - state._lastRadioAt) < cd) return;
  state._lastRadioAt = now;

  const pool = RADIO_LINES[category];
  if (!pool || pool.length === 0) return;
  const text = opts.line || pool[Math.floor(Math.random() * pool.length)];
  // Pitch precedence: explicit opts.pitch > speaker.voicePitch > hash-of-text.
  let pitch;
  if (opts.pitch !== undefined) {
    pitch = opts.pitch;
  } else if (opts.speaker && typeof opts.speaker.voicePitch === 'number') {
    pitch = opts.speaker.voicePitch;
  } else {
    let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    pitch = PITCHES[Math.abs(h) % PITCHES.length];
  }
  // Prepend the speaker's name when one was provided so the subtitle
  // reads like a real radio callout ("Bravo: I'm hit!").
  const subtitle = opts.speaker && opts.speaker.name
    ? `${opts.speaker.name}: ${text}`
    : text;

  state.radioMsg = { text: subtitle, at: now, dur: opts.dur || 2200, category };
  if (!state.soundQ) state.soundQ = [];

  // Prefer real TTS when the user has voice enabled + Speech API works.
  // Speak the bare line (no "Bravo:" prefix) since the HUD shows the
  // speaker name in the subtitle.
  const spoke = isRadioVoiceEnabled() && speakRadio(text, { pitch, urgent: !!opts.urgent });

  if (!spoke) {
    state.soundQ.push({
      t: 'chatter',
      syllables: Math.max(2, Math.min(6, Math.round(text.length / 5))),
      pitch,
      urgent: !!opts.urgent,
    });
  }
}
