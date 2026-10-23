import { C, CW, CH, WX, WORLD_W, laneY, laneSc, zoomOf } from '../constants.js';
import { BALANCE, waveClearAmmoFor } from '../data/difficulty.js';
import { WAVE_MODS } from '../data/waveMods.js';
import { dSiegeEventBanner } from './siegeEvents.js';
import { GRADE_COL, fmtTime } from '../expedition/report.js';
import { t } from '../i18n/index.js';
import { speakerInfo, radioLog } from '../audio/radio.js';
import { dPortrait } from './portrait.js';

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
  ctx.fillText(t('DAY {d} · WAVE {w}/{max}', { d: gs.day, w: gs.wave, max: BALANCE.maxWaves }), 12, 17);
  const total = Math.max(1, gs.waveTotal || 1);
  const left = waveRemaining(gs);
  bar(ctx, 12, 24, 170, 6, 1 - left / total, gs.isHumanWave ? '#cc5544' : '#8a9a5a');
  ctx.fillStyle = C.txt; ctx.font = '8px monospace';
  ctx.fillText(gs.waveComplete ? t('CLEARED') : (left === 1 ? t('{n} HOSTILE LEFT', { n: left }) : t('{n} HOSTILES LEFT', { n: left })), 186, 31);

  // ── Wall integrity
  const wp = gs.baseHp / (gs.baseMaxHp || 1);
  const wcol = wp > 0.6 ? C.acc : wp > 0.3 ? C.wrn : C.dng;
  ctx.fillStyle = C.txt; ctx.font = '8px monospace';
  ctx.fillText(t('WALL'), 296, 14);
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
  // Squeezed into the 160 px before the speed button (translations vary).
  const fit = (str, y) => { ctx.save(); const w = ctx.measureText(str).width; if (w > 160) { ctx.translate(640, y); ctx.scale(160 / w, 1); ctx.fillText(str, 0, 0); } else ctx.fillText(str, 640, y); ctx.restore(); };
  fit(sel ? t('▸ {name} SELECTED', { name: sel.toUpperCase() }) : t('CLICK LANE → MOVE SQUAD'), 16);
  fit(t('1-9 SELECT · ←/→ PAN · F SPEED'), 29);

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
    ctx.fillText(t('⚠ HOSTILE SURVIVORS ⚠'), 112, 57); ctx.textAlign = 'left';
  }

  // Wave condition tag (beside the human-wave banner when both apply).
  const md = gs.waveMod && WAVE_MODS[gs.waveMod];
  if (md) {
    const tx = gs.isHumanWave ? 220 : 12;
    ctx.font = 'bold 10px monospace';
    const tw = ctx.measureText(`${md.icon} ${t(md.name)}`).width + 16;
    ctx.fillStyle = 'rgba(14,14,10,0.85)'; ctx.fillRect(tx, 44, tw, 18);
    ctx.strokeStyle = md.color; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, 44.5, tw - 1, 17);
    ctx.fillStyle = md.color; ctx.fillText(`${md.icon} ${t(md.name)}`, tx + 8, 57);
  }
  // Mini-boss health bar (top centre).
  const boss = gs.boss && gs.boss.state !== 'dead' ? gs.boss : null;
  if (boss) {
    const bw = 300, bx = (CW - bw) / 2, by = 88;
    ctx.fillStyle = 'rgba(20,4,2,0.85)'; ctx.fillRect(bx - 6, by - 16, bw + 12, 30);
    ctx.fillStyle = '#ff5533'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`☠ ${t(boss.bossName)} ☠`, CW / 2, by - 4);
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
      const rep = gs.lastWaveReport && gs.lastWaveReport.wave === gs.wave ? gs.lastWaveReport : null;
      const bh = rep ? 90 : 72;
      ctx.fillStyle = 'rgba(0,20,0,0.94)';
      ctx.fillRect(CW / 2 - 182, CH / 2 - 40, 364, bh);
      ctx.strokeStyle = C.acc; ctx.lineWidth = 2;
      ctx.strokeRect(CW / 2 - 182, CH / 2 - 40, 364, bh);
      ctx.fillStyle = C.acc; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('✦ WAVE CLEARED ✦'), CW / 2, CH / 2 + 4);
      ctx.fillStyle = C.txt; ctx.font = '10px monospace';
      ctx.fillText(t('+{n} ammo · returning to command', { n: waveClearAmmoFor(gs.wave) }), CW / 2, CH / 2 + 22);
      if (rep) {
        ctx.fillStyle = GRADE_COL[rep.grade]; ctx.font = 'bold 11px monospace';
        ctx.fillText(t('GRADE {g} · wall −{w} · {l} lost · {k} kills · {time}', { g: rep.grade, w: rep.wallDmg, l: rep.lost, k: rep.kills, time: fmtTime(rep.time) }), CW / 2, CH / 2 + 40);
      }
      ctx.textAlign = 'left'; ctx.restore();
    }
  }
  ctx.restore();

  // Radio panel: the last line on the net, with the speaker's portrait.
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
  const edge = cam + CW / zoomOf(gs);
  let right = 0, nearest = Infinity, left = 0;
  (pool || []).forEach(e => {
    if (e.state === 'dead') return;
    if (e.x > edge) { right++; nearest = Math.min(nearest, e.x - edge); }
    else if (e.x < cam) left++;               // panned / zoomed past them: they're at the wall
  });
  right += gs.spawnQueue ? gs.spawnQueue.filter(q => q.at <= gs.waveTime + 4000).length : 0;
  if (left > 0) {
    const y = HUD_RADAR.y + HUD_RADAR.h + 20;
    ctx.save();
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 200);
    ctx.fillStyle = 'rgba(60,8,8,0.85)';
    ctx.beginPath();
    ctx.moveTo(6, y); ctx.lineTo(22, y - 16); ctx.lineTo(70, y - 16); ctx.lineTo(70, y + 16); ctx.lineTo(22, y + 16); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.dng; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffb0a0'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`◀ ${left}`, 40, y + 4);
    ctx.restore();
  }
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

