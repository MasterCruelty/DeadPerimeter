import { C, WORLD_W, GY, WX, uid, rng, laneY, laneSc } from '../constants.js';
import { WPN, wbase, MELEE } from '../data/weapons.js';
import { meleeStats, wearMelee, tickStam } from '../entities/gear.js';
import { addXp, KILL_XP, BOSS_XP, WAVE_XP } from '../data/progression.js';
import { HUMAN_AMMO_DROP, isHumanWaveNumber } from '../data/humans.js';
import { BALANCE, RESEARCHES, waveClearAmmoFor, getSoldierPerkEffect } from '../data/difficulty.js';
import { TRANSMISSION_WAVES } from '../data/transmissions.js';
import { mkZombie } from '../entities/zombie.js';
import { mkHuman } from '../entities/human.js';
import { mkSoldier, reserveOpts } from '../entities/soldier.js';
import { recordDeath } from '../entities/gameState.js';
import { pushRadio } from '../audio/radio.js';
import { WAVE_MODS, rollWaveMod } from '../data/waveMods.js';
import { ZTP } from '../data/zombies.js';
import { tickSiegeEvent, settleSiegeEvent } from './siegeEvents.js';
import { cityDayTick } from '../data/city.js';
import { compactDayTick } from './faction.js';
import { hasUnlock } from './quests.js';
import { startWaveStats, waveReport } from '../expedition/report.js';
import { t } from '../i18n/index.js';

// Visibility conditions (fog / night) shrink every friendly weapon range.
const modRange = gs => (gs.waveMod && WAVE_MODS[gs.waveMod] && WAVE_MODS[gs.waveMod].rangeMul) || 1;

// Read the multiplier from a completed research node by effect-key.
// Defaults to 1 when no node touches this key. Kept local to avoid
// pulling the bigger getResearchEffect() helper into the hot loop.
function researchMul(gs, key) {
  const ids = (gs && gs.research && gs.research.completed) || [];
  let m = 1;
  for (const id of ids) {
    const r = RESEARCHES.find(r => r.id === id);
    if (r && r.effects && key in r.effects) m *= r.effects[key];
  }
  return m;
}

// Multiplier / bonus aggregated from a soldier's perks + skill ranks.
const perkMul = (sol, key) => getSoldierPerkEffect(sol, key, 1);
const perkBonus = (sol, key) => getSoldierPerkEffect(sol, key, 0);

// Effective reload time + weapon range. Folds in research effects
// AND per-soldier perks. `sol` may be null for non-soldier callers.
function effRl(gs, sol, w) {
  return w.rl * researchMul(gs, 'reloadMul') * perkMul(sol, 'reloadMul');
}
function effRange(gs, sol, weaponKey, w) {
  let bonus = 0;
  if (wbase(weaponKey) === 'sniper') {
    const ids = (gs && gs.research && gs.research.completed) || [];
    for (const id of ids) {
      const r = RESEARCHES.find(r => r.id === id);
      if (r && r.effects && 'sniperRangeBonus' in r.effects) bonus += r.effects.sniperRangeBonus;
    }
  }
  bonus += perkBonus(sol, 'rangeBonus');
  return (w.range + bonus) * modRange(gs);
}

// Helper for soldier "I'm hit / I'm down" callouts. Toggles a flag on
// the soldier so the line fires once per low-HP descent and resets
// when the soldier is patched back above 60% of max.
function hurtCallout(state, sol) {
  if (!sol || sol.state === 'dead' || sol.civilian) return;
  if (sol.hp <= 0) return;
  const pct = sol.hp / (sol.maxHp || 100);
  if (pct < 0.35 && !sol._hurtCallout) {
    sol._hurtCallout = true;
    pushRadio(state, 'hurt', { urgent: true, speaker: sol });
  } else if (pct > 0.60) {
    sol._hurtCallout = false;
  }
}

// 8% chance per zombie/human kill to pop a one-liner. Cooldown-gated
// by pushRadio so a clean wave-sweep doesn't drown the player in
// chatter.
function maybeKillChatter(state, sol) {
  if (!sol || sol.civilian) return;
  if (Math.random() < 0.08) pushRadio(state, 'kill', { speaker: sol });
}

// Returns true if there is a live barricade in the same lane between
// the attacker (coming from outside the base) and the soldier (closer
// to the wall). Used to halve melee damage.
function isBehindBarricade(gs, soldier, attackerX) {
  return gs.barricades.some(b => b.hp > 0 && b.x > soldier.x && b.x < attackerX);
}

// The fort on the radio: Jun once a wave when the wall is failing,
// Reyes when someone on the wall goes down.
function fortRadio(gs) {
  if (!gs._wallWarned && gs.waveTime > 4000 && gs.baseHp > 0 && gs.baseHp / (gs.baseMaxHp || 1) < 0.3) {
    gs._wallWarned = true;
    pushRadio(gs, 'baseHit', { line: 'The wall is coming apart! I can patch it after, just keep them off it!', from: 'jun', urgent: true, cooldown: 0 });
  }
  const seen = gs._deadSeen || (gs._deadSeen = new Set(gs.soldiers.filter(s => s.state === 'dead').map(s => s.id)));
  const lost = gs.soldiers.find(s => s.state === 'dead' && !seen.has(s.id));
  if (lost) {
    seen.add(lost.id);
    pushRadio(gs, 'hurt', { line: '{name} is down. I can\'t reach them out there.', params: { name: lost.name }, from: 'reyes', cooldown: 0 });
  }
}

