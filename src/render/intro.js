import { C, CW, CH, GY, WX, LANES, laneY, DPR } from '../constants.js';
import { dBase } from './base.js';
import { dSoldier } from './soldier.js';
import { dBg } from './background.js';
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
  const m = drawFn(ctx, e, now);
  ctx.restore();
  // Screen position of the muzzle (dSoldier only), for flash overlays.
  return m ? [screenX + m[0] * scale, screenFootY - GY * scale + m[1] * scale] : null;
}

// Convenience entity builders for the cinematic. These are minimal
// records that satisfy dSoldier / dZombie's expectations without
// pulling in the full mkSoldier / mkZombie factories.
function mkIntroSoldier(opts = {}) {
  return {
    id: opts.id || 'i', name: opts.name || 'X',   // stable id: the look comes from name + id
    weapon: opts.weapon || 'rifle',
    hp: opts.hp ?? 100, maxHp: 100,
    ammo: opts.ammo ?? 30, maxAmmo: 30,
    state: opts.state || 'idle',
    facing: opts.facing ?? 1,
    civilian: !!opts.civilian, bandit: !!opts.bandit, police: !!opts.police, swat: !!opts.swat,
    onRoof: false, onExpedition: false,
    walkPhase: opts.walkPhase ?? Math.random() * Math.PI * 2,
    lastShot: opts.lastShot ?? 0, reloadStart: 0, shootAt: opts.lastShot ?? 0, knifeTimer: 0,
    hurtTimer: 0, recoil: 0,
  };
}

