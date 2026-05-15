import { C, CH, uid, rng } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MISSION_VIEW, MGY, objIcons, rollEncounter } from '../data/expeditions.js';
import { BIOMES, DEFAULT_BIOME } from '../data/biomes.js';
import { BALANCE } from '../data/difficulty.js';
import { dZombie } from '../render/zombie.js';
import { dSoldier } from '../render/soldier.js';
import { dFx, dBlt } from '../render/effects.js';

export function mkMission(soldier, dest, wave = 1) {
  const zombies = [], pickups = [], obstacles = [];

  // Spitters are the most punishing zombie kind (ranged + chip damage).
  // Gate them behind wave 3 so the very first sortie isn't a meatgrinder,
  // and scale their lethality up with wave count for late-game runs.
  const waveAbove = Math.max(0, wave - 3);
  const enableSpitter = wave >= 3;
  const spitDmgScaled = Math.max(3, Math.round(ZTP.spitter.dmg * (1 + waveAbove * 0.10)));
  const spitRateScaled = Math.max(1500, 2800 - waveAbove * 130);

  const totalZ = Math.floor(8 * dest.zSpawn + rng(0, 4));
  for (let i = 0; i < totalZ; i++) {
    const x = 400 + Math.random() * (MISSION_W - 700);
    let types;
    if (dest.risk === 'LOW') {
      types = ['walker'];
    } else if (dest.risk === 'MED') {
      types = enableSpitter ? ['walker', 'walker', 'walker', 'runner', 'spitter']
                            : ['walker', 'walker', 'walker', 'runner'];
    } else {
      types = enableSpitter ? ['walker', 'runner', 'runner', 'tank', 'spitter']
                            : ['walker', 'walker', 'runner', 'runner', 'tank'];
    }
    const t = types[Math.floor(Math.random() * types.length)];
    const z = ZTP[t];
    zombies.push({
      id: uid(), type: t, z, x, hp: z.hp, maxHp: z.hp,
      spd: z.spd * (0.85 + Math.random() * 0.3),
      state: 'idle', facing: -1,
      walkPhase: Math.random() * Math.PI * 2,
      atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
      activated: false,
      // Wave-scaled per-instance overrides for the spitter (so the same
      // ZTP entry can stay the late-game baseline while early waves get
      // gentler values).
      ...(t === 'spitter' ? { _spitDmg: spitDmgScaled, _spitRate: spitRateScaled } : {}),
    });
  }

  // Pickup pool is now driven by the destination's loot table (each
  // location in DEST_POOL specifies its own emphasis: pharmacy=meds,
  // gun shop=ammo, school=civilians, etc.). 'civilian' / 'lostSoldier'
  // are filtered out here — they get their own dedicated spawn below.
  const RESOURCE_TYPES = new Set(['ammo', 'medicine', 'food', 'materials', 'sniperAmmo', 'turretAmmo']);
  const pkOptions = (dest.loot || []).filter(t => RESOURCE_TYPES.has(t));
  // Fallback for legacy callers without a loot list.
  if (pkOptions.length === 0) {
    pkOptions.push(...(dest.risk === 'LOW' ? ['medicine', 'food']
      : dest.risk === 'MED' ? ['ammo', 'materials']
      : ['ammo', 'medicine', 'materials']));
  }
  const pkCount = dest.risk === 'LOW' ? 4 : dest.risk === 'MED' ? 5 : 7;
  // Pickup values scale modestly with wave so late-game runs reward
  // proportional to their increased threat.
  const waveBonus = Math.floor(Math.max(0, wave - 1) / 2);
  for (let i = 0; i < pkCount; i++) {
    const x = 300 + Math.floor(MISSION_W / (pkCount + 1)) * (i + 1) + rng(-60, 60);
    const type = pkOptions[Math.floor(Math.random() * pkOptions.length)];
    const base = type === 'medicine' ? rng(4, 8)
      : type === 'ammo' ? rng(8, 15)
      : type === 'food' ? rng(5, 10)
      : type === 'sniperAmmo' ? rng(2, 4)
      : type === 'turretAmmo' ? rng(6, 14)
      : rng(3, 6);
    pickups.push({ id: uid(), x, type, value: base + waveBonus, collected: false, lane: 0 });
  }
  // 'civilian' / 'lostSoldier' are flagged via the loot table when the
  // location can yield them, with risk-modulated base chance.
  const lootHas = t => (dest.loot || []).includes(t);
  const civBase  = dest.risk === 'HIGH' ? 1.0 : dest.risk === 'MED' ? 0.6 : 0.0;
  const lostBase = dest.risk === 'HIGH' ? 0.55 : dest.risk === 'MED' ? 0.22 : 0.0;
  if (lootHas('civilian') && Math.random() < civBase) {
    pickups.push({ id: uid(), x: MISSION_W - 200, type: 'civilian', value: 1, collected: false, lane: 0 });
  }
  if (lootHas('lostSoldier') && Math.random() < lostBase) {
    pickups.push({ id: uid(), x: MISSION_W - 320 + rng(-40, 40), type: 'lostSoldier', value: 1, collected: false, lane: 0 });
  }

  // Mission objective: 70% normal "reach the goal", 30% "defend".
  // DEFEND missions cut the travel short: the lead reaches a hastily
  // built sandbag emplacement around 45% of the map, then has to hold
  // the position for `defendDuration` ms against waves of zombies
  // pouring in from the deeper city to the right.
  const objective = (dest.risk !== 'LOW' && Math.random() < 0.30) ? 'defend' : 'reach';
  const defendAnchor = MISSION_W * 0.45;
  const defendDuration = 45000;

  // Branching path: random 50% on MED/HIGH (mutually exclusive with defend
  // because the defend anchor sits inside the fork range). Two parallel
  // lanes between fork.startX and fork.endX. Each lane has its own pickup
  // cluster; the player picks via W/S on the keyboard.
  const fork = (objective !== 'defend' && dest.risk !== 'LOW' && Math.random() < 0.50)
    ? { startX: MISSION_W * 0.40, endX: MISSION_W * 0.62 }
    : null;

  // Fork pickup clusters: per-lane bonus content. Low lane = combat
  // resources (ammo / turret ammo / materials), High lane = healing /
  // sniper ammo / a chance of a survivor pickup.
  if (fork) {
    const innerStart = fork.startX + 60;
    const innerEnd   = fork.endX   - 60;
    const lo = ['ammo', 'turretAmmo', 'materials'];
    const hi = ['medicine', 'sniperAmmo', 'food', 'medicine'];
    for (let i = 0; i < 3; i++) {
      const fx = innerStart + (innerEnd - innerStart) * (i + 1) / 4 + rng(-20, 20);
      const tlo = lo[Math.floor(Math.random() * lo.length)];
      const thi = hi[Math.floor(Math.random() * hi.length)];
      const vlo = tlo === 'ammo' ? rng(10, 18) : tlo === 'turretAmmo' ? rng(8, 14) : rng(4, 8);
      const vhi = thi === 'medicine' ? rng(4, 8) : thi === 'sniperAmmo' ? rng(2, 4) : rng(5, 10);
      pickups.push({ id: uid(), x: fx, type: tlo, value: vlo, collected: false, lane: 0, fork: true });
      pickups.push({ id: uid(), x: fx, type: thi, value: vhi, collected: false, lane: 1, fork: true });
    }
  }

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
      // Mines are shootable from range. One bullet detonates them.
      hp: 1, radius: 40,
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
    // Mission fork lane (0 = low / default, 1 = high). _laneY is the
    // smoothed render offset toward the target lane.
    forkLane: 0, _laneY: 0,
  });

  const msol = buildMissionSoldier(lead, 0);
  const followers = partySoldiers.slice(1).map((s, i) => buildMissionSoldier(s, i + 1));

  // ── SURVIVOR ENCOUNTER ─────────────────────────────────────────
  // Defend missions skip the encounter (the ambush IS the event).
  // Reach missions get a 28% / 40% chance (MED / HIGH) of running
  // into another group of survivors mid-route. The group is either
  // already hostile (bandits) or peaceful traders who turn hostile
  // if the player refuses their offer.
  const humans = [];
  let encounter = null;
  if (objective !== 'defend') {
    encounter = rollEncounter(dest.risk);
    if (encounter) {
      encounter.x = MISSION_W * (0.32 + Math.random() * 0.10);
      encounter.resolved = false;
      const bandit = encounter.type === 'hostile';
      const count = bandit ? rng(3, 4) : rng(2, 3);
      const weapons = ['pistol', 'pistol', 'shotgun', 'rifle'];
      for (let i = 0; i < count; i++) {
        const w = weapons[Math.floor(Math.random() * weapons.length)];
        const meta = WPN[w];
        humans.push({
          id: uid(), x: encounter.x + 40 + i * 18,
          hp: 50, maxHp: 50,
          weapon: w, maxAmmo: meta.ammo, ammo: Math.floor(meta.ammo * 0.7),
          state: 'idle', facing: -1,
          civilian: false, bandit, hostile: bandit,
          walkPhase: Math.random() * Math.PI * 2,
          lastShot: 0, reloadStart: 0, hurtTimer: 0, deadAt: 0,
          // Both bandits and traders start un-activated; the proximity
          // check (or trader-refuse) flips them on, which also bumps
          // m.activatedCount toward the goal kill-ratio gate.
          activated: false,
          forkLane: 0, _laneY: 0,
        });
      }
      encounter.humanIds = humans.map(h => h.id);
    }
  }

  // Pre-place a small ambush group just past the defend anchor. They
  // start activated so they charge the player on arrival, selling the
  // "you walked into an ambush" beat.
  if (objective === 'defend') {
    const ambushCount = dest.risk === 'HIGH' ? rng(4, 6) : rng(3, 4);
    const ambushTypes = enableSpitter && dest.risk === 'HIGH'
      ? ['walker', 'walker', 'runner', 'tank', 'spitter']
      : enableSpitter
        ? ['walker', 'walker', 'runner', 'spitter']
        : dest.risk === 'HIGH'
          ? ['walker', 'walker', 'runner', 'tank']
          : ['walker', 'walker', 'runner'];
    for (let i = 0; i < ambushCount; i++) {
      const t = ambushTypes[Math.floor(Math.random() * ambushTypes.length)];
      const z = ZTP[t];
      zombies.push({
        id: uid(), type: t, z,
        x: defendAnchor + 90 + Math.random() * 220,
        hp: z.hp, maxHp: z.hp,
        spd: z.spd * (0.85 + Math.random() * 0.3),
        state: 'idle', facing: -1,
        walkPhase: Math.random() * Math.PI * 2,
        atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
        activated: true,
        ...(t === 'spitter' ? { _spitDmg: spitDmgScaled, _spitRate: spitRateScaled } : {}),
      });
    }
  }

  return {
    soldier: msol, followers,
    origSoldier: lead,                   // back-compat: legacy field points to lead
    origSoldiers: partySoldiers,         // full original-soldiers list (for finishMission)
    dest, biomeKey, fork,
    humans, encounter,
    dialog: null,                        // { type: 'trade', accept, refuse } when active
    objective, defendAnchor, defendDuration,
    // Wave-scaled spitter values, cached so the DEFEND wave-spawner
    // applies the same scaling as initial mkMission spawns.
    _spitDmgScaled: spitDmgScaled, _spitRateScaled: spitRateScaled,
    defendStartedAt: 0, defendNextSpawn: 0,
    zombies, pickups, obstacles, props, hazards, rescuables,
    bullets: [], effects: [], soundQ: [],
    inputUp: false, inputDown: false,
    cameraX: 0,
    inputLeft: false, inputRight: false, inputShoot: false,
    state: 'active',
    // Activation tracking for the goal kill-ratio gate
    activatedCount: 0, killedCount: 0, _lastGoalHint: 0,
    collected: { ammo: 0, medicine: 0, food: 0, materials: 0, sniperAmmo: 0, turretAmmo: 0, civilian: null, rescuedCivs: 0, lostSoldier: null },
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
  if (m.dialog) return; // Pause world simulation while a survivor dialog is open
  if (!m.startedAt) m.startedAt = now;
  const s = m.soldier;
  s.hurtTimer = Math.max(0, s.hurtTimer - dt);
  (m.followers || []).forEach(f => { f.hurtTimer = Math.max(0, f.hurtTimer - dt); });
  (m.humans   || []).forEach(h => { h.hurtTimer = Math.max(0, h.hurtTimer - dt); });

  // Trader proximity: open the trade dialog the first time the lead
  // walks into the camp's radius. Hostile camps skip this and just
  // attack on sight.
  if (m.encounter && !m.encounter.resolved && m.encounter.type === 'trader') {
    if (Math.abs(s.x - m.encounter.x) < 90) {
      m.dialog = { type: 'trade', offer: m.encounter.offer };
      return;
    }
  }

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

  // ── FORK LANE SWITCHING ──────────────────────────────────────
  // Inside the fork range the lead can switch between low (0) and high
  // (1) lanes via W/S. Outside the fork everything snaps back to lane 0.
  const inFork = m.fork && s.x >= m.fork.startX && s.x <= m.fork.endX;
  if (inFork) {
    if (m.inputUp)   s.forkLane = 1;
    if (m.inputDown) s.forkLane = 0;
  } else {
    s.forkLane = 0;
  }
  // Smooth y-offset interp for the lead and every follower
  const targetY = s.forkLane === 1 ? -34 : 0;
  s._laneY = s._laneY + (targetY - s._laneY) * Math.min(1, dt / 90);
  (m.followers || []).forEach(f => {
    f.forkLane = inFork ? s.forkLane : 0;
    const fy = f.forkLane === 1 ? -34 : 0;
    f._laneY = (f._laneY ?? 0) + (fy - (f._laneY ?? 0)) * Math.min(1, dt / 90);
  });

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
        const rate = z._spitRate ?? meta.spitRate;
        if (z.atkTimer >= rate) {
          z.atkTimer = 0;
          const dxr = tgt.x - z.x;
          const dyr = -10;
          const len = Math.hypot(dxr, dyr);
          m.bullets.push({
            id: uid(),
            x: z.x + z.facing * 14, y: MGY - 24,
            dx: (dxr / len) * meta.spitSpd,
            dy: (dyr / len) * meta.spitSpd + 0.06, // slight gravity arc
            dmg: z._spitDmg ?? meta.dmg,
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
          ...(t === 'spitter' ? { _spitDmg: m._spitDmgScaled, _spitRate: m._spitRateScaled } : {}),
        });
        m.activatedCount++;
      }
      if (elapsed >= m.defendDuration) {
        m.state = 'won'; m.endedAt = now;
      }
    }
  }

  // ── HOSTILE HUMANS AI ────────────────────────────────────────
  // Bandits / refused-trader survivors walk into shooting range, hold
  // position, and fire at the closest party member. Their bullets hit
  // party members through the same b.hostile pathway used by spitters.
  (m.humans || []).forEach(h => {
    if (h.state === 'dead' || !h.hostile || !h.activated) return;
    const tgt = aliveParty(m).reduce((best, p) => {
      if (!best) return p;
      return Math.abs(p.x - h.x) < Math.abs(best.x - h.x) ? p : best;
    }, null);
    if (!tgt) return;
    const dx = tgt.x - h.x;
    const dist = Math.abs(dx);
    h.facing = dx >= 0 ? 1 : -1;
    const wMeta = WPN[h.weapon];
    const idealRange = (wMeta.range || 220) * 0.7;
    if (h.state === 'reload') {
      if (now - h.reloadStart >= wMeta.rl) { h.state = 'idle'; h.ammo = h.maxAmmo; }
    } else if (dist > idealRange + 30) {
      h.x += 0.9 * h.facing * (dt / 16);
      h.state = 'walk';
    } else if (dist < idealRange - 60) {
      h.x -= 0.6 * h.facing * (dt / 16);
      h.state = 'walk';
    } else {
      h.state = 'idle';
      if (h.ammo <= 0) { h.state = 'reload'; h.reloadStart = now; }
      else if (now - h.lastShot > wMeta.rate) {
        h.lastShot = now; h.state = 'shoot'; h.ammo--;
        const pellets = wMeta.pel || 1;
        for (let p = 0; p < pellets; p++) {
          const spread = (Math.random() - 0.5) * (wMeta.spread || 0.04);
          const ang = spread;
          m.bullets.push({
            id: uid(),
            x: h.x + h.facing * 10, y: MGY - 26,
            dx: h.facing * wMeta.spd * Math.cos(ang),
            dy: wMeta.spd * Math.sin(ang),
            dmg: wMeta.pel ? wMeta.dmg / wMeta.pel : wMeta.dmg,
            life: Math.ceil(wMeta.range / wMeta.spd * 1.15),
            hostile: true,
          });
        }
        m.soundQ.push({ t: 'fire', w: h.weapon });
      }
    }
  });
  // Trigger any non-yet-activated bandits when the lead gets close.
  // Each newly-activated hostile counts toward the kill-ratio gate.
  (m.humans || []).forEach(h => {
    if (!h.activated && h.hostile && h.state !== 'dead' && Math.abs(s.x - h.x) < 280) {
      h.activated = true;
      m.activatedCount++;
    }
  });

  // ── HAZARDS ──────────────────────────────────────────────────
  // Mine detonation helper. Used by both the proximity trigger
  // (party member walks on it) and the bullet-shot trigger
  // (player shoots the mine from a safe distance).
  const detonateMine = h => {
    if (h.triggered) return;
    h.triggered = true; h.triggeredAt = now;
    m.soundQ.push({ t: 'bhit' });
    const radius = h.radius || 40;
    aliveParty(m).forEach(p => {
      if (Math.abs(p.x - h.x) > radius) return;
      p.hp -= h.dmg; p.hurtTimer = 320;
      m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: `MINE -${h.dmg}`, col: '#ff4400', at: now, dur: 1200 });
      if (p.hp <= 0) {
        p.hp = 0; p.state = 'dead';
        if (p.id === s.id) { m.state = 'lost'; m.endedAt = now; }
      }
    });
    m.effects.push({ type: 'hit', x: h.x, y: MGY - 12, at: now, dur: 480 });
    m.effects.push({ type: 'blood', x: h.x, y: MGY - 12,
      drops: Array.from({ length: 12 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 3 - 0.5, r: 2 + Math.random() * 4 })),
      at: now, dur: 700 });
  };
  m._detonateMine = detonateMine;

  // Mines: proximity trigger on first contact with any party member.
  // Acid pools: tick damage every 500 ms while standing on them.
  (m.hazards || []).forEach(h => {
    if (h.type === 'mine' && !h.triggered) {
      const stepper = aliveParty(m).find(p => Math.abs(p.x - h.x) < 18);
      if (stepper) detonateMine(h);
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

    // Hostile-human bullets damage the party / rescuables / civilians.
    if (b.hostile) {
      const hit = aliveTargets(m).find(p => Math.abs(p.x - b.x) < 18);
      if (hit) {
        hit.hp -= b.dmg; hit.hurtTimer = 220;
        m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: '#ff6644', at: now, dur: 700 });
        m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
        if (hit.hp <= 0) {
          hit.hp = 0; hit.state = 'dead';
          if (hit.id === s.id) { m.state = 'lost'; m.endedAt = now; }
        }
        return false;
      }
      return true;
    }

    // Shootable mines: any bullet whose path crosses the mine's x at
    // ground level detonates it (lets the player clear hazards from a
    // safe distance outside the 40 px blast radius).
    const mineHit = (m.hazards || []).find(h =>
      h.type === 'mine' && !h.triggered &&
      Math.abs(h.x - b.x) < 14 && b.y >= MGY - 38 && b.y <= MGY
    );
    if (mineHit) {
      m._detonateMine(mineHit);
      return false;
    }

    // Friendly bullets hit hostile humans before zombies (humans are
    // typically closer once an engagement starts).
    const humanHit = (m.humans || []).find(h =>
      h.state !== 'dead' && h.hostile && Math.abs(h.x - b.x) < 16
    );
    if (humanHit) {
      humanHit.hp -= b.dmg; humanHit.hurtTimer = 210;
      m.soundQ.push({ t: 'hit', now });
      m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 5 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2 - 0.5, r: 1.4 + Math.random() * 2.4 })), at: now, dur: 580 });
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      m.effects.push({ type: 'txt', x: humanHit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: C.bld, at: now, dur: 680 });
      if (humanHit.hp <= 0) {
        humanHit.hp = 0; humanHit.state = 'dead'; humanHit.deadAt = now;
        m.killedCount++;
      }
      return false;
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

  // Pickups can be grabbed by any party member. Pickups with a fork
  // lane only count if the picker is on the matching lane.
  m.pickups.forEach(p => {
    if (p.collected) return;
    const grabber = aliveParty(m).find(member => {
      if (Math.abs(p.x - member.x) >= 28) return false;
      // Fork pickups require lane match. Non-fork pickups (lane 0) only
      // count when the picker is also on lane 0 to avoid grabbing them
      // while floating up on the high lane.
      const memberLane = member.forkLane || 0;
      const pLane = p.lane || 0;
      return memberLane === pLane;
    });
    if (grabber) {
      p.collected = true;
      if (p.type === 'civilian') {
        m.collected.civilian = true;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: 'CIVILIAN!', col: '#88ddff', at: now, dur: 1000 });
      } else if (p.type === 'lostSoldier') {
        m.collected.lostSoldier = true;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: 'LOST SOLDIER!', col: '#ffd54a', at: now, dur: 1200 });
      } else {
        m.collected[p.type] += p.value;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: `+${p.value} ${p.type}`, col: C.acc, at: now, dur: 900 });
      }
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
    const r = h.radius || 40;
    const blink = Math.sin(now / 220) * 0.5 + 0.5;
    // Danger zone: faint red AoE ring on the ground so the player can
    // see how far the blast reaches and stop in time.
    ctx.strokeStyle = `rgba(220,60,30,${0.18 + blink * 0.22})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(x, MGY + 1, r, 6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // Metallic disc + prong
    ctx.fillStyle = 'rgba(40,38,34,0.95)';
    ctx.beginPath(); ctx.ellipse(x, MGY - 1, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2620';
    ctx.beginPath(); ctx.ellipse(x, MGY - 2, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1814'; ctx.fillRect(x - 1.2, MGY - 5, 2.4, 4);
    // Blinking LED + soft halo
    ctx.fillStyle = `rgba(255,60,20,${0.25 + blink * 0.55})`;
    ctx.beginPath(); ctx.arc(x, MGY - 5, 3.5 + blink * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff6620';
    ctx.beginPath(); ctx.arc(x, MGY - 5, 1.5, 0, Math.PI * 2); ctx.fill();
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

  // Branching path (high lane road)
  if (m.fork) {
    const f = m.fork;
    // Upper road segment
    ctx.fillStyle = biome.ground[0];
    ctx.fillRect(f.startX, MGY - 38, f.endX - f.startX, 8);
    ctx.strokeStyle = biome.groundLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(f.startX, MGY - 30); ctx.lineTo(f.endX, MGY - 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(f.startX, MGY - 38); ctx.lineTo(f.endX, MGY - 38); ctx.stroke();
    // Diagonal connectors at fork start (split) and end (merge)
    ctx.fillStyle = biome.ground[0];
    ctx.beginPath();
    ctx.moveTo(f.startX - 30, MGY); ctx.lineTo(f.startX, MGY - 38);
    ctx.lineTo(f.startX, MGY - 30); ctx.lineTo(f.startX - 30, MGY);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(f.endX, MGY - 38); ctx.lineTo(f.endX + 30, MGY);
    ctx.lineTo(f.endX, MGY - 30); ctx.closePath(); ctx.fill();
    // Entry / exit signs
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(f.startX - 1.5, MGY - 70, 3, 35);
    ctx.fillStyle = '#cc8800';
    ctx.fillRect(f.startX - 18, MGY - 88, 36, 18);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('FORK', f.startX, MGY - 78);
    ctx.fillText('↑W ↓S', f.startX, MGY - 71);
    ctx.textAlign = 'left';
  }

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
    const yOff = (p.lane === 1) ? -34 : 0;
    ctx.save(); ctx.translate(p.x, MGY - 30 + bob + yOff);
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

  // Survivor humans (bandits when hostile, neutral traders before they
  // turn). Rendered between rescuables and the party so they read as
  // "out in the world" rather than part of the squad.
  (m.humans || []).forEach(h => {
    const hc = {
      ...h, lane: 0, onExpedition: false,
      civilian: false, bandit: h.bandit, maxHp: h.maxHp, hp: h.hp,
    };
    dSoldier(ctx, hc, now);
    // Tiny status pip above their head: red for hostile, green for trader
    const px = h.x, py = MGY - 64;
    ctx.fillStyle = h.hostile ? '#cc2222' : '#44bb44';
    ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
    if (h.state !== 'dead' && h.hp < h.maxHp) {
      // small hp bar
      ctx.fillStyle = 'rgba(20,20,20,0.7)'; ctx.fillRect(px - 11, py + 4, 22, 3);
      ctx.fillStyle = h.hostile ? '#cc2222' : '#44bb44';
      ctx.fillRect(px - 11, py + 4, 22 * (h.hp / h.maxHp), 3);
    }
  });

  // Draw followers first so the lead reads as in front of them.
  (m.followers || []).forEach(f => {
    const fc = { ...f, lane: 0, onExpedition: false, state: f.state };
    ctx.save(); ctx.translate(0, f._laneY || 0);
    dSoldier(ctx, fc, now);
    ctx.restore();
  });

  const sCopy = { ...m.soldier, lane: 0, onExpedition: false, state: m.soldier.state };
  ctx.save(); ctx.translate(0, m.soldier._laneY || 0);
  dSoldier(ctx, sCopy, now, true); // pass selection ring to mark the lead
  ctx.restore();

  m.effects.forEach(e => dFx(ctx, e, now));
  m.bullets.forEach(b => dBlt(ctx, b));

  if (m.objective === 'defend') {
    // Sandbag emplacement: a U-shaped barricade around the anchor with
    // the gap facing the player (left). The right wall is the tallest
    // since that's where the zombies are pouring in from. Each bag is
    // a rounded brown sack with a tan top stripe.
    const ax = m.defendAnchor;
    const drawBag = (bx, by) => {
      ctx.fillStyle = '#7a5a32';
      ctx.beginPath();
      // Rounded rectangle (manual since roundRect isn't everywhere yet).
      const w = 11, h = 7, r = 2.5;
      ctx.moveTo(bx - w / 2 + r, by);
      ctx.lineTo(bx + w / 2 - r, by);
      ctx.quadraticCurveTo(bx + w / 2, by, bx + w / 2, by + r);
      ctx.lineTo(bx + w / 2, by + h - r);
      ctx.quadraticCurveTo(bx + w / 2, by + h, bx + w / 2 - r, by + h);
      ctx.lineTo(bx - w / 2 + r, by + h);
      ctx.quadraticCurveTo(bx - w / 2, by + h, bx - w / 2, by + h - r);
      ctx.lineTo(bx - w / 2, by + r);
      ctx.quadraticCurveTo(bx - w / 2, by, bx - w / 2 + r, by);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a07b48'; ctx.fillRect(bx - 4, by + 0.5, 8, 1.5);
      ctx.strokeStyle = '#4a3820'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(bx - 4, by + 4); ctx.lineTo(bx + 4, by + 4); ctx.stroke();
    };
    // Right wall: 3 high, 4 wide (faces the zombie horde)
    for (let row = 0; row < 3; row++) {
      const y = MGY - 7 - row * 7;
      const offset = (row % 2) * 5;
      for (let col = 0; col < 4; col++) {
        drawBag(ax + 20 + offset + col * 11, y);
      }
    }
    // Left wall: short stub, just hip-high (player can see / shoot over)
    for (let row = 0; row < 2; row++) {
      const y = MGY - 7 - row * 7;
      drawBag(ax - 32 + (row % 2) * 5, y);
      drawBag(ax - 21 + (row % 2) * 5, y);
    }
    // Back wall (behind the flag): 1 row, 3 bags
    for (let col = 0; col < 3; col++) {
      drawBag(ax - 8 + col * 11, MGY - 14);
    }

    // Defense anchor flag (sits on top of the back wall)
    const pulse = 0.6 + 0.4 * Math.sin(now / 280);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(ax - 1, MGY - 70, 2, 56);
    ctx.fillStyle = `rgba(255,140,40,${0.5 + pulse * 0.4})`;
    ctx.beginPath();
    ctx.moveTo(ax + 1, MGY - 68); ctx.lineTo(ax + 26, MGY - 60); ctx.lineTo(ax + 1, MGY - 52);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.acc; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('★ LAST STAND ★', ax, MGY - 80); ctx.textAlign = 'left';
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
  // In DEFEND mode once the timer starts, the bar tracks survival time
  // instead of map progress so the player can see the countdown.
  let pct;
  if (m.objective === 'defend' && m.defendStartedAt) {
    pct = Math.min(1, (now - m.defendStartedAt) / m.defendDuration);
    ctx.fillStyle = '#ff8844';
  } else {
    pct = m.soldier.x / MISSION_W;
    ctx.fillStyle = C.acc;
  }
  ctx.fillRect(px, 14, pw * pct, ph);
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
      ? '← → MOVE   SPACE/CLICK FIRE   W/S CHANGE LANE   HOLD THE FLAG'
      : '← → MOVE   SPACE/CLICK FIRE   W/S CHANGE LANE   REACH GOAL',
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

  // ── SURVIVOR TRADE DIALOG ───────────────────────────────────
  // Drawn on top of everything when active. Hit zones for ACCEPT /
  // REFUSE are returned via m.dialog._buttons so the canvas click
  // handler can route mouse clicks back to the resolution callbacks.
  if (m.dialog && m.dialog.type === 'trade') {
    const offer = m.dialog.offer;
    const w = 520, h = 200, x = (CW_ - w) / 2, y = (CH - h) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, CW_, CH);
    ctx.fillStyle = 'rgba(10,18,10,0.96)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.acc; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = C.acc; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('SURVIVOR CAMP — TRADE OFFER', CW_ / 2, y + 24);
    ctx.fillStyle = C.txt; ctx.font = '11px monospace';
    ctx.fillText('"We can spare some supplies — but it\'s not free."', CW_ / 2, y + 46);
    ctx.fillText(`They offer: ${offer.desc}`, CW_ / 2, y + 64);

    const fmt = obj => Object.entries(obj).map(([k, v]) => `${v} ${objIcons[k] || k}`).join('   ');
    ctx.fillStyle = '#ff8855'; ctx.font = 'bold 12px monospace';
    ctx.fillText(`YOU GIVE: ${fmt(offer.give)}`,  CW_ / 2, y + 92);
    ctx.fillStyle = '#88ddff';
    ctx.fillText(`YOU GET:  ${fmt(offer.get)}`,   CW_ / 2, y + 112);

    // Two buttons at the bottom
    const bw = 200, bh = 32, by = y + h - bh - 16;
    const ax = x + 24, rx = x + w - bw - 24;
    ctx.fillStyle = '#1a3a18'; ctx.fillRect(ax, by, bw, bh);
    ctx.strokeStyle = C.acc; ctx.strokeRect(ax, by, bw, bh);
    ctx.fillStyle = C.acc; ctx.font = 'bold 12px monospace';
    ctx.fillText('✓ ACCEPT', ax + bw / 2, by + 21);
    ctx.fillStyle = '#3a1818'; ctx.fillRect(rx, by, bw, bh);
    ctx.strokeStyle = C.dng; ctx.strokeRect(rx, by, bw, bh);
    ctx.fillStyle = C.dng;
    ctx.fillText('✖ REFUSE (fight)', rx + bw / 2, by + 21);
    ctx.textAlign = 'left';

    if (m.dialog._error) {
      ctx.fillStyle = C.dng; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(m.dialog._error, CW_ / 2, by - 8);
      ctx.textAlign = 'left';
    }

    // Store hit zones so the canvas onClick can resolve the dialog
    m.dialog._buttons = {
      accept: { x: ax, y: by, w: bw, h: bh },
      refuse: { x: rx, y: by, w: bw, h: bh },
    };
  }
}
