import { C, CH, uid, rng } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { ZTP } from '../data/zombies.js';
import { MISSION_W, MISSION_VIEW, MGY, objIcons } from '../data/expeditions.js';
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
    : dest.risk === 'MED' ? ['ammo', 'ammo', 'materials', 'sniperAmmo']
    : ['ammo', 'medicine', 'food', 'materials', 'sniperAmmo'];
  const pkCount = dest.risk === 'LOW' ? 4 : dest.risk === 'MED' ? 5 : 7;
  for (let i = 0; i < pkCount; i++) {
    const x = 300 + Math.floor(MISSION_W / (pkCount + 1)) * (i + 1) + rng(-60, 60);
    const type = pkOptions[Math.floor(Math.random() * pkOptions.length)];
    const value = type === 'medicine' ? rng(4, 8)
      : type === 'ammo' ? rng(8, 15)
      : type === 'food' ? rng(5, 10)
      : type === 'sniperAmmo' ? rng(2, 4)
      : rng(3, 6);
    pickups.push({ id: uid(), x, type, value, collected: false });
  }
  const civChance = dest.risk === 'HIGH' ? 1.0 : dest.risk === 'MED' ? 0.5 : 0;
  if (Math.random() < civChance) pickups.push({ id: uid(), x: MISSION_W - 200, type: 'civilian', value: 1, collected: false });

  for (let i = 0; i < 6; i++) {
    obstacles.push({ x: 200 + i * MISSION_W / 7 + rng(-50, 50), type: Math.random() < 0.5 ? 'car' : 'crate' });
  }

  const msol = {
    id: uid(), origId: soldier.id, name: soldier.name, weapon: soldier.weapon,
    x: 80, lane: 0, hp: soldier.hp, maxHp: soldier.maxHp,
    ammo: soldier.ammo > 0 ? soldier.ammo : Math.min(soldier.maxAmmo, 15),
    maxAmmo: soldier.maxAmmo,
    state: 'idle', facing: 1,
    lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0,
    walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0, reloadTriggered: false,
    onExpedition: true,
  };

  return {
    soldier: msol, origSoldier: soldier, dest,
    zombies, pickups, obstacles, bullets: [], effects: [], soundQ: [],
    cameraX: 0,
    inputLeft: false, inputRight: false, inputShoot: false,
    state: 'active',
    collected: { ammo: 0, medicine: 0, food: 0, materials: 0, sniperAmmo: 0, civilian: null },
    startedAt: 0, endedAt: 0,
  };
}

export function updateMission(m, now, dt) {
  if (m.state !== 'active') return;
  if (!m.startedAt) m.startedAt = now;
  const s = m.soldier;
  s.hurtTimer = Math.max(0, s.hurtTimer - dt);

  const moveSpd = 2.4 * (dt / 16);
  if (s.state !== 'reload' && s.state !== 'knife') {
    if (m.inputRight) { s.x += moveSpd; s.facing = 1; if (s.state === 'idle') s.state = 'walk'; }
    else if (m.inputLeft) { s.x -= moveSpd; s.facing = -1; if (s.state === 'idle') s.state = 'walk'; }
    else if (s.state === 'walk') s.state = 'idle';
  }
  s.x = Math.max(40, Math.min(MISSION_W - 40, s.x));
  m.cameraX = Math.max(0, Math.min(MISSION_W - MISSION_VIEW, s.x - MISSION_VIEW / 2));

  m.zombies.forEach(z => {
    if (!z.activated && Math.abs(z.x - s.x) < 400) {
      z.activated = true; m.soundQ.push({ t: 'groan', now, zt: z.type });
    }
  });

  m.zombies.forEach(z => {
    if (z.state === 'dead' || !z.activated) return;
    z.hurtTimer = Math.max(0, z.hurtTimer - dt);
    const dx = s.x - z.x;
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
        s.hp -= z.z.dmg; s.hurtTimer = 320;
        m.soundQ.push({ t: 'zatk' });
        if (s.hp <= 0) { s.hp = 0; m.state = 'lost'; m.endedAt = now; }
      }
    }
  });

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
        if (meleeTgt.hp <= 0) { meleeTgt.hp = 0; meleeTgt.state = 'dead'; meleeTgt.deadAt = now; m.soundQ.push({ t: 'zdie', zt: meleeTgt.type }); }
      }
    } else { s.knifeTimer = 0; if (s.state === 'knife' && now - s.shootAt > 300) s.state = 'idle'; }
  }

  m.bullets = m.bullets.filter(b => {
    b.x += b.dx; b.y += b.dy; b.life--;
    if (b.life <= 0 || b.x < 0 || b.x > MISSION_W) return false;
    const hit = m.zombies.find(z => z.state !== 'dead' && Math.abs(z.x - b.x) < 20);
    if (hit) {
      hit.hp -= b.dmg; hit.hurtTimer = 210; m.soundQ.push({ t: 'hit', now });
      m.effects.push({ type: 'blood', x: b.x, y: b.y, drops: Array.from({ length: 6 }, () => ({ x: 0, y: 0, vx: (Math.random() - 0.5) * 3.5, vy: -Math.random() * 2.5 - 0.5, r: 1.5 + Math.random() * 3 })), at: now, dur: 600 });
      m.effects.push({ type: 'hit', x: b.x, y: b.y, at: now, dur: 200 });
      m.effects.push({ type: 'txt', x: hit.x, y: MGY - 60, v: `-${Math.round(b.dmg)}`, col: C.bld, at: now, dur: 680 });
      if (hit.hp <= 0) { hit.hp = 0; hit.state = 'dead'; hit.deadAt = now; m.soundQ.push({ t: 'zdie', zt: hit.type }); }
      return false;
    }
    return true;
  });

  m.pickups.forEach(p => {
    if (p.collected) return;
    if (Math.abs(p.x - s.x) < 28) {
      p.collected = true;
      if (p.type === 'civilian') { m.collected.civilian = true; m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: 'CIVILIAN!', col: '#88ddff', at: now, dur: 1000 }); }
      else { m.collected[p.type] += p.value; m.effects.push({ type: 'txt', x: p.x, y: MGY - 70, v: `+${p.value} ${p.type}`, col: C.acc, at: now, dur: 900 }); }
    }
  });

  m.effects = m.effects.filter(e => now - e.at < e.dur);
  if (s.x >= MISSION_W - 50) { m.state = 'won'; m.endedAt = now; }
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

  const sCopy = { ...m.soldier, lane: 0, onExpedition: false, state: m.soldier.state };
  dSoldier(ctx, sCopy, now);

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
