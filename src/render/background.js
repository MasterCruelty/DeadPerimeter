import { C, CW, CH, GY, WX, LANES, WORLD_W } from '../constants.js';
import { STARS, BLDGS } from '../data/expeditions.js';

// Siege backdrop now paints across the full WORLD_W (~2.2× the
// viewport) so the camera-scroll reveals more skyline / ground as
// it pans, rather than running into a clipped edge.
export function dBg(ctx) {
  // Sky
  const sg = ctx.createLinearGradient(0, 0, 0, GY - 80);
  sg.addColorStop(0, C.sky1); sg.addColorStop(1, C.sky2);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, WORLD_W, GY - 80);
  STARS.forEach(s => {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + s.r * 0.22})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  });
  // Moon and a couple of distant fire glows across the wider skyline
  ctx.fillStyle = 'rgba(200,212,185,0.13)'; ctx.beginPath(); ctx.arc( 818, 42, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,80,0,0.07)'; ctx.beginPath(); ctx.arc( 660, GY - 90,  90, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,80,0,0.05)'; ctx.beginPath(); ctx.arc(1280, GY - 80, 110, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,80,0,0.06)'; ctx.beginPath(); ctx.arc(1720, GY - 95,  80, 0, Math.PI * 2); ctx.fill();

  // Ruined buildings (now spanning the wider world)
  BLDGS.forEach(b => {
    ctx.fillStyle = '#090c11';
    ctx.fillRect(b.x, GY - 80 - b.h, b.w, b.h);
    ctx.fillRect(b.x + b.w - 20, GY - 80 - b.h - 14, 20, 14);
    for (let wx = b.x + 8; wx < b.x + b.w - 8; wx += 18)
      for (let wy = GY - 80 - b.h + 12; wy < GY - 90; wy += 22)
        if (Math.sin((b.x + wx) * 0.1 + wy * 0.07) > 0.15) {
          ctx.fillStyle = '#0d1828';
          ctx.fillRect(wx, wy, 10, 12);
        }
  });

  // Back lane strip
  ctx.fillStyle = LANES[2].gshade;
  ctx.fillRect(WX, GY + LANES[2].dy - 4, WORLD_W - WX, 38);
  ctx.strokeStyle = '#1a1810'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(WX, GY + LANES[2].dy); ctx.lineTo(WORLD_W, GY + LANES[2].dy); ctx.stroke();

  // Mid lane strip
  ctx.fillStyle = LANES[1].gshade;
  ctx.fillRect(WX, GY + LANES[1].dy - 4, WORLD_W - WX, 38);
  ctx.strokeStyle = '#201e12';
  ctx.beginPath(); ctx.moveTo(WX, GY + LANES[1].dy); ctx.lineTo(WORLD_W, GY + LANES[1].dy); ctx.stroke();

  // Front lane + full ground
  const gg = ctx.createLinearGradient(0, GY, 0, CH);
  gg.addColorStop(0, C.g1); gg.addColorStop(1, C.g2);
  ctx.fillStyle = gg; ctx.fillRect(0, GY, WORLD_W, CH - GY);
  ctx.strokeStyle = '#2a2716'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(WORLD_W, GY); ctx.stroke();

  // Lane labels (faint)
  ctx.fillStyle = 'rgba(80,80,60,0.28)'; ctx.font = '8px monospace';
  ctx.fillText('FRONT', WX + 6, GY + 12);
  ctx.fillText('MID',   WX + 6, GY + LANES[1].dy + 12);
  ctx.fillText('BACK',  WX + 6, GY + LANES[2].dy + 12);
}
