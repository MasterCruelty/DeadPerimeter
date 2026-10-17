import { C, CW, CH, WX, WORLD_W, laneY, laneSc, zoomOf } from '../constants.js';
import { BALANCE, waveClearAmmoFor } from '../data/difficulty.js';
import { WAVE_MODS } from '../data/waveMods.js';
import { dSiegeEventBanner } from './siegeEvents.js';

export function dSquadMarker(ctx, target, lane, now) {
  if (target === null || lane === null) return;
  const p = 0.55 + 0.45 * Math.sin(now / 220);
  const ly = laneY(lane), sc = laneSc(lane);
  ctx.save();
  ctx.strokeStyle = `rgba(114,188,64,${p * 0.9})`;
  ctx.fillStyle = `rgba(114,188,64,${p * 0.4})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(target - 10 * sc, ly - 2); ctx.lineTo(target + 10 * sc, ly - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(target, ly - 2); ctx.lineTo(target, ly - 16 * sc); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(target - 7 * sc, ly - 10 * sc); ctx.lineTo(target, ly - 2); ctx.lineTo(target + 7 * sc, ly - 10 * sc); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = `rgba(114,188,64,${p * 0.5})`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(target, ly - 28 * sc, 6 * sc, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.acc;
  ctx.font = `bold ${Math.round(8 * sc)}px monospace`; ctx.textAlign = 'center';
  ctx.fillText(['F', 'M', 'B'][lane], target, ly - 24 * sc);
  ctx.textAlign = 'left'; ctx.restore();
}

// Geometry of the clickable HUD widgets (screen space). Exported so the
// canvas click handler in DeadPerimeter.jsx hit-tests the same rects the
// renderer draws.
export const HUD_MUTE  = { x: 852, y: 5,  w: 38, h: 27 };
export const HUD_SPEED = { x: 806, y: 5,  w: 40, h: 27 };
export const HUD_RADAR = { x: CW - 318, y: 42, w: 308, h: 26 };

// Enemies still to deal with this wave: queued spawns + living hostiles.
export function waveRemaining(gs) {
  const pool = gs.isHumanWave ? gs.humans : gs.zombies;
  const live = (pool || []).filter(e => e.state !== 'dead').length;
  return live + (gs.spawnQueue ? gs.spawnQueue.length : 0);
}

function bar(ctx, x, y, w, h, pct, col) {
  ctx.fillStyle = 'rgba(20,20,18,0.95)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(x, y, Math.max(0, Math.min(1, pct)) * w, h);
  ctx.strokeStyle = 'rgba(114,188,64,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function dHUD(ctx, gs, now, muted) {
  ctx.save();
  const hg = ctx.createLinearGradient(0, 0, 0, 38);
  hg.addColorStop(0, 'rgba(6,10,6,0.92)'); hg.addColorStop(1, 'rgba(0,0,0,0.70)');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, CW, 38);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 38.5); ctx.lineTo(CW, 38.5); ctx.stroke();

  // ── Day / wave + wave progress
  ctx.fillStyle = C.acc; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`DAY ${gs.day} · WAVE ${gs.wave}/${BALANCE.maxWaves}`, 12, 17);
  const total = Math.max(1, gs.waveTotal || 1);
  const left = waveRemaining(gs);
  bar(ctx, 12, 24, 170, 6, 1 - left / total, gs.isHumanWave ? '#cc5544' : '#8a9a5a');
  ctx.fillStyle = C.txt; ctx.font = '8px monospace';
  ctx.fillText(gs.waveComplete ? 'CLEARED' : `${left} HOSTILE${left === 1 ? '' : 'S'} LEFT`, 186, 31);

  // ── Wall integrity
  const wp = gs.baseHp / (gs.baseMaxHp || 1);
  const wcol = wp > 0.6 ? C.acc : wp > 0.3 ? C.wrn : C.dng;
  ctx.fillStyle = C.txt; ctx.font = '8px monospace';
  ctx.fillText('WALL', 296, 14);
  ctx.fillStyle = wcol; ctx.font = 'bold 10px monospace';
  ctx.fillText(`${Math.max(0, Math.round(gs.baseHp))}/${gs.baseMaxHp}`, 326, 14);
  bar(ctx, 296, 20, 120, 8, wp, wcol);
  if (wp <= 0.3 && Math.floor(now / 300) % 2 === 0) {
    ctx.strokeStyle = C.dng; ctx.lineWidth = 1; ctx.strokeRect(294.5, 18.5, 123, 11);
  }

  // ── Score + stash
  ctx.font = '11px monospace'; ctx.fillStyle = C.txt;
  ctx.fillText(`☠ ${gs.kills}`, 432, 16);
  ctx.fillText(`⭐ ${gs.score}`, 432, 31);
  const r = gs.resources || {};
  ctx.font = '10px monospace';
  ctx.fillStyle = r.ammo < 30 ? C.dng : r.ammo < 60 ? C.wrn : C.txt;
  ctx.fillText(`🔫 ${r.ammo}`, 512, 16);
  ctx.fillStyle = (r.sniperAmmo || 0) === 0 ? C.dng : C.txt;
  ctx.fillText(`🎯 ${r.sniperAmmo || 0}`, 512, 31);
  if ((gs.turrets || []).length > 0) {
    ctx.fillStyle = (r.turretAmmo || 0) === 0 ? C.dng : C.txt;
    ctx.fillText(`🟠 ${r.turretAmmo || 0}`, 572, 16);
  }

  // ── Selection hint
  ctx.fillStyle = 'rgba(184,204,170,0.55)'; ctx.font = '8px monospace';
  const sel = gs.selectedSoldierId ? (gs.soldiers.find(s => s.id === gs.selectedSoldierId) || {}).name : null;
  ctx.fillText(sel ? `▸ ${sel.toUpperCase()} SELECTED` : 'CLICK LANE → MOVE SQUAD', 640, 16);
  ctx.fillText('1-9 SELECT · ←/→ PAN · F SPEED', 640, 29);

  // ── Speed toggle (fast-forward)
  const fast = (gs.speed || 1) > 1;
  ctx.fillStyle = fast ? 'rgba(80,60,0,0.85)' : 'rgba(0,40,0,0.7)';
  ctx.fillRect(HUD_SPEED.x, HUD_SPEED.y, HUD_SPEED.w, HUD_SPEED.h);
  ctx.strokeStyle = fast ? C.wrn : C.uib; ctx.strokeRect(HUD_SPEED.x + 0.5, HUD_SPEED.y + 0.5, HUD_SPEED.w - 1, HUD_SPEED.h - 1);
  ctx.fillStyle = fast ? C.wrn : C.acc; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText(fast ? '▶▶2×' : '▶ 1×', HUD_SPEED.x + HUD_SPEED.w / 2, 23);

  // ── Mute toggle
  ctx.fillStyle = muted ? 'rgba(80,0,0,0.7)' : 'rgba(0,40,0,0.7)';
  ctx.fillRect(HUD_MUTE.x, HUD_MUTE.y, HUD_MUTE.w, HUD_MUTE.h);
  ctx.strokeStyle = muted ? C.dng : C.uib; ctx.strokeRect(HUD_MUTE.x + 0.5, HUD_MUTE.y + 0.5, HUD_MUTE.w - 1, HUD_MUTE.h - 1);
  ctx.fillStyle = muted ? C.dng : C.acc; ctx.font = '15px monospace';
  ctx.fillText(muted ? '🔇' : '🔊', HUD_MUTE.x + HUD_MUTE.w / 2, 24);
  ctx.textAlign = 'left';

  dRadar(ctx, gs, now);
  dOffscreenIndicators(ctx, gs, now);

  // Human-wave banner (top-left, under the bar)
  if (gs.isHumanWave) {
    ctx.fillStyle = 'rgba(80,20,20,0.85)'; ctx.fillRect(12, 44, 200, 18);
    ctx.strokeStyle = C.dng; ctx.lineWidth = 1; ctx.strokeRect(12.5, 44.5, 199, 17);
    ctx.fillStyle = C.dng; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('⚠ HOSTILE SURVIVORS ⚠', 112, 57); ctx.textAlign = 'left';
  }

  // Wave condition tag (beside the human-wave banner when both apply).
  const md = gs.waveMod && WAVE_MODS[gs.waveMod];
  if (md) {
    const tx = gs.isHumanWave ? 220 : 12;
    ctx.font = 'bold 10px monospace';
    const tw = ctx.measureText(`${md.icon} ${md.name}`).width + 16;
    ctx.fillStyle = 'rgba(14,14,10,0.85)'; ctx.fillRect(tx, 44, tw, 18);
    ctx.strokeStyle = md.color; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, 44.5, tw - 1, 17);
    ctx.fillStyle = md.color; ctx.fillText(`${md.icon} ${md.name}`, tx + 8, 57);
  }
  // Mini-boss health bar (top centre).
  const boss = gs.boss && gs.boss.state !== 'dead' ? gs.boss : null;
  if (boss) {
    const bw = 300, bx = (CW - bw) / 2, by = 88;
    ctx.fillStyle = 'rgba(20,4,2,0.85)'; ctx.fillRect(bx - 6, by - 16, bw + 12, 30);
    ctx.fillStyle = '#ff5533'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`☠ ${boss.bossName} ☠`, CW / 2, by - 4);
    ctx.textAlign = 'left';
    bar(ctx, bx, by + 1, bw, 7, boss.hp / boss.maxHp, boss.hurtTimer > 0 ? '#ffaa66' : '#cc3322');
  }

  dSiegeEventBanner(ctx, gs, now);

  // Low-wall vignette: red pulse around the edges when the wall is failing.
  if (wp <= 0.3 && gs.baseHp > 0) {
    const a = 0.18 + 0.12 * Math.sin(now / 220);
    const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.35, CW / 2, CH / 2, CW * 0.65);
    vg.addColorStop(0, 'rgba(120,0,0,0)'); vg.addColorStop(1, `rgba(150,0,0,${a})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 38, CW, CH - 38);
  }

  if (gs.waveComplete && gs.waveClearAt) {
    const age = now - gs.waveClearAt, f = 1 - Math.min(1, age / 2800);
    if (f > 0) {
      ctx.save(); ctx.globalAlpha = f;
      ctx.fillStyle = 'rgba(0,20,0,0.94)';
      ctx.fillRect(CW / 2 - 182, CH / 2 - 40, 364, 72);
      ctx.strokeStyle = C.acc; ctx.lineWidth = 2;
      ctx.strokeRect(CW / 2 - 182, CH / 2 - 40, 364, 72);
      ctx.fillStyle = C.acc; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
      ctx.fillText('✦ WAVE CLEARED ✦', CW / 2, CH / 2 + 4);
      ctx.fillStyle = C.txt; ctx.font = '10px monospace';
      ctx.fillText(`+${waveClearAmmoFor(gs.wave)} ammo · returning to command`, CW / 2, CH / 2 + 22);
      ctx.textAlign = 'left'; ctx.restore();
    }
  }
  ctx.restore();

  // Radio chatter subtitle. Renders state.radioMsg as a single line
  // near the bottom of the screen for ~2.2 s with fade-out.
  dRadioSubtitle(ctx, gs, now);
}

