import { WEAPON_SCALE } from '../constants.js';

// Weapon sprites, drawn in weapon-local coordinates (pistol grip near
// the origin, muzzle towards +x) and scaled by WEAPON_SCALE. The hand
// holds in render/actors/people.js and the muzzle-flash anchors in
// render/soldier.js are expressed in this same space, so keep the grip,
// fore-grip and muzzle positions stable when touching the art.
//
// Style: dark outline, metallic / polymer / wood fills with a top-lit
// gradient and a thin specular edge, matching the shaded actors.

const OUT = 'rgba(6,6,5,0.95)';

// The pistol art is authored large; it is drawn at this extra scale.
export const PISTOL_K = 0.72;

function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
}

// Fill a part with a vertical gradient (top light → bottom dark).
function part(ctx, pts, top, mid, bot, y0, y1, outline = true) {
  path(ctx, pts);
  if (outline) { ctx.strokeStyle = OUT; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke(); }
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top); g.addColorStop(0.45, mid); g.addColorStop(1, bot);
  ctx.fillStyle = g; ctx.fill();
}

const METAL = ['#5c6066', '#2c2f33', '#141517'];
const POLY = ['#3c3e40', '#222324', '#0f1010'];
const TAN = ['#8a7a58', '#5e5038', '#3a3020'];
const WOOD = ['#8a5a2e', '#5e3a1a', '#36200c'];

function spec(ctx, x0, y, x1, a = 0.35) {
  ctx.strokeStyle = `rgba(230,235,240,${a})`; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
}

function rifle(ctx) {
  // Collapsible stock + buffer tube
  part(ctx, [[-25, -6], [-12, -7], [-11, -4], [-12, 3], [-22, 5], [-25, 4]], ...POLY, -7, 5);
  part(ctx, [[-12, -5], [0, -5], [0, -1], [-12, -1]], ...METAL, -5, -1);
  // Pistol grip (behind the magazine)
  part(ctx, [[1, 1], [9, 1], [8, 16], [2, 17], [0, 15]], ...POLY, 1, 17);
  // Curved magazine
  part(ctx, [[11, 1], [19, 1], [21, 10, 22, 18], [14, 19], [13, 10, 11, 1]], ...TAN, 1, 19);
  // Lower + upper receiver with picatinny rail
  part(ctx, [[-2, -8], [21, -8], [21, 2], [-1, 2]], ...METAL, -8, 2);
  part(ctx, [[-2, -15], [34, -15], [34, -8], [-2, -8]], ...METAL, -15, -8);
  ctx.fillStyle = '#121314';
  for (let x = -1; x < 33; x += 3) ctx.fillRect(x, -17, 2, 2.2);
  spec(ctx, -1, -14.5, 33);
  // Trigger guard
  ctx.strokeStyle = '#141516'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(9, 2); ctx.quadraticCurveTo(10, 7, 5, 6.5); ctx.stroke();
  // Handguard with vent slots
  part(ctx, [[21, -14], [40, -14], [40, -5], [21, -5]], ...POLY, -14, -5);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (let x = 24; x < 38; x += 4) ctx.fillRect(x, -11.5, 2.4, 4);
  // Barrel, gas block, front sight, flash hider
  part(ctx, [[40, -9], [63, -9], [63, -6], [40, -6]], ...METAL, -9, -6);
  part(ctx, [[49, -12], [54, -12], [54, -5], [49, -5]], ...METAL, -12, -5);
  part(ctx, [[50.5, -16], [52.5, -16], [53, -12], [50, -12]], ...METAL, -16, -12);
  part(ctx, [[62, -10.5], [69, -10.5], [69, -4.5], [62, -4.5]], ...POLY, -10.5, -4.5);
  ctx.fillStyle = '#050505'; ctx.fillRect(64, -9.5, 1, 4); ctx.fillRect(66.5, -9.5, 1, 4);
  // Red-dot optic
  part(ctx, [[8, -22], [18, -22], [19, -17], [7, -17]], ...METAL, -22, -17);
  ctx.fillStyle = 'rgba(255,60,40,0.9)'; ctx.fillRect(17.6, -20.5, 1, 1.4);
  spec(ctx, 8.5, -21.4, 17.5, 0.4);
}

