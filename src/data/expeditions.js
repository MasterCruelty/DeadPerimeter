import { C, CW, GY } from '../constants.js';

export const EXPEDITION_DESTS = [
  {
    name: 'Ruined Hospital', icon: '🏥', risk: 'LOW', riskColor: '#44bb44',
    desc: 'Scout nearby clinic ruins. Low zombie density.',
    rewards: 'Medicine +15–25, food +10–18, chance of civilian',
    solDmg: [0, 14],
    missionLen: 1400, zSpawn: 0.6,
  },
  {
    name: 'Armory Cache', icon: '🔫', risk: 'MED', riskColor: C.wrn,
    desc: 'Raid an overrun armory depot. Heavy resistance.',
    rewards: 'Ammo +20–40, materials +5–12, chance of civilian',
    solDmg: [10, 34],
    missionLen: 1700, zSpawn: 1.1,
  },
  {
    name: 'Downtown Core', icon: '🏙️', risk: 'HIGH', riskColor: C.dng,
    desc: 'Dangerous run into the city center. Maximum reward.',
    rewards: 'All resources + materials, civilian guaranteed',
    solDmg: [20, 58],
    missionLen: 2000, zSpawn: 1.7,
  },
];

// Playable side-scrolling mission constants
export const MISSION_W = 1900;
export const MISSION_VIEW = CW;
export const MGY = GY;
export const objIcons = { medicine: '💊', ammo: '🔫', food: '🥫', materials: '🔧', sniperAmmo: '🎯', turretAmmo: '🟠', civilian: '👤' };

export const STARS = Array.from({ length: 28 }, (_, i) => ({
  x: (i * 181 + 53) % CW,
  y: (i * 97 + 17) % (GY - 80),
  r: i % 4 === 0 ? 1.3 : 0.7,
}));
export const BLDGS = [
  { x: 445, w: 72, h: 162 },
  { x: 562, w: 58, h: 138 },
  { x: 655, w: 90, h: 190 },
  { x: 775, w: 52, h: 118 },
  { x: 843, w: 62, h: 156 },
];

export const RECRUIT_NAMES = [
  'Delta', 'Echo', 'Foxtrot', 'Ghost', 'Hunter', 'Iris', 'Kilo', 'Lima',
  'Mako', 'Nova', 'Oscar', 'Puma', 'Quinn', 'Recon', 'Sierra', 'Tango', 'Viper', 'Wolf',
];
export const RECRUIT_WEAPONS = ['rifle', 'rifle', 'pistol', 'pistol', 'shotgun'];
