// ────────────────────────────────────────────────────────────────
// Light collection for the HD post-processing layer (render/postfx.js).
//
// Lights are derived from game state every frame instead of being
// registered by the renderers, so the classic Canvas renderer stays
// untouched and the HD layer can be switched off at any time. All
// positions are returned in SCREEN space (CSS px, y down).
//
//   light: { x, y, r (radius px), i (intensity), c: [r, g, b] }
//   cone:  { x, y, dir (rad, 0 = right, y down), half (rad), r, i, c }
// ────────────────────────────────────────────────────────────────
import { CW, GY, WX, laneY, laneSc } from '../constants.js';
import { MISSION_W, MGY } from '../data/expeditions.js';
import { BIOMES, DEFAULT_BIOME } from '../data/biomes.js';
import { CITY_FIRES, CITY_FIRE_PARALLAX } from './background.js';

const WARM   = [1.0, 0.72, 0.42];
const MUZZLE = [1.0, 0.70, 0.30];
const FIRE   = [1.0, 0.50, 0.18];
const TRACER = [1.0, 0.85, 0.45];
const FLOOD  = [1.0, 0.95, 0.78];
const ACID   = [0.45, 1.0, 0.30];
const MOON   = [0.55, 0.65, 0.95];

// Parse 'rgba(r,g,b,a)' → [r, g, b] in 0..1 (biome light colours).
function rgb(str, fallback) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return fallback;
  const p = m[1].split(',').map(Number);
  return [p[0] / 255, p[1] / 255, p[2] / 255];
}

// Cheap deterministic flicker in 0.75..1.
const flick = (now, seed) => 0.82 + 0.18 * Math.sin(now / 53 + seed * 7.1) * Math.sin(now / 91 + seed * 3.3);

function push(list, x, y, r, i, c, camX) {
  const sx = x - camX;
  if (sx < -r || sx > CW + r) return;
  list.push({ x: sx, y, r, i, c });
}

// ── Siege ────────────────────────────────────────────────────────
export function siegeLights(gs, now) {
  const cam = gs.cameraX || 0;
  const lights = [], cones = [];

  // Burning city blocks: these live on the 0.5-parallax skyline layer.
  CITY_FIRES.forEach((f, k) => {
    const sx = f.x - cam * CITY_FIRE_PARALLAX - 20;
    if (sx > -260 && sx < CW + 260) lights.push({ x: sx, y: f.y, r: 230 * f.s, i: 0.55 * flick(now, k), c: FIRE });
  });
  // Moonlight (screen-fixed, like the sky layer).
  lights.push({ x: CW * 0.56, y: 112, r: 560, i: 0.16, c: MOON });

  // Fort Omega: watchtower cabin + parapet floodlights (cones).
  push(lights, WX - 22, GY - 228, 110, 0.55, WARM, cam);
  for (let li = 0; li < 3; li++) {
    const lx = 30 + li * 50 - cam, ly = GY - 185;
    if (lx > -40 && lx < CW + 600) {
      cones.push({ x: lx, y: ly, dir: 0.62, half: 0.34, r: 520, i: 0.55, c: FLOOD });
    }
  }
  // Wall fires when the wall is failing (see dBase).
  const wp = gs.baseHp / (gs.baseMaxHp || 1);
  if (wp < 0.25 && gs.baseHp > 0) {
    push(lights, WX - 30, GY - 165, 150, 0.9 * flick(now, 1), FIRE, cam);
    push(lights, 52, GY - 167, 150, 0.9 * flick(now, 2), FIRE, cam);
  }

  // Muzzle flashes: soldiers, rooftop sniper, turrets, gunmen.
  gs.soldiers.forEach(s => {
    if (s.state === 'dead' || s.onExpedition) return;
    if (now - (s.shootAt || -1e9) > 75) return;
    if (s.onRoof) { push(lights, s.x + 68, GY - 180, 200, 1.3, MUZZLE, cam); return; }
    const sc = laneSc(s.lane || 0);
    push(lights, s.x + (s.facing || 1) * 30 * sc, laneY(s.lane || 0) - 32 * sc, 170 * sc, 1.2, MUZZLE, cam);
  });
  (gs.turrets || []).forEach(t => {
    if (now - (t.lastShot || -1e9) < 70) push(lights, t.x + 36, t.y - 8, 160, 1.1, MUZZLE, cam);
  });
  (gs.humans || []).forEach(h => {
    if (h.state !== 'dead' && h.h && h.h.range > 0 && now - (h.lastShot || -1e9) < 75) {
      const sc = laneSc(h.lane || 0);
      push(lights, h.x - 18, laneY(h.lane || 0) - 22 * sc, 150 * sc, 1.0, MUZZLE, cam);
    }
  });

  // Tracers + impacts (capped so a shotgun volley can't eat the budget).
  let n = 0;
  for (const b of gs.bullets) {
    if (n++ > 14) break;
    push(lights, b.x, b.y, b.spit ? 40 : 46, b.spit ? 0.5 : 0.45, b.spit ? ACID : TRACER, cam);
  }
  for (const e of gs.effects) {
    if (e.type !== 'hit') continue;
    const life = 1 - (now - e.at) / e.dur;
    if (life > 0) push(lights, e.x, e.y, 60, 0.7 * life, MUZZLE, cam);
  }

  return {
    ambient: 0.78, tint: [0.74, 0.8, 1.0], lights, cones,
    bloom: 0.62, threshold: 0.6, scatter: 0.26, vignette: 0.38, grain: 0.035, sat: 0.92,
    flash: gs.shakeTimer > 220 ? 0.04 : 0,
  };
}

