// Hostile human survivor wave configuration. See PROJECT_STATE.md §17.

export const HTP = {
  knifeman: {
    hp: 50, spd: 0.85, dmg: 8, range: 0,
    color: '#7a5a3a', cap: '#5a1f1f', name: 'Knifeman',
  },
  gunman: {
    hp: 60, spd: 0.55, dmg: 4, range: 340, rate: 1600,
    color: '#3a4858', cap: '#1f1f1f', name: 'Gunman',
    bulletSpd: 10,
  },
};

// Ammo dropped on death — [min, max] inclusive.
export const HUMAN_AMMO_DROP = [3, 8];

// First wave that may be a human wave, and cadence afterwards.
// Wave 4 → first human wave, then every 5 waves: 4, 9, 14, 19, ...
export const HUMAN_WAVE_FIRST = 4;
export const HUMAN_WAVE_EVERY = 5;

export const isHumanWaveNumber = n =>
  n >= HUMAN_WAVE_FIRST && (n - HUMAN_WAVE_FIRST) % HUMAN_WAVE_EVERY === 0;