// Tactical radar: the whole WORLD_W battlefield squeezed into a strip
// under the HUD. Three rows = three lanes. Shows the camera window,
// the wall, barricades, turrets, squad (green) and hostiles (red /
// orange for tanks). Clicking it pans the camera (see DeadPerimeter.jsx).
function dRadar(ctx, gs, now) {
  const R = HUD_RADAR;
  const sx = x => R.x + (x / WORLD_W) * R.w;
  const rowY = lane => R.y + R.h - 5 - lane * 8;
  ctx.fillStyle = 'rgba(4,10,4,0.82)'; ctx.fillRect(R.x, R.y, R.w, R.h);
  ctx.strokeStyle = 'rgba(114,188,64,0.45)'; ctx.lineWidth = 1;
  ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1);
  // Lane guides
  ctx.strokeStyle = 'rgba(114,188,64,0.10)';
  for (let l = 0; l < 3; l++) { ctx.beginPath(); ctx.moveTo(R.x + 2, rowY(l)); ctx.lineTo(R.x + R.w - 2, rowY(l)); ctx.stroke(); }
  // Wall
  ctx.fillStyle = C.acc; ctx.fillRect(R.x, R.y + 2, sx(WX) - R.x, R.h - 4);
  // Camera window
  const cx = sx(gs.cameraX || 0), cw = (CW / zoomOf(gs) / WORLD_W) * R.w;
  ctx.strokeStyle = 'rgba(220,230,200,0.55)';
  ctx.strokeRect(cx + 0.5, R.y + 1.5, cw - 1, R.h - 3);
  // Barricades / turrets
  ctx.fillStyle = C.wrn;
  (gs.barricades || []).forEach(b => ctx.fillRect(sx(b.x) - 1, R.y + 3, 2, R.h - 6));
  ctx.fillStyle = '#6a9adf';
  (gs.turrets || []).forEach(t => ctx.fillRect(sx(t.x) - 1.5, rowY(0) - 1.5, 3, 3));
  // Squad
  gs.soldiers.forEach(s => {
    if (s.state === 'dead' || s.onExpedition || s.onRoof) return;
    ctx.fillStyle = s.id === gs.selectedSoldierId ? '#ffffff' : '#7cf060';
    ctx.fillRect(sx(s.x) - 1.5, rowY(s.lane || 0) - 1.5, 3, 3);
  });
  // Hostiles
  const pool = gs.isHumanWave ? gs.humans : gs.zombies;
  const blink = 0.6 + 0.4 * Math.sin(now / 160);
  (pool || []).forEach(e => {
    if (e.state === 'dead') return;
    const big = e.type === 'tank' || e.type === 'gunman';
    ctx.fillStyle = big ? `rgba(255,150,40,${blink})` : `rgba(230,60,50,${blink})`;
    const r = big ? 2.2 : 1.5;
    ctx.fillRect(Math.min(R.x + R.w - 3, sx(e.x)) - r, rowY(e.lane || 0) - r, r * 2, r * 2);
  });
  ctx.fillStyle = 'rgba(184,204,170,0.5)'; ctx.font = '7px monospace';
  ctx.fillText('RADAR', R.x + 3, R.y + 8);
}

