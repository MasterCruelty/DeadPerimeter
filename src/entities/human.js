import { uid, CW } from '../constants.js';
import { HTP } from '../data/humans.js';

// Hostile human survivor (knifeman / gunman). Spawned only during human waves.
export const mkHuman = type => {
  const h = HTP[type];
  return {
    id: uid(), type, h, x: CW + 50,
    lane: Math.floor(Math.random() * 3),
    hp: h.hp, maxHp: h.hp,
    spd: h.spd * (0.85 + Math.random() * 0.30),
    state: 'walk', facing: -1,
    walkPhase: Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0, deadAt: 0,
    lastShot: 0,
    targetSolId: null, targetBarId: null,
    hostile: true,
  };
};
