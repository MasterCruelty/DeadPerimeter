import { C, CH, uid, rng } from '../constants.js';
import { WPN, wbase, MELEE } from '../data/weapons.js';
import { meleeStats, wearMelee, gearIcon, gearName, tickStam, spendStam, JUMP_COST, maxStam, winded } from '../entities/gear.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MISSION_VIEW, MGY, objIcons, rollEncounter, setMissionWidth } from '../data/expeditions.js';
import { setupCityMission, tickCity, clampCity, barricadeStops, barricadeBetween, onContainerSearched } from './cityMission.js';
import { dCityWorld, dCityHUD } from '../render/cityMission.js';
import { dRoomDecor, dRoomDoors } from '../render/rooms.js';
import { roomKind } from './rooms.js';
import { BIOMES, DEFAULT_BIOME, SEARCHABLE_TYPES } from '../data/biomes.js';
import { pickupValue, boxValue, LOCKED_MUL } from '../data/rewards.js';
import { BALANCE, RESEARCHES, getSoldierPerkEffect } from '../data/difficulty.js';
import { dZombie } from '../render/zombie.js';
import { dSoldier } from '../render/soldier.js';
import { dFx, dBlt } from '../render/effects.js';
import { dRadioSubtitle } from '../render/hud.js';
import { dNades } from '../render/moves.js';
import { setupMissionExtras, tickMissionExtras, bulletHitsSide } from './missionExtras.js';
import { dMissionExtras } from '../render/missionExtras.js';
import { tickObjectives, garrisonOf } from './objectives.js';
import { dObjectives } from '../render/objectives.js';
import { startSortieStats, trackShot, trackHit, sortieReport } from '../expedition/report.js';
import { dReportGrade } from '../render/report.js';
import { pushRadio } from '../audio/radio.js';
import { tickMoves, rollStep, dodging, kick, hitstop, addShake, nadeFind, giveNade } from './moves.js';
import { t } from '../i18n/index.js';

// Hurt-callout helper (same logic as siege): fires once when a party
// member's HP drops below 35% of max, resets above 60%.
function missionHurtCallout(m, p) {
  if (!p || p.state === 'dead' || p.civilian) return;
  if (p.hp <= 0) return;
  const pct = p.hp / (p.maxHp || 100);
  if (pct < 0.35 && !p._hurtCallout) {
    p._hurtCallout = true;
    pushRadio(m, 'hurt', { urgent: true, speaker: p });
  } else if (pct > 0.60) {
    p._hurtCallout = false;
  }
}

// Random kill chatter in missions (8% chance, throttled by pushRadio).
function missionKillChatter(m, sol) {
  if (!sol || sol.civilian) return;
  if (Math.random() < 0.08) pushRadio(m, 'kill', { speaker: sol });
}

// Called whenever the lead's hp drops to 0. If a follower is still
// alive, promote them to the new lead so the player keeps an avatar
// and the mission continues. The mission only fails when EVERY party
// member is dead (handled separately in the zombie-AI tick).
function promoteLeadOnDeath(m, now) {
  const s = m.soldier;
  if (!s || s.hp > 0) return false;
  if (s.state !== 'dead') s.state = 'dead';
  const heir = (m.followers || []).find(f => f.hp > 0 && f.state !== 'dead');
  if (!heir) return false;
  // Move the dead lead into the followers list so finishMission still
  // sees them in origSoldiers mapping; pull the heir out of followers.
  const oldLead = s;
  m.followers = (m.followers || []).filter(f => f.id !== heir.id);
  m.followers.unshift(oldLead);
  // Copy facing so the new lead doesn't snap.
  heir.facing = oldLead.facing;
  heir.forkLane = oldLead.forkLane || 0;
  heir._laneY   = oldLead._laneY   || 0;
  m.soldier = heir;
  m.effects.push({ type: 'txt', x: heir.x, y: MGY - 90, v: t('LEAD DOWN — {name} TAKING POINT', { name: heir.name.toUpperCase() }), col: '#ff8844', at: now, dur: 2600 });
  pushRadio(m, 'advance', { line: "I've got point!", urgent: true, speaker: heir });
  return true;
}

// Combat modifiers a soldier carries into a mission: their own weapon
// perks (workbench) and the base-wide research. Previously missions read
// raw WPN stats, so perks / research did nothing outside the siege.
function missionModifiers(orig, researchCompleted) {
  const done = Array.isArray(researchCompleted) ? researchCompleted : [];
  const res = (key, def) => done.reduce((v, id) => {
    const r = RESEARCHES.find(x => x.id === id);
    if (!r || !r.effects || !(key in r.effects)) return v;
    return key.endsWith('Mul') ? v * r.effects[key] : v + r.effects[key];
  }, def);
  const isSniper = wbase(orig.weapon) === 'sniper';
  return {
    dmgMul: getSoldierPerkEffect(orig, 'damageMul', 1) * res('soldierDamageMul', 1),
    rlMul: getSoldierPerkEffect(orig, 'reloadMul', 1) * res('reloadMul', 1),
    rangeBonus: getSoldierPerkEffect(orig, 'rangeBonus', 0) + (isSniper ? res('sniperRangeBonus', 0) : 0),
    tankMul: wbase(orig.weapon) === 'rifle' ? res('rifleVsTankMul', 1) : 1,
  };
}
const effRl = (who, w) => w.rl * (who.rlMul || 1);
const effRange = (who, w) => w.range + (who.rangeBonus || 0);

