import { C, CW, GY, WORLD_W } from '../constants.js';

// Mission location pools, one per risk tier. Each entry describes a
// specific spot in the city around Fort Omega — the player sees a
// different mix every time the Expedition screen is opened, instead
// of "Ruined Hospital / Armory / Downtown" on repeat.
//
//   biome: drives the visual palette (see data/biomes.js).
//   loot:  pool the mission's pickup generator samples from. Listing
//          a resource twice doubles its chance. Special tokens
//          'civilian' and 'lostSoldier' enable the corresponding
//          rescue pickups.
//   desc:  flavour text shown on the destination card.
export const DEST_POOL = {
  LOW: [
    { name: 'Pharmacy',          icon: '💊', biome: 'hospital', loot: ['medicine','medicine','medicine','food'],                desc: 'Looted but not empty. Some pills survived.' },
    { name: 'Supermarket',       icon: '🛒', biome: 'downtown', loot: ['food','food','food','medicine'],                        desc: 'Shattered glass front. Half-empty shelves.' },
    { name: 'Hardware Store',    icon: '🔧', biome: 'armory',   loot: ['materials','materials','materials','ammo'],              desc: 'Tools and screws. A forgotten lunchbox.' },
    { name: 'Convenience Store', icon: '🏪', biome: 'downtown', loot: ['food','medicine','food','materials','ammo'],            desc: 'Open 24/7 — was. Power\'s been out for weeks.' },
    { name: 'Diner',             icon: '🍔', biome: 'downtown', loot: ['food','food','medicine','ammo'],                        desc: 'Walk-in freezer still cold. Worth a look.' },
  ],
  MED: [
    { name: 'Police Station',    icon: '🚓', biome: 'police_interior', loot: ['ammo','ammo','civilian','lostSoldier','materials'],      desc: 'Inside the local PD. Cells, lockers, evidence room.' },
    { name: 'Residential Block', icon: '🏢', biome: 'downtown', loot: ['civilian','medicine','materials','food','civilian'],     desc: 'Survivors barricaded on the upper floors.' },
    { name: 'Gun Shop',          icon: '🔫', biome: 'armory_interior', loot: ['ammo','ammo','sniperAmmo','turretAmmo'],                  desc: 'Inside the shop. Gun racks and glass cases — careful.' },
    { name: 'School Shelter',    icon: '🏫', biome: 'hospital', loot: ['civilian','food','medicine','civilian'],                  desc: 'Last-known evac point. People stayed behind.' },
    { name: 'Gas Station',       icon: '⛽', biome: 'downtown', loot: ['materials','ammo','food','materials'],                    desc: 'Fuel\'s gone, but the shop is mostly intact.' },
    { name: 'Clinic',            icon: '🩺', biome: 'hospital', loot: ['medicine','medicine','civilian','food'],                  desc: 'Small private clinic. Pharmacy in back.' },
  ],
  HIGH: [
    { name: 'Central Hospital',  icon: '🏥', biome: 'hospital', loot: ['medicine','medicine','civilian','lostSoldier','food'],   desc: 'Military ward inside. Massive draw for the dead.' },
    { name: 'Office Tower',      icon: '🌆', biome: 'office_interior', loot: ['sniperAmmo','materials','civilian','sniperAmmo'],         desc: 'Cleared cubicle floor. City burns through the windows.' },
    { name: 'Shopping Mall',     icon: '🛍️', biome: 'downtown', loot: ['ammo','food','materials','civilian','medicine'],          desc: 'A thousand zombies between you and the prize.' },
    { name: 'Precinct HQ',       icon: '🚔', biome: 'armory',   loot: ['ammo','sniperAmmo','lostSoldier','turretAmmo','ammo'],   desc: 'The main armory. Brute reported on-site.' },
    { name: 'Industrial Depot',  icon: '🏭', biome: 'armory',   loot: ['materials','turretAmmo','ammo','materials','lostSoldier'], desc: 'Truck yard. Heavy infected presence.' },
  ],
};

// Shared mechanical parameters per risk tier. The rolled destination
// inherits these so the auto-dispatcher and mission generator keep
// working without per-location bookkeeping.
export const RISK_BASE = {
  // solDmg = [min, max] HP loss applied to the auto-dispatch party
  // (non-playable mode). Tuned down after playtest so a MED sortie
  // doesn't routinely return soldiers at 1 HP.
  LOW:  { riskColor: '#44bb44', solDmg: [0, 10],  missionLen: 1400, zSpawn: 0.6 },
  MED:  { riskColor: C.wrn,    solDmg: [8, 22],  missionLen: 1700, zSpawn: 1.1 },
  HIGH: { riskColor: C.dng,    solDmg: [15, 40], missionLen: 2000, zSpawn: 1.7 },
};

// Pretty list of icons summarising the loot pool for the card UI.
function lootSummary(loot) {
  const seen = new Set(); const icons = [];
  for (const l of loot) {
    if (seen.has(l)) continue; seen.add(l);
    icons.push(objIcons[l] || l);
  }
  return icons.join('  ');
}

