import { skillEffect } from './progression.js';
// Configurable wave-difficulty curve. Tweak these to make the game
// easier / harder without touching update or wave logic.
//
// mkWave(n) builds a spawn queue based on these multipliers. mkHumanWave
// scales the same way for hostile-human waves.

export const DIFFICULTY = {
  // Zombie counts per wave n
  walkerBase: 5,     // walkers spawned even at wave 1
  walkerPerWave: 1.5,  // extra walkers per subsequent wave
  runnerFromWave: 5, // runners start showing up at this wave
  runnerPerWave: 1.5,
  tankFromWave: 10,   // tanks start at this wave 
  tankPerWave: 0.5,  // extra tank every two waves beyond tankFromWave

  // Spawn cadence (ms between successive spawns)
  walkerCadence: 1700,
  runnerCadence: 950,
  tankCadence: 4000,

  // Human waves
  humanBase: 6,
  humanPerHumanWave: 3,
  humanCadence: 1500,
  humanGunmanRatio: 0.4, // 40 % gunmen, 60 % knifemen
};

// Balance knobs touched by Batch A (gameplay tuning, May 2026).
export const BALANCE = {
  // Barricades
  maxBarricades: 6,                 // hard cap. Was 2, label said 4.
  barricadeReflectDmg: 6,           // dmg dealt back to a melee attacker on hit
  behindBarricadeDmgMul: 0.20,      // a soldier shielded by a barricade in the same
                                    // lane takes only 30% of the incoming melee dmg

  // Mission (playable expedition)
  missionActivationRange: 700,      // zombies wake up earlier so you can't sprint past
  missionGoalKillRatio: 0.45,       // must have killed >= 45% of activated zombies
                                    // before the goal becomes reachable (down from
                                    // 60% so the player can skip the last stragglers
                                    // if they're badly outnumbered)

  // Reserve / contingent
  maxActiveSoldiers: 10,             // dispatched to Fort Omega at any one time
  maxReserveSoldiers: 20,           // bench size (extras beyond this are discarded)

  // Expeditions. Sorties only go out on a sortie day: the first after
  // wave 1 (the survivors' first job needs one), then every 3 waves —
  // the command center before waves 2, 5, 8 ... 29. The other days are
  // for management (and trade with the Compact).
  sortieEvery: 3,
  firstSortieAfterWave: 1,
  expeditionsPerDay: 3,             // sortie slots on a sortie day (radio room +1)
  maxExpeditionParty: 5,            // soldiers per playable sortie (lead + up to 2 AI followers)

  // Turrets (machine-gun fixed emplacements)
  maxTurrets: 3,
  turretCostMaterials: 25,
  turretCostAmmo: 20,
  turretRate: 220,                  // ms between shots
  turretDmg: 30,
  turretRange: 350,

  // Helicopter civilian evac
  evacMinReserve: 3,                // need at least this many civs to call evac
  evacWaveCooldown: 3,              // cool-down in waves between calls
  evacFoodPerCiv: 35,
  evacMedicinePerCiv: 6,
  evacSniperAmmoPerCiv: 2,
  evacMaterialsPerCiv: 8,

  // Civilian volunteers for sorties (asked only when the fort is short
  // of men; see update/volunteers.js)
  volunteerMinAble: 2,              // ASK FOR VOLUNTEERS shows below this many sortie-able people
  volunteerAimJitter: 6,            // sortie shots leave up to ±6 px off their depth (hit window ±13)
  volunteerStamMul: 0.8,            // less stamina on sorties

  // Story / endgame
  maxWaves: 30,                     // wave 30 = mega-wave + extraction finale
  megaWaveMultiplier: 2.5,          // wave 30 zombie counts scaled by this

  // Daily food consumption (deducted at the start of each management phase
  // after a wave clear, except after wave 1 which is the tutorial).
  foodPerPersonPerDay: 5,
  starveDmg: 15,                    // hp lost by anyone who didn't eat

  // Wall repair (manual, from the command center)
  wallRepairCost: 8,                // materials per repair tick
  wallRepairHp: 30,                 // hp restored per tick

  // Per-wave clear bonuses. Food is intentionally 0 — daily rations
  // come from expedition food runs and helicopter evac payouts, not
  // from holding the wall. The ammo resupply covers about half of what
  // a wave burns (measured ~25 rounds early, 50–75 by wave 8–13), so
  // staying home drains the stash and sorties are where ammo comes from.
  waveClearAmmo: 15,
  waveClearAmmoPerWave: 2,
  waveClearAmmoMax: 60,
  waveClearSniperAmmo: 2,           // Delta's 15 starting rounds lasted ~3 waves
  waveClearFood: 0,
  // Days without sorties: Command's convoy on top of the wave-clear
  // ammo, so the two days between sortie days aren't pure drain. Still
  // less than a wave burns: the stash grows on sortie days.
  quietDayAmmoMul: 0.5,             // x waveClearAmmoFor
  quietDayFood: 15,
  quietDayMaterials: 10,

  // Per-sortie fatigue: each surviving party member eats this much
  // food when they return from an expedition (lunch on the road,
  // post-action calories). Counters the food-inflation problem where
  // the stash kept growing because expeditions only added food but
  // never spent it.
  sortieFoodCostPerSoldier: 3,

  // Workshop / Research lab one-time build costs.
  workbenchCost:    { materials: 30 },
  researchLabCost:  { materials: 50, medicine: 5 },
};