export function update(gs, now, dt) {
  if (gs.phase !== 'siege') return;
  // Baseline for the end-of-wave report (startWave resets waveTime).
  if (!gs.waveTime || !gs.waveStats) gs.waveStats = startWaveStats(gs);
  gs.waveTime += dt;
  gs.shakeTimer = Math.max(0, gs.shakeTimer - dt);
  fortRadio(gs);

  // ── SPAWN ────────────────────────────────────────────────────
  while (gs.spawnQueue.length && gs.spawnQueue[0].at <= gs.waveTime) {
    const spawn = gs.spawnQueue.shift();
    if (gs.isHumanWave) {
      const h = mkHuman(spawn.type);
      if (gs.compactRaid) { h.compact = true; h.hp = h.maxHp = Math.round(h.hp * 1.5); }
      gs.humans.push(h);
    } else {
      const z = mkZombie(spawn.type, spawn.boss ? { boss: true, wave: gs.wave } : null);
      if (z.type === 'spitter') {
        const above = Math.max(0, gs.wave - 5);
        z._spitDmg = Math.max(3, Math.round(ZTP.spitter.dmg * (0.7 + above * 0.10)));
        z._spitRate = Math.max(1500, 2800 - above * 130);
      }
      gs.zombies.push(z);
      if (z.boss) {
        gs.boss = z; gs.shakeTimer = 500;
        gs.soundQ.push({ t: 'roar', x: z.x });
        pushRadio(gs, 'baseHit', { line: '{boss} incoming, middle lane! Focus fire!', params: { boss: t(z.bossName) }, urgent: true, cooldown: 0, from: 'hale' });
        gs.effects.push({ type: 'txt', x: z.x - 200, y: laneY(1) - 110, v: `☠ ${t(z.bossName)} ☠`, col: '#ff5533', at: now, dur: 2600 });
      } else if (z.type === 'brute') gs.soundQ.push({ t: 'roar', x: z.x });
    }
    gs.zombiesSpawned++;
  }

  tickSiegeEvent(gs, now, dt);

  // Ambient groan (zombies only)
  const living = gs.zombies.filter(z => z.state !== 'dead');
  if (living.length > 0 && Math.random() < 0.004) {
    const rz = living[Math.floor(Math.random() * living.length)];
    gs.soundQ.push({ t: 'groan', now, zt: rz.type, x: rz.x });
  }

  // ── ZOMBIES ──────────────────────────────────────────────────
  gs.zombies.forEach(z => {
    if (z.state === 'dead') return;
    z.hurtTimer = Math.max(0, z.hurtTimer - dt);
    if (z.z.ranged) { spitterTick(gs, z, now, dt); return; }
    if (z.state === 'walk') {
      z.x += z.spd * z.facing * (dt / 16);
      const ns = gs.soldiers.find(s => s.state !== 'dead' && !s.onExpedition && s.lane === z.lane && Math.abs(s.x - z.x) < 42);
      if (ns) { z.state = 'attack'; z.targetSolId = ns.id; z.targetBarId = null; }
      else {
        const nb = gs.barricades.find(b => Math.abs(b.x - z.x) < 24);
        if (nb) { z.state = 'attack'; z.targetBarId = nb.id; z.targetSolId = null; }
        else if (z.x < WX + 46) { z.state = 'attack'; z.targetSolId = null; z.targetBarId = null; }
      }
    } else if (z.state === 'attack') {
      z.atkTimer += dt;
      if (z.atkTimer > (z.z.atkRate || 1100)) {
        z.atkTimer = 0;
        if (z.targetBarId) {
          const bar = gs.barricades.find(b => b.id === z.targetBarId);
          if (bar && Math.abs(bar.x - z.x) < 30) {
            bar.hp -= z.z.dmg; gs.soundQ.push({ t: 'bhit', x: bar.x });
            gs.effects.push({ type: 'txt', x: bar.x, y: laneY(0) - 50, v: `-${z.z.dmg}`, col: C.wrn, at: now, dur: 700 });
            // Barbed-wire reflective damage on the attacker
            z.hp -= BALANCE.barricadeReflectDmg; z.hurtTimer = 210;
            gs.effects.push({ type: 'txt', x: z.x, y: laneY(z.lane) - 60, v: `-${BALANCE.barricadeReflectDmg}`, col: '#ff7733', at: now, dur: 600 });
            if (bar.hp <= 0) { gs.barricades = gs.barricades.filter(b => b.id !== z.targetBarId); z.state = 'walk'; z.targetBarId = null; }
            if (z.hp <= 0) killTarget(gs, z, now, null);
          } else { z.state = 'walk'; z.targetBarId = null; }
        } else {
          const sol = z.targetSolId ? gs.soldiers.find(s => s.id === z.targetSolId) : null;
          if (sol && sol.state !== 'dead' && sol.lane === z.lane && Math.abs(sol.x - z.x) < 55) {
            const dmg = isBehindBarricade(gs, sol, z.x)
              ? Math.max(1, Math.round(z.z.dmg * BALANCE.behindBarricadeDmgMul))
              : z.z.dmg;
            sol.hp -= dmg; sol.hurtTimer = 360; gs.soundQ.push({ t: 'zatk', x: z.x });
            if (sol.hp <= 0) { sol.hp = 0; sol.state = 'dead'; z.targetSolId = null; z.state = 'walk'; recordDeath(gs, sol); }
            else hurtCallout(gs, sol);
          } else {
            const ns2 = gs.soldiers.find(s => s.state !== 'dead' && !s.onExpedition && s.lane === z.lane && Math.abs(s.x - z.x) < 55);
            if (ns2) { z.targetSolId = ns2.id; }
            else if (z.x < WX + 62) {
              gs.baseHp -= z.z.dmg; gs.shakeTimer = 300; gs.soundQ.push({ t: 'bhit' });
              gs.effects.push({ type: 'txt', x: WX / 2, y: GY - 120, v: `-${z.z.dmg}`, col: C.dng, at: now, dur: 900 });
            } else { z.state = 'walk'; z.targetSolId = null; }
          }
        }
      }
    }
  });

  // ── HOSTILE HUMANS ───────────────────────────────────────────
  gs.humans.forEach(h => {
    if (h.state === 'dead') return;
    h.hurtTimer = Math.max(0, h.hurtTimer - dt);
    const meta = h.h;

    if (h.state === 'walk') {
      // Gunmen stop at range; knifemen close to melee.
      const nsAny = gs.soldiers.find(s => s.state !== 'dead' && !s.onExpedition && s.lane === h.lane);
      if (meta.range > 0 && nsAny && Math.abs(h.x - nsAny.x) <= meta.range) {
        h.state = 'attack'; h.targetSolId = nsAny.id; h.targetBarId = null;
      } else {
        h.x += h.spd * h.facing * (dt / 16);
        const ns = gs.soldiers.find(s => s.state !== 'dead' && !s.onExpedition && s.lane === h.lane && Math.abs(s.x - h.x) < 42);
        if (ns && meta.range === 0) { h.state = 'attack'; h.targetSolId = ns.id; h.targetBarId = null; }
        else {
          const nb = gs.barricades.find(b => Math.abs(b.x - h.x) < 24);
          if (nb && meta.range === 0) { h.state = 'attack'; h.targetBarId = nb.id; h.targetSolId = null; }
          else if (h.x < WX + 46 && meta.range === 0) { h.state = 'attack'; h.targetSolId = null; h.targetBarId = null; }
        }
      }
    } else if (h.state === 'attack') {
      if (meta.range > 0) {
        // Gunman: shoot periodically; lose target if it dies or leaves lane
        const sol = h.targetSolId ? gs.soldiers.find(s => s.id === h.targetSolId) : null;
        if (!sol || sol.state === 'dead' || sol.lane !== h.lane || Math.abs(sol.x - h.x) > meta.range) {
          h.state = 'walk'; h.targetSolId = null;
        } else if (now - (h.lastShot || 0) >= meta.rate) {
          h.lastShot = now;
          gs.soundQ.push({ t: 'shot', w: 'pistol', x: h.x });
          const by0 = laneY(h.lane) - Math.round(20 * laneSc(h.lane));
          const by1 = laneY(sol.lane) - Math.round(28 * laneSc(sol.lane));
          gs.bullets.push({
            id: uid(),
            x: h.x - 18, y: by0,
            dx: -meta.bulletSpd,
            dy: (by1 - by0) / Math.max(1, meta.range / meta.bulletSpd),
            dmg: meta.dmg,
            life: Math.ceil(meta.range / meta.bulletSpd * 1.2),
            targetLane: h.lane,
            hostile: true,
          });
        }
      } else {
        // Knifeman / melee
        h.atkTimer += dt;
        if (h.atkTimer > 1100) {
          h.atkTimer = 0;
          if (h.targetBarId) {
            const bar = gs.barricades.find(b => b.id === h.targetBarId);
            if (bar && Math.abs(bar.x - h.x) < 30) {
              bar.hp -= meta.dmg; gs.soundQ.push({ t: 'bhit', x: bar.x });
              gs.effects.push({ type: 'txt', x: bar.x, y: laneY(0) - 50, v: `-${meta.dmg}`, col: C.wrn, at: now, dur: 700 });
              // Barbed-wire reflective damage
              h.hp -= BALANCE.barricadeReflectDmg; h.hurtTimer = 210;
              gs.effects.push({ type: 'txt', x: h.x, y: laneY(h.lane) - 60, v: `-${BALANCE.barricadeReflectDmg}`, col: '#ff7733', at: now, dur: 600 });
              if (bar.hp <= 0) { gs.barricades = gs.barricades.filter(b => b.id !== h.targetBarId); h.state = 'walk'; h.targetBarId = null; }
              if (h.hp <= 0) killTarget(gs, h, now, null);
            } else { h.state = 'walk'; h.targetBarId = null; }
          } else {
            const sol = h.targetSolId ? gs.soldiers.find(s => s.id === h.targetSolId) : null;
            if (sol && sol.state !== 'dead' && sol.lane === h.lane && Math.abs(sol.x - h.x) < 55) {
              const dmg = isBehindBarricade(gs, sol, h.x)
                ? Math.max(1, Math.round(meta.dmg * BALANCE.behindBarricadeDmgMul))
                : meta.dmg;
              sol.hp -= dmg; sol.hurtTimer = 360; gs.soundQ.push({ t: 'slash', x: h.x });
              if (sol.hp > 0) hurtCallout(gs, sol);
              gs.effects.push({ type: 'slash', x: sol.x - h.facing * 10, y: laneY(sol.lane) - 28, at: now, dur: 230 });
              if (sol.hp <= 0) { sol.hp = 0; sol.state = 'dead'; h.targetSolId = null; h.state = 'walk'; recordDeath(gs, sol); }
            } else {
              const ns2 = gs.soldiers.find(s => s.state !== 'dead' && !s.onExpedition && s.lane === h.lane && Math.abs(s.x - h.x) < 55);
              if (ns2) { h.targetSolId = ns2.id; }
              else if (h.x < WX + 62) {
                gs.baseHp -= meta.dmg; gs.shakeTimer = 300; gs.soundQ.push({ t: 'bhit' });
                gs.effects.push({ type: 'txt', x: WX / 2, y: GY - 120, v: `-${meta.dmg}`, col: C.dng, at: now, dur: 900 });
              } else { h.state = 'walk'; h.targetSolId = null; }
            }
          }
        }
      }
    }
  });

  // ── TURRETS ──────────────────────────────────────────────────
  // Static machine-guns built behind the wall. Fire automatically at
  // the closest enemy in range, draw from the dedicated turretAmmo
  // pool so they don't compete with the soldiers' rifle / pistol mags.
  (gs.turrets || []).forEach(t => {
    if ((gs.resources.turretAmmo || 0) <= 0) return; // dry — needs a refill at base
    if (now - (t.lastShot || 0) < BALANCE.turretRate) return;
    const pool = gs.isHumanWave ? gs.humans : gs.zombies;
    const tRange = BALANCE.turretRange * modRange(gs);
    const tgt = pool
      .filter(e => e.state !== 'dead' && e.x > WX && Math.abs(e.x - t.x) <= tRange)
      .sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
    if (!tgt) return;
    t.lastShot = now;
    gs.resources.turretAmmo = Math.max(0, gs.resources.turretAmmo - 1);
    gs.soundQ.push({ t: 'shot', w: 'rifle', x: t.x });
    gs.soundQ.push({ t: 'shell' });
    const by0 = t.y - 8;
    const by1 = laneY(tgt.lane) - Math.round(24 * laneSc(tgt.lane));
    const range = Math.max(40, Math.abs(tgt.x - t.x));
    gs.bullets.push({
      id: uid(),
      x: t.x + 36, y: by0,
      dx: 16,
      dy: (by1 - by0) / Math.max(1, range / 16),
      dmg: BALANCE.turretDmg,
      life: Math.ceil(range / 16 * 1.2),
      targetLane: tgt.lane,
    });
    gs.effects.push({ type: 'shell', x: t.x - 6, y: by0, vx: -1.4, at: now, dur: 720 });
  });

  // ── SOLDIERS ─────────────────────────────────────────────────
  gs.soldiers.forEach(s => {
    if (s.state === 'dead' || s.onExpedition) return;
    s.hurtTimer = Math.max(0, s.hurtTimer - dt);
    tickStam(s, dt);

    // Rooftop sniper branch
    if (s.onRoof) {
      const w = WPN[s.weapon];
      s.recoil = Math.max(0, (s.recoil || 0) - dt);
      if (s.state === 'reload') {
        if (now - s.reloadStart >= effRl(gs, s, w)) { s.ammo = s.maxAmmo; s.state = 'idle'; s.reloadTriggered = false; }
        return;
      }
      if (s.ammo <= 0) {
        const refill = Math.min(s.maxAmmo, gs.resources.sniperAmmo || 0);
        if (refill > 0) {
          gs.resources.sniperAmmo -= refill;
          s.state = 'reload'; s.reloadStart = now; s.ammo = refill;
          if (!s.reloadTriggered) { s.reloadTriggered = true; gs.soundQ.push({ t: 'reload', w: s.weapon, dur: effRl(gs, s, w) / (gs.speed || 1) }); pushRadio(gs, 'reload', { speaker: s }); }
          gs.effects.push({ type: 'txt', x: s.x + 30, y: GY - 160, v: t('RELOAD!'), col: C.wrn, at: now, dur: 800 });
        } else {
          // Out of sniper ammo — descend
          s.onRoof = false;
          s.lane = 1;
          s.x = WX + 30; s.destX = WX + 90; s.state = 'walk'; s.facing = 1;
          s.weapon = 'pistol'; s.maxAmmo = WPN.pistol.ammo;
          s.ammo = Math.min(WPN.pistol.ammo, gs.resources.ammo);
          gs.resources.ammo = Math.max(0, gs.resources.ammo - s.ammo);
          gs.effects.push({ type: 'txt', x: WX / 2, y: GY - 150, v: t('DESCENDING!'), col: C.dng, at: now, dur: 1400 });
        }
        return;
      }
      // Target picker: furthest zombie or human IN WEAPON RANGE.
      // Previously this only filtered by world bounds (z.x < WORLD_W),
      // so the sniper happily picked targets across the entire 1980-px
      // battlefield and the bullet-life math (range = distance-to-tgt
      // below) gave it effectively infinite reach. Now the same range
      // gate that the ground soldiers use applies here too.
      const wRange = effRange(gs, s, s.weapon, w);
      const pool = gs.isHumanWave
        ? gs.humans.filter(z => z.state !== 'dead' && z.x > WX && Math.abs(z.x - s.x) <= wRange)
        : gs.zombies.filter(z => z.state !== 'dead' && z.x > WX && Math.abs(z.x - s.x) <= wRange);
      if (pool.length === 0) return;
      const tgt = pool.sort((a, b) => b.x - a.x)[0];
      s.facing = 1;
      if (now - s.lastShot >= w.rate) {
        s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.recoil = 200; s.ammo--;
        gs.soundQ.push({ t: 'shot', w: 'rifle', x: s.x });
        // Muzzle of the kneeling rooftop sniper's rifle.
        const sx = s.x + 20, sy = GY - 184;
        const by1 = laneY(tgt.lane) - Math.round(24 * laneSc(tgt.lane));
        // Bullet life is capped by the WEAPON range, not the distance
        // to the picked target. Previously a distant target (filtered
        // only by world bounds) made the bullet live long enough to
        // cross the whole map — that was the "sniper reaches the end
        // of the world" bug the player reported.
        const distToTgt = Math.max(40, Math.abs(tgt.x - sx));
        const travelDist = Math.min(distToTgt, wRange);
        gs.bullets.push({
          id: uid(), x: sx + 24, y: sy - 2,
          dx: w.spd, dy: (by1 - (sy - 2)) / (distToTgt / w.spd),
          dmg: w.dmg, life: Math.ceil(travelDist / w.spd * 1.2),
          targetLane: tgt.lane, shooterId: s.id,
        });
        gs.effects.push({ type: 'shell', x: sx - 4, y: sy - 2, vx: -1.6, at: now, dur: 780 });
      } else if (now - s.lastShot > w.rate * 0.4) s.state = 'idle';
      return;
    }

    // Ground soldier
    if (s.state === 'walk') {
      const dx = s.destX - s.x;
      if (Math.abs(dx) > 3) {
        const step = Math.sign(dx) * 1.8 * (dt / 16);
        const newX = s.x + step;
        const bars = gs.barricades || [];
        let finalX = newX;
        for (const bar of bars) {
          if (!bar) continue;
          const onLeft  = s.x <= bar.x - 12;
          const onRight = s.x >= bar.x + 12;
          if (step > 0 && onLeft && newX > bar.x - 12) { finalX = bar.x - 13; s.state = 'idle'; s.destX = Math.min(s.destX, bar.x - 13); break; }
          if (step < 0 && onRight && newX < bar.x + 12) { finalX = bar.x + 13; s.state = 'idle'; s.destX = Math.max(s.destX, bar.x + 13); break; }
        }
        s.x = finalX;
        if (Math.abs(s.destX - s.x) <= 3) { s.x = s.destX; s.state = 'idle'; }
      } else { s.x = s.destX; s.state = 'idle'; }
      return;
    }

    const w = WPN[s.weapon];

    // Target zombies during normal waves, humans during human waves
    const wRangeG = effRange(gs, s, s.weapon, w);
    const enms = gs.isHumanWave
      ? gs.humans.filter(z => z.state !== 'dead' && Math.abs(z.x - s.x) <= wRangeG && z.x > WX)
      : gs.zombies.filter(z => z.state !== 'dead' && Math.abs(z.x - s.x) <= wRangeG && z.x > WX);
    const tgt = enms.sort((a, b) => {
      const lbonus = (b.lane === s.lane ? 0 : 1) - (a.lane === s.lane ? 0 : 1);
      return lbonus || Math.abs(a.x - s.x) - Math.abs(b.x - s.x);
    })[0];

    if (!tgt) {
      if (s.state === 'shoot') s.state = 'idle';
      s.reloadTriggered = false;
      return;
    }
    s.facing = tgt.x > s.x ? 1 : -1;

    if (s.state === 'reload') {
      if (now - s.reloadStart >= effRl(gs, s, w)) { s.ammo = s.maxAmmo; s.state = 'idle'; s.reloadTriggered = false; }
      return;
    }

    if (s.ammo <= 0) {
      // Knife melee fallback
      if (s.state === 'knife' && now - s.shootAt > 300) s.state = 'idle';
      if (s.state === 'shoot') s.state = 'idle';
      const meleeTgt = (gs.isHumanWave ? gs.humans : gs.zombies).find(z => z.state !== 'dead' && z.lane === s.lane && Math.abs(z.x - s.x) < 52 && z.x > WX);
      if (meleeTgt) {
        s.facing = meleeTgt.x > s.x ? 1 : -1;
        s.knifeTimer = (s.knifeTimer || 0) + dt;
        const ms = meleeStats(s);
        if (s.knifeTimer >= ms.rate) {
          s.knifeTimer = 0; s.state = 'knife'; s.shootAt = now;
          meleeTgt.hp -= ms.dmg; meleeTgt.hurtTimer = 220;
          gs.soundQ.push({ t: ms.type === 'knife' || ms.type === 'machete' ? 'slash' : 'hit', now, x: s.x });
          gs.effects.push({ type: 'slash', x: meleeTgt.x + s.facing * 10, y: laneY(meleeTgt.lane) - 28, at: now, dur: 230 });
          gs.effects.push({ type: 'txt', x: meleeTgt.x, y: laneY(meleeTgt.lane) - 58, v: `-${ms.dmg}`, col: '#ffcc44', at: now, dur: 600 });
          const broke = wearMelee(s);
          if (broke) gs.effects.push({ type: 'txt', x: s.x, y: laneY(s.lane) - 84, v: t('{w} BROKE', { w: t(MELEE[broke].name).toUpperCase() }), col: C.dng, at: now, dur: 1200 });
          if (meleeTgt.hp <= 0) killTarget(gs, meleeTgt, now, s);
        }
      } else { s.knifeTimer = 0; }
      return;
    }

    if (now - s.lastShot >= w.rate) {
      s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.ammo--;
      gs.soundQ.push({ t: 'shot', w: s.weapon, x: s.x }); gs.soundQ.push({ t: 'shell' });
      // Tracers leave from the muzzle of the shouldered weapon.
      const by0 = laneY(s.lane) - Math.round(42 * laneSc(s.lane));
      const by1 = laneY(tgt.lane) - Math.round(24 * laneSc(tgt.lane));
      const bxStart = s.x + s.facing * 38 * laneSc(s.lane);
      for (let p = 0; p < (w.pel || 1); p++) {
        const sp2 = (Math.random() - 0.5) * w.sp * 2;
        gs.bullets.push({
          id: uid(),
          x: bxStart, y: by0,
          dy: (by1 - by0) / Math.max(1, wRangeG / w.spd),
          dx: s.facing * w.spd * Math.cos(sp2),
          dmg: w.pel ? w.dmg / w.pel : w.dmg,
          life: Math.ceil(wRangeG / w.spd * 1.15),
          targetLane: tgt.lane,
          shooterId: s.id,
        });
      }
      gs.effects.push({ type: 'shell', x: s.x - s.facing * 8, y: by0, vx: -s.facing * (1.4 + Math.random()), at: now, dur: 780 });
      if (s.ammo === 0) {
        const refill = Math.min(s.maxAmmo, gs.resources.ammo);
        if (refill > 0) {
          s.state = 'reload'; s.reloadStart = now; gs.resources.ammo -= refill; s.ammo = refill;
          s.knifeReady = false;
          if (!s.reloadTriggered) { s.reloadTriggered = true; gs.soundQ.push({ t: 'reload', w: s.weapon, dur: effRl(gs, s, w) / (gs.speed || 1) }); pushRadio(gs, 'reload', { speaker: s }); }
          gs.effects.push({ type: 'txt', x: s.x, y: laneY(s.lane) - 80, v: t('RELOAD!'), col: C.wrn, at: now, dur: 800 });
        } else {
          // Empty stash too — soldier holsters firearm and the knife
          // becomes their permanent ready-stance until ammo arrives.
          s.knifeReady = true;
          gs.effects.push({ type: 'txt', x: s.x, y: laneY(s.lane) - 80, v: t('DRY!'), col: C.dng, at: now, dur: 900 });
        }
      }
    } else if (now - s.lastShot > w.rate * 0.4) s.state = 'idle';
  });

  // ── BULLETS ──────────────────────────────────────────────────
  gs.bullets = gs.bullets.filter(b => {
    b.x += b.dx; b.y += b.dy; b.life--;
    // Despawn at the WORLD edge, not the legacy viewport. After the
    // WORLD_W widening, soldiers who advance forward fire bullets
    // that used to vanish at x>CW (=900) before reaching the zombies
    // still walking in from the spawn band (x≈2000).
    if (b.life <= 0 || b.x < 0 || b.x > WORLD_W) return false;

    if (b.hostile) {
      // Acid lobbed at the wall itself.
      if (b.wallHit && b.x <= WX + 40) {
        gs.baseHp -= b.dmg; gs.shakeTimer = Math.max(gs.shakeTimer, 160);
        gs.soundQ.push({ t: 'bhit' });
        gs.effects.push({ type: 'txt', x: WX / 2, y: GY - 120, v: `-${b.dmg}`, col: '#8ad858', at: now, dur: 800 });
        return false;
      }
      // Hostile bullet → check soldier collisions (any soldier in target lane).
      const hit = gs.soldiers.find(s =>
        s.state !== 'dead' && !s.onExpedition && !s.onRoof &&
        s.lane === b.targetLane && Math.abs(s.x - b.x) < 18
      );
      if (hit) {
        hit.hp -= b.dmg; hit.hurtTimer = 320;
        gs.soundQ.push({ t: 'hit', now, x: b.x });
        gs.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
        gs.effects.push({ type: 'txt', x: hit.x, y: laneY(hit.lane) - 60, v: `-${Math.round(b.dmg)}`, col: C.dng, at: now, dur: 720 });
        if (hit.hp <= 0) { hit.hp = 0; hit.state = 'dead'; recordDeath(gs, hit); }
        return false;
      }
      return true;
    }

    // Friendly bullet → check enemy collisions
    const enemyList = gs.isHumanWave ? gs.humans : gs.zombies;
    const hit = enemyList.find(z =>
      z.state !== 'dead' && Math.abs(z.x - b.x) < 20 && z.lane === b.targetLane
    );
    if (hit) {
      // Apply Combat Drills (all soldiers) and AP Rounds (rifle vs tank).
      const shooter = b.shooterId ? gs.soldiers.find(x => x.id === b.shooterId) : null;
      let dmg = b.dmg * researchMul(gs, 'soldierDamageMul') * perkMul(shooter, 'damageMul');
      if (shooter && wbase(shooter.weapon) === 'rifle' && !gs.isHumanWave && hit.type === 'tank') {
        dmg *= researchMul(gs, 'rifleVsTankMul');
      }
      hit.hp -= dmg; hit.hurtTimer = 210;
      gs.soundQ.push({ t: 'hit', now, x: b.x });
      gs.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 7 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3.5, vy: -Math.random() * 2.5 - 0.5, r: 1.5 + Math.random() * 3 })), at: now, dur: 680 });
      gs.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      gs.effects.push({ type: 'txt', x: hit.x, y: laneY(hit.lane) - 60, v: `-${Math.round(dmg)}`, col: C.bld, at: now, dur: 720 });
      if (hit.hp <= 0) {
        killTarget(gs, hit, now, shooter);
      }
      return false;
    }
    return true;
  });

  // Dead body cap (zombies)
  const dead = gs.zombies.filter(z => z.state === 'dead');
  if (dead.length > 60) {
    const rm = new Set(dead.slice(0, dead.length - 60).map(z => z.id));
    gs.zombies = gs.zombies.filter(z => !rm.has(z.id));
  }
  // Dead body cap (humans)
  const deadH = gs.humans.filter(h => h.state === 'dead');
  if (deadH.length > 30) {
    const rm = new Set(deadH.slice(0, deadH.length - 30).map(h => h.id));
    gs.humans = gs.humans.filter(h => !rm.has(h.id));
  }
  gs.effects = gs.effects.filter(e => now - e.at < e.dur);

  // Wave clear
  if (!gs.waveComplete) {
    const liveZ = gs.zombies.filter(z => z.state !== 'dead').length;
    const liveH = gs.humans.filter(h => h.state !== 'dead').length;
    const live = gs.isHumanWave ? liveH : liveZ;
    // A survivor still running for the gate holds the wave open.
    const ev = gs.waveEvent;
    const runner = ev && ev.type === 'survivor' && ev.state === 'active';
    if (gs.zombiesSpawned > 0 && gs.spawnQueue.length === 0 && live === 0 && !runner) {
      settleSiegeEvent(gs, now);
      gs.waveComplete = true; gs.waveClearAt = now; gs.soundQ.push({ t: 'wclr' });
      gs.lastWaveReport = waveReport(gs);
    }
  }
  if (gs.waveComplete && now - gs.waveClearAt > 3000) {
    gs.waveComplete = false; gs.waveClearAt = null; gs.wave++; gs.day++;
    gs.soldiers.forEach(s => { if (s.state !== 'dead' && !s.onExpedition) addXp(s, WAVE_XP); });
    cityDayTick(gs);
    compactDayTick(gs);
    // Research tick: 1 wave-clear = 1 progress on the active node.
    // On completion, apply persistent effects (Reinforced Walls bumps
    // baseMaxHp + heals up to the new cap immediately).
    if (gs.research && gs.research.activeId) {
      gs.research.progress = (gs.research.progress || 0) + (hasUnlock(gs, 'lab') ? 2 : 1);
      const node = RESEARCHES.find(r => r.id === gs.research.activeId);
      if (node && gs.research.progress >= node.waves) {
        const completed = Array.isArray(gs.research.completed) ? gs.research.completed : [];
        if (!completed.includes(node.id)) completed.push(node.id);
        gs.research = { activeId: null, progress: 0, completed };
        if (node.effects && node.effects.baseHpBonus) {
          gs.baseMaxHp += node.effects.baseHpBonus;
          gs.baseHp = Math.min(gs.baseMaxHp, gs.baseHp + node.effects.baseHpBonus);
        }
      }
    }
    // Wave 30 was the final stand at Fort Omega. Surviving means
    // Central Command's vaccine sample is ready to deliver — flip to
    // the briefing phase. The React layer routes this to the briefing
    // panel, then to the playable vaccine campaign (3 scenarios:
    // highway → hospital → rooftop evac), then to the victory screen
    // with the achieved ending tier.
    if (gs.wave > BALANCE.maxWaves) {
      gs.phase = 'vaccine-briefing';
      return;
    }
    gs.phase = 'management';
    gs.boss = null;
    // Roll the next wave's condition now so the command center can
    // brief it (and the player can prepare).
    gs.nextWaveMod = rollWaveMod(gs.wave, isHumanWaveNumber(gs.wave), gs.waveMod, BALANCE.maxWaves);
    // Intermediate story-beat transmissions interleave with the wave
    // pacing. Trigger once per wave (transmissionsDone is persisted)
    // so reloading a save doesn't replay the cinematic.
    if (!Array.isArray(gs.transmissionsDone)) gs.transmissionsDone = [];
    if (TRANSMISSION_WAVES.includes(gs.wave) && !gs.transmissionsDone.includes(gs.wave)) {
      gs.pendingTransmission = gs.wave;
    }
    gs.resources.ammo = Math.min(999, gs.resources.ammo + waveClearAmmoFor(gs.wave - 1));
    gs.resources.sniperAmmo = Math.min(99, (gs.resources.sniperAmmo || 0) + BALANCE.waveClearSniperAmmo);
    gs.resources.food = Math.min(999, gs.resources.food + BALANCE.waveClearFood);
    // Barricades that survived the wave get patched back up to full HP
    // for free (squad maintenance between waves). Destroyed ones stay
    // gone — the player has to rebuild manually.
    if (Array.isArray(gs.barricades)) {
      gs.barricades.forEach(b => { if (b.hp > 0) b.hp = b.maxHp; });
    }
    // Daily food consumption — every soldier (active + reserve) eats
    // foodPerPersonPerDay food. If we don't have enough, hungry people
    // lose starveDmg HP each. Skipped after wave 1 (the tutorial wave).
    if (gs.wave >= 2) {
      const eaters = gs.soldiers.filter(s => s.state !== 'dead').length
                   + (gs.reserve || []).length;
      const need = eaters * BALANCE.foodPerPersonPerDay;
      const have = gs.resources.food | 0;
      if (have >= need) {
        gs.resources.food = have - need;
        gs.lastFoodReport = { ate: eaters, hungry: 0, dmg: 0, day: gs.day };
      } else {
        const fed = Math.floor(have / BALANCE.foodPerPersonPerDay);
        gs.resources.food = have - fed * BALANCE.foodPerPersonPerDay;
        const hungry = eaters - fed;
        // Starvation hits active soldiers first (lower HP first so the
        // dying are pushed under fastest). Reserve members lose HP in
        // their stashed records — they'll re-enter the active roster
        // weaker.
        const actives = gs.soldiers
          .filter(s => s.state !== 'dead')
          .sort((a, b) => a.hp - b.hp);
        const reserves = gs.reserve || [];
        let toStarve = hungry;
        for (const s of actives) {
          if (toStarve <= 0) break;
          s.hp = Math.max(1, s.hp - BALANCE.starveDmg);
          toStarve--;
        }
        for (const r of reserves) {
          if (toStarve <= 0) break;
          r.hp = Math.max(1, (r.hp ?? 100) - BALANCE.starveDmg);
          toStarve--;
        }
        gs.lastFoodReport = { ate: fed, hungry, dmg: BALANCE.starveDmg, day: gs.day };
      }
    } else {
      gs.lastFoodReport = null;
    }
    // Small belt-fed refill so a built turret isn't permanently dry.
    if ((gs.turrets || []).length > 0) {
      gs.resources.turretAmmo = Math.min(999, (gs.resources.turretAmmo || 0) + 5);
    }
    gs.expeditionsToday = 0; // new day, sortie counter resets
    // Delta climbs back to roof if alive and we have sniper ammo
    gs.soldiers.forEach(s => {
      if (s.name === 'Delta' && s.state !== 'dead' && !s.onRoof && (gs.resources.sniperAmmo || 0) > 0) {
        s.onRoof = true; s.weapon = 'sniper'; s.maxAmmo = WPN.sniper.ammo;
        const r = Math.min(WPN.sniper.ammo, gs.resources.sniperAmmo);
        gs.resources.sniperAmmo -= r; s.ammo = r;
        s.x = WX - 40; s.lane = 0; s.state = 'idle'; s.facing = 1;
      }
    });
    // Auto-promote from reserve: refill the active squad up to the cap.
    if (Array.isArray(gs.reserve) && gs.reserve.length > 0) {
      while (
        gs.reserve.length > 0 &&
        gs.soldiers.filter(s => s.state !== 'dead' && !s.onExpedition).length < BALANCE.maxActiveSoldiers
      ) {
        const r = gs.reserve.shift();
        const ns = mkSoldier(
          r.name, r.weapon, 270, r.hp ?? undefined,
          Math.floor(Math.random() * 3), !!r.civilian, false, reserveOpts(r),
        );
        ns.ammo = 0;
        gs.soldiers.push(ns);
      }
    }
  }
  if (gs.phase === 'siege' && (gs.baseHp <= 0 || gs.soldiers.filter(s => !s.onExpedition).every(s => s.state === 'dead'))) {
    gs.phase = 'gameover';
  }
}