function pistol(ctx) {
  part(ctx, [[-3, 0], [9, 0], [8, 19], [-3, 19], [-4, 4]], ...POLY, 0, 19);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 5; y < 17; y += 2.4) ctx.fillRect(-2, y, 9, 0.9);
  ctx.strokeStyle = '#141516'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.quadraticCurveTo(15, 6, 9, 5.5); ctx.stroke();
  part(ctx, [[-4, -5], [27, -5], [27, 0], [-3, 1]], ...POLY, -5, 1);
  part(ctx, [[-5, -14], [28, -14], [29, -5], [-5, -5]], ...METAL, -14, -5);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let x = -3; x < 4; x += 2) ctx.fillRect(x, -12.5, 1, 6);
  ctx.fillRect(10, -11, 9, 3.5);
  part(ctx, [[28, -11], [42, -11], [42, -7], [28, -7]], ...METAL, -11, -7);
  spec(ctx, -4, -13.4, 27, 0.45);
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-2, -16, 1.4, 1.4); ctx.fillRect(24, -16, 1.4, 1.4);
}

function sniper(ctx) {
  // Thumbhole wooden stock
  part(ctx, [[-30, -6], [-12, -8], [-6, -4], [-4, 2], [-10, 3], [-14, 1], [-20, 5], [-30, 5]], ...WOOD, -8, 5);
  ctx.fillStyle = '#1a0e06'; ctx.beginPath(); ctx.ellipse(-12, -1.5, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  part(ctx, [[-5, 1], [3, 1], [1, 15], [-6, 14]], ...WOOD, 1, 15);
  part(ctx, [[-12, -8], [12, -8], [12, 1], [-12, 1]], ...METAL, -8, 1);
  part(ctx, [[-1, -11], [3, -11], [3, -7], [-1, -7]], ...METAL, -11, -7);
  ctx.fillStyle = '#2a2c2e'; ctx.beginPath(); ctx.arc(1, -11, 2, 0, Math.PI * 2); ctx.fill();
  part(ctx, [[-3, 1], [5, 1], [5, 8], [-3, 8]], ...POLY, 1, 8);
  // Fluted heavy barrel + suppressor
  part(ctx, [[12, -6.5], [66, -5.5], [66, -2.5], [12, -1.5]], ...METAL, -6.5, -1.5);
  part(ctx, [[66, -7.5], [78, -7.5], [78, -0.5], [66, -0.5]], ...POLY, -7.5, -0.5);
  // Scope with bells
  part(ctx, [[-6, -19], [-1, -18], [12, -18], [17, -20], [17, -12], [12, -14], [-1, -14], [-6, -13]], ...METAL, -20, -12);
  ctx.fillStyle = 'rgba(120,180,220,0.55)'; ctx.fillRect(16, -18.5, 1, 5);
  part(ctx, [[0, -14], [3, -14], [3, -8], [0, -8]], ...METAL, -14, -8);
  part(ctx, [[9, -14], [12, -14], [12, -8], [9, -8]], ...METAL, -14, -8);
  spec(ctx, -1, -17.4, 12, 0.5);
  // Bipod
  ctx.strokeStyle = '#1c1d1e'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(22, -2); ctx.lineTo(19, 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(25, -2); ctx.lineTo(28, 8); ctx.stroke();
}

function shotgun(ctx) {
  part(ctx, [[-26, -5], [-6, -8], [-6, 4], [-14, 3], [-26, 6]], ...WOOD, -8, 6);
  part(ctx, [[6, 3], [13, 3], [12, 18], [5, 17]], ...WOOD, 3, 18);
  part(ctx, [[-6, -13], [13, -13], [13, 4], [-6, 4]], ...METAL, -13, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, -9, 9, 4);
  ctx.strokeStyle = '#141516'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(13, 4); ctx.quadraticCurveTo(14, 9, 8, 8.5); ctx.stroke();
  // Barrel over magazine tube
  part(ctx, [[13, -12.5], [50, -12.5], [50, -7.5], [13, -7.5]], ...METAL, -12.5, -7.5);
  part(ctx, [[13, -6.5], [46, -6.5], [46, -1.5], [13, -1.5]], ...METAL, -6.5, -1.5);
  // Ribbed pump
  part(ctx, [[16, -7], [32, -7], [32, 4], [16, 4]], ...WOOD, -7, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  for (let x = 18; x < 31; x += 2.6) ctx.fillRect(x, -6, 1.1, 9);
  spec(ctx, 14, -12, 49, 0.4);
  ctx.fillStyle = '#d0a020'; ctx.beginPath(); ctx.arc(48.5, -13.3, 1.2, 0, Math.PI * 2); ctx.fill();
}

export function dWpn(ctx, w, rcl = 0) {
  ctx.save(); ctx.translate(-rcl, 0);
  ctx.scale(WEAPON_SCALE, WEAPON_SCALE);
  if (w === 'rifle') rifle(ctx);
  else if (w === 'pistol') { ctx.scale(PISTOL_K, PISTOL_K); pistol(ctx); }
  else if (w === 'sniper') sniper(ctx);
  else shotgun(ctx);
  ctx.restore();
}
