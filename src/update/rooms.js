// Enterable rooms off the street (explore missions, see cityMission.js).
//
// Some buildings have doors in their back wall on the ground floor.
// Stand at one and press E to go in: the party leaves the street for a
// small one-screen room with its own dead, containers and loot. E at
// the exit door brings everyone back out where they went in.
//
// A room is a mission "world" of its own: entering swaps the street's
// world fields (zombies, pickups, obstacles, platforms...) for the
// room's, so the whole mission engine — movement, combat, searching,
// lighting — runs in it unchanged. The street is frozen meanwhile.
// What happens in a room stays: going back in finds it as you left it.
import { uid } from '../constants.js';
import { ZTP } from '../data/zombies.js';
import { BIOMES } from '../data/biomes.js';
import { pickupValue } from '../data/rewards.js';
import { FOUND_GUNS, MELEE_FINDS } from '../data/weapons.js';
import { MGY, setMissionWidth } from '../data/expeditions.js';

export const ROOM_W = 900;
export const ROOM_EXIT_X = 70;
const DOOR_REACH = 34;

// What a room can be, by the building it opens off.
export const ROOM_KINDS = {
  apartment: { label: 'APT', name: 'Apartment', biome: 'apartment_interior', box: ['desk', 'locker', 'crate'], loot: ['food', 'food', 'medicine'], door: '#5a3a24' },
  storage:   { label: 'STORAGE', name: 'Storage room', biome: 'armory_interior', box: ['crate', 'ammo-crate', 'workbench'], loot: ['materials', 'ammo', 'turretAmmo', 'food'], door: '#4a4e48' },
  office:    { label: 'OFFICE', name: 'Office', biome: 'office_interior', box: ['desk', 'filing-cabinet', 'photocopier'], loot: ['materials', 'medicine', 'ammo'], door: '#6a6250' },
  clinic:    { label: 'CLINIC', name: 'Treatment room', biome: 'clinic_interior', box: ['medkit', 'filing-cabinet', 'locker'], loot: ['medicine', 'medicine', 'food'], door: '#d8dcd0' },
  lockers:   { label: 'LOCKERS', name: 'Locker room', biome: 'police_interior', box: ['locker', 'evidence-box', 'desk'], loot: ['ammo', 'materials', 'sniperAmmo'], door: '#3a4458' },
  armory:    { label: 'ARMS', name: 'Arms locker', biome: 'armory_interior', box: ['gun-rack', 'glass-case', 'ammo-crate'], loot: ['ammo', 'ammo', 'sniperAmmo', 'turretAmmo'], door: '#3a3a30' },
};
const BY_BUILDING = {
  office_interior: ['office', 'apartment', 'storage', 'clinic'],
  police_interior: ['lockers', 'office', 'storage'],
  armory_interior: ['armory', 'storage', 'apartment'],
};
const MEDICAL = new Set(['clinic', 'hospital', 'pharm']);

// Doors along the street (called from setupCityMission with its seeded rng).
export function placeRoomDoors(segs, r, locId) {
  const doors = [];
  segs.forEach(s => {
    const w = s.x1 - s.x0;
    if (r() > 0.8) return;
    const n = w >= 560 && r() < 0.45 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      // Clear of the stairs (22% / 78% of the width) and of each other.
      const f = n === 1 ? 0.42 + r() * 0.16 : (k === 0 ? 0.36 : 0.6) + r() * 0.05;
      const pool = BY_BUILDING[s.biomeKey] || BY_BUILDING.office_interior;
      let kind = pool[Math.floor(r() * pool.length)];
      if (MEDICAL.has(locId) && r() < 0.5) kind = 'clinic';
      doors.push({ id: doors.length, x: Math.round(s.x0 + w * f), seg: s.id, kind, num: 1 + Math.floor(r() * 9) + 10 * (s.id + 1), seed: Math.floor(r() * 1e9), visited: false, world: null });
    }
  });
  return doors;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// First visit: furnish the room (seeded, so the same door always holds