// magsPerSoldier: how many magazines each party member carries into
// the mission. 1 = only the loaded mag (no reloads possible). 2 =
// loaded + 1 spare. Etc. Tunable from the expedition loadout UI.
// Mission soldiers carry a finite ammo budget now — no more infinite
// auto-reload — so the player has to weigh stash spend vs mission risk.
export function mkMission(soldier, dest, wave = 1, magsPerSoldier = 2, researchCompleted = []) {
  const zombies = [], pickups = [], obstacles = [];
  // City-map locations are longer EXPLORE missions (update/cityMission.js).
  const explore = !!dest.locId;
  setMissionWidth(explore ? dest.W : 0);
  const widthMul = MISSION_W / 1900;

  // Spitters are the most punishing zombie kind (ranged + chip damage).
  // Gate them behind wave 5 so the early sorties aren't meatgrinders,
  // and scale their lethality up with wave count for late-game runs.
  const waveAbove = Math.max(0, wave - 5);
  const enableSpitter = wave >= 5;
  // Tanks in HIGH missions only from wave 4+ — early HIGH runs leaned
  // on 3+ tank spawns which made them un-survivable for a fresh squad.
  const enableHighTank = wave >= 4;
  const spitDmgScaled = Math.max(3, Math.round(ZTP.spitter.dmg * (0.7 + waveAbove * 0.10)));
  const spitRateScaled = Math.max(1500, 2800 - waveAbove * 130);

  // Mission zombie count: another step down after playtest feedback
  // ("ancora elevato"). LOW ≈ 2-5, MED ≈ 4-7, HIGH ≈ 6-9 (was 3-6 /
  // 6-9 / 10-13). The playable mission already supports up to 3
  // party members shooting + auto-reload, so smaller crowds keep
  // sorties feeling like raids, not survival ordeals.
  const totalZ = Math.floor((4 * dest.zSpawn + rng(0, 3)) * (explore ? widthMul : 1));
  for (let i = 0; i < totalZ; i++) {
    const x = 400 + Math.random() * (MISSION_W - 700);
    let types;
    if (dest.risk === 'LOW') {
      types = ['walker'];
    } else if (dest.risk === 'MED') {
      types = enableSpitter ? ['walker', 'walker', 'walker', 'runner', 'spitter']
                            : ['walker', 'walker', 'walker', 'runner'];
    } else {
      const base = enableSpitter
        ? ['walker', 'runner', 'runner', 'spitter']
        : ['walker', 'walker', 'runner', 'runner'];
      types = enableHighTank ? [...base, 'tank'] : base;
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
  // Pickup count: keep the previous bump (sorties have to pay back)
  // but trim food / materials values so the stash doesn't snowball.
  // After 15+ days the user was sitting on 500 food / 300 materials.
  const pkCount = Math.round((dest.risk === 'LOW' ? 6 : dest.risk === 'MED' ? 7 : 9)
    * (explore ? widthMul * (0.25 + 0.75 * (dest.lootLeft ?? 1)) : 1));
  // Value-normalised quantities, risk/distance premium, deeper = richer
  // (see data/rewards.js). Spread evenly over the reachable street:
  // the old formula could drop the last pickup past the end of the map.
  const valueMul = dest.valueMul || 1;
  for (let i = 0; i < pkCount; i++) {
    const x = Math.max(260, Math.min(MISSION_W - 160,
      Math.round(300 + (MISSION_W - 520) * (i + 1) / (pkCount + 1)) + rng(-50, 50)));
    const type = pkOptions[Math.floor(Math.random() * pkOptions.length)];
    pickups.push({ id: uid(), x, type, value: pickupValue(type, { wave, x, W: MISSION_W, mul: valueMul }), collected: false, lane: 0 });
  }
  // (Pickup-elevation pass runs AFTER buildings + platforms are
  // generated, further below — buildings/platforms are still in the
  // temporal dead zone here.)
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

  // Vaccine campaign — hospital scenario gets one guaranteed vaccine
  // pickup deep in the map. Picking it up arms the carrier mechanic
  // (renderer draws a vial above their head; on death the vial drops
  // and any party member can pick it back up). The campaign's tier
  // resolution at the end reads m._vaccineCollected to decide whether
  // the vaccine made it out.
  if (dest._vaccineSegment === 'hospital') {
    pickups.push({
      id: uid(), x: MISSION_W - 180, type: 'vaccine',
      value: 1, collected: false, lane: 0,
      _vaccine: true,
    });
  }

  // Mission objective: 70% normal "reach the goal", 30% "defend".
  // DEFEND missions cut the travel short: the lead reaches a hastily
  // built sandbag emplacement around 45% of the map, then has to hold
  // the position for `defendDuration` ms against waves of zombies
  // pouring in from the deeper city to the right.
  //
  // Vaccine campaign scenarios override the random objective: rooftop
  // is always defend (hold the LZ until the chopper arrives); highway
  // and hospital are always reach (push through to the next leg).
  const vacSeg = dest._vaccineSegment || null;
  let objective;
  if (vacSeg === 'rooftop') objective = 'defend';
  else if (vacSeg) objective = 'reach';
  else if (explore) objective = 'explore';
  else objective = (dest.risk !== 'LOW' && Math.random() < 0.30) ? 'defend' : 'reach';
  const defendAnchor = MISSION_W * 0.45;
  // Rooftop hold is 75 s — long enough for the boss horde, short
  // enough that the player doesn't get bored. Regular defends stay at 45 s.
  const defendDuration = vacSeg === 'rooftop' ? 75000 : 45000;

  // Branching path: random 50% on MED/HIGH (mutually exclusive with defend
  // because the defend anchor sits inside the fork range). Two parallel
  // lanes between fork.startX and fork.endX. Each lane has its own pickup
  // cluster; the player picks via W/S on the keyboard.
  //
  // Vaccine campaign segments disable the fork: the player is moving
  // a sample through a scripted route, not picking between loot lanes.
  const fork = (objective === 'reach' && dest.risk !== 'LOW' && !vacSeg && Math.random() < 0.50)
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

  // Multi-segment missions: a MED/HIGH outdoor destination has a
  // ~55% chance of an "enter the building" transition halfway
  // through. The right half of the world swaps to an indoor biome
  // (police_interior / armory_interior / office_interior) and a
  // doorway prop marks the entry point. Already-indoor destinations
  // (Police Station, Gun Shop, Office Tower) stay single-biome.
  const INDOOR_POOL = ['police_interior', 'armory_interior', 'office_interior'];
  let indoorBiomeKey = null;
  let entranceX = 0;
  if (!explore && !biome.indoor && dest.risk !== 'LOW' && Math.random() < 0.55) {
    indoorBiomeKey = INDOOR_POOL[Math.floor(Math.random() * INDOOR_POOL.length)];
    entranceX = Math.floor(MISSION_W * (0.38 + Math.random() * 0.08));
  }
  const indoorBiome = indoorBiomeKey ? BIOMES[indoorBiomeKey] : null;
  const obsCount = rng(4, 9);
  for (let i = 0; i < obsCount; i++) {
    const ox = 200 + i * MISSION_W / (obsCount + 1) + rng(-50, 50);
    // Multi-segment missions: obstacles past the entrance use the
    // indoor pool (desks, lockers, etc.) so the building interior
    // doesn't feel like an outdoor street with brick walls.
    const useIndoor = indoorBiome && ox >= entranceX;
    const pool = useIndoor ? indoorBiome.obstacles : biome.obstacles;
    const otype = pool[Math.floor(Math.random() * pool.length)];
    // Searchable container types — looting them yields a small
    // resource drop (TLS Union City style). The player walks up to
    // one and the auto-search kicks in. Half the obstacles in
    // indoor sections are searchable; outdoor mission corpses /
    // wrecks have a lower rate.
    const baseChance = useIndoor ? 0.55 : 0.30;
    const searchable = SEARCHABLE_TYPES.has(otype) && Math.random() < baseChance;
    obstacles.push({ x: ox, type: otype, searchable, searched: false });
  }
  // Decorative props every biome.propsPerStep along the road
  // (lampposts, fences, broken streetlights). Stored separately so the
  // renderer can layer them behind/around the obstacles.
  const props = [];
  for (let px = biome.propsPerStep; px < MISSION_W - 50; px += biome.propsPerStep) {
    // Multi-segment: outdoor props only in the outdoor half; indoor
    // gets its own decor type past the entrance.
    if (indoorBiome && px >= entranceX) {
      props.push({ x: px + rng(-30, 30), type: indoorBiome.propType });
    } else {
      props.push({ x: px + rng(-30, 30), type: biome.propType });
    }
  }

  // ── Vertical layout ─────────────────────────────────────────
  // Indoor sections are real BUILDINGS with a proper second floor
  // running the full length of the indoor section, connected to
  // the ground floor by 1-2 staircases at fixed positions. Outdoor
  // sections still use scattered fire-escape ledges for variety.
  const platforms = [];
  const ladders = [];
  const FLOOR_H = 80;   // distance from ground to upper floor
  const FLOOR_Y = MGY - FLOOR_H;   // world Y of the upper floor top
  const buildings = [];

  if (biome.indoor) {
    // Single-biome indoor mission (Police Station, Gun Shop, etc.):
    // the whole world IS one building. Upper floor spans most of it
    // with two staircases — one early, one near the goal.
    const bx = 220, bw = MISSION_W - 280;
    buildings.push({ x: bx, w: bw, floorY: FLOOR_Y, biomeKey });
    // Upper floor as a single wide "platform" so the existing
    // jump / collision code still works.
    platforms.push({ x: bx + 40, y: FLOOR_Y, w: bw - 80, type: 'floor' });
    // Two staircases: 1/3 and 2/3 along the building.
    const s1 = bx + Math.floor(bw * 0.30);
    const s2 = bx + Math.floor(bw * 0.72);
    ladders.push({ x: s1, yTop: FLOOR_Y, yBot: MGY, type: 'stairs', slopeDir: +1 });
    ladders.push({ x: s2, yTop: FLOOR_Y, yBot: MGY, type: 'stairs', slopeDir: -1 });
  } else if (indoorBiome) {
    // Multi-segment outdoor → indoor mission. The indoor half
    // (entranceX → MISSION_W) is a building with a real upper
    // floor reachable via staircases. The outdoor half stays
    // ground-level with no platforms (street, no fire escapes
    // for now — keeps the contrast).
    const bx = entranceX + 30;
    const bw = MISSION_W - bx - 60;
    buildings.push({ x: bx, w: bw, floorY: FLOOR_Y, biomeKey: indoorBiomeKey });
    platforms.push({ x: bx + 40, y: FLOOR_Y, w: bw - 80, type: 'floor' });
    // Stairs: one just past the entrance + one near the goal.
    const s1 = bx + Math.floor(bw * 0.18);
    const s2 = bx + Math.floor(bw * 0.78);
    ladders.push({ x: s1, yTop: FLOOR_Y, yBot: MGY, type: 'stairs', slopeDir: +1 });
    ladders.push({ x: s2, yTop: FLOOR_Y, yBot: MGY, type: 'stairs', slopeDir: -1 });
  } else {
    // Pure outdoor mission — keep the old scattered fire-escape
    // ledges so the player still has SOME verticality to use.
    const ledgeCount = rng(2, 3);
    for (let i = 0; i < ledgeCount; i++) {
      const segW = (MISSION_W - 400) / ledgeCount;
      const lx = 280 + i * segW + rng(-40, 80);
      const ly = MGY - rng(45, 65);
      const lw = rng(120, 180);
      platforms.push({ x: lx, y: ly, w: lw, type: 'ledge' });
      const onLeft = (i % 2 === 0);
      ladders.push({
        x: onLeft ? lx + 10 : lx + lw - 14,
        yTop: ly, yBot: MGY,
        type: 'ladder',
        slopeDir: onLeft ? 1 : -1,
      });
    }
  }

  // Now that buildings + platforms exist, elevate ~35% of the
  // resource pickups inside the building's x range to the upper
  // floor with a 1.4× value bonus. Exploration reward — the
  // player has to climb the stairs to grab them.
  if (buildings.length > 0) {
    const upperPlat = platforms.find(p => p.type === 'floor');
    if (upperPlat) {
      const candidates = pickups.filter(p =>
        !p.standingY && !p.fork
        && p.x > upperPlat.x + 20 && p.x < upperPlat.x + upperPlat.w - 20,
      );
      const elevateCount = Math.floor(candidates.length * 0.35);
      for (let i = 0; i < elevateCount; i++) {
        const p = candidates[i];
        if (!p) break;
        p.standingY = upperPlat.y - MGY;        // negative
        p.value = Math.round((p.value || 1) * 1.4);
      }
    }
  }

  // Sprinkle a few zombies on the platforms so the player has a
  // reason to look up. Only for indoor / multi-segment indoor
  // sections (outdoor missions keep the horde on the street as
  // before). Up to ~20% of the wave can start elevated.
  if ((biome.indoor || indoorBiome) && platforms.length > 0) {
    const candidates = zombies.filter(z =>
      z.type === 'walker' || z.type === 'runner' || z.type === 'spitter',
    );
    const elevateCount = Math.floor(candidates.length * 0.18);
    for (let i = 0; i < elevateCount; i++) {
      const z = candidates[i];
      if (!z) break;
      const p = platforms[Math.floor(Math.random() * platforms.length)];
      // Skip placing on the very first platform near the start so
      // the player isn't ambushed at spawn.
      if (p.x < 200) continue;
      z.x = p.x + 12 + Math.random() * Math.max(8, p.w - 24);
      z.standingY = p.y - MGY;  // negative
    }
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
    // Spare magazines beyond the one already loaded. When the loaded
    // mag goes empty, one spare gets consumed by the reload. When
    // spare and loaded are both 0, knifeReady stays true and the
    // soldier visually holsters their firearm + brandishes a knife.
    // playMission's loadout step sets orig._sortieMags = actual mags
    // issued (capped by stash). Falls back to magsPerSoldier for any
    // soldier that wasn't pre-loaded.
    magsLeft: Math.max(0, ((orig._sortieMags ?? magsPerSoldier) | 0) - 1),
    knifeReady: false,
    // Melee weapon (with wear), skills and perks travel with the soldier.
    melee: orig.melee ? { ...orig.melee } : null,
    skills: orig.skills, upgrades: orig.upgrades, _kills: 0,
    // Jump physics: jumpY is the render-only y-offset (negative =
    // above ground), vy is vertical velocity. Followers don't jump,
    // only the lead reacts to inputUp.
    jumpY: 0, vy: 0,
    civilian: !!orig.civilian,
    state: 'idle', facing: 1,
    lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0,
    walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0, reloadTriggered: false,
    onExpedition: true,
    // Mission fork lane (0 = low / default, 1 = high). _laneY is the
    // smoothed render offset toward the target lane.
    forkLane: 0, _laneY: 0,
    ...missionModifiers(orig, researchCompleted),
  });

  const msol = buildMissionSoldier(lead, 0);
  const followers = partySoldiers.slice(1).map((s, i) => buildMissionSoldier(s, i + 1));

  // ── SURVIVOR ENCOUNTER ─────────────────────────────────────────
  // Defend missions skip the encounter (the ambush IS the event).
  // Reach missions get a 28% / 40% chance (MED / HIGH) of running
  // into another group of survivors mid-route. The group is either
  // already hostile (bandits) or peaceful traders who turn hostile
  // if the player refuses their offer.
  //
  // When an encounter spawns, the immediate area around the camp is
  // treated as "cleared" — survivors have killed or driven off any
  // zombies that wandered in, so the player fights ONE faction at a
  // time. The buffer is also re-applied at proximity (see
  // updateMission below) to catch any zombie that walked in later.
  const humans = [];
  let encounter = null;
  if (objective !== 'defend') {
    encounter = rollEncounter(dest.risk);
    if (encounter) {
      encounter.x = MISSION_W * (0.32 + Math.random() * 0.10);
      encounter.resolved = false;
      encounter.clearRadius = 220;
      encounter._proxCleared = false;
      // Remove every zombie spawned inside the buffer so the camp
      // starts off visually intact.
      for (let i = zombies.length - 1; i >= 0; i--) {
        if (Math.abs(zombies[i].x - encounter.x) <= encounter.clearRadius) {
          zombies.splice(i, 1);
        }
      }
      const bandit = encounter.type === 'hostile';
      const count = bandit ? rng(3, 4) : rng(2, 3);
      // Survivors carry scavenged civilian weapons — mostly pistols.
      // Bandits are slightly better armed (shotguns more common); no
      // military rifles since the only intact army is Fort Omega.
      const weapons = bandit
        ? ['pistol', 'pistol', 'pistol', 'shotgun', 'shotgun']
        : ['pistol', 'pistol', 'pistol', 'shotgun'];
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

  const mission = {
    W: MISSION_W,                        // world width (MISSION_W is synced to this)
    wave, valueMul,                      // reward scaling (data/rewards.js)
    soldier: msol, followers,
    origSoldier: lead,                   // back-compat: legacy field points to lead
    origSoldiers: partySoldiers,         // full original-soldiers list (for finishMission)
    dest, biomeKey, indoorBiomeKey, entranceX, fork,
    humans, encounter,
    dialog: null,                        // { type: 'trade', accept, refuse } when active
    objective, defendAnchor, defendDuration,
    // Wave-scaled spitter values, cached so the DEFEND wave-spawner
    // applies the same scaling as initial mkMission spawns.
    _spitDmgScaled: spitDmgScaled, _spitRateScaled: spitRateScaled,
    defendStartedAt: 0, defendNextSpawn: 0,
    zombies, pickups, obstacles, props, hazards, rescuables, platforms, ladders, buildings,
    bullets: [], effects: [], soundQ: [],
    inputUp: false, inputDown: false,
    cameraX: 0,
    inputLeft: false, inputRight: false, inputShoot: false,
    state: 'active',
    // Activation tracking for the goal kill-ratio gate
    activatedCount: 0, killedCount: 0, _lastGoalHint: 0,
    collected: { ammo: 0, medicine: 0, food: 0, materials: 0, sniperAmmo: 0, turretAmmo: 0, civilian: null, rescuedCivs: 0, lostSoldier: null, gear: [], quests: [] },
    startedAt: 0, endedAt: 0,
  };
  if (explore) setupCityMission(mission, dest);
  setupMissionExtras(mission, dest, wave);
  mission.stats = startSortieStats(mission);
  return mission;
}

// Wake a hostile and the ones around it (a whole Compact squad hears it).
function alertHumans(m, h) {
  const r = h.compact ? 500 : 320;
  (m.humans || []).forEach(o => {
    if (o.activated || !o.hostile || o.state === 'dead' || Math.abs(o.x - h.x) > r) return;
    o.activated = true; m.activatedCount++;
  });
  if (!h.activated) { h.activated = true; m.activatedCount++; }
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
// does not end the mission. Activated humans (bandits + refused
// traders) are also fair game for zombies — they're alive, they're
// not allies of the dead. Peaceful traders (not activated) stay
// off the list so they're not chewed up during the trade dialog.
function aliveTargets(m) {
  const out = aliveParty(m).slice();
  (m.rescuables || []).forEach(r => { if (r.hp > 0 && r.state !== 'dead') out.push(r); });
  (m.humans || []).forEach(h => {
    if (h.hp > 0 && h.state !== 'dead' && h.activated) out.push(h);
  });
  return out;
}

// One melee swing (knife / bat / machete / axe) with wear and credit.
function meleeHit(m, who, tgt, now) {
  const ms = meleeStats(who);
  tgt.hp -= ms.dmg; tgt.hurtTimer = 220;
  m.soundQ.push({ t: ms.type === 'knife' || ms.type === 'machete' ? 'slash' : 'hit', now, x: who.x });
  m.effects.push({ type: 'slash', x: tgt.x + who.facing * 10, y: MGY - 28 + (tgt.standingY || 0), at: now, dur: 230 });
  m.effects.push({ type: 'txt', x: tgt.x, y: MGY - 58 + (tgt.standingY || 0), v: `-${ms.dmg}`, col: '#ffcc44', at: now, dur: 600 });
  const broke = wearMelee(who);
  if (broke) m.effects.push({ type: 'txt', x: who.x, y: MGY - 90, v: t('{w} BROKE', { w: t(MELEE[broke].name).toUpperCase() }), col: C.dng, at: now, dur: 1200 });
  if (tgt.hp <= 0) {
    tgt.hp = 0; tgt.state = 'dead'; tgt.deadAt = now;
    m.soundQ.push({ t: 'zdie', zt: tgt.type, x: tgt.x }); m.killedCount++;
    who._kills = (who._kills || 0) + 1;
  }
}

// Shared AI tick for shooting + knife melee. Used by both the lead
// (when its ammo is dry and the player wants to mash forward — handled
// inline below) and by the followers (always automatic).
function aiShoot(m, who, now, dt) {
  const w = WPN[who.weapon];
  // Reload completion
  if (who.state === 'reload' && now - who.reloadStart >= effRl(who, w)) {
    who.state = 'idle'; who.reloadTriggered = false;
  }
  if (who.state === 'reload') return;

  // Pick nearest activated zombie or armed hostile in range
  const range = effRange(who, w);
  const inRange = e => e.state !== 'dead' && e.activated && Math.abs(e.x - who.x) <= range && !barricadeBetween(m, who.x, e.x);
  const tgt = m.zombies.filter(inRange)
    .concat((m.humans || []).filter(h => h.hostile && inRange(h)))
    .sort((a, b) => Math.abs(a.x - who.x) - Math.abs(b.x - who.x))[0];

  if (!tgt) {
    if (who.state === 'shoot' && now - who.shootAt > 200) who.state = 'idle';
    return;
  }
  who.facing = tgt.x > who.x ? 1 : -1;

  if (who.ammo <= 0) {
    // Knife melee fallback (same logic as the lead)
    const meleeTgt = m.zombies.find(z => z.state !== 'dead' && z.activated && Math.abs(z.x - who.x) < 52
      && Math.abs((z.standingY || 0) - (who.standingY || 0)) < 22);
    if (meleeTgt) {
      who.facing = meleeTgt.x > who.x ? 1 : -1;
      who.knifeTimer = (who.knifeTimer || 0) + dt;
      if (who.knifeTimer >= meleeStats(who).rate) {
        who.knifeTimer = 0; who.state = 'knife'; who.shootAt = now;
        meleeHit(m, who, meleeTgt, now);
      }
    } else if (who.state === 'knife' && now - who.shootAt > 300) {
      who.state = 'idle'; who.knifeTimer = 0;
    }
    return;
  }

  if (now - who.lastShot >= w.rate) {
    who.state = 'shoot'; who.lastShot = now; who.shootAt = now; who.ammo--;
    m.soundQ.push({ t: 'shot', w: who.weapon, x: who.x }); m.soundQ.push({ t: 'shell' });
    const bx = who.x + who.facing * 38;
    const shooterY = (who.standingY || 0);
    const bulletY  = MGY - 42 + shooterY;
    for (let p = 0; p < (w.pel || 1); p++) {
      const sp2 = (Math.random() - 0.5) * w.sp * 2;
      m.bullets.push({
        id: uid(), x: bx, y: bulletY, src: who,
        dx: who.facing * w.spd * Math.cos(sp2),
        dy: w.spd * Math.sin(sp2),
        dmg: (w.pel ? w.dmg / w.pel : w.dmg) * (who.dmgMul || 1),
        tankMul: who.tankMul || 1,
        shooterY,
        life: Math.ceil(range / w.spd * 1.15),
      });
    }
    m.effects.push({ type: 'shell', x: who.x - who.facing * 8, y: MGY - 26, vx: -who.facing * (1.4 + Math.random()), at: now, dur: 780 });
    if (who.ammo === 0) {
      if ((who.magsLeft || 0) > 0) {
        who.state = 'reload'; who.reloadStart = now; who.ammo = who.maxAmmo;
        who.magsLeft -= 1;
        m.soundQ.push({ t: 'reload', w: who.weapon, dur: effRl(who, w) });
      } else {
        // No more mags — holster firearm, knife is ready.
        who.knifeReady = true;
      }
    }
  } else if (now - who.lastShot > w.rate * 0.5) {
    who.state = 'idle';
  }
}

export function updateMission(m, now, dt) {
  setMissionWidth(m.W);
  if (m.state !== 'active') return;
  if (m.dialog) return; // Pause world simulation while a survivor dialog is open
  if (!m.startedAt) {
    m.startedAt = now;
    // Vaccine campaign scenarios pop a big intro banner on the first
    // frame so the player knows which leg they just transitioned to.
    if (m._vaccineScenarioName) {
      m.effects.push({
        type: 'txt', x: m.soldier.x, y: MGY - 140,
        v: t(m._vaccineScenarioName).toUpperCase(),
        col: '#ffcc44', at: now, dur: 3200,
      });
    }
  }
  // Vaccine carrier death — if the vial-holder has died (lead or
  // follower), drop the vaccine as a fresh pickup at their last X so
  // a teammate can grab it. Runs each frame so it catches deaths from
  // any source (zombie melee, hostile bullet, hazard).
  if (m._vaccineCollected && m._vaccineCarrierId && !m._vaccineDropped) {
    const carrier = [m.soldier, ...(m.followers || [])].find(p => p && p.id === m._vaccineCarrierId);
    if (!carrier || carrier.hp <= 0 || carrier.state === 'dead') {
      const dropX = carrier ? carrier.x : m.soldier.x;
      m.pickups.push({
        id: uid(), x: dropX, type: 'vaccine',
        value: 1, collected: false, lane: 0,
        _vaccine: true, _droppedAt: now,
      });
      m._vaccineDropped = true;
      m._vaccineCarrierId = null;
      m.effects.push({
        type: 'txt', x: dropX, y: MGY - 60,
        v: t('💉 VACCINE DROPPED — RECOVER IT'),
        col: '#ff8844', at: now, dur: 2600,
      });
    }
  }

  // Top-of-frame guard: if the lead died (any cause), promote a
  // follower so the player keeps an avatar. Only fail when nobody
  // is left standing.
  if (m.soldier.hp <= 0 || m.soldier.state === 'dead') {
    if (!promoteLeadOnDeath(m, now)) {
      m.state = 'lost'; m.endedAt = now;
      return;
    }
  }
  const s = m.soldier;
  s.hurtTimer = Math.max(0, s.hurtTimer - dt);
  aliveParty(m).forEach(p => tickStam(p, dt));
  (m.followers || []).forEach(f => { f.hurtTimer = Math.max(0, f.hurtTimer - dt); });
  (m.humans   || []).forEach(h => { h.hurtTimer = Math.max(0, h.hurtTimer - dt); });

  // Encounter buffer zone: when the lead gets close, sweep the area
  // free of any zombies that drifted into the survivor camp so the
  // player doesn't end up fighting both factions simultaneously.
  // Survivors win the encounter zone — they're effectively "the new
  // tenants" until the player resolves the meeting.
  if (m.encounter && !m.encounter._proxCleared && Math.abs(s.x - m.encounter.x) < 280) {
    const r = m.encounter.clearRadius || 170;
    for (let i = m.zombies.length - 1; i >= 0; i--) {
      const z = m.zombies[i];
      if (z.state === 'dead') continue;
      if (Math.abs(z.x - m.encounter.x) <= r) m.zombies.splice(i, 1);
    }
    m.encounter._proxCleared = true;
  }

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
  if (rollStep(m, s, dt)) {
    // Dodge roll in progress (update/moves.js): no steering.
  } else if (s.state !== 'reload' && s.state !== 'knife') {
    // Holding fire locks the facing so the lead can backpedal while
    // shooting (kiting a Brute / Tank) instead of turning around.
    const lockFacing = m.inputShoot && s.ammo > 0;
    if (m.inputRight) { s.x += moveSpd * (lockFacing && s.facing < 0 ? 0.7 : 1); if (!lockFacing) s.facing = 1; if (s.state === 'idle') s.state = 'walk'; }
    else if (m.inputLeft) { s.x -= moveSpd * (lockFacing && s.facing > 0 ? 0.7 : 1); if (!lockFacing) s.facing = -1; if (s.state === 'idle') s.state = 'walk'; }
    else if (s.state === 'walk') s.state = 'idle';
  }
  s.x = Math.max(40, Math.min(MISSION_W - 40, s.x));
  // Defend objective: once the hold has started, the lead can't
  // retreat past the anchor — they planted the flag, they hold the
  // line. Prevents the "pace back and forth and let AI followers
  // tank for you" exploit. They can still push forward to meet the
  // horde, just can't run away from it.
  if (m.objective === 'defend' && m.defendStartedAt && !m.extraction) {
    const minX = m.defendAnchor - 30;
    if (s.x < minX) s.x = minX;
  }
  // ── JUMP + PLATFORM + LADDER physics ─────────────────────────
  // UP/W either climbs an adjacent ladder OR jumps if not on one.
  // While climbing, gravity is off and standingY moves toward the
  // platform top / ground. While airborne (vy !== 0) we apply
  // gravity and check for platform collisions on descent.
  const JUMP_GRAV = 0.55;
  const JUMP_VEL  = -8.6;
  const CLIMB_SPD = 2.2;
  if (s.standingY === undefined) s.standingY = 0;
  if (s.climbing === undefined) s.climbing = null;
  const onSurface = (s.jumpY || 0) === 0 && (s.vy || 0) === 0;

  // Ladder lookup: which ladder is the soldier "next to"?
  const nearLadder = (m.ladders || []).find(l => Math.abs(s.x - l.x) < 18);

  // Start a climb when pressing UP near a ladder while grounded,
  // or DOWN at the top of a ladder while on the matching platform.
  if (!s.climbing) {
    if (nearLadder && m.inputUp && onSurface && (s.standingY || 0) > nearLadder.yTop - MGY) {
      s.climbing = { ladder: nearLadder, dir: -1 };
      s.state = 'walk';
    } else if (nearLadder && m.inputDown && onSurface && (s.standingY || 0) < 0
               && Math.abs((s.standingY || 0) - (nearLadder.yTop - MGY)) < 6) {
      s.climbing = { ladder: nearLadder, dir: 1 };
      s.state = 'walk';
    }
  }

  // While climbing, ignore gravity, suppress jump, move along the
  // ladder y. UP/DOWN reverse direction or accelerate. Reaching
  // either end commits the soldier to that surface.
  if (s.climbing) {
    const l = s.climbing.ladder;
    const topRel = l.yTop - MGY;  // negative
    const botRel = 0;
    // Snap soldier x to the ladder so the climb reads cleanly
    s.x = l.x;
    // Direction follows current input (UP=up, DOWN=down)
    if (m.inputUp)   s.climbing.dir = -1;
    if (m.inputDown) s.climbing.dir = 1;
    s.standingY = (s.standingY || 0) + s.climbing.dir * CLIMB_SPD * (dt / 16);
    s.jumpY = 0; s.vy = 0;
    if (s.standingY <= topRel) {
      s.standingY = topRel;
      s.climbing = null;
    } else if (s.standingY >= botRel) {
      s.standingY = 0;
      s.climbing = null;
    }
  } else if (m.inputUp && onSurface && s.state !== 'knife' && s.state !== 'reload' && !dodging(s) && spendStam(s, JUMP_COST)) {
    // No ladder under us — UP is a jump from the current surface.
    s.vy = JUMP_VEL;
    s.state = 'walk';
  }
  // Press DOWN to drop off a platform when there's no ladder to
  // climb down (sets vy slightly positive so we fall through).
  const wasOnPlatform = (s.standingY || 0) < 0 && onSurface;
  if (!s.climbing && m.inputDown && wasOnPlatform && !nearLadder) {
    s.standingY = 0;
    s.vy = 1.2;
  }
  // Apply gravity + integrate position
  if (!onSurface || (s.vy || 0) !== 0) {
    s.vy = (s.vy || 0) + JUMP_GRAV * (dt / 16);
    s.jumpY = (s.jumpY || 0) + s.vy * (dt / 16);
    // Platform collision: only when DESCENDING (vy > 0). Check if
    // the soldier's foot is crossing a platform top this tick. We
    // ignore platforms above the current standingY (they're already
    // above us — no upward catch).
    if (s.vy > 0 && Array.isArray(m.platforms)) {
      const footYNow  = (s.standingY || 0) + (s.jumpY || 0);
      const footYPrev = footYNow - s.vy * (dt / 16);
      for (const p of m.platforms) {
        const platTopRelToGround = (p.y - MGY); // negative
        if (s.x < p.x || s.x > p.x + p.w) continue;
        // Was above the platform top last tick AND now at or below
        if (footYPrev <= platTopRelToGround && footYNow >= platTopRelToGround) {
          s.standingY = platTopRelToGround;
          s.jumpY = 0;
          s.vy = 0;
          break;
        }
      }
    }
    // Hit ground — works from BOTH a ground jump (standingY === 0)
    // AND a fall from a platform (standingY < 0, soldier walked off
    // the edge mid-jump). Previously the clamp only triggered when
    // standingY === 0, so falling off a platform horizontally let
    // jumpY grow without bound and the soldier rendered below the
    // floor (invisible bug reported by the player).
    const footY = (s.standingY || 0) + (s.jumpY || 0);
    if (s.vy >= 0 && footY >= 0) {
      s.standingY = 0; s.jumpY = 0; s.vy = 0;
    }
  }
  // Walked off a platform edge? Don't trigger while climbing — the
  // ladder is the "surface" then, not the platform.
  if (!s.climbing && (s.standingY || 0) < 0 && (s.jumpY || 0) === 0 && (s.vy || 0) === 0) {
    const on = (m.platforms || []).some(p =>
      s.x >= p.x && s.x <= p.x + p.w
      && (p.y - MGY) === s.standingY,
    );
    if (!on) {
      // No platform under us — start falling toward the ground.
      s.vy = 0.6;
    }
  }
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
        m.effects.push({ type: 'txt', x: r.x, y: MGY - 70, v: t('{name} JOINED', { name: r.name }), col: '#88ddff', at: now, dur: 1100 });
      }
    } else if (r.state === 'following') {
      // Stay ~70 px behind the lead's facing
      const desired = s.x - 70 * s.facing;
      const dx = desired - r.x;
      const followSpd = 1.8 * (dt / 16);
      if (Math.abs(dx) > 6) { r.x += Math.sign(dx) * Math.min(Math.abs(dx), followSpd); r.facing = s.facing; }
    }
  });

  tickMissionExtras(m, now, dt, aliveParty(m));
  tickCity(m, now, dt, aliveParty(m));
  tickObjectives(m, now);
  if (m.state !== 'active') return;

  // Activation now considers any party member or rescuable as the "trigger"
  const triggers = aliveTargets(m);
  m.zombies.forEach(z => {
    if (z.activated) return;
    const closest = triggers.reduce((d, p) => Math.min(d, Math.abs(z.x - p.x)), Infinity);
    if (closest < BALANCE.missionActivationRange * (m.activationMul || 1)) {
      z.activated = true; m.activatedCount++;
      m.soundQ.push({ t: z.type === 'brute' ? 'roar' : 'groan', now, zt: z.type, x: z.x });
    }
  });
  // The dead closing in growl and snarl (the audio engine throttles).
  if (Math.random() < 0.012 * (dt / 16)) {
    const near = m.zombies.filter(z => z.activated && z.state !== 'dead' && Math.abs(z.x - m.soldier.x) < 650);
    if (near.length) { const z = near[Math.floor(Math.random() * near.length)]; m.soundQ.push({ t: 'groan', now, zt: z.type, x: z.x }); }
  }

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
    const zStandingY = z.standingY || 0;
    const tStandingY = tgt.standingY || 0;

    // ── Vertical pursuit: climb ladders when the target is on a
    // different level. Tanks are too heavy to climb (they shamble
    // around on the ground); spitters keep their range game and
    // don't need to chase. Walkers and runners CAN climb.
    if (!meta.ranged && z.type !== 'tank') {
      if (z.climbing) {
        const l = z.climbing.ladder;
        const topRel = l.yTop - MGY;
        // Re-pick direction each tick so the climber tracks the
        // target if they jump back down.
        if (tStandingY < zStandingY - 2) z.climbing.dir = -1;
        else if (tStandingY > zStandingY + 2) z.climbing.dir = 1;
        z.x = l.x;
        const climbSpd = z.type === 'runner' ? 1.6 : 1.1;
        z.standingY = zStandingY + z.climbing.dir * climbSpd * (dt / 16);
        z.state = 'walk';
        if (z.standingY <= topRel) { z.standingY = topRel; z.climbing = null; }
        else if (z.standingY >= 0)  { z.standingY = 0;      z.climbing = null; }
        return;
      }
      // Target on a different surface? Seek a ladder that bridges
      // our current level to the target's level.
      const wantUp   = tStandingY < zStandingY - 5;
      const wantDown = tStandingY > zStandingY + 5;
      if (wantUp || wantDown) {
        const ladder = (m.ladders || []).reduce((best, l) => {
          // Skip ladders that don't reach the target level.
          const tops = l.yTop - MGY;
          if (wantUp   && Math.abs(tops - tStandingY) > 6) return best;
          if (wantDown && Math.abs(tops - zStandingY) > 6) return best;
          const d = Math.abs(l.x - z.x);
          if (!best || d < best.d) return { ladder: l, d };
          return best;
        }, null);
        if (ladder) {
          const ldx = ladder.ladder.x - z.x;
          z.facing = ldx > 0 ? 1 : -1;
          if (Math.abs(ldx) > 6) {
            z.x += z.spd * z.facing * (dt / 16);
            z.state = 'walk';
            return;
          }
          z.climbing = { ladder: ladder.ladder, dir: wantUp ? -1 : 1 };
          return;
        }
      }
    }

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
          m.soundQ.push({ t: 'spit', x: z.x });
        }
      }
      return;
    }

    // Vertical separation between zombie and target. If they're on
    // different levels (platform vs ground), melee can't connect —
    // the zombie has to find a ladder first (handled above).
    const dy = Math.abs(tStandingY - zStandingY);
    const sameLevel = dy < 18;

    if (z.state === 'idle' || z.state === 'walk') {
      z.facing = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 40 || !sameLevel) {
        z.x += z.spd * z.facing * (dt / 16);
        if (z.state === 'idle') z.state = 'walk';
      } else { z.state = 'attack'; }
    } else if (z.state === 'attack') {
      z.atkTimer += dt;
      z.facing = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 50 || !sameLevel) { z.state = 'walk'; z.atkTimer = 0; return; }
      if (z.atkTimer > (meta.atkRate || 1000)) {
        z.atkTimer = 0;
        // A dodge roll slips under the swing.
        if (dodging(tgt)) return;
        tgt.hp -= z.z.dmg; tgt.hurtTimer = 320;
        m.soundQ.push({ t: 'zatk', x: z.x });
        if (tgt.hp <= 0) {
          tgt.hp = 0; tgt.state = 'dead';
          // Lead death tries to promote a follower; only fails the
          // mission if no one else is alive.
          if (tgt.id === s.id) promoteLeadOnDeath(m, now);
        }
      }
    }
  });

  // ── LEAD: player-driven shoot / knife ───────────────────────────
  const w = WPN[s.weapon];
  if (m.inputShoot && s.state !== 'reload' && s.ammo > 0 && !s.knifeReady && !dodging(s)) {
    if (now - s.lastShot >= w.rate) {
      s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.ammo--;
      m.soundQ.push({ t: 'shot', w: s.weapon, x: s.x }); m.soundQ.push({ t: 'shell' });
      kick(m, s.weapon);
      const bx = s.x + s.facing * 38;
      // Bullet origin Y rides the soldier's platform — if the lead
      // is up on a ledge / second floor, their muzzle is up there
      // too. shooterY is tracked on each bullet so the collision
      // pass can match them with zombies on the same level.
      const shooterY = (s.standingY || 0);
      const bulletY  = MGY - 42 + shooterY;
      for (let p = 0; p < (w.pel || 1); p++) {
        const sp2 = (Math.random() - 0.5) * w.sp * 2;
        m.bullets.push({
          id: uid(), x: bx, y: bulletY, src: s,
          dx: s.facing * w.spd * Math.cos(sp2), dy: w.spd * Math.sin(sp2),
          dmg: (w.pel ? w.dmg / w.pel : w.dmg) * (s.dmgMul || 1),
          tankMul: s.tankMul || 1,
          life: Math.ceil(effRange(s, w) / w.spd * 1.15),
          shooterY,
        });
      }
      m.effects.push({ type: 'shell', x: s.x - s.facing * 8, y: bulletY, vx: -s.facing * (1.4 + Math.random()), at: now, dur: 780 });
      if (s.ammo === 0) {
        if ((s.magsLeft || 0) > 0) {
          s.state = 'reload'; s.reloadStart = now; s.ammo = s.maxAmmo;
          s.magsLeft -= 1;
          m.soundQ.push({ t: 'reload', w: s.weapon, dur: effRl(s, w) });
          pushRadio(m, 'reload', { speaker: s });
        } else {
          // Out of mags — holster the firearm. Knife is now the
          // permanent ready-state until end of mission (or scavenged
          // ammo from a future pickup, if we add that).
          s.knifeReady = true;
          pushRadio(m, 'lowAmmo', { line: 'Dry! Knife out!', urgent: true, speaker: s });
        }
      }
    } else if (now - s.lastShot > w.rate * 0.5) s.state = 'walk';
  }
  if (s.state === 'shoot' && now - s.shootAt > 200) s.state = m.inputLeft || m.inputRight ? 'walk' : 'idle';
  if (s.state === 'reload' && now - s.reloadStart >= effRl(s, w)) s.state = 'idle';

  // Dry, or the gun is slung (Q): the melee weapon takes over.
  if ((s.ammo <= 0 || s.knifeReady) && s.state !== 'reload' && !dodging(s)) {
    const meleeTgt = m.zombies.find(z => z.state !== 'dead' && z.activated && Math.abs(z.x - s.x) < 52
      && Math.abs((z.standingY || 0) - ((s.standingY || 0) + (s.jumpY || 0))) < 22);
    if (meleeTgt) {
      s.facing = meleeTgt.x > s.x ? 1 : -1;
      s.knifeTimer = (s.knifeTimer || 0) + dt;
      if (s.knifeTimer >= meleeStats(s).rate * 0.92 && !(s.meleeCd > 0)) {
        s.knifeTimer = 0; s.state = 'knife'; s.shootAt = now;
        s.meleeCd = meleeStats(s).rate * 0.8;
        meleeHit(m, s, meleeTgt, now);
        hitstop(m, 50); addShake(m, 1.6);
      }
    } else { s.knifeTimer = 0; if (s.state === 'knife' && now - s.shootAt > 300) s.state = 'idle'; }
  }

  // Roll, grenades, reload, swap, melee on demand.
  tickMoves(m, now, dt, { meleeHit, alertHumans, promoteLeadOnDeath });

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
      m.effects.push({ type: 'txt', x: s.x, y: MGY - 80, v: t('HOLD POSITION!'), col: '#ff8800', at: now, dur: 1800 });
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
      // Vaccine rooftop boss — once at ~32 s into the hold (40% in),
      // a brute lumbers up the stairs. Single-spawn (guarded by
      // _vaccineBruteSpawned) with a dedicated "BRUTE INBOUND" callout
      // so the player has time to focus fire before it reaches the line.
      if (m._vaccineIndex === 2 && elapsed >= 32000 && !m._vaccineBruteSpawned) {
        m._vaccineBruteSpawned = now;
        m.soundQ.push({ t: 'roar', x: m.defendAnchor + 360 });
        const bz = ZTP.brute;
        m.zombies.push({
          id: uid(), type: 'brute', z: bz,
          x: m.defendAnchor + 360,
          hp: bz.hp, maxHp: bz.hp,
          spd: bz.spd,
          state: 'walk', facing: -1,
          walkPhase: Math.random() * Math.PI * 2,
          atkTimer: 0, hurtTimer: 0, deadAt: 0, lane: 0,
          activated: true,
        });
        m.activatedCount++;
        m.effects.push({
          type: 'txt', x: m.defendAnchor, y: MGY - 120,
          v: t('⚠ BRUTE INBOUND — FOCUS FIRE'),
          col: '#ff3322', at: now, dur: 3600,
        });
        // Screen-shake feel via a follow-up callout 2.5 s later
        m.effects.push({
          type: 'txt', x: m.defendAnchor, y: MGY - 96,
          v: t('HEAVY ON THE STAIRS'), col: '#ff8844',
          at: now + 800, dur: 2400,
        });
      }
      // Hold's done — call in the armored extraction. Spawning stops
      // (no new zombies past this point), an APC drives in from the
      // Fort Omega side, soldiers board, then it drives back. m.state
      // only flips to 'won' when the convoy has cleared the screen.
      if (elapsed >= m.defendDuration && !m.extraction) {
        m.extraction = {
          startedAt: now,
          phase: 'incoming',           // incoming → boarding → leaving
          // Truck rolls in from the LEFT (= back toward Fort Omega),
          // stops a few pixels short of the defend anchor.
          x: -180,
          stopX: m.defendAnchor - 80,
          boardStart: 0,
          boardDur: 2600,
          soldierEmbarked: { [m.soldier.id]: false },
        };
        (m.followers || []).forEach(f => { m.extraction.soldierEmbarked[f.id] = false; });
        m.effects.push({ type: 'txt', x: s.x, y: MGY - 100, v: t('EXTRACTION INBOUND'), col: '#88ddff', at: now, dur: 2400 });
        pushRadio(m, 'evacIn', { line: 'Convoy rolling in!', speaker: m.soldier });
      }
    }
  }
  // Stop the defend spawn cadence once the extraction begins.
  if (m.extraction && m.objective === 'defend') {
    m.defendNextSpawn = Number.POSITIVE_INFINITY;
    const e = m.extraction;
    const APC_SPD_IN  = 1.4 * (dt / 16);    // px/frame at 60fps
    const APC_SPD_OUT = 1.9 * (dt / 16);
    if (e.phase === 'incoming') {
      e.x += APC_SPD_IN;
      if (e.x >= e.stopX) {
        e.x = e.stopX;
        e.phase = 'boarding';
        e.boardStart = now;
        m.effects.push({ type: 'txt', x: s.x, y: MGY - 90, v: t('BOARD UP!'), col: '#88ee99', at: now, dur: 1800 });
        pushRadio(m, 'evacBoard', { line: 'Mount up! Move move move!', urgent: true, speaker: m.soldier });
      }
    } else if (e.phase === 'boarding') {
      // Pull every alive party member toward the truck and flip
      // their embarked flag once they touch it. While embarked the
      // sprite is hidden by the render (handled via soldierEmbarked
      // lookup) but the soldier is otherwise alive for stats.
      const members = [m.soldier, ...(m.followers || [])].filter(p => p && p.hp > 0 && p.state !== 'dead');
      members.forEach(p => {
        if (e.soldierEmbarked[p.id]) return;
        const dx = (e.x + 30) - p.x;
        const step = 2.4 * (dt / 16) * Math.sign(dx);
        if (Math.abs(dx) <= 4) {
          e.soldierEmbarked[p.id] = true;
        } else {
          p.x += step;
          p.facing = step > 0 ? 1 : -1;
          if (p.state === 'idle') p.state = 'walk';
        }
        // Also force them down off any platform / ladder so they
        // don't ride the truck through the air.
        p.standingY = 0; p.jumpY = 0; p.vy = 0; p.climbing = null;
      });
      const allEmbarked = members.every(p => e.soldierEmbarked[p.id]);
      const timedOut = now - e.boardStart > e.boardDur + 1000;
      if (allEmbarked || timedOut) {
        e.phase = 'leaving';
        pushRadio(m, 'evacOut', { line: 'Wheels up! Going home!', speaker: m.soldier });
      }
    } else if (e.phase === 'leaving') {
      e.x -= APC_SPD_OUT;
      // Camera tracks the truck on the way out so the player sees it
      // disappear, not just their abandoned spawn point.
      m.cameraX = Math.max(0, Math.min(MISSION_W - MISSION_VIEW, e.x - MISSION_VIEW / 2));
      if (e.x < -200) {
        m.state = 'won';
        m.endedAt = now;
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
      // Under fire from beyond their reach: close the distance fast.
      const pressed = now - (h._hitAt || -1e9) < 3000;
      h.x += (pressed ? 1.5 : 0.9) * (h.compact ? 1.15 : 1) * h.facing * (dt / 16);
      h.state = 'walk';
    } else if (dist < idealRange - 60) {
      h.x -= 0.6 * h.facing * (dt / 16);
      h.state = 'walk';
    } else {
      h.state = 'idle';
      if (h.ammo <= 0) { h.state = 'reload'; h.reloadStart = now; }
      // Bandits are panicked civilians, not trained marksmen: their
      // fire rate is 1.6x slower than the gun's spec and their per-
      // shot damage is multiplied by 0.55 to keep multi-bandit
      // firefights from one-shotting the player's squad.
      // Compact soldiers are trained: faster, steadier fire.
      else if (now - h.lastShot > wMeta.rate * (h.compact ? 1.25 : 1.6)) {
        h.lastShot = now; h.state = 'shoot'; h.ammo--;
        const pellets = wMeta.pel || 1;
        const baseDmg = (wMeta.pel ? wMeta.dmg / wMeta.pel : wMeta.dmg) * (h.compact ? 0.7 : 0.55);
        for (let p = 0; p < pellets; p++) {
          // Wider aim cone — they're not pros.
          const spread = (Math.random() - 0.5) * ((wMeta.spread || 0.04) * 2.2);
          const ang = spread;
          m.bullets.push({
            id: uid(),
            x: h.x + h.facing * 10, y: MGY - 26,
            dx: h.facing * wMeta.spd * Math.cos(ang),
            dy: wMeta.spd * Math.sin(ang),
            dmg: baseDmg,
            life: Math.ceil(wMeta.range / wMeta.spd * 1.15),
            hostile: true,
          });
        }
        m.soundQ.push({ t: 'fire', w: h.weapon, x: h.x });
      }
    }
  });
  // Hostiles wake up when any of the party comes within their own
  // weapon's reach (so they can't be picked off from just outside it),
  // and when they're hit (see alertHumans in the bullet loop).
  const party = aliveParty(m);
  (m.humans || []).forEach(h => {
    if (h.activated || !h.hostile || h.state === 'dead') return;
    const reach = Math.max(360, (WPN[h.weapon] ? WPN[h.weapon].range : 220) + 80);
    if (party.some(p => Math.abs(p.x - h.x) < reach)) alertHumans(m, h);
  });

  // Friendly survivors (non-bandit encounter humans) auto-wake when
  // zombies get within sight, then fire at the nearest active zombie
  // with their scavenged pistol/shotgun. Fixes the asymmetry where
  // zombies happily chewed on a passive armed survivor and the
  // survivor just stood there — now they actually shoot back.
  (m.humans || []).forEach(h => {
    if (h.state === 'dead' || h.hostile) return;
    if (!h.activated) {
      // Wake when a zombie is within ~240 px so the survivor doesn't
      // randomly start firing across the whole map.
      const nearZ = m.zombies.find(z =>
        z.state !== 'dead' && z.activated && Math.abs(z.x - h.x) < 240,
      );
      if (nearZ) {
        h.activated = true;
        m.activatedCount++;
      } else {
        return;
      }
    }
    // Pick the closest active zombie within weapon range.
    const wMeta = WPN[h.weapon];
    const tgt = m.zombies
      .filter(z => z.state !== 'dead' && z.activated && Math.abs(z.x - h.x) <= (wMeta.range || 220))
      .sort((a, b) => Math.abs(a.x - h.x) - Math.abs(b.x - h.x))[0];
    if (!tgt) {
      // No zombie in range — drop back to idle but keep activated.
      if (h.state === 'shoot' && now - h.lastShot > 200) h.state = 'idle';
      return;
    }
    h.facing = tgt.x > h.x ? 1 : -1;
    if (h.state === 'reload') {
      if (now - h.reloadStart >= wMeta.rl) { h.state = 'idle'; h.ammo = h.maxAmmo; }
      return;
    }
    if (h.ammo <= 0) { h.state = 'reload'; h.reloadStart = now; return; }
    // Friendly fire cadence: same 1.6× slowdown as bandits (these are
    // panicked civilians too) and 0.55× per-shot damage — they're
    // supportive backup, not pro shooters. Their bullets are NOT
    // hostile (b.hostile = false) so they only damage zombies.
    if (now - h.lastShot > wMeta.rate * 1.6) {
      h.lastShot = now; h.state = 'shoot'; h.ammo--;
      const pellets = wMeta.pel || 1;
      const baseDmg = (wMeta.pel ? wMeta.dmg / wMeta.pel : wMeta.dmg) * 0.55;
      for (let p = 0; p < pellets; p++) {
        const spread = (Math.random() - 0.5) * ((wMeta.spread || 0.04) * 2.2);
        m.bullets.push({
          id: uid(),
          x: h.x + h.facing * 10, y: MGY - 26,
          dx: h.facing * wMeta.spd * Math.cos(spread),
          dy: wMeta.spd * Math.sin(spread),
          dmg: baseDmg,
          life: Math.ceil(wMeta.range / wMeta.spd * 1.15),
          // Not hostile — these bullets damage zombies via the same
          // path as party bullets, not the player.
          friendlyHuman: true,
        });
      }
      m.soundQ.push({ t: 'fire', w: h.weapon, x: h.x });
    }
  });

  // ── HAZARDS ──────────────────────────────────────────────────
  // Mine detonation helper. Used by both the proximity trigger
  // (party member walks on it) and the bullet-shot trigger
  // (player shoots the mine from a safe distance).
  const detonateMine = h => {
    if (h.triggered) return;
    h.triggered = true; h.triggeredAt = now;
    m.soundQ.push({ t: 'explosion', x: h.x });
    addShake(m, Math.max(0, 6 - Math.abs(m.soldier.x - h.x) / 120));
    const radius = h.radius || 40;
    aliveParty(m).forEach(p => {
      if (Math.abs(p.x - h.x) > radius || dodging(p)) return;
      p.hp -= h.dmg; p.hurtTimer = 320;
      m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: t('MINE -{n}', { n: h.dmg }), col: '#ff4400', at: now, dur: 1200 });
      if (p.hp <= 0) {
        p.hp = 0; p.state = 'dead';
        if (p.id === s.id) promoteLeadOnDeath(m, now);
      } else missionHurtCallout(m, p);
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
          if (Math.abs(p.x - h.x) > h.w / 2 || dodging(p)) return;
          p.hp -= h.dmg; p.hurtTimer = 200;
          m.effects.push({ type: 'txt', x: p.x, y: MGY - 60, v: `-${h.dmg}`, col: '#88cc44', at: now, dur: 600 });
          if (p.hp <= 0) {
            p.hp = 0; p.state = 'dead';
            if (p.id === s.id) promoteLeadOnDeath(m, now);
          } else missionHurtCallout(m, p);
        });
      }
    }
  });

  // Bullets step per frame; m._ts slows them with the rest of the
  // world during slow motion (update/moves.js juiceStep).
  const bts = m._ts ?? 1;
  m.bullets = m.bullets.filter(b => {
    trackShot(m, b);
    b.x += b.dx * bts; b.y += b.dy * bts; b.life -= bts;
    if (b.life <= 0 || b.x < 0 || b.x > MISSION_W) return false;
    if (barricadeStops(m, b)) {
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 160 });
      return false;
    }

    if (b.spit) {
      // Acid spit hits any living party member or rescuable in its path.
      const hit = aliveTargets(m).find(p => !dodging(p) && Math.abs(p.x - b.x) < 18 && b.y > MGY - 38);
      if (hit) {
        hit.hp -= b.dmg; hit.hurtTimer = 240;
        m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${b.dmg}`, col: '#88cc44', at: now, dur: 700 });
        m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 220 });
        if (hit.hp <= 0) {
          hit.hp = 0; hit.state = 'dead';
          if (hit.id === s.id) promoteLeadOnDeath(m, now);
        } else missionHurtCallout(m, hit);
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
      const hit = aliveTargets(m).find(p => !dodging(p) && Math.abs(p.x - b.x) < 18);
      if (hit) {
        hit.hp -= b.dmg; hit.hurtTimer = 220;
        m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: '#ff6644', at: now, dur: 700 });
        m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
        if (hit.hp <= 0) {
          hit.hp = 0; hit.state = 'dead';
          if (hit.id === s.id) promoteLeadOnDeath(m, now);
        } else missionHurtCallout(m, hit);
        return false;
      }
      return true;
    }

    // Shootable mines: any bullet whose path crosses the mine's x at
    // ground level detonates it (lets the player clear hazards from a
    // safe distance outside the 40 px blast radius).
    const mineHit = (m.hazards || []).find(h =>
      h.type === 'mine' && !h.triggered &&
      Math.abs(h.x - b.x) < 14 && b.y >= MGY - 50 && b.y <= MGY
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
      trackHit(m, b);
      alertHumans(m, humanHit);
      humanHit._hitAt = now;
      m.soundQ.push({ t: 'hit', now, x: b.x });
      m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 5 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2 - 0.5, r: 1.4 + Math.random() * 2.4 })), at: now, dur: 580 });
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      m.effects.push({ type: 'txt', x: humanHit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: C.bld, at: now, dur: 680 });
      if (humanHit.hp <= 0) {
        humanHit.hp = 0; humanHit.state = 'dead'; humanHit.deadAt = now;
        m.killedCount++;
        if (b.src) b.src._kills = (b.src._kills || 0) + 1;
        if (humanHit.colonel) {
          m.effects.push({ type: 'txt', x: humanHit.x, y: MGY - 110, v: t('★ COL. VOSS DOWN'), col: '#ffd54a', at: now, dur: 2600 });
          pushRadio(m, 'kill', { line: 'The colonel is down! Their line is breaking!', speaker: m.soldier, cooldown: 0 });
        }
        missionKillChatter(m, m.soldier);
      }
      return false;
    }

    if (bulletHitsSide(m, b, now)) { trackHit(m, b); return false; }

    // Y-level check: a bullet fired from a platform must be on the
    // same level as the zombie to hit. Otherwise a soldier shooting
    // sideways from a ledge would clip ground-level walkers
    // standing far below. Bullets without a shooterY (older entries)
    // default to ground level for back-compat.
    const hit = m.zombies.find(z => {
      if (z.state === 'dead' || Math.abs(z.x - b.x) >= 20) return false;
      const zStandingY = z.standingY || 0;
      const shooterY = b.shooterY || 0;
      return Math.abs(zStandingY - shooterY) < 22;
    });
    if (hit) {
      const dmg = b.dmg * (hit.type === 'tank' ? (b.tankMul || 1) : 1);
      // Shot from afar: it wakes up, and so do the dead around it.
      if (!hit.activated) {
        m.zombies.forEach(z => {
          if (!z.activated && z.state !== 'dead' && Math.abs(z.x - hit.x) < 260 && Math.abs((z.standingY || 0) - (hit.standingY || 0)) < 22) { z.activated = true; m.activatedCount++; }
        });
      }
      hit.hp -= dmg; hit.hurtTimer = 210; m.soundQ.push({ t: 'hit', now, x: b.x });
      trackHit(m, b);
      m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 6 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3.5, vy: -Math.random() * 2.5 - 0.5, r: 1.5 + Math.random() * 3 })), at: now, dur: 600 });
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60 + (hit.standingY || 0), v: `-${Math.round(dmg)}`, col: C.bld, at: now, dur: 680 });
      if (hit.hp <= 0) {
        hit.hp = 0; hit.state = 'dead'; hit.deadAt = now;
        if (b.src) b.src._kills = (b.src._kills || 0) + 1;
        m.soundQ.push({ t: 'zdie', zt: hit.type, x: hit.x });
        if (hit.type === 'brute') {
          m.effects.push({ type: 'txt', x: hit.x, y: MGY - 110, v: t('☠ BRUTE DOWN'), col: '#ffcc44', at: now, dur: 2400 });
          pushRadio(m, 'kill', { line: 'Big one is down!', speaker: m.soldier, cooldown: 0 });
        }
        m.killedCount++;
        missionKillChatter(m, m.soldier);
      }
      return false;
    }
    return true;
  });

  clampCity(m);

  // Pickups can be grabbed by any party member. Pickups with a fork
  // Searchable obstacles (TLS Union City style looting). When a
  // party member stays within ~30 px of an un-searched container
  // for ~700 ms, it opens and drops a small resource pickup.
  // Drives the "explore buildings, search furniture" loop without
  // needing a discrete interaction key.
  (m.obstacles || []).forEach(o => {
    if (!o.searchable || o.searched) return;
    const member = aliveParty(m).find(p =>
      Math.abs(p.x - o.x) < 30 && Math.abs((p.standingY || 0) - 0) < 18,
    );
    if (!member) {
      // Drop the search timer if the player walks away
      o._searchAt = 0;
      return;
    }
    if (!o._searchAt) o._searchAt = now;
    if (now - o._searchAt >= 700) {
      o.searched = true;
      onContainerSearched(m, o, now);
      o._searchAt = 0;
      // Drop a small loot pickup. The type pool depends on the
      // container — guns yield ammo, desks yield medicine/food,
      // workbenches yield materials, etc.
      const LOOT_TABLE = {
        'desk':           ['medicine', 'food', 'materials'],
        'filing-cabinet': ['materials', 'food'],
        'locker':         ['ammo', 'materials'],
        'evidence-box':   ['ammo', 'materials'],
        'gun-rack':       ['ammo', 'ammo', 'sniperAmmo'],
        'glass-case':     ['ammo', 'sniperAmmo'],
        'workbench':      ['materials', 'materials', 'ammo'],
        'cubicle':        ['food', 'medicine'],
        'photocopier':    ['materials'],
        'water-cooler':   ['food', 'food', 'medicine'],
        'crate':          ['materials', 'ammo', 'food'],
        'ammo-crate':     ['ammo', 'ammo', 'turretAmmo'],
        'container':      ['materials', 'ammo'],
        'trash-bin':      ['food'],
        'medkit':         ['medicine', 'medicine'],
      };
      const pool = LOOT_TABLE[o.type] || ['materials'];
      const type = pool[Math.floor(Math.random() * pool.length)];
      const value = boxValue(type, { wave: m.wave || 1, mul: (m.valueMul || 1) * (o.rich ? LOCKED_MUL : 1) });
      m.collected[type] = (m.collected[type] || 0) + value;
      m.effects.push({
        type: 'txt',
        x: o.x, y: MGY - 70,
        v: t('+{n} {res}', { n: value, res: t(type) }),
        col: type === 'ammo' || type === 'sniperAmmo' || type === 'turretAmmo' ? '#88ddff' : C.acc,
        at: now, dur: 1200,
      });
      m.soundQ.push({ t: 'pickup' });
      nadeFind(m, o, now);
    }
  });

  // lane only count if the picker is on the matching lane.
  m.pickups.forEach(p => {
    if (p.collected) return;
    const grabber = aliveParty(m).find(member => {
      if (Math.abs(p.x - member.x) >= 28) return false;
      // Fork pickups require lane match.
      const memberLane = member.forkLane || 0;
      const pLane = p.lane || 0;
      if (memberLane !== pLane) return false;
      // Upper-floor pickups (standingY < 0) require the grabber to
      // also be on that floor — you can't grab loot from the second
      // floor while standing on the ground.
      const pY = p.standingY || 0;
      const mY = member.standingY || 0;
      return Math.abs(pY - mY) < 12;
    });
    if (grabber) {
      if (p.type === 'grenade') {
        // Left on the floor when the squad can't carry more.
        if (giveNade(m, p.x, now)) p.collected = true;
        return;
      }
      p.collected = true;
      if (p.type === 'civilian') {
        m.collected.civilian = true;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: t('CIVILIAN!'), col: '#88ddff', at: now, dur: 1000 });
      } else if (p.type === 'lostSoldier') {
        m.collected.lostSoldier = true;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: t('LOST SOLDIER!'), col: '#ffd54a', at: now, dur: 1200 });
      } else if (p.type === 'quest') {
        (m.collected.quests || (m.collected.quests = [])).push(p.questId);
        m.soundQ.push({ t: 'pickup', x: p.x });
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 96 + (p.standingY || 0), v: t('📋 {item} — BRING IT HOME', { item: t(p.label).toUpperCase() }), col: '#ffd54a', at: now, dur: 2400 });
        pushRadio(m, 'kill', { line: 'Got the {item}. Back to the van!', params: { item: t(p.label).toLowerCase() }, speaker: grabber, cooldown: 0 });
      } else if (p.type === 'gear') {
        (m.collected.gear || (m.collected.gear = [])).push(p.item);
        m.soundQ.push({ t: 'pickup', x: p.x });
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 80 + (p.standingY || 0), v: `${gearIcon(p.item)} ${t(gearName(p.item)).toUpperCase()}!`, col: '#ffd54a', at: now, dur: 1800 });
      } else if (p.type === 'vaccine') {
        // Vaccine sample (hospital scenario): stamp the carrier so
        // the renderer can draw the vial above their head, and so
        // the campaign knows whether to count the run as "vaccine
        // delivered" at the end.
        m._vaccineCollected = true;
        m._vaccineCarrierId = grabber.id;
        m._vaccineDropped = false;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: t('💉 VACCINE SECURED'), col: '#88ff88', at: now, dur: 1800 });
      } else {
        m.collected[p.type] += p.value;
        m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: t('+{n} {res}', { n: p.value, res: t(p.type) }), col: C.acc, at: now, dur: 900 });
      }
    }
  });

  m.effects = m.effects.filter(e => now - e.at < e.dur);

  // Goal gate: cannot exit until you've cleared enough of the hostiles you
  // woke up. Prevents "sprint past everything for free".
  // Goal-gate only applies to "reach the goal" missions. Defend missions
  // win when the survive timer expires (handled above).
  if (m.objective === 'reach' && s.x >= MISSION_W - 50) {
    const need = Math.ceil(m.activatedCount * BALANCE.missionGoalKillRatio);
    // The HIGH-risk Brute guards the exit: it has to go down before
    // the party can extract (it used to be skippable by walking past).
    const bossAlive = m.zombies.some(z => z.type === 'brute' && z.state !== 'dead');
    if (m.killedCount >= need && !bossAlive) {
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
          v: left > 0 ? (left === 1 ? t('{n} HOSTILE LEFT', { n: left }) : t('{n} HOSTILES LEFT', { n: left })) : t('BRUTE BLOCKS THE EXIT'),
          col: '#cc3333', at: now, dur: 1400,
        });
      }
    }
  }
}

// ── Hazards (mines + acid pools) ─────────────────────────────────
// Small floating vial drawn above the vaccine carrier's head so the
// player can tell at a glance who's currently holding the sample
// (matters when followers swap leads after a death). The glow pulses
// to draw the eye.
function dVaccineVial(ctx, x, now) {
  const bob = Math.sin(now / 220) * 1.6;
  const pulse = 0.55 + 0.45 * (Math.sin(now / 180) * 0.5 + 0.5);
  const y = MGY - 76 + bob;
  ctx.save();
  ctx.fillStyle = `rgba(120,255,140,${0.30 * pulse})`;
  ctx.beginPath(); ctx.arc(x, y + 4, 10 + pulse * 2, 0, Math.PI * 2); ctx.fill();
  // Vial body (small cylinder with a darker cap)
  ctx.fillStyle = '#88ff88';
  ctx.fillRect(x - 3, y - 2, 6, 9);
  ctx.fillStyle = '#226622';
  ctx.fillRect(x - 4, y - 5, 8, 3);
  // Liquid highlight
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(x - 2, y, 1, 5);
  ctx.restore();
}

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
// Indoor backdrop: dark ceiling band, panelled back wall, optional
// window cutouts and ceiling light fixtures, then a tiled floor with
// a baseboard. Each indoor biome picks its palette + fixture style.
function dIndoorBackdrop(ctx, m, biome) {
  const wallTop = 32;
  const wallBot = MGY - 80;

  // Ceiling band (dark)
  const cg = ctx.createLinearGradient(0, 0, 0, wallTop);
  cg.addColorStop(0, biome.ceiling[0]); cg.addColorStop(1, biome.ceiling[1]);
  ctx.fillStyle = cg; ctx.fillRect(0, 0, MISSION_W, wallTop);
  ctx.fillStyle = biome.ceilingTrim; ctx.fillRect(0, wallTop - 2, MISSION_W, 2);

  // Back wall
  ctx.fillStyle = biome.wallFill;
  ctx.fillRect(0, wallTop, MISSION_W, wallBot - wallTop);
  // Vertical panel seams
  ctx.strokeStyle = biome.wallDark; ctx.lineWidth = 1;
  for (let px = 0; px < MISSION_W; px += 100) {
    ctx.beginPath(); ctx.moveTo(px, wallTop); ctx.lineTo(px, wallBot); ctx.stroke();
  }
  // Horizontal trim rail (chair-rail height)
  const trimY = wallTop + (wallBot - wallTop) * 0.65;
  ctx.fillStyle = biome.wallTrim; ctx.fillRect(0, trimY - 2, MISSION_W, 4);

  // Window cutouts (city outside)
  if (biome.windowCount && biome.windowFill) {
    const winW = 90, winH = 70;
    const winSpacing = Math.max(260, MISSION_W / (biome.windowCount * 3));
    for (let wx = 120; wx < MISSION_W; wx += winSpacing) {
      const wy = wallTop + 24;
      ctx.fillStyle = biome.windowFill; ctx.fillRect(wx, wy, winW, winH);
      // Flickering distant fire / muzzle flashes inside the windows
      ctx.fillStyle = 'rgba(255,140,60,0.18)';
      ctx.fillRect(wx, wy + winH * 0.6, winW, winH * 0.4);
      // Cross frame
      ctx.fillStyle = biome.wallDark;
      ctx.fillRect(wx + winW / 2 - 1, wy, 2, winH);
      ctx.fillRect(wx, wy + winH / 2 - 1, winW, 2);
      ctx.strokeStyle = biome.wallTrim; ctx.lineWidth = 2;
      ctx.strokeRect(wx, wy, winW, winH);
    }
  }

  // Baseboard between wall and floor
  ctx.fillStyle = biome.wallDark; ctx.fillRect(0, MGY - 88, MISSION_W, 8);

  // Floor (gradient + tile seams)
  const fg = ctx.createLinearGradient(0, MGY, 0, CH);
  fg.addColorStop(0, biome.ground[0]); fg.addColorStop(1, biome.ground[1]);
  ctx.fillStyle = fg; ctx.fillRect(0, MGY, MISSION_W, CH - MGY);
  ctx.strokeStyle = biome.groundLine; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, MGY); ctx.lineTo(MISSION_W, MGY); ctx.stroke();
  ctx.strokeStyle = biome.groundLine; ctx.lineWidth = 0.5;
  for (let tx = 0; tx < MISSION_W; tx += 60) {
    ctx.beginPath(); ctx.moveTo(tx, MGY + 8); ctx.lineTo(tx, CH); ctx.stroke();
  }

  // Ceiling light fixtures
  const ls = biome.lightSpacing || 220;
  for (let lx = ls / 2; lx < MISSION_W; lx += ls) {
    if (biome.lightFixture === 'panel') {
      ctx.fillStyle = biome.ceilingTrim; ctx.fillRect(lx - 22, 4, 44, 7);
      ctx.fillStyle = biome.lightColor; ctx.fillRect(lx - 20, 5, 40, 4);
    } else if (biome.lightFixture === 'bulb') {
      ctx.strokeStyle = biome.ceilingTrim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx, wallTop); ctx.lineTo(lx, wallTop + 18); ctx.stroke();
      ctx.fillStyle = biome.lightColor;
      ctx.beginPath(); ctx.arc(lx, wallTop + 22, 4, 0, Math.PI * 2); ctx.fill();
    } else if (biome.lightFixture === 'tile') {
      ctx.fillStyle = biome.lightColor; ctx.fillRect(lx - 30, 2, 60, 8);
      ctx.fillStyle = biome.ceilingTrim; ctx.fillRect(lx - 32, 8, 64, 2);
    }
    // Soft downward halo
    const grad = ctx.createRadialGradient(lx, 14, 0, lx, 14, 140);
    grad.addColorStop(0, biome.lightColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(lx - 140, 0, 280, 200);
    // Volumetric cone: a trapezoid of soft light from the fixture
    // down to roughly floor level. Sells the "dust motes in the
    // beam" feel without needing actual particles.
    const cone = ctx.createLinearGradient(lx, 12, lx, MGY - 20);
    cone.addColorStop(0, biome.lightColor);
    cone.addColorStop(0.6, 'rgba(0,0,0,0)');
    cone.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cone;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(lx - 14, 12);
    ctx.lineTo(lx + 14, 12);
    ctx.lineTo(lx + 60, MGY - 6);
    ctx.lineTo(lx - 60, MGY - 6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Small pool of light on the floor directly below
    ctx.fillStyle = biome.lightColor;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.ellipse(lx, MGY - 1, 36, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// Armored personnel carrier that arrives at the end of a DEFEND
// objective to extract the squad. Drawn at ground level facing the
// direction it's moving (right while incoming, left while leaving).
function dExtractionAPC(ctx, e, now) {
  const x = e.x;
  const y = MGY;
  // Wheel bobs for that "diesel idling" feel while boarding
  const bob = e.phase === 'boarding' ? Math.sin(now / 110) * 0.5 : 0;
  // Hull main body
  ctx.fillStyle = '#2a3424';
  ctx.fillRect(x - 36, y - 32 + bob, 92, 30);
  // Sloped front armour
  ctx.fillStyle = '#1f281a';
  ctx.beginPath();
  ctx.moveTo(x + 56, y - 32 + bob);
  ctx.lineTo(x + 72, y - 24 + bob);
  ctx.lineTo(x + 72, y - 2 + bob);
  ctx.lineTo(x + 56, y - 2 + bob);
  ctx.closePath(); ctx.fill();
  // Cab / windshield
  ctx.fillStyle = '#5a6044';
  ctx.fillRect(x - 30, y - 44 + bob, 50, 14);
  ctx.fillStyle = '#1a2a30';
  ctx.fillRect(x - 26, y - 41 + bob, 42, 8);
  // Roof turret mount (decorative)
  ctx.fillStyle = '#1a2014';
  ctx.fillRect(x + 6, y - 50 + bob, 16, 8);
  ctx.fillStyle = '#2a3424';
  ctx.fillRect(x + 14, y - 54 + bob, 22, 4);  // barrel
  // Door — open during boarding so soldiers can climb in
  ctx.fillStyle = '#0a0e08';
  if (e.phase === 'boarding') {
    // Door swung outward
    ctx.fillRect(x - 36, y - 30 + bob, 4, 28);
    ctx.fillStyle = '#1a2014';
    ctx.fillRect(x - 56, y - 30 + bob, 20, 28);
    // Interior darkness
    ctx.fillStyle = '#0a0e08';
    ctx.fillRect(x - 32, y - 28 + bob, 26, 24);
  } else {
    ctx.fillRect(x - 30, y - 28 + bob, 22, 24);
  }
  // Star / unit marking
  ctx.fillStyle = '#c4a838';
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  ctx.fillText('★', x + 30, y - 14 + bob);
  ctx.textAlign = 'left';
  // Rivets along the hull
  ctx.fillStyle = '#1a2014';
  for (let rx = x - 32; rx < x + 50; rx += 12) {
    ctx.fillRect(rx, y - 18 + bob, 2, 2);
  }
  // Tires (3 axles)
  ctx.fillStyle = '#080a06';
  ctx.beginPath(); ctx.arc(x - 22, y - 1, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 14, y - 1, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 46, y - 1, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3a3a';
  ctx.beginPath(); ctx.arc(x - 22, y - 1, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 14, y - 1, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 46, y - 1, 3, 0, Math.PI * 2); ctx.fill();
  // Headlight beams reach forward while moving
  if (e.phase === 'incoming' || e.phase === 'leaving') {
    const dir = e.phase === 'incoming' ? 1 : -1;
    const lx = dir > 0 ? x + 70 : x - 32;
    ctx.fillStyle = 'rgba(255,240,200,0.18)';
    ctx.beginPath();
    ctx.moveTo(lx, y - 16);
    ctx.lineTo(lx + dir * 90, y - 26);
    ctx.lineTo(lx + dir * 90, y - 2);
    ctx.closePath(); ctx.fill();
    // Filament dots
    ctx.fillStyle = '#fff5cc';
    ctx.fillRect(lx - (dir > 0 ? 0 : 2), y - 18, 3, 2);
    ctx.fillRect(lx - (dir > 0 ? 0 : 2), y - 12, 3, 2);
  }
  // Boarding-phase prompt above the truck
  if (e.phase === 'boarding') {
    ctx.fillStyle = '#88ee99'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('◀ BOARD UP'), x + 10, y - 64 + bob);
    ctx.textAlign = 'left';
  }
}

// Building structural render — drawn BEFORE platforms so the upper
// floor slab covers the building's interior cleanly. Adds the
// architectural cues that make the indoor section read as a real
// building instead of "random ledges in space":
//   - Back wall + corner trim along the floor seam
//   - Vertical support columns at regular intervals
//   - Inter-floor ceiling stripe + ducting hint
//   - Far wall on the right of the building (the goal side)
function dBuilding(ctx, b) {
  const indoor = BIOMES[b.biomeKey] || {};
  const floorY = b.floorY;
  const bx = b.x, bw = b.w;
  const ceilTrim = indoor.ceilingTrim || '#1a1814';
  const wallDark = indoor.wallDark || '#1a1410';
  const wallFill = indoor.wallFill || '#3a2a18';
  // Inter-floor slab seam: a darker band running just under the
  // upper floor so the slab reads as resting on the ground-floor
  // walls.
  ctx.fillStyle = ceilTrim;
  ctx.fillRect(bx, floorY + 8, bw, 4);
  // Vertical support columns inside the building (every ~220 px).
  // Behind the action — drawn before obstacles, so they read as
  // structure not collision.
  for (let cx = bx + 80; cx < bx + bw - 60; cx += 220) {
    ctx.fillStyle = wallDark;
    ctx.fillRect(cx - 4, floorY + 6, 8, MGY - floorY - 6);
    // Column highlight strip
    ctx.fillStyle = wallFill;
    ctx.fillRect(cx - 3, floorY + 8, 2, MGY - floorY - 10);
    // Base plate
    ctx.fillStyle = ceilTrim;
    ctx.fillRect(cx - 7, MGY - 6, 14, 6);
  }
  // Back wall behind the upper-floor playing strip. Drawn very
  // faintly so it doesn't fight the sprites — just enough to say
  // "you are inside a room with walls".
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(bx, floorY - 50, bw, 50);
  // Far wall + door on the right edge (= the goal). A door frame
  // hints that the mission extracts THROUGH the building.
  const farX = bx + bw - 6;
  ctx.fillStyle = wallDark;
  ctx.fillRect(farX, floorY + 8, 6, MGY - floorY - 6);
  // A small entrance/exit door on the ground floor at the far end
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(farX - 24, MGY - 50, 22, 50);
  ctx.fillStyle = indoor.ceiling ? indoor.ceiling[1] : '#1a1814';
  ctx.fillRect(farX - 22, MGY - 46, 18, 44);
  // Door handle
  ctx.fillStyle = '#bbb';
  ctx.fillRect(farX - 8, MGY - 24, 2, 4);
  // Soft warm spill from the far door
  ctx.fillStyle = 'rgba(220,200,140,0.10)';
  ctx.beginPath();
  ctx.moveTo(farX - 24, MGY);
  ctx.lineTo(farX, MGY);
  ctx.lineTo(farX, MGY + 14);
  ctx.lineTo(farX - 40, MGY + 14);
  ctx.closePath(); ctx.fill();
}

// Ladders / stairs. Vertical traversal between ground and a
// platform. 'ladder' = vertical metal rungs (outdoor fire-escape
// style). 'stairs' = diagonal indoor staircase with a railing.
function dLadder(ctx, l) {
  const x = l.x, yTop = l.yTop, yBot = l.yBot;
  if (l.type === 'stairs') {
    // Indoor staircase — slope from ground (bottom of platform side)
    // up to the platform top. Built from a series of stepped rectangles.
    const dir = l.slopeDir; // +1 = up-and-to-the-right, -1 = up-left
    const stepCount = 6;
    const totalH = yBot - yTop;
    const stepH = totalH / stepCount;
    const stepW = 12;
    for (let i = 0; i < stepCount; i++) {
      const sx = x + dir * (i * stepW);
      const sy = yBot - (i + 1) * stepH;
      // Each step face
      ctx.fillStyle = '#3a3530';
      ctx.fillRect(Math.min(sx, sx + dir * stepW), sy, Math.abs(stepW) + 1, stepH + 1);
      // Top tread highlight
      ctx.fillStyle = '#5a554a';
      ctx.fillRect(Math.min(sx, sx + dir * stepW), sy, Math.abs(stepW) + 1, 2);
      // Riser shadow
      ctx.fillStyle = '#1a1814';
      ctx.fillRect(Math.min(sx, sx + dir * stepW), sy + stepH - 1, Math.abs(stepW) + 1, 1);
    }
    // Banister rail
    ctx.strokeStyle = '#5a4030'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, yBot - 4);
    ctx.lineTo(x + dir * stepCount * stepW, yTop - 4);
    ctx.stroke();
    // A few posts along the rail
    ctx.strokeStyle = '#3a281c'; ctx.lineWidth = 1;
    for (let i = 0; i < stepCount; i += 2) {
      const sx = x + dir * (i * stepW + stepW / 2);
      const sy = yBot - (i + 0.5) * stepH;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - 14); ctx.stroke();
    }
  } else {
    // Outdoor vertical ladder — two side rails + horizontal rungs.
    ctx.strokeStyle = '#3a3530'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 5, yTop); ctx.lineTo(x - 5, yBot); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 5, yTop); ctx.lineTo(x + 5, yBot); ctx.stroke();
    ctx.fillStyle = '#5a554a';
    const rungCount = Math.max(3, Math.floor((yBot - yTop) / 8));
    for (let i = 0; i <= rungCount; i++) {
      const ry = yTop + (i / rungCount) * (yBot - yTop);
      ctx.fillRect(x - 6, ry, 12, 1.5);
    }
    // Rust streaks
    ctx.fillStyle = 'rgba(140,60,20,0.4)';
    ctx.fillRect(x - 6, yBot - 14, 1, 12);
    ctx.fillRect(x + 5, yBot - 18, 1, 16);
  }
}

// Platforms / ledges. Two visual styles depending on biome:
//   'floor'  — indoor wooden/concrete second-storey floor with a
//              steel-beam edge and a couple of support struts.
//   'ledge'  — outdoor metal fire-escape with a railing.
function dPlatform(ctx, p) {
  const x = p.x, y = p.y, w = p.w;
  if (p.type === 'floor') {
    // Concrete slab top
    ctx.fillStyle = '#3a3a36'; ctx.fillRect(x, y - 2, w, 6);
    ctx.fillStyle = '#5a5a52'; ctx.fillRect(x, y - 2, w, 2);
    // Underside dark band
    ctx.fillStyle = '#1a1a16'; ctx.fillRect(x, y + 4, w, 4);
    // Two support struts hanging from the underside down to ground
    ctx.fillStyle = '#2a2a26';
    const strut1X = x + 14, strut2X = x + w - 22;
    ctx.fillRect(strut1X, y + 4, 8, MGY - y - 4);
    ctx.fillRect(strut2X, y + 4, 8, MGY - y - 4);
    // Strut top brackets
    ctx.fillStyle = '#1a1a18';
    ctx.fillRect(strut1X - 3, y + 4, 14, 3);
    ctx.fillRect(strut2X - 3, y + 4, 14, 3);
    // Subtle shadow on the ground under the floor
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, MGY - 1, w, 2);
  } else {
    // Metal fire-escape ledge
    ctx.fillStyle = '#3a3530'; ctx.fillRect(x, y - 2, w, 5);
    // Top grating pattern
    ctx.fillStyle = '#5a554a';
    for (let gx = x + 3; gx < x + w - 3; gx += 6) ctx.fillRect(gx, y - 1, 3, 1);
    // Vertical railing posts + horizontal bar
    ctx.fillStyle = '#2a2520';
    ctx.fillRect(x + 4, y - 22, 2, 22);
    ctx.fillRect(x + w - 6, y - 22, 2, 22);
    ctx.fillRect(x + 4, y - 22, w - 8, 2);
    // Rust streaks running down the front
    ctx.fillStyle = 'rgba(140,60,20,0.4)';
    ctx.fillRect(x + 14, y + 3, 2, 12);
    ctx.fillRect(x + w - 24, y + 3, 2, 16);
    // Two diagonal support brackets to ground
    ctx.strokeStyle = '#2a2520'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 6,     y + 3); ctx.lineTo(x + 30,    MGY);
    ctx.moveTo(x + w - 6, y + 3); ctx.lineTo(x + w - 30, MGY);
    ctx.stroke();
    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x + 10, MGY - 1, w - 20, 2);
  }
}

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
  } else if (p.type === 'wall-poster') {
    // Bulletin board / wanted poster pinned to the back wall, well
    // above the floor so it never overlaps obstacles.
    const py = MGY - 160;
    ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 18, py, 36, 28);
    ctx.fillStyle = '#9a8868'; ctx.fillRect(x - 16, py + 2, 32, 24);
    ctx.fillStyle = '#1a1410'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('WANTED'), x, py + 11);
    ctx.fillStyle = '#3a2818'; ctx.fillRect(x - 10, py + 14, 20, 8);
    ctx.textAlign = 'left';
  } else if (p.type === 'wall-flag') {
    // Hung flag on a horizontal pole
    const py = MGY - 175;
    ctx.fillStyle = '#3a2818'; ctx.fillRect(x - 22, py, 44, 2);
    ctx.fillStyle = '#502a18'; ctx.fillRect(x - 20, py + 2, 40, 30);
    ctx.fillStyle = '#cca838'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('★', x, py + 20);
    ctx.textAlign = 'left';
  } else if (p.type === 'exit-sign') {
    // Glowing EXIT panel high on the wall
    const py = MGY - 180;
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(x - 18, py, 36, 14);
    ctx.fillStyle = '#dd3322'; ctx.fillRect(x - 16, py + 2, 32, 10);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('EXIT'), x, py + 10);
    ctx.fillStyle = 'rgba(220,50,30,0.20)';
    ctx.beginPath(); ctx.arc(x, py + 7, 22, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left';
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
      ctx.fillText(t('AMMO'), x, MGY - 8); ctx.textAlign = 'left';
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
    // ── Indoor: Police Station ──────────────────────────────
    case 'desk': {
      // Office desk with monitor + paperwork
      ctx.fillStyle = '#3a2a18'; ctx.fillRect(x - 22, MGY - 20, 44, 20);
      ctx.fillStyle = '#2a1c10'; ctx.fillRect(x - 22, MGY - 20, 44, 3);
      ctx.fillStyle = '#1a1612'; ctx.fillRect(x - 20, MGY - 6, 4, 6); ctx.fillRect(x + 16, MGY - 6, 4, 6);
      ctx.fillStyle = '#181818'; ctx.fillRect(x - 8, MGY - 36, 16, 14);
      ctx.fillStyle = '#2a4a5a'; ctx.fillRect(x - 7, MGY - 35, 14, 12);
      ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 3, MGY - 22, 6, 4);
      ctx.fillStyle = '#dcd8c8'; ctx.fillRect(x + 10, MGY - 22, 8, 3);
      break;
    }
    case 'locker': {
      // Tall PD locker, vertical seam + handle
      ctx.fillStyle = '#3a4a55'; ctx.fillRect(x - 13, MGY - 44, 26, 44);
      ctx.fillStyle = '#2a3640'; ctx.fillRect(x - 13, MGY - 44, 26, 3);
      ctx.fillStyle = '#1a2228'; ctx.fillRect(x - 1, MGY - 42, 2, 40);
      ctx.fillStyle = '#cccccc'; ctx.fillRect(x - 9, MGY - 24, 3, 3); ctx.fillRect(x + 6, MGY - 24, 3, 3);
      ctx.fillStyle = '#1a2228'; ctx.fillRect(x - 10, MGY - 40, 8, 4); ctx.fillRect(x + 2, MGY - 40, 8, 4);
      break;
    }
    case 'filing-cabinet': {
      ctx.fillStyle = '#48402a'; ctx.fillRect(x - 12, MGY - 28, 24, 28);
      ctx.fillStyle = '#2a2418'; ctx.fillRect(x - 12, MGY - 28, 24, 2);
      // Three drawers
      for (let dy = 0; dy < 3; dy++) {
        const y = MGY - 25 + dy * 8;
        ctx.fillStyle = '#2a2418'; ctx.fillRect(x - 12, y, 24, 1);
        ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 3, y + 3, 6, 1.5);
      }
      break;
    }
    case 'evidence-box': {
      ctx.fillStyle = '#7a6a48'; ctx.fillRect(x - 14, MGY - 16, 28, 16);
      ctx.fillStyle = '#5a4a30'; ctx.fillRect(x - 14, MGY - 16, 28, 3);
      ctx.fillStyle = '#cc8800'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('EVIDENCE'), x, MGY - 6); ctx.textAlign = 'left';
      break;
    }
    // ── Indoor: Gun Shop ────────────────────────────────────
    case 'gun-rack': {
      // Wooden vertical rack with rifle silhouettes
      ctx.fillStyle = '#3a2818'; ctx.fillRect(x - 16, MGY - 42, 32, 42);
      ctx.fillStyle = '#2a1c10'; ctx.fillRect(x - 16, MGY - 42, 32, 2);
      ctx.fillStyle = '#1a1410';
      for (let dy = 0; dy < 3; dy++) {
        const y = MGY - 36 + dy * 12;
        ctx.fillRect(x - 14, y, 28, 1.5);
        // Rifle silhouette resting on the peg
        ctx.fillStyle = '#0a0a08';
        ctx.fillRect(x - 12, y - 3, 22, 2);
        ctx.fillRect(x + 8, y - 6, 4, 4);
        ctx.fillStyle = '#1a1410';
      }
      break;
    }
    case 'glass-case': {
      // Glass display case with handgun outline
      ctx.fillStyle = '#2a2620'; ctx.fillRect(x - 18, MGY - 14, 36, 14);
      ctx.fillStyle = 'rgba(180,200,220,0.20)'; ctx.fillRect(x - 17, MGY - 26, 34, 14);
      ctx.strokeStyle = '#9a9088'; ctx.lineWidth = 1; ctx.strokeRect(x - 17, MGY - 26, 34, 14);
      // Pistol silhouette
      ctx.fillStyle = '#1a1410';
      ctx.fillRect(x - 8, MGY - 19, 12, 3);
      ctx.fillRect(x - 4, MGY - 16, 4, 4);
      // Reflection shimmer
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x - 15, MGY - 25, 6, 12);
      break;
    }
    case 'workbench': {
      ctx.fillStyle = '#4a3220'; ctx.fillRect(x - 24, MGY - 18, 48, 18);
      ctx.fillStyle = '#2a1c10'; ctx.fillRect(x - 24, MGY - 18, 48, 3);
      ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 22, MGY - 6, 3, 6); ctx.fillRect(x + 19, MGY - 6, 3, 6);
      // Bench vise
      ctx.fillStyle = '#5a5048'; ctx.fillRect(x + 4, MGY - 24, 10, 8);
      ctx.fillStyle = '#1a1410'; ctx.fillRect(x + 7, MGY - 28, 4, 4);
      // Tools
      ctx.fillStyle = '#8a8480'; ctx.fillRect(x - 18, MGY - 22, 12, 2);
      ctx.fillStyle = '#3a2818'; ctx.fillRect(x - 14, MGY - 26, 3, 6);
      break;
    }
    // ── Indoor: Office Tower ────────────────────────────────
    case 'cubicle': {
      // Partition panel with desk inside
      ctx.fillStyle = '#5a6878'; ctx.fillRect(x - 24, MGY - 40, 48, 40);
      ctx.fillStyle = '#3a4858'; ctx.fillRect(x - 24, MGY - 40, 48, 3);
      ctx.fillStyle = '#2a3848'; ctx.fillRect(x - 24, MGY - 18, 48, 2);
      // Desk peeking over the front edge
      ctx.fillStyle = '#3a2a18'; ctx.fillRect(x - 18, MGY - 16, 36, 8);
      ctx.fillStyle = '#181818'; ctx.fillRect(x - 6, MGY - 28, 12, 12);
      ctx.fillStyle = '#1a3a4a'; ctx.fillRect(x - 5, MGY - 27, 10, 10);
      break;
    }
    case 'photocopier': {
      ctx.fillStyle = '#bcbcbc'; ctx.fillRect(x - 16, MGY - 30, 32, 30);
      ctx.fillStyle = '#888888'; ctx.fillRect(x - 16, MGY - 30, 32, 4);
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x - 14, MGY - 24, 28, 6);
      // Output tray
      ctx.fillStyle = '#888888'; ctx.fillRect(x - 18, MGY - 14, 4, 6);
      ctx.fillStyle = '#f8f4e8'; ctx.fillRect(x - 19, MGY - 12, 6, 3);
      // Status light
      ctx.fillStyle = '#22cc44'; ctx.fillRect(x + 8, MGY - 28, 4, 2);
      break;
    }
    case 'water-cooler': {
      ctx.fillStyle = '#cfd6dc'; ctx.fillRect(x - 8, MGY - 22, 16, 22);
      ctx.fillStyle = '#3a4858'; ctx.fillRect(x - 9, MGY - 24, 18, 4);
      // Big bottle on top
      ctx.fillStyle = 'rgba(120,180,220,0.55)';
      ctx.beginPath(); ctx.ellipse(x, MGY - 36, 9, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a2228'; ctx.fillRect(x - 4, MGY - 50, 8, 4);
      // Spigot
      ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 1, MGY - 14, 2, 4);
      break;
    }
    case 'office-chair': {
      ctx.fillStyle = '#1a1812'; ctx.fillRect(x - 8, MGY - 30, 16, 14);
      ctx.fillStyle = '#1a1812'; ctx.fillRect(x - 8, MGY - 14, 16, 4);
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(x - 1, MGY - 10, 2, 6);
      // Star base wheels
      ctx.fillStyle = '#1a1410';
      for (let dx = -10; dx <= 10; dx += 5) {
        ctx.beginPath(); ctx.arc(x + dx, MGY - 2, 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    default: {
      ctx.fillStyle = '#5a3e18'; ctx.fillRect(x - 12, MGY - 18, 24, 18);
    }
  }
}

// Outdoor backdrop helper — extracted from dMissionWorld so the
// multi-segment branch can clip and reuse it.
function dOutdoorBackdrop(ctx, m, biome) {
  // Sky (biome-tinted gradient)
  const sg = ctx.createLinearGradient(0, 0, 0, MGY - 80);
  sg.addColorStop(0, biome.sky[0]); sg.addColorStop(1, biome.sky[1]);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, MISSION_W, MGY - 80);
  // Stars / specks
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 173 + m.cameraX * 0.2) % MISSION_W);
    const sy = (i * 97 + 17) % (MGY - 100);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 4) * 0.18})`;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  ctx.fillStyle = biome.accentLight;
  ctx.beginPath(); ctx.arc(MISSION_W * 0.4, MGY - 120, 200, 0, Math.PI * 2); ctx.fill();
  // Background buildings
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
}

// Doorway prop drawn at the outdoor→indoor seam of multi-segment
// missions. Sells the transition: a dark archway in a brick frame
// with a hanging "ENTER" / hazard sign above it.
function dDoorway(ctx, x, indoor) {
  // Brick frame around a tall doorway
  const doorW = 60, doorH = 110;
  const fx = x - doorW / 2;
  const fy = MGY - doorH;
  // Outer frame
  ctx.fillStyle = '#2a201a';
  ctx.fillRect(fx - 14, fy - 18, doorW + 28, doorH + 18);
  // Brick texture on the frame
  ctx.fillStyle = '#3a2a1c';
  for (let by = fy - 14; by < fy + doorH; by += 6) {
    for (let bx = fx - 12; bx < fx + doorW + 12; bx += 14) {
      const off = (Math.floor((by - (fy - 14)) / 6) % 2) * 7;
      ctx.fillRect(bx + off, by, 12, 4);
    }
  }
  // Door opening (dark interior visible through)
  const innerColour = indoor && indoor.ceiling ? indoor.ceiling[1] : '#0a0a0a';
  ctx.fillStyle = innerColour;
  ctx.fillRect(fx, fy, doorW, doorH);
  // Indoor light spilling INTO the doorway (top-down gradient)
  const spill = ctx.createLinearGradient(fx, fy, fx, fy + doorH);
  spill.addColorStop(0, 'rgba(220,200,140,0.18)');
  spill.addColorStop(1, 'rgba(220,200,140,0)');
  ctx.fillStyle = spill; ctx.fillRect(fx, fy, doorW, doorH);
  // Warm pool of light on the threshold + a fan reaching out onto
  // the outdoor sidewalk so the entrance reads as a clear "go in
  // here" marker from a distance.
  ctx.fillStyle = 'rgba(255,210,130,0.30)';
  ctx.beginPath();
  ctx.moveTo(fx - 4, MGY);
  ctx.lineTo(fx + doorW + 4, MGY);
  ctx.lineTo(fx + doorW + 28, MGY + 16);
  ctx.lineTo(fx - 28, MGY + 16);
  ctx.closePath(); ctx.fill();
  // Threshold step
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(fx - 4, MGY - 3, doorW + 8, 6);
  // Hanging sign above the doorway
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(fx + 6, fy - 26, doorW - 12, 14);
  ctx.fillStyle = '#cc8800'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
  ctx.fillText(t('ENTER'), x, fy - 16);
  ctx.textAlign = 'left';
  // Hinge bolts on the sign
  ctx.fillStyle = '#2a2018'; ctx.fillRect(fx + 8, fy - 24, 2, 2); ctx.fillRect(fx + doorW - 10, fy - 24, 2, 2);
}

export function dMissionWorld(ctx, m, now) {
  setMissionWidth(m.W);
  ctx.save();
  ctx.translate(-m.cameraX, 0);

  const biome = BIOMES[m.biomeKey] || BIOMES[DEFAULT_BIOME];

  if (m.segs) {
    // City explore mission: open street with several enterable
    // buildings, each clipped to its own interior backdrop.
    dOutdoorBackdrop(ctx, m, biome);
    m.segs.forEach(sg => {
      const ib = BIOMES[sg.biomeKey] || BIOMES[DEFAULT_BIOME];
      // Draw the interior in building-local space with the world width
      // narrowed to the building, so its loops only cover the building.
      ctx.save();
      ctx.beginPath(); ctx.rect(sg.x0, 0, sg.x1 - sg.x0, CH); ctx.clip();
      ctx.translate(sg.x0, 0);
      setMissionWidth(sg.x1 - sg.x0);
      dIndoorBackdrop(ctx, m, ib, now);
      setMissionWidth(m.W);
      ctx.restore();
      dDoorway(ctx, sg.x0, ib);
      dDoorway(ctx, sg.x1, ib);
    });
  } else if (biome.indoor) {
    // Single-biome indoor destination (police_interior, etc.)
    dIndoorBackdrop(ctx, m, biome, now);
  } else if (m.indoorBiomeKey && m.entranceX > 0) {
    // Multi-segment mission: outdoor approach → enter the building →
    // indoor section. Clip the two backdrops to their respective
    // halves of the world, then draw a doorway prop at the seam so
    // the transition reads visually.
    const indoor = BIOMES[m.indoorBiomeKey] || BIOMES[DEFAULT_BIOME];
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, m.entranceX, CH); ctx.clip();
    dOutdoorBackdrop(ctx, m, biome);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(m.entranceX, 0, MISSION_W - m.entranceX, CH); ctx.clip();
    dIndoorBackdrop(ctx, m, indoor, now);
    ctx.restore();
    dDoorway(ctx, m.entranceX, indoor);
  } else {
    dOutdoorBackdrop(ctx, m, biome);
  }
  dRoomDecor(ctx, m, now);

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
    ctx.fillText(t('FORK'), f.startX, MGY - 78);
    ctx.fillText('↑W ↓S', f.startX, MGY - 71);
    ctx.textAlign = 'left';
  }

  // Decorative props (lampposts, fences, neon poles)
  (m.props || []).forEach(p => dProp(ctx, p));

  // Building architecture first (columns, back wall, far door) so
  // ladders and the upper-floor slab render in front of it.
  (m.buildings || []).forEach(b => dBuilding(ctx, b));
  dRoomDoors(ctx, m, now);
  // Ladders / stairs next so the platform's solid top draws over
  // the ladder top rung — gives the impression of climbing INTO the
  // platform rather than past it.
  (m.ladders || []).forEach(l => dLadder(ctx, l));
  // Platforms / ledges — drawn before obstacles so a sandbag or
  // wreck sitting near a platform pillar still renders on top.
  (m.platforms || []).forEach(p => dPlatform(ctx, p));

  // Hazards (acid pools first so obstacles draw on top, then mines).
  (m.hazards || []).filter(h => h.type === 'acid').forEach(h => dHazard(ctx, h, now));
  // Foreground obstacles (biome-aware). Searchable containers get
  // a "loot ready" hint above them, an in-progress bar while the
  // player is searching, and a darker / open-lid look after looting.
  m.obstacles.forEach(o => {
    if (o.searched) {
      // Drained look — drawn at 0.55 alpha + a tiny "(empty)"
      ctx.save(); ctx.globalAlpha = 0.55;
      dObstacle(ctx, o);
      ctx.restore();
      ctx.fillStyle = 'rgba(120,120,110,0.6)'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('(empty)'), o.x, MGY - 28);
      ctx.textAlign = 'left';
    } else {
      dObstacle(ctx, o);
      if (o.searchable) {
        // Floating loot-icon hint
        const bob = Math.sin(now / 250 + o.x * 0.02) * 2;
        ctx.fillStyle = 'rgba(220,200,80,0.75)';
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText('★', o.x, MGY - 36 + bob);
        ctx.textAlign = 'left';
        // Mid-search progress bar
        if (o._searchAt) {
          const p = Math.min(1, (now - o._searchAt) / 700);
          ctx.fillStyle = 'rgba(20,30,15,0.8)';
          ctx.fillRect(o.x - 18, MGY - 50, 36, 4);
          ctx.fillStyle = '#88ee99';
          ctx.fillRect(o.x - 17, MGY - 49, 34 * p, 2);
        }
      }
    }
  });
  // Mines drawn after obstacles so the player can spot them on the road
  // (still low-contrast — they're hidden by design).
  (m.hazards || []).filter(h => h.type === 'mine').forEach(h => dHazard(ctx, h, now));

  for (let mx = 200; mx < MISSION_W; mx += 200) {
    ctx.fillStyle = 'rgba(80,80,60,0.3)'; ctx.fillRect(mx - 1, MGY + 2, 2, 8);
  }

  dMissionExtras(ctx, m, now);
  dCityWorld(ctx, m, now);

  m.pickups.forEach(p => {
    if (p.collected) return;
    const bob = Math.sin(now / 300 + p.x * 0.01) * 3;
    // Fork lane vs upper-floor pickups: lane 1 = the legacy high
    // road (-34), standingY = the new upper building floor (~-80).
    const yOff = (p.standingY || 0) + ((p.lane === 1) ? -34 : 0);
    ctx.save(); ctx.translate(p.x, MGY - 30 + bob + yOff);
    // Vaccine vial gets a bigger, brighter pulsing halo so the player
    // can find it through the hospital interior clutter — and so a
    // dropped vial is impossible to miss in the middle of a fight.
    if (p.type === 'vaccine') {
      const pulse = 0.55 + 0.45 * (Math.sin(now / 180) * 0.5 + 0.5);
      ctx.fillStyle = `rgba(120,255,140,${0.22 * pulse})`;
      ctx.beginPath(); ctx.arc(0, 0, 28 + pulse * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(120,255,140,${0.45 * pulse})`;
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = p.type === 'civilian' ? 'rgba(136,221,255,0.18)' : 'rgba(114,188,64,0.18)';
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(20,30,15,0.85)'; ctx.fillRect(-12, -12, 24, 24);
    ctx.strokeStyle = p.type === 'vaccine' ? '#88ff88' : p.type === 'gear' || p.type === 'quest' ? '#ffd54a' : p.type === 'civilian' ? '#88ddff' : C.acc; ctx.lineWidth = 1.5;
    ctx.strokeRect(-12, -12, 24, 24);
    ctx.font = '14px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText(p.type === 'gear' ? gearIcon(p.item) : p.type === 'quest' ? '📋' : (objIcons[p.type] || '?'), 0, 5);
    ctx.textAlign = 'left'; ctx.restore();
  });

  m.zombies.filter(z => z.state === 'dead').forEach(z => { z.lane = 0; dZombie(ctx, z, now); });
  // Living zombies — apply standingY offset so climbers and the
  // ones standing on platforms render at the correct height. The
  // dZombie helper draws at lane Y by default; ctx.translate
  // shifts the whole sprite up to the platform-top.
  m.zombies.filter(z => z.state !== 'dead' && z.activated).forEach(z => {
    z.lane = 0;
    const dy = z.standingY || 0;
    if (dy !== 0) { ctx.save(); ctx.translate(0, dy); dZombie(ctx, z, now); ctx.restore(); }
    else dZombie(ctx, z, now);
  });

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
      // Job targets (a named soldier) wear fatigues, not civvies.
      civilian: !r.questId, veteran: !!r.questId, onRoof: false, onExpedition: false, unarmed: true, npc: true,
    };
    dSoldier(ctx, rc, now);
    if (r.questId && r.state !== 'dead') {
      ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`📋 ${r.name}`, r.x, MGY - 92); ctx.textAlign = 'left';
    }
    // Floating "?" / "!" marker over their head so the player notices them
    if (r.state === 'idle') {
      ctx.fillStyle = '#88ddff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      const bob = Math.sin(now / 240) * 2;
      ctx.fillText('!', r.x, MGY - 60 + bob); ctx.textAlign = 'left';
    }
  });

  // Survivor humans (bandits when hostile, neutral traders before they
  // turn). Visual cue: peaceful traders use the civilian palette (the
  // only surviving organised military force is Fort Omega + lost
  // soldiers), bandits use the dark bandit palette.
  (m.humans || []).forEach(h => {
    const hc = {
      ...h, lane: 0, onExpedition: false, npc: true,
      civilian: !h.bandit && !h.compact,  // peaceful = civilian look
      bandit: !!h.bandit,                 // hostile  = bandit look
      swat: !!h.compact, police: !!h.compact,   // Compact soldiers: tactical kit
      maxHp: h.maxHp, hp: h.hp,
    };
    dSoldier(ctx, hc, now);
    // Tiny status pip above their head: red for hostile, green for trader
    const px = h.x, py = MGY - 64;
    ctx.fillStyle = h.hostile ? '#cc2222' : '#44bb44';
    ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
    if (h.colonel && h.state !== 'dead') {
      ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText('★ COL. VOSS', px, py - 6); ctx.textAlign = 'left';
    }
    if (h.state !== 'dead' && h.hp < h.maxHp) {
      // small hp bar
      ctx.fillStyle = 'rgba(20,20,20,0.7)'; ctx.fillRect(px - 11, py + 4, 22, 3);
      ctx.fillStyle = h.hostile ? '#cc2222' : '#44bb44';
      ctx.fillRect(px - 11, py + 4, 22 * (h.hp / h.maxHp), 3);
    }
  });

  // Embarked-soldier check: during a defend extraction, party
  // members who've stepped into the APC are hidden by the render
  // (the truck rolls them off-screen).
  const embarked = (m.extraction && m.extraction.soldierEmbarked) || {};
  // Draw followers first so the lead reads as in front of them.
  (m.followers || []).forEach(f => {
    if (embarked[f.id]) return;
    const fc = { ...f, lane: 0, onExpedition: false, state: f.state };
    ctx.save(); ctx.translate(0, f._laneY || 0);
    dSoldier(ctx, fc, now);
    if (m._vaccineCarrierId === f.id) dVaccineVial(ctx, f.x, now);
    ctx.restore();
  });

  if (!embarked[m.soldier.id]) {
    const sCopy = { ...m.soldier, lane: 0, onExpedition: false, state: m.soldier.state };
    // Render y offset = fork-lane offset + jump arc + platform stand
    // height. standingY is negative when on a platform (above ground).
    ctx.save(); ctx.translate(0,
      (m.soldier._laneY || 0)
      + (m.soldier.jumpY || 0)
      + (m.soldier.standingY || 0),
    );
    dSoldier(ctx, sCopy, now, true); // pass selection ring to mark the lead
    if (m._vaccineCarrierId === m.soldier.id) dVaccineVial(ctx, m.soldier.x, now);
    ctx.restore();
  }

  // Extraction APC — rolls in from the Fort Omega side, soldiers
  // board, then it drives back. Drawn AFTER party members so they
  // visually approach (and disappear into) the truck.
  if (m.extraction) {
    dExtractionAPC(ctx, m.extraction, now);
  }

  m.effects.forEach(e => dFx(ctx, e, now));
  m.bullets.forEach(b => dBlt(ctx, b));
  dNades(ctx, m, now);

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
    ctx.fillText(t('★ LAST STAND ★'), ax, MGY - 80); ctx.textAlign = 'left';
  } else if (m.objective !== 'explore') {   // explore: you leave by the van
    const goalX = MISSION_W - 30;
    const pulse = 0.6 + 0.4 * Math.sin(now / 300);
    ctx.fillStyle = `rgba(114,188,64,${pulse * 0.4})`;
    ctx.fillRect(goalX - 3, MGY - 120, 6, 120);
    ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace';
    ctx.fillText(t('★ GOAL ★'), goalX - 26, MGY - 128);
  }

  ctx.restore();
}

export function dMissionHUD(ctx, m, now) {
  const CW_ = 900;
  // Night raid: a dark veil (the HD pass also lowers the ambient light).
  if (m.cond === 'night') { ctx.fillStyle = 'rgba(2,4,14,0.22)'; ctx.fillRect(0, 0, CW_, 600); }
  dRadioSubtitle(ctx, m, now);
  const hg = ctx.createLinearGradient(0, 0, 0, 40);
  hg.addColorStop(0, 'rgba(6,10,6,0.94)'); hg.addColorStop(1, 'rgba(0,0,0,0.74)');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, CW_, 40);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 40.5); ctx.lineTo(CW_, 40.5); ctx.stroke();
  dObjectives(ctx, m, now);
  dCityHUD(ctx, m);

  // ── Destination + objective (truncated so it never runs into the bar)
  const riskCol = m.dest.risk === 'HIGH' ? '#dd4444' : m.dest.risk === 'MED' ? C.wrn : C.acc;
  ctx.font = 'bold 12px monospace'; ctx.fillStyle = C.acc; ctx.textAlign = 'left';
  let title = `${m.dest.icon ? m.dest.icon + ' ' : ''}${t(m.dest.name).toUpperCase()}`;
  while (ctx.measureText(title).width > 196 && title.length > 4) title = title.slice(0, -2) + '…';
  ctx.fillText(title, 12, 17);
  ctx.font = '9px monospace';
  ctx.fillStyle = riskCol; ctx.fillText(t(m.dest.risk || ''), 12, 32);
  ctx.fillStyle = C.txt;
  ctx.fillText(m.objective === 'defend' ? t('· HOLD THE FLAG')
    : m.room ? t('· {room} · E AT THE EXIT', { room: t(roomKind(m.room.door).name).toUpperCase() })
    : m.objective === 'explore' ? t('· EXPLORE · BACK TO VAN TO LEAVE') : t('· REACH THE EXIT'), 48, 32);

  // ── Route bar with markers (entrance, fork, defend flag, exit, party, boss)
  const px = 226, pw = 340, ph = 8, py = 11;
  const mx = x => px + (x / MISSION_W) * pw;
  ctx.fillStyle = '#141612'; ctx.fillRect(px, py, pw, ph);
  let pct;
  if (m.objective === 'defend' && m.defendStartedAt) {
    pct = Math.min(1, (now - m.defendStartedAt) / m.defendDuration);
    ctx.fillStyle = '#ff8844'; ctx.fillRect(px, py, pw * pct, ph);
  } else {
    pct = m.soldier.x / MISSION_W;
    ctx.fillStyle = 'rgba(114,188,64,0.55)'; ctx.fillRect(px, py, pw * pct, ph);
  }
  ctx.strokeStyle = C.uib; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  if (m.entranceX > 0) { ctx.fillStyle = '#aa8844'; ctx.fillRect(mx(m.entranceX) - 1, py - 2, 2, ph + 4); }
  if (m.fork) { ctx.fillStyle = 'rgba(204,136,0,0.45)'; ctx.fillRect(mx(m.fork.startX), py + ph - 2, mx(m.fork.endX) - mx(m.fork.startX), 2); }
  (m.segs || []).forEach(sg => {
    ctx.fillStyle = sg.locked ? 'rgba(200,70,50,0.55)' : 'rgba(170,140,90,0.45)';
    ctx.fillRect(mx(sg.x0), py + 1, mx(sg.x1) - mx(sg.x0), ph - 2);
  });
  if (m.objective === 'defend') { ctx.fillStyle = '#ff8800'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('⚑', mx(m.defendAnchor), py + 7); }
  else if (m.objective === 'explore') { ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(m.room ? '🚪' : '🚐', px - 9, py + 8); }
  else { ctx.fillStyle = C.acc; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('★', px + pw + 7, py + 8); }
  m.zombies.forEach(z => {
    if (z.state === 'dead' || !z.activated) return;
    ctx.fillStyle = z.type === 'brute' ? '#ff5533' : 'rgba(220,70,60,0.85)';
    const r = z.type === 'brute' ? 2.5 : 1.2;
    ctx.fillRect(mx(z.x) - r, py + ph / 2 - r, r * 2, r * 2);
  });
  (m.humans || []).forEach(h => {
    if (h.state === 'dead' || !h.hostile || !(h.activated || h.compact)) return;
    ctx.fillStyle = h.compact ? '#d8b060' : '#ff8844';
    const r = h.colonel ? 2.5 : 1.5;
    ctx.fillRect(mx(h.x) - r, py + ph / 2 - r, r * 2, r * 2);
  });
  [m.soldier, ...(m.followers || [])].forEach(p => {
    if (!p || p.hp <= 0 || p.state === 'dead') return;
    ctx.fillStyle = p === m.soldier ? '#ffffff' : '#7cf060';
    ctx.fillRect(mx(p.x) - 1.5, py - 1, 3, ph + 2);
  });
  ctx.textAlign = 'left';

  // Hostiles-cleared counter (the goal-gate condition).
  const need = Math.ceil(m.activatedCount * BALANCE.missionGoalKillRatio);
  const cleared = Math.min(m.killedCount, need);
  ctx.fillStyle = m.killedCount >= need && need > 0 ? C.acc : C.wrn;
  ctx.font = '9px monospace';
  if (m.compactAssault) {
    const g = garrisonOf(m);
    ctx.fillStyle = g.done ? C.acc : '#d8b060';
    ctx.fillText(t('🏴 GARRISON {a}/{b}', { a: g.down, b: g.total }) + (g.voss ? t(' · VOSS DOWN') : ''), px, 33);
  } else if (m.objective === 'explore') {
    ctx.fillStyle = C.txt;
    ctx.fillText(t('☠ KILLS {n}', { n: m.killedCount || 0 }), px, 33);
  } else ctx.fillText(t('HOSTILES {a}/{b}', { a: cleared, b: need || 0 }), px, 33);
  const total = (m.rescuables || []).length;
  if (total > 0) {
    const following = (m.rescuables || []).filter(r => r.state === 'following' && r.hp > 0).length;
    ctx.fillStyle = '#88ddff';
    ctx.fillText(t('👤 RESCUE {a}/{b}', { a: following, b: total }), px + 110, 33);
  }
  if (m._vaccineCampaign) {
    ctx.fillStyle = m._vaccineCollected && !m._vaccineDropped ? '#88ff88' : m._vaccineDropped ? '#ff8844' : 'rgba(184,204,170,0.6)';
    ctx.fillText(m._vaccineCollected ? (m._vaccineDropped ? t('💉 VIAL DROPPED') : t('💉 VIAL SECURED')) : t('💉 VIAL —'), px + 222, 33);
  }

  // ── Lead status: HP + ammo + spare magazines
  const s = m.soldier;
  const hpPct = Math.max(0, s.hp / (s.maxHp || 100));
  const hpCol = hpPct > 0.6 ? C.acc : hpPct > 0.3 ? C.wrn : C.dng;
  ctx.font = 'bold 10px monospace'; ctx.fillStyle = C.txt;
  ctx.fillText(s.name.toUpperCase(), 590, 14);
  ctx.fillStyle = '#141612'; ctx.fillRect(660, 7, 90, 7);
  ctx.fillStyle = hpCol; ctx.fillRect(660, 7, 90 * hpPct, 7);
  // Stamina (melee swings, jumps): blue, flashing amber when winded.
  const stPct = Math.max(0, Math.min(1, (s.stam ?? maxStam(s)) / maxStam(s)));
  ctx.fillStyle = '#141612'; ctx.fillRect(660, 16, 90, 3);
  ctx.fillStyle = winded(s) && Math.floor(now / 200) % 2 ? '#ffaa33' : '#5aa8e0'; ctx.fillRect(660, 16, 90 * stPct, 3);
  ctx.fillStyle = C.txt; ctx.font = '9px monospace';
  ctx.fillText(`${Math.max(0, Math.round(s.hp))}`, 754, 14);
  const knife = s.ammo <= 0 && (s.magsLeft || 0) <= 0;
  ctx.fillStyle = knife ? C.dng : s.ammo <= 4 ? C.wrn : C.acc; ctx.font = 'bold 10px monospace';
  ctx.fillText(knife ? t('🔪 KNIFE') : s.state === 'reload' ? t('RELOADING…') : t('AMMO {a}/{b}', { a: s.ammo, b: s.maxAmmo }), 590, 31);
  ctx.fillStyle = (s.magsLeft || 0) === 0 ? C.dng : C.txt; ctx.font = '9px monospace';
  ctx.fillText(`${t('MAGS')} ${'▮'.repeat(Math.min(6, s.magsLeft || 0))}${(s.magsLeft || 0) === 0 ? '0' : ''}`, 690, 31);

  // ── Loot collected this sortie
  ctx.font = '10px monospace';
  let cx = 790, row = 0;
  ctx.fillStyle = '#88ddff';
  Object.entries(m.collected).forEach(([k, v]) => {
    if (!v || v <= 0 || k === 'rescuedCivs' || Array.isArray(v)) return;
    const lbl = k === 'civilian' ? '👤' : k === 'lostSoldier' ? '🎖' : objIcons[k] || k[0];
    const txt = `${lbl}${v === true ? '' : v}`;
    const w = ctx.measureText(txt).width + 8;
    if (cx + w > CW_ - 4 && row === 0) { row = 1; cx = 790; }
    ctx.fillText(txt, cx, row ? 32 : 16);
    cx += w;
  });

  // ── Party panel (followers) under the HUD
  const party = (m.followers || []).filter(f => f && f.hp > 0 && f.state !== 'dead');
  party.forEach((f, i) => {
    const y = 46 + i * 15;
    const fp = Math.max(0, f.hp / (f.maxHp || 100));
    ctx.fillStyle = 'rgba(4,10,4,0.72)'; ctx.fillRect(8, y, 150, 13);
    ctx.fillStyle = C.txt; ctx.font = '9px monospace';
    ctx.fillText(f.name.slice(0, 9), 12, y + 10);
    ctx.fillStyle = '#141612'; ctx.fillRect(74, y + 4, 40, 4);
    ctx.fillStyle = fp > 0.6 ? C.acc : fp > 0.3 ? C.wrn : C.dng; ctx.fillRect(74, y + 4, 40 * fp, 4);
    const dry = f.ammo <= 0 && (f.magsLeft || 0) <= 0;
    ctx.fillStyle = dry ? C.dng : 'rgba(184,204,170,0.75)';
    ctx.fillText(dry ? '🔪' : `${f.ammo}+${f.magsLeft || 0}m`, 118, y + 10);
  });

  // ── Boss health bar
  const boss = m.zombies.find(z => z.type === 'brute' && z.state !== 'dead' && z.activated
    && Math.abs(z.x - m.soldier.x) < 560);
  if (boss) {
    const bw = 300, bx = (CW_ - bw) / 2, by = m.objective === 'defend' ? 72 : 48;
    ctx.fillStyle = 'rgba(20,4,4,0.85)'; ctx.fillRect(bx - 4, by - 2, bw + 8, 20);
    ctx.strokeStyle = '#aa2222'; ctx.strokeRect(bx - 3.5, by - 1.5, bw + 7, 19);
    ctx.fillStyle = '#2a0808'; ctx.fillRect(bx, by + 9, bw, 6);
    ctx.fillStyle = '#dd3322'; ctx.fillRect(bx, by + 9, bw * Math.max(0, boss.hp / boss.maxHp), 6);
    ctx.fillStyle = '#ffb0a0'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('☠ BRUTE'), CW_ / 2, by + 7); ctx.textAlign = 'left';
  }

  // Defend timer overlay (under the HUD so it never covers the route bar)
  if (m.objective === 'defend') {
    const ty = 46;
    if (m.defendStartedAt) {
      const left = Math.max(0, Math.ceil((m.defendDuration - (now - m.defendStartedAt)) / 1000));
      const total = Math.ceil(m.defendDuration / 1000);
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(CW_ / 2 - 80, ty, 160, 24);
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1; ctx.strokeRect(CW_ / 2 - 79.5, ty + 0.5, 159, 23);
      ctx.fillStyle = '#ff8800'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(m.extraction ? t('🚚 EXTRACTION') : t('⌛ DEFEND {s}s', { s: left }), CW_ / 2, ty + 16); ctx.textAlign = 'left';
      const p = 1 - left / total;
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(CW_ / 2 - 78, ty + 20, 156, 3);
      ctx.fillStyle = '#ff8800'; ctx.fillRect(CW_ / 2 - 78, ty + 20, 156 * p, 3);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(CW_ / 2 - 110, ty, 220, 22);
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1; ctx.strokeRect(CW_ / 2 - 109.5, ty + 0.5, 219, 21);
      ctx.fillStyle = '#ff8800'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('REACH THE DEFEND FLAG →'), CW_ / 2, ty + 15); ctx.textAlign = 'left';
    }
  }

  ctx.fillStyle = 'rgba(160,170,120,0.55)'; ctx.font = '9px monospace';
  ctx.fillText(
    m.fork && m.soldier.x >= m.fork.startX - 80 && m.soldier.x <= m.fork.endX
      ? t('A/D MOVE · SPACE FIRE · W/S SWITCH ROAD · ESC PAUSE')
      : t('A/D MOVE · SPACE FIRE (hold = strafe) · W JUMP/CLIMB · S DOWN · ESC PAUSE'),
    12, CH - 12,
  );

  if (m.state === 'won' || m.state === 'lost') {
    const f = Math.min(1, (now - m.endedAt) / 600);
    ctx.fillStyle = `rgba(0,0,0,${f * 0.7})`; ctx.fillRect(0, 0, CW_, CH);
    ctx.fillStyle = m.state === 'won' ? C.acc : C.dng;
    ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
    ctx.fillText(m.state === 'won' ? t('★ MISSION SUCCESS ★') : t('✖ MISSION FAILED'), CW_ / 2, CH / 2 - 20);
    ctx.font = '12px monospace'; ctx.fillStyle = C.txt;
    ctx.fillText(m.state === 'won' ? t('Returning to Fort Omega...') : t('{name} did not return.', { name: m.soldier.name }), CW_ / 2, CH / 2 + 10);
    // Debrief line: kills + haul (lost missions forfeit the haul).
    const haul = Object.entries(m.collected)
      .filter(([k, v]) => typeof v === 'number' && v > 0 && k !== 'rescuedCivs')
      .map(([k, v]) => `${objIcons[k] || k} ${v}`).join('   ');
    ctx.fillStyle = 'rgba(184,204,170,0.8)'; ctx.font = '11px monospace';
    ctx.fillText(t('☠ {n} kills', { n: m.killedCount }) + (m.state === 'won' && haul ? '   ·   ' + haul : ''), CW_ / 2, CH / 2 + 34);
    dReportGrade(ctx, sortieReport(m), CW_ / 2, CH / 2 + 50);
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
    ctx.fillText(t('SURVIVOR CAMP — TRADE OFFER'), CW_ / 2, y + 24);
    ctx.fillStyle = C.txt; ctx.font = '11px monospace';
    ctx.fillText(t('"We can spare some supplies — but it\'s not free."'), CW_ / 2, y + 46);
    ctx.fillText(t('They offer: {desc}', { desc: t(offer.desc) }), CW_ / 2, y + 64);

    const fmt = obj => Object.entries(obj).map(([k, v]) => `${v} ${objIcons[k] || k}`).join('   ');
    ctx.fillStyle = '#ff8855'; ctx.font = 'bold 12px monospace';
    ctx.fillText(t('YOU GIVE: {list}', { list: fmt(offer.give) }),  CW_ / 2, y + 92);
    ctx.fillStyle = '#88ddff';
    ctx.fillText(t('YOU GET:  {list}', { list: fmt(offer.get) }),   CW_ / 2, y + 112);

    // Two buttons at the bottom
    const bw = 200, bh = 32, by = y + h - bh - 16;
    const ax = x + 24, rx = x + w - bw - 24;
    ctx.fillStyle = '#1a3a18'; ctx.fillRect(ax, by, bw, bh);
    ctx.strokeStyle = C.acc; ctx.strokeRect(ax, by, bw, bh);
    ctx.fillStyle = C.acc; ctx.font = 'bold 12px monospace';
    ctx.fillText(t('✓ ACCEPT'), ax + bw / 2, by + 21);
    ctx.fillStyle = '#3a1818'; ctx.fillRect(rx, by, bw, bh);
    ctx.strokeStyle = C.dng; ctx.strokeRect(rx, by, bw, bh);
    ctx.fillStyle = C.dng;
    ctx.fillText(t('✖ REFUSE (fight)'), rx + bw / 2, by + 21);
    ctx.fillStyle = 'rgba(184,204,170,0.55)'; ctx.font = '9px monospace';
    ctx.fillText('[Y]', ax + bw / 2, by + bh + 11);
    ctx.fillText('[N]', rx + bw / 2, by + bh + 11);
    ctx.textAlign = 'left';

    if (m.dialog._error) {
      ctx.fillStyle = C.dng; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t(m.dialog._error), CW_ / 2, by - 8);
      ctx.textAlign = 'left';
    }

    // Store hit zones so the canvas onClick can resolve the dialog
    m.dialog._buttons = {
      accept: { x: ax, y: by, w: bw, h: bh },
      refuse: { x: rx, y: by, w: bw, h: bh },
    };
  }
}
