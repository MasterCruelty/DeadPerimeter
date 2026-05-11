import {
  HUMAN_WAVE_FIRST, HUMAN_WAVE_EVERY, isHumanWaveNumber,
} from '../data/humans.js';

export { isHumanWaveNumber };

// Zombie spawn queue. Walkers, runners (from wave 2) and tanks (from wave 4).
export const mkWave = n => {
  const q = [];
  const nw = 5 + n * 3;
  const nr = Math.max(0, n - 1) * 2;
  const nt = Math.max(0, n - 3);
  for (let i = 0; i < nw; i++) q.push({ type: 'walker', at: i * 1700 + Math.random() * 600 });
  for (let i = 0; i < nr; i++) q.push({ type: 'runner', at: 1800 + i * 950 + Math.random() * 400 });
  for (let i = 0; i < nt; i++) q.push({ type: 'tank',   at: 3500 + i * 4000 });
  return q.sort((a, b) => a.at - b.at);
};

// Human survivor wave. Mix of knifemen (~60%) and gunmen (~40%), scaling with wave number.
export const mkHumanWave = n => {
  const q = [];
  const total = 6 + Math.floor((n - HUMAN_WAVE_FIRST) / HUMAN_WAVE_EVERY) * 3 + Math.floor(n / 2);
  const gunmen = Math.max(2, Math.floor(total * 0.4));
  const knifemen = total - gunmen;
  for (let i = 0; i < knifemen; i++) q.push({ type: 'knifeman', at: i * 1500 + Math.random() * 500 });
  for (let i = 0; i < gunmen;   i++) q.push({ type: 'gunman',   at: 2200 + i * 1800 + Math.random() * 500 });
  return q.sort((a, b) => a.at - b.at);
};
