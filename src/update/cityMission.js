// EXPLORE missions for city-map locations (see data/city.js).
//
// The layout is generated from the location's own seed, so a place
// looks the same every time you go back: same street, same buildings,
// same containers. A street holds 2–4 buildings you walk into (indoor
// biome, upper floor + stairs). Some buildings are locked: find the key
// in a container somewhere before it, or force the door (slow and loud).
// There is no goal at the end of the street: you leave whenever you
// walk back to the van you came in.
import { uid } from '../constants.js';
import { ZTP } from '../data/zombies.js';
import { BIOMES, SEARCHABLE_TYPES } from '../data/biomes.js';
import { MISSION_W, MGY } from '../data/expeditions.js';
import { pushRadio } from '../audio/radio.js';

export const VAN_X = 96;
const LEAVE_MS = 1600;
const FORCE_MS = 4500;
const FLOOR_Y = MGY - 80;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


export const segAt = (m, x) => (m.segs || []).find(s => x >= s.x0 && x <= s.x1) || null;

// Nearest open-street x to `x` (at least `margin` px from any building,
// inside a gap at least 60 px wide). null when the street has no room.
export function streetSpot(m, x, margin = 90) {
  const segs = [...(m.segs || [])].sort((a, b) => a.x0 - b.x0);
  const gaps = [];
  let from = 260;
  segs.forEach(s => { gaps.push([from, s.x0 - margin]); from = s.x1 + margin; });
  gaps.push([from, MISSION_W - 140]);
  let best = null;
  gaps.filter(([a, b]) => b - a >= 60).forEach(([a, b]) => {
    const c = Math.max(a, Math.min(b, x));
    if (best === null || Math.abs(c - x) < Math.abs(best - x)) best = c;
  });
  return best === null ? null : Math.round(best);
}

// Indoor test shared by lighting / ambience (all mission kinds).
export function isIndoorAt(m, x) {
  const b = BIOMES[m.biomeKey];
  if (b && b.indoor) return true;
  if (m.segs) return !!segAt(m, x);
  return !!(m.indoorBiomeKey && m.entranceX > 0 && x >= m.entranceX);
}

