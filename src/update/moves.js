// Sortie moveset for the lead soldier, on top of walk / jump / fire:
//
//   Shift  dodge roll: a short dash with invulnerability frames,
//          costs stamina, has a cooldown.
//   G      frag grenade: thrown in an arc, bounces, goes off after a
//          fuse. Radius damage to the dead, hostile survivors and (at
//          a reduced rate) the squad. Loud: it wakes everything around.
//   R      manual reload. Rounds left in the old magazine are kept
//          loose and repacked into a spare once there are enough.
//   Q      swap between the gun and the melee weapon. Holstered, fire
//          swings the melee weapon and the auto-melee takes over.
//   F      melee swing on demand (the automatic one when the gun is
//          dry stays).
//
// Plus the hit-feel timers the frame loop applies (see juiceStep):
// hitstop on melee hits and kills, slow motion when a Brute, Col.
// Voss or the lead goes down, and screen shake per weapon / blast.
// AI followers keep their old behaviour.
import { uid, C } from '../constants.js';
import { WPN, wbase } from '../data/weapons.js';
import { meleeStats, spendStam, SWING_COST } from '../entities/gear.js';
import { MISSION_W, MGY } from '../data/expeditions.js';
import { barricadeBetween } from './cityMission.js';
import { bulletHitsSide } from './missionExtras.js';
import { pushRadio } from '../audio/radio.js';
import { t } from '../i18n/index.js';

export const ROLL_MS = 320, ROLL_CD = 650, ROLL_COST = 22;
export const NADE_START = 2, NADE_MAX = 4;
export const NADE_FUSE = 1450;
const NADE_R = 95, NADE_DMG = 140, NADE_GRAV = 0.32;
const THROW_CD = 650, MELEE_REACH = 54;

export const dodging = p => !!p && (p.rollT || 0) > 0;
export const nadesOf = m => m.grenades ?? NADE_START;

// ── Juice ───────────────────────────────────────────────────────
const juice = m => m.juice || (m.juice = { stop: 0, slow: 1, shake: 0 });
export function hitstop(m, ms) { const j = juice(m); j.stop = Math.max(j.stop, ms); }
export function slowmo(m, k = 0.3) { const j = juice(m); j.slow = Math.min(j.slow, k); }
export function addShake(m, v) { const j = juice(m); j.shake = Math.min(9, j.shake + v); }

// Real frame time in, simulation time out: 0 while a hitstop holds,
// scaled down during slow motion (recovers to full speed in ~0.8 s).
// m._ts is the same scale for the per-frame bullet step.
export function juiceStep(m, dt) {
  const j = juice(m);
  j.shake = Math.max(0, j.shake - dt * 0.026);
  if (j.stop > 0) { j.stop -= dt; m._ts = 0; return 0; }
  j.slow = Math.min(1, j.slow + dt * 0.0009);
  m._ts = j.slow;
  return dt * j.slow;
}

