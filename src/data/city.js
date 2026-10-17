// The city around Fort Omega: fixed locations on a map instead of
// three random destination cards. Each location keeps persistent state
// in gs.city (saved):
//
//   discovered  shown on the map (the rest are "?" until you scout
//               a neighbouring place)
//   infest      0..1.2 — how many dead roam there. Grows a little every
//               day, drops when you thin the herd. Drives the risk tier.
//   loot        0..1 — what's left to scavenge. Drops with what you
//               take, restocks slowly (other scavengers, deliveries).
//   visits / lastDay, and today's condition + side objective.
//
// Sorties to a city location are EXPLORE missions (update/cityMission.js):
// a longer street with buildings to enter, persistent layout (seeded per
// location), and you leave whenever you walk back to the van.
import { C } from '../constants.js';
import { rollMissionExtras } from './missionExtras.js';

export const MAP_W = 860, MAP_H = 420;
export const FORT_POS = { x: 74, y: 352 };

export const DISTRICTS = [
  { id: 'oldtown',  name: 'OLD TOWN',       x: 150, y: 240, w: 230, h: 165, tint: 'rgba(120,150,90,0.10)' },
  { id: 'market',   name: 'MARKET',         x: 390, y: 270, w: 190, h: 140, tint: 'rgba(170,140,70,0.10)' },
  { id: 'civic',    name: 'CIVIC CENTER',   x: 360, y: 60,  w: 260, h: 190, tint: 'rgba(90,120,170,0.10)' },
  { id: 'medical',  name: 'MEDICAL HILL',   x: 630, y: 40,  w: 210, h: 150, tint: 'rgba(110,170,190,0.10)' },
  { id: 'industry', name: 'INDUSTRIAL',     x: 600, y: 230, w: 240, h: 175, tint: 'rgba(170,90,70,0.10)' },
];

