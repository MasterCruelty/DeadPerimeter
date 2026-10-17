// Explore-mission dressing (see update/cityMission.js): the van you
// leave by, locked doors with their forcing progress, and the HUD bits
// (keys, leaving countdown).
import { C } from '../constants.js';
import { MGY } from '../data/expeditions.js';
import { VAN_X, leaveProgress } from '../update/cityMission.js';

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

function dLockedDoor(ctx, s, now) {
  const x = s.x0, y = MGY;
  // Boarded-up door with a chained padlock.
  ctx.fillStyle = '#2a1e12'; ctx.fillRect(x - 12, y - 70, 24, 70);
  ctx.fillStyle = '#5a3f22';
  [[-16, -60, 0.25], [-16, -38, -0.2], [-16, -16, 0.15]].forEach(([dx, dy, a]) => {
    ctx.save(); ctx.translate(x, y + dy); ctx.rotate(a); ctx.fillRect(dx, -4, 32, 8);
    ctx.fillStyle = '#3a2814'; ctx.fillRect(dx + 2, -1, 2, 2); ctx.fillRect(dx + 28, -1, 2, 2); ctx.restore();
    ctx.fillStyle = '#5a3f22';
  });
  ctx.fillStyle = '#c8a040'; ctx.fillRect(x - 5, y - 44, 10, 9);
  ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 44, 4, Math.PI, 0); ctx.stroke();
  if (s.force > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y - 96, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffb030'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y - 96, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.force); ctx.stroke();
  }
  const b = Math.sin(now / 220) * 2;
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ff9a6a'; ctx.fillText(s.force > 0 ? 'FORCING…' : '🔒 LOCKED', x, y - 80 + b);
  ctx.textAlign = 'left';
}

// Interior partition (ground floor) with a door, closed or open.
function dInteriorDoor(ctx, d) {
  const x = d.x, top = MGY - 80, y = MGY;
  const g = ctx.createLinearGradient(x - 6, 0, x + 6, 0);
  g.addColorStop(0, '#24201c'); g.addColorStop(0.5, '#3a342c'); g.addColorStop(1, '#1c1916');
  ctx.fillStyle = g; ctx.fillRect(x - 6, top, 12, y - top - 58);
  ctx.fillStyle = '#141210'; ctx.fillRect(x - 13, y - 60, 26, 3);           // lintel
  if (d.open) {
    ctx.fillStyle = 'rgba(8,8,6,0.85)'; ctx.fillRect(x - 11, y - 57, 22, 57);
    ctx.fillStyle = '#5a4026'; ctx.beginPath();
    ctx.moveTo(x + 11, y - 57); ctx.lineTo(x + 19, y - 53); ctx.lineTo(x + 19, y - 3); ctx.lineTo(x + 11, y); ctx.closePath(); ctx.fill();
    return;
  }
  const dg = ctx.createLinearGradient(0, y - 57, 0, y);
  dg.addColorStop(0, '#6a4c2c'); dg.addColorStop(1, '#3e2a16');
  ctx.fillStyle = dg; ctx.fillRect(x - 11, y - 57, 22, 57);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
  ctx.strokeRect(x - 8.5, y - 53.5, 17, 22); ctx.strokeRect(x - 8.5, y - 27.5, 17, 22);
  ctx.fillStyle = '#c8a040'; ctx.beginPath(); ctx.arc(x + 7, y - 30, 1.6, 0, Math.PI * 2); ctx.fill();
  if (d.prog > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y - 72, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#c8b890'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 72, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, d.prog)); ctx.stroke();
  }
}

// World pass (camera space).
export function dCityWorld(ctx, m, now) {
  if (m.objective !== 'explore') return;
  (m.idoors || []).forEach(d => dInteriorDoor(ctx, d));
  dVan(ctx, VAN_X, now, true);
  (m.segs || []).forEach(s => { if (s.locked) dLockedDoor(ctx, s, now); });
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
  ctx.fillText(`🔑 ×${m.keys}`, 12, 112);
  ctx.fillStyle = C.txt;
}
