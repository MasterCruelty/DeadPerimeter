import { uid, WORLD_W, rng } from '../constants.js';
import { ZTP } from '../data/zombies.js';

// Zombies spawn at the right edge of the wider WORLD_W so the player
// sees the horde approaching from the distance. The longer walk
// rewards the wider battlefield and gives sniper rifles room to
// actually reach out.
export const mkZombie = type => {
  const z = ZTP[type];
  return {
    id: uid(), type, z, x: WORLD_W + 30 + rng(0, 40),
    lane: Math.floor(Math.random() * 3),
    hp: z.hp, maxHp: z.hp,
    spd: z.spd * (0.82 + Math.random() * 0.36),
    state: 'walk', facing: -1,
    walkPhase: Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0, deadAt: 0,
    targetSolId: null, targetBarId: null,
  };
};
