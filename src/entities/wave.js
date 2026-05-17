import {
  HUMAN_WAVE_FIRST, HUMAN_WAVE_EVERY, isHumanWaveNumber,
} from '../data/humans.js';
import { DIFFICULTY, BALANCE } from '../data/difficulty.js';

export { isHumanWaveNumber };

// Zombie spawn queue. Walkers, runners (from configured wave) and tanks.
// Wave 30 ("the extraction") gets a mega-multiplier on every count so
// it feels like the final assault.
export const mkWave = n => {
  const q = [];
  const D = DIFFICULTY;
  const mul = n === BALANCE.maxWaves ? BALANCE.megaWaveMultiplier : 1;
  const nw = Math.floor((D.walkerBase + n * D.walkerPerWave) * mul);
  const nr = Math.floor(Math.max(0, n - (D.runnerFromWave - 1)) * D.runnerPerWave * mul);
  const nt = Math.floor(Math.max(0, n - (D.tankFromWave - 1)) * D.tankPerWave * mul);
  for (let i = 0; i < nw; i++) q.push({ type: 'walker', at: i * D.walkerCadence + Math.random() * 600 });
  for (let i = 0; i < nr; i++) q.push({ type: 'runner', at: 1800 + i * D.runnerCadence + Math.random() * 400 });
  for (let i = 0; i < nt; i++) q.push({ type: 'tank',   at: 3500 + i * D.tankCadence });
  return q.sort((a, b) => a.at - b.at);
};

// Human survivor wave. Mix of knifemen and gunmen, scaling with wave number.
export const mkHumanWave = n => {
  const q = [];
  const D = DIFFICULTY;
  const total = D.humanBase + Math.floor((n - HUMAN_WAVE_FIRST) / HUMAN_WAVE_EVERY) * D.humanPerHumanWave + Math.floor(n / 2);
  const gunmen = Math.max(2, Math.floor(total * D.humanGunmanRatio));
  const knifemen = total - gunmen;
  for (let i = 0; i < knifemen; i++) q.push({ type: 'knifeman', at: i * D.humanCadence + Math.random() * 500 });
  for (let i = 0; i < gunmen;   i++) q.push({ type: 'gunman',   at: 2200 + i * (D.humanCadence + 300) + Math.random() * 500 });
  return q.sort((a, b) => a.at - b.at);
};
