import { C, CH, uid, rng } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MISSION_VIEW, MGY, objIcons } from '../data/expeditions.js';
import { BIOMES, DEFAULT_BIOME } from '../data/biomes.js';
import { BALANCE } from '../data/difficulty.js';
import { dZombie } from '../render/zombie.js';
import { dSoldier } from '../render/soldier.js';
import { dFx, dBlt } from '../render/effects.js';

export function mkMission(soldier, dest) {
  const zombies = [], pickups = [], obstacles = [];
  const totalZ = Math.floor(8 * dest.zSpawn + rng(0, 4));
  for (let i = 0; i < totalZ; i++) {
    const x = 400 + Math.random() * (MISSION_W - 700);
    const types = dest.risk === 'LOW' ? ['walker']
      : dest.risk === 'MED' ? ['walker', 'walker', 'runner', 'spitter']
      : ['walker', 'runner', 'runner', 'tank', 'spitter'];
    const t = types[Math.floor(Math.random() * types.length)];
    const z = ZTP[t];
    zombies.push({
      id: uid(), type: t, z, x, hp: z.hp, maxHp: z.hp,
      spd: z.spd * (0.85 + Math.random() * 0.3),
      state: 'idle', facing: -1,
      walkPhase: Math.random() * Math.PI * 2,
      atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
      activated: false,
    });
  }

  const pkOptions = dest.risk === 'LOW' ? ['medicine', 'medicine', 'food']
    : dest.risk === 'MED' ? ['ammo', 'ammo', 'materials', 'sniperAmmo', 'turretAmmo']
    : ['ammo', 'medicine', 'food', 'materials', 'sniperAmmo', 'turretAmmo'];
  const pkCount = dest.risk === 'LOW' ? 4 : dest.risk === 'MED' ? 5 : 7;
  for (let i = 0; i < pkCount; i++) {
    const x = 300 + Math.floor(MISSION_W / (pkCount + 1)) * (i + 1) + rng(-60, 60);
    const type = pkOptions[Math.floor(Math.random() * pkOptions.length)];
    const value = type === 'medicine' ? rng(4, 8)
      : type === 'ammo' ? rng(8, 15)
      : type === 'food' ? rng(5, 10)
      : type === 'sniperAmmo' ? rng(2, 4)
      : type === 'turretAmmo' ? rng(6, 14)
      : rng(3, 6);
    pickups.push({ id: uid(), x, type, value, collected: false });
  }
  const civChance = dest.risk === 'HIGH' ? 1.0 : dest.risk === 'MED' ? 0.5 : 0;
  if (Math.random() < civChance) pickups.push({ id: uid(), x: MISSION_W - 200, type: 'civilian', value: 1, collected: false });

  // Mission objective: 70% normal "reach the goal", 30% "defend".
  // DEFEND missions replace the run-to-goal with holding a marked
  // position for `defendDuration` ms while zombies pile in from the right.
  const objective = (dest.risk !== 'LOW' && Math.random() < 0.30) ? 'defend' : 'reach';
  const defendAnchor = MISSION_W * 0.65;
  const defendDuration = 45000;

  // End-of-stage Brute boss on HIGH-risk runs.
  if (dest.risk === 'HIGH') {
    const z = ZTP.brute;
    zombies.push({
      id: uid(), type: 'brute', z,
      x: MISSION_W - 220,
      hp: z.hp, maxHp: z.hp,
      spd: z.spd,
      state: 'idle', facing: -1,
      walkPhase: Math.random() * Math.PI * 2,
      atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
      activated: false,
    });
  }

  // Rescuable civilians along the path. They cower in place; once a
  // party member touches them they follow the lead and count toward
  // collected.rescuedCivs at the goal. Killable by zombies.
  const rescuables = [];
  const rcCount = dest.risk === 'LOW' ? rng(0, 1) : dest.risk === 'MED' ? rng(1, 2) : rng(1, 2);
  const rcNames = ['Survivor', 'Refugee', 'Doctor', 'Nurse', 'Engineer', 'Teacher'];
  for (let i = 0; i < rcCount; i++) {
    rescuables.push({
      id: uid(),
      name: rcNames[Math.floor(Math.random() * rcNames.length)] + '-' + (Math.floor(Math.random() * 90) + 10),
      x: 500 + Math.floor(MISSION_W / (rcCount + 2)) * (i + 1) + rng(-80, 80),
      hp: 30, maxHp: 30,
      facing: 1,
      state: 'idle',         // 'idle' | 'following' | 'dead'
      hurtTimer: 0,
      walkPhase: Math.random() * Math.PI * 2,
    });
  }

  // Biome-aware obstacle layout. Count varies per run so two LOW
  // missions don't have an identical-looking street.
  const biomeKey = dest.biome || DEFAULT_BIOME;
  const biome = BIOMES[biomeKey] || BIOMES[DEFAULT_BIOME];
  const obsCount = rng(4, 9);
  for (let i = 0; i < obsCount; i++) {
    const ox = 200 + i * MISSION_W / (obsCount + 1) + rng(-50, 50);
    const otype = biome.obstacles[Math.floor(Math.random() * biome.obstacles.length)];
    obstacles.push({ x: ox, type: otype });
  }
  // Decorative props every biome.propsPerStep along the road
  // (lampposts, fences, broken streetlights). Stored separately so the
  // renderer can layer them behind/around the obstacles.
  const props = [];
  for (let px = biome.propsPerStep; px < MISSION_W - 50; px += biome.propsPerStep) {
    props.push({ x: px + rng(-30, 30), type: biome.propType });
  }

  // Hazards: mines (one-shot AoE) + acid pools (slow + dot).
  // Density scales with risk so HIGH runs feel actively dangerous.
  const hazards = [];
  const mineCount = dest.risk === 'LOW' ? 0 : dest.risk === 'MED' ? rng(1, 2) : rng(2, 4);
  const acidCount = dest.risk === 'LOW' ? 0 : dest.risk === 'MED' ? rng(0, 1) : rng(1, 3);
  for (let i = 0; i < mineCount; i++) {
    hazards.push({
      id: uid(), type: 'mine',
      x: 350 + Math.random() * (MISSION_W - 600),
      dmg: 30, triggered: false, triggeredAt: 0,
    });
  }
  for (let i = 0; i < acidCount; i++) {
    const cx = 400 + Math.random() * (MISSION_W - 700);
    hazards.push({
      id: uid(), type: 'acid',
      x: cx, w: 50 + Math.floor(Math.random() * 40),
      dmg: 2, // per tick
    });
  }

  // Accept either a single soldier (legacy callers) or an array.
  // The first soldier becomes the player-controlled lead; the rest follow
  // as AI-driven companions that fire on hostiles in range.
  const partySoldiers = Array.isArray(soldier) ? soldier : [soldier];
  const lead = partySoldiers[0];

  const buildMissionSoldier = (orig, offset) => ({
    id: uid(), origId: orig.id, name: orig.name, weapon: orig.weapon,
    x: 80 - offset * 30, lane: 0, hp: orig.hp, maxHp: orig.maxHp,
    ammo: Math.max(0, orig.ammo | 0),
    maxAmmo: orig.maxAmmo,
    civilian: !!orig.civilian,
    state: 'idle', facing: 1,
    lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0,
    walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0, reloadTriggered: false,
    onExpedition: true,
  });

  const msol = buildMissionSoldier(lead, 0);
  const followers = partySoldiers.slice(1).map((s, i) => buildMissionSoldier(s, i + 1));

  return {
    soldier: msol, followers,
    origSoldier: lead,                   // back-compat: legacy field points to lead
    origSoldiers: partySoldiers,         // full original-soldiers list (for finishMission)
    dest, biomeKey,
    objective, defendAnchor, defendDuration,
    defendStartedAt: 0, defendNextSpawn: 0,
    zombies, pickups, obstacles, props, hazards, rescuables,
    bullets: [], effects: [], soundQ: [],
    cameraX: 0,
    inputLeft: false, inputRight: false, inputShoot: false,
    state: 'active',
    // Activation tracking for the goal kill-ratio gate
    activatedCount: 0, killedCount: 0, _lastGoalHint: 0,
    collected: { ammo: 0, medicine: 0, food: 0, materials: 0, sniperAmmo: 0, turretAmmo: 0, civilian: null, rescuedCivs: 0 },
    startedAt: 0, endedAt: 0,
  };
}