// street: outdoor biome of the approach. interiors: building interiors
// you can walk into. size: S/M/L street length. tier: starting danger.
export const LOCATIONS = [
  { id: 'conv',     name: 'Convenience Store', icon: '🏪', district: 'oldtown', x: 190, y: 360, tier: 'LOW',  size: 'S', street: 'downtown', interiors: ['office_interior'],                     loot: ['food', 'medicine', 'food', 'materials', 'ammo'], desc: 'Open 24/7 — was. Power\'s been out for weeks.' },
  { id: 'diner',    name: 'Diner',             icon: '🍔', district: 'oldtown', x: 250, y: 300, tier: 'LOW',  size: 'S', street: 'downtown', interiors: ['office_interior'],                     loot: ['food', 'food', 'medicine', 'ammo'], desc: 'Walk-in freezer still cold. Worth a look.' },
  { id: 'pharm',    name: 'Pharmacy',          icon: '💊', district: 'oldtown', x: 330, y: 365, tier: 'LOW',  size: 'S', street: 'hospital', interiors: ['office_interior'],                     loot: ['medicine', 'medicine', 'medicine', 'food'], desc: 'Looted but not empty. Some pills survived.' },
  { id: 'resid',    name: 'Residential Block', icon: '🏢', district: 'oldtown', x: 205, y: 262, tier: 'MED',  size: 'M', street: 'downtown', interiors: ['office_interior', 'police_interior'],  loot: ['civilian', 'medicine', 'materials', 'food', 'civilian'], desc: 'Survivors barricaded on the upper floors.' },
  { id: 'school',   name: 'School Shelter',    icon: '🏫', district: 'oldtown', x: 345, y: 270, tier: 'MED',  size: 'M', street: 'hospital', interiors: ['office_interior'],                     loot: ['civilian', 'food', 'medicine', 'civilian'], desc: 'Last-known evac point. People stayed behind.' },
  { id: 'super',    name: 'Supermarket',       icon: '🛒', district: 'market',  x: 425, y: 330, tier: 'LOW',  size: 'M', street: 'downtown', interiors: ['office_interior'],                     loot: ['food', 'food', 'food', 'medicine'], desc: 'Shattered glass front. Half-empty shelves.' },
  { id: 'gas',      name: 'Gas Station',       icon: '⛽', district: 'market',  x: 505, y: 385, tier: 'MED',  size: 'S', street: 'downtown', interiors: ['armory_interior'],                     loot: ['materials', 'ammo', 'food', 'materials'], desc: 'Fuel\'s gone, but the shop is mostly intact.' },
  { id: 'hardware', name: 'Hardware Store',    icon: '🔧', district: 'market',  x: 540, y: 300, tier: 'LOW',  size: 'S', street: 'armory',   interiors: ['armory_interior'],                     loot: ['materials', 'materials', 'materials', 'ammo'], desc: 'Tools and screws. A forgotten lunchbox.' },
  { id: 'gunshop',  name: 'Gun Shop',          icon: '🔫', district: 'market',  x: 470, y: 280, tier: 'MED',  size: 'S', street: 'armory',   interiors: ['armory_interior'],                     loot: ['ammo', 'ammo', 'sniperAmmo', 'turretAmmo'], desc: 'Gun racks and glass cases — careful.' },
  { id: 'police',   name: 'Police Station',    icon: '🚓', district: 'civic',   x: 410, y: 205, tier: 'MED',  size: 'M', street: 'downtown', interiors: ['police_interior', 'office_interior'],  loot: ['ammo', 'ammo', 'civilian', 'lostSoldier', 'materials'], desc: 'Cells, lockers, evidence room.' },
  { id: 'clinic',   name: 'Clinic',            icon: '🩺', district: 'civic',   x: 395, y: 105, tier: 'MED',  size: 'S', street: 'hospital', interiors: ['office_interior'],                     loot: ['medicine', 'medicine', 'civilian', 'food'], desc: 'Small private clinic. Pharmacy in back.' },
  { id: 'office',   name: 'Office Tower',      icon: '🌆', district: 'civic',   x: 500, y: 140, tier: 'HIGH', size: 'L', street: 'downtown', interiors: ['office_interior'],                     loot: ['sniperAmmo', 'materials', 'civilian', 'sniperAmmo'], desc: 'Cubicle floors. The city burns through the windows.' },
  { id: 'precinct', name: 'Precinct HQ',       icon: '🚔', district: 'civic',   x: 585, y: 205, tier: 'HIGH', size: 'L', street: 'armory',   interiors: ['police_interior', 'armory_interior'],  loot: ['ammo', 'sniperAmmo', 'lostSoldier', 'turretAmmo', 'ammo'], desc: 'The main armory. Brute reported on-site.' },
  { id: 'hospital', name: 'Central Hospital',  icon: '🏥', district: 'medical', x: 720, y: 110, tier: 'HIGH', size: 'L', street: 'hospital', interiors: ['office_interior', 'police_interior'],  loot: ['medicine', 'medicine', 'civilian', 'lostSoldier', 'food'], desc: 'Military ward inside. Massive draw for the dead.' },
  { id: 'mall',     name: 'Shopping Mall',     icon: '🛍️', district: 'industry', x: 650, y: 300, tier: 'HIGH', size: 'L', street: 'downtown', interiors: ['office_interior', 'armory_interior'], loot: ['ammo', 'food', 'materials', 'civilian', 'medicine'], desc: 'A thousand dead between you and the prize.' },
  { id: 'depot',    name: 'Industrial Depot',  icon: '🏭', district: 'industry', x: 770, y: 360, tier: 'HIGH', size: 'L', street: 'armory',   interiors: ['armory_interior'],                     loot: ['materials', 'turretAmmo', 'ammo', 'materials', 'lostSoldier'], desc: 'Truck yard. Heavy infected presence.' },
];

const START_DISCOVERED = new Set(['conv', 'diner', 'pharm', 'resid', 'school', 'super']);
const TIER_INFEST = { LOW: 0.3, MED: 0.58, HIGH: 0.9 };
export const SIZE_W = { S: 2600, M: 3200, L: 3800 };
const SCOUT_RADIUS = 175;

export const RISK_COLOR = { LOW: '#44bb44', MED: C.wrn, HIGH: C.dng };