// Edge arrows counting hostiles outside the camera window, so the
// player knows something is coming before it walks into view.
function dOffscreenIndicators(ctx, gs, now) {
  const pool = gs.isHumanWave ? gs.humans : gs.zombies;
  const cam = gs.cameraX || 0;
  let right = 0, nearest = Infinity;
  (pool || []).forEach(e => {
    if (e.state === 'dead') return;
    const edge = cam + CW / zoomOf(gs);
    if (e.x > edge) { right++; nearest = Math.min(nearest, e.x - edge); }
  });
  right += gs.spawnQueue ? gs.spawnQueue.filter(q => q.at <= gs.waveTime + 4000).length : 0;
  if (right <= 0) return;
  // Sits under the radar, clear of the lanes, so it never hides a
  // hostile that is already on screen at the right edge.
  const y = HUD_RADAR.y + HUD_RADAR.h + 20;
  const pulse = 0.65 + 0.35 * Math.sin(now / 200);
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = 'rgba(60,8,8,0.85)';
  ctx.beginPath();
  ctx.moveTo(CW - 6, y); ctx.lineTo(CW - 22, y - 16); ctx.lineTo(CW - 70, y - 16);
  ctx.lineTo(CW - 70, y + 16); ctx.lineTo(CW - 22, y + 16); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.dng; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#ffb0a0'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`${right} ▶`, CW - 40, y + 1);
  if (nearest < Infinity) {
    ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(255,190,170,0.85)';
    ctx.fillText(`${Math.round(nearest)}m`, CW - 42, y + 12);
  }
  ctx.restore();
}

