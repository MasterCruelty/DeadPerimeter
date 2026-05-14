import { C, CH, uid, rng } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MISSION_VIEW, MGY, objIcons } from '../data/expeditions.js';
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
      : dest.risk === 'MED' ? ['walker', 'walker', 'runner']
      : ['walker', 'runner', 'runner', 'tank'];
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

  for (let i = 0; i < 6; i++) {
    obstacles.push({ x: 200 + i * MISSION_W / 7 + rng(-50, 50), type: Math.random() < 0.5 ? 'car' : 'crate' });
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
    dest,
    zombies, pickups, obstacles, bullets: [], effects: [], soundQ: [],
    cameraX: 0,
    inputLeft: false, inputRight: false, inputShoot: false,
    state: 'active',
    // Activation tracking for the goal kill-ratio gate
    activatedCount: 0, killedCount: 0, _lastGoalHint: 0,
    collected: { ammo: 0, medicine: 0, food: 0, materials: 0, sniperAmmo: 0, turretAmmo: 0, civilian: null },
    startedAt: 0, endedAt: 0,
  };
}

// Returns every living party member (lead + alive followers).
function aliveParty(m) {
  const out = m.soldier.hp > 0 ? [m.soldier] : [];
  (m.followers || []).forEach(f => { if (f.hp > 0 && f.state !== 'dead') out.push(f); });
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

  // Lead movement (player-controlled)
  const moveSpd = 2.4 * (dt / 16);
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

  // Activation now considers any party member as the "trigger"
  const party = aliveParty(m);
  m.zombies.forEach(z => {
    if (z.activated) return;
    const closest = party.reduce((d, p) => Math.min(d, Math.abs(z.x - p.x)), Infinity);
    if (closest < BALANCE.missionActivationRange) {
      z.activated = true; m.activatedCount++;
      m.soundQ.push({ t: 'groan', now, zt: z.type });
    }
  });

  // Zombies AI: pick the closest party member as the target
  m.zombies.forEach(z => {
    if (z.state === 'dead' || !z.activated) return;
    z.hurtTimer = Math.max(0, z.hurtTimer - dt);
    // Closest living target
    const targets = aliveParty(m);
    if (targets.length === 0) { m.state = 'lost'; m.endedAt = now; return; }
    const tgt = targets.reduce((a, b) => Math.abs(a.x - z.x) < Math.abs(b.x - z.x) ? a : b);
    const dx = tgt.x - z.x;
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
          // Lead death = mission failure. Follower death = mission continues.
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

  m.bullets = m.bullets.filter(b => {
    b.x += b.dx; b.y += b.dy; b.life--;
    if (b.life <= 0 || b.x < 0 || b.x > MISSION_W) return false;
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
  if (s.x >= MISSION_W - 50) {
    const need = Math.ceil(m.activatedCount * BALANCE.missionGoalKillRatio);
    if (m.killedCount >= need) {
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

export function dMissionWorld(ctx, m, now) {
  ctx.save();
  ctx.translate(-m.cameraX, 0);

  const sg = ctx.createLinearGradient(0, 0, 0, MGY - 80);
  sg.addColorStop(0, C.sky1); sg.addColorStop(1, C.sky2);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, MISSION_W, MGY - 80);

  for (let i = 0; i < 60; i++) {
    const sx = ((i * 173 + m.cameraX * 0.2) % MISSION_W);
    const sy = (i * 97 + 17) % (MGY - 100);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 4) * 0.18})`;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }

  const bldCount = 14;
  for (let i = 0; i < bldCount; i++) {
    const bx = (i * MISSION_W / bldCount) + 50 + (i % 3) * 30;
    const bw = 50 + (i * 7) % 55;
    const bh = 80 + (i * 23) % 150;
    ctx.fillStyle = '#080a10'; ctx.fillRect(bx, MGY - 80 - bh, bw, bh);
    ctx.fillStyle = '#0d1828';
    for (let wx = bx + 8; wx < bx + bw - 5; wx += 14)
      for (let wy = MGY - 80 - bh + 10; wy < MGY - 90; wy += 18)
        if (Math.sin((bx + wx) * 0.1 + wy * 0.07) > 0.2) ctx.fillRect(wx, wy, 8, 10);
  }

  const gg = ctx.createLinearGradient(0, MGY, 0, CH);
  gg.addColorStop(0, C.g1); gg.addColorStop(1, C.g2);
  ctx.fillStyle = gg; ctx.fillRect(0, MGY, MISSION_W, CH - MGY);
  ctx.strokeStyle = '#2a2716'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, MGY); ctx.lineTo(MISSION_W, MGY); ctx.stroke();

  m.obstacles.forEach(o => {
    if (o.type === 'car') {
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(o.x - 22, MGY - 22, 44, 18);
      ctx.fillStyle = '#1a1410'; ctx.fillRect(o.x - 18, MGY - 32, 32, 12);
      ctx.fillStyle = '#101010'; ctx.beginPath(); ctx.arc(o.x - 14, MGY - 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(o.x + 14, MGY - 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,140,40,0.15)'; ctx.beginPath(); ctx.arc(o.x, MGY - 26, 18, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#5a3e18'; ctx.fillRect(o.x - 12, MGY - 18, 24, 18);
      ctx.fillStyle = '#3e2810'; ctx.fillRect(o.x - 12, MGY - 12, 24, 2); ctx.fillRect(o.x - 12, MGY - 6, 24, 2);
    }
  });

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

  // Draw followers first so the lead reads as in front of them.
  (m.followers || []).forEach(f => {
    const fc = { ...f, lane: 0, onExpedition: false, state: f.state };
    dSoldier(ctx, fc, now);
  });

  const sCopy = { ...m.soldier, lane: 0, onExpedition: false, state: m.soldier.state };
  dSoldier(ctx, sCopy, now, true); // pass selection ring to mark the lead

  m.effects.forEach(e => dFx(ctx, e, now));
  m.bullets.forEach(b => dBlt(ctx, b));

  const goalX = MISSION_W - 30;
  const pulse = 0.6 + 0.4 * Math.sin(now / 300);
  ctx.fillStyle = `rgba(114,188,64,${pulse * 0.4})`;
  ctx.fillRect(goalX - 3, MGY - 120, 6, 120);
  ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace';
  ctx.fillText('★ GOAL ★', goalX - 26, MGY - 128);

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

  ctx.fillStyle = 'rgba(120,120,80,0.5)'; ctx.font = '9px monospace';
  ctx.fillText('← → MOVE   SPACE/CLICK FIRE   REACH GOAL', 12, CH - 12);

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