export function mkCity() {
  const locs = {};
  LOCATIONS.forEach(l => {
    locs[l.id] = {
      discovered: START_DISCOVERED.has(l.id),
      infest: Math.min(1.1, TIER_INFEST[l.tier] + (Math.random() - 0.5) * 0.12),
      loot: 1, visits: 0, lastDay: 0,
      seed: Math.floor(Math.random() * 2 ** 31),
      today: null,
    };
  });
  return { locs };
}

// Old saves have no city: build one on the fly.
export function ensureCity(gs) {
  if (!gs.city || !gs.city.locs) gs.city = mkCity();
  LOCATIONS.forEach(l => { if (!gs.city.locs[l.id]) gs.city.locs[l.id] = mkCity().locs[l.id]; });
  return gs.city;
}

export const riskOf = infest => infest < 0.42 ? 'LOW' : infest < 0.75 ? 'MED' : 'HIGH';
export const distOf = l => Math.hypot(l.x - FORT_POS.x, l.y - FORT_POS.y);
// Food per party member for the round trip.
export const travelCost = l => Math.max(1, Math.ceil(distOf(l) / 210));

// Today's condition + side objective (stable for the whole day).
function todayOf(gs, l, st) {
  if (!st.today || st.today.day !== gs.day) {
    const ex = rollMissionExtras(riskOf(st.infest));
    st.today = { day: gs.day, cond: ex.cond, side: ex.side };
  }
  return st.today;
}

// Destination objects for every discovered location, shaped like the
// old DEST_POOL entries so mkMission / the loadout UI keep working.
export function cityDests(gs) {
  ensureCity(gs);
  return LOCATIONS.filter(l => gs.city.locs[l.id].discovered).map(l => {
    const st = gs.city.locs[l.id];
    const risk = riskOf(st.infest);
    const t = todayOf(gs, l, st);
    return {
      locId: l.id, name: l.name, icon: l.icon, desc: l.desc, loot: l.loot,
      biome: l.street, interiors: l.interiors, W: SIZE_W[l.size], size: l.size,
      risk, riskColor: RISK_COLOR[risk],
      zSpawn: 0.4 + st.infest * 1.5,
      solDmg: [0, 0], missionLen: SIZE_W[l.size],
      infest: st.infest, lootLeft: st.loot, seed: st.seed, visits: st.visits, lastDay: st.lastDay,
      travel: travelCost(l), district: l.district,
      cond: t.cond, side: t.side,
      rewards: [...new Set(l.loot)].map(k => ({ medicine: '💊', ammo: '🔫', food: '🥫', materials: '🔧', sniperAmmo: '🎯', turretAmmo: '🟠', civilian: '👤', lostSoldier: '🪖' }[k] || '')).join('  '),
    };
  });
}

// One day passes (wave cleared): the dead spread, shelves restock a bit.
export function cityDayTick(gs) {
  ensureCity(gs);
  Object.values(gs.city.locs).forEach(st => {
    st.infest = Math.min(1.2, st.infest + 0.025);
    st.loot = Math.min(1, st.loot + 0.03);
  });
}

// After a sortie to a city location: record what was taken / killed and
// reveal nearby places. Returns the newly discovered location names.
export function applyCityVisit(gs, m) {
  const id = m.dest && m.dest.locId;
  if (!id) return [];
  ensureCity(gs);
  const st = gs.city.locs[id];
  st.visits++; st.lastDay = gs.day;
  const zTotal = Math.max(1, m.zombies.length);
  st.infest = Math.max(0.1, st.infest - 0.45 * Math.min(1, (m.killedCount || 0) / zTotal));
  const lootable = m.pickups.length + m.obstacles.filter(o => o.searchable).length;
  const taken = m.pickups.filter(p => p.collected).length + m.obstacles.filter(o => o.searchable && o.searched && !o._preLooted).length;
  if (lootable > 0) st.loot = Math.max(0.05, st.loot * (1 - 0.85 * taken / lootable));
  const here = LOCATIONS.find(l => l.id === id);
  const found = [];
  LOCATIONS.forEach(l => {
    const s = gs.city.locs[l.id];
    if (!s.discovered && Math.hypot(l.x - here.x, l.y - here.y) <= SCOUT_RADIUS) { s.discovered = true; found.push(l.name); }
  });
  return found;
}
