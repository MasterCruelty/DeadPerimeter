// Configurable wave-difficulty curve. Tweak these to make the game
// easier / harder without touching update or wave logic.
//
// mkWave(n) builds a spawn queue based on these multipliers. mkHumanWave
// scales the same way for hostile-human waves.

export const DIFFICULTY = {
  // Zombie counts per wave n
  walkerBase: 5,     // walkers spawned even at wave 1
  walkerPerWave: 3,  // extra walkers per subsequent wave
  runnerFromWave: 2, // runners start showing up at this wave
  runnerPerWave: 2,
  tankFromWave: 4,   // tanks start at this wave
  tankPerWave: 1,    // extra tank per wave beyond tankFromWave

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
  missionGoalKillRatio: 0.60,       // must have killed >= 60% of activated zombies
                                    // before the goal becomes reachable

  // Reserve / contingent
  maxActiveSoldiers: 6,             // dispatched to Fort Omega at any one time
  maxReserveSoldiers: 10,           // bench size (extras beyond this are discarded)
};