let reduceMotion = null;
// Screen-space offset for the world layer. Half the shake value, so
// the strongest blast moves the picture by ~4 px; none at all when
// the browser asks for reduced motion.
export function shakeOffset(m) {
  const a = (m.juice && m.juice.shake) || 0;
  if (a <= 0.05) return [0, 0];
  if (reduceMotion === null) {
    try { reduceMotion = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { reduceMotion = false; }
  }
  if (reduceMotion) return [0, 0];
  return [Math.round((Math.random() - 0.5) * a), Math.round((Math.random() - 0.5) * a * 0.7)];
}

// Recoil shake for the lead's shot, by weapon class.
export function kick(m, w) {
  const b = wbase(w);
  addShake(m, b === 'shotgun' ? 3.2 : b === 'sniper' ? 2.6 : b === 'rifle' ? (WPN[w].dmg >= 30 ? 1.5 : 0.9) : 0.6);
}

// Called by the frame loop after each update: reacts to what the
// update did (kills, a Brute / Voss / the lead going down).
export function juiceWatch(m) {
  const k = m.killedCount || 0;
  if (m._jKills !== undefined && k > m._jKills) hitstop(m, 34);
  m._jKills = k;
  m.zombies.forEach(z => {
    if (z.type === 'brute' && z.state === 'dead' && !z._jDone) { z._jDone = true; slowmo(m, 0.3); addShake(m, 6); }
  });
  (m.humans || []).forEach(h => {
    if (h.colonel && h.state === 'dead' && !h._jDone) { h._jDone = true; slowmo(m, 0.3); addShake(m, 5); }
  });
  const lead = m._jLead;
  if (lead && (lead.hp <= 0 || lead.state === 'dead') && !lead._jDone) {
    lead._jDone = true; slowmo(m, 0.35); addShake(m, 5);
  }
  m._jLead = m.soldier;
}

// ── Roll ────────────────────────────────────────────────────────
// Movement half of the roll, called from the lead movement block.
// Returns true while rolling (normal walking is skipped then).
export function rollStep(m, s, dt) {
  if (!dodging(s)) return false;
  s.rollT = Math.max(0, s.rollT - dt);
  s.x += s.rollDir * 0.36 * dt * (s.rollT > ROLL_MS * 0.25 ? 1 : 0.5);
  s.facing = s.rollDir;
  return true;
}

function tryRoll(m, s, now) {
  const onSurface = (s.jumpY || 0) === 0 && (s.vy || 0) === 0;
  if (dodging(s) || (s.rollCd || 0) > 0 || s.climbing || !onSurface || s.state === 'knife') return;
  if (!spendStam(s, ROLL_COST)) { note(m, s, now, t('TOO WINDED'), '#ffaa33'); return; }
  s.rollDir = m.inputRight ? 1 : m.inputLeft ? -1 : s.facing || 1;
  s.rollT = ROLL_MS; s.rollCd = ROLL_MS + ROLL_CD; s.rollAt = now;
  if (s.state === 'shoot' || s.state === 'walk') s.state = 'idle';
  m.soundQ.push({ t: 'roll', x: s.x });
}

// ── Grenades ────────────────────────────────────────────────────
function throwNade(m, s, now) {
  if (dodging(s) || s.climbing || (s.throwCd || 0) > 0) return;
  if (nadesOf(m) <= 0) { note(m, s, now, t('NO GRENADES'), C.dng); return; }
  m.grenades = nadesOf(m) - 1;
  s.throwCd = THROW_CD; s.throwAt = now;
  const moving = m.inputLeft || m.inputRight;
  (m.nades || (m.nades = [])).push({
    id: uid(), x: s.x + s.facing * 10, y: MGY - 44 + (s.standingY || 0) + (s.jumpY || 0) + (s._laneY || 0),
    vx: s.facing * (moving ? 5.8 : 4.9), vy: -4.7, at: now, src: s, spin: 0,
  });
  m.soundQ.push({ t: 'pin', x: s.x });
  pushRadio(m, 'kill', { line: 'Frag out!', speaker: s, cooldown: 2500 });
}

function stepNades(m, now, dt, H) {
  const f = dt / 16;
  m.nades = (m.nades || []).filter(g => {
    const ox = g.x, oy = g.y;
    g.vy += NADE_GRAV * f;
    g.x += g.vx * f; g.y += g.vy * f;
    g.spin += g.vx * 0.12 * f;
    // A standing barricade or the map edge throws it back.
    if (barricadeBetween(m, ox, g.x) || g.x < 8 || g.x > MISSION_W - 8) { g.x = ox; g.vx *= -0.35; }
    // Land on a floor / ledge on the way down, or on the street.
    let floor = MGY - 6;
    if (g.vy > 0) {
      for (const p of (m.platforms || [])) {
        if (g.x >= p.x && g.x <= p.x + p.w && oy <= p.y - 6 && g.y >= p.y - 6) { floor = p.y - 6; break; }
      }
    }
    if (g.y >= floor) {
      g.y = floor;
      if (Math.abs(g.vy) > 1.2) m.soundQ.push({ t: 'clink', x: g.x });
      g.vy = Math.abs(g.vy) > 1.2 ? -g.vy * 0.33 : 0;
      g.vx *= 0.55;
    }
    if (g.vy === 0) {
      g.vx *= Math.pow(0.86, f);
      // Rolled off a ledge.
      if (g.y < MGY - 7 && !(m.platforms || []).some(p => g.x >= p.x && g.x <= p.x + p.w && Math.abs(p.y - 6 - g.y) < 2)) g.vy = 0.5;
    }
    if (now - g.at >= NADE_FUSE) { blast(m, g.x, g.y, now, g.src, H); return false; }
    return true;
  });
}

// Radius damage + knockback + noise around (x, y).
function blast(m, x, y, now, src, H) {
  const R = NADE_R;
  const fall = (tx, ty) => {
    const d = Math.hypot(tx - x, (ty - y) * 1.3);
    return d > R ? 0 : 1 - 0.6 * (d / R);
  };
  const bodyY = p => MGY - 30 + (p.standingY || 0) + (p.jumpY || 0);
  // A locked barricade takes the blast for whatever is behind it.
  const shielded = e => barricadeBetween(m, x, e.x);
  m.soundQ.push({ t: 'grenade', x });
  m.effects.push({ type: 'blast', x, y, r: R, at: now, dur: 720, seed: Math.random() * 1000 });
  const lead = m.soldier;
  addShake(m, Math.abs(lead.x - x) < 700 ? 7 * (1 - Math.abs(lead.x - x) / 900) : 0);

  const credit = () => { m.killedCount++; if (src) src._kills = (src._kills || 0) + 1; };
  m.zombies.forEach(z => {
    if (z.state === 'dead') return;
    const k = shielded(z) ? 0 : fall(z.x, bodyY(z));
    if (k <= 0) return;
    const dmg = Math.round(NADE_DMG * k);
    z.hp -= dmg; z.hurtTimer = 260; z.atkTimer = 0;
    if (!z.activated) { z.activated = true; m.activatedCount++; }
    z.x = Math.max(20, Math.min(MISSION_W - 20, z.x + Math.sign(z.x - x || 1) * (z.type === 'brute' ? 6 : 26) * k));
    m.effects.push({ type: 'txt', x: z.x, y: MGY - 60 + (z.standingY || 0), v: `-${dmg}`, col: '#ffaa33', at: now, dur: 700 });
    if (z.hp <= 0) {
      z.hp = 0; z.state = 'dead'; z.deadAt = now; credit();
      m.soundQ.push({ t: 'zdie', zt: z.type, x: z.x });
      if (z.type === 'brute') {
        m.effects.push({ type: 'txt', x: z.x, y: MGY - 110, v: t('☠ BRUTE DOWN'), col: '#ffcc44', at: now, dur: 2400 });
        pushRadio(m, 'kill', { line: 'Big one is down!', speaker: lead, cooldown: 0 });
      }
    }
  });
  // The nest side objective burns like a target too.
  const sd = m.side;
  if (sd && sd.type === 'nest' && sd.state === 'active' && !shielded(sd)) {
    const k = fall(sd.x, MGY - 20);
    if (k > 0) bulletHitsSide(m, { x: sd.x, y: MGY - 20, dmg: Math.round(NADE_DMG * k), shooterY: 0 }, now);
  }
  (m.humans || []).forEach(h => {
    if (h.state === 'dead' || !h.hostile) return;
    const k = shielded(h) ? 0 : fall(h.x, bodyY(h));
    if (k <= 0) return;
    const dmg = Math.round(NADE_DMG * 0.8 * k);
    h.hp -= dmg; h.hurtTimer = 260; h._hitAt = now;
    h.x = Math.max(20, Math.min(MISSION_W - 20, h.x + Math.sign(h.x - x || 1) * 18 * k));
    m.effects.push({ type: 'txt', x: h.x, y: MGY - 60, v: `-${dmg}`, col: '#ffaa33', at: now, dur: 700 });
    if (h.hp <= 0) {
      h.hp = 0; h.state = 'dead'; h.deadAt = now; credit();
      if (h.colonel) {
        m.effects.push({ type: 'txt', x: h.x, y: MGY - 110, v: t('★ COL. VOSS DOWN'), col: '#ffd54a', at: now, dur: 2600 });
        pushRadio(m, 'kill', { line: 'The colonel is down! Their line is breaking!', speaker: lead, cooldown: 0 });
      }
    }
  });
  // Friendly fire: the squad takes a third of it (a roll dodges it).
  [m.soldier, ...(m.followers || [])].forEach(p => {
    if (!p || p.hp <= 0 || p.state === 'dead' || dodging(p)) return;
    const k = shielded(p) ? 0 : fall(p.x, bodyY(p));
    if (k <= 0) return;
    const dmg = Math.round(NADE_DMG * 0.33 * k);
    p.hp -= dmg; p.hurtTimer = 320;
    m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: `-${dmg}`, col: '#ff4400', at: now, dur: 900 });
    if (p.hp <= 0) {
      p.hp = 0; p.state = 'dead';
      if (p.id === m.soldier.id) H.promoteLeadOnDeath(m, now);
    }
  });
  // Mines in the blast go off too.
  (m.hazards || []).forEach(h => {
    if (h.type === 'mine' && !h.triggered && Math.abs(h.x - x) < R && m._detonateMine) m._detonateMine(h, now);
  });
  // Noise: the dead far around come for it, hostiles on alert.
  m.zombies.forEach(z => {
    if (z.state !== 'dead' && !z.activated && Math.abs(z.x - x) < 650) { z.activated = true; m.activatedCount++; }
  });
  (m.humans || []).forEach(h => { if (h.hostile && h.state !== 'dead' && Math.abs(h.x - x) < 520) H.alertHumans(m, h); });
  if (m.zombies.some(z => z.state !== 'dead' && Math.abs(z.x - x) < 650)) m.soundQ.push({ t: 'groan', now, zt: 'walker', x: x + 300 });
}