// Ammo issued on clearing wave `wave`.
export const waveClearAmmoFor = wave =>
  Math.min(BALANCE.waveClearAmmoMax, BALANCE.waveClearAmmo + BALANCE.waveClearAmmoPerWave * wave);

// Is the command center before wave `wave` a sortie day?
export const isSortieWave = wave => {
  const k = wave - 1 - BALANCE.firstSortieAfterWave;
  return k >= 0 && k % BALANCE.sortieEvery === 0;
};
// The next wave (from `wave` on) whose command center is a sortie day;
// past maxWaves when there is none left.
export const nextSortieWave = wave => {
  let w = Math.max(1, wave);
  while (!isSortieWave(w)) w++;
  return w;
};

// Craft recipes — material conversion at the workbench. Each recipe
// is "one click" and consumes the cost / produces the output. The
// 'craftMultiplier' research bumps every output by 1.5×.
export const CRAFT_RECIPES = [
  { id: 'rifleMag',   icon: '🔫', name: 'Rifle mag',    cost: { materials: 4 }, output: { ammo:       30 } },
  { id: 'pistolMag',  icon: '🔫', name: 'Pistol mag',   cost: { materials: 2 }, output: { ammo:       15 } },
  { id: 'sniperBox',  icon: '🎯', name: 'Sniper rounds', cost: { materials: 8 }, output: { sniperAmmo:  5 } },
  { id: 'turretBelt', icon: '🟠', name: 'Turret belt',  cost: { materials: 3 }, output: { turretAmmo: 15 } },
  { id: 'firstAid',   icon: '💊', name: 'First aid',    cost: { materials: 6 }, output: { medicine:    3 } },
  // Melee weapons go to the armory (entities/gear.js).
  { id: 'bat',        icon: '🏏', name: 'Nail bat',     cost: { materials: 6 },  melee: 'bat' },
  { id: 'machete',    icon: '🗡', name: 'Machete',      cost: { materials: 10 }, melee: 'machete' },
  { id: 'axe',        icon: '🪓', name: 'Fire axe',     cost: { materials: 14 }, melee: 'axe' },
];

// Research nodes — each is one-shot, takes `waves` wave clears to
// complete (auto-progress on each gs.wave++ tick), costs are
// deducted on START. effects {} is applied globally via
// getResearchEffect() lookups across the codebase.
//
// Only one research can be active at a time so the player has to
// choose what to prioritise. Completed researches are persisted in
// gs.research.completed (set of id strings).
export const RESEARCHES = [
  {
    id: 'improvedMags', name: 'Improved Magazines',
    desc: 'Crafted rounds: +50% output per recipe.',
    cost: { materials: 20 }, waves: 3,
    effects: { craftMultiplier: 1.5 },
  },
  {
    id: 'reinforcedWalls', name: 'Reinforced Walls',
    desc: 'Wall +50 HP, repair restores +20 HP per tick.',
    cost: { materials: 25, medicine: 3 }, waves: 4,
    effects: { baseHpBonus: 50, wallRepairBonus: 20 },
  },
  {
    id: 'combatDrills', name: 'Combat Drills',
    desc: 'All soldiers deal +20% damage.',
    cost: { materials: 15, food: 10 }, waves: 5,
    effects: { soldierDamageMul: 1.20 },
  },
  {
    id: 'fieldMedicine', name: 'Field Medicine',
    desc: 'Medicine heals 2× HP per use.',
    cost: { materials: 20, medicine: 8 }, waves: 4,
    effects: { medicineMul: 2 },
  },
  {
    id: 'apRounds', name: 'Armor-Piercing Rounds',
    desc: 'Rifle deals 1.5× damage to Tanks.',
    cost: { materials: 30 }, waves: 6,
    effects: { rifleVsTankMul: 1.5 },
  },
  {
    id: 'marksmanship', name: 'Marksmanship',
    desc: 'Sniper range +200 px.',
    cost: { materials: 25, sniperAmmo: 5 }, waves: 5,
    effects: { sniperRangeBonus: 200 },
  },
  {
    id: 'reloadDrills', name: 'Reload Drills',
    desc: 'All reload times −30%.',
    cost: { materials: 18 }, waves: 4,
    effects: { reloadMul: 0.70 },
  },
];

