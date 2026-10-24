// Sortie depth band, beat-'em-up style.
//
// The street is a band of depth in front of the buildings, not a line:
// every mission actor and prop carries `depth`, 0 against the back wall
// (where doors, stairs and ladders are) to BAND at the front kerb. Its
// feet sit at MGY + depth on screen and it is drawn a little bigger the
// closer it is (depthSc), sorted back to front. The camera stays
// horizontal.
//
// Combat happens at a depth: bullets carry the shooter's depth and only
// hit what is within a few px of it, bites and melee swings need the
// two to be roughly lined up, a grenade hits by distance with the depth
// gap weighted in. Upper floors and ledges are a single line at the
// back (depth 0): climbing a stair or ladder slides you there.
//
// Rooms are narrower (ROOM_BAND). The fork of reach missions is a
// concrete median along the middle of the band: the squad picks the
// back or the front road before it starts and can't cross mid-way;
// the dead and hostile survivors can't either, they go round its ends.
// It is low: bullets fly over it (a shot still has to be lined up in
// depth, and the median is wider than that), spit is lobbed over it.
import { MGY } from '../data/expeditions.js';

export const BAND = 68;
export const ROOM_BAND = 54;
// Depth speed as a share of the walking speed (the band is shallow).
export const DEPTH_SPD = 0.67;
// Bullets: within this depth gap of a body they hit it.
export const HIT_TOL = 13;
export const HOSTILE_TOL = 10;
// Bites and melee swings.
export const BITE_DEPTH = 14;
export const MELEE_DEPTH = 18;
// Pickups / containers / survivors: generous.
export const GRAB_DEPTH = 22;
export const SEARCH_DEPTH = 30;
// Doors, stairs and ladders are against the back wall: E reaches them
// from the back of the band.
export const BACK_REACH = 40;
// Platforms only catch a jump from the back of the band.
export const LEDGE_REACH = 18;

export const dep = e => (e && e.depth) || 0;
export const bandOf = m => (m && m.room ? ROOM_BAND : BAND);
export const depthSc = d => 1 + 0.14 * Math.max(0, d) / BAND;
export const groundY = d => MGY + d;
export const dGap = (a, b) => Math.abs(dep(a) - dep(b));

// Random depth inside the band, away from the edges.
export const anyDepth = (lo = 6, hi = BAND - 6, r = Math.random) => Math.round(lo + r() * (hi - lo));

// Squad formation in depth around the lead: ±18, then ±34 (mirrored
// when it would leave the band).
const FORM = [18, -18, 34, -34, 48, -48];
export function formationDepth(lead, i, band = BAND) {
  if (i < 0) return lead;
  const off = FORM[i % FORM.length];
  let d = lead + off;
  if (d < 4 || d > band - 4) d = lead - off;
  return Math.max(2, Math.min(band - 2, d));
}

// Where an obstacle stands in the band. Wrecked cars are cover, at any
// depth; furniture, lockers and searchable containers stand against the
// back wall; small street clutter is anywhere.
const WALL_TYPES = new Set(['container', 'sign', 'locker', 'filing-cabinet', 'gun-rack', 'glass-case', 'workbench',
  'cubicle', 'photocopier', 'water-cooler', 'desk', 'iv', 'office-chair']);
export function placeObstacle(o, r = Math.random) {
  if (o.type === 'car') { o.cover = true; o.depth = anyDepth(14, BAND - 10, r); }
  else if (o.searchable || WALL_TYPES.has(o.type)) o.depth = Math.round(2 + r() * 14);
  else o.depth = anyDepth(8, BAND - 6, r);
  return o;
}

// Up on a floor, a ledge or a ladder: the single line at the back.
export const aloft = e => (e.standingY || 0) < 0 || !!e.climbing;

// Move `e.depth` toward `to` by at most `step`.
export function stepDepth(e, to, step) {
  const d = to - dep(e);
  e.depth = dep(e) + Math.sign(d) * Math.min(Math.abs(d), step);
}

// Keep an actor inside the band (and at the back while aloft).
export function clampDepth(m, e) {
  if (e.climbing) return;              // the climb slides it to the wall
  if ((e.standingY || 0) < 0) { e.depth = 0; return; }
  e.depth = Math.max(0, Math.min(bandOf(m), dep(e)));
}

// ── Fork median ─────────────────────────────────────────────────
export const forkMid = () => Math.round(BAND / 2);
export const FORK_HALF = 7;              // half the median's width
export const inForkAt = (m, x) => !!(m.fork && !m.room && x >= m.fork.startX && x <= m.fork.endX);

// Hold a squad member on the side of the median it was on.
export function holdFork(m, p, prevDepth) {
  if (!inForkAt(m, p.x) || aloft(p)) return;
  const mid = forkMid();
  if (prevDepth < mid) p.depth = Math.min(dep(p), mid - FORK_HALF);
  else p.depth = Math.max(dep(p), mid + FORK_HALF);
}

