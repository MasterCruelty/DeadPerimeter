import { uid, CW } from '../constants.js';
import { ZTP } from '../data/zombies.js';

export const mkZombie = type => {
  const z = ZTP[type];
  return {
    id: uid(), type, z, x: CW + 50,
    lane: Math.floor(Math.random() * 3),
    hp: z.hp, maxHp: z.hp,
    spd: z.spd * (0.82 + Math.random() * 0.36),
    state: 'walk', facing: -1,
    walkPhase: Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0, deadAt: 0,
    targetSolId: null, targetBarId: null,
  };
};
