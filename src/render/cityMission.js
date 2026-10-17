// Explore-mission dressing (see update/cityMission.js): the van you
// leave by, barricades with their tearing-down progress, and the HUD
// bits (bolt cutters, leaving countdown). Rooms are in render/rooms.js.
import { C } from '../constants.js';
import { MGY } from '../data/expeditions.js';
import { VAN_X, leaveProgress } from '../update/cityMission.js';
import { dRoomsWorld } from './rooms.js';

function dVan(ctx, x, now, lit) {
  const y = MGY;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 56, 6, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(0, y - 46, 0, y);
  g.addColorStop(0, '#6c7058'); g.addColorStop(0.5, '#4a4e3a'); g.addColorStop(1, '#262a1c');
  ctx.fillStyle = g; ctx.strokeStyle = '#0a0b08'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 54, y - 8); ctx.lineTo(x - 54, y - 44); ctx.lineTo(x + 24, y - 44);
  ctx.lineTo(x + 40, y - 28); ctx.lineTo(x + 56, y - 24); ctx.lineTo(x + 56, y - 8); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Windscreen, side window, door seam, red cross
  ctx.fillStyle = 'rgba(140,170,190,0.45)';
  ctx.beginPath(); ctx.moveTo(x + 24, y - 41); ctx.lineTo(x + 36, y - 29); ctx.lineTo(x + 24, y - 29); ctx.closePath(); ctx.fill();
  ctx.fillRect(x + 4, y - 40, 16, 10);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(x - 2, y - 42); ctx.lineTo(x - 2, y - 10); ctx.stroke();
  ctx.fillStyle = '#e8e4d8'; ctx.fillRect(x - 36, y - 34, 18, 18);
  ctx.fillStyle = '#b02020'; ctx.fillRect(x - 30, y - 32, 6, 14); ctx.fillRect(x - 34, y - 28, 14, 6);
  ctx.fillStyle = '#0a0a0a';
  [-34, 34].forEach(wx => { ctx.beginPath(); ctx.arc(x + wx, y - 6, 9, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = '#5a5a5a';
  [-34, 34].forEach(wx => { ctx.beginPath(); ctx.arc(x + wx, y - 6, 3, 0, Math.PI * 2); ctx.fill(); });
  // Headlight + beacon
  ctx.fillStyle = lit ? '#fff4c8' : '#8a8670'; ctx.fillRect(x + 52, y - 22, 4, 5);
  ctx.fillStyle = Math.floor(now / 500) % 2 ? '#ffb030' : '#6a4a10'; ctx.fillRect(x - 10, y - 48, 8, 4);
}

// Chained barricade blocking the street: planks, a car door, sandbags
// and a chained gate. Cut the chain (bolt cutters) or tear it down.
function dBarricade(ctx, s, now) {
  const x = s.x0, y = MGY;
  // Sandbag base
  ctx.fillStyle = '#7a6a48';
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3 - k; j++) {
    ctx.beginPath(); ctx.ellipse(x - 18 + j * 18 + k * 9, y - 7 - k * 11, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x - 30 + k * 9, y - 7 - k * 11); ctx.lineTo(x + 30 - k * 9, y - 7 - k * 11); ctx.stroke(); }
  // Uprights + crossed planks
  ctx.fillStyle = '#3a2a18'; ctx.fillRect(x - 16, y - 96, 6, 96); ctx.fillRect(x + 10, y - 96, 6, 96);
  ctx.fillStyle = '#6a4c2c';
  [[-60, 0.32], [-44, -0.28], [-74, 0.05], [-28, 0.12]].forEach(([dy, a]) => {
    ctx.save(); ctx.translate(x, y + dy); ctx.rotate(a); ctx.fillRect(-30, -4, 60, 8);
    ctx.fillStyle = '#3a2814'; ctx.fillRect(-26, -1, 2, 2); ctx.fillRect(24, -1, 2, 2); ctx.restore();
    ctx.fillStyle = '#6a4c2c';
  });
  // Scrap car door
  ctx.fillStyle = '#5a2a22'; ctx.beginPath(); ctx.moveTo(x - 24, y - 52); ctx.lineTo(x + 6, y - 58); ctx.lineTo(x + 8, y - 32); ctx.lineTo(x - 22, y - 30); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(140,170,190,0.35)'; ctx.fillRect(x - 18, y - 54, 18, 8);
  // Barbed wire across the top
  ctx.strokeStyle = '#8a8a80'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k <= 8; k++) ctx.lineTo(x - 26 + k * 6.5, y - 98 + Math.sin(k * 1.7) * 3);
  ctx.stroke();
  // Chain + padlock
  if (!s.force || s.force < 0.5) {
    ctx.strokeStyle = '#a8a8a0'; ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.ellipse(x - 14 + k * 5.5, y - 66 + (k % 2), 3, 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#c8a040'; ctx.fillRect(x - 4, y - 64, 9, 8);
    ctx.strokeStyle = '#c8a040'; ctx.beginPath(); ctx.arc(x + 0.5, y - 64, 3.5, Math.PI, 0); ctx.stroke();
  }
  if (s.force > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y - 122, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffb030'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y - 122, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.force); ctx.stroke();
  }
  const b = Math.sin(now / 220) * 2;
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ff9a6a'; ctx.fillText(s.force > 0 ? 'TEARING DOWN…' : '⛓ BARRICADE', x, y - 106 + b);
  ctx.textAlign = 'left';
}

// World pass (camera space).
export function dCityWorld(ctx, m, now) {
  if (m.objective !== 'explore') return;
  dRoomsWorld(ctx, m, now);
  if (m.room) return;
  dVan(ctx, VAN_X, now, true);
  (m.segs || []).forEach(s => { if (s.locked) dBarricade(ctx, s, now); });
  const p = leaveProgress(m, now);
  if (m._ventured) {
    const b = Math.sin(now / 240) * 2;
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = p > 0 ? '#88ee99' : 'rgba(200,220,180,0.8)';
    ctx.fillText(p > 0 ? 'LOADING UP…' : '🚐 LEAVE HERE', VAN_X, MGY - 62 + b);
    if (p > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(VAN_X - 30, MGY - 56, 60, 5);
      ctx.fillStyle = '#88ee99'; ctx.fillRect(VAN_X - 30, MGY - 56, 60 * p, 5);
    }
    ctx.textAlign = 'left';
  }
}

// Screen-space: keys carried.
export function dCityHUD(ctx, m) {
  if (m.objective !== 'explore' || !m.keys) return;
  ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#ffd54a';
  ctx.fillText(`✂ ×${m.keys}`, 12, 112);
  ctx.fillStyle = C.txt;
}