// Per-soldier weapon perks. Bought at the workbench (requires
// `gs.workbench.built`). Each soldier has a sparse `upgrades` map of
// id → true. `weapons: 'all'` perks fit any soldier; otherwise the
// listed weapon keys gate the buy button. Costs are paid once.
//
// One-shot effects (maxHp / maxAmmo bumps) are applied at purchase
// time directly on the soldier. Per-shot multipliers (damageMul,
// reloadMul) are read from the perk table at fire / reload time.
export const PERKS = [
  { id: 'vest',        name: 'Ballistic Vest', icon: '🦺', cost: { materials: 20 }, weapons: 'all',
    desc: '+30 max HP and patches up to the new cap.', maxHpBonus: 30 },
  { id: 'extMag',      name: 'Extended Mag',   icon: '📦', cost: { materials: 12 }, weapons: ['rifle', 'pistol'],
    desc: '+10 rounds per magazine.',                  maxAmmoBonus: 10 },
  { id: 'heavyBarrel', name: 'Heavy Barrel',   icon: '⚙', cost: { materials: 18 }, weapons: ['rifle'],
    desc: '+25% damage.',                              damageMul: 1.25 },
  { id: 'hollowPts',   name: 'Hollow Points',  icon: '🔴', cost: { materials: 14 }, weapons: ['pistol'],
    desc: '+30% damage.',                              damageMul: 1.30 },
  { id: 'bipod',       name: 'Bipod',          icon: '🦿', cost: { materials: 20, sniperAmmo: 3 }, weapons: ['sniper'],
    desc: '+150 range.',                               rangeBonus: 150 },
  { id: 'matchAmmo',   name: 'Match Ammo',     icon: '🎯', cost: { materials: 18, sniperAmmo: 5 }, weapons: ['sniper'],
    desc: '+40% damage.',                              damageMul: 1.40 },
  { id: 'quickReload', name: 'Quick Reload',   icon: '⚡', cost: { materials: 15 }, weapons: 'all',
    desc: '−25% reload time.',                         reloadMul: 0.75 },
];

// Aggregate a per-soldier perk effect. Multipliers (keys ending in
// 'Mul') compound; bonuses add. Used by siege.js at fire / reload time.
export function getSoldierPerkEffect(sol, key, defaultValue) {
  // Skill ranks (data/progression.js) stack on top of the perks.
  const owned = (sol && sol.upgrades) || null;
  if (!owned) return skillEffect(sol, key, defaultValue);
  let v = defaultValue;
  for (const p of PERKS) {
    if (!owned[p.id]) continue;
    if (!(key in p)) continue;
    if (key.endsWith('Mul')) v *= p[key];
    else v += p[key];
  }
  return skillEffect(sol, key, v);
}

// Helper: read the active research-effect value for a given key,
// returning the supplied default if no completed research touches it.
// `gs.research.completed` is the source of truth (array of ids).
export function getResearchEffect(gs, key, defaultValue) {
  const completed = (gs && gs.research && gs.research.completed) || [];
  let v = defaultValue;
  for (const id of completed) {
    const r = RESEARCHES.find(r => r.id === id);
    if (!r || !r.effects || !(key in r.effects)) continue;
    // Multipliers compound; bonuses add. Heuristic: keys ending in
    // 'Mul' compound multiplicatively, everything else adds.
    if (key.endsWith('Mul') || key.endsWith('Multiplier')) v *= r.effects[key];
    else v += r.effects[key];
  }
  return v;
}