// ── Melee on demand ─────────────────────────────────────────────
function tryMelee(m, s, now, H) {
  if (dodging(s) || s.climbing || s.state === 'reload' || (s.meleeCd || 0) > 0) return;
  const ms = meleeStats(s);
  s.meleeCd = ms.rate * 0.8; s.knifeTimer = 0;
  s.state = 'knife'; s.shootAt = now;
  const sy = (s.standingY || 0) + (s.jumpY || 0);
  const inReach = e => e.state !== 'dead' && e.hp > 0
    && Math.abs(e.x - s.x) < MELEE_REACH && (e.x - s.x) * s.facing > -12
    && Math.abs((e.standingY || 0) - sy) < 24;
  const tgt = m.zombies.filter(inReach).concat((m.humans || []).filter(h => h.hostile && inReach(h)))
    .sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
  if (!tgt) {
    spendStam(s, SWING_COST * 0.5);
    m.soundQ.push({ t: 'swish', x: s.x });
    return;
  }
  s.facing = tgt.x > s.x ? 1 : -1;
  H.meleeHit(m, s, tgt, now);
  if (tgt.state !== 'dead') {
    // Whatever was hit is awake now; survivors call their friends.
    if (!tgt.type) H.alertHumans(m, tgt);
    else if (!tgt.activated) { tgt.activated = true; m.activatedCount++; }
  }
  tgt.atkTimer = 0;
  if (tgt.state !== 'dead') tgt.x += s.facing * (tgt.type === 'brute' ? 2 : 9);
  hitstop(m, 60); addShake(m, 2.2);
}