// Helper: target died — credit shooter, award score, and drop ammo if armed.
// Only gunmen drop ammo (knifemen have no firearm to scavenge).
function killTarget(gs, target, now, shooter) {
  target.hp = 0; target.state = 'dead'; target.deadAt = now;
  if (shooter) {
    const ups = addXp(shooter, target.boss ? BOSS_XP : (KILL_XP[target.type] || 4));
    if (ups) {
      gs.effects.push({ type: 'txt', x: shooter.x, y: (shooter.onRoof ? GY - 200 : laneY(shooter.lane) - 92), v: t('★ {name} LV {lv}', { name: shooter.name.toUpperCase(), lv: shooter.level }), col: '#ffd54a', at: now, dur: 1800 });
      gs.soundQ.push({ t: 'pickup' });
    }
  }
  // Random kill chatter (8% chance, throttled by pushRadio cooldown).
  if (shooter) maybeKillChatter(gs, shooter);
  if (ZTP[target.type]) {
    gs.soundQ.push({ t: 'zdie', zt: target.type, x: target.x });
    gs.kills++;
    gs.score += target.boss ? 400 : ({ tank: 50, brute: 120, spitter: 30, runner: 20 }[target.type] || 10);
    if (target.boss) {
      // Mini-boss bounty: salvage off the carcass.
      gs.boss = null; gs.shakeTimer = 600;
      gs.resources.materials = Math.min(999, (gs.resources.materials || 0) + 15);
      gs.resources.ammo = Math.min(999, gs.resources.ammo + 30);
      gs.effects.push({ type: 'txt', x: target.x, y: laneY(target.lane) - 90, v: t('+15 🔧  +30 AMMO'), col: '#ffd54a', at: now, dur: 1800 });
      pushRadio(gs, 'kill', { line: '{boss} is down!', params: { boss: t(target.bossName) }, cooldown: 0, speaker: shooter || undefined });
    }
  } else {
    // Human
    gs.soundQ.push({ t: 'zdie', zt: 'walker', x: target.x });
    gs.kills++;
    gs.score += target.type === 'gunman' ? 25 : 15;
    if (target.type !== 'gunman') {
      if (shooter) shooter.kills = (shooter.kills || 0) + 1;
      return;
    }
    const drop = rng(HUMAN_AMMO_DROP[0], HUMAN_AMMO_DROP[1]);
    gs.resources.ammo = Math.min(999, gs.resources.ammo + drop);
    gs.effects.push({
      type: 'txt',
      x: target.x, y: laneY(target.lane) - 70,
      v: t('+{n} AMMO', { n: drop }), col: '#ffd54a',
      at: now, dur: 1200,
    });
  }
  if (shooter) shooter.kills = (shooter.kills || 0) + 1;
}

