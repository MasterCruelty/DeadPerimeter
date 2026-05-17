import { C, CW, CH, GY, WX } from '../constants.js';
import { dBase } from './base.js';
import { dSoldier } from './soldier.js';
import { dZombie } from './zombie.js';
import { ZTP } from '../data/zombies.js';

// ── Sprite-scaling helper ──────────────────────────────────────
// Re-uses an in-game sprite (dSoldier / dZombie) at an arbitrary
// screen position and zoom. Feet land at (screenX, screenFootY).
// Math: drawFn internally translate(s.x, laneY(s.lane)); for lane=0
// that's (0, GY). We pre-translate so the post-scale composition
// puts the feet exactly where we want.
function dSpriteAt(drawFn, ctx, entity, screenX, screenFootY, scale, now) {
  ctx.save();
  ctx.translate(screenX, screenFootY - GY * scale);
  ctx.scale(scale, scale);
  const e = { ...entity, x: 0, lane: 0 };
  drawFn(ctx, e, now);
  ctx.restore();
}

// Convenience entity builders for the cinematic. These are minimal
// records that satisfy dSoldier / dZombie's expectations without
// pulling in the full mkSoldier / mkZombie factories.
function mkIntroSoldier(opts = {}) {
  return {
    id: opts.id || 'i' + Math.random(), name: opts.name || 'X',
    weapon: opts.weapon || 'rifle',
    hp: opts.hp ?? 100, maxHp: 100,
    ammo: opts.ammo ?? 30, maxAmmo: 30,
    state: opts.state || 'idle',
    facing: opts.facing ?? 1,
    civilian: !!opts.civilian, bandit: !!opts.bandit, police: !!opts.police, swat: !!opts.swat,
    onRoof: false, onExpedition: false,
    walkPhase: opts.walkPhase ?? Math.random() * Math.PI * 2,
    lastShot: opts.lastShot ?? 0, reloadStart: 0, shootAt: 0, knifeTimer: 0,
    hurtTimer: 0, recoil: 0,
  };
}

function mkIntroZombie(opts = {}) {
  const type = opts.type || 'walker';
  const ztp = ZTP[type] || ZTP.walker;
  return {
    id: opts.id || 'z' + Math.random(),
    type, z: ztp,
    hp: opts.hp ?? ztp.hp, maxHp: ztp.hp,
    state: opts.state || 'walk',
    facing: opts.facing ?? -1,
    walkPhase: opts.walkPhase ?? Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0, deadAt: 0,
    activated: true,
  };
}

// Opening cinematic — storyboarded as 14 distinct shots over 50 s.
// Player feedback v2: every close-up shot should feature a character
// actively *doing* something (firing, fleeing, dying, marching) rather
// than just framing an object. New military-convoy scene bridges the
// collapse and Fort Omega.
export const INTRO_DURATION = 50000;

// ── Timeline ───────────────────────────────────────────────────
const SHOTS = [
  // ── Scene 1: pre-outbreak ─────────────────────────────────
  { from: 0,     to: 3500,  draw: 'cafeDrinker',     banner: 'normal' },
  { from: 3500,  to: 7000,  draw: 'quietStreet',     banner: 'normal' },
  // ── Scene 2: outbreak ─────────────────────────────────────
  { from: 7000,  to: 10500, draw: 'zombieBite',      banner: 'panic'  },
  { from: 10500, to: 13500, draw: 'familyFleeing',   banner: 'panic'  },
  { from: 13500, to: 16000, draw: 'streetChaos',     banner: 'panic'  },
  // ── Scene 3: police containment ───────────────────────────
  { from: 16000, to: 19500, draw: 'copFiring',       banner: 'police' },
  { from: 19500, to: 23500, draw: 'policeLine',      banner: 'police' },
  { from: 23500, to: 26500, draw: 'copDragged',      banner: 'police' },
  // ── Scene 4: collapse ─────────────────────────────────────
  { from: 26500, to: 29500, draw: 'lastDefender',    banner: 'collapse' },
  { from: 29500, to: 32000, draw: 'streetDead',      banner: 'collapse' },
  // ── NEW Scene C: military convoy marching to Fort Omega ────
  { from: 32000, to: 35500, draw: 'convoyWide',      banner: 'convoy' },
  { from: 35500, to: 38500, draw: 'convoyClose',     banner: 'convoy' },
  // ── Scene 5: Fort Omega — the last bulwark ────────────────
  { from: 38500, to: 42500, draw: 'soldierAiming',   banner: 'fortOmega' },
  { from: 42500, to: 50000, draw: 'fortWide',        banner: 'fortOmega' },
];

function findShot(t) {
  for (const s of SHOTS) if (t >= s.from && t < s.to) return s;
  return SHOTS[SHOTS.length - 1];
}

// Fade helpers
const fadeIn  = (t, dur = 0.2) => Math.min(1, Math.max(0, t / dur));
const fadeOut = (t, dur = 0.2) => Math.min(1, Math.max(0, (1 - t) / dur));
const inOut   = (t, a = 0.15, b = 0.18) => Math.min(fadeIn(t, a), fadeOut(t, b));

// ── Small drawing primitives reused across shots ───────────────
function dBackgroundBokeh(ctx, tintTop, tintBot, lightCount = 0) {
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, tintTop); g.addColorStop(1, tintBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  // Bokeh blobs (out-of-focus warm dots)
  for (let i = 0; i < lightCount; i++) {
    const bx = (i * 137 + 71) % CW;
    const by = 60 + (i * 97) % 200;
    const r  = 22 + (i % 4) * 8;
    const alpha = 0.10 + (i % 5) * 0.04;
    ctx.fillStyle = `rgba(255,200,130,${alpha})`;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
  }
}

function dLetterbox(ctx) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, 22);
  ctx.fillRect(0, CH - 22, CW, 22);
}

function dProgressBar(ctx, prog, color = 'rgba(180,200,160,0.45)') {
  ctx.fillStyle = color;
  ctx.fillRect(20, CH - 14, (CW - 40) * prog, 2);
}

function dSkipButton(ctx, intro) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(CW - 96, 28, 80, 22);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1; ctx.strokeRect(CW - 96, 28, 80, 22);
  ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('SKIP →', CW - 56, 43); ctx.textAlign = 'left';
  intro._skipBtn = { x: CW - 96, y: 28, w: 80, h: 22 };
}

