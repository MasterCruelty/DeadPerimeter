import { WX } from '../constants.js';
import { mkSoldier } from './soldier.js';

export const mkGS = () => {
  const delta = mkSoldier('Delta', 'sniper', 0, 100, 0, false, true);
  delta.x = WX - 40; delta.state = 'idle';
  return {
    phase: 'menu', day: 1, wave: 1, baseHp: 300, baseMaxHp: 300,
    resources: { food: 50, ammo: 150, medicine: 12, materials: 35, sniperAmmo: 15, turretAmmo: 30 },
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
  };
};