// The road the lead took (m.fork.road: 0 back, 1 front, set while the
// lead is in the fork). Followers and rescued civilians heading into
// the fork keep to it: their target depth is clamped to that road, and
// they wait at the median's end until they are on it.
export const roadOf = d => (d < forkMid() ? 0 : 1);
export function noteRoad(m, lead) {
  if (inForkAt(m, lead.x) && !aloft(lead)) m.fork.road = roadOf(dep(lead));
}
export function roadClamp(m, x, d) {
  const f = m.fork;
  if (!f || m.room || f.road === undefined || x < f.startX - 140 || x > f.endX) return d;
  const mid = forkMid();
  return f.road === 0 ? Math.min(d, mid - FORK_HALF - 2) : Math.max(d, mid + FORK_HALF + 2);
}
export const wrongRoad = (m, p, nx) => !!m.fork && m.fork.road !== undefined
  && inForkAt(m, nx) && !inForkAt(m, p.x) && roadOf(dep(p)) !== m.fork.road;

// The dead and the survivors on the ground are held by it too: each
// keeps to the side it was on when the median started spanning its x
// (run after their movement).
const sideDepth = road => (road === 0 ? forkMid() - FORK_HALF : forkMid() + FORK_HALF);
export function holdMedian(m, list) {
  (list || []).forEach(e => {
    if (e.state === 'dead' || e.hp <= 0) return;
    if (aloft(e) || !inForkAt(m, e.x)) { e._road = undefined; return; }
    if (e._road === undefined) e._road = roadOf(dep(e));
    e.depth = e._road === 0 ? Math.min(dep(e), sideDepth(0)) : Math.max(dep(e), sideDepth(1));
  });
}

// Where an actor on the ground heads for a target at (tx, td) on the
// other road while the median spans the target's x: round the near
// end of the median (just past it), then across to the target's road
// before stepping back in. null: straight at the target.
const END_GAP = 14;
export function forkWay(m, e, tx, td) {
  const f = m.fork;
  if (!f || m.room || aloft(e) || tx < f.startX || tx > f.endX) return null;
  const want = roadOf(td);
  const inside = inForkAt(m, e.x);
  if (inside && (e._road ?? roadOf(dep(e))) === want) return null;
  // Outside it: clear of the median's width before stepping in.
  if (!inside && (want === 0 ? dep(e) <= sideDepth(0) : dep(e) >= sideDepth(1))) return null;
  const d = want === 0 ? sideDepth(0) - 4 : sideDepth(1) + 4;
  if (!inside) return { x: e.x < f.startX ? Math.min(e.x + 40, f.startX - 2) : Math.max(e.x - 40, f.endX + 2), d };
  const a = f.startX - END_GAP, b = f.endX + END_GAP;
  return { x: Math.abs(e.x - a) + Math.abs(tx - a) <= Math.abs(e.x - b) + Math.abs(tx - b) ? a : b, d: dep(e) };
}

// ── Cover ───────────────────────────────────────────────────────
// Wrecked cars stop bullets fired along their depth, unless the
// shooter is right behind the car (firing over it).
const COVER_W = 24, COVER_D = 10;
export function coverOf(m) {
  const out = (m.obstacles || []).filter(o => o.cover);
  if (m.alarm && m.alarm.depth !== undefined) out.push({ x: m.alarm.x, depth: m.alarm.depth, w: 42 });
  return out;
}
export function coverStops(m, b) {
  if (b.spit || (b.shooterY || 0) !== 0) return null;
  const ox = b.ox ?? b.x;
  for (const c of coverOf(m)) {
    const w = c.w || COVER_W;
    if (Math.abs(dep(c) - b.depth) > COVER_D) continue;
    if (Math.max(ox, b.x) < c.x - w || Math.min(ox, b.x) > c.x + w) continue;
    // Point-blank over the bonnet: the car doesn't block it.
    if (Math.abs(ox - c.x) < w + 14) continue;
    return c;
  }
  return null;
}

// A car between a shooter at (xa, depth d) and xb: AI holds its fire.
export const coverBetween = (m, xa, xb, d) => !!coverStops(m, { x: xb, ox: xa, depth: d });

// ── Drawing ─────────────────────────────────────────────────────
// Run fn with the canvas set so that something drawn standing at
// (x, MGY) lands standing at (x, MGY + d), scaled for its depth.
// yOff lifts it (floors, jumps) without scaling the lift.
export function atDepth(ctx, x, d, fn, yOff = 0) {
  const k = depthSc(d);
  ctx.save();
  ctx.translate(x, MGY + d + yOff);
  ctx.scale(k, k);
  ctx.translate(-x, -MGY);
  fn();
  ctx.restore();
}
