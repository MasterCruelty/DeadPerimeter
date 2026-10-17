
// Weapon sprites, drawn in weapon-local "art units" (pistol grip near
// the origin, muzzle towards +x) and scaled per weapon by WSCALE so the
// guns are in proportion with a ~60 px soldier (a carbine is a bit more
// than half a person's height, a pistol a hand's length).
//
// Style: dark outline, metallic / polymer / wood fills with a top-lit
// gradient and a thin specular edge, matching the shaded actors.

export const WSCALE = { rifle: 0.42, shotgun: 0.44, sniper: 0.4, pistol: 0.34, ak: 0.42, smg: 0.42, revolver: 0.36, hunting: 0.4, dbarrel: 0.44 };

// Reference points in art units, used by the actor rig and the muzzle
// flash / light code:
//   butt  — end of the stock (pressed into the shoulder)
//   stock — y of the stock's centre line
//   grip  — trigger hand on the pistol grip
//   fore  — support hand (hand-guard / pump / under the barrel)
//   muzzle
export const WPOINTS = {
  rifle:   { butt: [-25, -1], grip: [5, 9],   fore: [25, -4],  muzzle: [69, -7.5] },
  shotgun: { butt: [-26, 0],  grip: [9, 10],  fore: [21, 2],   muzzle: [50, -10] },
  sniper:  { butt: [-30, -1], grip: [-1, 8],  fore: [19, -2],  muzzle: [78, -4] },
  pistol:  { butt: [-4, 6],   grip: [2.5, 9], fore: [3.5, 11], muzzle: [42, -9] },
  ak:      { butt: [-27, -1], grip: [5, 9],   fore: [27, -3],  muzzle: [68, -7] },
  smg:     { butt: [-19, -2], grip: [4, 9],   fore: [24, 2],   muzzle: [44, -6] },
  revolver:{ butt: [-4, 6],   grip: [2.5, 9], fore: [3.5, 11], muzzle: [44, -8] },
  hunting: { butt: [-31, -1], grip: [-1, 8],  fore: [22, -2],  muzzle: [78, -4] },
  dbarrel: { butt: [-26, 0],  grip: [9, 10],  fore: [24, 0],   muzzle: [54, -8] },
};
export const wpt = (w, k) => {
  const p = (WPOINTS[w] || WPOINTS.rifle)[k], sc = WSCALE[w] || WSCALE.rifle;
  return [p[0] * sc, p[1] * sc];
};

const OUT = 'rgba(6,6,5,0.95)';

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

