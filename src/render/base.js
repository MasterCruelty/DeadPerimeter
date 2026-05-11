import { C, CH, GY, WX } from '../constants.js';

export function dBase(ctx, hp, mhp) {
  const g = ctx.createLinearGradient(0, 0, WX, 0); g.addColorStop(0, '#141210'); g.addColorStop(1, '#272219');
  ctx.fillStyle = g; ctx.fillRect(0, GY - 160, WX + 12, 160 + (CH - GY));
  for (let py = GY - 150; py < GY + 15; py += 32) {
    ctx.fillStyle = '#2d2720'; ctx.fillRect(5, py, WX, 24);
    ctx.strokeStyle = '#181310'; ctx.lineWidth = 1; ctx.strokeRect(5, py, WX, 24);
  }
  ctx.fillStyle = '#37312a'; ctx.fillRect(0, GY - 160, WX + 12, 8);
  for (let bx = 8; bx < WX; bx += 22) { ctx.fillStyle = '#1e1a15'; ctx.fillRect(bx, GY - 175, 13, 20); }
  ctx.strokeStyle = '#484840'; ctx.lineWidth = 1;
  for (let wx = 5; wx < WX; wx += 10) { ctx.beginPath(); ctx.arc(wx, GY - 160, 5, 0, Math.PI * 2); ctx.stroke(); }
  for (let sx = 5; sx < WX + 80; sx += 20) {
    ctx.fillStyle = '#483c28'; ctx.beginPath(); ctx.ellipse(sx + 8, GY + 4, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3c3020'; ctx.beginPath(); ctx.ellipse(sx + 18, GY + 6, 10, 6, 0.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#15120e'; ctx.fillRect(14, GY - 135, 126, 26);
  ctx.strokeStyle = '#467822'; ctx.lineWidth = 1; ctx.strokeRect(14, GY - 135, 126, 26);
  ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace'; ctx.fillText('✦ FORT OMEGA ✦', 20, GY - 115);
  const bw = WX + 12, pct = hp / mhp;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, GY - 175, bw, 5);
  ctx.fillStyle = pct > 0.6 ? C.acc : pct > 0.3 ? C.wrn : C.dng;
  ctx.fillRect(0, GY - 175, bw * pct, 5);
}
