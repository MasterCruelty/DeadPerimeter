// Extra mission layers rolled on top of the base sortie (mkMission):
//
//   Conditions (dest.cond, shown on the destination card)
//     night     — dark streets: the dead wake at ~65% of the usual range,
//                 so a careful squad can slip past, but you see less.
//     horde     — +60% dead on the map, loot worth +50%.
//     scavenged — picked over: 30% fewer dead, loot worth 40% less.
//
//   Side objectives (dest.side, optional bonus)
//     cache — a locked military cache. Stand next to it to crack it
//             (5 s, progress kept); the noise draws a pack.
//     nest  — a pulsing nest that keeps birthing walkers while the
//             party is near. Shoot it down for salvage.
//     sos   — a survivor radios for help; reach them before the clock
//             runs out or they're lost.
//
//   Dynamic event (reach missions, MED/HIGH): a car alarm goes off when
//   the lead walks past it, pulling dead in from both sides.
import { uid, rng } from '../constants.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MGY } from '../data/expeditions.js';
import { pushRadio } from '../audio/radio.js';
import { waveMul } from '../data/rewards.js';
import { gearName } from '../entities/gear.js';
import { streetSpot, segAt } from './cityMission.js';
import { addShake } from './moves.js';
import { BAND, SEARCH_DEPTH, dep, dGap, anyDepth } from './depth.js';
import { t } from '../i18n/index.js';
export { MISSION_CONDS, SIDE_OBJ } from '../data/missionExtras.js';

function mz(type, x, activated, extra = {}) {
  const z = ZTP[type];
  return {
    id: uid(), type, z, x, depth: anyDepth(), hp: z.hp, maxHp: z.hp,
    spd: z.spd * (0.85 + Math.random() * 0.3),
    state: activated ? 'walk' : 'idle', facing: -1,
    walkPhase: Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
    activated, ...extra,
  };
}

// Spawn an already-awake pack (counts toward the goal kill-ratio).
function pack(m, xs, types) {
  xs.forEach((x, i) => {
    const t = types[i % types.length];
    m.zombies.push(mz(t, Math.max(30, Math.min(MISSION_W - 30, x)), true,
      t === 'spitter' ? { _spitDmg: m._spitDmgScaled, _spitRate: m._spitRateScaled } : {}));
    m.activatedCount++;
  });
}

// Called at the end of mkMission.
export function setupMissionExtras(m, dest, wave) {
  if (dest._vaccineSegment) return;
  const cond = dest.cond || null, side = dest.side || null;
  m.cond = cond;
  // Conditions are fair trades, not free bonuses (value per unit of risk
  // stays put): night = stealthier but the dead that do wake are runners;
  // horde = more dead, proportionally more loot; picked over = the reverse.
  if (cond === 'night') {
    m.activationMul = 0.65;
    m.zombies.forEach(z => { if (z.type === 'walker' && Math.random() < 0.3) { z.type = 'runner'; z.z = ZTP.runner; z.hp = z.maxHp = ZTP.runner.hp; z.spd = ZTP.runner.spd * (0.85 + Math.random() * 0.3); } });
  }
  if (cond === 'horde') {
    const extra = Math.ceil(m.zombies.filter(z => z.type !== 'brute').length * 0.6);
    for (let i = 0; i < extra; i++) m.zombies.push(mz(Math.random() < 0.7 ? 'walker' : 'runner', 400 + Math.random() * (MISSION_W - 700), false));
  }
  if (cond === 'scavenged') {
    const drop = Math.floor(m.zombies.filter(z => z.type !== 'brute').length * 0.4);
    for (let i = 0; i < drop; i++) {
      const k = m.zombies.findIndex(z => z.type !== 'brute' && !z.activated);
      if (k >= 0) m.zombies.splice(k, 1);
    }
  }
  const lootMul = cond === 'horde' ? 1.6 : cond === 'scavenged' ? 0.6 : 1;
  if (lootMul !== 1) m.pickups.forEach(p => { if (typeof p.value === 'number' && p.type !== 'civilian' && p.type !== 'lostSoldier' && p.type !== 'vaccine') p.value = Math.max(1, Math.round(p.value * lootMul)); });

  if (side === 'cache') {
    m.side = { type: 'cache', x: Math.round(MISSION_W * (0.5 + Math.random() * 0.22)), depth: 8, progress: 0, state: 'active' };
  } else if (side === 'nest') {
    const hp = 300 + wave * 12;
    m.side = { type: 'nest', x: Math.round(MISSION_W * (0.55 + Math.random() * 0.25)), depth: anyDepth(14, BAND - 24), hp, maxHp: hp, nextSpawn: 0, spawned: 0, state: 'active' };
  } else if (side === 'sos') {
    const x = Math.round(MISSION_W * (0.55 + Math.random() * 0.2));
    const r = { id: uid(), name: 'SOS-' + rng(10, 99), x, depth: anyDepth(), hp: 30, maxHp: 30, facing: -1, state: 'idle', hurtTimer: 0, walkPhase: 0, sos: true };
    m.rescuables.push(r);
    m.side = { type: 'sos', x, rid: r.id, timeLimit: dest.risk === 'HIGH' ? 80000 : 70000, state: 'active' };
  }

  // Explore streets: no objective behind a barricade (the SOS timer
  // or the nest would be unreachable until the door is forced).
  if (m.side && m.segs) {
    const sg = segAt(m, m.side.x);
    if (sg && sg.locked) {
      const nx = streetSpot(m, m.side.x);
      if (nx !== null) {
        m.side.x = nx;
        const r = m.side.type === 'sos' && m.rescuables.find(q => q.id === m.side.rid);
        if (r) r.x = nx;
      }
    }
  }

  if (m.objective !== 'defend' && dest.risk !== 'LOW' && Math.random() < 0.38) {
    let x = Math.round(MISSION_W * (0.36 + Math.random() * 0.22));
    if (m.encounter && Math.abs(m.encounter.x - x) < 260) x = Math.min(MISSION_W - 400, m.encounter.x + 320);
    // Explore streets: the car stays outside, in a gap between buildings.
    if (m.segs) x = streetSpot(m, x);
    // Parked at a depth: it's cover too (update/depth.js coverStops).
    if (x !== null) m.alarm = { x, depth: anyDepth(18, BAND - 12), triggered: false };
  }
}

