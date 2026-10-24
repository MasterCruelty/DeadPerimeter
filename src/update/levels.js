// Upper floors for the AI: followers and rescued civilians go up and
// down with the lead.
//
// A level is the street (null) or one platform (a building's upper
// floor or a fire-escape ledge). When the lead is on another level, a
// follower walks to a stair / ladder that links the two (heading to
// the back of the band first, like the lead), climbs it with the
// lead's climb and keeps formation up there: a floor is a single line
// at depth 0, so the squad spaces out along x. From one floor to
// another it goes down to the street first. No way there (nothing
// reaches the lead's floor, or it can't get to the stair): it stays
// on its level and fights from there, and looks again a bit later.
import { MGY } from '../data/expeditions.js';
import { DEPTH_SPD, dep, stepDepth, holdFork, inForkAt, roadOf } from './depth.js';

export const CLIMB_SPD = 2.2;
// Start the climb from this far back in the band (the climb slides
// the rest of the way to the wall).
const FOOT_DEPTH = 24;
const RETRY_MS = 1500;
const STUCK_MS = 4000;
// Two climbing the same stair keep this far apart.
const CLIMB_GAP = 26;

const topOf = p => p.y - MGY;
const onIt = (p, x, pad = 2) => x >= p.x - pad && x <= p.x + p.w + pad;

export const platformAt = (m, x, sy) =>
  (m.platforms || []).find(p => onIt(p, x) && Math.abs(topOf(p) - sy) < 3) || null;

// The platform a ladder's top opens onto.
export const ladderTop = (m, l) =>
  (m.platforms || []).find(p => onIt(p, l.x, 20) && Math.abs(p.y - l.yTop) < 3) || null;

const laddersOf = (m, p) => (m.ladders || []).filter(l => Math.abs(l.yTop - p.y) < 3 && onIt(p, l.x, 20));

// The level someone is on, or heading to while on a ladder (a jump
// counts as the level it left).
export function levelOf(m, e) {
  if (e.climbing) return e.climbing.dir < 0 ? ladderTop(m, e.climbing.ladder) : null;
  const sy = e.standingY || 0;
  return sy < 0 ? platformAt(m, e.x, sy) : null;
}

// One climb step (same speed and slide to the wall as the lead's).
// The direction follows where the lead is now.
function climbStep(m, e, want, dt, spd) {
  const l = e.climbing.ladder;
  e.climbing.dir = want && want === ladderTop(m, l) ? -1 : 1;
  e.x = l.x;
  stepDepth(e, 0, 4 * (dt / 16));
  e.standingY = (e.standingY || 0) + e.climbing.dir * spd * (dt / 16);
  e.jumpY = 0; e.vy = 0;
  const top = l.yTop - MGY;
  if (e.standingY <= top) { e.standingY = top; e.depth = 0; e.climbing = null; }
  else if (e.standingY >= 0) { e.standingY = 0; e.climbing = null; }
  if (e.state === 'idle') e.state = 'walk';
}

// The stair / ladder to take from `here` toward `want`: down from a
// floor first, else up to the lead's floor. Nearest wins; one inside
// the fork is out of reach from its front road.
function pickLadder(m, e, here, want, lead) {
  let ls, cost;
  if (here) { ls = laddersOf(m, here); cost = l => Math.abs(l.x - e.x) + 0.5 * Math.abs(l.x - lead.x); }
  else {
    ls = laddersOf(m, want).filter(l => !(inForkAt(m, l.x) && inForkAt(m, e.x) && roadOf(dep(e)) !== 0));
    cost = l => Math.abs(l.x - e.x);
  }
  return ls.reduce((a, b) => (!a || cost(b) < cost(a) ? b : a), null);
}

// Someone else from the party just set off on this ladder the same
// way: wait for them to get a little ahead.
const queued = (m, e, l, dir) => [m.soldier, ...(m.followers || []), ...(m.rescuables || [])].some(o =>
  o && o !== e && o.hp > 0 && o.climbing && o.climbing.ladder === l && o.climbing.dir === dir
  && Math.abs((o.standingY || 0) - (dir < 0 ? 0 : l.yTop - MGY)) < CLIMB_GAP);

// Walk along a floor toward x (a single line, kept on it).
function walkFloor(e, p, x, spd) {
  const tx = Math.max(p.x + 8, Math.min(p.x + p.w - 8, x));
  const dx = tx - e.x;
  e.depth = 0;
  if (Math.abs(dx) > 4) {
    e.x += Math.sign(dx) * Math.min(Math.abs(dx), spd);
    e.facing = dx > 0 ? 1 : -1;
    if (e.state === 'idle') e.state = 'walk';
  } else if (e.state === 'walk') e.state = 'idle';
}

// Formation slot on a floor: behind the lead, or ahead of it when the
// floor ends behind.
function floorSlot(p, lead, k) {
  const x = lead.x - k * lead.facing;
  return onIt(p, x, -8) ? x : lead.x + k * lead.facing;
}

// Moves `e` when it is (or has to get) off the street level the
// ground code handles. `slot` is its distance behind the lead.
// Returns false when both are on the street (the caller moves it), or
// when `busy` (reloading, swinging) holds it in place between climbs.
export function followLevel(m, e, lead, now, dt, { spd, slot, climbSpd = CLIMB_SPD, busy = false }) {
  const want = levelOf(m, lead);
  if (e.climbing) { climbStep(m, e, want, dt, climbSpd); return true; }
  const here = levelOf(m, e);
  if (busy) return !!here;
  if (want === here || now < (e._lvlRetry || 0)) {
    e._lvlGoal = null;
    if (!here) return false;
    walkFloor(e, here, want === here ? floorSlot(here, lead, slot) : lead.x, spd);
    return true;
  }
  const l = pickLadder(m, e, here, want, lead);
  if (!l) { e._lvlRetry = now + RETRY_MS; return followLevel(m, e, lead, now, dt, { spd, slot, climbSpd }); }
  const dx = l.x - e.x;
  // Stuck (a barricade, the median, a crowd): give up for a while.
  const left = Math.abs(dx) + (here ? 0 : Math.max(0, dep(e) - FOOT_DEPTH));
  const g = e._lvlGoal;
  if (!g || g.l !== l || left < g.left - 2) e._lvlGoal = { l, left, stuck: 0 };
  else if ((g.stuck += dt) > STUCK_MS) {
    e._lvlGoal = null; e._lvlRetry = now + RETRY_MS;
    return followLevel(m, e, lead, now, dt, { spd, slot, climbSpd });
  }
  const dir = here ? 1 : -1;
  if (Math.abs(dx) < 6 && (here || dep(e) <= FOOT_DEPTH)) {
    if (!queued(m, e, l, dir)) {
      e.climbing = { ladder: l, dir };
      e._lvlGoal = null;
      climbStep(m, e, want, dt, climbSpd);
    } else if (e.state === 'walk') e.state = 'idle';
    return true;
  }
  if (here) { walkFloor(e, here, l.x, spd); return true; }
  // On the street: to the back of the band while walking over.
  const prev = dep(e);
  stepDepth(e, Math.min(prev, FOOT_DEPTH - 6), spd * DEPTH_SPD * 1.2);
  holdFork(m, e, prev);
  if (Math.abs(dx) > 4) {
    e.x += Math.sign(dx) * Math.min(Math.abs(dx), spd);
    e.facing = dx > 0 ? 1 : -1;
  }
  if (e.state === 'idle') e.state = 'walk';
  return true;
}
