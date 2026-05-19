import { uid, CW } from '../constants.js';
import { ZTP } from '../data/zombies.js';

// Zombies still spawn just past the right edge of the default
// viewport (CW + 50). The wider WORLD_W is for camera scroll +
// scenery, not for stretching the approach distance — otherwise
// every wave would balloon to several minutes.
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
