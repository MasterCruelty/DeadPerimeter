import { C, CW, GY, WX, uid, rng, laneY, laneSc } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { HUMAN_AMMO_DROP } from '../data/humans.js';
import { BALANCE } from '../data/difficulty.js';
import { mkZombie } from '../entities/zombie.js';
import { mkHuman } from '../entities/human.js';
import { mkSoldier } from '../entities/soldier.js';
import { pushRadio } from '../audio/radio.js';

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

export function update(gs, now, dt) {
  if (gs.phase !== 'siege') return;
  gs.waveTime += dt;
  gs.shakeTimer = Math.max(0, gs.shakeTimer - dt);

  // ── SPAWN ────────────────────────────────────────────────────
  while (gs.spawnQueue.length && gs.spawnQueue[0].at <= gs.waveTime) {
    const spawn = gs.spawnQueue.shift();
    if (gs.isHumanWave) {
      gs.humans.push(mkHuman(spawn.type));
    } else {
      gs.zombies.push(mkZombie(spawn.type));
    }
    gs.zombiesSpawned++;
  }

  // Ambient groan (zombies only)
  const living = gs.zombies.filter(z => z.state !== 'dead');
  if (living.length > 0 && Math.random() < 0.004) {
    const rz = living[Math.floor(Math.random() * living.length)];
    gs.soundQ.push({ t: 'groan', now, zt: rz.type });
  }

  // ── ZOMBIES ──────────────────────────────────────────────────
  gs.zombies.forEach(z => {
    if (z.state === 'dead') return;
    z.hurtTimer = Math.max(0, z.hurtTimer - dt);
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
      if (z.atkTimer > 1100) {
        z.atkTimer = 0;
        if (z.targetBarId) {
          const bar = gs.barricades.find(b => b.id === z.targetBarId);
          if (bar && Math.abs(bar.x - z.x) < 30) {
            bar.hp -= z.z.dmg; gs.soundQ.push({ t: 'bhit' });
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
            sol.hp -= dmg; sol.hurtTimer = 360; gs.soundQ.push({ t: 'zatk' });
            if (sol.hp <= 0) { sol.hp = 0; sol.state = 'dead'; z.targetSolId = null; z.state = 'walk'; }
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
          gs.soundQ.push({ t: 'shot', w: 'pistol' });
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
              bar.hp -= meta.dmg; gs.soundQ.push({ t: 'bhit' });
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
              sol.hp -= dmg; sol.hurtTimer = 360; gs.soundQ.push({ t: 'zatk' });
              if (sol.hp > 0) hurtCallout(gs, sol);
              gs.effects.push({ type: 'slash', x: sol.x - h.facing * 10, y: laneY(sol.lane) - 28, at: now, dur: 230 });
              if (sol.hp <= 0) { sol.hp = 0; sol.state = 'dead'; h.targetSolId = null; h.state = 'walk'; }
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
    const tgt = pool
      .filter(e => e.state !== 'dead' && e.x > WX && Math.abs(e.x - t.x) <= BALANCE.turretRange)
      .sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))[0];
    if (!tgt) return;
    t.lastShot = now;
    gs.resources.turretAmmo = Math.max(0, gs.resources.turretAmmo - 1);
    gs.soundQ.push({ t: 'shot', w: 'rifle' });
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

    // Rooftop sniper branch
    if (s.onRoof) {
      const w = WPN[s.weapon];
      s.recoil = Math.max(0, (s.recoil || 0) - dt);
      if (s.state === 'reload') {
        if (now - s.reloadStart >= w.rl) { s.ammo = s.maxAmmo; s.state = 'idle'; s.reloadTriggered = false; }
        return;
      }
      if (s.ammo <= 0) {
        const refill = Math.min(s.maxAmmo, gs.resources.sniperAmmo || 0);
        if (refill > 0) {
          gs.resources.sniperAmmo -= refill;
          s.state = 'reload'; s.reloadStart = now; s.ammo = refill;
          if (!s.reloadTriggered) { s.reloadTriggered = true; gs.soundQ.push({ t: 'reload', w: s.weapon, dur: w.rl }); pushRadio(gs, 'reload', { speaker: s }); }
          gs.effects.push({ type: 'txt', x: s.x + 30, y: GY - 160, v: 'RELOAD!', col: C.wrn, at: now, dur: 800 });
        } else {
          // Out of sniper ammo — descend
          s.onRoof = false;
          s.lane = 1;
          s.x = WX + 30; s.destX = WX + 90; s.state = 'walk'; s.facing = 1;
          s.weapon = 'pistol'; s.maxAmmo = WPN.pistol.ammo;
          s.ammo = Math.min(WPN.pistol.ammo, gs.resources.ammo);
          gs.resources.ammo = Math.max(0, gs.resources.ammo - s.ammo);
          gs.effects.push({ type: 'txt', x: WX / 2, y: GY - 150, v: 'DESCENDING!', col: C.dng, at: now, dur: 1400 });
        }
        return;
      }
      // Target picker: furthest zombie or human in range
      const pool = gs.isHumanWave
        ? gs.humans.filter(z => z.state !== 'dead' && z.x > WX && z.x < CW)
        : gs.zombies.filter(z => z.state !== 'dead' && z.x > WX && z.x < CW);
      if (pool.length === 0) return;
      const tgt = pool.sort((a, b) => b.x - a.x)[0];
      s.facing = 1;
      if (now - s.lastShot >= w.rate) {
        s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.recoil = 200; s.ammo--;
        gs.soundQ.push({ t: 'shot', w: 'rifle' });
        const sx = s.x, sy = GY - 160;
        const by1 = laneY(tgt.lane) - Math.round(24 * laneSc(tgt.lane));
        const range = Math.max(40, Math.abs(tgt.x - sx));
        gs.bullets.push({
          id: uid(), x: sx + 24, y: sy - 2,
          dx: w.spd, dy: (by1 - (sy - 2)) / (range / w.spd),
          dmg: w.dmg, life: Math.ceil(range / w.spd * 1.2),
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
    const enms = gs.isHumanWave
      ? gs.humans.filter(z => z.state !== 'dead' && Math.abs(z.x - s.x) <= w.range && z.x > WX)
      : gs.zombies.filter(z => z.state !== 'dead' && Math.abs(z.x - s.x) <= w.range && z.x > WX);
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
      if (now - s.reloadStart >= w.rl) { s.ammo = s.maxAmmo; s.state = 'idle'; s.reloadTriggered = false; }
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
        if (s.knifeTimer >= 650) {
          s.knifeTimer = 0; s.state = 'knife'; s.shootAt = now;
          meleeTgt.hp -= 10; meleeTgt.hurtTimer = 220;
          gs.soundQ.push({ t: 'zatk' });
          gs.effects.push({ type: 'slash', x: meleeTgt.x + s.facing * 10, y: laneY(meleeTgt.lane) - 28, at: now, dur: 230 });
          gs.effects.push({ type: 'txt', x: meleeTgt.x, y: laneY(meleeTgt.lane) - 58, v: '-10', col: '#ffcc44', at: now, dur: 600 });
          if (meleeTgt.hp <= 0) killTarget(gs, meleeTgt, now, s);
        }
      } else { s.knifeTimer = 0; }
      return;
    }

    if (now - s.lastShot >= w.rate) {
      s.state = 'shoot'; s.lastShot = now; s.shootAt = now; s.ammo--;
      gs.soundQ.push({ t: 'shot', w: s.weapon }); gs.soundQ.push({ t: 'shell' });
      const by0 = laneY(s.lane) - Math.round(24 * laneSc(s.lane));
      const by1 = laneY(tgt.lane) - Math.round(24 * laneSc(tgt.lane));
      const bxStart = s.x + s.facing * 24;
      for (let p = 0; p < (w.pel || 1); p++) {
        const sp2 = (Math.random() - 0.5) * w.sp * 2;
        gs.bullets.push({
          id: uid(),
          x: bxStart, y: by0,
          dy: (by1 - by0) / Math.max(1, w.range / w.spd),
          dx: s.facing * w.spd * Math.cos(sp2),
          dmg: w.pel ? w.dmg / w.pel : w.dmg,
          life: Math.ceil(w.range / w.spd * 1.15),
          targetLane: tgt.lane,
          shooterId: s.id,
        });
      }
      gs.effects.push({ type: 'shell', x: s.x - s.facing * 8, y: by0, vx: -s.facing * (1.4 + Math.random()), at: now, dur: 780 });
      if (s.ammo === 0) {
        const refill = Math.min(s.maxAmmo, gs.resources.ammo);
        if (refill > 0) {
          s.state = 'reload'; s.reloadStart = now; gs.resources.ammo -= refill; s.ammo = refill;
          if (!s.reloadTriggered) { s.reloadTriggered = true; gs.soundQ.push({ t: 'reload', w: s.weapon, dur: w.rl }); pushRadio(gs, 'reload', { speaker: s }); }
          gs.effects.push({ type: 'txt', x: s.x, y: laneY(s.lane) - 80, v: 'RELOAD!', col: C.wrn, at: now, dur: 800 });
        } else {
          gs.effects.push({ type: 'txt', x: s.x, y: laneY(s.lane) - 80, v: 'DRY!', col: C.dng, at: now, dur: 900 });
        }
      }
    } else if (now - s.lastShot > w.rate * 0.4) s.state = 'idle';
  });

  // ── BULLETS ──────────────────────────────────────────────────
  gs.bullets = gs.bullets.filter(b => {
    b.x += b.dx; b.y += b.dy; b.life--;
    if (b.life <= 0 || b.x < 0 || b.x > CW) return false;

    if (b.hostile) {
      // Hostile bullet → check soldier collisions (any soldier in target lane).
      const hit = gs.soldiers.find(s =>
        s.state !== 'dead' && !s.onExpedition && !s.onRoof &&
        s.lane === b.targetLane && Math.abs(s.x - b.x) < 18
      );
      if (hit) {
        hit.hp -= b.dmg; hit.hurtTimer = 320;
        gs.soundQ.push({ t: 'hit', now });
        gs.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
        gs.effects.push({ type: 'txt', x: hit.x, y: laneY(hit.lane) - 60, v: `-${Math.round(b.dmg)}`, col: C.dng, at: now, dur: 720 });
        if (hit.hp <= 0) { hit.hp = 0; hit.state = 'dead'; }
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
      hit.hp -= b.dmg; hit.hurtTimer = 210;
      gs.soundQ.push({ t: 'hit', now });
      gs.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 7 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3.5, vy: -Math.random() * 2.5 - 0.5, r: 1.5 + Math.random() * 3 })), at: now, dur: 680 });
      gs.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      gs.effects.push({ type: 'txt', x: hit.x, y: laneY(hit.lane) - 60, v: `-${Math.round(b.dmg)}`, col: C.bld, at: now, dur: 720 });
      if (hit.hp <= 0) {
        const shooter = b.shooterId ? gs.soldiers.find(x => x.id === b.shooterId) : null;
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
    if (gs.zombiesSpawned > 0 && gs.spawnQueue.length === 0 && live === 0) {
      gs.waveComplete = true; gs.waveClearAt = now; gs.soundQ.push({ t: 'wclr' });
    }
  }
  if (gs.waveComplete && now - gs.waveClearAt > 3000) {
    gs.waveComplete = false; gs.waveClearAt = null; gs.wave++; gs.day++; gs.phase = 'management';
    gs.resources.ammo = Math.min(999, gs.resources.ammo + 10);
    gs.resources.food = Math.min(999, gs.resources.food + 8);
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
          Math.floor(Math.random() * 3), !!r.civilian, false, { veteran: !!r.veteran },
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
  // Random kill chatter (8% chance, throttled by pushRadio cooldown).
  if (shooter) maybeKillChatter(gs, shooter);
  if (target.type === 'walker' || target.type === 'runner' || target.type === 'tank') {
    gs.soundQ.push({ t: 'zdie', zt: target.type });
    gs.kills++;
    gs.score += target.type === 'tank' ? 50 : target.type === 'runner' ? 20 : 10;
  } else {
    // Human
    gs.soundQ.push({ t: 'zdie', zt: 'walker' });
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
      v: `+${drop} AMMO`, col: '#ffd54a',
      at: now, dur: 1200,
    });
  }
  if (shooter) shooter.kills = (shooter.kills || 0) + 1;
}