// ── Mission (sortie) ─────────────────────────────────────────────
export function missionLights(m, now) {
  const cam = m.cameraX || 0;
  const lights = [], cones = [];
  const biome = BIOMES[m.biomeKey] || BIOMES[DEFAULT_BIOME];
  const indoorBiome = m.indoorBiomeKey ? BIOMES[m.indoorBiomeKey] : null;
  const fullyIndoor = !!biome.indoor;

  // Ceiling fixtures of indoor sections (same spacing as dIndoorBackdrop).
  const ceiling = (b, fromX) => {
    const ls = b.lightSpacing || 220;
    const col = rgb(b.lightColor, WARM);
    for (let lx = ls / 2; lx < MISSION_W; lx += ls) {
      if (lx < fromX) continue;
      const sx = lx - cam;
      if (sx < -200 || sx > CW + 200) continue;
      cones.length < 4 && cones.push({ x: sx, y: 14, dir: Math.PI / 2, half: 0.62, r: 420, i: 0.55 * flick(now, lx), c: col });
      push(lights, lx, 14, 120, 0.5, col, cam);
    }
  };
  if (fullyIndoor) ceiling(biome, 0);
  else if (indoorBiome && m.entranceX > 0) ceiling(indoorBiome, m.entranceX);

  // Outdoor props that emit light.
  (m.props || []).forEach(p => {
    if (p.type === 'lamppost-hospital') push(lights, p.x, MGY - 53, 130, 0.6, [0.7, 0.86, 1.0], cam);
    else if (p.type === 'streetlamp-broken') push(lights, p.x + 18, MGY - 60, 90, 0.5 * flick(now, p.x), FIRE, cam);
    else if (p.type === 'exit-sign') push(lights, p.x, MGY - 173, 90, 0.6, [1.0, 0.25, 0.18], cam);
  });

  // Party: muzzle flashes + a flashlight cone on the lead indoors.
  const party = [m.soldier, ...(m.followers || [])].filter(p => p && p.hp > 0 && p.state !== 'dead');
  party.forEach(p => {
    const y = MGY - 32 + (p.standingY || 0) + (p.jumpY || 0) + (p._laneY || 0);
    if (now - (p.shootAt || -1e9) < 75) push(lights, p.x + (p.facing || 1) * 30, y, 190, 1.25, MUZZLE, cam);
  });
  const lead = m.soldier;
  const leadIndoor = fullyIndoor || (indoorBiome && lead.x >= m.entranceX);
  if (lead && lead.hp > 0) {
    const y = MGY - 30 + (lead.standingY || 0) + (lead.jumpY || 0) + (lead._laneY || 0);
    const f = lead.facing || 1;
    cones.push({ x: lead.x - cam + f * 14, y, dir: f > 0 ? 0.08 : Math.PI - 0.08, half: 0.36, r: leadIndoor ? 380 : 300, i: leadIndoor ? 0.75 : 0.45, c: [1.0, 0.96, 0.85] });
    push(lights, lead.x, y, 70, 0.25, [1.0, 0.95, 0.85], cam);
  }
  // Hostile survivors firing.
  (m.humans || []).forEach(h => {
    if (h.state !== 'dead' && now - (h.lastShot || -1e9) < 75) push(lights, h.x + (h.facing || 1) * 12, MGY - 26, 150, 1.0, MUZZLE, cam);
  });

  // Hazards, pickups, objectives.
  (m.hazards || []).forEach(h => {
    if (h.type === 'acid') push(lights, h.x, MGY - 4, (h.w || 60) + 30, 0.45, ACID, cam);
    else if (h.type === 'mine' && !h.triggered && Math.floor(now / 600) % 2 === 0) push(lights, h.x, MGY - 6, 26, 0.6, [1, 0.15, 0.1], cam);
    else if (h.type === 'mine' && h.triggered && now - h.triggeredAt < 450) push(lights, h.x, MGY - 20, 260, 1.8 * (1 - (now - h.triggeredAt) / 450), FIRE, cam);
  });
  m.pickups.forEach(p => {
    if (p.collected) return;
    const y = MGY - 30 + (p.standingY || 0) + (p.lane === 1 ? -34 : 0);
    push(lights, p.x, y, p.type === 'vaccine' ? 120 : 55, p.type === 'vaccine' ? 0.8 : 0.3, p.type === 'vaccine' ? [0.5, 1, 0.55] : [0.55, 0.85, 0.4], cam);
  });
  if (m.objective !== 'defend') push(lights, MISSION_W - 30, MGY - 60, 150, 0.45, [0.5, 0.9, 0.35], cam);
  else push(lights, m.defendAnchor + 12, MGY - 60, 120, 0.5, [1.0, 0.6, 0.2], cam);
  if (m.extraction) {
    const e = m.extraction, dir = e.phase === 'leaving' ? -1 : 1;
    cones.push({ x: e.x - cam + dir * 70, y: MGY - 30, dir: dir > 0 ? 0.05 : Math.PI - 0.05, half: 0.3, r: 420, i: 0.9, c: [1, 0.95, 0.8] });
  }

  let n = 0;
  for (const b of m.bullets) {
    if (n++ > 14) break;
    push(lights, b.x, b.y, b.spit ? 40 : 46, b.spit ? 0.55 : 0.45, b.spit ? ACID : TRACER, cam);
  }
  for (const e of m.effects) {
    if (e.type !== 'hit') continue;
    const life = 1 - (now - e.at) / e.dur;
    if (life > 0) push(lights, e.x, e.y, 60, 0.7 * life, MUZZLE, cam);
  }

  return fullyIndoor
    ? { ambient: 0.6, tint: [0.82, 0.84, 0.92], lights, cones, bloom: 0.55, threshold: 0.62, scatter: 0.3, vignette: 0.42, grain: 0.04, sat: 0.9 }
    : { ambient: 0.68, tint: [0.72, 0.8, 1.0], lights, cones, bloom: 0.6, threshold: 0.6, scatter: 0.26, vignette: 0.38, grain: 0.035, sat: 0.92 };
}
