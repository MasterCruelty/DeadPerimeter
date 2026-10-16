import { uid, WORLD_W, rng } from '../constants.js';
import { HTP } from '../data/humans.js';

// Hostile human survivor (knifeman / gunman). Spawned only during human waves.
// Like zombies they enter from the far edge of the wider WORLD_W — the
// old CW + 50 spawn predates the world widening and made gangs pop into
// existence in the middle of the battlefield.
export const mkHuman = type => {
  const h = HTP[type];
  return {
    id: uid(), type, h, x: WORLD_W + 20 + rng(0, 30),
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
