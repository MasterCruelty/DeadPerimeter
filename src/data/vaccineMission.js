import { C } from '../constants.js';

// Three sequential scenarios that make up the wave-30 vaccine delivery
// run. Each is consumed by mkMission as a destination, so they inherit
// the regular expedition map generator. The _vaccineSegment tag lets
// the renderer + update loop branch on which scenario is being played
// (different intro banner, biome accent, scripted events later on).
//
// Scenarios are played back-to-back — when one is won, the survivors
// carry their HP / ammo into the next. Each scenario starts with a
// checkpoint: a total party wipe (or losing the vial) offers a retry of
// that scenario, or accepting the outcome, which ends the campaign.
export const VACCINE_SCENARIOS = [
  {
    name: 'Highway 17 — Convoy',
    icon: '🛣️',
    biome: 'downtown',
    loot: ['ammo', 'ammo', 'medicine'],
    desc: 'Push down the on-ramp to the city. Walkers everywhere — keep moving.',
    risk: 'MED', riskColor: C.wrn, missionLen: 1700, zSpawn: 1.3,
    solDmg: [0, 0],
    rewards: '🔫  💊',
    _vaccineSegment: 'highway',
  },
  {
    name: 'Central Hospital — Vault',
    icon: '🏥',
    biome: 'hospital',
    loot: ['medicine', 'medicine', 'ammo'],
    desc: 'The vaccine sample is in cold storage. Get in, grab it, get out.',
    risk: 'HIGH', riskColor: C.dng, missionLen: 2000, zSpawn: 1.6,
    solDmg: [0, 0],
    rewards: '💉  💊',
    _vaccineSegment: 'hospital',
  },
  {
    name: 'Rooftop Evac — LZ Bravo',
    icon: '🚁',
    biome: 'office_interior',
    loot: ['ammo'],
    desc: 'Hold the rooftop. The chopper is 90 seconds out. Something big is climbing the stairs.',
    risk: 'HIGH', riskColor: C.dng, missionLen: 2000, zSpawn: 1.8,
    solDmg: [0, 0],
    rewards: '🚁',
    _vaccineSegment: 'rooftop',
  },
];
