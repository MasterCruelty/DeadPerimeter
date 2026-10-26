// Gear helpers shared by the siege, sorties and the armory UI.
import { MELEE, meleeOf, WPN, wbase } from '../data/weapons.js';
import { getSoldierPerkEffect } from '../data/difficulty.js';

// Stamina: melee swings (and jumps on sorties) cost it, it recovers
// over time. A winded soldier swings much slower. Endurance skill
// raises both the pool and the recovery.
export const SWING_COST = 12, JUMP_COST = 18;
export const maxStam = sol => 100 * getSoldierPerkEffect(sol, 'stamMul', 1) * (sol.stamMul || 1);
export function tickStam(sol, dt) {
  const mx = maxStam(sol);
  sol.stam = Math.min(mx, (sol.stam ?? mx) + 0.022 * dt * getSoldierPerkEffect(sol, 'stamMul', 1));
}
export function spendStam(sol, n) {
  const mx = maxStam(sol), cur = sol.stam ?? mx;
  if (cur < n) return false;
  sol.stam = cur - n;
  return true;
}
export const winded = sol => (sol.stam ?? maxStam(sol)) < SWING_COST;

// Damage / cadence of the soldier's melee weapon (knife fallback).
export function meleeStats(sol) {
  const type = meleeOf(sol), M = MELEE[type];
  return { type, rate: M.rate * (winded(sol) ? 1.8 : 1), dmg: Math.round(M.dmg * getSoldierPerkEffect(sol, 'meleeMul', 1)) };
}

// One hit's worth of wear. Returns the weapon type if it just broke.
export function wearMelee(sol) {
  if (!sol) return null;
  spendStam(sol, SWING_COST);
  if (!sol.melee) return null;
  sol.melee.dur -= getSoldierPerkEffect(sol, 'wearMul', 1);
  if (sol.melee.dur > 0) return null;
  const t = sol.melee.type; sol.melee = null;
  return t;
}

// Magazine size for a soldier holding gun `w` (Extended Mag perk on
// rifles / pistols).
export const magSize = (sol, w) =>
  WPN[w].ammo + ((sol && sol.upgrades && sol.upgrades.extMag && ['rifle', 'pistol'].includes(wbase(w))) ? 10 : 0);

// Fort armory: spare guns (counts) and melee weapons (with wear).
export const mkArmory = () => ({ guns: {}, melee: [] });
export function ensureArmory(gs) {
  if (!gs.armory) gs.armory = mkArmory();
  if (!gs.armory.guns) gs.armory.guns = {};
  if (!Array.isArray(gs.armory.melee)) gs.armory.melee = [];
  return gs.armory;
}
export function stashGear(gs, item) {
  const a = ensureArmory(gs);
  if (item.kind === 'gun') a.guns[item.w] = (a.guns[item.w] || 0) + 1;
  else a.melee.push({ type: item.type, dur: item.dur ?? MELEE[item.type].dur });
}
export const gearName = item => item.kind === 'gun' ? WPN[item.w].name : MELEE[item.type].name;
export const gearIcon = item => item.kind === 'gun' ? '🔫' : MELEE[item.type].icon;