// Returns every living party member (lead + alive followers).
function aliveParty(m) {
  const out = m.soldier.hp > 0 ? [m.soldier] : [];
  (m.followers || []).forEach(f => { if (f.hp > 0 && f.state !== 'dead') out.push(f); });
  return out;
}

// Returns every "thing" zombies are willing to chase / hit: party
// members + alive rescuables. Used for activation distance + zombie
// target selection. Rescuables can take dmg and die but their death
// does not end the mission.
function aliveTargets(m) {
  const out = aliveParty(m).slice();
  (m.rescuables || []).forEach(r => { if (r.hp > 0 && r.state !== 'dead') out.push(r); });
  return out;
}

// Shared AI tick for shooting + knife melee. Used by both the lead
// (when its ammo is dry and the player wants to mash forward — handled
// inline below) and by the followers (always automatic).
function aiShoot(m, who, now, dt) {
  const w = WPN[who.weapon];
  // Reload completion
  if (who.state === 'reload' && now - who.reloadStart >= w.rl) {
    who.state = 'idle'; who.reloadTriggered = false;
  }
  if (who.state === 'reload') return;

  // Pick nearest activated zombie in range
  const tgt = m.zombies
    .filter(z => z.state !== 'dead' && z.activated && Math.abs(z.x - who.x) <= w.range)
    .sort((a, b) => Math.abs(a.x - who.x) - Math.abs(b.x - who.x))[0];

  if (!tgt) {
    if (who.state === 'shoot' && now - who.shootAt > 200) who.state = 'idle';
    return;
  }
  who.facing = tgt.x > who.x ? 1 : -1;

  if (who.ammo <= 0) {
    // Knife melee fallback (same logic as the lead)
    const meleeTgt = m.zombies.find(z => z.state !== 'dead' && Math.abs(z.x - who.x) < 52);
    if (meleeTgt) {
      who.facing = meleeTgt.x > who.x ? 1 : -1;
      who.knifeTimer = (who.knifeTimer || 0) + dt;
      if (who.knifeTimer >= 650) {
        who.knifeTimer = 0; who.state = 'knife'; who.shootAt = now;
        meleeTgt.hp -= 10; meleeTgt.hurtTimer = 220;
        m.soundQ.push({ t: 'zatk' });
        m.effects.push({ type: 'slash', x: meleeTgt.x + who.facing * 10, y: MGY - 28, at: now, dur: 230 });
        m.effects.push({ type: 'txt', x: meleeTgt.x, y: MGY - 58, v: '-10', col: '#ffcc44', at: now, dur: 600 });
        if (meleeTgt.hp <= 0) {
          meleeTgt.hp = 0; meleeTgt.state = 'dead'; meleeTgt.deadAt = now;
          m.soundQ.push({ t: 'zdie', zt: meleeTgt.type }); m.killedCount++;
        }
      }
    } else if (who.state === 'knife' && now - who.shootAt > 300) {
      who.state = 'idle'; who.knifeTimer = 0;
    }
    return;
  }

  if (now - who.lastShot >= w.rate) {
    who.state = 'shoot'; who.lastShot = now; who.shootAt = now; who.ammo--;
    m.soundQ.push({ t: 'shot', w: who.weapon }); m.soundQ.push({ t: 'shell' });
    const bx = who.x + who.facing * 24;
    for (let p = 0; p < (w.pel || 1); p++) {
      const sp2 = (Math.random() - 0.5) * w.sp * 2;
      m.bullets.push({
        id: uid(), x: bx, y: MGY - 26,
        dx: who.facing * w.spd * Math.cos(sp2),
        dy: w.spd * Math.sin(sp2),
        dmg: w.pel ? w.dmg / w.pel : w.dmg,
        life: Math.ceil(w.range / w.spd * 1.15),
      });
    }
    m.effects.push({ type: 'shell', x: who.x - who.facing * 8, y: MGY - 26, vx: -who.facing * (1.4 + Math.random()), at: now, dur: 780 });
    if (who.ammo === 0) {
      who.state = 'reload'; who.reloadStart = now; who.ammo = who.maxAmmo;
      m.soundQ.push({ t: 'reload', w: who.weapon, dur: w.rl });
    }
  } else if (now - who.lastShot > w.rate * 0.5) {
    who.state = 'idle';
  }
}

