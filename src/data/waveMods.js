// Wave modifiers ("conditions"). One may be rolled for each upcoming
// wave; it's shown in the command-center intel so the player can
// prepare (build turrets for a stampede, keep snipers for fog...).
//
//   rangeMul: multiplies every friendly weapon range (soldiers, roof
//             sniper, turrets) — visibility conditions.
//   Composition changes are applied by mkWave (entities/wave.js).
export const WAVE_MODS = {
  fog: {
    name: 'DENSE FOG', icon: '🌫', color: '#b8c4c8', rangeMul: 0.65,
    desc: 'Visibility is down: every weapon range −35%. They will be on you before you see them.',
    radio: 'Fog rolling in, can\'t see past the cars!',
  },
  night: {
    name: 'MOONLESS NIGHT', icon: '🌑', color: '#8098d0', rangeMul: 0.8,
    desc: 'No moon, no floodlights: weapon range −20%.',
    radio: 'Lights are out. Eyes open, stay sharp.',
  },
  rush: {
    name: 'RUNNER STAMPEDE', icon: '🏃', color: '#e8a848',
    desc: 'Most walkers replaced by runners, arriving in fast packs.',
    radio: 'Runners! A whole pack of them!',
  },
  heavy: {
    name: 'HEAVY ASSAULT', icon: '🛡', color: '#e06a48',
    desc: 'Fewer dead, but tanks and brutes lead the charge.',
    radio: 'Big ones incoming. Focus fire!',
  },
  acid: {
    name: 'SPITTER PACK', icon: '☣', color: '#8ad858',
    desc: 'A pack of spitters lobs acid from range. Push out and take them down.',
    radio: 'Spitters in the field! Watch the acid!',
  },
};

// Requirements so early waves stay readable.
const MIN_WAVE = { fog: 3, night: 3, rush: 5, heavy: 8, acid: 6 };
// Conditions that make sense on a hostile-human wave.
const HUMAN_OK = new Set(['fog', 'night']);

export function rollWaveMod(wave, isHuman, prev = null, maxWaves = 30) {
  if (wave < 3 || wave >= maxWaves) return null;
  if (Math.random() > 0.6) return null;
  const pool = Object.keys(WAVE_MODS).filter(k =>
    wave >= MIN_WAVE[k] && k !== prev && (!isHuman || HUMAN_OK.has(k)));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

// Mini-boss every 5th wave (all of them are zombie waves: human waves
// fall on 4, 9, 14...). Names cycle so each one feels like an event.
const BOSS_NAMES = ['THE BUTCHER', 'GOLIATH', 'THE WARDEN', 'MOTHER', 'THE OX'];
export const isBossWave = (wave, maxWaves = 30) => wave % 5 === 0 && wave < maxWaves;
export const bossName = wave => BOSS_NAMES[(Math.floor(wave / 5) - 1) % BOSS_NAMES.length];
export const bossHp = wave => 520 + wave * 48;