// ── Reload / swap ───────────────────────────────────────────────
function reload(m, s, now) {
  if (dodging(s) || s.state === 'reload') return;
  const w = WPN[s.weapon];
  if (s.ammo >= s.maxAmmo) { if (s.knifeReady) swap(m, s, now); return; }
  if ((s.magsLeft || 0) <= 0) {
    // No full magazines left: load whatever loose rounds there are.
    if ((s._loose || 0) <= 0) { note(m, s, now, t('NO SPARE MAGS'), C.dng); return; }
    const n = Math.min(s._loose, s.maxAmmo - s.ammo);
    s.ammo += n; s._loose -= n;
  } else {
    s._loose = (s._loose || 0) + s.ammo;
    s.ammo = s.maxAmmo; s.magsLeft -= 1;
    if (s._loose >= s.maxAmmo) { s._loose -= s.maxAmmo; s.magsLeft += 1; }
  }
  s.knifeReady = false;
  s.state = 'reload'; s.reloadStart = now;
  m.soundQ.push({ t: 'reload', w: s.weapon, dur: w.rl * (s.rlMul || 1) });
  pushRadio(m, 'reload', { speaker: s });
}

function swap(m, s, now) {
  if (dodging(s) || s.state === 'reload') return;
  if (s.knifeReady) {
    if (s.ammo <= 0 && (s.magsLeft || 0) <= 0 && (s._loose || 0) <= 0) { note(m, s, now, t('NO AMMO'), C.dng); return; }
    s.knifeReady = false;
    if (s.ammo <= 0) { reload(m, s, now); return; }
  } else s.knifeReady = true;
  s.state = 'idle'; s.swapAt = now;
  m.soundQ.push({ t: 'swap', x: s.x });
}