function centerText(ctx, text, y, opts = {}) {
  const fontSize = opts.size || 14;
  ctx.font = `${opts.weight || 'bold'} ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  if (opts.shadow) {
    ctx.fillStyle = `rgba(0,0,0,${opts.shadow})`;
    ctx.fillText(text, CW / 2 + 1, y + 1);
  }
  ctx.fillStyle = opts.color || '#e8f0e0';
  ctx.fillText(text, CW / 2, y);
  ctx.textAlign = 'left';
}

// ── Shot drawers ───────────────────────────────────────────────

// 1.1 — Café patron checking a phone, the emergency-alert text lighting
// his face. He sets down a coffee cup and starts to rise from his seat
// (worry-into-alarm body language). Café interior bokeh behind.
function dShotCafeDrinker(ctx, t, now) {
  dBackgroundBokeh(ctx, '#0e1018', '#2a1e16', 22);
  // Café back wall + window glow
  ctx.fillStyle = '#1f1814'; ctx.fillRect(0, 0, CW, CH - 180);
  // Faint pendant lamps
  for (let lp = 80; lp < CW; lp += 180) {
    const grd = ctx.createRadialGradient(lp, 90, 4, lp, 90, 110);
    grd.addColorStop(0, 'rgba(255,210,140,0.55)');
    grd.addColorStop(1, 'rgba(255,210,140,0)');
    ctx.fillStyle = grd; ctx.fillRect(lp - 110, 0, 220, 200);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(lp - 1, 0, 2, 60);
    ctx.fillStyle = '#3a2814'; ctx.fillRect(lp - 7, 60, 14, 12);
  }
  // Table — wood plank, in the foreground
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(0, CH - 180, CW, 180);
  ctx.fillStyle = '#1f1410';
  ctx.fillRect(0, CH - 180, CW, 5);
  ctx.strokeStyle = '#2a1a12'; ctx.lineWidth = 1;
  for (let g = 0; g < 6; g++) {
    ctx.beginPath(); ctx.moveTo(0, CH - 160 + g * 24); ctx.lineTo(CW, CH - 162 + g * 24); ctx.stroke();
  }

  // The patron — seen from the side, leaning forward, looking at phone
  const px = 290, py = CH - 160;
  // Chair back peek behind
  ctx.fillStyle = '#1a1410'; ctx.fillRect(px - 80, py - 70, 30, 130);
  // Torso (sweater, dark navy)
  ctx.fillStyle = '#2a2a3a';
  ctx.beginPath();
  ctx.moveTo(px - 60, py - 30);
  ctx.lineTo(px - 30, py - 130);
  ctx.lineTo(px + 30, py - 130);
  ctx.lineTo(px + 60, py - 20);
  ctx.lineTo(px + 50, py + 60);
  ctx.lineTo(px - 50, py + 60);
  ctx.closePath(); ctx.fill();
  // Shoulder seam
  ctx.fillStyle = '#1a1a26'; ctx.fillRect(px - 38, py - 126, 70, 3);
  // Arm holding the phone (close to face)
  ctx.fillStyle = '#2a2a3a';
  // Forearm
  ctx.fillRect(px - 10, py - 120, 20, 60);
  // Wrist+hand
  ctx.fillStyle = '#bf8a6a';
  ctx.fillRect(px - 10, py - 130, 22, 14);
  // The phone — slight tilt, glowing screen
  ctx.save();
  ctx.translate(px + 2, py - 145);
  ctx.rotate(-0.15);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-22, -38, 44, 76);
  ctx.fillStyle = '#1a4ccc';
  ctx.fillRect(-20, -36, 40, 72);
  // Pulsing red alert banner on phone
  const pulse = (Math.sin(now / 220) * 0.5 + 0.5);
  ctx.fillStyle = `rgba(220,30,30,${0.55 + pulse * 0.4})`;
  ctx.fillRect(-20, -36, 40, 14);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 4px monospace'; ctx.textAlign = 'center';
  ctx.fillText('CITY ALERT', 0, -27);
  ctx.font = '3.5px monospace';
  ctx.fillText('SHELTER IN', 0, -17);
  ctx.fillText('PLACE NOW', 0, -10);
  ctx.textAlign = 'left';
  ctx.restore();
  // Face — partial profile, lit by the phone glow
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath();
  ctx.arc(px + 14, py - 152, 22, 0, Math.PI * 2);
  ctx.fill();
  // Hair (short, dark)
  ctx.fillStyle = '#2a1a14';
  ctx.beginPath();
  ctx.moveTo(px - 6, py - 168);
  ctx.lineTo(px + 24, py - 174);
  ctx.lineTo(px + 36, py - 162);
  ctx.lineTo(px + 32, py - 152);
  ctx.lineTo(px - 6, py - 156);
  ctx.closePath(); ctx.fill();
  // Eye looking at phone (worried)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(px + 10, py - 154, 4, 2);
  // Eyebrow furrowed
  ctx.fillRect(px + 8, py - 158, 8, 1.5);
  // Mouth slightly open (apprehensive)
  ctx.fillStyle = '#3a1a1a';
  ctx.fillRect(px + 16, py - 144, 6, 2);
  // Cool blue light spill on face from phone
  ctx.fillStyle = `rgba(40,80,200,${0.18 + pulse * 0.12})`;
  ctx.beginPath();
  ctx.arc(px + 18, py - 150, 26, 0, Math.PI * 2); ctx.fill();

  // The half-finished coffee mug + newspaper on the table beside him
  const mx = 700, my = CH - 110;
  // Saucer
  ctx.fillStyle = '#1a0e08';
  ctx.beginPath(); ctx.ellipse(mx, my + 28, 38, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Mug
  ctx.fillStyle = '#eeeae0'; ctx.fillRect(mx - 24, my - 30, 48, 56);
  ctx.beginPath(); ctx.ellipse(mx, my + 26, 24, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a1f12';
  ctx.beginPath(); ctx.ellipse(mx, my - 30, 24, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Handle
  ctx.strokeStyle = '#eeeae0'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(mx + 27, my - 4, 12, -Math.PI / 2.2, Math.PI / 2.2); ctx.stroke();
  // Steam
  for (let s = 0; s < 2; s++) {
    ctx.beginPath();
    const sx = mx - 6 + s * 12;
    ctx.moveTo(sx, my - 30);
    for (let i = 0; i < 8; i++) {
      const sy = my - 30 - i * 6;
      const wsx = sx + Math.sin(now / 250 + i * 0.7 + s) * 7;
      ctx.lineTo(wsx, sy);
    }
    ctx.strokeStyle = `rgba(220,220,210,${0.16 - s * 0.04})`;
    ctx.lineWidth = 2.5; ctx.stroke();
  }
  // Newspaper folded — partially visible
  const nx = 780, ny = CH - 80;
  ctx.fillStyle = '#dcd5bc';
  ctx.fillRect(nx, ny, 110, 70);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 6px monospace';
  ctx.fillText('NEW HAVEN HERALD', nx + 4, ny + 9);
  ctx.fillStyle = '#3a3328'; ctx.font = 'bold 9px monospace';
  ctx.fillText('QUARANTINE', nx + 4, ny + 24);
  ctx.fillText('EXTENDED', nx + 4, ny + 36);
  ctx.fillStyle = '#5a5040';
  for (let i = 0; i < 3; i++) ctx.fillRect(nx + 4, ny + 44 + i * 6, 100 - (i * 18) % 30, 1);
}

// 1.2 — Quiet street wide shot. Silhouettes of pedestrians and a
// parked car under warm sodium lamps.
function dShotQuietStreet(ctx, t, now) {
  // Sky
  const sg = ctx.createLinearGradient(0, 0, 0, GY - 60);
  sg.addColorStop(0, '#0a0e1a'); sg.addColorStop(1, '#2a2a35');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY - 60);

  // Distant skyline
  const sk = [40, 140, 250, 370, 480, 600, 720, 830];
  sk.forEach((sx, i) => {
    const bh = 90 + (i * 47) % 110;
    ctx.fillStyle = '#0e1218';
    ctx.fillRect(sx, GY - 60 - bh, 90, bh);
    // Random lit windows
    ctx.fillStyle = 'rgba(255,220,140,0.5)';
    for (let wy = GY - 60 - bh + 12; wy < GY - 70; wy += 18) {
      for (let wx = sx + 8; wx < sx + 82; wx += 14) {
        if (Math.sin(sx * 0.1 + wy * 0.07) > -0.2) ctx.fillRect(wx, wy, 7, 8);
      }
    }
  });

  // Street and sidewalk
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, GY - 60, CW, 60);
  ctx.fillStyle = '#262626'; ctx.fillRect(0, GY, CW, CH - GY);
  ctx.strokeStyle = '#777'; ctx.lineWidth = 1; ctx.setLineDash([14, 16]);
  ctx.beginPath(); ctx.moveTo(0, GY - 14); ctx.lineTo(CW, GY - 14); ctx.stroke();
  ctx.setLineDash([]);

  // Lamp posts with warm halos
  for (let lp = 100; lp < CW; lp += 240) {
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(lp - 1.5, GY - 130, 3, 70);
    ctx.fillRect(lp - 14, GY - 132, 16, 3);
    // Lamp halo
    const grd = ctx.createRadialGradient(lp - 7, GY - 126, 2, lp - 7, GY - 126, 80);
    grd.addColorStop(0, 'rgba(255,220,130,0.65)');
    grd.addColorStop(1, 'rgba(255,220,130,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(lp - 90, GY - 200, 180, 220);
  }

  // Parked car silhouette
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(180, GY - 32, 90, 26);
  ctx.fillRect(190, GY - 42, 70, 14);
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(200, GY - 4, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(252, GY - 4, 8, 0, Math.PI * 2); ctx.fill();
  // Tail-light glow
  ctx.fillStyle = 'rgba(255,80,40,0.8)';
  ctx.fillRect(180, GY - 22, 3, 4);

  // Pedestrians walking by — silhouettes with shifting positions
  const peds = [
    { x: (380 + now * 0.018) % (CW + 60), facing: 1 },
    { x: (520 + now * 0.022) % (CW + 60), facing: 1 },
    { x: (CW + 40) - ((now * 0.025) % (CW + 60)), facing: -1 },
  ];
  peds.forEach((p, i) => {
    const px = p.x;
    const wob = Math.sin(now / 200 + i) * 1.2;
    ctx.fillStyle = '#0a0a0a';
    // body
    ctx.fillRect(px - 4, GY - 32, 8, 24);
    // head
    ctx.beginPath(); ctx.arc(px, GY - 38, 4, 0, Math.PI * 2); ctx.fill();
    // legs
    ctx.fillRect(px - 4, GY - 8 + wob, 3, 8);
    ctx.fillRect(px + 1, GY - 8 - wob, 3, 8);
  });

  // A cat crossing the street further down
  const catX = (now / 22) % (CW + 80) - 40;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(catX, GY - 6, 14, 4);
  ctx.fillRect(catX + 10, GY - 9, 3, 3);
  ctx.fillRect(catX - 4, GY - 4, 3, 2);
}

// 2.1 — A civilian being attacked: a zombie lunging at and biting the
// shoulder/neck of a screaming woman in foreground. She pushes back at
// its face with one hand. Blood spray. Dramatic close-up.
function dShotZombieBite(ctx, t, now) {
  // Apocalyptic red sky with smoke
  const sg = ctx.createLinearGradient(0, 0, 0, CH);
  sg.addColorStop(0, '#3a0606'); sg.addColorStop(0.6, '#5a1810'); sg.addColorStop(1, '#1a0608');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  // Drifting smoke
  for (let i = 0; i < 8; i++) {
    const sx = (i * 137 + 30) % CW;
    const sy = 40 + (i * 31) % 140;
    ctx.fillStyle = `rgba(30,18,14,${0.4 + (i % 3) * 0.1})`;
    ctx.beginPath(); ctx.arc(sx, sy, 50 + (i % 3) * 14, 0, Math.PI * 2); ctx.fill();
  }
  // Burning building silhouette behind
  ctx.fillStyle = '#0a0604';
  ctx.fillRect(0, GY - 200, CW, 200);
  ctx.fillStyle = 'rgba(255,90,30,0.5)';
  for (let i = 0; i < 4; i++) {
    const fx = i * 250 + 100;
    ctx.beginPath();
    ctx.moveTo(fx - 14, GY - 200);
    ctx.lineTo(fx, GY - 220 + Math.sin(now / 80 + i) * 4);
    ctx.lineTo(fx + 14, GY - 200);
    ctx.closePath(); ctx.fill();
  }
  // Street
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(0, CH - 40, CW, 40);

  // Push-struggle animation — small back-and-forth tug
  const tug = Math.sin(now / 140) * 4;

  // The victim — woman facing right, head thrown back screaming, hair
  // flying, one arm pushing at the zombie's face.
  const vx = CW * 0.30 + tug, vy = CH * 0.55;
  // Coat / civilian clothes
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath();
  ctx.moveTo(vx - 50, vy + 130);
  ctx.lineTo(vx - 60, vy - 20);
  ctx.lineTo(vx - 40, vy - 80);
  ctx.lineTo(vx + 30, vy - 70);
  ctx.lineTo(vx + 60, vy + 20);
  ctx.lineTo(vx + 50, vy + 130);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#6a3a22';
  ctx.fillRect(vx - 56, vy - 22, 100, 4); // belt line
  // Head tilted back in scream
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath();
  ctx.arc(vx + 8, vy - 110, 32, 0, Math.PI * 2);
  ctx.fill();
  // Hair flying (long)
  ctx.fillStyle = '#2a1810';
  ctx.beginPath();
  ctx.moveTo(vx - 28, vy - 130);
  ctx.lineTo(vx - 60, vy - 110);
  ctx.lineTo(vx - 70, vy - 70);
  ctx.lineTo(vx - 50, vy - 60);
  ctx.lineTo(vx - 24, vy - 96);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a1810';
  ctx.beginPath();
  ctx.moveTo(vx - 8, vy - 138); ctx.lineTo(vx + 30, vy - 134);
  ctx.lineTo(vx + 26, vy - 100); ctx.lineTo(vx, vy - 110);
  ctx.closePath(); ctx.fill();
  // Eyes wide (white slivers)
  ctx.fillStyle = '#fff';
  ctx.fillRect(vx + 2, vy - 118, 6, 3);
  ctx.fillRect(vx + 14, vy - 118, 6, 3);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(vx + 4, vy - 117, 2, 2);
  ctx.fillRect(vx + 16, vy - 117, 2, 2);
  // Mouth wide open (screaming)
  ctx.fillStyle = '#3a0a0a';
  ctx.beginPath();
  ctx.ellipse(vx + 10, vy - 92, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(vx + 5, vy - 94, 10, 2); // teeth
  // Pushing arm extended toward zombie's face
  ctx.strokeStyle = '#bf8a6a'; ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(vx + 36, vy - 60);
  ctx.lineTo(vx + 110, vy - 100);
  ctx.stroke();
  ctx.lineCap = 'butt';
  // Sleeve
  ctx.fillStyle = '#8a5a3a';
  ctx.fillRect(vx + 30, vy - 70, 30, 24);

  // The zombie — real in-game dZombie sprite scaled up, in the
  // 'attack' state so its arms are out and it's leaning into the bite.
  // Tug animation moves it slightly toward the victim each frame.
  const zx = CW * 0.65 - tug;
  const ZSCALE = 4.5;
  const biteZ = mkIntroZombie({
    type: 'walker', facing: -1, state: 'attack',
    walkPhase: now / 240,
  });
  dSpriteAt(dZombie, ctx, biteZ, zx, CH - 50, ZSCALE, now);

  // Blood spray exploding from the bite point on her shoulder
  const bpX = vx + 30, bpY = vy - 90;
  // Pool on her coat
  ctx.fillStyle = 'rgba(120,4,4,0.85)';
  ctx.beginPath();
  ctx.ellipse(bpX, bpY, 22, 14, 0, 0, Math.PI * 2); ctx.fill();
  // Spray droplets in all directions
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.sin(now / 100) * 0.1;
    const dist = 40 + Math.abs(Math.sin(now / 60 + i)) * 30;
    const dx = bpX + Math.cos(a) * dist;
    const dy = bpY + Math.sin(a) * dist;
    const r = 2 + (i % 3);
    ctx.fillStyle = `rgba(140,5,5,${0.7 - (i % 4) * 0.1})`;
    ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.fill();
  }
  // Drip lines down her coat
  ctx.strokeStyle = 'rgba(120,4,4,0.78)'; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const lx = bpX - 14 + i * 7;
    ctx.beginPath();
    ctx.moveTo(lx, bpY + 6); ctx.lineTo(lx, bpY + 60 + (i * 7) % 30); ctx.stroke();
  }
}

// Old reach-through-glass shot, kept as a fallback if SHOTS still
// references it during dev. Unused in the current SHOTS list.
function _dShotClawingHand_unused(ctx, t, now) {
  // Dark interior
  ctx.fillStyle = '#0a0608'; ctx.fillRect(0, 0, CW, CH);
  // Outside light bleeding through the broken window
  const grd = ctx.createRadialGradient(CW / 2 + 60, CH / 2, 30, CW / 2 + 60, CH / 2, 380);
  grd.addColorStop(0, 'rgba(255,160,80,0.55)');
  grd.addColorStop(1, 'rgba(40,10,4,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, CW, CH);

  // Glass frame
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 6;
  ctx.strokeRect(120, 60, CW - 240, CH - 120);

  // Crack pattern emanating from the centre
  ctx.strokeStyle = 'rgba(220,220,210,0.55)'; ctx.lineWidth = 1.2;
  const cx = CW / 2, cy = CH / 2 + 10;
  for (let i = 0; i < 14; i++) {
    const a = i * Math.PI / 7 + 0.2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    let px = cx, py = cy;
    for (let s = 0; s < 5; s++) {
      const dist = 40 + s * 25 + (i % 3) * 10;
      px = cx + Math.cos(a + (s % 2 ? 0.2 : -0.2)) * dist;
      py = cy + Math.sin(a + (s % 2 ? 0.2 : -0.2)) * dist;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Hole in the centre
  ctx.fillStyle = '#070406';
  ctx.beginPath(); ctx.ellipse(cx, cy, 70, 56, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,220,210,0.7)';
  ctx.beginPath(); ctx.ellipse(cx, cy, 70, 56, 0, 0, Math.PI * 2); ctx.stroke();

  // The hand reaching through, fingers extended toward camera
  const reach = Math.min(1, t * 1.3);
  const hx = cx + Math.sin(now / 320) * 2;
  const hy = cy + 8;
  // Wrist (rotten skin)
  ctx.fillStyle = '#3a4a30';
  ctx.beginPath();
  ctx.ellipse(hx, hy + 30, 26, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // Palm
  ctx.fillStyle = '#4d6042';
  ctx.beginPath();
  ctx.ellipse(hx, hy + 6, 32, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  // Fingers (5)
  for (let f = 0; f < 5; f++) {
    const ang = -Math.PI / 2 + (f - 2) * 0.32;
    const len = 56 + (f === 2 ? 12 : 0);
    const fx = hx + Math.cos(ang) * len * reach;
    const fy = hy + Math.sin(ang) * len * reach;
    ctx.strokeStyle = '#4d6042'; ctx.lineWidth = 14 - Math.abs(f - 2) * 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke();
    // Fingernails dark
    ctx.fillStyle = '#1a1a14';
    ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineCap = 'butt';
  // Blood drips
  for (let b = 0; b < 5; b++) {
    const bx = hx - 24 + b * 12;
    const drip = 30 + (now / 80 + b * 12) % 90;
    ctx.fillStyle = `rgba(140,5,5,${0.75})`;
    ctx.beginPath();
    ctx.ellipse(bx, hy + 30 + drip, 2.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Glass shards still attached around the hole
  ctx.fillStyle = 'rgba(220,220,210,0.7)';
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + 0.4;
    const px = cx + Math.cos(a) * 80, py = cy + Math.sin(a) * 60;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * 12, py + Math.sin(a) * 9);
    ctx.lineTo(px + Math.cos(a + 0.2) * 6, py + Math.sin(a + 0.2) * 4);
    ctx.closePath(); ctx.fill();
  }
}

// 2.2 — Silhouette of an adult and a child running, pursuers behind.
function dShotFamilyFleeing(ctx, t, now) {
  // Apocalypse-red sky with smoke streaks
  const sg = ctx.createLinearGradient(0, 0, 0, CH);
  sg.addColorStop(0, '#3a0606'); sg.addColorStop(0.6, '#5a1a10'); sg.addColorStop(1, '#0e0606');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  // Smoke clouds
  for (let i = 0; i < 8; i++) {
    const sx = (i * 137 + 41) % CW;
    const sy = 40 + (i * 31) % 120;
    ctx.fillStyle = `rgba(20,15,12,${0.35 + (i % 3) * 0.1})`;
    ctx.beginPath(); ctx.arc(sx, sy, 40 + (i % 3) * 10, 0, Math.PI * 2); ctx.fill();
  }
  // Distant burning skyline
  for (let i = 0; i < 6; i++) {
    const bx = 60 + i * 140;
    const bh = 100 + (i * 41) % 90;
    ctx.fillStyle = '#0a0604';
    ctx.fillRect(bx, GY - 70 - bh, 110, bh);
    // Flame at the top
    ctx.fillStyle = 'rgba(255,120,40,0.75)';
    ctx.beginPath();
    ctx.moveTo(bx + 30, GY - 70 - bh);
    ctx.lineTo(bx + 20, GY - 80 - bh + Math.sin(now / 100 + i) * 4);
    ctx.lineTo(bx + 40, GY - 88 - bh);
    ctx.lineTo(bx + 60, GY - 78 - bh - Math.sin(now / 90 + i) * 4);
    ctx.lineTo(bx + 70, GY - 70 - bh);
    ctx.closePath(); ctx.fill();
  }
  // Ground
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(0, GY - 6, CW, CH - GY + 6);
  // Crack lines on the asphalt
  ctx.strokeStyle = '#080404'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(120 + i * 160, GY);
    ctx.lineTo(140 + i * 160, GY + 30); ctx.lineTo(180 + i * 160, GY + 5);
    ctx.stroke();
  }

  // Camera "tracks" the family from right to left — at t=0 they're
  // far right, at t=1 they're at mid-left, with pursuers gaining.
  const fx = CW * 0.7 - t * 280;
  const wob = Math.sin(now / 130) * 2.5;
  // Adult silhouette
  ctx.fillStyle = '#0a0606';
  ctx.fillRect(fx - 6, GY - 64 + wob * 0.4, 12, 36);
  ctx.beginPath(); ctx.arc(fx, GY - 72 + wob * 0.4, 6, 0, Math.PI * 2); ctx.fill();
  // Legs in mid-stride
  const legSpread = Math.sin(now / 100) * 8;
  ctx.fillRect(fx - 4 - legSpread, GY - 28, 4, 22);
  ctx.fillRect(fx + legSpread, GY - 28, 4, 22);
  // Outstretched arm holding child's hand
  ctx.strokeStyle = '#0a0606'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(fx - 4, GY - 50); ctx.lineTo(fx - 24, GY - 36); ctx.stroke();
  // Child silhouette
  const cx = fx - 26;
  ctx.fillStyle = '#0a0606';
  ctx.fillRect(cx - 4, GY - 38 + wob * 0.3, 8, 22);
  ctx.beginPath(); ctx.arc(cx, GY - 42, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - 3 - legSpread * 0.6, GY - 16, 3, 12);
  ctx.fillRect(cx + legSpread * 0.6, GY - 16, 3, 12);

  // Pursuers — 3 zombie silhouettes behind, slightly slower
  for (let p = 0; p < 3; p++) {
    const px = CW * 1.05 - t * 240 + p * 36;
    const wb = Math.sin(now / 240 + p) * 1.6;
    ctx.fillStyle = '#1a261a';
    ctx.fillRect(px - 4, GY - 60 + wb, 8, 34);
    ctx.beginPath(); ctx.arc(px + wb * 0.3, GY - 66, 4, 0, Math.PI * 2); ctx.fill();
    // Outstretched arms
    ctx.fillStyle = '#1a261a';
    ctx.fillRect(px - 9, GY - 50, 4, 2);
    ctx.fillRect(px + 5, GY - 50, 4, 2);
    // Stagger legs
    ctx.fillRect(px - 4, GY - 26, 3, 22);
    ctx.fillRect(px + 1, GY - 26, 3, 22);
  }
}

// 2.3 — Pull-back: chaotic street with many silhouettes and rubble.
function dShotStreetChaos(ctx, t, now) {
  const sg = ctx.createLinearGradient(0, 0, 0, CH);
  sg.addColorStop(0, '#2a0a08'); sg.addColorStop(1, '#0e0606');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  // Smoke
  for (let i = 0; i < 10; i++) {
    const sx = (i * 99 + 30) % CW;
    const sy = 30 + (i * 19) % 140;
    ctx.fillStyle = `rgba(20,15,12,${0.30 + (i % 3) * 0.1})`;
    ctx.beginPath(); ctx.arc(sx, sy, 30 + (i % 4) * 8, 0, Math.PI * 2); ctx.fill();
  }
  // Burning skyline
  for (let i = 0; i < 8; i++) {
    const bx = i * 120;
    const bh = 80 + (i * 31) % 130;
    ctx.fillStyle = '#0a0604';
    ctx.fillRect(bx, GY - 90 - bh, 100, bh);
    if (i % 2) {
      ctx.fillStyle = 'rgba(255,110,40,0.7)';
      ctx.beginPath();
      ctx.moveTo(bx + 20, GY - 90 - bh);
      ctx.lineTo(bx + 40, GY - 110 - bh + Math.sin(now / 100 + i) * 4);
      ctx.lineTo(bx + 60, GY - 90 - bh);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(0, GY - 60, CW, CH - GY + 60);

  // Overturned car in the foreground
  ctx.fillStyle = '#181818';
  ctx.fillRect(120, GY - 30, 130, 30);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(150, GY - 50, 70, 20);
  // Wheels (one up in the air)
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(140, GY + 4, 10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(220, GY + 4, 10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(160, GY - 56, 8, 0, Math.PI * 2); ctx.fill();
  // Burning on the bottom
  ctx.fillStyle = 'rgba(255,120,40,0.7)';
  for (let i = 0; i < 5; i++) {
    const fx = 140 + i * 24;
    ctx.beginPath();
    ctx.moveTo(fx - 5, GY); ctx.lineTo(fx, GY - 22 + Math.sin(now / 80 + i) * 3);
    ctx.lineTo(fx + 5, GY); ctx.closePath(); ctx.fill();
  }
  // Many small silhouettes running every which way
  const fleeing = 14;
  for (let i = 0; i < fleeing; i++) {
    const dir = (i % 2) ? 1 : -1;
    const x = ((i * 71 + now * 0.12) % CW);
    const xx = dir > 0 ? x : CW - x;
    const wob = Math.sin(now / 160 + i) * 1.4;
    ctx.fillStyle = '#0a0606';
    ctx.fillRect(xx - 3, GY - 30 + wob * 0.3, 6, 22);
    ctx.beginPath(); ctx.arc(xx, GY - 36, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(xx - 3, GY - 8, 2.5, 8);
    ctx.fillRect(xx, GY - 8, 2.5, 8);
  }
  // A few zombie silhouettes mixed in
  for (let i = 0; i < 6; i++) {
    const x = 320 + i * 80 + Math.sin(now / 250 + i) * 5;
    ctx.fillStyle = '#1a261a';
    ctx.fillRect(x - 4, GY - 32, 8, 26);
    ctx.beginPath(); ctx.arc(x, GY - 38, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 8, GY - 22, 4, 2);
    ctx.fillRect(x + 4, GY - 22, 4, 2);
  }
  // Red alert pulse
  const p = Math.sin(now / 250) * 0.5 + 0.5;
  ctx.fillStyle = `rgba(180,30,30,${0.08 + p * 0.10})`;
  ctx.fillRect(0, 0, CW, CH);
}

// 3.1 — Police officer in tactical stance, both hands on pistol,
// FIRING at off-screen zombies on the right. Bright muzzle flash,
// brass casings ejecting. Backlit by the strobing light bar of his
// cruiser. Full mid-shot, ¾ side view.
function dShotCopFiring(ctx, t, now) {
  // Dark backdrop with cool/warm rim contrast
  ctx.fillStyle = '#06080c'; ctx.fillRect(0, 0, CW, CH);
  // Police cruiser silhouette behind, with red/blue light bar pulsing
  const lbPhase = Math.floor(now / 200) % 2;
  ctx.fillStyle = '#11141a'; ctx.fillRect(0, CH - 220, CW, 130);
  ctx.fillStyle = '#0a1418'; ctx.fillRect(60, CH - 280, CW - 120, 60); // car body
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(60, CH - 240, CW - 120, 12); // white stripe
  // Light bar
  ctx.fillStyle = lbPhase ? '#cc1818' : '#1a4ccc';
  ctx.fillRect(CW / 2 - 100, CH - 296, 90, 14);
  ctx.fillStyle = lbPhase ? '#1a4ccc' : '#cc1818';
  ctx.fillRect(CW / 2 + 10,  CH - 296, 90, 14);
  // Light halo on the sky
  const halo = ctx.createRadialGradient(CW / 2, CH - 280, 20, CW / 2, CH - 280, 360);
  halo.addColorStop(0, lbPhase ? 'rgba(220,30,30,0.28)' : 'rgba(40,80,220,0.32)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, CW, CH);

  // Ground in foreground
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, CH - 90, CW, 90);
  // Brass casings on the ground (clinking)
  for (let i = 0; i < 5; i++) {
    const cx2 = 240 + i * 60 + Math.sin(now / 200 + i) * 6;
    ctx.fillStyle = '#c4a850';
    ctx.fillRect(cx2, CH - 80 + (i % 3), 6, 3);
  }

  // The officer — drawn via the real in-game dSoldier sprite with the
  // police palette, scaled up to fill the close-up. State 'shoot'
  // animates the recoil pose; a muzzle-flash overlay is layered on top.
  const ox = CW / 2 - 60, oy = CH - 60;
  const SCALE = 5.0;
  const flashOn = Math.floor(now / 140) % 2 === 0;
  const officer = mkIntroSoldier({
    name: 'NHPD-0451', weapon: 'pistol', police: true,
    state: flashOn ? 'shoot' : 'idle',
    facing: 1, lastShot: now - 40,
  });
  dSpriteAt(dSoldier, ctx, officer, ox, oy, SCALE, now);
  // Reflective yellow vest stripe + badge overlay on top of the sprite
  ctx.fillStyle = '#c4a838';
  ctx.fillRect(ox - 38, oy - 230, 92, 5);
  ctx.fillStyle = '#dfb84a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rr = (i % 2 === 0) ? 8 : 3.6;
    const bx = ox + 6 + Math.cos(ang) * rr;
    const by = oy - 252 + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath(); ctx.fill();

  // MUZZLE FLASH overlay at the pistol barrel (timed pulses)
  if (flashOn) {
    const fx = ox + 90, fy = oy - 215;
    const fgr = ctx.createRadialGradient(fx, fy, 4, fx, fy, 110);
    fgr.addColorStop(0, 'rgba(255,255,220,1)');
    fgr.addColorStop(0.35, 'rgba(255,180,60,0.75)');
    fgr.addColorStop(1, 'rgba(180,40,10,0)');
    ctx.fillStyle = fgr; ctx.fillRect(fx - 110, fy - 110, 220, 220);
    // Bright triangular core
    ctx.fillStyle = 'rgba(255,255,210,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx, fy - 18);
    ctx.lineTo(fx + 60, fy);
    ctx.lineTo(fx + 90, fy - 6);
    ctx.lineTo(fx + 60, fy + 12);
    ctx.lineTo(fx, fy + 18);
    ctx.closePath(); ctx.fill();
    // Light spill on officer's face + chest
    ctx.fillStyle = 'rgba(255,200,120,0.30)';
    ctx.beginPath(); ctx.ellipse(ox + 24, oy - 248, 60, 50, 0, 0, Math.PI * 2); ctx.fill();
    // Ejecting brass casing
    const ejT = ((now / 140) % 1);
    const ecx = fx - 32 + ejT * 40;
    const ecy = fy - 30 - ejT * 30 + ejT * ejT * 60;
    ctx.fillStyle = '#c4a850';
    ctx.fillRect(ecx, ecy, 6, 3);
  }

  // Bullet streaks heading off-frame right (showing the bullets in air)
  for (let i = 0; i < 4; i++) {
    const bx = ox + 200 + i * 80 + ((now * 1.2) % 80);
    if (bx > CW) continue;
    ctx.fillStyle = 'rgba(255,230,140,0.85)';
    ctx.fillRect(bx, oy - 192, 36, 1.4);
  }
}

// Old badge-flash close-up, kept as a fallback (unused).
function _dShotBadgeFlash_unused(ctx, t, now) {
  // Pitch-black background with deep blue rim light
  ctx.fillStyle = '#040608'; ctx.fillRect(0, 0, CW, CH);
  // Cool rim light from above
  const grd = ctx.createRadialGradient(CW / 2, 60, 20, CW / 2, 60, 380);
  grd.addColorStop(0, 'rgba(40,80,140,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, CW, CH);

  // Officer's chest in foreground (huge — close-up)
  ctx.fillStyle = '#0e1622';
  ctx.fillRect(CW / 2 - 220, 80, 440, CH);
  // Yellow tactical vest stripe
  ctx.fillStyle = '#c4a838';
  ctx.fillRect(CW / 2 - 220, CH - 240, 440, 22);

  // The badge — central, golden, with engraved letters
  const bx = CW / 2, by = 280;
  // Outer star
  ctx.fillStyle = '#b88828';
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 7;
    const r = (i % 2 === 0) ? 92 : 56;
    const px = bx + Math.cos(ang) * r;
    const py = by + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  // Inner shield
  ctx.fillStyle = '#dfb84a';
  ctx.beginPath();
  ctx.ellipse(bx, by, 52, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a07820';
  ctx.fillRect(bx - 50, by - 4, 100, 6);
  // Badge text
  ctx.fillStyle = '#3a2810'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText('NHPD', bx, by - 14);
  ctx.font = 'bold 22px monospace';
  ctx.fillText('0451', bx, by + 22);
  ctx.font = 'bold 8px monospace';
  ctx.fillText('NEW HAVEN POLICE', bx, by + 40);
  ctx.textAlign = 'left';

  // Hand grip on pistol intruding from the right edge — close
  ctx.fillStyle = '#1a1814';
  // Pistol body
  ctx.fillRect(CW - 280, CH - 200, 160, 36);
  // Slide on top
  ctx.fillStyle = '#0a0808';
  ctx.fillRect(CW - 290, CH - 210, 170, 16);
  // Grip
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.moveTo(CW - 240, CH - 164);
  ctx.lineTo(CW - 200, CH - 100);
  ctx.lineTo(CW - 150, CH - 100);
  ctx.lineTo(CW - 170, CH - 164);
  ctx.closePath(); ctx.fill();
  // Hand
  ctx.fillStyle = '#bf8a6a';
  ctx.fillRect(CW - 200, CH - 178, 70, 60);
  // Trigger finger
  ctx.fillStyle = '#a07252';
  ctx.fillRect(CW - 220, CH - 172, 22, 8);

  // Muzzle flash — bright explosion at the barrel tip
  const flashOn = Math.floor(now / 220) % 3 === 0;
  if (flashOn || t < 0.3) {
    const fx = CW - 296, fy = CH - 196;
    // Outer halo
    const fgr = ctx.createRadialGradient(fx, fy, 4, fx, fy, 120);
    fgr.addColorStop(0, 'rgba(255,230,140,1)');
    fgr.addColorStop(0.4, 'rgba(255,160,40,0.65)');
    fgr.addColorStop(1, 'rgba(180,40,10,0)');
    ctx.fillStyle = fgr; ctx.fillRect(fx - 120, fy - 120, 240, 240);
    // Bright core
    ctx.fillStyle = 'rgba(255,255,210,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx - 60, fy - 26);
    ctx.lineTo(fx - 90, fy);
    ctx.lineTo(fx - 60, fy + 26);
    ctx.closePath(); ctx.fill();
    // Light spill onto the badge
    ctx.fillStyle = 'rgba(255,200,120,0.35)';
    ctx.beginPath(); ctx.ellipse(bx + 40, by + 4, 80, 70, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// 3.2 — Wider police containment line: cars, officers firing, zombies.
function dShotPoliceLine(ctx, t, now) {
  const sg = ctx.createLinearGradient(0, 0, 0, CH);
  sg.addColorStop(0, '#1a0e10'); sg.addColorStop(1, '#0a0606');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  // Distant city in flames
  for (let i = 0; i < 6; i++) {
    const bx = i * 160;
    const bh = 70 + (i * 23) % 90;
    ctx.fillStyle = '#0a0604';
    ctx.fillRect(bx, GY - 110 - bh, 120, bh);
    if (i % 2) {
      ctx.fillStyle = 'rgba(255,90,30,0.5)';
      ctx.beginPath();
      ctx.moveTo(bx + 30, GY - 110 - bh);
      ctx.lineTo(bx + 50, GY - 130 - bh);
      ctx.lineTo(bx + 70, GY - 110 - bh);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, GY - 50, CW, CH - GY + 50);
  // Lane lines
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.setLineDash([16, 18]);
  ctx.beginPath(); ctx.moveTo(0, GY - 12); ctx.lineTo(CW, GY - 12); ctx.stroke();
  ctx.setLineDash([]);

  // Two police cars in foreground with flashing lights
  const cars = [180, 380];
  cars.forEach((cx, ci) => {
    const cy = GY - 28;
    // Body
    ctx.fillStyle = '#22222a';
    ctx.fillRect(cx - 60, cy, 120, 22);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(cx - 60, cy + 12, 120, 10);
    // Cabin
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(cx - 44, cy - 18, 88, 18);
    // Light bar
    const phase = Math.floor(now / 220 + ci) % 2;
    ctx.fillStyle = phase ? '#cc1818' : '#1a4ccc';
    ctx.fillRect(cx - 28, cy - 26, 26, 8);
    ctx.fillStyle = phase ? '#1a4ccc' : '#cc1818';
    ctx.fillRect(cx + 2, cy - 26, 26, 8);
    // Halo of lights
    ctx.fillStyle = phase ? 'rgba(220,30,30,0.25)' : 'rgba(40,80,220,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy - 22, 80, 0, Math.PI * 2); ctx.fill();
    // Wheels
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(cx - 36, cy + 22, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 36, cy + 22, 9, 0, Math.PI * 2); ctx.fill();
    // POLICE text
    ctx.fillStyle = '#22222a'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
    ctx.fillText('POLICE', cx, cy + 19); ctx.textAlign = 'left';
  });
  // Officers behind the cars — five cops, mostly with the classic
  // peaked NHPD cap, two with SWAT helmets. Each cop has a scripted
  // deathAt time (0..1) so the line gets eaten one cop at a time as
  // zombies break through.
  const officers = [
    { x: 120, deathAt: 0.55, swat: false },
    { x: 240, deathAt: 0.95, swat: true  },  // SWAT, dies last
    { x: 340, deathAt: 0.75, swat: false },
    { x: 460, deathAt: 0.99, swat: true  },  // SWAT, last to fall
    { x: 530, deathAt: 0.65, swat: false },
  ];
  // Bodies of fallen officers drawn first so the standing ones layer
  // on top.
  officers.forEach((ofc, oi) => {
    if (t < ofc.deathAt) return;
    const cop = mkIntroSoldier({
      name: 'NHPD-' + (oi + 1), weapon: 'pistol',
      police: true, swat: ofc.swat,
      facing: 1, state: 'dead',
    });
    dSpriteAt(dSoldier, ctx, cop, ofc.x, GY, 1.6, now);
    // Blood pool
    ctx.fillStyle = 'rgba(110,5,5,0.55)';
    ctx.beginPath(); ctx.ellipse(ofc.x, GY + 2, 20, 4, 0, 0, Math.PI * 2); ctx.fill();
  });
  // Living officers — firing pistols, muzzle flash + bullet streak
  officers.forEach((ofc, oi) => {
    if (t >= ofc.deathAt) return;
    const firing = Math.floor(now / 200 + oi) % 2 === 0;
    const cop = mkIntroSoldier({
      name: 'NHPD-' + (oi + 1), weapon: 'pistol',
      police: true, swat: ofc.swat,
      facing: 1, state: firing ? 'shoot' : 'idle',
      lastShot: now - 40, walkPhase: oi * 0.7,
    });
    dSpriteAt(dSoldier, ctx, cop, ofc.x, GY, 1.6, now);
    if (firing) {
      const fx = ofc.x + 24, fy = GY - 42;
      ctx.fillStyle = 'rgba(255,210,80,0.95)';
      ctx.beginPath();
      ctx.moveTo(fx, fy); ctx.lineTo(fx + 14, fy - 4);
      ctx.lineTo(fx + 14, fy + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,140,0.85)';
      ctx.fillRect(fx + 16, fy - 0.5, 40 + (oi * 17) % 60, 1.4);
    }
  });

  // Zombies — pre-defined attackers, each with a scripted target cop
  // and an arrival time. Before arrival they walk left; after, they
  // stop at the cop's position in 'attack' state (mauling).
  const attackers = [
    { offset:   0, targetIdx: 4, arriveAt: 0.30, type: 'runner' },
    { offset:  80, targetIdx: 0, arriveAt: 0.45, type: 'walker' },
    { offset: 160, targetIdx: 2, arriveAt: 0.55, type: 'walker' },
    { offset: 220, targetIdx: 4, arriveAt: 0.60, type: 'runner' },
    { offset: 300, targetIdx: 0, arriveAt: 0.50, type: 'walker' },
    { offset: 380, targetIdx: 2, arriveAt: 0.70, type: 'walker' },
    { offset: 460, targetIdx: 3, arriveAt: 0.80, type: 'walker' },
    { offset: 520, targetIdx: 1, arriveAt: 0.85, type: 'walker' },
    { offset: 580, targetIdx: 3, arriveAt: 0.92, type: 'runner' },
    { offset: 640, targetIdx: 1, arriveAt: 0.95, type: 'walker' },
  ];
  attackers.forEach((zw, zi) => {
    const startX = CW + 40 + zw.offset;
    const targetX = officers[zw.targetIdx].x + 26;
    let zx;
    let zstate;
    if (t < zw.arriveAt) {
      const prog = t / zw.arriveAt;
      zx = startX + (targetX - startX) * prog;
      zstate = 'walk';
    } else {
      zx = targetX + Math.sin(now / 140 + zi) * 2; // mauling jitter
      zstate = 'attack';
    }
    const z = mkIntroZombie({
      type: zw.type, facing: -1, state: zstate,
      walkPhase: zi * 0.4,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.35, now);
  });

  // Dead zombies left in the foreground street (killed by cop fire
  // before reaching the line). Pre-scripted so they appear in order.
  const corpses = [
    { x: 720, killedAt: 0.10 },
    { x: 650, killedAt: 0.25 },
    { x: 600, killedAt: 0.40 },
    { x: 560, killedAt: 0.55 },
  ];
  corpses.forEach(c => {
    if (t < c.killedAt) return;
    // Pretend it died ~700 ms ago in the cinematic timeline (long
    // enough for dZombie to render as fully fallen).
    const z = mkIntroZombie({
      type: 'walker', facing: -1, state: 'dead',
    });
    z.deadAt = now - 900;
    dSpriteAt(dZombie, ctx, z, c.x, GY, 1.35, now);
    // Blood pool
    ctx.fillStyle = 'rgba(110,5,5,0.5)';
    ctx.beginPath(); ctx.ellipse(c.x, GY + 2, 18, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  });
}

// 3.3 — Officer being grabbed and pulled down by zombies. He fires
// wildly into the air as he goes down. Two zombies on him; his
// pistol's muzzle flash lights the scene briefly.
function dShotCopDragged(ctx, t, now) {
  // Dark street with flickering lamp + distant fires
  ctx.fillStyle = '#06080a'; ctx.fillRect(0, 0, CW, CH);
  const flick = (Math.sin(now / 90) > 0.4) ? 1 : 0.45;
  const halo = ctx.createRadialGradient(CW * 0.3, 60, 10, CW * 0.3, 60, 520);
  halo.addColorStop(0, `rgba(255,200,120,${0.30 * flick})`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, CW, CH);
  // Burning skyline
  for (let i = 0; i < 6; i++) {
    const bx = i * 160;
    const bh = 70 + (i * 31) % 90;
    ctx.fillStyle = '#0a0604';
    ctx.fillRect(bx, GY - 50 - bh, 140, bh);
  }
  ctx.fillStyle = 'rgba(255,80,20,0.18)';
  ctx.fillRect(0, GY - 50, CW, 20);
  // Ground
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, GY, CW, CH - GY);

  // Background police car (out of focus)
  ctx.fillStyle = '#181820';
  ctx.fillRect(50, GY - 60, 220, 50);
  ctx.fillStyle = '#0a1418';
  ctx.fillRect(80, GY - 86, 160, 26);
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(140, GY - 96, 40, 5);
  // Bullet holes in the car
  ctx.fillStyle = '#000';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.arc(100 + i * 28, GY - 30, 2, 0, Math.PI * 2); ctx.fill();
  }

  // Tug animation
  const tug = Math.sin(now / 150) * 5;

  // The officer — pulled to the ground, on his back, propped on one
  // arm, the other firing the pistol up into the air.
  const ox = CW * 0.50, oy = CH - 60;
  // Legs flailing
  ctx.fillStyle = '#0e1622';
  ctx.beginPath();
  ctx.moveTo(ox - 30, oy);
  ctx.lineTo(ox - 80 + tug, oy - 18);
  ctx.lineTo(ox - 70 + tug, oy - 8);
  ctx.lineTo(ox - 20, oy + 12);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(ox + 10, oy);
  ctx.lineTo(ox + 70 - tug, oy - 14);
  ctx.lineTo(ox + 80 - tug, oy - 4);
  ctx.lineTo(ox + 20, oy + 12);
  ctx.closePath(); ctx.fill();
  // Boots flailing
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(ox - 92 + tug, oy - 22, 18, 10);
  ctx.fillRect(ox + 76 - tug, oy - 18, 18, 10);
  // Torso (on his back, slanted)
  ctx.save();
  ctx.translate(ox, oy - 20);
  ctx.rotate(-0.18);
  ctx.fillStyle = '#0e1622';
  ctx.fillRect(-44, -80, 88, 90);
  ctx.fillStyle = '#c4a838';
  ctx.fillRect(-44, -60, 88, 8);
  // Badge on chest
  ctx.fillStyle = '#dfb84a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rr = (i % 2 === 0) ? 7 : 3;
    const bx = 8 + Math.cos(ang) * rr;
    const by = -38 + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
  }
  ctx.closePath(); ctx.fill();
  // Blood on uniform from the bite
  ctx.fillStyle = 'rgba(120,4,4,0.78)';
  ctx.beginPath();
  ctx.moveTo(-30, -78); ctx.lineTo(20, -76); ctx.lineTo(34, -40); ctx.lineTo(-26, -34);
  ctx.closePath(); ctx.fill();
  // Head turned back (mouth open in scream)
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath(); ctx.arc(0, -100, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a0a0a';
  ctx.beginPath(); ctx.ellipse(2, -94, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Eyes wide
  ctx.fillStyle = '#fff'; ctx.fillRect(-8, -110, 6, 3); ctx.fillRect(4, -110, 6, 3);
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-6, -109, 2, 2); ctx.fillRect(6, -109, 2, 2);
  // Police cap thrown back (sliding off)
  ctx.fillStyle = '#0e1622';
  ctx.fillRect(-22, -118, 26, 6);
  // One arm bracing the ground
  ctx.fillStyle = '#0e1622';
  ctx.fillRect(-58, -10, 36, 12);
  ctx.fillStyle = '#bf8a6a';
  ctx.fillRect(-66, -10, 12, 12);
  // Other arm shooting straight up
  ctx.fillStyle = '#0e1622';
  ctx.fillRect(38, -120, 16, 80);
  ctx.fillStyle = '#bf8a6a';
  ctx.fillRect(36, -138, 20, 22);
  // Pistol pointing up
  ctx.fillStyle = '#181818';
  ctx.fillRect(40, -160, 12, 24);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(36, -160, 20, 8);
  // Muzzle flash going up (every other beat)
  const fflash = Math.floor(now / 180) % 2 === 0;
  if (fflash) {
    const fx = 46, fy = -168;
    const fg = ctx.createRadialGradient(fx, fy, 3, fx, fy, 80);
    fg.addColorStop(0, 'rgba(255,255,220,1)');
    fg.addColorStop(0.4, 'rgba(255,160,40,0.6)');
    fg.addColorStop(1, 'rgba(180,40,10,0)');
    ctx.fillStyle = fg; ctx.fillRect(fx - 80, fy - 80, 160, 160);
    ctx.fillStyle = 'rgba(255,255,210,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx - 14, fy + 10);
    ctx.lineTo(fx, fy - 30);
    ctx.lineTo(fx + 14, fy + 10);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // Zombie #1 — biting the officer's shoulder/neck on his right
  ctx.fillStyle = '#2a3826';
  ctx.beginPath();
  ctx.moveTo(ox + 40, oy);
  ctx.lineTo(ox + 60, oy - 80);
  ctx.lineTo(ox + 90, oy - 110);
  ctx.lineTo(ox + 130, oy - 100);
  ctx.lineTo(ox + 140, oy - 50);
  ctx.lineTo(ox + 110, oy);
  ctx.closePath(); ctx.fill();
  // Head leaning into the bite
  ctx.fillStyle = '#5a7042';
  ctx.beginPath(); ctx.arc(ox + 70, oy - 96, 18, 0, Math.PI * 2); ctx.fill();
  // Red eye
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(ox + 64, oy - 100, 4, 3);
  // Open jaw biting
  ctx.fillStyle = '#1a0606';
  ctx.beginPath(); ctx.ellipse(ox + 56, oy - 88, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Blood on the jaw
  ctx.fillStyle = '#7a0606';
  ctx.fillRect(ox + 50, oy - 84, 10, 3);
  // Arms grabbing officer's torso
  ctx.fillStyle = '#2a3826';
  ctx.fillRect(ox + 30, oy - 70, 24, 8);
  ctx.fillRect(ox + 28, oy - 50, 22, 8);

  // Zombie #2 — pulling the officer's legs from below
  ctx.fillStyle = '#2a3826';
  ctx.beginPath();
  ctx.moveTo(ox - 110, oy);
  ctx.lineTo(ox - 130, oy - 40);
  ctx.lineTo(ox - 170, oy - 30);
  ctx.lineTo(ox - 180, oy + 10);
  ctx.lineTo(ox - 120, oy + 20);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a7042';
  ctx.beginPath(); ctx.arc(ox - 156, oy - 36, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(ox - 162, oy - 38, 3, 2);
  ctx.fillRect(ox - 152, oy - 38, 3, 2);
  // Arms grabbing officer's ankle
  ctx.fillStyle = '#2a3826';
  ctx.fillRect(ox - 130, oy - 14, 30, 6);
  ctx.fillRect(ox - 130, oy - 4, 30, 6);

  // Blood pool growing under the officer
  ctx.fillStyle = 'rgba(110,5,5,0.55)';
  ctx.beginPath();
  ctx.ellipse(ox, oy + 8, 90 + tug * 0.5, 7, 0, 0, Math.PI * 2); ctx.fill();

  // Streetlamp flicker overlay
  if (flick < 0.6) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, CW, CH);
  }
}

// Old wounded-officer shot (unused).
function _dShotWounded_unused(ctx, t, now) {
  // Dark, smokey street; rim light from a flickering streetlamp
  ctx.fillStyle = '#040606'; ctx.fillRect(0, 0, CW, CH);
  // Lamp flicker
  const flick = (Math.sin(now / 90) > 0.4) ? 1 : 0.45;
  const grd = ctx.createRadialGradient(CW * 0.7, 60, 10, CW * 0.7, 60, 480);
  grd.addColorStop(0, `rgba(255,200,120,${0.35 * flick})`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, CW, CH);
  // Distant fires
  ctx.fillStyle = 'rgba(255,90,30,0.18)';
  ctx.fillRect(0, GY - 20, CW, 20);

  // The car (close, foreground)
  ctx.fillStyle = '#181820';
  ctx.fillRect(80, CH - 240, CW - 160, 220);
  ctx.fillStyle = '#0a1418';
  ctx.fillRect(180, CH - 230, 180, 60);
  // Door panel + handle
  ctx.fillStyle = '#0e0e14';
  ctx.fillRect(80, CH - 160, 280, 110);
  ctx.fillStyle = '#3a3a40';
  ctx.fillRect(150, CH - 130, 20, 5);
  // Police lights on top (dim)
  ctx.fillStyle = '#5a1010';
  ctx.fillRect(280, CH - 248, 60, 8);
  // POLICE text
  ctx.fillStyle = '#f0f0f0'; ctx.font = 'bold 12px monospace';
  ctx.fillText('POLICE', 200, CH - 200);
  ctx.fillStyle = '#888'; ctx.font = '9px monospace';
  ctx.fillText('NHPD · 0451', 200, CH - 186);

  // Slumped officer leaning against the car door
  const ox = 460, oy = CH - 50;
  // Legs splayed out
  ctx.fillStyle = '#1a2840';
  ctx.fillRect(ox, oy - 6, 90, 20);
  ctx.fillRect(ox + 30, oy + 14, 70, 14);
  // Boots
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(ox + 80, oy - 8, 14, 10);
  ctx.fillRect(ox + 90, oy + 24, 14, 10);
  // Torso slumped
  ctx.fillStyle = '#1a2840';
  ctx.fillRect(ox - 6, oy - 80, 36, 80);
  // Yellow vest
  ctx.fillStyle = '#c4a838';
  ctx.fillRect(ox - 6, oy - 76, 36, 4);
  // Blood spreading down
  ctx.fillStyle = 'rgba(140,5,5,0.7)';
  ctx.beginPath();
  ctx.moveTo(ox - 4, oy - 60); ctx.lineTo(ox + 16, oy - 50); ctx.lineTo(ox + 28, oy + 6);
  ctx.lineTo(ox - 8, oy + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(80,2,2,0.6)';
  ctx.beginPath();
  ctx.ellipse(ox + 4, oy + 16, 56, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Head tilted, looking down
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath(); ctx.arc(ox + 20, oy - 92, 9, 0, Math.PI * 2); ctx.fill();
  // Police cap
  ctx.fillStyle = '#1a2840';
  ctx.fillRect(ox + 12, oy - 100, 18, 5);
  ctx.beginPath(); ctx.arc(ox + 20, oy - 100, 9, Math.PI, 0); ctx.fill();
  // Arm holding radio up to the head
  ctx.strokeStyle = '#1a2840'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(ox + 18, oy - 70); ctx.lineTo(ox + 8, oy - 88); ctx.stroke();
  // The radio in hand
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(ox - 2, oy - 96, 12, 18);
  ctx.fillStyle = '#1a3a18';
  ctx.fillRect(ox, oy - 94, 8, 4);
  // LED blink (red)
  if (Math.floor(now / 280) % 2) {
    ctx.fillStyle = '#ff2020';
    ctx.fillRect(ox + 3, oy - 84, 2, 2);
  }
  // Speech wave above the radio
  ctx.strokeStyle = `rgba(180,220,180,${0.5 + 0.4 * Math.sin(now / 130)})`;
  ctx.lineWidth = 1.2;
  for (let r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.arc(ox + 4, oy - 88, 10 + r * 5, -Math.PI * 0.7, -Math.PI * 0.3);
    ctx.stroke();
  }

  // Light flicker overlay
  if (flick < 0.6) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, CW, CH);
  }
}

// 4.1 — A lone soldier holding the line as the city burns behind him.
// He fires a rifle at off-screen zombies; the burning wreck of a car
// behind him lights his silhouette. Shell casings on the ground.
function dShotLastDefender(ctx, t, now) {
  // Sky on fire
  const sg = ctx.createLinearGradient(0, 0, 0, GY);
  sg.addColorStop(0, '#0a0604'); sg.addColorStop(0.6, '#3a1410'); sg.addColorStop(1, '#5a2210');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY);
  // Heavy smoke
  for (let i = 0; i < 12; i++) {
    const sx = (i * 79 + now * 0.04) % (CW + 100) - 50;
    const sy = 20 + (i * 23) % 200;
    ctx.fillStyle = `rgba(20,15,12,${0.32 + (i % 3) * 0.1})`;
    ctx.beginPath(); ctx.arc(sx, sy, 50 + (i % 4) * 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(0, GY, CW, CH - GY);

  // Burning wreck of a car BEHIND the soldier (slightly left + back)
  const cx = CW * 0.30, cy = GY - 30;
  ctx.fillStyle = '#181818';
  ctx.fillRect(cx - 110, cy, 220, 32);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(cx - 70, cy - 30, 140, 30);
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(cx - 80, cy + 36, 14, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 80, cy + 36, 14, 0, Math.PI * 2); ctx.fill();
  // Flames + light pulse
  for (let f = 0; f < 5; f++) {
    const fx = cx - 60 + f * 30;
    const flick = Math.sin(now / 80 + f) * 4;
    const fh = 65 + (f % 3) * 18 + flick;
    ctx.fillStyle = 'rgba(220,80,20,0.85)';
    ctx.beginPath();
    ctx.moveTo(fx - 10, cy - 12);
    ctx.lineTo(fx - 4, cy - fh);
    ctx.lineTo(fx + 4, cy - fh);
    ctx.lineTo(fx + 10, cy - 12);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,60,0.7)';
    ctx.beginPath();
    ctx.moveTo(fx - 4, cy - 14);
    ctx.lineTo(fx, cy - fh * 0.85);
    ctx.lineTo(fx + 4, cy - 14);
    ctx.closePath(); ctx.fill();
  }
  // Fire light spill on the ground
  ctx.fillStyle = 'rgba(255,140,40,0.18)';
  ctx.fillRect(0, cy + 32, CW, 30);

  // SHELL CASINGS ejected and lying on the ground
  for (let i = 0; i < 8; i++) {
    const ecx = 540 + i * 22 + ((now / 18 + i) % 50);
    ctx.fillStyle = '#c4a850';
    ctx.fillRect(ecx % CW, GY - 4 + (i % 3), 5, 2.5);
  }

  // The SOLDIER — drawn via the real in-game dSoldier sprite, scaled
  // up. The 'shoot' state synchronises the recoil pose with the
  // muzzle-flash overlay (drawn below).
  const sx = CW * 0.62, sy = CH - 50;
  const SCALE_SOL = 4.6;
  const flashOn = Math.floor(now / 110) % 2 === 0;
  const def = mkIntroSoldier({
    name: 'Alpha', weapon: 'rifle', facing: 1,
    state: flashOn ? 'shoot' : 'idle', lastShot: now - 50,
  });
  dSpriteAt(dSoldier, ctx, def, sx, sy, SCALE_SOL, now);

  // MUZZLE FLASH overlay — anchored near the rifle barrel tip of the
  // scaled sprite.
  if (flashOn) {
    const fx = sx + 130, fy = sy - 210;
    const fg = ctx.createRadialGradient(fx, fy, 4, fx, fy, 130);
    fg.addColorStop(0, 'rgba(255,255,210,1)');
    fg.addColorStop(0.35, 'rgba(255,180,60,0.75)');
    fg.addColorStop(1, 'rgba(180,40,10,0)');
    ctx.fillStyle = fg; ctx.fillRect(fx - 130, fy - 130, 260, 260);
    // Triangular flash core
    ctx.fillStyle = 'rgba(255,255,210,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx, fy - 14);
    ctx.lineTo(fx + 60, fy);
    ctx.lineTo(fx + 90, fy - 4);
    ctx.lineTo(fx + 60, fy + 12);
    ctx.lineTo(fx, fy + 14);
    ctx.closePath(); ctx.fill();
    // Brass casing flying upward-right
    const ejT = ((now / 110) % 1);
    const ecx = sx + 100 + ejT * 30;
    const ecy = sy - 200 - ejT * 26 + ejT * ejT * 50;
    ctx.fillStyle = '#c4a850';
    ctx.fillRect(ecx, ecy, 6, 3);
  }

  // Bullet streaks heading right
  for (let i = 0; i < 4; i++) {
    const bx = sx + 250 + i * 70 + ((now * 1.4 + i * 30) % 70);
    if (bx > CW) continue;
    ctx.fillStyle = 'rgba(255,230,140,0.85)';
    ctx.fillRect(bx, sy - 167, 32, 1.5);
  }

  // Zombie silhouettes JUST visible at the right edge — what he's shooting at
  // Zombie horde at the right edge — real dZombie sprites at small scale
  for (let i = 0; i < 3; i++) {
    const zx = CW - 60 + i * 22;
    if (zx > CW + 20) continue;
    const z = mkIntroZombie({
      type: i === 1 ? 'runner' : 'walker',
      facing: -1, state: 'walk',
      walkPhase: i * 0.7,
    });
    dSpriteAt(dZombie, ctx, z, zx, sy + 6, 1.4, now);
  }
}

// Old burning-car still life (unused).
function _dShotBurningCar_unused(ctx, t, now) {
  // Smoky orange-black sky
  const sg = ctx.createLinearGradient(0, 0, 0, GY);
  sg.addColorStop(0, '#0a0604'); sg.addColorStop(0.6, '#3a1410'); sg.addColorStop(1, '#5a2210');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY);
  // Heavy smoke
  for (let i = 0; i < 14; i++) {
    const sx = (i * 79 + now * 0.04) % (CW + 100) - 50;
    const sy = 20 + (i * 23) % 200;
    ctx.fillStyle = `rgba(20,15,12,${0.3 + (i % 3) * 0.1})`;
    ctx.beginPath(); ctx.arc(sx, sy, 50 + (i % 4) * 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(0, GY, CW, CH - GY);

  // The car — large and central
  const cx = CW / 2, cy = GY - 40;
  // Body
  ctx.fillStyle = '#181818';
  ctx.fillRect(cx - 180, cy, 360, 50);
  // Cabin
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(cx - 120, cy - 50, 240, 50);
  // Smashed windshield
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(cx - 110, cy - 46, 220, 42);
  ctx.strokeStyle = 'rgba(220,220,210,0.5)'; ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 80, cy - 24);
    ctx.lineTo(cx - 80 + Math.cos(i / 12 * Math.PI * 2) * 60,
               cy - 24 + Math.sin(i / 12 * Math.PI * 2) * 22);
    ctx.stroke();
  }
  // Wheels
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(cx - 130, cy + 50, 22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 130, cy + 50, 22, 0, Math.PI * 2); ctx.fill();
  // Tire rim
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(cx - 130, cy + 50, 12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 130, cy + 50, 12, 0, Math.PI * 2); ctx.fill();
  // Hood detail — open and bent
  ctx.fillStyle = '#0e0e0e';
  ctx.beginPath();
  ctx.moveTo(cx - 180, cy);
  ctx.lineTo(cx - 220, cy - 30 + Math.sin(now / 200) * 2);
  ctx.lineTo(cx - 130, cy - 22);
  ctx.closePath(); ctx.fill();

  // FIRE — large flames erupting from the hood and roof
  for (let f = 0; f < 7; f++) {
    const fx = cx - 100 + f * 30;
    const flick = Math.sin(now / 80 + f) * 4;
    const fh = 80 + (f % 3) * 26 + flick;
    // Outer flame
    ctx.fillStyle = 'rgba(220,80,20,0.85)';
    ctx.beginPath();
    ctx.moveTo(fx - 14, cy - 30);
    ctx.lineTo(fx - 8, cy - fh);
    ctx.lineTo(fx, cy - fh - 10);
    ctx.lineTo(fx + 8, cy - fh);
    ctx.lineTo(fx + 14, cy - 30);
    ctx.closePath(); ctx.fill();
    // Inner flame
    ctx.fillStyle = 'rgba(255,200,60,0.75)';
    ctx.beginPath();
    ctx.moveTo(fx - 6, cy - 30);
    ctx.lineTo(fx - 3, cy - fh * 0.75);
    ctx.lineTo(fx, cy - fh * 0.95);
    ctx.lineTo(fx + 3, cy - fh * 0.75);
    ctx.lineTo(fx + 6, cy - 30);
    ctx.closePath(); ctx.fill();
    // Core
    ctx.fillStyle = 'rgba(255,255,180,0.7)';
    ctx.beginPath(); ctx.ellipse(fx, cy - fh * 0.5, 3, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Ground heat shimmer
  ctx.fillStyle = 'rgba(255,160,80,0.18)';
  ctx.fillRect(cx - 220, cy + 70, 440, 10);
}

// 4.2 — Wide of the street with bodies, a helicopter vanishing.
function dShotStreetDead(ctx, t, now) {
  const sg = ctx.createLinearGradient(0, 0, 0, CH);
  sg.addColorStop(0, '#080608'); sg.addColorStop(0.6, '#2a1814'); sg.addColorStop(1, '#1a0e08');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH);
  // Distant burning city
  for (let i = 0; i < 8; i++) {
    const bx = i * 120;
    const bh = 70 + (i * 31) % 110;
    ctx.fillStyle = '#0a0604';
    ctx.fillRect(bx, GY - 60 - bh, 100, bh);
  }
  ctx.fillStyle = 'rgba(255,80,20,0.18)';
  ctx.fillRect(0, GY - 70, CW, 20);
  // Ground
  ctx.fillStyle = '#1a0e08'; ctx.fillRect(0, GY, CW, CH - GY);

  // Long shadows of debris
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 6; i++) {
    const x = i * 160 + 60;
    ctx.fillRect(x, GY + 4, 80, 4);
  }

  // Bodies scattered across the foreground
  const bodies = [
    { x: 120, y: GY - 4, kind: 'civ' },
    { x: 240, y: GY - 2, kind: 'cop' },
    { x: 380, y: GY - 6, kind: 'civ' },
    { x: 460, y: GY - 4, kind: 'cop' },
    { x: 600, y: GY - 2, kind: 'civ' },
    { x: 720, y: GY - 6, kind: 'cop' },
    { x: 820, y: GY - 4, kind: 'civ' },
  ];
  bodies.forEach(b => {
    // Pool of blood
    ctx.fillStyle = 'rgba(110,5,5,0.55)';
    ctx.beginPath(); ctx.ellipse(b.x, b.y + 4, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Body
    ctx.fillStyle = b.kind === 'cop' ? '#1a2840' : '#3a2818';
    ctx.fillRect(b.x - 16, b.y - 4, 32, 6);
    // Yellow vest if cop
    if (b.kind === 'cop') {
      ctx.fillStyle = '#a08828';
      ctx.fillRect(b.x - 16, b.y - 2, 32, 1.5);
    }
    // Head sideways
    ctx.fillStyle = '#bf8a6a';
    ctx.beginPath(); ctx.arc(b.x - 18, b.y - 4, 3.5, 0, Math.PI * 2); ctx.fill();
  });

  // A wrecked car, smoking
  ctx.fillStyle = '#181818';
  ctx.fillRect(500, GY - 26, 90, 26);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(520, GY - 42, 50, 16);
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(515, GY + 2, 8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(575, GY + 2, 8, 0, Math.PI * 2); ctx.fill();
  // Smoke from the car
  for (let i = 0; i < 5; i++) {
    const sx = 545 + Math.sin(now / 200 + i) * 5;
    const sy = GY - 46 - i * 14;
    ctx.fillStyle = `rgba(40,30,28,${0.45 - i * 0.07})`;
    ctx.beginPath(); ctx.arc(sx, sy, 10 + i * 2, 0, Math.PI * 2); ctx.fill();
  }

  // Helicopter vanishing into the distance — moves up-right as time goes
  const hx = CW * 0.4 - 60 + t * 700;
  const hy = 90 - t * 30;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(hx - 6, hy - 1.5, 12, 3);
  ctx.fillRect(hx + 6, hy - 1, 7, 1.5);
  ctx.fillRect(hx + 11, hy - 4, 1.5, 4);
  ctx.fillStyle = 'rgba(20,20,20,0.65)';
  const rot = now / 30;
  ctx.fillRect(hx - 10 + Math.sin(rot) * 2, hy - 5, 20, 1);
  ctx.fillRect(hx - 10 - Math.sin(rot) * 2, hy - 5, 20, 1);
  // Searchlight beam down (only at first)
  if (t < 0.4) {
    const sgr = ctx.createLinearGradient(hx, hy, hx, GY);
    sgr.addColorStop(0, `rgba(255,230,180,${0.40 - t * 0.7})`);
    sgr.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = sgr;
    ctx.beginPath();
    ctx.moveTo(hx - 4, hy + 2); ctx.lineTo(hx + 4, hy + 2);
    ctx.lineTo(hx + 30, GY); ctx.lineTo(hx - 30, GY);
    ctx.closePath(); ctx.fill();
  }
}

// 5.1 — Soldier on the Fort Omega wall, mid-shot ¾ view, raising his
// rifle to take aim down-range at the encroaching horde. Helmet, vest,
// breath cloud in the cold. Resolute pose.
function dShotSoldierAiming(ctx, t, now) {
  // Deep night sky
  ctx.fillStyle = '#080a18'; ctx.fillRect(0, 0, CW, CH);
  // Stars
  for (let i = 0; i < 50; i++) {
    const sx = (i * 173) % CW;
    const sy = (i * 97) % (GY - 80);
    ctx.fillStyle = `rgba(255,255,255,${0.25 + (i % 5) * 0.12})`;
    ctx.fillRect(sx, sy, 1.4, 1.4);
  }
  // Crescent moon
  ctx.fillStyle = '#dde2d0';
  ctx.beginPath(); ctx.arc(740, 70, 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#080a18';
  ctx.beginPath(); ctx.arc(748, 66, 24, 0, Math.PI * 2); ctx.fill();
  // Distant burning city horizon (low) — provides warm rim light
  const horizon = ctx.createLinearGradient(0, CH - 200, 0, CH - 90);
  horizon.addColorStop(0, 'rgba(120,40,15,0)');
  horizon.addColorStop(1, 'rgba(220,80,30,0.55)');
  ctx.fillStyle = horizon; ctx.fillRect(0, CH - 200, CW, 110);
  ctx.fillStyle = '#0a0a08';
  for (let i = 0; i < 8; i++) {
    const bx = i * 120;
    const bh = 30 + (i * 23) % 60;
    ctx.fillRect(bx, CH - 110 - bh, 110, bh);
  }
  // Rampart top (wall under the soldier)
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(0, CH - 80, CW, 80);
  ctx.fillStyle = '#0e0c08';
  ctx.fillRect(0, CH - 86, CW, 6);
  // Sandbag detail in front
  for (let i = 0; i < 7; i++) {
    const bx = i * 140;
    ctx.fillStyle = '#7a5a32';
    ctx.beginPath();
    ctx.ellipse(bx, CH - 86, 80, 14, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#a07b48';
    ctx.fillRect(bx - 50, CH - 90, 100, 3);
  }

  // The soldier — real in-game sprite scaled up. The sandbag wall is
  // his "ground"; feet land on top of it. Slight wob from rifle recoil
  // is provided by the sprite's own walkPhase. 'shoot' state every
  // other beat gives a subtle muzzle hint paired with the laser dot.
  const sx = CW * 0.45;
  const SCALE_SOL = 4.0;
  const flashOn = Math.floor(now / 220) % 2 === 0;
  const aim = mkIntroSoldier({
    name: 'Delta', weapon: 'sniper', facing: 1,
    state: flashOn ? 'shoot' : 'idle', lastShot: now - 50,
  });
  dSpriteAt(dSoldier, ctx, aim, sx, CH - 90, SCALE_SOL, now);

  // Breath cloud + moonlight rim accent
  const bz = (now / 800) % 1;
  ctx.fillStyle = `rgba(220,225,230,${0.32 * (1 - bz)})`;
  ctx.beginPath();
  ctx.ellipse(sx + 80, CH - 310 - bz * 16, 22 + bz * 14, 10 + bz * 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Red laser sight dot off in the distance
  if (Math.floor(now / 600) % 2 === 0) {
    ctx.fillStyle = 'rgba(255,40,40,0.85)';
    ctx.beginPath(); ctx.arc(CW - 30, CH - 280, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,40,40,0.2)';
    ctx.beginPath(); ctx.arc(CW - 30, CH - 280, 6, 0, Math.PI * 2); ctx.fill();
  }
}

// Old rifle-grip-only close-up (unused).
function _dShotRifleGrip_unused(ctx, t, now) {
  // Dark cool background with a soft orange glow from distant fires
  ctx.fillStyle = '#06070a'; ctx.fillRect(0, 0, CW, CH);
  const grd = ctx.createRadialGradient(CW * 0.7, CH * 0.7, 30, CW * 0.7, CH * 0.7, 500);
  grd.addColorStop(0, 'rgba(255,120,40,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, CW, CH);
  // Subtle moonlight rim from above
  const m = ctx.createLinearGradient(0, 0, 0, CH);
  m.addColorStop(0, 'rgba(140,170,210,0.10)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = m; ctx.fillRect(0, 0, CW, CH);

  // Rifle, drawn very large, diagonal
  ctx.save();
  ctx.translate(CW / 2 - 30, CH / 2 + 20);
  ctx.rotate(-0.18);
  // Stock
  ctx.fillStyle = '#2a1c10';
  ctx.fillRect(-340, -22, 220, 44);
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(-340, 14, 220, 8);
  // Receiver
  ctx.fillStyle = '#181818';
  ctx.fillRect(-120, -28, 140, 50);
  // Barrel
  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(20, -10, 280, 16);
  // Front sight
  ctx.fillRect(280, -22, 6, 14);
  // Magazine
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-80, 22, 32, 56);
  // Trigger guard
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(-40, 36, 14, -0.2, Math.PI + 0.2); ctx.stroke();
  // Scope rail
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-80, -34, 90, 8);

  // The gloved hand on the grip
  // Glove (tan / OD green)
  ctx.fillStyle = '#3a4a30';
  // Knuckles (top of glove curving over the grip)
  ctx.beginPath();
  ctx.moveTo(-90, -20);
  ctx.quadraticCurveTo(-60, -50, -10, -50);
  ctx.quadraticCurveTo(40, -45, 40, 10);
  ctx.lineTo(40, 50);
  ctx.lineTo(-90, 50);
  ctx.closePath(); ctx.fill();
  // Trigger finger extended into the guard
  ctx.fillStyle = '#3a4a30';
  ctx.fillRect(-45, 18, 18, 8);
  // Knuckle creases (darker lines)
  ctx.strokeStyle = '#1f2818'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-50, -30); ctx.lineTo(-30, -36); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-30, -32); ctx.lineTo(-10, -38); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-10, -32); ctx.lineTo(10, -36); ctx.stroke();
  // Glove cuff with strap
  ctx.fillStyle = '#2a3a22';
  ctx.fillRect(20, 30, 40, 22);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(22, 38, 36, 4);

  // Forearm / wrist (sleeve)
  ctx.fillStyle = '#2a3826';
  ctx.fillRect(60, 30, 100, 30);

  ctx.restore();

  // Faint cold breath visible near the top (cold-night detail)
  ctx.fillStyle = 'rgba(220,225,230,0.10)';
  ctx.beginPath(); ctx.ellipse(CW / 2 - 80, 80, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
}

// C.1 — Wide of a military convoy rolling across the dark ruined
// highway toward Fort Omega. Two Humvees + a troop truck, headlights
// cutting through dust + smoke. Soldiers visible in roof turrets.
function dShotConvoyWide(ctx, t, now) {
  // Night sky, very dark with smoke
  const sg = ctx.createLinearGradient(0, 0, 0, GY);
  sg.addColorStop(0, '#080608'); sg.addColorStop(0.7, '#181410'); sg.addColorStop(1, '#2a1a14');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY);
  // Faint distant smoke plumes
  for (let i = 0; i < 10; i++) {
    const sx = (i * 117 + 30) % CW;
    const sy = 30 + (i * 19) % 160;
    ctx.fillStyle = `rgba(28,18,14,${0.30 + (i % 3) * 0.08})`;
    ctx.beginPath(); ctx.arc(sx, sy, 50 + (i % 4) * 12, 0, Math.PI * 2); ctx.fill();
  }
  // Distant skyline silhouette
  for (let i = 0; i < 7; i++) {
    const bx = i * 140;
    const bh = 50 + (i * 31) % 80;
    ctx.fillStyle = '#0a0808';
    ctx.fillRect(bx, GY - 60 - bh, 120, bh);
  }
  // Faint orange horizon glow
  const horizon = ctx.createLinearGradient(0, GY - 40, 0, GY);
  horizon.addColorStop(0, 'rgba(120,40,15,0)');
  horizon.addColorStop(1, 'rgba(180,60,25,0.45)');
  ctx.fillStyle = horizon; ctx.fillRect(0, GY - 40, CW, 40);

  // Highway road
  ctx.fillStyle = '#181818';
  ctx.fillRect(0, GY, CW, CH - GY);
  // Lane markings sliding leftward (we're tracking the convoy moving right)
  ctx.strokeStyle = '#a09a40'; ctx.lineWidth = 2;
  const dash = (now * 0.18) % 80;
  ctx.setLineDash([26, 30]); ctx.lineDashOffset = -dash;
  ctx.beginPath(); ctx.moveTo(0, GY + 50); ctx.lineTo(CW, GY + 50); ctx.stroke();
  ctx.setLineDash([]);
  // Roadside debris on the right shoulder
  ctx.fillStyle = '#0a0a0a';
  for (let d = 0; d < 4; d++) {
    const dx = ((d * 220 + now * 0.18) % (CW + 100)) - 50;
    ctx.fillRect(dx, GY + 6, 18, 5);
  }

  // The convoy — three vehicles moving across. They drift slightly
  // right-to-left within frame (camera tracks slower than truck so
  // they enter from right and exit left over the shot).
  const drift = -t * 240;
  const vehicles = [
    { type: 'humvee', x: 720 + drift },
    { type: 'truck',  x: 480 + drift },
    { type: 'humvee', x: 210 + drift },
  ];
  vehicles.forEach(v => drawConvoyVehicle(ctx, v.x, GY - 4, v.type, now));

  // Headlight cones in front of the lead vehicle
  const leadX = vehicles[0].x + 70;
  const lg = ctx.createLinearGradient(leadX, GY - 30, leadX + 180, GY + 20);
  lg.addColorStop(0, 'rgba(255,230,180,0.55)');
  lg.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.moveTo(leadX, GY - 24); ctx.lineTo(leadX, GY - 12);
  ctx.lineTo(leadX + 220, GY + 6); ctx.lineTo(leadX + 220, GY - 40);
  ctx.closePath(); ctx.fill();
  // Tail-light glow on the rear vehicle
  const rearX = vehicles[2].x - 24;
  ctx.fillStyle = 'rgba(220,40,30,0.6)';
  ctx.fillRect(rearX, GY - 22, 5, 6);

  // Dust trail behind the convoy
  for (let i = 0; i < 10; i++) {
    const dx = vehicles[2].x - 40 - i * 24 + Math.sin(now / 200 + i) * 3;
    if (dx < -20) continue;
    ctx.fillStyle = `rgba(80,60,40,${0.32 - i * 0.025})`;
    ctx.beginPath(); ctx.arc(dx, GY - 8, 14 + i * 3, 0, Math.PI * 2); ctx.fill();
  }

  // Distant FORT OMEGA visible on the horizon to the right —
  // tiny silhouette of wall + searchlight beam
  const fx = CW - 50;
  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(fx, GY - 50, 50, 50);
  ctx.fillRect(fx + 14, GY - 60, 6, 14);
  // Searchlight beam from Fort Omega
  const sweep = Math.sin(now / 1200) * 0.4;
  ctx.save();
  ctx.translate(fx + 16, GY - 60); ctx.rotate(sweep + Math.PI);
  const lg2 = ctx.createLinearGradient(0, 0, 200, 80);
  lg2.addColorStop(0, 'rgba(255,250,200,0.18)');
  lg2.addColorStop(1, 'rgba(255,250,200,0)');
  ctx.fillStyle = lg2;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(220, 30); ctx.lineTo(220, 60); ctx.lineTo(0, 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawConvoyVehicle(ctx, x, y, type, now) {
  if (type === 'humvee') {
    // Boxy military 4x4 in olive drab
    ctx.fillStyle = '#3a4a30';
    ctx.fillRect(x - 60, y - 30, 120, 30);
    ctx.fillStyle = '#2a3826';
    ctx.fillRect(x - 50, y - 50, 90, 20);
    // Windshield
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(x - 30, y - 47, 50, 14);
    // Side door details
    ctx.fillStyle = '#1f2818'; ctx.fillRect(x - 40, y - 24, 30, 18);
    ctx.fillRect(x - 6, y - 24, 30, 18);
    // White ARMY star on door
    ctx.fillStyle = '#dde2d0';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rr = (i % 2 === 0) ? 5 : 2.4;
      const px = x - 25 + Math.cos(ang) * rr;
      const py = y - 14 + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    // Roof-mounted turret with a gunner
    ctx.fillStyle = '#1a1a14';
    ctx.fillRect(x - 12, y - 60, 24, 12);
    // Gunner — head + shoulders + .50 cal
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x - 4, y - 76, 8, 18);
    ctx.fillStyle = '#1a2418';
    ctx.fillRect(x - 5, y - 78, 10, 4); // helmet
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x + 4, y - 70, 24, 4); // turret barrel
    // Wheels
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(x - 40, y + 4, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 40, y + 4, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x - 40, y + 4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 40, y + 4, 6, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'truck') {
    // Larger 6-wheel troop truck with covered bed
    // Cab
    ctx.fillStyle = '#3a4a30';
    ctx.fillRect(x + 30, y - 50, 50, 50);
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(x + 38, y - 46, 36, 18); // windshield
    // Side window
    ctx.fillStyle = '#1f2818'; ctx.fillRect(x + 36, y - 24, 18, 14);
    // Headlights
    ctx.fillStyle = '#fff5c4';
    ctx.fillRect(x + 78, y - 28, 4, 5);
    ctx.fillRect(x + 78, y - 18, 4, 5);
    // Cargo box with canvas cover
    ctx.fillStyle = '#2a3826';
    ctx.fillRect(x - 80, y - 56, 110, 56);
    // Canvas cover (arched ribs)
    ctx.fillStyle = '#3a4a30';
    for (let i = 0; i < 5; i++) ctx.fillRect(x - 80 + i * 22, y - 56, 2, 56);
    ctx.fillStyle = '#1f2818';
    ctx.fillRect(x - 80, y - 60, 110, 6); // top edge
    // Soldiers in the back, just heads visible
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#bf8a6a';
      ctx.beginPath(); ctx.arc(x - 60 + i * 30, y - 56, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a2418';
      ctx.fillRect(x - 64 + i * 30, y - 60, 9, 4);
    }
    // White ARMY star on cargo side
    ctx.fillStyle = '#dde2d0';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rr = (i % 2 === 0) ? 7 : 3.4;
      const px = x - 30 + Math.cos(ang) * rr;
      const py = y - 24 + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    // 6 wheels (3 axles)
    ctx.fillStyle = '#0a0a0a';
    [-60, 0, 50].forEach(wx => {
      ctx.beginPath(); ctx.arc(x + wx, y + 4, 12, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#1a1a1a';
    [-60, 0, 50].forEach(wx => {
      ctx.beginPath(); ctx.arc(x + wx, y + 4, 6, 0, Math.PI * 2); ctx.fill();
    });
  }
}

// C.2 — Close-up of a soldier on top of one of the trucks, rifle in
// hand, looking ahead grimly. Wind blowing his hair. The Fort Omega
// wall visible in the background, growing as they approach.
function dShotConvoyClose(ctx, t, now) {
  // Night sky with smoke
  ctx.fillStyle = '#0a0c14'; ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 8; i++) {
    const sx = (i * 137 + now * 0.05) % (CW + 100) - 50;
    const sy = 40 + (i * 23) % 140;
    ctx.fillStyle = `rgba(30,20,16,${0.35 + (i % 3) * 0.08})`;
    ctx.beginPath(); ctx.arc(sx, sy, 50 + (i % 3) * 10, 0, Math.PI * 2); ctx.fill();
  }
  // Distant Fort Omega wall on the horizon (growing — eased)
  const grow = 1 + t * 0.3;
  const wallY = GY - 60;
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(CW * 0.55, wallY, 360 * grow, 90);
  ctx.fillStyle = '#0e0c08';
  ctx.fillRect(CW * 0.55, wallY - 6, 360 * grow, 6);
  // Crenellations
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(CW * 0.55 + i * 60 * grow, wallY - 16, 12, 10);
  }
  // Watchtower
  ctx.fillStyle = '#181814';
  ctx.fillRect(CW * 0.92, wallY - 50, 30, 50);
  ctx.fillRect(CW * 0.91, wallY - 60, 32, 10);
  // Searchlight from tower
  const lgr = ctx.createLinearGradient(CW * 0.93, wallY - 50, CW * 0.93 - 300, wallY + 100);
  lgr.addColorStop(0, 'rgba(255,250,200,0.4)');
  lgr.addColorStop(1, 'rgba(255,250,200,0)');
  ctx.fillStyle = lgr;
  ctx.beginPath();
  ctx.moveTo(CW * 0.93, wallY - 48); ctx.lineTo(CW * 0.93 - 8, wallY - 38);
  ctx.lineTo(CW * 0.93 - 280, wallY + 60); ctx.lineTo(CW * 0.93 - 260, wallY + 80);
  ctx.closePath(); ctx.fill();
  // Horizon glow
  const horizon = ctx.createLinearGradient(0, GY - 30, 0, GY);
  horizon.addColorStop(0, 'rgba(120,40,15,0)');
  horizon.addColorStop(1, 'rgba(180,60,25,0.4)');
  ctx.fillStyle = horizon; ctx.fillRect(0, GY - 30, CW, 30);
  // Road blurring past below (motion lines)
  ctx.fillStyle = '#181818';
  ctx.fillRect(0, GY, CW, CH - GY);
  ctx.strokeStyle = 'rgba(120,120,100,0.5)'; ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const yy = GY + 8 + i * 14;
    const off = ((now * 0.6 + i * 30) % CW);
    ctx.beginPath();
    ctx.moveTo(CW - off, yy); ctx.lineTo(CW - off + 50, yy + 2); ctx.stroke();
  }

  // Truck cargo bed framing (foreground edges)
  ctx.fillStyle = '#1a2418';
  ctx.fillRect(0, CH - 130, CW, 130);
  ctx.fillStyle = '#0e1408';
  ctx.fillRect(0, CH - 130, CW, 6);
  // Canvas cover top edge framing the top
  ctx.fillStyle = '#1a2418';
  ctx.fillRect(0, 0, CW, 60);
  ctx.fillStyle = '#0e1408';
  ctx.fillRect(0, 56, CW, 6);
  // Canvas rib silhouettes
  ctx.fillStyle = '#0e1408';
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 120, 0, 4, 60);

  // The SOLDIER — large mid-shot, looking forward (right) toward Fort Omega
  const sx = CW * 0.36, sy = CH - 130;
  // Torso visible above the bed edge
  ctx.fillStyle = '#3a4a30';
  ctx.beginPath();
  ctx.moveTo(sx - 80, sy);
  ctx.lineTo(sx - 70, sy - 80);
  ctx.lineTo(sx + 70, sy - 80);
  ctx.lineTo(sx + 80, sy);
  ctx.closePath(); ctx.fill();
  // Tactical vest pouches
  ctx.fillStyle = '#1a2418';
  ctx.fillRect(sx - 60, sy - 60, 40, 50);
  ctx.fillRect(sx + 20, sy - 60, 40, 50);
  ctx.fillStyle = '#a4a230';
  ctx.fillRect(sx - 60, sy - 35, 120, 3); // refl stripe
  // Shoulder patch (american flag-ish)
  ctx.fillStyle = '#0a2855';
  ctx.fillRect(sx + 50, sy - 76, 18, 8);
  ctx.fillStyle = '#dcdcdc';
  for (let i = 0; i < 4; i++) ctx.fillRect(sx + 50, sy - 76 + i * 2, 18, 1);
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(sx + 50, sy - 70, 18, 2);
  // Arms forward + rifle held diagonally across the chest
  ctx.fillStyle = '#3a4a30';
  ctx.fillRect(sx - 80, sy - 70, 30, 70); // left arm
  ctx.fillRect(sx + 50, sy - 70, 30, 70); // right arm
  ctx.fillStyle = '#1a2418';
  ctx.fillRect(sx - 80, sy - 14, 32, 16); // glove
  ctx.fillRect(sx + 48, sy - 14, 32, 16); // glove
  // Rifle held diagonally
  ctx.save();
  ctx.translate(sx, sy - 30);
  ctx.rotate(-0.3);
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(-100, -6, 50, 14); // stock
  ctx.fillStyle = '#181818';
  ctx.fillRect(-50, -8, 60, 16); // receiver
  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(10, -5, 80, 10); // barrel
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-30, 8, 14, 22); // magazine
  ctx.restore();
  // Head — looking forward (right), wind hitting from the front
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath(); ctx.arc(sx, sy - 130, 30, 0, Math.PI * 2); ctx.fill();
  // Helmet
  ctx.fillStyle = '#1a2418';
  ctx.beginPath();
  ctx.moveTo(sx - 32, sy - 140);
  ctx.quadraticCurveTo(sx, sy - 168, sx + 36, sy - 138);
  ctx.lineTo(sx + 36, sy - 116);
  ctx.lineTo(sx - 32, sy - 116);
  ctx.closePath(); ctx.fill();
  // Strap
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(sx - 28, sy - 118, 64, 2);
  // NVG mount up top
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(sx - 4, sy - 162, 14, 6);
  // Eye looking forward (right), squinting against wind
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(sx + 8, sy - 132, 6, 3);
  ctx.fillStyle = '#9a6a4e';
  ctx.fillRect(sx + 6, sy - 138, 12, 2); // brow
  // Stubble jaw
  ctx.fillStyle = '#5a4030';
  ctx.fillRect(sx - 12, sy - 116, 18, 4);
  // Wind streaks across his face/scarf
  ctx.strokeStyle = 'rgba(180,170,150,0.45)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    const yy = sy - 150 + i * 10 + ((now / 12) % 8);
    ctx.beginPath(); ctx.moveTo(sx + 40, yy); ctx.lineTo(sx + 80, yy + 2); ctx.stroke();
  }
  // Breath cloud
  const bz = (now / 700) % 1;
  ctx.fillStyle = `rgba(220,225,230,${0.32 * (1 - bz)})`;
  ctx.beginPath();
  ctx.ellipse(sx + 32, sy - 122 + bz * 4, 14 + bz * 10, 6 + bz * 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Second soldier silhouette in the background (back-to-camera, also
  // looking forward — sells "we're not alone in this truck")
  const sx2 = CW * 0.72, sy2 = CH - 100;
  ctx.fillStyle = '#1a2418';
  ctx.fillRect(sx2 - 16, sy2 - 76, 32, 76);
  ctx.beginPath(); ctx.arc(sx2, sy2 - 86, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(sx2 - 14, sy2 - 96, 28, 8); // helmet
  ctx.fillRect(sx2 + 12, sy2 - 60, 30, 4); // rifle slung
}

// 5.2 — Fort Omega wide: the wall + soldiers + title card.
function dShotFortWide(ctx, t, now) {
  // Deep night sky
  ctx.fillStyle = '#080a18'; ctx.fillRect(0, 0, CW, CH);
  // Stars
  for (let i = 0; i < 70; i++) {
    const sx = (i * 173) % CW;
    const sy = (i * 97) % (GY - 100);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.12})`;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  // Crescent moon
  ctx.fillStyle = '#dde2d0';
  ctx.beginPath(); ctx.arc(740, 80, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#080a18';
  ctx.beginPath(); ctx.arc(750, 76, 26, 0, Math.PI * 2); ctx.fill();
  // Distant burning skyline
  for (let i = 0; i < 8; i++) {
    const bx = i * 120 + 40;
    const bh = 50 + (i * 23) % 80;
    ctx.fillStyle = '#0a0a08';
    ctx.fillRect(bx, GY - 60 - bh, 100, bh);
  }
  // Horizon glow
  const horizon = ctx.createLinearGradient(0, GY - 40, 0, GY);
  horizon.addColorStop(0, 'rgba(120,40,15,0)');
  horizon.addColorStop(1, 'rgba(200,70,25,0.6)');
  ctx.fillStyle = horizon; ctx.fillRect(0, GY - 40, CW, 40);

  // Ground in front of the wall
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(0, GY, CW, CH - GY);

  // The actual game wall
  dBase(ctx, 200, 200);

  // ── Soldiers deployed at ground level IN FRONT of the wall ──────
  // They stand on the killzone road facing right — Fort Omega behind
  // them, the city horizon ahead. Spread out, irregular positions,
  // mix of poses so it reads as a defensive line rather than a row.
  // Feet at GY (true ground), full 1x scale so they're foreground.
  const deployed = [
    { x: WX + 60,  weapon: 'rifle',   pose: 'idle' },               // standing rifle
    { x: WX + 130, weapon: 'shotgun', pose: 'idle' },               // standing shotgun
    { x: WX + 210, weapon: 'rifle',   pose: 'walk' },               // walking forward
    { x: WX + 300, weapon: 'sniper',  pose: 'idle' },               // sniper
    { x: WX + 380, weapon: 'rifle',   pose: 'idle' },               // rear flank
  ];
  // Knee-pad sandbags scattered at their feet — small piles of
  // dirt/cover (not the full wall sandbag emplacement).
  deployed.forEach((d, i) => {
    if (i % 2 === 0) {
      // Small forward sandbag in front of every other soldier
      ctx.fillStyle = '#5a4828';
      ctx.beginPath(); ctx.ellipse(d.x + 18, GY - 2, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#705836';
      ctx.beginPath(); ctx.ellipse(d.x + 8, GY - 1, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6c44';
      ctx.fillRect(d.x + 2, GY - 4, 22, 2);
    }
  });
  deployed.forEach((d, i) => {
    const wob = Math.sin(now / 420 + i * 1.3) * 0.4;
    const sol = mkIntroSoldier({
      name: 'R' + i, weapon: d.weapon, facing: 1,
      state: d.pose, walkPhase: i * 0.7 + wob,
    });
    dSpriteAt(dSoldier, ctx, sol, d.x, GY + wob, 1.0, now);
  });

  // ── Distant zombie horde, approaching slowly from the horizon ───
  // Camera time t∈[0,1]. Zombies start far in the background (small
  // scale ~0.45 at near-horizon) and creep closer over the shot
  // length. They never reach the soldiers in the cinematic — the
  // tension is in the wait.
  const ZSCALE_FAR = 0.42;
  const Z_COUNT = 22;
  // Approach velocity (px over the full shot duration). Slow.
  const totalCreep = 120;
  for (let i = 0; i < Z_COUNT; i++) {
    // Stagger start positions across the right half of the screen
    const startX = CW - 30 + (i % 5) * 18 + Math.floor(i / 5) * 36;
    // Per-zombie speed variation
    const speedJitter = 0.7 + (i * 0.13 % 0.6);
    const zx = startX - t * totalCreep * speedJitter
                      + Math.sin(now / 700 + i * 0.7) * 1.5;
    // Off the right side? Skip (kept in case some random ones start
    // further out)
    if (zx > CW + 30 || zx < WX + 480) continue;
    const ztype = i % 8 === 0 ? 'tank'
                : i % 5 === 0 ? 'runner'
                : 'walker';
    const z = mkIntroZombie({
      type: ztype, facing: -1, state: 'walk',
      walkPhase: i * 0.4,
    });
    // Y-stagger so they don't all sit on the exact horizon line
    const yJit = (i % 3) * 1.5;
    dSpriteAt(dZombie, ctx, z, zx, GY + yJit, ZSCALE_FAR, now);
  }
  // Faint dust haze on the horizon to soften the distant zombies
  const dust = ctx.createLinearGradient(0, GY - 14, 0, GY + 6);
  dust.addColorStop(0, 'rgba(40,35,30,0)');
  dust.addColorStop(0.5, 'rgba(60,50,40,0.18)');
  dust.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = dust;
  ctx.fillRect(WX + 480, GY - 14, CW - WX - 480, 20);

  // Search light sweep from the watchtower over the killzone (over the
  // soldiers' heads, going outward toward the horde).
  const sweep = Math.sin(now / 1200) * 0.4;
  const lx = WX - 22, ly = GY - 226;
  const lgr = ctx.createLinearGradient(lx, ly, lx + 700, ly + 220);
  lgr.addColorStop(0, 'rgba(255,250,200,0.22)');
  lgr.addColorStop(1, 'rgba(255,250,200,0)');
  ctx.fillStyle = lgr;
  ctx.save();
  ctx.translate(lx, ly); ctx.rotate(sweep);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(700, 80); ctx.lineTo(700, 200); ctx.lineTo(0, 16);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ── Per-banner overlay text (drawn at unscaled screen coords) ──
function dBannerText(ctx, shot, elapsed, now) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Show the banner during the shot, fading in and out at its edges
  const inWin = 700, outWin = 700;
  const shotElapsed = elapsed - shot.from;
  const dur = shot.to - shot.from;
  let alpha = Math.min(1,
    Math.min(shotElapsed / inWin, (dur - shotElapsed) / outWin)
  );
  alpha = Math.max(0, alpha);
  ctx.globalAlpha = alpha;
  switch (shot.banner) {
    case 'normal':
      if (shot.draw === 'cafeDrinker') {
        centerText(ctx, 'NEW HAVEN — POPULATION 2.4M', 56, { size: 16, shadow: 0.6 });
        centerText(ctx, '03:17 LOCAL · MARCH 14',        76, { size: 11, color: '#88ccff' });
      }
      break;
    case 'panic':
      if (shot.draw === 'familyFleeing') {
        centerText(ctx, '⚠ OUTBREAK CONFIRMED', 56, { size: 18, color: '#ff5544', shadow: 0.7 });
        centerText(ctx, 'CITY POLICE DISPATCHED · ALL UNITS', 76, { size: 11, color: '#ffaa88' });
      }
      break;
    case 'police':
      if (shot.draw === 'policeLine') {
        centerText(ctx, 'NHPD — CONTAINMENT LINE',                                       56, { size: 16, color: '#88aaff', shadow: 0.7 });
        centerText(ctx, '"Hold the perimeter. Civilians evacuate west."',                76, { size: 11, color: '#cce' });
      } else if (shot.draw === 'copDragged') {
        centerText(ctx, '"…command, this is 0451. We can\'t hold."', 56, { size: 13, color: '#cce', shadow: 0.5 });
        centerText(ctx, '— containment line collapsing —',           76, { size: 11, color: '#ffaa88' });
      }
      break;
    case 'collapse':
      if (shot.draw === 'streetDead') {
        centerText(ctx, 'CITY LOST — EVACUATION FAILED',                  56, { size: 16, color: '#ff6644', shadow: 0.7 });
        centerText(ctx, '0.3% OF CIVILIANS EXTRACTED · MILITARY FALLS BACK', 76, { size: 11, color: '#ffaa88' });
      }
      break;
    case 'convoy':
      if (shot.draw === 'convoyWide') {
        centerText(ctx, 'ARMY RESERVE — CONVOY OMEGA-7',           56, { size: 16, color: '#cce6cc', shadow: 0.6 });
        centerText(ctx, 'EN ROUTE TO FORT OMEGA · ETA 02:14',      76, { size: 11, color: '#88cc88' });
      } else if (shot.draw === 'convoyClose') {
        centerText(ctx, '"All we have left, this is it."', 56, { size: 13, color: '#cce6cc', shadow: 0.5 });
        centerText(ctx, '— last reinforcements inbound —',  76, { size: 11, color: '#88cc88' });
      }
      break;
    case 'fortOmega':
      if (shot.draw === 'fortWide') {
        const localT = elapsed - shot.from;
        const titleA   = Math.min(1, Math.max(0, (localT - 600)  / 1200));
        const taglineA = Math.min(1, Math.max(0, (localT - 2400) / 1400));
        const subA     = Math.min(1, Math.max(0, (localT - 4200) / 1600));
        ctx.globalAlpha = titleA * alpha;
        ctx.fillStyle = '#dde2d0'; ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center';
        ctx.shadowColor = '#cc4422'; ctx.shadowBlur = 16;
        ctx.fillText('DEAD PERIMETER', CW / 2, 120);
        ctx.shadowBlur = 0;
        ctx.font = '11px monospace'; ctx.fillStyle = '#ff8866';
        ctx.fillText('━━━━━━━━━━━━━━━━━━━━━━━━', CW / 2, 138);
        ctx.textAlign = 'left';
        ctx.globalAlpha = taglineA * alpha;
        centerText(ctx, 'FORT OMEGA — THE LAST PERIMETER',     162, { size: 14, color: '#cce6ff', shadow: 0.5 });
        centerText(ctx, '12 SOLDIERS · ONE WALL · NO RELIEF',  182, { size: 11, color: C.acc });
        ctx.globalAlpha = subA * alpha;
        centerText(ctx, 'DAY 1 · 23:47',                       210, { size: 11, color: '#88ccff' });
        centerText(ctx, '— hold what you can —',               228, { size: 10, color: '#cce', weight: 'normal' });
      }
      break;
  }
  ctx.globalAlpha = 1; ctx.restore();
}

// ── Audio scheduling (re-aligned to the 45 s timeline) ─────────
function fireOnce(intro, key, condition, evt) {
  if (!condition) return;
  if (intro._fired.has(key)) return;
  intro._fired.add(key);
  intro.soundQ.push(evt);
}

function scheduleIntroAudio(intro, elapsed) {
  if (!intro._fired) intro._fired = new Set();
  if (!intro.soundQ) intro.soundQ = [];

  // Scene 1 (0-7s): quiet city hum.
  fireOnce(intro, 'hum', elapsed > 200, { t: 'cityHum' });

  // Scene 2 (7-16s): panic — zombie bite hit + sustained screams.
  fireOnce(intro, 'biteHit',  elapsed > 7400, { t: 'zatk' });
  fireOnce(intro, 'scream1',  elapsed > 7100, { t: 'scream' });
  fireOnce(intro, 'scream2',  elapsed > 8400, { t: 'scream' });
  fireOnce(intro, 'scream3',  elapsed > 10600, { t: 'scream' });
  fireOnce(intro, 'scream4',  elapsed > 12100, { t: 'scream' });
  fireOnce(intro, 'scream5',  elapsed > 13800, { t: 'scream' });
  fireOnce(intro, 'scream6',  elapsed > 15200, { t: 'scream' });

  // Scene 3 (16-26.5s): police containment — sirens + sustained fire.
  fireOnce(intro, 'siren1', elapsed > 16100, { t: 'siren' });
  fireOnce(intro, 'siren2', elapsed > 17800, { t: 'siren' });
  fireOnce(intro, 'siren3', elapsed > 20200, { t: 'siren' });
  fireOnce(intro, 'siren4', elapsed > 22500, { t: 'siren' });
  // Cop firing close-up: 4 quick pistol shots up front
  [16200, 16500, 16800, 17100, 17400, 17700, 18000, 18400].forEach((tm, i) => {
    fireOnce(intro, 'gunNear' + i, elapsed > tm, { t: 'shot', w: 'pistol' });
  });
  // Police line wider: mixed fire
  [19700, 20100, 20500, 20900, 21300, 21700, 22100, 22500, 22900, 23300].forEach((tm, i) => {
    fireOnce(intro, 'gunWide' + i, elapsed > tm,
      { t: 'shot', w: (i % 3 === 0) ? 'shotgun' : (i % 2 === 0) ? 'rifle' : 'pistol' });
  });
  // Cop dragged — his pistol firing wildly + final scream
  [23700, 24100, 24500, 24900, 25300, 25700, 26100].forEach((tm, i) => {
    fireOnce(intro, 'gunDrag' + i, elapsed > tm, { t: 'shot', w: 'pistol' });
  });
  fireOnce(intro, 'screamP1', elapsed > 24200, { t: 'scream' });
  fireOnce(intro, 'screamP2', elapsed > 25800, { t: 'scream' });

  // Scene 4 (26.5-32s): collapse — drop hum, start wind, last defender fires.
  fireOnce(intro, 'humOff',   elapsed > 26400, { t: 'cityHumStop' });
  fireOnce(intro, 'windOn',   elapsed > 26500, { t: 'windStart', intensity: 0.55 });
  // Last defender's rifle (rapid-fire)
  [26700, 27000, 27300, 27600, 27900, 28200, 28500, 28800, 29100, 29400].forEach((tm, i) => {
    fireOnce(intro, 'lastShot' + i, elapsed > tm, { t: 'shot', w: 'rifle' });
  });
  // Fire crackles
  [27200, 28200, 29200, 30200, 31200].forEach((tm, i) => {
    fireOnce(intro, 'crack' + i, elapsed > tm, { t: 'crackle' });
  });

  // Scene C (32-38.5s): military convoy — heli (distant air support)
  // + soft wind.
  fireOnce(intro, 'heliFar',    elapsed > 32000, { t: 'heliStart', intensity: 0.45 });
  fireOnce(intro, 'heliFarOff', elapsed > 38000, { t: 'heliStop' });

  // Scene 5 (38.5-50s): Fort Omega — title sting + wind out for the hush.
  fireOnce(intro, 'sting',   elapsed > 43200, { t: 'titleSting' });
  fireOnce(intro, 'windOff', elapsed > 47500, { t: 'windStop' });

  // Backstop: kill any lingering loop at the very end.
  if (elapsed >= INTRO_DURATION) {
    fireOnce(intro, 'finalHum',  true, { t: 'cityHumStop' });
    fireOnce(intro, 'finalWind', true, { t: 'windStop' });
    fireOnce(intro, 'finalHeli', true, { t: 'heliStop' });
  }
}

// ── Public entry ───────────────────────────────────────────────
const DRAWERS = {
  cafeDrinker:    dShotCafeDrinker,
  quietStreet:    dShotQuietStreet,
  zombieBite:     dShotZombieBite,
  familyFleeing:  dShotFamilyFleeing,
  streetChaos:    dShotStreetChaos,
  copFiring:      dShotCopFiring,
  policeLine:     dShotPoliceLine,
  copDragged:     dShotCopDragged,
  lastDefender:   dShotLastDefender,
  streetDead:     dShotStreetDead,
  convoyWide:     dShotConvoyWide,
  convoyClose:    dShotConvoyClose,
  soldierAiming:  dShotSoldierAiming,
  fortWide:       dShotFortWide,
};

export function dIntroScene(ctx, intro, now) {
  const elapsed = now - (intro.startedAt || now);
  scheduleIntroAudio(intro, elapsed);
  const tNow = Math.min(elapsed, INTRO_DURATION - 1);
  const shot = findShot(tNow);
  const shotT = (tNow - shot.from) / (shot.to - shot.from); // 0..1

  ctx.save(); ctx.clearRect(0, 0, CW, CH);
  const drawer = DRAWERS[shot.draw];
  if (drawer) drawer(ctx, shotT, now);

  // Short fade-from-black between shots that sit at scene boundaries
  // (otherwise rely on hard cuts).
  const sceneBoundary = (s) => [7000, 16000, 26500, 32000, 38500].includes(s.from);
  if (sceneBoundary(shot) && shotT < 0.10) {
    ctx.fillStyle = `rgba(0,0,0,${1 - shotT / 0.10})`;
    ctx.fillRect(0, 0, CW, CH);
  }

  // Banner text per shot
  dBannerText(ctx, shot, elapsed, now);

  // Letterboxing + progress + SKIP (always screen-space)
  dLetterbox(ctx);
  dProgressBar(ctx, Math.min(1, elapsed / INTRO_DURATION));
  dSkipButton(ctx, intro);

  ctx.restore();
}