export function updateMission(m, now, dt) {
  if (m.state !== 'active') return;
  if (!m.startedAt) m.startedAt = now;
  const s = m.soldier;
  s.hurtTimer = Math.max(0, s.hurtTimer - dt);
  (m.followers || []).forEach(f => { f.hurtTimer = Math.max(0, f.hurtTimer - dt); });

  // Lead movement (player-controlled). Acid pool slows movement to 50%.
  const onAcid = (m.hazards || []).some(h => h.type === 'acid' && Math.abs(s.x - h.x) <= h.w / 2);
  const moveSpd = 2.4 * (dt / 16) * (onAcid ? 0.5 : 1);
  if (s.state !== 'reload' && s.state !== 'knife') {
    if (m.inputRight) { s.x += moveSpd; s.facing = 1; if (s.state === 'idle') s.state = 'walk'; }
    else if (m.inputLeft) { s.x -= moveSpd; s.facing = -1; if (s.state === 'idle') s.state = 'walk'; }
    else if (s.state === 'walk') s.state = 'idle';
  }
  s.x = Math.max(40, Math.min(MISSION_W - 40, s.x));
  m.cameraX = Math.max(0, Math.min(MISSION_W - MISSION_VIEW, s.x - MISSION_VIEW / 2));

  // Followers: chase the lead at a small offset, ~1.6 px/frame.
  (m.followers || []).forEach((f, i) => {
    if (f.hp <= 0 || f.state === 'dead') return;
    if (f.state === 'reload' || f.state === 'knife') return;
    const desired = s.x - (i + 1) * 36 * s.facing;
    const dx = desired - f.x;
    const followSpd = 2.0 * (dt / 16);
    if (Math.abs(dx) > 4) {
      f.x += Math.sign(dx) * Math.min(Math.abs(dx), followSpd);
      f.facing = s.facing;
      if (f.state === 'idle') f.state = 'walk';
    } else if (f.state === 'walk') {
      f.state = 'idle';
    }
    f.x = Math.max(20, Math.min(MISSION_W - 20, f.x));
  });

  // Rescuable civilians: tick, follow the lead when triggered, die
  // gracefully when hit. They never overtake the lead.
  (m.rescuables || []).forEach(r => {
    if (r.state === 'dead' || r.hp <= 0) return;
    r.hurtTimer = Math.max(0, r.hurtTimer - dt);
    if (r.state === 'idle') {
      // Trip on contact with any party member
      if (aliveParty(m).some(p => Math.abs(p.x - r.x) < 32)) {
        r.state = 'following';
        m.effects.push({ type: 'txt', x: r.x, y: MGY - 70, v: `${r.name} JOINED`, col: '#88ddff', at: now, dur: 1100 });
      }
    } else if (r.state === 'following') {
      // Stay ~70 px behind the lead's facing
      const desired = s.x - 70 * s.facing;
      const dx = desired - r.x;
      const followSpd = 1.8 * (dt / 16);
      if (Math.abs(dx) > 6) { r.x += Math.sign(dx) * Math.min(Math.abs(dx), followSpd); r.facing = s.facing; }
    }
  });

  // Activation now considers any party member or rescuable as the "trigger"
  const triggers = aliveTargets(m);
  m.zombies.forEach(z => {
    if (z.activated) return;
    const closest = triggers.reduce((d, p) => Math.min(d, Math.abs(z.x - p.x)), Infinity);
    if (closest < BALANCE.missionActivationRange) {
      z.activated = true; m.activatedCount++;
      m.soundQ.push({ t: 'groan', now, zt: z.type });
    }
  });

  // Zombies AI: pick the closest target (party + rescuables)
  m.zombies.forEach(z => {
    if (z.state === 'dead' || !z.activated) return;
    z.hurtTimer = Math.max(0, z.hurtTimer - dt);
    const targets = aliveTargets(m);
    if (aliveParty(m).length === 0) { m.state = 'lost'; m.endedAt = now; return; }
    if (targets.length === 0) return;
    const tgt = targets.reduce((a, b) => Math.abs(a.x - z.x) < Math.abs(b.x - z.x) ? a : b);
    const dx = tgt.x - z.x;
    const meta = z.z;

    // ── Ranged zombies (spitters) keep their distance and lob acid ──
    if (meta.ranged) {
      z.facing = dx > 0 ? 1 : -1;
      const absDx = Math.abs(dx);
      const idealMin = meta.spitRange * 0.5;
      const idealMax = meta.spitRange * 0.95;
      if (absDx > idealMax) {
        // Close in to range
        z.x += z.spd * z.facing * (dt / 16);
        z.state = 'walk';
      } else if (absDx < idealMin) {
        // Back away
        z.x -= z.spd * 0.6 * z.facing * (dt / 16);
        z.state = 'walk';
      } else {
        z.state = 'attack';
      }
      if (z.state === 'attack') {
        z.atkTimer += dt;
        if (z.atkTimer >= meta.spitRate) {
          z.atkTimer = 0;
          const dxr = tgt.x - z.x;
          const dyr = -10;
          const len = Math.hypot(dxr, dyr);
          m.bullets.push({
            id: uid(),
            x: z.x + z.facing * 14, y: MGY - 24,
            dx: (dxr / len) * meta.spitSpd,
            dy: (dyr / len) * meta.spitSpd + 0.06, // slight gravity arc
            dmg: meta.dmg,
            life: Math.ceil(meta.spitRange / meta.spitSpd * 1.4),
            spit: true,
          });
          m.soundQ.push({ t: 'zatk' });
        }
      }
      return;
    }

    if (z.state === 'idle' || z.state === 'walk') {
      z.facing = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 40) { z.x += z.spd * z.facing * (dt / 16); if (z.state === 'idle') z.state = 'walk'; }
      else { z.state = 'attack'; }
    } else if (z.state === 'attack') {
      z.atkTimer += dt;
      z.facing = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 50) { z.state = 'walk'; z.atkTimer = 0; return; }
      if (z.atkTimer > 1000) {
        z.atkTimer = 0;
        tgt.hp -= z.z.dmg; tgt.hurtTimer = 320;
        m.soundQ.push({ t: 'zatk' });
        if (tgt.hp <= 0) {
          tgt.hp = 0; tgt.state = 'dead';
          // Lead death = mission failure. Follower / rescuable death = continues.
          if (tgt.id === s.id) { m.state = 'lost'; m.endedAt = now; }
        }
      }
    }
  });

  // ── LEAD: player-driven shoot / knife ───────────────────────────
  const w = WPN[s.weapon];
  if (m.inputShoot && s.state !== 'reload' && s.ammo > 0) {
    if (now - s.lastShot >= w.rate) {
      s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.ammo--;
      m.soundQ.push({ t: 'shot', w: s.weapon }); m.soundQ.push({ t: 'shell' });
      const bx = s.x + s.facing * 24;
      for (let p = 0; p < (w.pel || 1); p++) {
        const sp2 = (Math.random() - 0.5) * w.sp * 2;
        m.bullets.push({
          id: uid(), x: bx, y: MGY - 26,
          dx: s.facing * w.spd * Math.cos(sp2), dy: w.spd * Math.sin(sp2),
          dmg: w.pel ? w.dmg / w.pel : w.dmg,
          life: Math.ceil(w.range / w.spd * 1.15),
        });
      }
      m.effects.push({ type: 'shell', x: s.x - s.facing * 8, y: MGY - 26, vx: -s.facing * (1.4 + Math.random()), at: now, dur: 780 });
      if (s.ammo === 0) { s.state = 'reload'; s.reloadStart = now; s.ammo = s.maxAmmo; m.soundQ.push({ t: 'reload', w: s.weapon, dur: w.rl }); }
    } else if (now - s.lastShot > w.rate * 0.5) s.state = 'walk';
  }
  if (s.state === 'shoot' && now - s.shootAt > 200) s.state = m.inputLeft || m.inputRight ? 'walk' : 'idle';
  if (s.state === 'reload' && now - s.reloadStart >= w.rl) s.state = 'idle';

  if (s.ammo <= 0 && s.state !== 'reload') {
    const meleeTgt = m.zombies.find(z => z.state !== 'dead' && Math.abs(z.x - s.x) < 52);
    if (meleeTgt) {
      s.facing = meleeTgt.x > s.x ? 1 : -1;
      s.knifeTimer = (s.knifeTimer || 0) + dt;
      if (s.knifeTimer >= 600) {
        s.knifeTimer = 0; s.state = 'knife'; s.shootAt = now;
        meleeTgt.hp -= 10; meleeTgt.hurtTimer = 220;
        m.soundQ.push({ t: 'zatk' });
        m.effects.push({ type: 'slash', x: meleeTgt.x + s.facing * 10, y: MGY - 28, at: now, dur: 230 });
        m.effects.push({ type: 'txt', x: meleeTgt.x, y: MGY - 58, v: '-10', col: '#ffcc44', at: now, dur: 600 });
        if (meleeTgt.hp <= 0) { meleeTgt.hp = 0; meleeTgt.state = 'dead'; meleeTgt.deadAt = now; m.soundQ.push({ t: 'zdie', zt: meleeTgt.type }); m.killedCount++; }
      }
    } else { s.knifeTimer = 0; if (s.state === 'knife' && now - s.shootAt > 300) s.state = 'idle'; }
  }

  // ── FOLLOWERS: AI shoot / knife ─────────────────────────────────
  (m.followers || []).forEach(f => {
    if (f.hp <= 0 || f.state === 'dead') return;
    aiShoot(m, f, now, dt);
  });

  // ── DEFEND OBJECTIVE ─────────────────────────────────────────
  // The lead must reach the anchor flag to start the timer, then
  // survive until defendDuration ms elapse. New zombies spawn from the
  // right edge at a steady cadence until time is up.
  if (m.objective === 'defend') {
    if (!m.defendStartedAt && Math.abs(s.x - m.defendAnchor) < 32) {
      m.defendStartedAt = now;
      m.defendNextSpawn = now + 800;
      m.effects.push({ type: 'txt', x: s.x, y: MGY - 80, v: 'HOLD POSITION!', col: '#ff8800', at: now, dur: 1800 });
    }
    if (m.defendStartedAt) {
      const elapsed = now - m.defendStartedAt;
      // Spawn cadence ramps up as time progresses
      const cadence = Math.max(700, 1800 - elapsed / 30);
      if (now >= (m.defendNextSpawn || 0)) {
        m.defendNextSpawn = now + cadence;
        // Pick a type based on elapsed (harder enemies later)
        const t = elapsed > 25000 && Math.random() < 0.25 ? 'tank'
               : elapsed > 10000 && Math.random() < 0.35 ? 'runner'
               : elapsed > 15000 && Math.random() < 0.18 ? 'spitter'
               : 'walker';
        const z = ZTP[t];
        m.zombies.push({
          id: uid(), type: t, z,
          x: m.defendAnchor + 260 + Math.random() * 60,
          hp: z.hp, maxHp: z.hp,
          spd: z.spd * (0.85 + Math.random() * 0.3),
          state: 'walk', facing: -1,
          walkPhase: Math.random() * Math.PI * 2,
          atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
          activated: true,
        });
        m.activatedCount++;
      }
      if (elapsed >= m.defendDuration) {
        m.state = 'won'; m.endedAt = now;
      }
    }
  }

  // ── HAZARDS ──────────────────────────────────────────────────
  // Mines: trigger on first contact with any party member, AoE damage.
  // Acid pools: tick damage every 500 ms while standing on them.
  (m.hazards || []).forEach(h => {
    if (h.type === 'mine' && !h.triggered) {
      const stepper = aliveParty(m).find(p => Math.abs(p.x - h.x) < 18);
      if (stepper) {
        h.triggered = true; h.triggeredAt = now;
        m.soundQ.push({ t: 'bhit' });
        // Damage every party member within 40 px of the mine
        aliveParty(m).forEach(p => {
          if (Math.abs(p.x - h.x) > 40) return;
          p.hp -= h.dmg; p.hurtTimer = 320;
          m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: `MINE -${h.dmg}`, col: '#ff4400', at: now, dur: 1200 });
          if (p.hp <= 0) {
            p.hp = 0; p.state = 'dead';
            if (p.id === s.id) { m.state = 'lost'; m.endedAt = now; }
          }
        });
        m.effects.push({ type: 'hit', x: h.x, y: MGY - 12, at: now, dur: 480 });
        // Visible blast cloud
        m.effects.push({ type: 'blood', x: h.x, y: MGY - 12,
          drops: Array.from({ length: 12 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 3 - 0.5, r: 2 + Math.random() * 4 })),
          at: now, dur: 700 });
      }
    } else if (h.type === 'acid') {
      h._lastTick = h._lastTick || 0;
      if (now - h._lastTick > 500) {
        h._lastTick = now;
        aliveParty(m).forEach(p => {
          if (Math.abs(p.x - h.x) > h.w / 2) return;
          p.hp -= h.dmg; p.hurtTimer = 200;
          m.effects.push({ type: 'txt', x: p.x, y: MGY - 60, v: `-${h.dmg}`, col: '#88cc44', at: now, dur: 600 });
          if (p.hp <= 0) {
            p.hp = 0; p.state = 'dead';
            if (p.id === s.id) { m.state = 'lost'; m.endedAt = now; }
          }
        });
      }
    }
  });

  m.bullets = m.bullets.filter(b => {
    b.x += b.dx; b.y += b.dy; b.life--;
    if (b.life <= 0 || b.x < 0 || b.x > MISSION_W) return false;

    if (b.spit) {
      // Acid spit hits any living party member or rescuable in its path.
      const hit = aliveTargets(m).find(p => Math.abs(p.x - b.x) < 18 && b.y > MGY - 38);
      if (hit) {
        hit.hp -= b.dmg; hit.hurtTimer = 240;
        m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${b.dmg}`, col: '#88cc44', at: now, dur: 700 });
        m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 220 });
        if (hit.hp <= 0) {
          hit.hp = 0; hit.state = 'dead';
          if (hit.id === s.id) { m.state = 'lost'; m.endedAt = now; }
        }
        return false;
      }
      // Splash on the ground
      if (b.y >= MGY - 2) {
        m.effects.push({ type: 'hit', x: b.x, y: MGY - 2, at: now, dur: 260 });
        return false;
      }
      return true;
    }

    const hit = m.zombies.find(z => z.state !== 'dead' && Math.abs(z.x - b.x) < 20);
    if (hit) {
      hit.hp -= b.dmg; hit.hurtTimer = 210; m.soundQ.push({ t: 'hit', now });
      m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 6 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3.5, vy: -Math.random() * 2.5 - 0.5, r: 1.5 + Math.random() * 3 })), at: now, dur: 600 });
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: C.bld, at: now, dur: 680 });
      if (hit.hp <= 0) { hit.hp = 0; hit.state = 'dead'; hit.deadAt = now; m.soundQ.push({ t: 'zdie', zt: hit.type }); m.killedCount++; }
      return false;
    }
    return true;
  });

  // Pickups can be grabbed by any party member.
  m.pickups.forEach(p => {
    if (p.collected) return;
    const grabber = aliveParty(m).find(member => Math.abs(p.x - member.x) < 28);
    if (grabber) {
      p.collected = true;
      if (p.type === 'civilian') { m.collected.civilian = true; m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: 'CIVILIAN!', col: '#88ddff', at: now, dur: 1000 }); }
      else { m.collected[p.type] += p.value; m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: `+${p.value} ${p.type}`, col: C.acc, at: now, dur: 900 }); }
    }
  });

  m.effects = m.effects.filter(e => now - e.at < e.dur);

  // Goal gate: cannot exit until you've cleared enough of the hostiles you
  // woke up. Prevents "sprint past everything for free".
  // Goal-gate only applies to "reach the goal" missions. Defend missions
  // win when the survive timer expires (handled above).
  if (m.objective !== 'defend' && s.x >= MISSION_W - 50) {
    const need = Math.ceil(m.activatedCount * BALANCE.missionGoalKillRatio);
    if (m.killedCount >= need) {
      // Tally rescuables that made it to within the goal zone alive.
      m.collected.rescuedCivs = (m.rescuables || []).filter(r =>
        r.state === 'following' && r.hp > 0 && r.x > MISSION_W - 250
      ).length;
      m.state = 'won'; m.endedAt = now;
    } else {
      // Pin the soldier just before the goal and surface a hint
      s.x = MISSION_W - 50;
      if (!m._lastGoalHint || now - m._lastGoalHint > 1500) {
        m._lastGoalHint = now;
        const left = need - m.killedCount;
        m.effects.push({
          type: 'txt', x: s.x, y: MGY - 70,
          v: `${left} HOSTILE${left === 1 ? '' : 'S'} LEFT`,
          col: '#cc3333', at: now, dur: 1400,
        });
      }
    }
  }
}

// ── Hazards (mines + acid pools) ─────────────────────────────────
function dHazard(ctx, h, now) {
  if (h.type === 'mine') {
    if (h.triggered) return; // exploded mines fade away with the blast effect
    const x = h.x;
    // Faint metallic disc + tiny prong — readable but easy to miss
    ctx.fillStyle = 'rgba(40,38,34,0.92)';
    ctx.beginPath(); ctx.ellipse(x, MGY - 1, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1814'; ctx.fillRect(x - 1, MGY - 4, 2, 3);
    ctx.fillStyle = '#cc3300';
    const blink = Math.sin(now / 220) * 0.5 + 0.5;
    ctx.globalAlpha = 0.4 + blink * 0.5;
    ctx.beginPath(); ctx.arc(x, MGY - 4, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (h.type === 'acid') {
    const x = h.x, w = h.w;
    // Bubbling green puddle
    ctx.fillStyle = 'rgba(80,160,40,0.55)';
    ctx.beginPath(); ctx.ellipse(x, MGY + 2, w / 2, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(140,220,80,0.4)';
    for (let bi = 0; bi < 4; bi++) {
      const bx = x - w / 2 + ((bi * 31 + (now / 120 | 0)) % w);
      const by = MGY + 1 + Math.sin(now / 200 + bi) * 1.5;
      ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // Hazard tape edges
    ctx.strokeStyle = 'rgba(180,255,80,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, MGY + 2, w / 2, 6, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

// ── Biome-aware props (decorative, never block movement) ───────────
function dProp(ctx, p) {
  const x = p.x, y = MGY;
  if (p.type === 'lamppost-hospital') {
    // White clinical lamp pole + soft halo
    ctx.fillStyle = '#384858'; ctx.fillRect(x - 1.5, y - 50, 3, 50);
    ctx.fillStyle = '#aac8d8'; ctx.fillRect(x - 6, y - 56, 12, 6);
    ctx.fillStyle = 'rgba(180,220,255,0.20)';
    ctx.beginPath(); ctx.arc(x, y - 53, 22, 0, Math.PI * 2); ctx.fill();
  } else if (p.type === 'fence-military') {
    // Chain-link fence segment + barbed top
    ctx.fillStyle = '#2a2820'; ctx.fillRect(x - 18, y - 28, 36, 2);
    ctx.fillStyle = '#1a1812'; ctx.fillRect(x - 18, y - 28, 2, 28); ctx.fillRect(x + 16, y - 28, 2, 28);
    ctx.strokeStyle = 'rgba(80,80,60,0.5)'; ctx.lineWidth = 1;
    for (let dx = -16; dx <= 16; dx += 4) {
      ctx.beginPath(); ctx.moveTo(x + dx, y - 26); ctx.lineTo(x + dx, y); ctx.stroke();
    }
    for (let dy = -24; dy <= -2; dy += 4) {
      ctx.beginPath(); ctx.moveTo(x - 16, y + dy); ctx.lineTo(x + 16, y + dy); ctx.stroke();
    }
    // Barbed wire on top
    ctx.strokeStyle = '#484840';
    ctx.beginPath();
    for (let dx = -16; dx <= 16; dx += 6) ctx.arc(x + dx, y - 31, 3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (p.type === 'streetlamp-broken') {
    // Bent street lamp, cracked glass
    ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 1.5, y - 60, 3, 60);
    ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 1.5, y - 60, 18, 3);
    ctx.fillStyle = '#3a1a08'; ctx.fillRect(x + 14, y - 64, 8, 6);
    ctx.fillStyle = 'rgba(255,80,0,0.18)';
    ctx.beginPath(); ctx.arc(x + 18, y - 60, 10, 0, Math.PI * 2); ctx.fill();
  }
}

function dObstacle(ctx, o) {
  const x = o.x;
  switch (o.type) {
    case 'car': {
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 22, MGY - 22, 44, 18);
      ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 18, MGY - 32, 32, 12);
      ctx.fillStyle = '#101010';
      ctx.beginPath(); ctx.arc(x - 14, MGY - 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 14, MGY - 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,140,40,0.15)';
      ctx.beginPath(); ctx.arc(x, MGY - 26, 18, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'crate': {
      ctx.fillStyle = '#5a3e18'; ctx.fillRect(x - 12, MGY - 18, 24, 18);
      ctx.fillStyle = '#3e2810'; ctx.fillRect(x - 12, MGY - 12, 24, 2); ctx.fillRect(x - 12, MGY - 6, 24, 2);
      break;
    }
    case 'sandbag': {
      ctx.fillStyle = '#584030';
      ctx.beginPath(); ctx.ellipse(x - 8, MGY - 4, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3228';
      ctx.beginPath(); ctx.ellipse(x + 6, MGY - 4, 11, 5, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#503a2e';
      ctx.beginPath(); ctx.ellipse(x - 2, MGY - 11, 11, 5, -0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#604030';
      ctx.beginPath(); ctx.ellipse(x + 4, MGY - 17, 9, 5, 0.1, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'ammo-crate': {
      ctx.fillStyle = '#36321e'; ctx.fillRect(x - 14, MGY - 20, 28, 20);
      ctx.fillStyle = '#1a1814'; ctx.fillRect(x - 14, MGY - 20, 28, 3);
      ctx.fillStyle = '#cc9900'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('AMMO', x, MGY - 8); ctx.textAlign = 'left';
      ctx.fillStyle = '#1a1814'; ctx.fillRect(x - 14, MGY - 4, 28, 2);
      break;
    }
    case 'container': {
      ctx.fillStyle = '#3a4628'; ctx.fillRect(x - 26, MGY - 38, 52, 38);
      ctx.fillStyle = '#2a3220'; ctx.fillRect(x - 26, MGY - 38, 52, 4);
      ctx.fillStyle = '#1a2018';
      for (let cx = x - 22; cx <= x + 18; cx += 8) ctx.fillRect(cx, MGY - 34, 2, 32);
      ctx.fillStyle = '#cc9900'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
      ctx.fillText('FORT-OMEGA', x, MGY - 18); ctx.textAlign = 'left';
      break;
    }
    case 'stretcher': {
      ctx.fillStyle = '#9aa0a8'; ctx.fillRect(x - 18, MGY - 18, 36, 4);
      ctx.fillStyle = '#3a3838'; ctx.fillRect(x - 16, MGY - 14, 4, 14); ctx.fillRect(x + 12, MGY - 14, 4, 14);
      ctx.fillStyle = '#202020'; ctx.beginPath(); ctx.arc(x - 14, MGY - 1, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 14, MGY - 1, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(180,30,30,0.6)'; ctx.fillRect(x - 8, MGY - 17, 6, 2);
      break;
    }
    case 'iv': {
      ctx.fillStyle = '#888'; ctx.fillRect(x - 1, MGY - 38, 2, 38);
      ctx.fillStyle = '#aaa'; ctx.beginPath(); ctx.arc(x, MGY - 40, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#cce6ff'; ctx.fillRect(x - 4, MGY - 36, 8, 12);
      ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(x, MGY, 5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'wheelchair': {
      ctx.fillStyle = '#2a3038'; ctx.fillRect(x - 8, MGY - 22, 16, 4);
      ctx.fillStyle = '#1a2028'; ctx.fillRect(x - 6, MGY - 22, 12, 12);
      ctx.fillStyle = '#101010'; ctx.beginPath(); ctx.arc(x - 8, MGY - 4, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 8, MGY - 4, 7, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'medkit': {
      ctx.fillStyle = '#dddddd'; ctx.fillRect(x - 8, MGY - 12, 16, 12);
      ctx.fillStyle = '#cc1818'; ctx.fillRect(x - 2, MGY - 11, 4, 10); ctx.fillRect(x - 7, MGY - 7, 14, 2);
      break;
    }
    case 'trash-bin': {
      ctx.fillStyle = '#1a1816'; ctx.fillRect(x - 9, MGY - 22, 18, 22);
      ctx.fillStyle = '#2a2824'; ctx.fillRect(x - 10, MGY - 23, 20, 3);
      ctx.fillStyle = '#3a3028'; ctx.fillRect(x - 6, MGY - 18, 12, 8);
      break;
    }
    case 'traffic-cone': {
      ctx.fillStyle = '#cc4400';
      ctx.beginPath(); ctx.moveTo(x, MGY - 18); ctx.lineTo(x - 6, MGY); ctx.lineTo(x + 6, MGY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 4, MGY - 12, 8, 1.5); ctx.fillRect(x - 5, MGY - 6, 10, 1.5);
      break;
    }
    case 'sign': {
      ctx.fillStyle = '#2a2824'; ctx.fillRect(x - 1.5, MGY - 38, 3, 38);
      ctx.fillStyle = '#cc1818'; ctx.fillRect(x - 14, MGY - 38, 28, 14);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText('STOP', x, MGY - 28); ctx.textAlign = 'left';
      break;
    }
    default: {
      ctx.fillStyle = '#5a3e18'; ctx.fillRect(x - 12, MGY - 18, 24, 18);
    }
  }
}

export function dMissionWorld(ctx, m, now) {
  ctx.save();
  ctx.translate(-m.cameraX, 0);

  const biome = BIOMES[m.biomeKey] || BIOMES[DEFAULT_BIOME];

  // Sky (biome-tinted gradient)
  const sg = ctx.createLinearGradient(0, 0, 0, MGY - 80);
  sg.addColorStop(0, biome.sky[0]); sg.addColorStop(1, biome.sky[1]);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, MISSION_W, MGY - 80);

  // Stars / specks (always)
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 173 + m.cameraX * 0.2) % MISSION_W);
    const sy = (i * 97 + 17) % (MGY - 100);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 4) * 0.18})`;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  // Biome accent glow (smear of color: clinical halo, sunset blaze, etc.)
  ctx.fillStyle = biome.accentLight;
  ctx.beginPath(); ctx.arc(MISSION_W * 0.4, MGY - 120, 200, 0, Math.PI * 2); ctx.fill();

  // Background buildings: count + height range from biome
  const bldCount = biome.bldgCount;
  const [hMin, hMax] = biome.bldgHRange;
  for (let i = 0; i < bldCount; i++) {
    const bx = (i * MISSION_W / bldCount) + 50 + (i % 3) * 30;
    const bw = 40 + (i * 7) % 70;
    const bh = hMin + ((i * 23) % (hMax - hMin));
    ctx.fillStyle = biome.bldgFill; ctx.fillRect(bx, MGY - 80 - bh, bw, bh);
    ctx.fillStyle = biome.bldgRoof; ctx.fillRect(bx, MGY - 80 - bh, bw, 4);
    ctx.fillStyle = biome.bldgWindow;
    for (let wx = bx + 8; wx < bx + bw - 5; wx += 14)
      for (let wy = MGY - 80 - bh + 10; wy < MGY - 90; wy += 18)
        if (Math.sin((bx + wx) * 0.1 + wy * 0.07) > 0.2) ctx.fillRect(wx, wy, 8, 10);
  }

  // Ground
  const gg = ctx.createLinearGradient(0, MGY, 0, CH);
  gg.addColorStop(0, biome.ground[0]); gg.addColorStop(1, biome.ground[1]);
  ctx.fillStyle = gg; ctx.fillRect(0, MGY, MISSION_W, CH - MGY);
  ctx.strokeStyle = biome.groundLine; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, MGY); ctx.lineTo(MISSION_W, MGY); ctx.stroke();

  // Decorative props (lampposts, fences, neon poles)
  (m.props || []).forEach(p => dProp(ctx, p));

  // Hazards (acid pools first so obstacles draw on top, then mines).
  (m.hazards || []).filter(h => h.type === 'acid').forEach(h => dHazard(ctx, h, now));
  // Foreground obstacles (biome-aware)
  m.obstacles.forEach(o => dObstacle(ctx, o));
  // Mines drawn after obstacles so the player can spot them on the road
  // (still low-contrast — they're hidden by design).
  (m.hazards || []).filter(h => h.type === 'mine').forEach(h => dHazard(ctx, h, now));

  for (let mx = 200; mx < MISSION_W; mx += 200) {
    ctx.fillStyle = 'rgba(80,80,60,0.3)'; ctx.fillRect(mx - 1, MGY + 2, 2, 8);
  }

  m.pickups.forEach(p => {
    if (p.collected) return;
    const bob = Math.sin(now / 300 + p.x * 0.01) * 3;
    ctx.save(); ctx.translate(p.x, MGY - 30 + bob);
    ctx.fillStyle = p.type === 'civilian' ? 'rgba(136,221,255,0.18)' : 'rgba(114,188,64,0.18)';
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(20,30,15,0.85)'; ctx.fillRect(-12, -12, 24, 24);
    ctx.strokeStyle = p.type === 'civilian' ? '#88ddff' : C.acc; ctx.lineWidth = 1.5;
    ctx.strokeRect(-12, -12, 24, 24);
    ctx.font = '14px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText(objIcons[p.type] || '?', 0, 5);
    ctx.textAlign = 'left'; ctx.restore();
  });

  m.zombies.filter(z => z.state === 'dead').forEach(z => { z.lane = 0; dZombie(ctx, z, now); });
  m.zombies.filter(z => z.state !== 'dead' && z.activated).forEach(z => { z.lane = 0; dZombie(ctx, z, now); });

  // Rescuable civilians (drawn before the party so they read as on-stage)
  (m.rescuables || []).forEach(r => {
    if (r.state === 'dead' || r.hp <= 0) return;
    const rc = {
      id: r.id, name: r.name, weapon: 'pistol',
      x: r.x, lane: 0, hp: r.hp, maxHp: r.maxHp,
      ammo: 0, maxAmmo: 1,
      state: r.state === 'following' ? 'walk' : 'idle',
      facing: r.facing,
      walkPhase: r.walkPhase, hurtTimer: r.hurtTimer,
      civilian: true, onRoof: false, onExpedition: false,
    };
    dSoldier(ctx, rc, now);
    // Floating "?" / "!" marker over their head so the player notices them
    if (r.state === 'idle') {
      ctx.fillStyle = '#88ddff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      const bob = Math.sin(now / 240) * 2;
      ctx.fillText('!', r.x, MGY - 60 + bob); ctx.textAlign = 'left';
    }
  });

  // Draw followers first so the lead reads as in front of them.
  (m.followers || []).forEach(f => {
    const fc = { ...f, lane: 0, onExpedition: false, state: f.state };
    dSoldier(ctx, fc, now);
  });

  const sCopy = { ...m.soldier, lane: 0, onExpedition: false, state: m.soldier.state };
  dSoldier(ctx, sCopy, now, true); // pass selection ring to mark the lead

  m.effects.forEach(e => dFx(ctx, e, now));
  m.bullets.forEach(b => dBlt(ctx, b));

  if (m.objective === 'defend') {
    // Defense anchor flag
    const ax = m.defendAnchor;
    const pulse = 0.6 + 0.4 * Math.sin(now / 280);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(ax - 1, MGY - 70, 2, 70);
    ctx.fillStyle = `rgba(255,140,40,${0.5 + pulse * 0.4})`;
    ctx.beginPath();
    ctx.moveTo(ax + 1, MGY - 68); ctx.lineTo(ax + 26, MGY - 60); ctx.lineTo(ax + 1, MGY - 52);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.acc; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('★ DEFEND ★', ax, MGY - 80); ctx.textAlign = 'left';
  } else {
    const goalX = MISSION_W - 30;
    const pulse = 0.6 + 0.4 * Math.sin(now / 300);
    ctx.fillStyle = `rgba(114,188,64,${pulse * 0.4})`;
    ctx.fillRect(goalX - 3, MGY - 120, 6, 120);
    ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace';
    ctx.fillText('★ GOAL ★', goalX - 26, MGY - 128);
  }

  ctx.restore();
}

export function dMissionHUD(ctx, m, now) {
  const CW_ = 900;
  ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(0, 0, CW_, 40);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1; ctx.strokeRect(0, 0, CW_, 40);
  ctx.fillStyle = C.acc; ctx.font = 'bold 12px monospace';
  ctx.fillText(`MISSION: ${m.dest.name.toUpperCase()}`, 12, 18);
  ctx.fillStyle = C.txt; ctx.font = '10px monospace';
  ctx.fillText(`AGENT ${m.soldier.name}`, 12, 32);

  const px = 180, pw = 450, ph = 10;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(px, 14, pw, ph);
  const pct = m.soldier.x / MISSION_W;
  ctx.fillStyle = C.acc; ctx.fillRect(px, 14, pw * pct, ph);
  ctx.strokeStyle = C.uib; ctx.strokeRect(px, 14, pw, ph);
  ctx.fillStyle = C.acc; ctx.fillText('★', px + pw + 4, 23);

  // Hostiles-cleared counter (the goal-gate condition).
  const need = Math.ceil(m.activatedCount * BALANCE.missionGoalKillRatio);
  const cleared = Math.min(m.killedCount, need);
  ctx.fillStyle = m.killedCount >= need && need > 0 ? C.acc : C.wrn;
  ctx.font = '9px monospace';
  ctx.fillText(`HOSTILES ${cleared}/${need || 0}`, px, 35);

  // Rescuables status (✓ following / total alive)
  const rcs = (m.rescuables || []).filter(r => r.state !== 'dead' && r.hp > 0);
  if (rcs.length > 0 || (m.rescuables || []).length > 0) {
    const total = (m.rescuables || []).length;
    const following = rcs.filter(r => r.state === 'following').length;
    ctx.fillStyle = '#88ddff'; ctx.font = '9px monospace';
    ctx.fillText(`👤 RESCUE ${following}/${total}`, px + 130, 35);
  }

  ctx.fillStyle = C.txt; ctx.font = '10px monospace';
  ctx.fillText(`HP ${m.soldier.hp}/${m.soldier.maxHp}`, CW_ - 200, 18);
  ctx.fillStyle = m.soldier.ammo === 0 ? C.dng : m.soldier.ammo <= 4 ? C.wrn : C.acc;
  ctx.fillText(`AMMO ${m.soldier.ammo}/${m.soldier.maxAmmo}`, CW_ - 200, 32);

  ctx.fillStyle = '#88ddff'; ctx.font = '10px monospace';
  let cx = CW_ - 90;
  Object.entries(m.collected).forEach(([k, v]) => {
    if (v && v > 0) {
      const lbl = k === 'civilian' ? '👤' : objIcons[k] || k[0];
      ctx.fillText(`${lbl}${v === true ? '' : v}`, cx, k === 'civilian' ? 32 : 18);
      cx += 22;
    }
  });

  // Defend timer overlay
  if (m.objective === 'defend') {
    if (m.defendStartedAt) {
      const left = Math.max(0, Math.ceil((m.defendDuration - (now - m.defendStartedAt)) / 1000));
      const total = Math.ceil(m.defendDuration / 1000);
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(CW_ / 2 - 80, 4, 160, 28);
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1; ctx.strokeRect(CW_ / 2 - 80, 4, 160, 28);
      ctx.fillStyle = '#ff8800'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`⌛ DEFEND ${left}s`, CW_ / 2, 24); ctx.textAlign = 'left';
      // Progress bar
      const p = 1 - left / total;
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(CW_ / 2 - 78, 30, 156, 3);
      ctx.fillStyle = '#ff8800'; ctx.fillRect(CW_ / 2 - 78, 30, 156 * p, 3);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(CW_ / 2 - 110, 4, 220, 28);
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1; ctx.strokeRect(CW_ / 2 - 110, 4, 220, 28);
      ctx.fillStyle = '#ff8800'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('REACH THE DEFEND FLAG →', CW_ / 2, 22); ctx.textAlign = 'left';
    }
  }

  ctx.fillStyle = 'rgba(120,120,80,0.5)'; ctx.font = '9px monospace';
  ctx.fillText(
    m.objective === 'defend'
      ? '← → MOVE   SPACE/CLICK FIRE   HOLD THE FLAG'
      : '← → MOVE   SPACE/CLICK FIRE   REACH GOAL',
    12, CH - 12,
  );

  if (m.state === 'won' || m.state === 'lost') {
    const f = Math.min(1, (now - m.endedAt) / 600);
    ctx.fillStyle = `rgba(0,0,0,${f * 0.7})`; ctx.fillRect(0, 0, CW_, CH);
    ctx.fillStyle = m.state === 'won' ? C.acc : C.dng;
    ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
    ctx.fillText(m.state === 'won' ? '★ MISSION SUCCESS ★' : '✖ MISSION FAILED', CW_ / 2, CH / 2 - 20);
    ctx.font = '12px monospace'; ctx.fillStyle = C.txt;
    ctx.fillText(m.state === 'won' ? 'Returning to Fort Omega...' : `${m.soldier.name} did not return.`, CW_ / 2, CH / 2 + 10);
    ctx.textAlign = 'left';
  }
}
