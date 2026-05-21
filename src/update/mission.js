import { C, CH, uid, rng } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MISSION_VIEW, MGY, objIcons, rollEncounter } from '../data/expeditions.js';
import { BIOMES, DEFAULT_BIOME } from '../data/biomes.js';
import { BALANCE } from '../data/difficulty.js';
import { dZombie } from '../render/zombie.js';
import { dSoldier } from '../render/soldier.js';
import { dFx, dBlt } from '../render/effects.js';
import { dRadioSubtitle } from '../render/hud.js';
import { pushRadio } from '../audio/radio.js';

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
  m.effects.push({ type: 'txt', x: heir.x, y: MGY - 90, v: `LEAD DOWN — ${heir.name.toUpperCase()} TAKING POINT`, col: '#ff8844', at: now, dur: 2600 });
  pushRadio(m, 'advance', { line: "I've got point!", urgent: true, speaker: heir });
  return true;
}

// magsPerSoldier: how many magazines each party member carries into
// the mission. 1 = only the loaded mag (no reloads possible). 2 =
// loaded + 1 spare. Etc. Tunable from the expedition loadout UI.
// Mission soldiers carry a finite ammo budget now — no more infinite
// auto-reload — so the player has to weigh stash spend vs mission risk.
export function mkMission(soldier, dest, wave = 1, magsPerSoldier = 2) {
  const zombies = [], pickups = [], obstacles = [];

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
  const totalZ = Math.floor(4 * dest.zSpawn + rng(0, 3));
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
  const pkCount = dest.risk === 'LOW' ? 6 : dest.risk === 'MED' ? 7 : 9;
  // Wave-bonus curve flattened from /2 to /3 so late-game pickups
  // don't drift into "every crate is +10 of everything" territory.
  const waveBonus = Math.floor(Math.max(0, wave - 1) / 3);
  for (let i = 0; i < pkCount; i++) {
    const x = 300 + Math.floor(MISSION_W / (pkCount + 1)) * (i + 1) + rng(-60, 60);
    const type = pkOptions[Math.floor(Math.random() * pkOptions.length)];
    // Per-pickup base values (post-second-rebalance):
    //   ammo 12-22 (unchanged — combat consumable, still fair)
    //   medicine 6-12 (unchanged — heals are an ongoing cost)
    //   food 8-14 → 5-9 (avg 7 — was inflating into hundreds)
    //   materials 4-8 → 3-5 (avg 4 — same problem)
    //   sniperAmmo 2-5, turretAmmo 8-16 (unchanged — niche)
    const base = type === 'medicine'   ? rng(6, 12)
      : type === 'ammo'       ? rng(12, 22)
      : type === 'food'       ? rng(5, 9)
      : type === 'sniperAmmo' ? rng(2, 5)
      : type === 'turretAmmo' ? rng(8, 16)
      : rng(3, 5);
    pickups.push({ id: uid(), x, type, value: base + waveBonus, collected: false, lane: 0 });
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
  const fork = (objective !== 'defend' && dest.risk !== 'LOW' && !vacSeg && Math.random() < 0.50)
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
  if (!biome.indoor && dest.risk !== 'LOW' && Math.random() < 0.55) {
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
    const SEARCHABLE_TYPES = new Set([
      // Indoor
      'desk', 'locker', 'filing-cabinet', 'evidence-box', 'gun-rack',
      'glass-case', 'workbench', 'cubicle', 'photocopier', 'water-cooler',
      // Outdoor / shared
      'crate', 'ammo-crate', 'container', 'trash-bin', 'medkit',
    ]);
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

  return {
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
    const shooterY = (who.standingY || 0);
    const bulletY  = MGY - 26 + shooterY;
    for (let p = 0; p < (w.pel || 1); p++) {
      const sp2 = (Math.random() - 0.5) * w.sp * 2;
      m.bullets.push({
        id: uid(), x: bx, y: bulletY,
        dx: who.facing * w.spd * Math.cos(sp2),
        dy: w.spd * Math.sin(sp2),
        dmg: w.pel ? w.dmg / w.pel : w.dmg,
        shooterY,
        life: Math.ceil(w.range / w.spd * 1.15),
      });
    }
    m.effects.push({ type: 'shell', x: who.x - who.facing * 8, y: MGY - 26, vx: -who.facing * (1.4 + Math.random()), at: now, dur: 780 });
    if (who.ammo === 0) {
      if ((who.magsLeft || 0) > 0) {
        who.state = 'reload'; who.reloadStart = now; who.ammo = who.maxAmmo;
        who.magsLeft -= 1;
        m.soundQ.push({ t: 'reload', w: who.weapon, dur: w.rl });
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
  if (m.state !== 'active') return;
  if (m.dialog) return; // Pause world simulation while a survivor dialog is open
  if (!m.startedAt) {
    m.startedAt = now;
    // Vaccine campaign scenarios pop a big intro banner on the first
    // frame so the player knows which leg they just transitioned to.
    if (m._vaccineScenarioName) {
      m.effects.push({
        type: 'txt', x: m.soldier.x, y: MGY - 140,
        v: m._vaccineScenarioName.toUpperCase(),
        col: '#ffcc44', at: now, dur: 3200,
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
  if (s.state !== 'reload' && s.state !== 'knife') {
    if (m.inputRight) { s.x += moveSpd; s.facing = 1; if (s.state === 'idle') s.state = 'walk'; }
    else if (m.inputLeft) { s.x -= moveSpd; s.facing = -1; if (s.state === 'idle') s.state = 'walk'; }
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
  } else if (m.inputUp && onSurface && s.state !== 'knife' && s.state !== 'reload') {
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
        if (ladder && ladder.d < 400) {
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
          m.soundQ.push({ t: 'zatk' });
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
      if (z.atkTimer > 1000) {
        z.atkTimer = 0;
        tgt.hp -= z.z.dmg; tgt.hurtTimer = 320;
        m.soundQ.push({ t: 'zatk' });
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
  if (m.inputShoot && s.state !== 'reload' && s.ammo > 0) {
    if (now - s.lastShot >= w.rate) {
      s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.ammo--;
      m.soundQ.push({ t: 'shot', w: s.weapon }); m.soundQ.push({ t: 'shell' });
      const bx = s.x + s.facing * 24;
      // Bullet origin Y rides the soldier's platform — if the lead
      // is up on a ledge / second floor, their muzzle is up there
      // too. shooterY is tracked on each bullet so the collision
      // pass can match them with zombies on the same level.
      const shooterY = (s.standingY || 0);
      const bulletY  = MGY - 26 + shooterY;
      for (let p = 0; p < (w.pel || 1); p++) {
        const sp2 = (Math.random() - 0.5) * w.sp * 2;
        m.bullets.push({
          id: uid(), x: bx, y: bulletY,
          dx: s.facing * w.spd * Math.cos(sp2), dy: w.spd * Math.sin(sp2),
          dmg: w.pel ? w.dmg / w.pel : w.dmg,
          life: Math.ceil(w.range / w.spd * 1.15),
          shooterY,
        });
      }
      m.effects.push({ type: 'shell', x: s.x - s.facing * 8, y: bulletY, vx: -s.facing * (1.4 + Math.random()), at: now, dur: 780 });
      if (s.ammo === 0) {
        if ((s.magsLeft || 0) > 0) {
          s.state = 'reload'; s.reloadStart = now; s.ammo = s.maxAmmo;
          s.magsLeft -= 1;
          m.soundQ.push({ t: 'reload', w: s.weapon, dur: w.rl });
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
        m.effects.push({ type: 'txt', x: s.x, y: MGY - 100, v: 'EXTRACTION INBOUND', col: '#88ddff', at: now, dur: 2400 });
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
        m.effects.push({ type: 'txt', x: s.x, y: MGY - 90, v: 'BOARD UP!', col: '#88ee99', at: now, dur: 1800 });
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
      h.x += 0.9 * h.facing * (dt / 16);
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
      else if (now - h.lastShot > wMeta.rate * 1.6) {
        h.lastShot = now; h.state = 'shoot'; h.ammo--;
        const pellets = wMeta.pel || 1;
        const baseDmg = (wMeta.pel ? wMeta.dmg / wMeta.pel : wMeta.dmg) * 0.55;
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
      m.soundQ.push({ t: 'fire', w: h.weapon });
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
          if (Math.abs(p.x - h.x) > h.w / 2) return;
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
      const hit = aliveTargets(m).find(p => Math.abs(p.x - b.x) < 18);
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
        missionKillChatter(m, m.soldier);
      }
      return false;
    }

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
      hit.hp -= b.dmg; hit.hurtTimer = 210; m.soundQ.push({ t: 'hit', now });
      m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 6 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3.5, vy: -Math.random() * 2.5 - 0.5, r: 1.5 + Math.random() * 3 })), at: now, dur: 600 });
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: C.bld, at: now, dur: 680 });
      if (hit.hp <= 0) {
        hit.hp = 0; hit.state = 'dead'; hit.deadAt = now;
        m.soundQ.push({ t: 'zdie', zt: hit.type });
        m.killedCount++;
        missionKillChatter(m, m.soldier);
      }
      return false;
    }
    return true;
  });

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
      const VALUES = {
        ammo: [4, 9], medicine: [3, 6], food: [3, 6],
        materials: [2, 4], sniperAmmo: [1, 2], turretAmmo: [3, 6],
      };
      const [lo, hi] = VALUES[type] || [1, 3];
      const value = rng(lo, hi);
      m.collected[type] = (m.collected[type] || 0) + value;
      m.effects.push({
        type: 'txt',
        x: o.x, y: MGY - 70,
        v: `+${value} ${type}`,
        col: type === 'ammo' || type === 'sniperAmmo' || type === 'turretAmmo' ? '#88ddff' : C.acc,
        at: now, dur: 1200,
      });
      m.soundQ.push({ t: 'pickup' });
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
    ctx.fillText('◀ BOARD UP', x + 10, y - 64 + bob);
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
    ctx.fillText('WANTED', x, py + 11);
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
    ctx.fillText('EXIT', x, py + 10);
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
      ctx.fillText('EVIDENCE', x, MGY - 6); ctx.textAlign = 'left';
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
  ctx.fillText('ENTER', x, fy - 16);
  ctx.textAlign = 'left';
  // Hinge bolts on the sign
  ctx.fillStyle = '#2a2018'; ctx.fillRect(fx + 8, fy - 24, 2, 2); ctx.fillRect(fx + doorW - 10, fy - 24, 2, 2);
}

export function dMissionWorld(ctx, m, now) {
  ctx.save();
  ctx.translate(-m.cameraX, 0);

  const biome = BIOMES[m.biomeKey] || BIOMES[DEFAULT_BIOME];

  if (biome.indoor) {
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

  // Building architecture first (columns, back wall, far door) so
  // ladders and the upper-floor slab render in front of it.
  (m.buildings || []).forEach(b => dBuilding(ctx, b));
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
      ctx.fillText('(empty)', o.x, MGY - 28);
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

  m.pickups.forEach(p => {
    if (p.collected) return;
    const bob = Math.sin(now / 300 + p.x * 0.01) * 3;
    // Fork lane vs upper-floor pickups: lane 1 = the legacy high
    // road (-34), standingY = the new upper building floor (~-80).
    const yOff = (p.standingY || 0) + ((p.lane === 1) ? -34 : 0);
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
  // turn). Visual cue: peaceful traders use the civilian palette (the
  // only surviving organised military force is Fort Omega + lost
  // soldiers), bandits use the dark bandit palette.
  (m.humans || []).forEach(h => {
    const hc = {
      ...h, lane: 0, onExpedition: false,
      civilian: !h.bandit,                // peaceful = civilian look
      bandit: !!h.bandit,                 // hostile  = bandit look
      maxHp: h.maxHp, hp: h.hp,
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
  dRadioSubtitle(ctx, m, now);
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
