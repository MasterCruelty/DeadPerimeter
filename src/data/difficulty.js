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
