import { C, CW, CH, GY, WX } from '../constants.js';
import { dBase } from './base.js';

// Opening cinematic — storyboarded as 12 distinct shots over 45 s,
// not five static wide compositions. Each shot is its own framed
// composition (close-ups for objects + hands, mid-shot silhouettes
// for action, wides only when the scene needs to breathe). Cuts are
// near-instant; a few brief crossfades smooth scene boundaries.
//
// Audio scheduling is timestamp-driven and aligned to the new
// 45 s timeline (see scheduleIntroAudio).
export const INTRO_DURATION = 45000;

// ── Timeline ───────────────────────────────────────────────────
// Each shot owns a draw fn + a window in ms. The renderer picks
// the active shot from `now - intro.startedAt` and dispatches.
const SHOTS = [
  // ── Scene 1: pre-outbreak ─────────────────────────────────
  { from: 0,     to: 3500,  draw: 'coffeeMug',      banner: 'normal' },
  { from: 3500,  to: 7000,  draw: 'quietStreet',    banner: 'normal' },
  // ── Scene 2: outbreak ─────────────────────────────────────
  { from: 7000,  to: 10500, draw: 'clawingHand',    banner: 'panic'  },
  { from: 10500, to: 13500, draw: 'familyFleeing',  banner: 'panic'  },
  { from: 13500, to: 16000, draw: 'streetChaos',    banner: 'panic'  },
  // ── Scene 3: police containment ───────────────────────────
  { from: 16000, to: 19500, draw: 'badgeFlash',     banner: 'police' },
  { from: 19500, to: 23500, draw: 'policeLine',     banner: 'police' },
  { from: 23500, to: 26500, draw: 'wounded',        banner: 'police' },
  // ── Scene 4: collapse ─────────────────────────────────────
  { from: 26500, to: 30000, draw: 'burningCar',     banner: 'collapse' },
  { from: 30000, to: 34000, draw: 'streetDead',     banner: 'collapse' },
  // ── Scene 5: Fort Omega — the last bulwark ────────────────
  { from: 34000, to: 38000, draw: 'rifleGrip',      banner: 'fortOmega' },
  { from: 38000, to: 45000, draw: 'fortWide',       banner: 'fortOmega' },
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

// 1.1 — Close-up of a coffee mug on a café table with a newspaper.
// Steam rises gently. The newspaper carries a small but ominous
// headline. Background is bokeh / warm street lamps out of focus.
function dShotCoffeeMug(ctx, t, now) {
  dBackgroundBokeh(ctx, '#0e1018', '#2a1e16', 18);
  // Table surface
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(0, CH - 160, CW, 160);
  ctx.fillStyle = '#1f1410';
  ctx.fillRect(0, CH - 160, CW, 5);

  // Newspaper at the bottom-left
  const nx = 80, ny = CH - 140;
  ctx.fillStyle = '#dcd5bc';
  ctx.fillRect(nx, ny, 280, 130);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 10px monospace';
  ctx.fillText('NEW HAVEN HERALD', nx + 8, ny + 16);
  ctx.fillStyle = '#3a3328'; ctx.font = 'bold 14px monospace';
  ctx.fillText('QUARANTINE EXTENDED', nx + 8, ny + 38);
  ctx.fillText('HOSPITAL WARDS SEALED', nx + 8, ny + 56);
  // Body text lines
  ctx.fillStyle = '#5a5040';
  for (let i = 0; i < 6; i++) ctx.fillRect(nx + 8, ny + 70 + i * 10, 200 + (i * 23) % 50, 1.5);

  // Coffee mug — ceramic, centred
  const mx = 570, my = CH - 80;
  // Saucer
  ctx.fillStyle = '#2a1a12';
  ctx.beginPath(); ctx.ellipse(mx, my + 38, 70, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a0e08';
  ctx.beginPath(); ctx.ellipse(mx, my + 36, 70, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Mug body
  ctx.fillStyle = '#eeeae0';
  ctx.fillRect(mx - 45, my - 50, 90, 88);
  // Bottom ellipse
  ctx.beginPath(); ctx.ellipse(mx, my + 38, 45, 7, 0, 0, Math.PI * 2); ctx.fill();
  // Top rim
  ctx.fillStyle = '#1a0e08';
  ctx.beginPath(); ctx.ellipse(mx, my - 50, 45, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Coffee surface
  ctx.fillStyle = '#3a1f12';
  ctx.beginPath(); ctx.ellipse(mx, my - 47, 41, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a2f1e';
  ctx.beginPath(); ctx.ellipse(mx, my - 49, 41, 5, 0, 0, Math.PI * 2); ctx.fill();
  // Handle
  ctx.strokeStyle = '#eeeae0'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(mx + 50, my - 12, 20, -Math.PI / 2.2, Math.PI / 2.2); ctx.stroke();
  ctx.strokeStyle = '#cfc8b4'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(mx + 50, my - 12, 24, -Math.PI / 2.2, Math.PI / 2.2); ctx.stroke();
  // Mug shadow on the side
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(mx + 30, my - 48, 14, 80);

  // Steam — three wavy strands rising and dissipating
  for (let s = 0; s < 3; s++) {
    ctx.beginPath();
    const sx = mx - 20 + s * 18;
    ctx.moveTo(sx, my - 50);
    for (let i = 0; i < 12; i++) {
      const py = my - 50 - i * 8;
      const px = sx + Math.sin(now / 220 + i * 0.6 + s) * 10;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = `rgba(220,220,210,${0.18 - s * 0.04})`;
    ctx.lineWidth = 3 + s; ctx.stroke();
  }
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

// 2.1 — Cracked glass with a bloody zombie hand reaching through.
function dShotClawingHand(ctx, t, now) {
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

// 3.1 — Police officer's badge with a muzzle flash exploding over it.
function dShotBadgeFlash(ctx, t, now) {
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
  // Officers in firing stances behind the cars
  const officers = [120, 240, 340, 460, 530];
  officers.forEach((ox, oi) => {
    const oy = GY - 6;
    const firing = Math.floor(now / 200 + oi) % 2 === 0;
    // Body
    ctx.fillStyle = '#1a2840';
    ctx.fillRect(ox - 5, oy - 36, 10, 22);
    // Yellow vest line
    ctx.fillStyle = '#c4a838';
    ctx.fillRect(ox - 5, oy - 28, 10, 2);
    // Legs
    ctx.fillStyle = '#1a2840';
    ctx.fillRect(ox - 5, oy - 14, 4, 14);
    ctx.fillRect(ox + 1, oy - 14, 4, 14);
    // Head + cap
    ctx.fillStyle = '#bf8a6a';
    ctx.beginPath(); ctx.arc(ox, oy - 42, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a2840';
    ctx.fillRect(ox - 4, oy - 46, 8, 3);
    // Pistol + arm extended
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(ox + 5, oy - 30, 14, 2.5);
    if (firing) {
      // Muzzle flash
      ctx.fillStyle = 'rgba(255,210,80,0.95)';
      ctx.beginPath();
      ctx.moveTo(ox + 19, oy - 29);
      ctx.lineTo(ox + 28, oy - 32);
      ctx.lineTo(ox + 28, oy - 26);
      ctx.closePath(); ctx.fill();
      // Bullet streak
      ctx.fillStyle = 'rgba(255,230,140,0.85)';
      ctx.fillRect(ox + 29, oy - 30, 30 + (oi * 17) % 60, 1.4);
    }
  });

  // Zombies advancing from the right
  for (let i = 0; i < 10; i++) {
    const zx = CW + 20 - (t * 320 + i * 40);
    if (zx > CW + 10) continue;
    if (zx < 540) continue;
    const wob = Math.sin(now / 220 + i) * 1.4;
    ctx.fillStyle = '#3d5a30';
    ctx.fillRect(zx - 4, GY - 32 + wob, 8, 24);
    ctx.beginPath(); ctx.arc(zx + wob * 0.3, GY - 38, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cc1818';
    ctx.fillRect(zx - 1.5 + wob * 0.3, GY - 38, 1, 1);
    ctx.fillRect(zx + 0.7 + wob * 0.3, GY - 38, 1, 1);
    ctx.fillStyle = '#1a2014';
    ctx.fillRect(zx - 3, GY - 8 + wob * 0.4, 3, 8);
    ctx.fillRect(zx, GY - 8 - wob * 0.4, 3, 8);
    ctx.fillStyle = '#3d5a30';
    ctx.fillRect(zx - 8, GY - 22, 4, 2);
    ctx.fillRect(zx + 4, GY - 22, 4, 2);
  }
}

// 3.3 — Wounded officer slumped against a car door, radio in hand.
function dShotWounded(ctx, t, now) {
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

// 4.1 — Big burning car in foreground, smoke filling the sky.
function dShotBurningCar(ctx, t, now) {
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

// 5.1 — Close-up of a soldier's gloved hand gripping a rifle.
function dShotRifleGrip(ctx, t, now) {
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

  // Soldier silhouettes on the rampart, evenly spaced
  const positions = [WX - 70, WX - 50, WX - 30, WX - 12, WX + 8];
  positions.forEach((sx, i) => {
    const wob = Math.sin(now / 380 + i) * 0.6;
    // Body
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(sx - 3, GY - 92 + wob, 6, 18);
    // Helmet
    ctx.fillStyle = '#1a2418';
    ctx.fillRect(sx - 4, GY - 95 + wob, 8, 4);
    // Rifle slung across the chest
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(sx - 7, GY - 86 + wob, 14, 1.4);
  });

  // Search light sweeping the field beyond
  const sweep = Math.sin(now / 1200) * 0.4;
  const lx = WX + 4, ly = GY - 96;
  const lgr = ctx.createLinearGradient(lx, ly, lx + 460, ly + 200);
  lgr.addColorStop(0, 'rgba(255,250,200,0.25)');
  lgr.addColorStop(1, 'rgba(255,250,200,0)');
  ctx.fillStyle = lgr;
  ctx.save();
  ctx.translate(lx, ly); ctx.rotate(sweep);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(480, 60); ctx.lineTo(480, 130); ctx.lineTo(0, 12);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // Distant zombie horde silhouettes
  for (let i = 0; i < 18; i++) {
    const zx = WX + 60 + i * 36 + Math.sin(now / 600 + i) * 4;
    if (zx > CW + 10) continue;
    ctx.fillStyle = '#1a261a';
    ctx.fillRect(zx, GY - 12, 4, 9);
    ctx.fillRect(zx - 1, GY - 16, 6, 3);
  }
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
      if (shot.draw === 'coffeeMug') {
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
      } else if (shot.draw === 'wounded') {
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

  // Scene 2 (7-16s): panic — screams + glass break on the clawing hand.
  fireOnce(intro, 'glass', elapsed > 7200, { t: 'crackle' });
  fireOnce(intro, 'scream1', elapsed > 7600, { t: 'scream' });
  fireOnce(intro, 'scream2', elapsed > 9000, { t: 'scream' });
  fireOnce(intro, 'scream3', elapsed > 11400, { t: 'scream' });
  fireOnce(intro, 'scream4', elapsed > 13200, { t: 'scream' });
  fireOnce(intro, 'scream5', elapsed > 14600, { t: 'scream' });

  // Scene 3 (16-26.5s): police containment — sirens + sustained fire.
  fireOnce(intro, 'siren1', elapsed > 16100, { t: 'siren' });
  fireOnce(intro, 'siren2', elapsed > 17800, { t: 'siren' });
  fireOnce(intro, 'siren3', elapsed > 20200, { t: 'siren' });
  fireOnce(intro, 'siren4', elapsed > 22500, { t: 'siren' });
  // Gunfire across shots 3.1, 3.2
  const shotTimes = [16400, 16900, 17400, 18200, 18900, 19600, 20300, 21000,
                     21700, 22300, 22900, 23500, 24100, 24700];
  shotTimes.forEach((tm, i) => {
    fireOnce(intro, 'gun' + i, elapsed > tm,
      { t: 'shot', w: (i % 4 === 0) ? 'shotgun' : (i % 3 === 0) ? 'rifle' : 'pistol' });
  });
  // Officer falling — a final scream + radio sting
  fireOnce(intro, 'screamP1', elapsed > 23800, { t: 'scream' });
  fireOnce(intro, 'screamP2', elapsed > 25100, { t: 'scream' });

  // Scene 4 (26.5-34s): collapse — drop the hum, start wind, fires.
  fireOnce(intro, 'humOff',   elapsed > 26400, { t: 'cityHumStop' });
  fireOnce(intro, 'windOn',   elapsed > 26500, { t: 'windStart', intensity: 0.55 });
  [26800, 27600, 28500, 29400, 30300, 31200, 32100, 33000].forEach((tm, i) => {
    fireOnce(intro, 'crack' + i, elapsed > tm, { t: 'crackle' });
  });
  // Distant helicopter departing
  fireOnce(intro, 'heliFar',    elapsed > 30200, { t: 'heliStart', intensity: 0.35 });
  fireOnce(intro, 'heliFarOff', elapsed > 33800, { t: 'heliStop' });

  // Scene 5 (34-45s): Fort Omega — title sting + soft wind out.
  fireOnce(intro, 'sting',   elapsed > 38800, { t: 'titleSting' });
  fireOnce(intro, 'windOff', elapsed > 43000, { t: 'windStop' });

  // Backstop: kill any lingering loop at the very end.
  if (elapsed >= INTRO_DURATION) {
    fireOnce(intro, 'finalHum',  true, { t: 'cityHumStop' });
    fireOnce(intro, 'finalWind', true, { t: 'windStop' });
    fireOnce(intro, 'finalHeli', true, { t: 'heliStop' });
  }
}

// ── Public entry ───────────────────────────────────────────────
const DRAWERS = {
  coffeeMug:     dShotCoffeeMug,
  quietStreet:   dShotQuietStreet,
  clawingHand:   dShotClawingHand,
  familyFleeing: dShotFamilyFleeing,
  streetChaos:   dShotStreetChaos,
  badgeFlash:    dShotBadgeFlash,
  policeLine:    dShotPoliceLine,
  wounded:       dShotWounded,
  burningCar:    dShotBurningCar,
  streetDead:    dShotStreetDead,
  rifleGrip:     dShotRifleGrip,
  fortWide:      dShotFortWide,
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
  const sceneBoundary = (s) => [7000, 16000, 26500, 34000].includes(s.from);
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
