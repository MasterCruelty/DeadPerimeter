import {
  HUMAN_WAVE_FIRST, HUMAN_WAVE_EVERY, isHumanWaveNumber,
} from '../data/humans.js';
import { DIFFICULTY, BALANCE } from '../data/difficulty.js';
import { isBossWave } from '../data/waveMods.js';

export { isHumanWaveNumber };

// Zombie spawn queue for wave n under an optional modifier (see
// data/waveMods.js). Counts scale with the wave as before; the queue is
// then paced in SURGES — a tight pack, a lull to reload and reposition,
// the next pack — instead of one flat trickle. Tanks / brutes join from
// the second surge on, and boss waves hold the mini-boss back for a
// quiet beat around the middle of the wave.
// Wave 30 ("the extraction") gets a mega-multiplier on every count.
const GAP = { walker: 620, runner: 360, tank: 1400, brute: 1900, spitter: 760 };

export const mkWave = (n, mod = null) => {
  const D = DIFFICULTY;
  const mul = n === BALANCE.maxWaves ? BALANCE.megaWaveMultiplier : 1;
  let nw = Math.floor((D.walkerBase + n * D.walkerPerWave) * mul);
  let nr = Math.floor(Math.max(0, n - (D.runnerFromWave - 1)) * D.runnerPerWave * mul);
  let nt = Math.floor(Math.max(0, n - (D.tankFromWave - 1)) * D.tankPerWave * mul);
  let ns = n >= 7 ? Math.floor((n - 5) * 0.3 * mul) : 0;
  let nb = n >= 16 ? Math.floor((n - 13) / 4 * mul) : 0;
  if (mod === 'rush')  { const k = Math.round(nw * 0.7); nw -= k; nr += k; }
  if (mod === 'heavy') { nw = Math.ceil(nw * 0.5); nt += Math.max(2, Math.floor(n / 5)); nb += 1; }
  if (mod === 'acid')  { ns += 3 + Math.floor(n / 6); }

  const light = [
    ...Array(nw).fill('walker'), ...Array(nr).fill('runner'), ...Array(ns).fill('spitter'),
  ];
  for (let i = light.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [light[i], light[j]] = [light[j], light[i]]; }
  // Heavies spread evenly through the back 70% of the wave.
  const heavy = [...Array(nt).fill('tank'), ...Array(nb).fill('brute')];
  const units = [...light];
  heavy.forEach((t, i) => {
    const pos = Math.floor(units.length * (0.3 + 0.7 * (i + 0.5) / heavy.length));
    units.splice(pos, 0, t);
  });

  const surge = Math.min(14, 5 + Math.floor(n / 3)) * (mod === 'rush' ? 1.4 : 1);
  const lull = Math.max(3000, 5500 - n * 80);
  const bossAt = isBossWave(n, BALANCE.maxWaves) ? Math.floor(units.length * 0.55) : -1;
  const q = [];
  let t = 0, inSurge = 0;
  units.forEach((type, i) => {
    if (i === bossAt) {
      t += lull * 1.3;
      q.push({ type: 'brute', boss: true, at: t });
      t += 2500; inSurge = 0;
    }
    if (inSurge >= surge) { t += lull; inSurge = 0; }
    q.push({ type, at: t });
    t += GAP[type] * (0.7 + Math.random() * 0.6) * (mod === 'rush' && type === 'runner' ? 0.7 : 1);
    inSurge++;
  });
  if (bossAt >= units.length) q.push({ type: 'brute', boss: true, at: t + lull });
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