function mkIntroZombie(opts = {}) {
  const type = opts.type || 'walker';
  const ztp = ZTP[type] || ZTP.walker;
  return {
    id: opts.id || 'iz',   // stable: the outfit is picked from the id
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

  // The patron — three-quarter side view, leaning forward over his
  // coffee, phone close to the face. Drawn with curved silhouettes
  // and anatomy callouts (jaw, neck, shoulder, arm, hand) so the
  // shape reads as a person, not a polygon.
  const px = 290, py = CH - 160;
  const pulse = (Math.sin(now / 220) * 0.5 + 0.5);

  // ── Chair ────────────────────────────────────────────────────
  // Back support (vertical bar tucked behind the figure)
  ctx.fillStyle = '#1a1410'; ctx.fillRect(px - 72, py - 96, 12, 152);
  ctx.fillStyle = '#0e0a08'; ctx.fillRect(px - 72, py - 96, 12, 4);
  // Top rail of chair back
  ctx.fillStyle = '#241a12';
  ctx.beginPath();
  ctx.moveTo(px - 78, py - 98); ctx.lineTo(px - 54, py - 102);
  ctx.lineTo(px - 50, py - 90); ctx.lineTo(px - 76, py - 86);
  ctx.closePath(); ctx.fill();
  // Seat slat peeking behind the patron (just under the lower back)
  ctx.fillStyle = '#1a1410'; ctx.fillRect(px - 78, py + 4, 60, 6);

  // ── Body ─────────────────────────────────────────────────────
  // Sweater base colour
  const sweater = '#2d3046';
  const sweaterShadow = '#1c1f30';
  const skin   = '#c69a78';
  const skinShadow = '#9a7256';

  // Back / spine curve — leaning forward over the table
  ctx.fillStyle = sweater;
  ctx.beginPath();
  // Start at the lumbar, curve up to the shoulder blade, over the
  // shoulder, then down the front of the chest to the lap.
  ctx.moveTo(px - 40, py + 32);
  ctx.bezierCurveTo(px - 56, py - 18, px - 58, py - 70, px - 28, py - 96); // back
  ctx.bezierCurveTo(px - 10, py - 108, px + 22, py - 104, px + 36, py - 92); // shoulder line
  ctx.bezierCurveTo(px + 50, py - 60, px + 56, py - 16, px + 48, py + 20); // chest curve
  ctx.lineTo(px + 44, py + 56);
  ctx.lineTo(px - 36, py + 56);
  ctx.closePath();
  ctx.fill();

  // Shoulder shadow (folds where the arm meets the torso)
  ctx.fillStyle = sweaterShadow;
  ctx.beginPath();
  ctx.moveTo(px + 14, py - 94);
  ctx.bezierCurveTo(px + 22, py - 70, px + 28, py - 40, px + 22, py - 16);
  ctx.bezierCurveTo(px + 14, py - 40, px + 8, py - 72, px + 8, py - 92);
  ctx.closePath(); ctx.fill();
  // Spine shadow line down the back
  ctx.beginPath();
  ctx.moveTo(px - 38, py + 30);
  ctx.bezierCurveTo(px - 46, py - 10, px - 48, py - 50, px - 30, py - 86);
  ctx.lineWidth = 1.5; ctx.strokeStyle = sweaterShadow; ctx.stroke();

  // ── Neck ─────────────────────────────────────────────────────
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(px + 4, py - 96);
  ctx.bezierCurveTo(px + 4, py - 104, px + 26, py - 106, px + 28, py - 96);
  ctx.lineTo(px + 28, py - 84);
  ctx.lineTo(px + 4, py - 84);
  ctx.closePath(); ctx.fill();
  // Neck shadow under the jaw
  ctx.fillStyle = skinShadow;
  ctx.fillRect(px + 4, py - 88, 24, 4);

  // ── Left arm (camera-side): rests on the table, holding the mug ─
  // Upper arm tucked against the torso, forearm extending forward
  ctx.fillStyle = sweater;
  ctx.beginPath();
  ctx.moveTo(px + 38, py - 88);
  ctx.bezierCurveTo(px + 58, py - 78, px + 70, py - 50, px + 70, py - 18);
  ctx.lineTo(px + 80, py - 16);
  ctx.bezierCurveTo(px + 76, py - 52, px + 64, py - 82, px + 46, py - 96);
  ctx.closePath(); ctx.fill();
  // Forearm reaching forward
  ctx.beginPath();
  ctx.moveTo(px + 66, py - 22);
  ctx.bezierCurveTo(px + 96, py - 22, px + 124, py - 26, px + 142, py - 30);
  ctx.lineTo(px + 142, py - 18);
  ctx.bezierCurveTo(px + 122, py - 14, px + 92, py - 10, px + 68, py - 12);
  ctx.closePath(); ctx.fill();
  // Cuff line
  ctx.fillStyle = sweaterShadow;
  ctx.fillRect(px + 138, py - 30, 4, 14);
  // Hand resting on table — visible knuckles
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(px + 152, py - 22, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Thumb
  ctx.beginPath();
  ctx.ellipse(px + 148, py - 14, 3, 4, 0.2, 0, Math.PI * 2); ctx.fill();
  // Knuckle creases
  ctx.fillStyle = skinShadow;
  ctx.fillRect(px + 150, py - 26, 8, 1);
  ctx.fillRect(px + 150, py - 22, 8, 1);

  // ── Right arm (raised, holding the phone close to face) ──────
  // Upper arm — shoulder out, elbow bent up
  ctx.fillStyle = sweater;
  ctx.beginPath();
  ctx.moveTo(px - 4, py - 100);
  ctx.bezierCurveTo(px - 16, py - 116, px - 16, py - 130, px - 8, py - 142);
  ctx.bezierCurveTo(px + 4, py - 138, px + 14, py - 122, px + 14, py - 104);
  ctx.closePath(); ctx.fill();
  // Forearm — angles up toward face
  ctx.beginPath();
  ctx.moveTo(px - 10, py - 138);
  ctx.bezierCurveTo(px - 6, py - 154, px + 4, py - 162, px + 16, py - 162);
  ctx.lineTo(px + 22, py - 150);
  ctx.bezierCurveTo(px + 12, py - 148, px + 4, py - 142, px + 2, py - 130);
  ctx.closePath(); ctx.fill();
  // Wrist + hand gripping the phone
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(px + 18, py - 158, 10, 6, -0.1, 0, Math.PI * 2); ctx.fill();

  // ── Phone (rotated, glowing screen, pulsing alert) ───────────
  ctx.save();
  ctx.translate(px + 26, py - 162);
  ctx.rotate(-0.18);
  // Bezel
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-14, -28, 28, 56);
  // Screen
  ctx.fillStyle = '#1a4ccc';
  ctx.fillRect(-12, -26, 24, 52);
  // Pulsing red alert banner
  ctx.fillStyle = `rgba(220,30,30,${0.6 + pulse * 0.35})`;
  ctx.fillRect(-12, -26, 24, 11);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 4px monospace'; ctx.textAlign = 'center';
  ctx.fillText('CITY ALERT', 0, -19);
  ctx.font = '3.5px monospace';
  ctx.fillText('SHELTER IN', 0, -10);
  ctx.fillText('PLACE NOW', 0, -4);
  // Camera bump
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(0, -32, 2, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left';
  ctx.restore();

  // ── Head ─────────────────────────────────────────────────────
  // Jaw line — egg-shaped, slightly tilted toward the phone
  const hx = px + 14, hy = py - 110;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(hx - 18, hy - 4);
  ctx.bezierCurveTo(hx - 22, hy - 28, hx - 12, hy - 42, hx + 4, hy - 42);
  ctx.bezierCurveTo(hx + 20, hy - 42, hx + 30, hy - 30, hx + 30, hy - 10);
  ctx.bezierCurveTo(hx + 30, hy + 4,  hx + 26, hy + 14, hx + 14, hy + 18);
  ctx.bezierCurveTo(hx + 2, hy + 22, hx - 12, hy + 16, hx - 18, hy + 6);
  ctx.closePath(); ctx.fill();
  // Jaw shadow
  ctx.fillStyle = skinShadow;
  ctx.beginPath();
  ctx.moveTo(hx - 14, hy + 8);
  ctx.bezierCurveTo(hx + 4, hy + 22, hx + 24, hy + 14, hx + 28, hy + 4);
  ctx.lineTo(hx + 28, hy + 8);
  ctx.bezierCurveTo(hx + 22, hy + 18, hx + 0, hy + 24, hx - 16, hy + 12);
  ctx.closePath(); ctx.fill();
  // Ear (small, partial — back side of head)
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.ellipse(hx - 18, hy - 8, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skinShadow;
  ctx.fillRect(hx - 19, hy - 6, 2, 3);
  // Hair — short, dark, with a forward fringe
  ctx.fillStyle = '#1f140e';
  ctx.beginPath();
  ctx.moveTo(hx - 22, hy - 6);
  ctx.bezierCurveTo(hx - 24, hy - 36, hx - 8, hy - 50, hx + 8, hy - 50);
  ctx.bezierCurveTo(hx + 26, hy - 50, hx + 34, hy - 36, hx + 32, hy - 18);
  ctx.bezierCurveTo(hx + 28, hy - 26, hx + 14, hy - 30, hx + 0, hy - 26);
  ctx.bezierCurveTo(hx - 10, hy - 22, hx - 18, hy - 16, hx - 22, hy - 6);
  ctx.closePath(); ctx.fill();
  // Fringe accent (lighter strands)
  ctx.fillStyle = '#2e1f14';
  ctx.beginPath();
  ctx.ellipse(hx + 4, hy - 32, 14, 5, -0.1, 0, Math.PI * 2); ctx.fill();
  // Eyebrow (furrowed, slightly slanted)
  ctx.fillStyle = '#1a120c';
  ctx.beginPath();
  ctx.moveTo(hx + 12, hy - 16); ctx.lineTo(hx + 26, hy - 14);
  ctx.lineTo(hx + 26, hy - 12); ctx.lineTo(hx + 12, hy - 13);
  ctx.closePath(); ctx.fill();
  // Eye socket shadow + eye
  ctx.fillStyle = skinShadow;
  ctx.fillRect(hx + 14, hy - 11, 12, 3);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(hx + 18, hy - 10, 4, 2);
  // Nose bridge (subtle shadow) + nostril
  ctx.fillStyle = skinShadow;
  ctx.beginPath();
  ctx.moveTo(hx + 28, hy - 8);
  ctx.lineTo(hx + 32, hy - 4);
  ctx.lineTo(hx + 30, hy);
  ctx.lineTo(hx + 28, hy - 4);
  ctx.closePath(); ctx.fill();
  // Mouth — slightly parted (worried)
  ctx.fillStyle = '#3a1f1a';
  ctx.fillRect(hx + 18, hy + 8, 8, 2);
  ctx.fillStyle = '#5a3026';
  ctx.fillRect(hx + 18, hy + 7, 8, 1);
  // Cool blue light spill on face from phone (above + foreground)
  ctx.fillStyle = `rgba(40,90,210,${0.18 + pulse * 0.14})`;
  ctx.beginPath();
  ctx.arc(hx + 18, hy - 4, 28, 0, Math.PI * 2); ctx.fill();
  // Highlight on the cheek closest to the phone
  ctx.fillStyle = `rgba(150,180,230,${0.10 + pulse * 0.06})`;
  ctx.beginPath();
  ctx.ellipse(hx + 22, hy - 2, 10, 6, -0.2, 0, Math.PI * 2); ctx.fill();

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
  // flying, one arm pushing at the zombie's face. Body silhouette is
  // built from bezier curves (shoulders, ribcage, hips, drape of the
  // coat) instead of stacked vertices so it reads as a person, not a
  // paper cutout.
  const vx = CW * 0.30 + tug, vy = CH * 0.55;
  // ── Coat ────────────────────────────────────────────────────
  // Hem flares slightly with the struggle motion.
  const hemSway = Math.sin(now / 220) * 4;
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath();
  ctx.moveTo(vx - 52 + hemSway * 0.3, vy + 130);                                // hem L
  ctx.bezierCurveTo(vx - 64, vy + 60, vx - 64, vy - 4, vx - 58, vy - 36);       // outer L (waist → ribs)
  ctx.bezierCurveTo(vx - 56, vy - 60, vx - 48, vy - 76, vx - 30, vy - 82);      // L shoulder slope
  ctx.bezierCurveTo(vx - 14, vy - 86, vx + 8, vy - 84, vx + 28, vy - 76);       // collar opening
  ctx.bezierCurveTo(vx + 46, vy - 70, vx + 56, vy - 56, vx + 60, vy - 32);      // R shoulder/ribs
  ctx.bezierCurveTo(vx + 64, vy - 4, vx + 64, vy + 60, vx + 54 - hemSway * 0.3, vy + 130);
  ctx.closePath(); ctx.fill();
  // Coat front opening (centre seam), suggested with a curved shadow
  ctx.strokeStyle = '#5a3622'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(vx + 4, vy - 78);
  ctx.bezierCurveTo(vx + 6, vy - 40, vx + 2, vy + 40, vx, vy + 126);
  ctx.stroke();
  // Lapel
  ctx.fillStyle = '#5a3622';
  ctx.beginPath();
  ctx.moveTo(vx + 4, vy - 78); ctx.lineTo(vx + 26, vy - 70);
  ctx.lineTo(vx + 12, vy - 46); ctx.closePath(); ctx.fill();
  // Belt — a curved band that follows the waist, with a buckle
  ctx.fillStyle = '#3a2010';
  ctx.beginPath();
  ctx.moveTo(vx - 60, vy - 20);
  ctx.bezierCurveTo(vx - 30, vy - 14, vx + 30, vy - 14, vx + 60, vy - 20);
  ctx.lineTo(vx + 60, vy - 12);
  ctx.bezierCurveTo(vx + 30, vy - 6, vx - 30, vy - 6, vx - 60, vy - 12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8a6840';
  ctx.fillRect(vx - 4, vy - 18, 8, 6); // buckle

  // ── Head, tilted back in a scream ───────────────────────────
  // Skull as an ellipse (head, not a sphere) with a jaw drop wedge
  // suggesting the open mouth posture.
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath();
  ctx.ellipse(vx + 8, vy - 110, 30, 36, -0.15, 0, Math.PI * 2);
  ctx.fill();
  // Neck (visible because the head is thrown back)
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath();
  ctx.moveTo(vx - 8, vy - 80);
  ctx.bezierCurveTo(vx - 4, vy - 70, vx + 14, vy - 70, vx + 18, vy - 80);
  ctx.lineTo(vx + 18, vy - 92); ctx.lineTo(vx - 8, vy - 92);
  ctx.closePath(); ctx.fill();
  // Jaw-line shadow (gives the chin its angle)
  ctx.fillStyle = '#9a6a4e';
  ctx.beginPath();
  ctx.moveTo(vx - 18, vy - 96);
  ctx.bezierCurveTo(vx - 10, vy - 80, vx + 24, vy - 78, vx + 32, vy - 92);
  ctx.bezierCurveTo(vx + 24, vy - 88, vx - 10, vy - 88, vx - 18, vy - 96);
  ctx.closePath(); ctx.fill();

  // ── Long flowing hair (multiple bezier strands, not flat flaps) ──
  // Behind the head (deepest), drawn first so face overlays it.
  const hairDark = '#1f1208';
  const hairMid  = '#2c1812';
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.moveTo(vx - 12, vy - 130);
  ctx.bezierCurveTo(vx - 50, vy - 130, vx - 86, vy - 100, vx - 86, vy - 60);
  ctx.bezierCurveTo(vx - 80, vy - 56, vx - 60, vy - 70, vx - 40, vy - 86);
  ctx.bezierCurveTo(vx - 28, vy - 96, vx - 18, vy - 110, vx - 12, vy - 130);
  ctx.closePath(); ctx.fill();
  // Mid-length strand at the top crown
  ctx.fillStyle = hairMid;
  ctx.beginPath();
  ctx.moveTo(vx - 22, vy - 138);
  ctx.bezierCurveTo(vx - 50, vy - 134, vx - 70, vy - 118, vx - 72, vy - 96);
  ctx.bezierCurveTo(vx - 64, vy - 100, vx - 46, vy - 116, vx - 30, vy - 128);
  ctx.closePath(); ctx.fill();
  // Wisps flying forward over the brow
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.moveTo(vx + 10, vy - 140);
  ctx.bezierCurveTo(vx + 28, vy - 136, vx + 38, vy - 126, vx + 36, vy - 110);
  ctx.bezierCurveTo(vx + 28, vy - 120, vx + 16, vy - 130, vx + 8, vy - 130);
  ctx.closePath(); ctx.fill();
  // Skull-cap (top of head where hair is parted)
  ctx.fillStyle = hairMid;
  ctx.beginPath();
  ctx.moveTo(vx - 18, vy - 138);
  ctx.bezierCurveTo(vx, vy - 150, vx + 22, vy - 144, vx + 26, vy - 130);
  ctx.bezierCurveTo(vx + 8, vy - 138, vx - 8, vy - 138, vx - 18, vy - 138);
  ctx.closePath(); ctx.fill();

  // ── Eyes (round eyeball + iris + pupil, not flat rectangles) ──
  // Eye socket shadow
  ctx.fillStyle = '#5a3622';
  ctx.beginPath();
  ctx.ellipse(vx + 4, vy - 118, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.ellipse(vx + 16, vy - 118, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
  // Sclera (whites)
  ctx.fillStyle = '#f0e8d4';
  ctx.beginPath();
  ctx.ellipse(vx + 4, vy - 118, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.ellipse(vx + 16, vy - 118, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  // Iris (terror-wide, looking up and to the right at the zombie)
  ctx.fillStyle = '#3a2a18';
  ctx.beginPath(); ctx.arc(vx + 6, vy - 119, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(vx + 18, vy - 119, 2, 0, Math.PI * 2); ctx.fill();
  // Pupils (dilated)
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(vx + 6, vy - 119, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(vx + 18, vy - 119, 1.2, 0, Math.PI * 2); ctx.fill();
  // Eyebrows raised in fear — thin tapered strokes, not bars
  ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(vx - 2, vy - 126); ctx.quadraticCurveTo(vx + 4, vy - 130, vx + 10, vy - 124); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(vx + 12, vy - 124); ctx.quadraticCurveTo(vx + 18, vy - 130, vx + 24, vy - 124); ctx.stroke();
  ctx.lineCap = 'butt';
  // Tear streak from the right eye
  ctx.fillStyle = 'rgba(200,220,230,0.6)';
  ctx.beginPath();
  ctx.ellipse(vx + 18, vy - 110, 1, 5, 0, 0, Math.PI * 2); ctx.fill();

  // ── Mouth wide open (screaming) ────────────────────────────
  // Open maw with rounded lip rim + teeth, plus a tongue suggestion.
  ctx.fillStyle = '#2a0606';
  ctx.beginPath();
  ctx.ellipse(vx + 10, vy - 92, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
  // Lip rim (slightly lighter outer band)
  ctx.strokeStyle = '#5a2818'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(vx + 10, vy - 92, 10, 14, 0, 0, Math.PI * 2); ctx.stroke();
  // Upper teeth
  ctx.fillStyle = '#f0e8d4';
  ctx.fillRect(vx + 3, vy - 100, 14, 3);
  // Tongue
  ctx.fillStyle = '#7a2a2a';
  ctx.beginPath();
  ctx.ellipse(vx + 10, vy - 86, 5, 3, 0, 0, Math.PI * 2); ctx.fill();

  // ── Pushing arm extended toward the zombie's face ──
  // Drawn as a tapering bezier shape so it has a real elbow + wrist,
  // not just a fat round-capped line.
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath();
  ctx.moveTo(vx + 32, vy - 70);                                 // shoulder
  ctx.bezierCurveTo(vx + 60, vy - 76, vx + 90, vy - 96, vx + 116, vy - 102); // upper arm/elbow → forearm
  ctx.bezierCurveTo(vx + 118, vy - 100, vx + 118, vy - 98, vx + 116, vy - 96);
  ctx.bezierCurveTo(vx + 90, vy - 90, vx + 60, vy - 70, vx + 36, vy - 58);   // back along underside
  ctx.closePath(); ctx.fill();
  // Sleeve (coat material covers upper third of the arm)
  ctx.fillStyle = '#8a5a3a';
  ctx.beginPath();
  ctx.moveTo(vx + 30, vy - 76);
  ctx.bezierCurveTo(vx + 50, vy - 80, vx + 70, vy - 86, vx + 80, vy - 86);
  ctx.lineTo(vx + 78, vy - 76);
  ctx.bezierCurveTo(vx + 60, vy - 70, vx + 40, vy - 64, vx + 32, vy - 60);
  ctx.closePath(); ctx.fill();
  // Sleeve cuff
  ctx.fillStyle = '#5a3622';
  ctx.beginPath();
  ctx.moveTo(vx + 76, vy - 88); ctx.lineTo(vx + 86, vy - 90);
  ctx.lineTo(vx + 84, vy - 80); ctx.lineTo(vx + 74, vy - 78);
  ctx.closePath(); ctx.fill();
  // Hand splayed in a defensive push (palm-out, fingers spread)
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath();
  ctx.ellipse(vx + 116, vy - 100, 10, 8, -0.3, 0, Math.PI * 2); ctx.fill();
  // Spread fingers
  ctx.strokeStyle = '#bf8a6a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (let f = 0; f < 4; f++) {
    const ang = -1.0 + f * 0.35;
    ctx.beginPath();
    ctx.moveTo(vx + 116, vy - 100);
    ctx.lineTo(vx + 116 + Math.cos(ang) * 14, vy - 100 + Math.sin(ang) * 14);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  // The zombie — real in-game dZombie sprite scaled up, in the
  // 'attack' state so its arms are out and it's leaning into the bite.
  // Tug animation moves it slightly toward the victim each frame.
  const zx = CW * 0.65 - tug;
  const ZSCALE = 4.5;
  const biteZ = mkIntroZombie({
    id: 'ib', type: 'walker', facing: -1, state: 'attack',
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
  // Silhouettes against the fire-glow horizon — drawn with curved
  // running anatomy (leaning torso, swinging arms, mid-stride legs)
  // so they read as people in motion, not stick figures.
  const fx = CW * 0.7 - t * 280;
  const wob = Math.sin(now / 130) * 2.5;
  const stride = Math.sin(now / 100);
  const armSwing = Math.sin(now / 100 + Math.PI);
  const silhouette = '#0a0606';

  // ── Adult (leaning forward in a run, free arm pumping back) ──
  ctx.fillStyle = silhouette;
  // Torso (leaning forward)
  ctx.beginPath();
  ctx.moveTo(fx - 7, GY - 60 + wob * 0.4);
  ctx.bezierCurveTo(fx - 10, GY - 50, fx - 10, GY - 38, fx - 8, GY - 30);
  ctx.lineTo(fx + 6, GY - 28);
  ctx.bezierCurveTo(fx + 8, GY - 40, fx + 8, GY - 54, fx + 5, GY - 62 + wob * 0.4);
  ctx.closePath(); ctx.fill();
  // Head + neck
  ctx.beginPath();
  ctx.ellipse(fx + 1, GY - 70 + wob * 0.4, 6, 7, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(fx - 2, GY - 64 + wob * 0.4, 5, 4);
  // Hair flying back
  ctx.beginPath();
  ctx.moveTo(fx + 4, GY - 76); ctx.lineTo(fx + 12, GY - 70);
  ctx.lineTo(fx + 6, GY - 68); ctx.closePath(); ctx.fill();
  // Forward arm pulling the child (leading toward the child)
  ctx.beginPath();
  ctx.moveTo(fx - 4, GY - 50);
  ctx.bezierCurveTo(fx - 12, GY - 46, fx - 20, GY - 40, fx - 24, GY - 36);
  ctx.lineTo(fx - 22, GY - 32);
  ctx.bezierCurveTo(fx - 16, GY - 36, fx - 8, GY - 42, fx - 2, GY - 46);
  ctx.closePath(); ctx.fill();
  // Free arm pumping back (running motion)
  const backArmY = GY - 44 + armSwing * 6;
  ctx.beginPath();
  ctx.moveTo(fx + 5, GY - 52);
  ctx.bezierCurveTo(fx + 14, GY - 50, fx + 20, backArmY, fx + 22, backArmY + 4);
  ctx.lineTo(fx + 18, backArmY + 6);
  ctx.bezierCurveTo(fx + 14, backArmY + 2, fx + 8, GY - 48, fx + 3, GY - 48);
  ctx.closePath(); ctx.fill();
  // Mid-stride legs — one forward, one back-pushing
  ctx.beginPath();
  // Forward leg (thigh bent up, calf down)
  ctx.moveTo(fx - 6, GY - 30);
  ctx.bezierCurveTo(fx - 12, GY - 22, fx - 14 + stride * 4, GY - 12, fx - 12 + stride * 6, GY - 6);
  ctx.lineTo(fx - 8 + stride * 6, GY - 6);
  ctx.bezierCurveTo(fx - 8 + stride * 4, GY - 12, fx - 4, GY - 22, fx - 2, GY - 30);
  ctx.closePath(); ctx.fill();
  // Back-pushing leg (extended behind)
  ctx.beginPath();
  ctx.moveTo(fx + 2, GY - 30);
  ctx.bezierCurveTo(fx + 6, GY - 22, fx + 10 - stride * 4, GY - 14, fx + 12 - stride * 6, GY - 8);
  ctx.lineTo(fx + 16 - stride * 6, GY - 8);
  ctx.bezierCurveTo(fx + 14 - stride * 4, GY - 14, fx + 10, GY - 22, fx + 6, GY - 30);
  ctx.closePath(); ctx.fill();
  // Feet
  ctx.fillRect(fx - 14 + stride * 6, GY - 7, 7, 3);
  ctx.fillRect(fx + 10 - stride * 6, GY - 9, 7, 3);

  // ── Child (small, being pulled along, struggling to keep up) ──
  const cx = fx - 28;
  const childStride = Math.sin(now / 90);
  // Torso (smaller, more upright)
  ctx.beginPath();
  ctx.moveTo(cx - 5, GY - 34 + wob * 0.3);
  ctx.bezierCurveTo(cx - 7, GY - 28, cx - 7, GY - 22, cx - 5, GY - 18);
  ctx.lineTo(cx + 4, GY - 18);
  ctx.bezierCurveTo(cx + 6, GY - 24, cx + 6, GY - 30, cx + 3, GY - 35 + wob * 0.3);
  ctx.closePath(); ctx.fill();
  // Head (proportionally bigger relative to body)
  ctx.beginPath();
  ctx.arc(cx, GY - 40 + wob * 0.3, 5, 0, Math.PI * 2); ctx.fill();
  // Hair (longer, flying back)
  ctx.beginPath();
  ctx.moveTo(cx + 3, GY - 42); ctx.lineTo(cx + 10, GY - 38);
  ctx.lineTo(cx + 4, GY - 36); ctx.closePath(); ctx.fill();
  // Reaching arm (gripping adult's hand)
  ctx.beginPath();
  ctx.moveTo(cx + 3, GY - 28);
  ctx.bezierCurveTo(cx + 9, GY - 28, cx + 16, GY - 32, cx + 20, GY - 34);
  ctx.lineTo(cx + 20, GY - 30);
  ctx.bezierCurveTo(cx + 14, GY - 28, cx + 8, GY - 24, cx + 4, GY - 24);
  ctx.closePath(); ctx.fill();
  // Trailing arm (small backswing)
  ctx.beginPath();
  ctx.moveTo(cx - 4, GY - 28);
  ctx.bezierCurveTo(cx - 8, GY - 26, cx - 10, GY - 22, cx - 9, GY - 18);
  ctx.lineTo(cx - 6, GY - 20);
  ctx.closePath(); ctx.fill();
  // Legs mid-stride
  ctx.beginPath();
  ctx.moveTo(cx - 4, GY - 18);
  ctx.bezierCurveTo(cx - 6, GY - 12, cx - 6 + childStride * 3, GY - 8, cx - 6 + childStride * 4, GY - 4);
  ctx.lineTo(cx - 3 + childStride * 4, GY - 4);
  ctx.bezierCurveTo(cx - 3 + childStride * 3, GY - 10, cx - 1, GY - 14, cx - 1, GY - 18);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + 2, GY - 18);
  ctx.bezierCurveTo(cx + 4, GY - 12, cx + 6 - childStride * 3, GY - 8, cx + 6 - childStride * 4, GY - 4);
  ctx.lineTo(cx + 9 - childStride * 4, GY - 4);
  ctx.bezierCurveTo(cx + 9 - childStride * 3, GY - 10, cx + 5, GY - 14, cx + 5, GY - 18);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(cx - 8 + childStride * 4, GY - 5, 5, 2);
  ctx.fillRect(cx + 4 - childStride * 4, GY - 5, 5, 2);

  // Pursuers — 3 zombie silhouettes behind, slightly slower, with
  // a stumbling gait (uneven leg lengths + arms reaching forward).
  for (let p = 0; p < 3; p++) {
    const px = CW * 1.05 - t * 240 + p * 36;
    const wb = Math.sin(now / 240 + p) * 1.6;
    const zStride = Math.sin(now / 180 + p * 1.7);
    ctx.fillStyle = '#1a261a';
    // Hunched torso
    ctx.beginPath();
    ctx.moveTo(px - 6, GY - 56 + wb);
    ctx.bezierCurveTo(px - 10, GY - 46, px - 10, GY - 34, px - 7, GY - 26);
    ctx.lineTo(px + 7, GY - 26);
    ctx.bezierCurveTo(px + 10, GY - 36, px + 10, GY - 48, px + 6, GY - 58 + wb);
    ctx.closePath(); ctx.fill();
    // Sloped head
    ctx.beginPath();
    ctx.ellipse(px - 1 + wb * 0.3, GY - 64 + wb, 5, 6, 0.2, 0, Math.PI * 2); ctx.fill();
    // Outstretched arms (one higher, one lower)
    ctx.beginPath();
    ctx.moveTo(px - 4, GY - 50);
    ctx.bezierCurveTo(px - 14, GY - 52, px - 22, GY - 48, px - 26, GY - 44);
    ctx.lineTo(px - 24, GY - 40);
    ctx.bezierCurveTo(px - 18, GY - 44, px - 10, GY - 46, px - 2, GY - 46);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px + 4, GY - 48);
    ctx.bezierCurveTo(px + 14, GY - 46, px + 22, GY - 40, px + 26, GY - 36);
    ctx.lineTo(px + 24, GY - 32);
    ctx.bezierCurveTo(px + 16, GY - 38, px + 8, GY - 42, px + 2, GY - 44);
    ctx.closePath(); ctx.fill();
    // Uneven legs (zombie stumble)
    ctx.beginPath();
    ctx.moveTo(px - 5, GY - 28);
    ctx.bezierCurveTo(px - 7, GY - 20, px - 7 + zStride * 2, GY - 12, px - 6 + zStride * 3, GY - 6);
    ctx.lineTo(px - 3 + zStride * 3, GY - 6);
    ctx.bezierCurveTo(px - 3 + zStride * 2, GY - 12, px - 1, GY - 20, px - 1, GY - 28);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px + 1, GY - 28);
    ctx.bezierCurveTo(px + 3, GY - 18, px + 5 - zStride * 2, GY - 10, px + 6 - zStride * 3, GY - 4);
    ctx.lineTo(px + 9 - zStride * 3, GY - 4);
    ctx.bezierCurveTo(px + 9 - zStride * 2, GY - 12, px + 5, GY - 20, px + 5, GY - 28);
    ctx.closePath(); ctx.fill();
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
  const mzO = dSpriteAt(dSoldier, ctx, officer, ox, oy, SCALE, now);
  // MUZZLE FLASH overlay at the pistol barrel (timed pulses)
  if (flashOn) {
    const [fx, fy] = mzO || [ox + 90, oy - 215];
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
    const sp = ctx.createRadialGradient(fx - 50, fy + 10, 10, fx - 50, fy + 10, 120);
    sp.addColorStop(0, 'rgba(255,200,120,0.28)'); sp.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = sp; ctx.fillRect(fx - 170, fy - 110, 240, 240);
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
    const mzC = dSpriteAt(dSoldier, ctx, cop, ofc.x, GY, 1.6, now);
    if (firing) {
      const [fx, fy] = mzC || [ofc.x + 24, GY - 42];
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
      id: 'iw' + zi, type: zw.type, facing: -1, state: zstate,
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
      id: 'ic' + c.killedAt, type: 'walker', facing: -1, state: 'dead',
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

  // The officer — on his back, propped on one elbow, the other arm
  // firing the pistol up into the air. Drawn with curved silhouettes
  // so the body reads as a person being pulled down, not a slab.
  const ox = CW * 0.50, oy = CH - 60;

  // Skin / uniform palette
  const navyD  = '#0a121e';
  const navy   = '#162236';
  const navyL  = '#1f3148';
  const skin   = '#c69a78';
  const skinD  = '#9a7256';

  // ── Right leg (flailing toward the leg-grabbing zombie on the left)
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(ox - 28, oy - 6);
  ctx.bezierCurveTo(ox - 50, oy - 14, ox - 78, oy - 16, ox - 92, oy - 12);
  ctx.bezierCurveTo(ox - 96, oy - 6,  ox - 88, oy + 2,  ox - 72, oy + 4);
  ctx.bezierCurveTo(ox - 50, oy + 6,  ox - 32, oy + 8,  ox - 22, oy + 6);
  ctx.closePath(); ctx.fill();
  // Knee fold shadow
  ctx.fillStyle = navyD;
  ctx.beginPath();
  ctx.moveTo(ox - 56, oy - 12); ctx.lineTo(ox - 60, oy + 2);
  ctx.lineTo(ox - 50, oy + 4);  ctx.lineTo(ox - 52, oy - 8);
  ctx.closePath(); ctx.fill();
  // Right boot
  ctx.fillStyle = '#080808';
  ctx.beginPath();
  ctx.moveTo(ox - 92, oy - 14); ctx.lineTo(ox - 110 + tug, oy - 16);
  ctx.bezierCurveTo(ox - 116 + tug, oy - 10, ox - 116 + tug, oy + 2, ox - 108 + tug, oy + 4);
  ctx.lineTo(ox - 90, oy + 2); ctx.closePath(); ctx.fill();
  // Boot lacing highlight
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(ox - 104 + tug, oy - 10, 10, 1.5);
  ctx.fillRect(ox - 104 + tug, oy - 6, 10, 1.5);
  ctx.fillRect(ox - 104 + tug, oy - 2, 10, 1.5);

  // ── Left leg (flailing the other direction)
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(ox + 10, oy - 8);
  ctx.bezierCurveTo(ox + 30, oy - 16, ox + 58, oy - 18, ox + 76, oy - 14);
  ctx.bezierCurveTo(ox + 92, oy - 4,  ox + 86, oy + 4,  ox + 70, oy + 6);
  ctx.bezierCurveTo(ox + 50, oy + 8,  ox + 28, oy + 8,  ox + 16, oy + 6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = navyD;
  ctx.beginPath();
  ctx.moveTo(ox + 42, oy - 14); ctx.lineTo(ox + 46, oy);
  ctx.lineTo(ox + 36, oy + 2);  ctx.lineTo(ox + 38, oy - 10);
  ctx.closePath(); ctx.fill();
  // Left boot
  ctx.fillStyle = '#080808';
  ctx.beginPath();
  ctx.moveTo(ox + 76, oy - 16); ctx.lineTo(ox + 94 - tug, oy - 14);
  ctx.bezierCurveTo(ox + 100 - tug, oy - 8, ox + 100 - tug, oy + 4, ox + 90 - tug, oy + 6);
  ctx.lineTo(ox + 74, oy + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(ox + 84 - tug, oy - 8, 10, 1.5);
  ctx.fillRect(ox + 84 - tug, oy - 4, 10, 1.5);
  ctx.fillRect(ox + 84 - tug, oy, 10, 1.5);

  // ── Torso (slanted, on his back) ────────────────────────────
  ctx.save();
  ctx.translate(ox, oy - 20);
  ctx.rotate(-0.18);
  // Main torso silhouette — curved sides for shoulders + waist
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(-44, 8);
  ctx.bezierCurveTo(-50, -20, -52, -56, -42, -78);
  ctx.bezierCurveTo(-28, -86, -8,  -90, 12,  -88);
  ctx.bezierCurveTo(32,  -82, 44,  -64, 46,  -38);
  ctx.bezierCurveTo(48,  -12, 44,  4,   36,  10);
  ctx.lineTo(-36, 12);
  ctx.closePath(); ctx.fill();
  // Belt
  ctx.fillStyle = '#c4a838';
  ctx.fillRect(-44, -58, 90, 7);
  ctx.fillStyle = '#7a6420';
  ctx.fillRect(-44, -52, 90, 1);
  // Belt buckle
  ctx.fillStyle = '#e8c450';
  ctx.fillRect(-6, -60, 14, 10);
  ctx.fillStyle = '#a08020';
  ctx.fillRect(-4, -56, 10, 2);
  // Uniform highlight (chest panel)
  ctx.fillStyle = navyL;
  ctx.beginPath();
  ctx.moveTo(-26, -78); ctx.lineTo(8, -78);
  ctx.lineTo(14, -64); ctx.lineTo(-32, -62);
  ctx.closePath(); ctx.fill();
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
  ctx.fillStyle = '#9a7820';
  ctx.beginPath(); ctx.arc(8, -38, 2, 0, Math.PI * 2); ctx.fill();
  // Blood splatter on uniform from the bite
  ctx.fillStyle = 'rgba(120,4,4,0.78)';
  ctx.beginPath();
  ctx.moveTo(-30, -78);
  ctx.bezierCurveTo(-14, -76, 4, -74, 22, -70);
  ctx.bezierCurveTo(28, -56, 32, -42, 30, -32);
  ctx.bezierCurveTo(14, -34, -8, -36, -28, -34);
  ctx.bezierCurveTo(-30, -50, -32, -66, -30, -78);
  ctx.closePath(); ctx.fill();
  // Drip lines
  ctx.fillStyle = 'rgba(100,2,2,0.7)';
  ctx.fillRect(-22, -32, 2, 14);
  ctx.fillRect(-12, -30, 2, 18);
  ctx.fillRect(2,   -32, 2, 16);
  ctx.fillRect(18,  -32, 2, 12);

  // ── Head (turned back, screaming) ──────────────────────────
  // Skull base
  ctx.fillStyle = skin;
  ctx.beginPath();
  // Egg-shaped head with chin pointing back-left (he's screaming up)
  ctx.moveTo(-18, -98);
  ctx.bezierCurveTo(-22, -118, -10, -130, 6, -130);
  ctx.bezierCurveTo(22, -130, 32, -118, 30, -100);
  ctx.bezierCurveTo(30, -88, 24, -80, 12, -80);
  ctx.bezierCurveTo(-2, -82, -16, -88, -18, -98);
  ctx.closePath(); ctx.fill();
  // Jaw shadow (he's tilted back)
  ctx.fillStyle = skinD;
  ctx.beginPath();
  ctx.moveTo(-14, -84); ctx.lineTo(14, -78);
  ctx.lineTo(20, -82);  ctx.lineTo(-16, -88);
  ctx.closePath(); ctx.fill();
  // Hair (short military buzz, with sweat shine)
  ctx.fillStyle = '#1a1a16';
  ctx.beginPath();
  ctx.moveTo(-20, -118);
  ctx.bezierCurveTo(-22, -130, -8, -134, 8, -134);
  ctx.bezierCurveTo(24, -134, 32, -130, 32, -116);
  ctx.bezierCurveTo(26, -122, 14, -126, 4, -126);
  ctx.bezierCurveTo(-8, -126, -16, -124, -20, -118);
  ctx.closePath(); ctx.fill();
  // Police cap slid back (tipping off the head)
  ctx.fillStyle = navyD;
  ctx.beginPath();
  ctx.moveTo(-26, -120); ctx.lineTo(8, -126);
  ctx.lineTo(8, -116);  ctx.lineTo(-22, -110);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#c4a838';
  ctx.fillRect(-18, -120, 22, 2);
  // Mouth wide open (scream) — proper jaw aperture with teeth + tongue
  ctx.fillStyle = '#1a0606';
  ctx.beginPath();
  ctx.moveTo(-4, -94);
  ctx.bezierCurveTo(-6, -86, 4, -82, 12, -84);
  ctx.bezierCurveTo(16, -88, 14, -94, 8, -96);
  ctx.bezierCurveTo(2, -98, -2, -96, -4, -94);
  ctx.closePath(); ctx.fill();
  // Teeth (upper row)
  ctx.fillStyle = '#e0ddc0';
  ctx.fillRect(-2, -94, 12, 2);
  // Tongue
  ctx.fillStyle = '#7a2020';
  ctx.fillRect(0, -88, 8, 3);
  // Eyes wide in panic
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(-6, -108, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8, -108, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(-6, -108, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(8, -108, 1.8, 0, Math.PI * 2); ctx.fill();
  // Eyebrow furrowed (terror)
  ctx.fillStyle = '#1a1a16';
  ctx.fillRect(-12, -114, 10, 2);
  ctx.fillRect(2,   -114, 10, 2);
  // Nose
  ctx.fillStyle = skinD;
  ctx.beginPath();
  ctx.moveTo(2, -108); ctx.lineTo(6, -100);
  ctx.lineTo(0, -98); ctx.closePath(); ctx.fill();
  // Sweat bead
  ctx.fillStyle = 'rgba(140,180,200,0.6)';
  ctx.beginPath(); ctx.arc(-16, -98, 1.4, 0, Math.PI * 2); ctx.fill();

  // ── Bracing arm (left, propping up off the ground) ─────────
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(-42, -34);
  ctx.bezierCurveTo(-58, -28, -70, -18, -74, -8);
  ctx.bezierCurveTo(-72, 2, -64, 4, -54, 0);
  ctx.bezierCurveTo(-42, -2, -32, -10, -28, -22);
  ctx.closePath(); ctx.fill();
  // Cuff
  ctx.fillStyle = navyD;
  ctx.fillRect(-74, -10, 14, 6);
  // Hand bracing on ground
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(-80, -2, 9, 6, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skinD;
  ctx.fillRect(-84, -2, 8, 2);

  // ── Firing arm (right, raised, pistol pointing up) ─────────
  // Upper arm
  ctx.fillStyle = navy;
  ctx.beginPath();
  ctx.moveTo(28, -76);
  ctx.bezierCurveTo(38, -98, 44, -118, 42, -134);
  ctx.bezierCurveTo(54, -134, 60, -118, 58, -100);
  ctx.bezierCurveTo(56, -84, 48, -72, 40, -68);
  ctx.closePath(); ctx.fill();
  // Forearm extending straight up
  ctx.beginPath();
  ctx.moveTo(42, -134);
  ctx.bezierCurveTo(42, -150, 46, -160, 52, -162);
  ctx.bezierCurveTo(60, -162, 64, -154, 62, -140);
  ctx.lineTo(58, -134);
  ctx.closePath(); ctx.fill();
  // Hand gripping the pistol
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(56, -162, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skinD;
  ctx.fillRect(50, -160, 12, 1.5);
  // Pistol — proper silhouette with grip, slide, barrel
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(52, -184, 10, 22);          // grip + slide
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(48, -176, 18, 6);            // slide top
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(58, -190, 5, 8);             // barrel tip
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(54, -178, 6, 1);             // ejection port
  // Muzzle flash going up (every other beat)
  const fflash = Math.floor(now / 180) % 2 === 0;
  if (fflash) {
    const fx = 60, fy = -196;
    const fg = ctx.createRadialGradient(fx, fy, 3, fx, fy, 80);
    fg.addColorStop(0, 'rgba(255,255,220,1)');
    fg.addColorStop(0.4, 'rgba(255,160,40,0.6)');
    fg.addColorStop(1, 'rgba(180,40,10,0)');
    ctx.fillStyle = fg; ctx.fillRect(fx - 80, fy - 80, 160, 160);
    ctx.fillStyle = 'rgba(255,255,210,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx - 8, fy + 8);
    ctx.lineTo(fx + 2, fy - 30);
    ctx.lineTo(fx + 14, fy + 8);
    ctx.closePath(); ctx.fill();
    // Ejecting brass casing
    const ecx = 48 + (((now / 180) % 1)) * 18;
    const ecy = -176 - (((now / 180) % 1)) * 12;
    ctx.fillStyle = '#c4a850';
    ctx.fillRect(ecx, ecy, 4, 2);
  }
  ctx.restore();

  // Zombie #1 — biting the officer's shoulder/neck on the right.
  // Drawn with curved torso + arms reaching forward into the bite.
  const z1x = ox + 80, z1y = oy;
  // Torso silhouette
  ctx.fillStyle = '#2a3826';
  ctx.beginPath();
  ctx.moveTo(z1x - 22, z1y);
  ctx.bezierCurveTo(z1x - 32, z1y - 30, z1x - 28, z1y - 60, z1x - 14, z1y - 78);
  ctx.bezierCurveTo(z1x + 6, z1y - 88, z1x + 28, z1y - 86, z1x + 42, z1y - 70);
  ctx.bezierCurveTo(z1x + 56, z1y - 48, z1x + 58, z1y - 18, z1x + 44, z1y);
  ctx.closePath(); ctx.fill();
  // Torn-shirt edges flapping
  ctx.fillStyle = '#1a2418';
  ctx.beginPath();
  ctx.moveTo(z1x - 18, z1y - 40); ctx.lineTo(z1x - 28, z1y - 32);
  ctx.lineTo(z1x - 24, z1y - 22); ctx.lineTo(z1x - 14, z1y - 28);
  ctx.closePath(); ctx.fill();
  // Spine shadow
  ctx.fillStyle = '#1a2418';
  ctx.beginPath();
  ctx.moveTo(z1x + 8, z1y - 80);
  ctx.bezierCurveTo(z1x + 14, z1y - 50, z1x + 10, z1y - 20, z1x + 4, z1y);
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#1a2418'; ctx.stroke();
  // Neck + head (leaning into the bite)
  ctx.fillStyle = '#5a7042';
  // Neck stub
  ctx.beginPath();
  ctx.moveTo(z1x - 16, z1y - 82); ctx.lineTo(z1x + 6, z1y - 88);
  ctx.lineTo(z1x + 8, z1y - 96); ctx.lineTo(z1x - 14, z1y - 92);
  ctx.closePath(); ctx.fill();
  // Skull
  ctx.beginPath();
  ctx.moveTo(z1x - 24, z1y - 98);
  ctx.bezierCurveTo(z1x - 28, z1y - 116, z1x - 16, z1y - 126, z1x, z1y - 122);
  ctx.bezierCurveTo(z1x + 14, z1y - 118, z1x + 20, z1y - 104, z1x + 14, z1y - 92);
  ctx.bezierCurveTo(z1x + 4, z1y - 86, z1x - 14, z1y - 88, z1x - 24, z1y - 98);
  ctx.closePath(); ctx.fill();
  // Skull-shadow / sunken cheek
  ctx.fillStyle = '#3a4828';
  ctx.beginPath();
  ctx.ellipse(z1x - 8, z1y - 100, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
  // Red glowing eye
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(z1x - 14, z1y - 110, 4, 3);
  // Eye glow halo
  ctx.fillStyle = 'rgba(255,40,30,0.35)';
  ctx.beginPath(); ctx.arc(z1x - 12, z1y - 108, 6, 0, Math.PI * 2); ctx.fill();
  // Open jaw biting
  ctx.fillStyle = '#1a0606';
  ctx.beginPath();
  ctx.moveTo(z1x - 24, z1y - 92);
  ctx.bezierCurveTo(z1x - 26, z1y - 82, z1x - 14, z1y - 76, z1x - 6, z1y - 80);
  ctx.bezierCurveTo(z1x - 2, z1y - 86, z1x - 8, z1y - 96, z1x - 18, z1y - 96);
  ctx.closePath(); ctx.fill();
  // Teeth (jagged broken row)
  ctx.fillStyle = '#a89a78';
  ctx.fillRect(z1x - 22, z1y - 92, 2, 4);
  ctx.fillRect(z1x - 18, z1y - 92, 2, 5);
  ctx.fillRect(z1x - 14, z1y - 92, 2, 4);
  ctx.fillRect(z1x - 10, z1y - 92, 2, 5);
  // Blood streaming down the jaw
  ctx.fillStyle = '#9a0808';
  ctx.fillRect(z1x - 18, z1y - 86, 8, 5);
  ctx.beginPath();
  ctx.moveTo(z1x - 14, z1y - 82);
  ctx.bezierCurveTo(z1x - 14, z1y - 70, z1x - 12, z1y - 60, z1x - 14, z1y - 50);
  ctx.lineWidth = 2; ctx.strokeStyle = '#9a0808'; ctx.stroke();
  // Arms grabbing officer's torso — proper rounded form
  ctx.fillStyle = '#2a3826';
  // Right arm (clutching)
  ctx.beginPath();
  ctx.moveTo(z1x - 18, z1y - 64);
  ctx.bezierCurveTo(z1x - 40, z1y - 60, z1x - 56, z1y - 56, z1x - 64, z1y - 50);
  ctx.bezierCurveTo(z1x - 62, z1y - 42, z1x - 50, z1y - 44, z1x - 36, z1y - 48);
  ctx.bezierCurveTo(z1x - 22, z1y - 50, z1x - 14, z1y - 54, z1x - 12, z1y - 58);
  ctx.closePath(); ctx.fill();
  // Clawed hand
  ctx.fillStyle = '#7a8a52';
  ctx.beginPath();
  ctx.ellipse(z1x - 64, z1y - 52, 7, 5, 0.3, 0, Math.PI * 2); ctx.fill();
  // Fingers
  ctx.fillStyle = '#5a7042';
  ctx.fillRect(z1x - 72, z1y - 56, 6, 2);
  ctx.fillRect(z1x - 72, z1y - 52, 6, 2);
  ctx.fillRect(z1x - 72, z1y - 48, 5, 2);
  // Left arm (grabbing lower)
  ctx.fillStyle = '#2a3826';
  ctx.beginPath();
  ctx.moveTo(z1x - 14, z1y - 40);
  ctx.bezierCurveTo(z1x - 36, z1y - 38, z1x - 52, z1y - 30, z1x - 60, z1y - 22);
  ctx.bezierCurveTo(z1x - 58, z1y - 14, z1x - 46, z1y - 16, z1x - 32, z1y - 22);
  ctx.bezierCurveTo(z1x - 18, z1y - 26, z1x - 10, z1y - 30, z1x - 8, z1y - 34);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7a8a52';
  ctx.beginPath();
  ctx.ellipse(z1x - 60, z1y - 22, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

  // Zombie #2 — pulling the officer's legs from below-left.
  // Crawling stance, lower body off-screen, top half visible.
  const z2x = ox - 150, z2y = oy + 4;
  ctx.fillStyle = '#2a3826';
  // Torso (low, crawling)
  ctx.beginPath();
  ctx.moveTo(z2x - 20, z2y);
  ctx.bezierCurveTo(z2x - 26, z2y - 20, z2x - 18, z2y - 36, z2x, z2y - 40);
  ctx.bezierCurveTo(z2x + 24, z2y - 38, z2x + 38, z2y - 30, z2x + 36, z2y - 14);
  ctx.bezierCurveTo(z2x + 32, z2y - 4, z2x + 16, z2y, z2x - 4, z2y);
  ctx.closePath(); ctx.fill();
  // Head (looking up at officer's leg)
  ctx.fillStyle = '#5a7042';
  ctx.beginPath();
  ctx.moveTo(z2x - 16, z2y - 44);
  ctx.bezierCurveTo(z2x - 20, z2y - 60, z2x - 8, z2y - 68, z2x + 6, z2y - 66);
  ctx.bezierCurveTo(z2x + 18, z2y - 62, z2x + 22, z2y - 50, z2x + 14, z2y - 40);
  ctx.bezierCurveTo(z2x + 2, z2y - 36, z2x - 12, z2y - 38, z2x - 16, z2y - 44);
  ctx.closePath(); ctx.fill();
  // Sunken jaw shadow
  ctx.fillStyle = '#3a4828';
  ctx.fillRect(z2x - 10, z2y - 44, 18, 3);
  // Two red eyes
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(z2x - 10, z2y - 56, 3, 2);
  ctx.fillRect(z2x + 4, z2y - 56, 3, 2);
  ctx.fillStyle = 'rgba(255,40,30,0.30)';
  ctx.beginPath(); ctx.arc(z2x - 8, z2y - 54, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(z2x + 6, z2y - 54, 5, 0, Math.PI * 2); ctx.fill();
  // Snarling mouth (lower row of teeth visible, blood on chin)
  ctx.fillStyle = '#1a0606';
  ctx.beginPath();
  ctx.ellipse(z2x - 2, z2y - 46, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a89a78';
  ctx.fillRect(z2x - 6, z2y - 47, 1.5, 3);
  ctx.fillRect(z2x - 2, z2y - 47, 1.5, 3);
  ctx.fillRect(z2x + 2, z2y - 47, 1.5, 3);
  ctx.fillStyle = '#9a0808';
  ctx.fillRect(z2x - 4, z2y - 42, 8, 4);
  // Arms reaching up to grab the officer's ankles
  ctx.fillStyle = '#2a3826';
  // Right arm (closer, reaching forward-right)
  ctx.beginPath();
  ctx.moveTo(z2x + 20, z2y - 32);
  ctx.bezierCurveTo(z2x + 40, z2y - 28, z2x + 56, z2y - 22, z2x + 60, z2y - 14);
  ctx.bezierCurveTo(z2x + 58, z2y - 6, z2x + 46, z2y - 8, z2x + 32, z2y - 14);
  ctx.bezierCurveTo(z2x + 18, z2y - 20, z2x + 14, z2y - 26, z2x + 14, z2y - 30);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7a8a52';
  ctx.beginPath(); ctx.ellipse(z2x + 60, z2y - 14, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a7042';
  ctx.fillRect(z2x + 62, z2y - 18, 5, 1.5);
  ctx.fillRect(z2x + 62, z2y - 14, 5, 1.5);
  ctx.fillRect(z2x + 62, z2y - 10, 5, 1.5);
  // Left arm (further back, grasping at officer's other leg)
  ctx.fillStyle = '#2a3826';
  ctx.beginPath();
  ctx.moveTo(z2x + 16, z2y - 14);
  ctx.bezierCurveTo(z2x + 38, z2y - 8, z2x + 56, z2y - 4, z2x + 62, z2y + 2);
  ctx.bezierCurveTo(z2x + 60, z2y + 10, z2x + 46, z2y + 6, z2x + 32, z2y);
  ctx.bezierCurveTo(z2x + 18, z2y - 4, z2x + 12, z2y - 8, z2x + 12, z2y - 12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7a8a52';
  ctx.beginPath(); ctx.ellipse(z2x + 62, z2y + 2, 6, 4, 0, 0, Math.PI * 2); ctx.fill();

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
  const mzD = dSpriteAt(dSoldier, ctx, def, sx, sy, SCALE_SOL, now);

  // MUZZLE FLASH overlay — anchored near the rifle barrel tip of the
  // scaled sprite.
  if (flashOn) {
    const [fx, fy] = mzD || [sx + 130, sy - 210];
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
    const ecx = fx - 150 + ejT * 30;
    const ecy = fy - 10 - ejT * 26 + ejT * ejT * 50;
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
      id: 'ih' + i, type: i === 1 ? 'runner' : 'walker',
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
  ctx.ellipse(sx + 76 + bz * 18, CH - 284 - bz * 14, 9 + bz * 12, 5 + bz * 5, 0, 0, Math.PI * 2);
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
function _dShotRifleGrip_unused(ctx, _t, _now) {
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

// Shared 5-point star — used for the ARMY decal on both vehicle types.
// Wraps the previous inline copies that rebuilt the same path.
function drawArmyStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rr = (i % 2 === 0) ? r : r * 0.48;
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
}

// Realistic tyre — outer rubber, inner hub, 5 lugs around the hub so
// the wheel reads as a wheel and not as two concentric discs.
function drawTyre(ctx, cx, cy, r) {
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // Sidewall tread highlight
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.stroke();
  // Hub
  ctx.fillStyle = '#252525';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
  // Lug nuts
  ctx.fillStyle = '#0a0a0a';
  for (let l = 0; l < 5; l++) {
    const a = (l / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Centre cap
  ctx.fillStyle = '#404040';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2); ctx.fill();
}

function drawConvoyVehicle(ctx, x, y, type, now) {
  if (type === 'humvee') {
    // ── Humvee (HMMWV) — wide, low, with sloped bonnet ─────────
    // The body silhouette is built from one filled path so the hood
    // slope, fender flares and rear cargo all read as one chunky
    // 4×4 rather than two rectangles stacked on top of each other.
    ctx.fillStyle = '#3a4a30';
    ctx.beginPath();
    ctx.moveTo(x - 68, y + 2);                 // rear-lower corner
    ctx.lineTo(x - 68, y - 24);                // rear panel
    ctx.lineTo(x - 60, y - 50);                // rear roof corner
    ctx.lineTo(x - 36, y - 56);                // roof apex (rear cab)
    ctx.lineTo(x + 18, y - 56);                // roof apex (front cab)
    ctx.lineTo(x + 30, y - 46);                // windshield top
    ctx.lineTo(x + 48, y - 28);                // bonnet slope
    ctx.lineTo(x + 68, y - 22);                // grille top
    ctx.lineTo(x + 68, y + 2);                 // grille bottom
    ctx.closePath(); ctx.fill();
    // Underbody / wheel-well shadow
    ctx.fillStyle = '#1f2818';
    ctx.fillRect(x - 68, y + 2, 136, 4);
    // Bonnet highlight (sheen along the sloped panel)
    ctx.fillStyle = '#4a5a3c';
    ctx.beginPath();
    ctx.moveTo(x + 30, y - 44); ctx.lineTo(x + 50, y - 28);
    ctx.lineTo(x + 50, y - 25); ctx.lineTo(x + 30, y - 40);
    ctx.closePath(); ctx.fill();
    // Windshield — slightly tilted
    ctx.fillStyle = '#0a1418';
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 52); ctx.lineTo(x + 28, y - 50);
    ctx.lineTo(x + 30, y - 36); ctx.lineTo(x - 16, y - 38);
    ctx.closePath(); ctx.fill();
    // Window reflection
    ctx.fillStyle = 'rgba(120,140,140,0.20)';
    ctx.fillRect(x - 12, y - 50, 18, 4);
    // Door divider + side window (driver door)
    ctx.fillStyle = '#1f2818';
    ctx.fillRect(x - 16, y - 36, 2, 30);
    ctx.fillStyle = '#0a1418';
    ctx.fillRect(x - 38, y - 36, 22, 12);
    // Rear door (passenger / cargo door)
    ctx.fillStyle = '#1f2818';
    ctx.fillRect(x - 40, y - 36, 2, 30);
    // ARMY star on the door
    ctx.fillStyle = '#dde2d0';
    drawArmyStar(ctx, x - 28, y - 14, 6);
    // Headlight cluster (twin sealed-beams + amber indicator)
    ctx.fillStyle = '#fff5c4';
    ctx.beginPath(); ctx.arc(x + 64, y - 16, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 64, y - 8,  3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cc8820';
    ctx.fillRect(x + 64, y - 2, 4, 2);
    // Grille slats (vertical bars)
    ctx.fillStyle = '#0a0e08';
    for (let g = 0; g < 6; g++) ctx.fillRect(x + 54 + g * 2.4, y - 22, 1.4, 18);
    // Front bumper with brush guard
    ctx.fillStyle = '#1a2014';
    ctx.fillRect(x + 50, y - 4, 22, 6);
    ctx.strokeStyle = '#2c3826'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 58, y - 22); ctx.lineTo(x + 58, y - 6);
    ctx.moveTo(x + 66, y - 22); ctx.lineTo(x + 66, y - 6); ctx.stroke();
    // Antenna whipping in the wind from the rear
    ctx.strokeStyle = '#1a1a14'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 60, y - 56);
    ctx.quadraticCurveTo(x - 80, y - 78, x - 74 + Math.sin(now / 320) * 3, y - 96);
    ctx.stroke();
    // Roof-mounted .50-cal cupola with gunner peeking out
    ctx.fillStyle = '#1a1a14';
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 56); ctx.lineTo(x - 18, y - 66);
    ctx.quadraticCurveTo(x, y - 70, x + 18, y - 66);
    ctx.lineTo(x + 18, y - 56);
    ctx.closePath(); ctx.fill();
    // Gunner shoulders + head + helmet
    ctx.fillStyle = '#0a0e08';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 66); ctx.lineTo(x - 10, y - 76);
    ctx.quadraticCurveTo(x, y - 80, x + 10, y - 76);
    ctx.lineTo(x + 10, y - 66); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#bf8a6a';
    ctx.beginPath(); ctx.arc(x, y - 82, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a2418';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 84);
    ctx.quadraticCurveTo(x, y - 92, x + 6, y - 84);
    ctx.lineTo(x + 6, y - 80); ctx.lineTo(x - 6, y - 80);
    ctx.closePath(); ctx.fill();
    // M2 .50-cal mounted up top
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x + 4, y - 74, 30, 3);
    // Barrel cooling fins (a few notches)
    ctx.fillStyle = '#1a1a1a';
    for (let f = 0; f < 4; f++) ctx.fillRect(x + 14 + f * 4, y - 76, 1.6, 6);
    // Pintle mount under the gun
    ctx.fillStyle = '#1a1a14';
    ctx.fillRect(x + 2, y - 70, 5, 6);
    // Wheels with fender arches that bite into the body silhouette
    ctx.fillStyle = '#3a4a30';
    ctx.beginPath();
    ctx.arc(x - 42, y, 18, Math.PI, 0); ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 42, y, 18, Math.PI, 0); ctx.fill();
    drawTyre(ctx, x - 42, y + 4, 13);
    drawTyre(ctx, x + 42, y + 4, 13);

  } else if (type === 'truck') {
    // ── M939 / M35-style 6×6 troop truck ────────────────────────
    // Cab — boxy but with a sloped windshield and a rounded roof
    ctx.fillStyle = '#3a4a30';
    ctx.beginPath();
    ctx.moveTo(x + 30, y + 2);
    ctx.lineTo(x + 30, y - 36);                // cab rear wall
    ctx.lineTo(x + 38, y - 52);                // roof rear
    ctx.lineTo(x + 70, y - 52);                // roof front
    ctx.lineTo(x + 80, y - 36);                // hood join
    ctx.lineTo(x + 84, y - 22);                // hood top
    ctx.lineTo(x + 84, y + 2);                 // grille bottom
    ctx.closePath(); ctx.fill();
    // Hood highlight
    ctx.fillStyle = '#4a5a3c';
    ctx.fillRect(x + 70, y - 32, 12, 2);
    // Windshield (split, two panes)
    ctx.fillStyle = '#0a1418';
    ctx.beginPath();
    ctx.moveTo(x + 42, y - 50); ctx.lineTo(x + 70, y - 50);
    ctx.lineTo(x + 72, y - 38); ctx.lineTo(x + 42, y - 38);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1f2818'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 56, y - 50); ctx.lineTo(x + 57, y - 38); ctx.stroke();
    // Window reflection
    ctx.fillStyle = 'rgba(120,140,140,0.18)';
    ctx.fillRect(x + 45, y - 48, 10, 3);
    // Driver door + side window
    ctx.fillStyle = '#1f2818'; ctx.fillRect(x + 38, y - 36, 26, 28);
    ctx.fillStyle = '#0a1418'; ctx.fillRect(x + 40, y - 34, 16, 10);
    ctx.fillStyle = '#2c3826';
    ctx.fillRect(x + 62, y - 18, 2, 6); // door handle
    // Headlights + grille
    ctx.fillStyle = '#fff5c4';
    ctx.beginPath(); ctx.arc(x + 82, y - 24, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 82, y - 16, 3, 0, Math.PI * 2); ctx.fill();
    // Grille slats (horizontal)
    ctx.fillStyle = '#0a0e08';
    for (let g = 0; g < 5; g++) ctx.fillRect(x + 72, y - 10 + g * 2.4, 12, 1.4);
    // Front bumper
    ctx.fillStyle = '#1a2014';
    ctx.fillRect(x + 70, y - 2, 16, 5);
    // Side step under the door
    ctx.fillStyle = '#181814';
    ctx.fillRect(x + 38, y - 4, 26, 3);

    // Cargo box with canvas cover — arched silhouette
    ctx.fillStyle = '#2a3826';
    ctx.beginPath();
    ctx.moveTo(x - 90, y + 2);
    ctx.lineTo(x - 90, y - 48);
    ctx.quadraticCurveTo(x - 86, y - 62, x - 72, y - 62);  // arched front-top
    ctx.lineTo(x + 22, y - 62);
    ctx.quadraticCurveTo(x + 30, y - 62, x + 30, y - 50);
    ctx.lineTo(x + 30, y + 2);
    ctx.closePath(); ctx.fill();
    // Canvas cover ribs (vertical lacing)
    ctx.strokeStyle = '#1f2818'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const rx = x - 80 + i * 20;
      ctx.beginPath();
      ctx.moveTo(rx, y - 60); ctx.lineTo(rx, y - 4); ctx.stroke();
    }
    // Lashing rope along the bottom of the canvas
    ctx.strokeStyle = '#5a4a2a'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      ctx.moveTo(x - 88 + i * 22, y - 8);
      ctx.quadraticCurveTo(x - 80 + i * 22, y - 4, x - 70 + i * 22, y - 8);
    }
    ctx.stroke();
    // Tailgate band at the rear
    ctx.fillStyle = '#1f2818';
    ctx.fillRect(x - 90, y - 8, 8, 10);
    // Soldiers in the back, just helmets + shoulders showing through
    // the open rear flap.
    for (let i = 0; i < 3; i++) {
      const hx = x - 64 + i * 28;
      // Shoulders
      ctx.fillStyle = '#2c3a24';
      ctx.beginPath();
      ctx.moveTo(hx - 6, y - 52); ctx.lineTo(hx + 6, y - 52);
      ctx.lineTo(hx + 8, y - 46); ctx.lineTo(hx - 8, y - 46);
      ctx.closePath(); ctx.fill();
      // Face
      ctx.fillStyle = '#bf8a6a';
      ctx.beginPath(); ctx.arc(hx, y - 56, 4, 0, Math.PI * 2); ctx.fill();
      // Helmet
      ctx.fillStyle = '#1a2418';
      ctx.beginPath();
      ctx.moveTo(hx - 5, y - 58);
      ctx.quadraticCurveTo(hx, y - 64, hx + 5, y - 58);
      ctx.lineTo(hx + 5, y - 54); ctx.lineTo(hx - 5, y - 54);
      ctx.closePath(); ctx.fill();
    }
    // ARMY star on the cargo side
    ctx.fillStyle = '#dde2d0';
    drawArmyStar(ctx, x - 38, y - 28, 8);
    // Mud spatter along the canvas bottom
    ctx.fillStyle = 'rgba(40,30,18,0.7)';
    for (let m = 0; m < 9; m++) {
      const mx = x - 88 + m * 14 + (m % 2 ? 3 : 0);
      ctx.fillRect(mx, y - 6 + (m % 3), 4, 2);
    }
    // Triple-axle wheels with proper fender arches
    ctx.fillStyle = '#3a4a30';
    [-60, 0, 50].forEach(wx => {
      ctx.beginPath();
      ctx.arc(x + wx, y, 17, Math.PI, 0); ctx.fill();
    });
    [-60, 0, 50].forEach(wx => drawTyre(ctx, x + wx, y + 4, 13));
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

  // The SOLDIER — large mid-shot, looking forward (right) toward Fort
  // Omega. Built from curved bezier pieces (shoulders, chest, neck,
  // jaw) rather than stacked rectangles so the silhouette reads as a
  // person rather than a cardboard cutout.
  const sx = CW * 0.36, sy = CH - 130;
  const breathe = Math.sin(now / 1100) * 1.2;

  // ── Torso: olive uniform with V-taper from shoulder to waist ──
  ctx.fillStyle = '#3a4a30';
  ctx.beginPath();
  ctx.moveTo(sx - 86, sy + 4);
  ctx.bezierCurveTo(sx - 92, sy - 26, sx - 92, sy - 56, sx - 78, sy - 70);
  ctx.bezierCurveTo(sx - 60, sy - 84, sx - 40, sy - 86, sx - 22, sy - 86);
  ctx.lineTo(sx + 22, sy - 86);
  ctx.bezierCurveTo(sx + 40, sy - 86, sx + 60, sy - 84, sx + 78, sy - 70);
  ctx.bezierCurveTo(sx + 92, sy - 56, sx + 92, sy - 26, sx + 86, sy + 4);
  ctx.closePath(); ctx.fill();
  // Chest centre-seam shadow for depth
  ctx.fillStyle = '#2c3a24';
  ctx.beginPath();
  ctx.moveTo(sx - 18, sy - 82); ctx.lineTo(sx + 18, sy - 82);
  ctx.bezierCurveTo(sx + 14, sy - 60, sx + 12, sy - 30, sx + 16, sy + 4);
  ctx.lineTo(sx - 16, sy + 4);
  ctx.bezierCurveTo(sx - 12, sy - 30, sx - 14, sy - 60, sx - 18, sy - 82);
  ctx.closePath(); ctx.fill();

  // ── Tactical vest pouches (with shadow + MOLLE webbing) ──
  const drawPouch = (px, py, pw, ph) => {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(px + 2, py + 3, pw, ph);
    ctx.fillStyle = '#1f2a18';
    ctx.beginPath();
    ctx.moveTo(px + 4, py); ctx.lineTo(px + pw - 4, py);
    ctx.quadraticCurveTo(px + pw, py, px + pw, py + 4);
    ctx.lineTo(px + pw, py + ph - 4);
    ctx.quadraticCurveTo(px + pw, py + ph, px + pw - 4, py + ph);
    ctx.lineTo(px + 4, py + ph);
    ctx.quadraticCurveTo(px, py + ph, px, py + ph - 4);
    ctx.lineTo(px, py + 4);
    ctx.quadraticCurveTo(px, py, px + 4, py);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a4a30'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px + 3, py + 14); ctx.lineTo(px + pw - 3, py + 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + 3, py + ph - 14); ctx.lineTo(px + pw - 3, py + ph - 14); ctx.stroke();
  };
  drawPouch(sx - 60, sy - 64, 42, 56);
  drawPouch(sx + 18, sy - 64, 42, 56);
  // Tan webbing strap across the chest
  ctx.fillStyle = '#7a6a3a'; ctx.fillRect(sx - 60, sy - 28, 120, 4);
  ctx.fillStyle = '#52441e'; ctx.fillRect(sx - 60, sy - 25, 120, 1);

  // ── US flag shoulder patch (sewn-on parallelogram) ──
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(sx + 52, sy - 76, 22, 12);
  ctx.fillStyle = '#0a2855';
  ctx.fillRect(sx + 50, sy - 78, 22, 12);
  ctx.fillStyle = '#dcdcdc';
  for (let i = 0; i < 4; i++) ctx.fillRect(sx + 50, sy - 78 + i * 3, 22, 1);
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(sx + 50, sy - 70, 22, 2);

  // ── Arms — rounded with sleeve cuffs and domed gloves ──
  ctx.fillStyle = '#3a4a30';
  // Left (far-side) arm tucked behind the stock
  ctx.beginPath();
  ctx.moveTo(sx - 78, sy - 70);
  ctx.bezierCurveTo(sx - 96, sy - 60, sx - 100, sy - 30, sx - 92, sy + 4);
  ctx.lineTo(sx - 66, sy + 4);
  ctx.bezierCurveTo(sx - 72, sy - 30, sx - 70, sy - 56, sx - 60, sy - 70);
  ctx.closePath(); ctx.fill();
  // Right (camera-side) arm gripping the rifle, forearm angled in
  ctx.beginPath();
  ctx.moveTo(sx + 78, sy - 70);
  ctx.bezierCurveTo(sx + 96, sy - 56, sx + 96, sy - 28, sx + 80, sy);
  ctx.lineTo(sx + 50, sy + 6);
  ctx.bezierCurveTo(sx + 54, sy - 24, sx + 58, sy - 54, sx + 62, sy - 70);
  ctx.closePath(); ctx.fill();
  // Sleeve seam shading
  ctx.fillStyle = '#2c3a24';
  ctx.fillRect(sx - 92, sy - 32, 26, 3);
  ctx.fillRect(sx + 66, sy - 32, 26, 3);
  // Gloves
  ctx.fillStyle = '#1a2418';
  ctx.beginPath(); ctx.ellipse(sx - 78, sy + 8, 18, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(sx + 64, sy + 10, 18, 12, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath(); ctx.moveTo(sx - 86 + k * 5, sy + 2); ctx.lineTo(sx - 82 + k * 5, sy + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 56 + k * 5, sy + 4); ctx.lineTo(sx + 60 + k * 5, sy + 8); ctx.stroke();
  }

  // ── Rifle held diagonally across the chest ──
  ctx.save();
  ctx.translate(sx, sy - 30);
  ctx.rotate(-0.30);
  // Stock with rounded buttplate
  ctx.fillStyle = '#1a1410';
  ctx.beginPath();
  ctx.moveTo(-104, -6); ctx.quadraticCurveTo(-110, 0, -104, 8);
  ctx.lineTo(-50, 8); ctx.lineTo(-50, -6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a2018'; ctx.fillRect(-100, -5, 50, 3); // cheek-weld
  // Receiver + charging handle bump
  ctx.fillStyle = '#1a1a1c'; ctx.fillRect(-50, -10, 60, 20);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-32, -14, 18, 4);
  // Handguard with vent slots
  ctx.fillStyle = '#222226'; ctx.fillRect(10, -7, 50, 14);
  for (let v = 0; v < 4; v++) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(16 + v * 10, -4, 4, 8);
  }
  ctx.fillStyle = '#0e0e10'; ctx.fillRect(60, -4, 32, 8); // barrel
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(88, -10, 3, 6); // front sight
  // Curved STANAG magazine
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.moveTo(-30, 10); ctx.lineTo(-14, 10);
  ctx.quadraticCurveTo(-10, 16, -12, 30);
  ctx.lineTo(-16, 36); ctx.lineTo(-30, 34);
  ctx.quadraticCurveTo(-34, 22, -32, 14);
  ctx.closePath(); ctx.fill();
  // Trigger guard
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(-20, 14, 7, -0.2, Math.PI + 0.2); ctx.stroke();
  ctx.restore();

  // ── Head + neck ─────────────────────────────────────────────
  const hx = sx, hy = sy - 130 + breathe;
  // Neck (cylindrical, shaded toward the bottom)
  ctx.fillStyle = '#8a6248'; ctx.fillRect(hx - 10, hy + 24, 20, 16);
  ctx.fillStyle = '#6a4a36'; ctx.fillRect(hx - 10, hy + 32, 20, 8);
  // Face — egg-shaped
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath(); ctx.ellipse(hx, hy, 26, 32, 0, 0, Math.PI * 2); ctx.fill();
  // Jaw shadow defining the chin angle
  ctx.fillStyle = '#9a6a4e';
  ctx.beginPath();
  ctx.moveTo(hx - 22, hy + 6);
  ctx.bezierCurveTo(hx - 16, hy + 26, hx + 16, hy + 26, hx + 22, hy + 6);
  ctx.bezierCurveTo(hx + 18, hy + 16, hx - 18, hy + 16, hx - 22, hy + 6);
  ctx.closePath(); ctx.fill();
  // Stubble — textured dots along the jaw line, not a solid bar
  ctx.fillStyle = '#3a2a1a';
  for (let s = 0; s < 22; s++) {
    const sax = hx - 18 + (s * 2.1);
    const say = hy + 12 + ((s * 7) % 5);
    ctx.fillRect(sax, say, 1, 1);
  }

  // ── Helmet (MICH-style, NVG mount, chin strap) ──
  ctx.fillStyle = '#1f2a18';
  ctx.beginPath();
  ctx.moveTo(hx - 32, hy - 4);
  ctx.bezierCurveTo(hx - 36, hy - 26, hx - 22, hy - 40, hx, hy - 42);
  ctx.bezierCurveTo(hx + 22, hy - 40, hx + 36, hy - 26, hx + 32, hy - 4);
  ctx.lineTo(hx + 32, hy + 2);
  ctx.lineTo(hx - 32, hy + 2);
  ctx.closePath(); ctx.fill();
  // Helmet rim (slightly lighter)
  ctx.fillStyle = '#2c3a24';
  ctx.beginPath();
  ctx.moveTo(hx - 32, hy + 2);
  ctx.bezierCurveTo(hx - 22, hy - 4, hx + 22, hy - 4, hx + 32, hy + 2);
  ctx.closePath(); ctx.fill();
  // Moonlight specular highlight
  ctx.fillStyle = 'rgba(200,210,180,0.18)';
  ctx.beginPath();
  ctx.ellipse(hx - 12, hy - 30, 12, 6, -0.4, 0, Math.PI * 2); ctx.fill();
  // NVG mount block + folded-up monocular
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(hx - 5, hy - 44, 14, 7);
  ctx.fillStyle = '#181818'; ctx.fillRect(hx + 1, hy - 52, 7, 10);
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(hx + 4, hy - 52, 4, 0, Math.PI * 2); ctx.fill();
  // Chin strap curving under the jaw
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx - 28, hy);
  ctx.quadraticCurveTo(hx, hy + 26, hx + 28, hy); ctx.stroke();

  // ── Eyes (only the camera-side one is fully visible) ──
  // Brow ridge as a subtle elliptical shadow, not a flat bar
  ctx.fillStyle = '#7a5236';
  ctx.beginPath();
  ctx.ellipse(hx + 10, hy - 6, 11, 3, -0.15, 0, Math.PI * 2); ctx.fill();
  // Eye socket
  ctx.fillStyle = '#3a2418';
  ctx.beginPath();
  ctx.ellipse(hx + 10, hy + 1, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  // Sclera
  ctx.fillStyle = '#e8dfc8';
  ctx.beginPath();
  ctx.ellipse(hx + 11, hy + 1, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
  // Iris + pupil looking forward
  ctx.fillStyle = '#3a4a30';
  ctx.beginPath(); ctx.arc(hx + 13, hy + 1, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(hx + 14, hy + 1, 1, 0, Math.PI * 2); ctx.fill();
  // Far-side eye barely visible past the nose bridge
  ctx.fillStyle = '#3a2418'; ctx.fillRect(hx - 8, hy, 4, 2);
  // Nose ridge highlight
  ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hx + 4, hy - 4);
  ctx.quadraticCurveTo(hx + 8, hy + 8, hx + 4, hy + 12); ctx.stroke();

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

  // Second soldier silhouette (background, back-to-camera, looking
  // forward) — also rounded, not a flat rectangle.
  const sx2 = CW * 0.72, sy2 = CH - 100;
  ctx.fillStyle = '#1a2418';
  ctx.beginPath();
  ctx.moveTo(sx2 - 18, sy2);
  ctx.bezierCurveTo(sx2 - 20, sy2 - 30, sx2 - 18, sy2 - 60, sx2 - 14, sy2 - 76);
  ctx.lineTo(sx2 + 14, sy2 - 76);
  ctx.bezierCurveTo(sx2 + 18, sy2 - 60, sx2 + 20, sy2 - 30, sx2 + 18, sy2);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(sx2, sy2 - 86, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.moveTo(sx2 - 14, sy2 - 92);
  ctx.bezierCurveTo(sx2 - 14, sy2 - 102, sx2 + 14, sy2 - 102, sx2 + 14, sy2 - 92);
  ctx.lineTo(sx2 + 14, sy2 - 88); ctx.lineTo(sx2 - 14, sy2 - 88);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(sx2 + 12, sy2 - 60, 30, 4);
}

// 5.2 — Fort Omega wide: the wall + soldiers + title card.
function dShotFortWide(ctx, t, now) {
  // The same parallax city the player defends in the siege.
  dBg(ctx, 0, now);

  // The actual game wall
  dBase(ctx, 200, 200);

  // ── Soldiers deployed in defensive depth across all 3 lanes ─────
  // The team is staggered front/mid/back so the line has visible
  // depth — front-line riflemen, mid-lane support, back-lane snipers.
  // Each soldier renders at their lane scale (back-lane soldiers
  // read smaller / farther via LANES[lane].sc).
  const deployed = [
    // Front lane (closest, 1.0× scale) — front-line riflemen
    { x: WX + 60,  weapon: 'rifle',   pose: 'shoot', lane: 0 },
    { x: WX + 180, weapon: 'shotgun', pose: 'idle',  lane: 0 },
    { x: WX + 310, weapon: 'rifle',   pose: 'shoot', lane: 0 },
    // Mid lane (0.80× scale) — flanking support
    { x: WX + 110, weapon: 'rifle',   pose: 'idle',  lane: 1 },
    { x: WX + 260, weapon: 'sniper',  pose: 'shoot', lane: 1 },
    // Back lane (0.64× scale) — overwatch snipers + rifleman
    { x: WX + 160, weapon: 'sniper',  pose: 'idle',  lane: 2 },
    { x: WX + 340, weapon: 'rifle',   pose: 'shoot', lane: 2 },
  ];
  // Sandbag emplacements at the feet of the front-lane soldiers (the
  // mid/back lanes don't need them — they're set back from the line).
  deployed.filter(d => d.lane === 0).forEach((d, i) => {
    if (i % 2 === 0) {
      ctx.fillStyle = '#5a4828';
      ctx.beginPath(); ctx.ellipse(d.x + 18, GY - 2, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#705836';
      ctx.beginPath(); ctx.ellipse(d.x + 8, GY - 1, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a6c44';
      ctx.fillRect(d.x + 2, GY - 4, 22, 2);
    }
  });
  // Render farthest lane first so closer soldiers layer on top.
  [2, 1, 0].forEach(lane => {
    deployed.filter(d => d.lane === lane).forEach((d, i) => {
      const wob = Math.sin(now / 420 + i * 1.3 + lane * 0.5) * 0.4;
      const sc = LANES[lane].sc;
      const ly = laneY(lane);
      const sol = mkIntroSoldier({
        name: 'R' + lane + '_' + i, weapon: d.weapon, facing: 1,
        state: d.pose, walkPhase: i * 0.7 + wob,
        lastShot: now - 30,
      });
      const mz = dSpriteAt(dSoldier, ctx, sol, d.x, ly + wob, sc, now);
      // Muzzle flash for shooting poses
      if (d.pose === 'shoot' && Math.floor(now / 120 + d.x) % 2 === 0) {
        const [fx, fy] = mz || [d.x + 22 * sc, ly - 40 * sc];
        ctx.fillStyle = 'rgba(255,210,80,0.9)';
        ctx.beginPath();
        ctx.moveTo(fx, fy); ctx.lineTo(fx + 11 * sc, fy - 4 * sc);
        ctx.lineTo(fx + 11 * sc, fy + 4 * sc); ctx.closePath(); ctx.fill();
      }
    });
  });

  // ── Mass zombie horde, spread across all 3 lanes ────────────────
  // Camera time t∈[0,1]. Zombies start at the right edge and creep
  // closer as the shot progresses. Distributed across front/mid/back
  // lanes so the wave has visible depth — the player sees the
  // entire mass converging on the defensive line.
  const Z_COUNT = 38;
  const totalCreep = 240;
  for (let i = 0; i < Z_COUNT; i++) {
    const lane = i % 3;
    const sc = LANES[lane].sc;
    const ly = laneY(lane);
    const startX = CW - 30 + (i % 7) * 22 + Math.floor(i / 7) * 42;
    const speedJitter = 0.7 + (i * 0.13 % 0.6);
    const zx = startX - t * totalCreep * speedJitter
                      + Math.sin(now / 700 + i * 0.7) * 1.5;
    if (zx > CW + 40 || zx < WX + 360) continue;
    const ztype = i % 9 === 0 ? 'tank'
                : i % 4 === 0 ? 'runner'
                : 'walker';
    const z = mkIntroZombie({
      id: 'ir' + i, type: ztype, facing: -1, state: 'walk',
      walkPhase: i * 0.4,
    });
    dSpriteAt(dZombie, ctx, z, zx, ly, sc, now);
  }
  // Faint dust haze across all 3 lanes on the horizon
  const dust = ctx.createLinearGradient(0, GY - 80, 0, GY + 6);
  dust.addColorStop(0, 'rgba(40,35,30,0)');
  dust.addColorStop(0.5, 'rgba(60,50,40,0.16)');
  dust.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = dust;
  ctx.fillRect(WX + 360, GY - 80, CW - WX - 360, 86);

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
function dBannerText(ctx, shot, elapsed, _now) {
  ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
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
