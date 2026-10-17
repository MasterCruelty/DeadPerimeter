import { uid, WORLD_W, rng } from '../constants.js';
import { ZTP } from '../data/zombies.js';
import { bossHp, bossName } from '../data/waveMods.js';

// Zombies spawn at the right edge of the wider WORLD_W so the player
// sees the horde approaching from the distance. The longer walk
// rewards the wider battlefield and gives sniper rifles room to
// actually reach out.
export const mkZombie = (type, opts = null) => {
  const z = ZTP[type];
  const boss = !!(opts && opts.boss);
  const hp = boss ? bossHp(opts.wave || 1) : z.hp;
  return {
    id: uid(), type, z, x: WORLD_W + 30 + rng(0, 40),
    lane: boss ? 1 : Math.floor(Math.random() * 3),
    hp, maxHp: hp,
    // Mini-boss: a named brute that walks the middle lane.
    ...(boss ? { boss: true, bossName: bossName(opts.wave || 5) } : {}),
    spd: z.spd * (0.82 + Math.random() * 0.36),
    state: 'walk', facing: -1,
    walkPhase: Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0, deadAt: 0,
    targetSolId: null, targetBarId: null,
  };
};
