import { C } from '../constants.js';

export const ZTP = {
  walker: { hp: 60,  spd: 0.55, dmg: 6,  sc: C.zsk, cc: C.zcl },
  runner: { hp: 35,  spd: 1.30, dmg: 4,  sc: C.rsk, cc: C.rcl },
  tank:   { hp: 220, spd: 0.28, dmg: 18, sc: C.tsk, cc: C.tcl },
  // Mission-only end-of-stage boss for HIGH-risk runs.
  brute:  { hp: 600, spd: 0.40, dmg: 30, sc: '#3a4632', cc: '#0a1208' },
  // Mission-only ranged zombie. Stops at "spitRange" and lobs an acid
  // projectile at the closest party member every spitRate ms.
  // Base values are the late-game baseline. mkMission spawns spitters
  // with per-instance _spitDmg / _spitRate overrides so early waves
  // get gentler stats; from wave ~13 onward the base values apply.
  spitter:{ hp: 80,  spd: 0.50, dmg: 4,  sc: '#4d8040', cc: '#1f3818',
           ranged: true, spitRange: 240, spitRate: 1500, spitSpd: 6 },
};