function ak(ctx) {
  // Wooden stock + pistol grip, stamped receiver, banana mag, wood handguard.
  part(ctx, [[-27, -5], [-6, -7], [-5, 1], [-14, 2], [-27, 6]], ...WOOD, -7, 6);
  part(ctx, [[1, 1], [9, 1], [7, 15], [1, 16], [0, 13]], ...WOOD, 1, 16);
  part(ctx, [[12, 1], [19, 1], [24, 9, 28, 19], [21, 20], [16, 10, 12, 1]], ...METAL, 1, 20);
  part(ctx, [[-6, -12], [24, -12], [24, 2], [-6, 2]], ...METAL, -12, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(4, -9, 12, 3);
  ctx.strokeStyle = '#141516'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(9, 2); ctx.quadraticCurveTo(10, 7, 5, 6.5); ctx.stroke();
  part(ctx, [[24, -11], [40, -11], [40, -2], [24, -2]], ...WOOD, -11, -2);
  part(ctx, [[24, -15], [36, -15], [36, -11], [24, -11]], ...WOOD, -15, -11);
  part(ctx, [[40, -9], [63, -9], [63, -6], [40, -6]], ...METAL, -9, -6);
  part(ctx, [[40, -15], [56, -15], [56, -12], [40, -12]], ...METAL, -15, -12);
  part(ctx, [[55, -18], [58, -18], [58, -9], [55, -9]], ...METAL, -18, -9);
  part(ctx, [[62, -10], [68, -10], [68, -5], [62, -5]], ...METAL, -10, -5);
  spec(ctx, -5, -11.4, 23, 0.4);
}

function smg(ctx) {
  // MP5: wire stock, short receiver, curved mag ahead of the grip, foregrip.
  ctx.strokeStyle = '#1c1d1e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-19, -6); ctx.lineTo(-4, -6); ctx.moveTo(-19, 2); ctx.lineTo(-4, 0); ctx.moveTo(-19, -7); ctx.lineTo(-19, 3); ctx.stroke();
  part(ctx, [[0, 1], [8, 1], [7, 14], [1, 15], [-1, 12]], ...POLY, 1, 15);
  part(ctx, [[11, 1], [16, 1], [19, 8, 21, 17], [17, 18], [14, 9, 11, 1]], ...METAL, 1, 18);
  part(ctx, [[-4, -12], [32, -12], [32, 2], [-4, 2]], ...METAL, -12, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(6, -9, 9, 3);
  part(ctx, [[20, -9], [33, -9], [33, 3], [20, 3]], ...POLY, -9, 3);
  part(ctx, [[33, -8], [44, -8], [44, -4], [33, -4]], ...METAL, -8, -4);
  part(ctx, [[-2, -16], [6, -16], [6, -12], [-2, -12]], ...METAL, -16, -12);
  part(ctx, [[27, -16], [30, -16], [30, -12], [27, -12]], ...METAL, -16, -12);
  spec(ctx, -3, -11.3, 31, 0.4);
}

function revolver(ctx) {
  // Wood grip, frame + fluted cylinder, long ribbed barrel.
  part(ctx, [[-3, 0], [8, 0], [9, 17], [1, 19], [-4, 6]], ...WOOD, 0, 19);
  part(ctx, [[-4, -9], [12, -9], [12, 2], [-3, 2]], ...METAL, -9, 2);
  part(ctx, [[12, -11], [24, -11], [24, 1], [12, 1]], ...METAL, -11, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; for (let y = -9; y < 0; y += 3) ctx.fillRect(13, y, 10, 1);
  part(ctx, [[24, -10], [44, -10], [44, -5], [24, -5]], ...METAL, -10, -5);
  part(ctx, [[24, -12], [44, -12], [44, -10], [24, -10]], ...METAL, -12, -10);
  ctx.strokeStyle = '#141516'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(12, 2); ctx.quadraticCurveTo(13, 7, 7, 6.5); ctx.stroke();
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-5, -12, 3, 3);
  spec(ctx, 13, -10.6, 43, 0.5);
}

function hunting(ctx) {
  // Walnut sporter stock, bolt handle, small scope, slim long barrel.
  part(ctx, [[-31, -5], [-10, -7], [-2, -2], [-2, 3], [-12, 2], [-20, 6], [-31, 6]], ...WOOD, -7, 6);
  part(ctx, [[-3, 1], [4, 1], [2, 13], [-5, 12]], ...WOOD, 1, 13);
  part(ctx, [[-4, -8], [16, -8], [16, 1], [-4, 1]], ...METAL, -8, 1);
  part(ctx, [[16, -6], [44, -6], [44, 2], [16, 2]], ...WOOD, -6, 2);
  part(ctx, [[44, -6], [78, -5.5], [78, -3], [44, -2.5]], ...METAL, -6, -2.5);
  ctx.strokeStyle = '#1c1d1e'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(1, 0); ctx.stroke();
  ctx.fillStyle = '#2a2c2e'; ctx.beginPath(); ctx.arc(1, 0.5, 1.6, 0, Math.PI * 2); ctx.fill();
  part(ctx, [[-2, -16], [14, -16], [16, -18], [16, -11], [14, -13], [-2, -13]], ...METAL, -18, -11);
  part(ctx, [[2, -13], [5, -13], [5, -8], [2, -8]], ...METAL, -13, -8);
  part(ctx, [[10, -13], [13, -13], [13, -8], [10, -8]], ...METAL, -13, -8);
  spec(ctx, 45, -5.5, 77, 0.45);
}

function dbarrel(ctx) {
  // Side-by-side: wood stock + fore-end, two stacked barrels, no pump.
  part(ctx, [[-26, -5], [-4, -8], [-4, 4], [-14, 3], [-26, 6]], ...WOOD, -8, 6);
  part(ctx, [[5, 3], [12, 3], [11, 17], [4, 16]], ...WOOD, 3, 17);
  part(ctx, [[-4, -11], [12, -11], [12, 4], [-4, 4]], ...METAL, -11, 4);
  ctx.strokeStyle = '#141516'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(12, 4); ctx.quadraticCurveTo(13, 9, 7, 8.5); ctx.stroke();
  part(ctx, [[12, -12], [54, -12], [54, -8], [12, -8]], ...METAL, -12, -8);
  part(ctx, [[12, -8], [54, -8], [54, -4], [12, -4]], ...METAL, -8, -4);
  part(ctx, [[14, -4], [32, -4], [32, 3], [14, 3]], ...WOOD, -4, 3);
  ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.arc(54, -10, 1.3, 0, Math.PI * 2); ctx.arc(54, -6, 1.3, 0, Math.PI * 2); ctx.fill();
  spec(ctx, 13, -11.4, 53, 0.45);
}

const ART = { rifle, pistol, sniper, shotgun, ak, smg, revolver, hunting, dbarrel };

export function dWpn(ctx, w, rcl = 0) {
  ctx.save(); ctx.translate(-rcl, 0);
  const k = WSCALE[w] || WSCALE.rifle;
  ctx.scale(k, k);
  (ART[w] || rifle)(ctx);
  ctx.restore();
}