// Spitter in the siege: walks in until a soldier in its lane (or the
// wall) is within acid range, then holds position and lobs acid.
function spitterTick(gs, z, now, dt) {
  const meta = z.z;
  const sol = gs.soldiers.find(s => s.state !== 'dead' && !s.onExpedition && !s.onRoof && s.lane === z.lane
    && s.x < z.x && z.x - s.x <= meta.spitRange);
  const atWall = !sol && z.x - WX <= meta.spitRange * 0.85;
  if (!sol && !atWall) {
    z.state = 'walk'; z.facing = -1;
    z.x += z.spd * z.facing * (dt / 16);
    return;
  }
  z.state = 'attack'; z.facing = -1;
  z.atkTimer += dt;
  if (z.atkTimer < (z._spitRate || meta.spitRate)) return;
  z.atkTimer = 0;
  const tx = sol ? sol.x : WX + 20;
  const dist = Math.max(40, z.x - tx);
  const y0 = laneY(z.lane) - Math.round(30 * laneSc(z.lane));
  const y1 = sol ? laneY(sol.lane) - Math.round(30 * laneSc(sol.lane)) : GY - 120;
  const steps = dist / meta.spitSpd;
  gs.bullets.push({
    id: uid(), x: z.x - 14, y: y0,
    dx: -meta.spitSpd, dy: (y1 - y0) / steps,
    dmg: z._spitDmg || meta.dmg, life: Math.ceil(steps * 1.3),
    targetLane: z.lane, hostile: true, spit: true, wallHit: !sol,
  });
  gs.soundQ.push({ t: 'spit', x: z.x });
}