// the same room), scaled by what is left at the location and how
// infested it is.
function buildRoom(m, door) {
  const r = mulberry32(door.seed);
  const K = ROOM_KINDS[door.kind];
  const dest = m.dest || {};
  const lootLeft = dest.lootLeft ?? 1, infest = dest.infest ?? 0.5;
  const obstacles = [], pickups = [], zombies = [];
  const nBox = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nBox; i++) {
    const x = Math.round(230 + i * (560 / nBox) + r() * 60);
    const t = K.box[Math.floor(r() * K.box.length)];
    // A detour off the street pays like a locked building.
    obstacles.push({ x, type: t, searchable: true, searched: r() > 0.25 + 0.75 * lootLeft, rich: true });
  }
  obstacles.forEach(o => { if (o.searched) o._preLooted = true; });
  const nPick = r() < 0.25 + 0.6 * lootLeft ? 1 + Math.floor(r() * 2) : 0;
  for (let i = 0; i < nPick; i++) {
    const type = K.loot[Math.floor(r() * K.loot.length)];
    const x = Math.round(380 + r() * 420);
    pickups.push({ id: uid(), x, type, value: pickupValue(type, { wave: m.wave || 1, x: 0.8, W: 1, mul: (m.valueMul || 1) * 1.2 }), collected: false, lane: 0 });
  }
  if (r() < 0.14 * lootLeft) {
    const item = r() < 0.5 ? { kind: 'gun', w: FOUND_GUNS[Math.floor(r() * FOUND_GUNS.length)] } : { kind: 'melee', type: MELEE_FINDS[Math.floor(r() * MELEE_FINDS.length)] };
    pickups.push({ id: uid(), x: Math.round(600 + r() * 200), type: 'gear', item, value: 1, collected: false, lane: 0 });
  }
  const nZ = Math.round(r() * (1 + 4 * infest));
  for (let i = 0; i < nZ; i++) {
    const t = r() < 0.2 ? 'runner' : 'walker', z = ZTP[t];
    zombies.push({
      id: uid(), type: t, z, x: Math.round(420 + r() * 420), hp: z.hp, maxHp: z.hp, spd: z.spd * (0.85 + r() * 0.3),
      state: 'idle', facing: -1, walkPhase: r() * 6, atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0, activated: false, standingY: 0,
    });
  }
  return {
    W: ROOM_W, biomeKey: K.biome, segs: null, buildings: [], platforms: [], ladders: [], props: [],
    obstacles, pickups, zombies, hazards: [], humans: [], rescuables: [], encounter: null, side: null, alarm: null,
    entranceX: 0, indoorBiomeKey: null, fork: null, rdoors: [],
  };
}

const WORLD_KEYS = ['W', 'biomeKey', 'segs', 'buildings', 'platforms', 'ladders', 'props', 'obstacles', 'pickups', 'zombies',
  'hazards', 'humans', 'rescuables', 'encounter', 'side', 'alarm', 'entranceX', 'indoorBiomeKey', 'fork', 'rdoors', 'cameraX'];
const take = m => Object.fromEntries(WORLD_KEYS.map(k => [k, m[k]]));

function placeParty(party, x, dir) {
  party.forEach((p, i) => {
    p.x = x - dir * i * 28; p.facing = dir;
    p.standingY = 0; p.jumpY = 0; p.vy = 0; p.climbing = null; p.forkLane = 0;
  });
}

export function enterRoom(m, door, party, now) {
  if (m.room) return;
  if (!door.world) door.world = buildRoom(m, door);
  const street = take(m);
  Object.assign(m, door.world, { cameraX: 0, bullets: [] });
  m.room = { door, street, enteredAt: now };
  setMissionWidth(m.W);
  placeParty(party, ROOM_EXIT_X + 60, 1);
  hideFallen(m, true);
  const K = ROOM_KINDS[door.kind];
  m.soundQ.push({ t: 'thud', x: ROOM_EXIT_X });
  m.effects.push({ type: 'txt', x: ROOM_EXIT_X + 120, y: MGY - 110, v: `🚪 ${K.name.toUpperCase()}${door.visited ? '' : ' — CHECK IT'}`, col: '#e8d8b0', at: now, dur: 1800 });
  door.visited = true;
}

export function exitRoom(m, party, now) {
  if (!m.room) return;
  const { door, street, enteredAt } = m.room;
  door.world = take(m);
  Object.assign(m, street, { bullets: [] });
  m.room = null;
  setMissionWidth(m.W);
  placeParty(party, door.x, -1);
  hideFallen(m, false);
  // The street is frozen while you're inside: an SOS deadline waits too.
  if (now !== undefined && m.side && m.side.type === 'sos' && m.side.state === 'active') m.side.timeLimit += now - enteredAt;
  if (now !== undefined) m.soundQ.push({ t: 'thud', x: door.x });
}

// Fallen squad members stay where they fell: hide street corpses while
// inside a room, and leave the ones who fell in a room inside it.
function hideFallen(m, entering) {
  [m.soldier, ...(m.followers || [])].forEach(p => {
    if (!p || (p.hp > 0 && p.state !== 'dead')) return;
    if (entering) { if (p._streetX === undefined) { p._streetX = p.x; p.x = -9999; } }
    else if (p._streetX !== undefined) { p.x = p._streetX; delete p._streetX; }
    else p.x = -9999;
  });
}

// The door the lead is standing at (street), or the exit (room).
export function doorAt(m) {
  const s = m.soldier;
  if (!s || Math.abs(s.standingY || 0) >= 18) return null;
  if (m.room) return s.x < ROOM_EXIT_X + DOOR_REACH + 30 ? 'exit' : null;
  return (m.rdoors || []).find(d => Math.abs(s.x - d.x) < DOOR_REACH) || null;
}

export function tickRooms(m, now, party) {
  if (!m.inputInteract) return;
  m.inputInteract = false;
  const d = doorAt(m);
  if (d === 'exit') exitRoom(m, party, now);
  else if (d) enterRoom(m, d, party, now);
}

// Mission over while inside: put everyone back on the street so the
// result (location loot, infestation, assault outcome) reads the street.
export function leaveRoomIfInside(m) {
  if (m && m.room) exitRoom(m, [m.soldier, ...(m.followers || [])].filter(Boolean));
}

export const roomKind = door => ROOM_KINDS[door.kind];
export const roomBiome = m => (m.room ? BIOMES[ROOM_KINDS[m.room.door.kind].biome] : null);
