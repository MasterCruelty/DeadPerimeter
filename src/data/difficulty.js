// Configurable wave-difficulty curve. Tweak these to make the game
// easier / harder without touching update or wave logic.
//
// mkWave(n) builds a spawn queue based on these multipliers. mkHumanWave
// scales the same way for hostile-human waves.

export const DIFFICULTY = {
  // Zombie counts per wave n
  walkerBase: 5,     // walkers spawned even at wave 1
  walkerPerWave: 2,  // extra walkers per subsequent wave
  runnerFromWave: 2, // runners start showing up at this wave
  runnerPerWave: 1.5,
  tankFromWave: 6,   // tanks start at this wave (was 4)
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
  maxBarricades: 4,                 // hard cap. Was 2, label said 4.
  barricadeReflectDmg: 4,           // dmg dealt back to a melee attacker on hit
  behindBarricadeDmgMul: 0.30,      // a soldier shielded by a barricade in the same
                                    // lane takes only 30% of the incoming melee dmg

  // Mission (playable expedition)
  missionActivationRange: 700,      // zombies wake up earlier so you can't sprint past
  missionGoalKillRatio: 0.45,       // must have killed >= 45% of activated zombies
                                    // before the goal becomes reachable (down from
                                    // 60% so the player can skip the last stragglers
                                    // if they're badly outnumbered)

  // Reserve / contingent
  maxActiveSoldiers: 6,             // dispatched to Fort Omega at any one time
  maxReserveSoldiers: 10,           // bench size (extras beyond this are discarded)

  // Expeditions
  expeditionsPerDay: 2,             // max sorties before the next wave (= one day)
  maxExpeditionParty: 3,            // soldiers per auto-dispatch run (playable still 1)
  partyRewardDiminish: 0.80,        // 2nd soldier contributes 80%, 3rd 64% to rewards

  // Turrets (machine-gun fixed emplacements)
  maxTurrets: 2,
  turretCostMaterials: 25,
  turretCostAmmo: 20,
  turretRate: 220,                  // ms between shots
  turretDmg: 8,
  turretRange: 450,

  // Helicopter civilian evac
  evacMinReserve: 3,                // need at least this many civs to call evac
  evacWaveCooldown: 3,              // cool-down in waves between calls
  evacFoodPerCiv: 35,
  evacMedicinePerCiv: 6,
  evacSniperAmmoPerCiv: 2,
  evacMaterialsPerCiv: 8,

  // Story / endgame
  maxWaves: 30,                     // wave 30 = mega-wave + extraction finale
  megaWaveMultiplier: 2.5,          // wave 30 zombie counts scaled by this

  // Daily food consumption (deducted at the start of each management phase
  // after a wave clear, except after wave 1 which is the tutorial).
  foodPerPersonPerDay: 2,
  starveDmg: 15,                    // hp lost by anyone who didn't eat

  // Wall repair (manual, from the command center)
  wallRepairCost: 8,                // materials per repair tick
  wallRepairHp: 30,                 // hp restored per tick

  // Per-wave clear bonuses. Food is intentionally 0 — daily rations
  // come from expedition food runs and helicopter evac payouts, not
  // from holding the wall. Ammo bonus stays so combat stays sustainable.
  waveClearAmmo: 25,
  waveClearFood: 0,
};

