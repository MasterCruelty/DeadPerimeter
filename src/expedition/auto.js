import { rng } from '../constants.js';
import { RECRUIT_NAMES, CIVILIAN_WEAPONS, VETERAN_WEAPONS, KIND_HP } from '../data/expeditions.js';
import { WPN } from '../data/weapons.js';

// Chance of finding a lost military soldier instead of a civilian on a
// successful expedition. LOW destinations never yield veterans (just
// civilians), MED has a small chance, HIGH a real chance.
const VETERAN_CHANCE = { LOW: 0, MED: 0.12, HIGH: 0.25 };

// Auto-resolve odds are now skill-based rather than pure RNG.
//   threshold = base + hp_bonus + weapon_bonus + ammo_bonus
// A healthy, well-armed, full-mag soldier gets up to +0.35 to the
// success threshold; a near-dead, dry, knife-only soldier loses up to
// 0.18. KIA outcome is also clamped so a well-prepared run is rarely
// a coin-flip death sentence.
export function resolveExpedition(soldier, dest, gs) {
  const baseDmg = rng(dest.solDmg[0], dest.solDmg[1]);
  const roll = Math.random();
  const base = dest.risk === 'LOW' ? 0.80 : dest.risk === 'MED' ? 0.60 : 0.40;

  const hpBonus     = (soldier.hp / soldier.maxHp - 0.5) * 0.20;       // -0.10 .. +0.10
  const weaponBonus = (WPN[soldier.weapon]?.dmg || 14) / 60 * 0.15;    //  +0.04 .. +0.15
  const ammoBonus   = Math.min(1, (soldier.ammo || 0) / Math.max(1, soldier.maxAmmo)) * 0.10;

  const threshold = Math.max(0.10, Math.min(0.97, base + hpBonus + weaponBonus + ammoBonus));
  // Cap the KIA probability based on preparation. With a full kit and a
  // healthy soldier the chance of death is at most ~15% even on HIGH.
  const kiaCap = Math.max(0.10, Math.min(0.50, 1 - threshold - 0.15));

  // Damage scales down a touch for healthier / better-armed soldiers.
  const prep = (hpBonus + weaponBonus + ammoBonus) / 0.35;             // 0..1
  const dmg = Math.max(1, Math.round(baseDmg * (1 - prep * 0.30)));

  // Reward tables now also drop turretAmmo on MED / HIGH runs since the
  // dedicated MG-ammo pool can't be replenished from regular ammo crates.
  let outcome, reward = {}, recruit = null;
  if (roll < threshold) {
    outcome = 'success';
    if (dest.risk === 'LOW') { reward.medicine = rng(15, 25); reward.food = rng(10, 18); }
    else if (dest.risk === 'MED') { reward.ammo = rng(20, 40); reward.materials = rng(5, 12); reward.sniperAmmo = rng(2, 5); reward.turretAmmo = rng(8, 18); }
    else { reward.ammo = rng(15, 25); reward.medicine = rng(8, 15); reward.food = rng(10, 20); reward.materials = rng(8, 18); reward.sniperAmmo = rng(4, 8); reward.turretAmmo = rng(12, 25); }
    const availNames = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (availNames.length > 0) {
      const isVeteran = Math.random() < (VETERAN_CHANCE[dest.risk] || 0);
      const pool = isVeteran ? VETERAN_WEAPONS : CIVILIAN_WEAPONS;
      const name = availNames[Math.floor(Math.random() * availNames.length)];
      const weapon = pool[Math.floor(Math.random() * pool.length)];
      const cap = isVeteran ? KIND_HP.veteran : KIND_HP.civilian;
      // Wounded on rescue — HP scales with kind cap so veterans
      // come back tougher than civilians.
      const baseHp = isVeteran ? rng(70, cap - 10) : rng(35, cap - 10);
      recruit = {
        name, weapon, hp: baseHp,
        civilian: !isVeteran, veteran: isVeteran,
      };
      gs.usedNames.add(name);
    }
  } else {
    // "Failure" zone — split between injured and KIA, with the KIA share
    // capped by the soldier's preparation.
    const failRoll = (roll - threshold) / Math.max(1e-6, 1 - threshold);
    outcome = failRoll < (1 - kiaCap) ? 'injured' : 'kia';
  }
  soldier.hp = Math.max(1, soldier.hp - dmg);
  if (outcome === 'kia') { soldier.hp = 0; soldier.state = 'dead'; }
  return { soldierName: soldier.name, destName: dest.name, outcome, reward, recruit, dmgTaken: dmg };
}

// Multi-soldier auto-dispatch.
// Every soldier rolls their own outcome and damage. Rewards are merged
// with a diminishing-returns multiplier (BALANCE.partyRewardDiminish ^ i),
// so a 2-soldier party gets the first soldier's roll + 80% of the second
// soldier's, and a 3-soldier party gets +64% of the third. The "best"
// outcome is reported (a soldier coming back alive saves the mission).
import { BALANCE } from '../data/difficulty.js';

export function resolvePartyExpedition(soldiers, dest, gs) {
  const perSoldier = soldiers.map(s => resolveExpedition(s, dest, gs));
  const reward = {};
  perSoldier.forEach((r, i) => {
    const mul = Math.pow(BALANCE.partyRewardDiminish, i);
    for (const [k, v] of Object.entries(r.reward || {})) {
      reward[k] = (reward[k] || 0) + Math.round(v * mul);
    }
  });
  const order = { success: 0, injured: 1, kia: 2 };
  const best = perSoldier.reduce((a, b) => order[a.outcome] <= order[b.outcome] ? a : b);
  // At most one recruit even with a full party.
  const recruit = perSoldier.find(r => r.recruit)?.recruit || null;
  return {
    party: perSoldier,
    soldierNames: soldiers.map(s => s.name),
    destName: dest.name,
    outcome: best.outcome,
    reward,
    recruit,
    dmgTaken: perSoldier.reduce((sum, r) => sum + r.dmgTaken, 0),
    kiaNames: perSoldier.filter(r => r.outcome === 'kia').map(r => r.soldierName),
  };
}