// Short status text over the lead, throttled.
function note(m, s, now, v, col) {
  if (now - (m._moveNoteAt || -1e9) < 700) return;
  m._moveNoteAt = now;
  m.effects.push({ type: 'txt', x: s.x, y: MGY - 84 + (s.standingY || 0), v, col, at: now, dur: 900 });
}

// Per-frame tick, called from updateMission after the lead's own
// fire / auto-melee. H carries mission.js helpers (meleeHit,
// alertHumans, promoteLeadOnDeath) to keep this module free of a
// circular import.
export function tickMoves(m, now, dt, H) {
  const s = m.soldier;
  if (m.grenades === undefined) m.grenades = NADE_START;
  // Rooms swap the world: anything still in flight stays behind.
  if (m._nadeRoom !== m.room) { m.nades = []; m._nadeRoom = m.room; }
  s.rollCd = Math.max(0, (s.rollCd || 0) - dt);
  s.throwCd = Math.max(0, (s.throwCd || 0) - dt);
  s.meleeCd = Math.max(0, (s.meleeCd || 0) - dt);
  if (s.hp > 0 && s.state !== 'dead') {
    if (m.inputRoll) tryRoll(m, s, now);
    if (m.inputGrenade) throwNade(m, s, now);
    if (m.inputReload) reload(m, s, now);
    if (m.inputSwap) swap(m, s, now);
    if (m.inputMelee || (m.inputShoot && s.knifeReady && s.ammo > 0)) tryMelee(m, s, now, H);
    if (s.state === 'knife' && now - s.shootAt > 300 && s.ammo > 0 && !s.knifeReady) s.state = 'idle';
  }
  m.inputRoll = m.inputGrenade = m.inputReload = m.inputSwap = m.inputMelee = false;

  stepNades(m, now, dt, H);
}

// Container search: a small chance of a grenade, better in military
// stock. Rooms place their own grenade pickups (update/rooms.js).
const NADE_BOX = { 'ammo-crate': 0.3, 'gun-rack': 0.3, 'evidence-box': 0.22, locker: 0.18, crate: 0.14, container: 0.14 };
export function nadeFind(m, o, now) {
  const p = (NADE_BOX[o.type] || 0.04) * (o.rich ? 1.5 : 1);
  if (Math.random() >= p) return;
  giveNade(m, o.x, now);
}

export function giveNade(m, x, now) {
  if (nadesOf(m) >= NADE_MAX) {
    if (now - (m._nadeFullAt || -1e9) < 1500) return false;
    m._nadeFullAt = now;
    m.effects.push({ type: 'txt', x, y: MGY - 92, v: t('💣 GRENADES FULL'), col: 'rgba(184,204,170,0.8)', at: now, dur: 1000 });
    return false;
  }
  m.grenades = nadesOf(m) + 1;
  m.soundQ.push({ t: 'pickup', x });
  m.effects.push({ type: 'txt', x, y: MGY - 92, v: t('+1 💣 GRENADE'), col: '#ffd54a', at: now, dur: 1300 });
  return true;
}