// Replaces the generic sortie layout with the location's persistent one.
export function setupCityMission(m, dest) {
  const W = MISSION_W, r = mulberry32(dest.seed || 1);
  const street = BIOMES[dest.biome] || BIOMES.downtown;
  const interiors = (dest.interiors && dest.interiors.length) ? dest.interiors : ['office_interior'];
  const loot = dest.lootLeft ?? 1;

  // Buildings along the street.
  const nB = { S: 2, M: 3, L: 4 }[dest.size] || 2;
  const span = W - 560 - 300;
  const slot = span / nB;
  const segs = [];
  for (let i = 0; i < nB; i++) {
    const w = Math.round(Math.min(slot - 180, 420 + r() * 300));
    const x0 = Math.round(560 + i * slot + r() * Math.max(0, slot - w - 160));
    segs.push({ x0, x1: x0 + w, biomeKey: interiors[Math.floor(r() * interiors.length)], locked: false, force: 0, id: i });
  }
  // A locked building (never the first one), key hidden before it.
  let lockedSeg = null;
  if (segs.length >= 2 && r() < 0.7) { lockedSeg = segs[1 + Math.floor(r() * (segs.length - 1))]; lockedSeg.locked = true; }
  const keyHidden = lockedSeg && r() < 0.65;

  const buildings = [], platforms = [], ladders = [];
  segs.forEach(s => {
    const w = s.x1 - s.x0;
    buildings.push({ x: s.x0 + 30, w: w - 60, floorY: FLOOR_Y, biomeKey: s.biomeKey });
    platforms.push({ x: s.x0 + 70, y: FLOOR_Y, w: w - 140, type: 'floor' });
    ladders.push({ x: s.x0 + Math.round(w * 0.22), yTop: FLOOR_Y, yBot: MGY, type: 'stairs', slopeDir: +1 });
    ladders.push({ x: s.x0 + Math.round(w * 0.78), yTop: FLOOR_Y, yBot: MGY, type: 'stairs', slopeDir: -1 });
  });
  // A fire-escape ledge or two on the open street between buildings.
  for (let i = 0; i < segs.length - 1; i++) {
    const gap0 = segs[i].x1 + 40, gap1 = segs[i + 1].x0 - 40;
    if (gap1 - gap0 > 260 && r() < 0.6) {
      const lx = gap0 + 30 + r() * (gap1 - gap0 - 220), ly = MGY - 50 - r() * 15, lw = 130 + r() * 50;
      platforms.push({ x: lx, y: ly, w: lw, type: 'ledge' });
      ladders.push({ x: lx + 10, yTop: ly, yBot: MGY, type: 'ladder', slopeDir: 1 });
    }
  }

  const inSeg = x => segs.find(s => x >= s.x0 - 30 && x <= s.x1 + 30);
  // Containers / obstacles: street pieces between buildings, furniture inside.
  const obstacles = [];
  for (let x = 300 + r() * 80; x < W - 140; x += 200 + r() * 140) {
    if (inSeg(x)) continue;
    const t = street.obstacles[Math.floor(r() * street.obstacles.length)];
    obstacles.push({ x: Math.round(x), type: t, searchable: SEARCHABLE_TYPES.has(t) && r() < 0.32, searched: false });
  }
  segs.forEach(s => {
    const ib = BIOMES[s.biomeKey];
    for (let x = s.x0 + 70 + r() * 40; x < s.x1 - 60; x += 140 + r() * 110) {
      const t = ib.obstacles[Math.floor(r() * ib.obstacles.length)];
      obstacles.push({ x: Math.round(x), type: t, searchable: SEARCHABLE_TYPES.has(t) && r() < 0.6, searched: false });
    }
  });
  // What earlier visits took stays taken.
  obstacles.forEach(o => { if (o.searchable && r() > loot) { o.searched = true; o._preLooted = true; } });
  if (keyHidden) {
    const before = obstacles.filter(o => o.searchable && !o._preLooted && o.x < lockedSeg.x0 - 40);
    const holder = before.length ? before[Math.floor(r() * before.length)] : null;
    if (holder) holder.hasKey = true;
  }

  const props = [];
  for (let px = street.propsPerStep; px < W - 50; px += street.propsPerStep) {
    const s = inSeg(px);
    props.push({ x: px + Math.round((r() - 0.5) * 60), type: s ? BIOMES[s.biomeKey].propType : street.propType });
  }

  // Loot on the upper floors pays a bit more; some dead wait up there.
  m.pickups.forEach(p => {
    p.standingY = undefined;
    const s = segAt({ segs }, p.x);
    if (s && !p.fork && p.type !== 'vaccine' && Math.random() < 0.38 && p.x > s.x0 + 80 && p.x < s.x1 - 80) {
      p.standingY = FLOOR_Y - MGY; p.value = Math.round((p.value || 1) * 1.4);
    }
  });
  m.zombies.forEach(z => {
    z.standingY = 0;
    const s = segAt({ segs }, z.x);
    if (s && z.type !== 'tank' && z.type !== 'brute' && Math.random() < 0.25) z.standingY = FLOOR_Y - MGY;
  });

  // Survivor camps set up on the street, not inside a building.
  const enc = m.encounter;
  if (enc && segAt({ segs }, enc.x)) {
    const nx = streetSpot({ segs }, enc.x, 140);
    if (nx !== null) {
      const dx = nx - enc.x;
      enc.x = nx;
      (m.humans || []).forEach(h => { h.x += dx; });
      for (let i = m.zombies.length - 1; i >= 0; i--) if (Math.abs(m.zombies[i].x - enc.x) <= (enc.clearRadius || 220)) m.zombies.splice(i, 1);
    }
  }

  Object.assign(m, {
    objective: 'explore', fork: null, entranceX: 0, indoorBiomeKey: null,
    segs, buildings, platforms, ladders, obstacles, props, keys: 0,
  });
  // Start next to the van.
  [m.soldier, ...(m.followers || [])].forEach((p, i) => { p.x = 200 - i * 30; });
}

