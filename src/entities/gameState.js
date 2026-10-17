import { WX } from '../constants.js';
import { mkSoldier } from './soldier.js';
import { mkCity } from '../data/city.js';
import { mkArmory } from './gear.js';

// Bump the right loss counter when a roster member dies. Centralised so
// each death site is one call and the civilian-vs-soldier split is in
// one place.
export const recordDeath = (gs, victim) => {
  if (!gs || !victim) return;
  if (victim.civilian) gs.civiliansLost = (gs.civiliansLost || 0) + 1;
  else gs.soldiersLost = (gs.soldiersLost || 0) + 1;
};

export const mkGS = () => {
  const delta = mkSoldier('Delta', 'sniper', 0, 100, 0, false, true);
  delta.x = WX - 40; delta.state = 'idle';
  return {
    phase: 'menu', day: 1, wave: 1, baseHp: 300, baseMaxHp: 300,
    resources: { food: 80, ammo: 150, medicine: 12, materials: 35, sniperAmmo: 15, turretAmmo: 30 },
    soldiers: [
      mkSoldier('Alpha',   'rifle',  224, 100, 0),
      mkSoldier('Bravo',   'rifle',  248, 100, 1),
      mkSoldier('Charlie', 'pistol', 272, 100, 2),
      delta,
    ],
    zombies: [], humans: [], bullets: [], effects: [], barricades: [], turrets: [], soundQ: [],
    spawnQueue: [], waveTime: 0, waveClearAt: null, waveComplete: false,
    score: 0, kills: 0, zombiesSpawned: 0, shakeTimer: 0,
    // Camera scroll for the wider WORLD_W siege view. 0 = wall on the
    // left edge (default). Player pans with arrow keys to scout.
    cameraX: 0,
    squadTarget: null, squadLane: null, selectedSoldierId: null,
    expeditionResult: null,
    isHumanWave: false,
    // Reserve roster: civilians / extras saved when the active squad is full.
    // Auto-promoted to active duty on wave clear when a slot opens up.
    // Items shape: { name, weapon, civilian, hp? }
    reserve: [],
    // Day economy / cooldowns
    expeditionsToday: 0,      // increments per dispatch; resets on wave clear
    lastEvacWave: -10,        // wave number of the last helicopter evac
    transmissionsDone: [],    // story-beat cinematic waves already shown
    pendingTransmission: null,
    lastFoodReport: null,
    lastSupplyDrop: null,     // { wave, breakdown } banner data
    usedNames: new Set(['Alpha', 'Bravo', 'Charlie', 'Delta']),
    // Workshop progression (see data/difficulty.js for recipes / nodes).
    // workbench.built unlocks the crafting panel; researchLab.built unlocks
    // the research panel. research.activeId is the currently running node
    // (null = none). research.progress counts wave-clears since start.
    workbench: { built: false },
    researchLab: { built: false },
    research: { activeId: null, progress: 0, completed: [] },
    // City map: persistent per-location state (data/city.js).
    city: mkCity(),
    // Spare guns + melee weapons (entities/gear.js).
    armory: mkArmory(),
    // End-of-run stats. startedAt is wall-clock at newGame; on save/load
    // we persist the elapsed time so closing the tab doesn't inflate it.
    startedAt: Date.now(),
    playMs: 0,
    soldiersLost: 0,
    civiliansLost: 0,
  };
};
