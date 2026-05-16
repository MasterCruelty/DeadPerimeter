// Tactical-radio chatter helper. Picks one line from a category,
// schedules the procedural radio voice on the state's soundQ, and
// stores a subtitle (state.radioMsg) for the HUD to render.
//
// Lines are very short on purpose — they have to read at a glance
// during siege / mission UI.

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
//     pitch:    'low' | 'mid' | 'high'  (defaults to a deterministic
//                                        pick from the line text so the
//                                        same speaker sounds consistent)
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
  // Stable pitch per text (hashes the string) so the same line always
  // sounds like the same speaker.
  let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  const pitch = opts.pitch || PITCHES[Math.abs(h) % PITCHES.length];

  state.radioMsg = { text, at: now, dur: opts.dur || 2200, category };
  if (!state.soundQ) state.soundQ = [];
  state.soundQ.push({
    t: 'chatter',
    syllables: Math.max(2, Math.min(6, Math.round(text.length / 5))),
    pitch,
    urgent: !!opts.urgent,
  });
}