// Single subtitle line, rendered for any state that carries a
// radioMsg = { text, at, dur, category? }. Used by siege + mission.
export function dRadioSubtitle(ctx, state, now) {
  const rm = state && state.radioMsg;
  if (!rm) return;
  // pushRadio stamps radioMsg.at with performance.now(); read the same
  // clock here so the subtitle survives the siege's fast-forward clock.
  const age = (typeof performance !== 'undefined' ? performance.now() : now) - rm.at;
  if (age < 0 || age >= rm.dur) return;
  const a = age < 120 ? age / 120 : 1 - Math.max(0, (age - (rm.dur - 360)) / 360);
  const alpha = Math.max(0, Math.min(1, a));
  if (alpha <= 0) return;
  const text = '📻 ' + rm.text;
  ctx.save();
  ctx.font = 'bold 12px monospace';
  const w = Math.min(420, ctx.measureText(text).width + 24);
  const x = (CW - w) / 2, y = CH - 60;
  ctx.fillStyle = `rgba(8,12,8,${0.78 * alpha})`;
  ctx.fillRect(x, y, w, 22);
  ctx.strokeStyle = `rgba(120,180,100,${0.55 * alpha})`; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, 22);
  ctx.textAlign = 'center';
  // Category-based tint for quick read at a glance
  const tint = rm.category === 'hurt' || rm.category === 'lowAmmo' || rm.category === 'baseHit' ? '#ffaa66'
             : rm.category === 'retreat' ? '#ffd66a'
             : rm.category === 'defeat' ? '#ff8888'
             : '#cce6cc';
  ctx.fillStyle = `rgba(${parseInt(tint.slice(1,3),16)},${parseInt(tint.slice(3,5),16)},${parseInt(tint.slice(5,7),16)},${alpha})`;
  ctx.fillText(text, CW / 2, y + 15);
  ctx.textAlign = 'left'; ctx.restore();
}