// Radio panel, rendered for any state that carries a radioMsg (see
// pushRadio). Used by siege, sorties, evac and the defeat cinematic:
// the speaker's portrait on the left, their name above, the line typed
// out at about the pace of the voice.
const RADIO_CPS = 15;
const PANEL = { w: 470, h: 60 };

function speakerOf(m) {
  const sp = speakerInfo(m);
  return { name: sp.name, col: sp.color };
}
const lineOf = m => (m.line ? t(m.line, m.params) : m.text);

function wrapText(ctx, text, maxW) {
  const out = []; let cur = '';
  text.split(' ').forEach(w => {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(tryLine).width > maxW && cur) { out.push(cur); cur = w; } else cur = tryLine;
  });
  if (cur) out.push(cur);
  return out;
}

const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

export function dRadioSubtitle(ctx, state) {
  const rm = state && state.radioMsg;
  if (!rm) return;
  // pushRadio stamps radioMsg.at with performance.now(); read the same
  // clock here so the panel survives the siege's fast-forward clock.
  const age = performance.now() - rm.at;
  const text = lineOf(rm);
  const typeMs = text.length / RADIO_CPS * 1000;
  const hold = Math.max(rm.dur, typeMs + 1600);
  if (age < 0 || age >= hold) return;
  const alpha = Math.max(0, Math.min(1, age < 120 ? age / 120 : 1 - Math.max(0, (age - (hold - 360)) / 360)));
  if (alpha <= 0) return;
  const sp = speakerOf(rm);
  const { w } = PANEL;
  ctx.save();
  ctx.font = 'bold 12px monospace';
  const lines = wrapText(ctx, text, w - 82).slice(0, 3);
  const h = Math.max(PANEL.h, 30 + lines.length * 15);
  const x = (CW - w) / 2, y = CH - 40 - h;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(6,10,6,0.86)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,180,100,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = rgba(sp.col, 0.8); ctx.fillRect(x, y, 3, h);
  dPortrait(ctx, rm.who, x + 8, y + (h - 52) / 2, 52, age, 1);
  ctx.strokeStyle = 'rgba(120,180,100,0.4)'; ctx.strokeRect(x + 7.5, y + (h - 52) / 2 - 0.5, 53, 53);
  // Name + transmit light
  const typing = age < typeMs;
  ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
  ctx.fillStyle = sp.col;
  ctx.fillText(`◉ ${sp.name.toUpperCase()}`, x + 70, y + 14);
  ctx.textAlign = 'right'; ctx.font = '8px monospace';
  ctx.fillStyle = typing && Math.floor(age / 300) % 2 === 0 ? '#ff6a4a' : 'rgba(184,204,170,0.45)';
  ctx.fillText(typing ? t('● TX') : t('○ RX'), x + w - 8, y + 13);
  // Typewriter text, tinted by what kind of call it is.
  const tint = rm.category === 'hurt' || rm.category === 'lowAmmo' || rm.category === 'baseHit' ? '#ffaa66'
             : rm.category === 'retreat' ? '#ffd66a'
             : rm.category === 'defeat' ? '#ff8888'
             : '#d8ecd0';
  ctx.textAlign = 'left'; ctx.font = 'bold 12px monospace'; ctx.fillStyle = tint;
  let left = Math.floor(age / 1000 * RADIO_CPS);
  lines.forEach((ln, i) => {
    if (left <= 0) return;
    const shown = ln.slice(0, left);
    ctx.fillText(shown, x + 70, y + 31 + i * 15);
    if (typing && left <= ln.length) {
      const cw = ctx.measureText(shown).width;
      ctx.fillRect(x + 71 + cw, y + 22 + i * 15, 6, 11);
    }
    left -= ln.length + 1;
  });
  ctx.restore();
}

// Radio log box (pause screens): the last `rows` logged lines, newest
// first, each with a small portrait.
export function dRadioLog(ctx, x, y, w, rows = 5) {
  const log = radioLog().slice(0, rows);
  const h = 22 + Math.max(1, log.length) * 20;
  ctx.save();
  ctx.fillStyle = 'rgba(6,12,6,0.94)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(114,188,64,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = C.acc; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
  ctx.fillText(t('📻 RADIO LOG'), x + 8, y + 14);
  if (!log.length) {
    ctx.fillStyle = 'rgba(184,204,170,0.5)'; ctx.font = '10px monospace';
    ctx.fillText(t('No traffic yet.'), x + 8, y + 32);
  }
  log.forEach((e, i) => {
    const ry = y + 20 + i * 20, sp = speakerOf(e);
    dPortrait(ctx, e.who, x + 8, ry, 17, Infinity, 0.95);
    ctx.font = 'bold 9px monospace'; ctx.fillStyle = sp.col;
    const nm = `${sp.name}:`;
    ctx.fillText(nm, x + 31, ry + 12);
    const nw = ctx.measureText(nm).width + 6;
    ctx.font = '9px monospace'; ctx.fillStyle = 'rgba(214,230,204,0.9)';
    let txt = lineOf(e);
    while (txt.length > 4 && ctx.measureText(txt).width > w - 40 - nw) txt = txt.slice(0, -2);
    if (txt !== lineOf(e)) txt = txt.slice(0, -1) + '…';
    ctx.fillText(txt, x + 31 + nw, ry + 12);
  });
  ctx.restore();
}
