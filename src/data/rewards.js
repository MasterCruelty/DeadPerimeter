// Reward model for sorties.
//
// Every resource has a shadow price in "materials", taken from the
// workbench recipes (the only exchange rate in the game: 4 materials
// -> 30 ammo, 3 -> 15 turret rounds, 8 -> 5 sniper rounds). Medicine
// is priced by what it buys: a heal is 5 medicine for 40 HP, and a
// fresh 100 HP recruit costs ~25 materials-worth, so 1 medicine ~ 1.
// Food has no recipe; 0.5 reflects its daily, bounded demand.
//
// Pickup quantities are sized so EVERY pickup is worth about the same
// (~4 materials). The choice between places is then about what the fort
// needs (ammo, food, medicine...), not about one loot table quietly
// being worth 5x another. On top of that:
//   valueMul  — risk premium (infestation) and distance premium (travel),
//               set per destination by data/city.js
//   depthMul  — deeper into the street pays more, so "push on or head
//               back to the van" is a real stopping decision
//   waveMul   — scarcity grows with the days
//   lockedMul — loot behind a barricade or in a side room (time + noise + risk)
import { rng } from '../constants.js';

export const PRICE = { ammo: 4 / 30, turretAmmo: 3 / 15, sniperAmmo: 8 / 5, medicine: 1, materials: 1, food: 0.5 };

// Base quantity ranges (~4 materials-worth per pickup, ~2 per container).
export const PICKUP_QTY = { ammo: [22, 38], turretAmmo: [16, 26], sniperAmmo: [2, 3], medicine: [3, 5], materials: [3, 5], food: [6, 10] };
export const BOX_QTY = { ammo: [11, 19], turretAmmo: [8, 13], sniperAmmo: [1, 2], medicine: [1, 3], materials: [2, 3], food: [3, 5] };

export const LOCKED_MUL = 1.5;
export const waveMul = wave => Math.min(1.8, 1 + 0.03 * Math.max(0, wave - 1));
export const depthMul = (x, W) => 0.8 + 0.5 * Math.max(0, Math.min(1, x / W));

// Risk + distance premium for a city destination.
export const destValueMul = (infest, travel) => (0.75 + 0.6 * infest) * (1 + 0.06 * Math.max(0, travel - 1));

export function pickupValue(type, { wave = 1, x = 0, W = 1900, mul = 1 } = {}) {
  const [lo, hi] = PICKUP_QTY[type] || [1, 3];
  return Math.max(1, Math.round(rng(lo, hi) * waveMul(wave) * depthMul(x, W) * mul));
}

export function boxValue(type, { wave = 1, mul = 1 } = {}) {
  const [lo, hi] = BOX_QTY[type] || [1, 3];
  return Math.max(1, Math.round(rng(lo, hi) * waveMul(wave) * mul));
}

// Materials-equivalent of a bundle { ammo: 30, food: 8, ... }.
export const bundleValue = b => Object.entries(b || {}).reduce((s, [k, v]) => s + (PRICE[k] || 0) * (v || 0), 0);
