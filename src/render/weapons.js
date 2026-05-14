import { WEAPON_SCALE } from '../constants.js';

// Procedural polygon weapon sprite, drawn in soldier-local coordinates.
// Sprite is scaled by WEAPON_SCALE so the barrel sits inside the soldier
// silhouette. Polish layers (highlights / shading) are drawn after the
// main shapes for each weapon.
export function dWpn(ctx, w, rcl = 0) {
  ctx.save(); ctx.translate(-rcl, 0);
  ctx.scale(WEAPON_SCALE, WEAPON_SCALE);
  if (w === 'rifle') {
    ctx.fillStyle = '#1a1816'; ctx.fillRect(-22, -3, 13, 5);
    ctx.fillStyle = '#252220'; ctx.fillRect(-22, -5, 13, 3);
    ctx.fillStyle = '#111010'; ctx.fillRect(-22, 2, 13, 2);
    ctx.fillStyle = '#2c2a26'; ctx.fillRect(-10, -4, 8, 7);
    ctx.fillStyle = '#22201c'; ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(20, -8); ctx.lineTo(20, 3); ctx.lineTo(-2, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1c1a16'; ctx.beginPath(); ctx.moveTo(4, 3); ctx.lineTo(10, 3); ctx.lineTo(8, 18); ctx.lineTo(2, 18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#141210'; for (let gy = 5; gy < 17; gy += 3) ctx.fillRect(3, gy, 6, 1.5);
    ctx.strokeStyle = '#1a1816'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(6, 9, 5.5, 0.05, Math.PI * 0.92); ctx.stroke();
    ctx.fillStyle = '#2a2824'; ctx.beginPath(); ctx.moveTo(5, 3); ctx.lineTo(13, 3); ctx.lineTo(12, 20); ctx.lineTo(4, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1e1c18'; ctx.fillRect(7, 3, 2, 17);
    ctx.fillStyle = '#2a2824'; ctx.fillRect(-2, -16, 34, 9);
    ctx.fillStyle = '#1e1c18'; ctx.fillRect(0, -18, 30, 3);
    ctx.fillStyle = '#161412'; for (let rx = 1; rx < 29; rx += 4) ctx.fillRect(rx, -18, 2, 3);
    ctx.fillStyle = '#302e2a'; ctx.fillRect(20, -15, 18, 10);
    ctx.fillStyle = '#1e1c18'; for (let rx = 22; rx < 36; rx += 5) { ctx.fillRect(rx, -15, 2, 2); ctx.fillRect(rx, -3, 2, 2); }
    ctx.fillStyle = '#1a1816'; ctx.fillRect(20, -8, 18, 2);
    ctx.fillStyle = '#141210'; ctx.fillRect(23, -14, 6, 3); ctx.fillRect(27, -16, 3, 3);
    ctx.fillStyle = '#181614'; ctx.fillRect(38, -6, 28, 4);
    ctx.fillStyle = '#222020'; ctx.fillRect(50, -10, 5, 8); ctx.fillRect(51, -12, 3, 3);
    ctx.fillStyle = '#1a1816'; ctx.fillRect(51, -12, 2, 7);
    ctx.fillStyle = '#181614'; ctx.fillRect(62, -12, 4, 10); ctx.beginPath(); ctx.moveTo(61, -12); ctx.lineTo(66, -12); ctx.lineTo(64, -15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#141210'; ctx.fillRect(64, -7, 6, 6);
    ctx.fillStyle = '#0e0d0c'; ctx.fillRect(65, -9, 2, 2); ctx.fillRect(65, 1, 2, 2); ctx.fillRect(68, -9, 2, 2); ctx.fillRect(68, 1, 2, 2);
    // Polish: top-edge highlight on receiver + barrel for metallic feel.
    ctx.fillStyle = 'rgba(220,220,210,0.18)';
    ctx.fillRect(-2, -17, 34, 1);   // upper receiver edge
    ctx.fillRect(38, -7, 28, 1);    // barrel top
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(-2, -8, 34, 1);    // lower receiver shadow
    ctx.fillRect(38, -2, 28, 1);    // barrel bottom shadow
  } else if (w === 'pistol') {
    ctx.fillStyle = '#2c1c0e'; ctx.beginPath(); ctx.moveTo(-2, 3); ctx.lineTo(9, 3); ctx.lineTo(7, 19); ctx.lineTo(-4, 19); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1e1208';
    for (let gx = 0; gx < 3; gx++) for (let gy = 0; gy < 5; gy++) { ctx.beginPath(); ctx.arc(-1 + gx * 3, 8 + gy * 2.1, 0.75, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#1c1208'; ctx.beginPath(); ctx.arc(7.5, 5.5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2c1c0e'; ctx.fillRect(-2, 4, 14, 5);
    ctx.fillStyle = '#1e1208'; ctx.fillRect(6, 4, 5, 6);
    ctx.fillStyle = '#241808'; ctx.fillRect(-3, 1, 26, 3);
    ctx.fillStyle = '#201e1a'; ctx.fillRect(-4, -5, 30, 10);
    ctx.fillStyle = '#2e2c28'; ctx.beginPath(); ctx.moveTo(-4, -14); ctx.lineTo(28, -14); ctx.lineTo(28, -5); ctx.lineTo(-4, -5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1816'; for (let sx = 1; sx >= -5; sx -= 2.5) ctx.fillRect(sx, -13, 1.5, 8);
    ctx.fillStyle = '#141210'; ctx.fillRect(8, -13, 14, 8);
    ctx.fillStyle = '#0c0b0a'; ctx.fillRect(9, -12, 12, 6);
    ctx.fillStyle = '#2e2c28'; ctx.fillRect(10, -10, 10, 3);
    ctx.fillStyle = '#181614'; ctx.fillRect(28, -11, 14, 4);
    ctx.fillStyle = '#141210'; ctx.fillRect(-2, -16, 7, 3);
    ctx.fillStyle = '#e8e8e8'; ctx.beginPath(); ctx.arc(0, -14, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -14, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#141210'; ctx.fillRect(22, -16, 4, 3);
    ctx.fillStyle = '#e83020'; ctx.beginPath(); ctx.arc(24, -14, 1.1, 0, Math.PI * 2); ctx.fill();
    // Polish: slide top + frame edge
    ctx.fillStyle = 'rgba(220,220,210,0.20)';
    ctx.fillRect(-4, -14, 32, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(-4, -5, 32, 1);
  } else if (w === 'sniper') {
    // M24 ground sprite (used when Delta descends or for any sniper recruit).
    // Stock
    ctx.fillStyle = '#3a2810'; ctx.fillRect(-26, -3, 14, 6);
    ctx.fillStyle = '#4a3214'; ctx.fillRect(-26, -3, 14, 2);    // wood highlight
    // Receiver / action
    ctx.fillStyle = '#181614'; ctx.fillRect(-12, -7, 22, 8);
    ctx.fillStyle = '#2a2824'; ctx.fillRect(-12, -7, 22, 2);    // top edge highlight
    // Bolt handle
    ctx.fillStyle = '#3e3838'; ctx.fillRect(-2, -10, 4, 5);
    // Magazine
    ctx.fillStyle = '#222018'; ctx.fillRect(-4, 1, 8, 7);
    // Trigger
    ctx.strokeStyle = '#1a1816'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(-2, 6, 4, 0.05, Math.PI * 0.92); ctx.stroke();
    // Grip
    ctx.fillStyle = '#2c1c0e'; ctx.beginPath();
    ctx.moveTo(-6, 1); ctx.lineTo(4, 1); ctx.lineTo(2, 16); ctx.lineTo(-8, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1e1208'; for (let gy = 3; gy < 14; gy += 3) ctx.fillRect(-7, gy, 8, 1.4);
    // Long barrel
    ctx.fillStyle = '#0e0c0a'; ctx.fillRect(10, -5, 56, 3);
    ctx.fillStyle = 'rgba(220,220,210,0.18)';
    ctx.fillRect(10, -5, 56, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(10, -3, 56, 1);
    // Suppressor
    ctx.fillStyle = '#1c1a18'; ctx.fillRect(66, -6, 10, 5);
    // Scope mount
    ctx.fillStyle = '#1a1816'; ctx.fillRect(-2, -13, 14, 4);
    // Scope optic (large)
    ctx.fillStyle = '#3e3838'; ctx.fillRect(-1, -16, 12, 5);
    ctx.fillStyle = '#1a1816';
    ctx.beginPath(); ctx.arc(0, -13, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -13, 2.2, 0, Math.PI * 2); ctx.fill();
    // Bipod
    ctx.strokeStyle = '#222018'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(20, -3); ctx.lineTo(18, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, -3); ctx.lineTo(26, 6); ctx.stroke();
  } else {
    ctx.fillStyle = '#2c2a22'; ctx.fillRect(-24, -3, 14, 5);
    ctx.fillStyle = '#1e1c16'; ctx.fillRect(-24, -5, 4, 9);
    ctx.fillStyle = '#222018'; ctx.fillRect(-10, -5, 5, 10);
    ctx.fillStyle = '#201e1a'; ctx.fillRect(-6, -14, 50, 19);
    ctx.fillStyle = '#2a2826'; ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(44, -14); ctx.lineTo(44, -8); ctx.lineTo(-6, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#cc8800'; ctx.beginPath(); ctx.arc(40, -10, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#aa6600'; ctx.fillRect(38, -10, 2, 1);
    ctx.fillStyle = '#5e3c1c'; ctx.beginPath(); ctx.moveTo(7, 5); ctx.lineTo(15, 5); ctx.lineTo(13, 20); ctx.lineTo(5, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3e2810'; for (let gy = 7; gy < 19; gy += 3) ctx.fillRect(6, gy, 8, 1.5);
    ctx.strokeStyle = '#5e3c1c'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(10, 12, 6.5, 0, Math.PI * 0.88); ctx.stroke();
    ctx.fillStyle = '#262420'; ctx.fillRect(12, 3, 32, 7);
    ctx.fillStyle = '#2e2c28'; ctx.fillRect(12, 4, 32, 2);
    ctx.fillStyle = '#1e1c18'; ctx.fillRect(12, 9, 32, 2);
    ctx.fillStyle = '#1c1a16'; ctx.fillRect(12, -14, 32, 8);
    ctx.fillStyle = '#262422'; ctx.fillRect(12, -14, 32, 2);
    ctx.fillStyle = '#141210'; ctx.fillRect(12, -6, 32, 2);
    ctx.fillStyle = '#4c3216'; ctx.beginPath(); ctx.moveTo(16, -14); ctx.lineTo(30, -14); ctx.lineTo(30, 10); ctx.lineTo(16, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#341e0a'; for (let px = 18; px < 29; px += 3) ctx.fillRect(px, -13, 1.5, 22);
    ctx.fillStyle = '#1a1814'; ctx.fillRect(12, -15, 32, 2);
    ctx.fillStyle = '#141210'; ctx.fillRect(43, -14, 6, 8); ctx.fillRect(43, 3, 6, 7);
    ctx.fillStyle = '#0a0908'; ctx.fillRect(44, -12, 4, 5); ctx.fillRect(44, 4, 4, 4);
    ctx.fillStyle = '#cc9900'; ctx.beginPath(); ctx.arc(43, -11, 1.8, 0, Math.PI * 2); ctx.fill();
    // Polish: top edge highlight on the receiver
    ctx.fillStyle = 'rgba(220,220,210,0.18)';
    ctx.fillRect(-6, -14, 50, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(-6, 4, 50, 1);
  }
  ctx.restore();
}