// Roll three fresh destinations, one per risk tier. The expedition
// screen invokes this every time the player re-enters the screen so
// no two sortie sessions show the same trio of locations.
export function rollDestinations() {
  const out = [];
  for (const risk of ['LOW', 'MED', 'HIGH']) {
    const pool = DEST_POOL[risk];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const base = RISK_BASE[risk];
    out.push({
      ...pick, ...base, risk,
      rewards: lootSummary(pick.loot),
    });
  }
  return out;
}

// Playable side-scrolling mission constants
export const MISSION_W = 1900;
export const MISSION_VIEW = CW;
export const MGY = GY;
export const objIcons = { medicine: '💊', ammo: '🔫', food: '🥫', materials: '🔧', sniperAmmo: '🎯', turretAmmo: '🟠', civilian: '👤', lostSoldier: '🪖' };

// Stars and skyline now span the full WORLD_W so the camera-scroll
// reveals more of the city without exposing a "wall of pixels" edge.
export const STARS = Array.from({ length: 62 }, (_, i) => ({
  x: (i * 181 + 53) % WORLD_W,
  y: (i * 97 + 17) % (GY - 80),
  r: i % 4 === 0 ? 1.3 : 0.7,
}));
export const BLDGS = [
  { x:  445, w: 72, h: 162 },
  { x:  562, w: 58, h: 138 },
  { x:  655, w: 90, h: 190 },
  { x:  775, w: 52, h: 118 },
  { x:  843, w: 62, h: 156 },
  { x:  945, w: 80, h: 178 },
  { x: 1060, w: 64, h: 132 },
  { x: 1148, w: 96, h: 204 },
  { x: 1268, w: 56, h: 150 },
  { x: 1352, w: 78, h: 188 },
  { x: 1455, w: 68, h: 124 },
  { x: 1548, w: 92, h: 168 },
  { x: 1665, w: 60, h: 144 },
  { x: 1748, w: 84, h: 196 },
  { x: 1858, w: 74, h: 156 },
];

export const RECRUIT_NAMES = [
  'Delta', 'Echo', 'Foxtrot', 'Ghost', 'Hunter', 'Iris', 'Kilo', 'Lima',
  'Mako', 'Nova', 'Oscar', 'Puma', 'Quinn', 'Recon', 'Sierra', 'Tango', 'Viper', 'Wolf',
];

// Recruit weapon pools by kind. Civilians are unschooled, so they only
// know how to handle a pistol or (rarely) a shotgun. Veterans / lost
// military soldiers are the elite — full rifle pool plus a chance at
// the sniper rifle. Standard recruits keep the original mixed pool.
export const RECRUIT_WEAPONS  = ['rifle', 'rifle', 'pistol', 'pistol', 'shotgun'];
export const CIVILIAN_WEAPONS = ['pistol', 'pistol', 'pistol', 'shotgun'];
export const VETERAN_WEAPONS  = ['rifle', 'rifle', 'rifle', 'shotgun', 'sniper'];

// Per-kind max-HP defaults. mkSoldier reads these via the helpers below.
export const KIND_HP = {
  recruit:  100,
  civilian:  70,
  veteran:  120,
};

// Trade offers from peaceful survivor camps. The player gives the
// "give" resources, receives the "get" resources. If they refuse the
// offer the camp turns hostile and a firefight starts.
export const TRADE_OFFERS = [
  { give: { food: 15 },               get: { ammo: 22 },      desc: 'food for ammo' },
  { give: { food: 12 },               get: { medicine: 7 },   desc: 'food for medicine' },
  { give: { materials: 10 },          get: { medicine: 6 },   desc: 'materials for medicine' },
  { give: { medicine: 5 },            get: { sniperAmmo: 5 }, desc: 'meds for sniper rounds' },
  { give: { ammo: 28 },               get: { materials: 14 }, desc: 'ammo for materials' },
  { give: { food: 20 },               get: { turretAmmo: 16 },desc: 'food for turret belts' },
  { give: { food: 8, materials: 6 },  get: { sniperAmmo: 7 }, desc: 'food + materials for snipers' },
  { give: { medicine: 6, ammo: 14 },  get: { turretAmmo: 22 },desc: 'medicine + ammo for turret belts' },
];

// Roll the chance of a survivor encounter on the way to the objective.
// Returns one of { type: 'hostile'|'trader', offer? } or null.
export function rollEncounter(risk) {
  const chance = risk === 'HIGH' ? 0.40 : risk === 'MED' ? 0.28 : 0;
  if (Math.random() >= chance) return null;
  if (Math.random() < 0.5) {
    return { type: 'hostile' };
  }
  const offer = TRADE_OFFERS[Math.floor(Math.random() * TRADE_OFFERS.length)];
  return { type: 'trader', offer };
}
