import { uid, WX } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { KIND_HP } from '../data/expeditions.js';

// mkSoldier(name, weapon, destX, hp?, lane?, civilian?, onRoof?, opts?)
//   opts = { veteran?: bool }
// HP cap depends on the kind: civilians 70, veterans 120, recruits 100.
// hp defaults to that cap when not explicitly passed.
export const mkSoldier = (name, weapon, destX, hp, lane = 0, civilian = false, onRoof = false, opts = {}) => {
  const w = WPN[weapon];
  const veteran = !!opts.veteran;
  const kind = civilian ? 'civilian' : veteran ? 'veteran' : 'recruit';
  const maxHp = KIND_HP[kind];
  const startHp = (typeof hp === 'number' ? hp : maxHp);
  return {
    id: uid(), name, weapon, destX, lane, x: WX + 20,
    hp: startHp, maxHp,
    kind,
    ammo: 0, maxAmmo: w.ammo, state: 'walk', facing: 1,
    civilian, veteran, onRoof,
    lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0, recoil: 0,
    walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0, reloadTriggered: false,
    onExpedition: false,
  };
};
