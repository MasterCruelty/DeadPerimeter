// Siege mid-wave events (see update/siegeEvents.js): the running
// survivor and the parachuted supply crate, plus their HUD banner.
import { CW, laneY, laneSc, zoomOf } from '../constants.js';
import { drawSoldierBody } from './actors/people.js';
import { dContactShadow } from './background.js';
import { dCrate } from './transmission.js';
import { crateLeft } from '../update/siegeEvents.js';

function marker(ctx, x, y, label, col, now) {
  const b = Math.sin(now / 160) * 3;
  ctx.fillStyle = col; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 14 + b);
  ctx.beginPath(); ctx.moveTo(x - 5, y - 9 + b); ctx.lineTo(x + 5, y - 9 + b); ctx.lineTo(x, y - 3 + b); ctx.fill();
  ctx.textAlign = 'left';
}

// World-space part (inside the camera transform).
export function dSiegeEvent(ctx, gs, now) {
  const ev = gs.waveEvent;
  if (!ev || ev.state !== 'active') return;
  const ly = laneY(ev.lane), sc = laneSc(ev.lane);
  if (ev.type === 'survivor') {
    dContactShadow(ctx, ev.x, ly + 1, sc, 15);
    ctx.save(); ctx.translate(ev.x, ly); ctx.scale(-sc, sc);
    drawSoldierBody(ctx, { name: ev.name, id: 7000 + ev.name.length, civilian: true, unarmed: true, npc: true,
      state: 'walk', facing: -1, hurtTimer: ev.hurtAt && now - ev.hurtAt < 200 ? 200 : 0 }, now * 1.6);
    ctx.restore();
    const top = ly - 70 * sc;
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(ev.x - 16, top, 32, 4);
    ctx.fillStyle = ev.hp > 20 ? '#66dd77' : '#ee5544'; ctx.fillRect(ev.x - 16, top, 32 * Math.max(0, ev.hp / ev.maxHp), 4);
    marker(ctx, ev.x, top - 4, ev.name.toUpperCase(), '#88ee99', now);
    return;
  }
  const y = ly - 9 * sc + ev.dropY;
  if (ev.landed) {
    // Green smoke marker.
    for (let i = 0; i < 6; i++) {
      const ph = (now / 1600 + i / 6) % 1;
      ctx.fillStyle = `rgba(110,220,120,${0.32 * (1 - ph)})`;
      ctx.beginPath(); ctx.arc(ev.x + 6 + ph * 22, y - 12 - ph * 70, 5 + ph * 14, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.save(); ctx.translate(ev.x, y); ctx.scale(sc, sc);
  dCrate(ctx, 0, 0, ev.landed ? 0 : 1, now);
  ctx.restore();
  if (ev.landed) marker(ctx, ev.x, y - 14 * sc, 'SUPPLIES', '#ffd54a', now);
}

// Screen-space banner under the HUD bar.
export function dSiegeEventBanner(ctx, gs, now) {
  const ev = gs.waveEvent;
  if (!ev || ev.state === 'pending') return;
  const age = now - (ev.endedAt || now);
  if (ev.state !== 'active' && age > 3500) return;
  let text, col;
  if (ev.state === 'done') { text = ev.type === 'survivor' ? `✔ ${ev.name.toUpperCase()} IS SAFE` : '✔ SUPPLIES RECOVERED'; col = '#88ee99'; }
  else if (ev.state === 'failed') { text = ev.type === 'survivor' ? `✖ ${ev.name.toUpperCase()} DIDN'T MAKE IT` : '✖ CRATE LOST'; col = '#ee6655'; }
  else if (ev.type === 'survivor') { text = `🧍 SURVIVOR INBOUND · LANE ${ev.lane + 1} · COVER ${ev.name.toUpperCase()}`; col = '#88ee99'; }
  else {
    const left = crateLeft(ev, now);
    text = left === null ? '📦 SUPPLY DROP INCOMING' : `📦 RECOVER THE CRATE · MOVE A SOLDIER TO IT · ${left}s`;
    col = '#ffd54a';
  }
  // Direction hint when the target is off-screen.
  const sx = ev.x - (gs.cameraX || 0);
  if (ev.state === 'active') { if (sx < 0) text = `◀ ${text}`; else if (sx > CW / zoomOf(gs)) text = `${text} ▶`; }
  ctx.save();
  ctx.font = 'bold 10px monospace';
  const w = ctx.measureText(text).width + 22, x = (CW - w) / 2, y = gs.boss && gs.boss.state !== 'dead' ? 108 : 72;
  ctx.globalAlpha = ev.state === 'active' ? 1 : Math.max(0, 1 - age / 3500);
  ctx.fillStyle = 'rgba(8,12,8,0.88)'; ctx.fillRect(x, y, w, 18);
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 17);
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(text, CW / 2, y + 13);
  ctx.restore();
}