function packAt(m, xs, standingY = 0) {
  xs.forEach((x, i) => {
    const t = i % 3 === 1 ? 'runner' : 'walker', z = ZTP[t];
    m.zombies.push({
      id: uid(), type: t, z, x, hp: z.hp, maxHp: z.hp, spd: z.spd * (0.85 + Math.random() * 0.3),
      state: 'walk', facing: -1, walkPhase: Math.random() * 6, atkTimer: 0, hurtTimer: 0, deadAt: 0,
      lane: 0, activated: true, standingY,
    });
    m.activatedCount++;
  });
}

// Container searched (called from the mission's search loop).
export function onContainerSearched(m, o, now) {
  if (!o.hasKey) return;
  o.hasKey = false; m.keys = (m.keys || 0) + 1;
  m.soundQ.push({ t: 'pickup', x: o.x });
  m.effects.push({ type: 'txt', x: o.x, y: MGY - 90, v: '🔑 KEY FOUND', col: '#ffd54a', at: now, dur: 2200 });
  pushRadio(m, 'kill', { line: 'Found a key. Must open something around here.', speaker: m.soldier, cooldown: 0 });
}

export function tickCity(m, now, dt, party) {
  if (m.objective !== 'explore') return;
  const lead = m.soldier;
  if (lead.x > 520) m._ventured = true;

  // Locked doors: the party can't walk through until unlocked.
  (m.segs || []).forEach(s => {
    if (!s.locked) return;
    party.forEach(p => { if (p.x > s.x0 - 18 && p.x < s.x1) p.x = s.x0 - 18; });
    const atDoor = lead.x >= s.x0 - 50 && Math.abs(lead.standingY || 0) < 18;
    if (!atDoor) return;
    if (m.keys > 0) {
      m.keys--; s.locked = false;
      m.soundQ.push({ t: 'reload', w: 'pistol', dur: 300 });
      m.effects.push({ type: 'txt', x: s.x0, y: MGY - 100, v: '🔓 UNLOCKED', col: '#88ee99', at: now, dur: 1800 });
      return;
    }
    if (s.force === 0) {
      pushRadio(m, 'deploy', { line: 'Locked. Forcing it, cover me!', speaker: lead, cooldown: 0 });
      packAt(m, [s.x0 + 120, s.x0 + 170, s.x0 + 230]);
      packAt(m, [Math.max(40, s.x0 - 520), Math.max(40, s.x0 - 470)]);
    }
    s.force = Math.min(1, s.force + dt / FORCE_MS);
    if (Math.floor(now / 420) !== Math.floor((now - dt) / 420)) m.soundQ.push({ t: 'bhit', x: s.x0 });
    if (s.force >= 1) {
      s.locked = false;
      m.soundQ.push({ t: 'thud', x: s.x0 });
      m.effects.push({ type: 'txt', x: s.x0, y: MGY - 100, v: 'DOOR FORCED', col: '#ffcc44', at: now, dur: 1800 });
    }
  });

  // Leave: walk back to the van after heading out.
  if (m._ventured && lead.x < VAN_X + 80 && Math.abs(lead.standingY || 0) < 4) {
    if (!m._leaveAt) m._leaveAt = now;
    if (now - m._leaveAt >= LEAVE_MS) {
      // Only civilians who actually made it to the van count.
      m.collected.rescuedCivs = (m.rescuables || []).filter(r => r.state === 'following' && r.hp > 0 && r.x < VAN_X + 320).length;
      m.state = 'won'; m.endedAt = now;
    }
  } else m._leaveAt = 0;
}

// Keep the dead, civilians and survivors on their side of a locked door
// (after AI movement; the party is held back in tickCity).
export function clampCity(m) {
  (m.segs || []).forEach(s => {
    if (!s.locked) return;
    [...m.zombies, ...(m.rescuables || []), ...(m.humans || [])].forEach(z => {
      if (z.state === 'dead' || z.hp <= 0) return;
      const k = '_in' + s.id;
      const inside = z[k] ?? (z[k] = z.x > s.x0 && z.x < s.x1);
      if (inside) z.x = Math.max(s.x0 + 14, Math.min(s.x1 - 14, z.x));
      else if (z.x > s.x0 - 14 && z.x < s.x1 + 14) z.x = z.x < (s.x0 + s.x1) / 2 ? s.x0 - 14 : s.x1 + 14;
    });
  });
}

export const leaveProgress = (m, now) => m._leaveAt ? Math.min(1, (now - m._leaveAt) / LEAVE_MS) : 0;