// Bullet vs nest. Returns true when the bullet was consumed.
export function bulletHitsSide(m, b, now) {
  const sd = m.side;
  if (!sd || sd.type !== 'nest' || sd.state !== 'active' || (b.shooterY || 0) !== 0) return false;
  if (Math.abs(b.x - sd.x) > 22 || Math.abs((b.depth || 0) - dep(sd)) > 22) return false;
  sd.hp -= b.dmg; sd.hurtAt = now;
  m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 4 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2, r: 1.5 + Math.random() * 2 })), at: now, dur: 500 });
  m.soundQ.push({ t: 'hit', now, x: b.x });
  if (sd.hp <= 0) {
    sd.state = 'done'; sd.endedAt = now;
    const k = waveMul(m.wave || 1) * (m.valueMul || 1);
    const mats = Math.round(12 * k), meds = Math.round(5 * k);
    m.collected.materials += mats; m.collected.medicine += meds;
    m.soundQ.push({ t: 'explosion', x: sd.x });
    addShake(m, 4);
    m.effects.push({ type: 'txt', x: sd.x, y: MGY - 110 + dep(sd), v: t('NEST DESTROYED  +{m} 🔧 +{d} 💊', { m: mats, d: meds }), col: '#ffcc44', at: now, dur: 2400 });
    pushRadio(m, 'kill', { line: 'Nest is burning!', speaker: m.soldier, cooldown: 0 });
  }
  return true;
}

