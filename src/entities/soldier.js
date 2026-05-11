import { uid, WX } from '../constants.js';
import { WPN } from '../data/weapons.js';

export const mkSoldier = (name, weapon, destX, hp = 100, lane = 0, civilian = false, onRoof = false) => {
  const w = WPN[weapon];
  return {
    id: uid(), name, weapon, destX, lane, x: WX + 20, hp, maxHp: 100,
    ammo: 0, maxAmmo: w.ammo, state: 'walk', facing: 1, civilian, onRoof,
    lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0, recoil: 0,
    walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0, reloadTriggered: false,
    onExpedition: false,
  };
};