export function tickMissionExtras(m, now, dt, party) {
  const lead = m.soldier, sd = m.side;
  const elapsed = now - (m.startedAt || now);

  if (m.alarm && !m.alarm.triggered && lead.x >= m.alarm.x - 10) {
    m.alarm.triggered = true; m.alarm.at = now;
    m.soundQ.push({ t: 'siren' });
    pushRadio(m, 'baseHit', { line: 'Car alarm! Here they come!', urgent: true, speaker: lead, cooldown: 0 });
    m.effects.push({ type: 'txt', x: m.alarm.x, y: MGY - 120 + dep(m.alarm), v: t('🚨 CAR ALARM'), col: '#ff9944', at: now, dur: 2200 });
    const n = 3 + Math.floor(Math.random() * 3) + (m.dest.risk === 'HIGH' ? 1 : 0);
    const ahead = Array.from({ length: Math.ceil(n / 2) }, (_, i) => m.alarm.x + 420 + i * 40);
    const behind = Array.from({ length: Math.floor(n / 2) }, (_, i) => m.alarm.x - 420 - i * 40);
    pack(m, [...ahead, ...behind], ['runner', 'walker', 'runner']);
  }

  if (!sd || sd.state !== 'active') return;
  const near = (x, r, rd = Infinity) => party.find(p => Math.abs(p.x - x) < r && Math.abs(p.standingY || 0) < 18 && dGap(p, sd) < rd);

  if (sd.type === 'cache') {
    const p = near(sd.x, 34, SEARCH_DEPTH);
    if (p) {
      if (sd.progress === 0) {
        pushRadio(m, 'deploy', { line: 'Cracking the cache. Cover me!', speaker: p, cooldown: 0 });
        pack(m, [sd.x + 380, sd.x + 430, sd.x - 400], ['walker', 'runner', 'walker']);
      }
      sd.progress = Math.min(1, sd.progress + dt / 5000);
      if (Math.floor(now / 380) !== Math.floor((now - dt) / 380)) m.soundQ.push({ t: 'reload', w: 'pistol', dur: 300 });
      if (sd.progress >= 1) {
        sd.state = 'done'; sd.endedAt = now;
        const c = m.collected;
        const k = waveMul(m.wave || 1) * (m.valueMul || 1);
        const got = { ammo: Math.round(36 * k), sniperAmmo: Math.round(4 * k), turretAmmo: Math.round(24 * k), medicine: Math.round(5 * k) };
        Object.entries(got).forEach(([t, v]) => { c[t] += v; });
        // A military cache sometimes holds a rifle.
        if (Math.random() < 0.35) {
          const item = { kind: 'gun', w: Math.random() < 0.5 ? 'ak' : 'hunting' };
          (c.gear || (c.gear = [])).push(item);
          m.effects.push({ type: 'txt', x: sd.x, y: MGY - 124 + dep(sd), v: `🔫 ${t(gearName(item)).toUpperCase()}!`, col: '#ffd54a', at: now, dur: 2600 });
        }
        m.soundQ.push({ t: 'pickup', x: sd.x });
        m.effects.push({ type: 'txt', x: sd.x, y: MGY - 100 + dep(sd), v: t('CACHE OPEN  +{a} 🔫 +{s} 🎯 +{tu} 🟠 +{m} 💊', { a: got.ammo, s: got.sniperAmmo, tu: got.turretAmmo, m: got.medicine }), col: '#ffd54a', at: now, dur: 2600 });
      }
    }
  } else if (sd.type === 'nest') {
    if (near(sd.x, 650) && now >= sd.nextSpawn) {
      const alive = m.zombies.filter(z => z._fromNest && z.state !== 'dead').length;
      if (alive < 4) {
        m.zombies.push(mz('walker', sd.x + 10, true, { _fromNest: true, depth: dep(sd) }));
        m.activatedCount++; sd.spawned++;
        m.soundQ.push({ t: 'groan', now, zt: 'walker', x: sd.x });
      }
      sd.nextSpawn = now + 6500;
    }
  } else if (sd.type === 'sos') {
    const r = m.rescuables.find(q => q.id === sd.rid);
    if (!r || r.hp <= 0 || r.state === 'dead') { sd.state = 'failed'; sd.endedAt = now; return; }
    if (r.state === 'following') {
      sd.state = 'done'; sd.endedAt = now;
      pushRadio(m, 'kill', { line: 'Got the survivor! Get them to the exit!', speaker: lead, cooldown: 0 });
    } else if (elapsed > sd.timeLimit) {
      r.hp = 0; r.state = 'dead';
      sd.state = 'failed'; sd.endedAt = now;
      m.effects.push({ type: 'txt', x: r.x, y: MGY - 90 + dep(r), v: t('SOS SIGNAL LOST'), col: '#ee5544', at: now, dur: 2400 });
      pushRadio(m, 'hurt', { line: 'SOS went quiet... we were too late.', speaker: lead, cooldown: 0 });
    }
  }
}

export const sosLeft = (m, now) => {
  const sd = m.side;
  return sd && sd.type === 'sos' && sd.state === 'active' ? Math.max(0, Math.ceil((sd.timeLimit - (now - (m.startedAt || now))) / 1000)) : null;
};
