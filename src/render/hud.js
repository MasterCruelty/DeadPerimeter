import { C, CW, CH, laneY, laneSc } from '../constants.js';
import { BALANCE } from '../data/difficulty.js';

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

export function dHUD(ctx, gs, now, muted) {
  ctx.fillStyle = 'rgba(0,0,0,0.74)'; ctx.fillRect(0, 0, CW, 38);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1; ctx.strokeRect(0, 0, CW, 38);
  ctx.fillStyle = C.acc; ctx.font = 'bold 13px monospace';
  // Wave-of-MAX so the player sees how close they are to the final
  // extraction (wave 30).
  ctx.fillText(`DAY ${gs.day}  WAVE ${gs.wave}/${BALANCE.maxWaves}`, 14, 24);
  ctx.fillStyle = C.txt; ctx.font = '12px monospace';
  ctx.fillText(`☠ ${gs.kills}`, 200, 24); ctx.fillText(`⭐ ${gs.score}`, 290, 24);
  ctx.fillStyle = C.txt; ctx.font = '9px monospace';
  ctx.fillText(`🔫 ${gs.resources.ammo}`, 378, 16);
  ctx.fillText('CLICK LANE→MOVE', 378, 28);

  // Human-wave banner (top-centre)
  if (gs.isHumanWave) {
    ctx.fillStyle = 'rgba(80,20,20,0.85)'; ctx.fillRect(CW / 2 - 110, 40, 220, 18);
    ctx.strokeStyle = C.dng; ctx.lineWidth = 1; ctx.strokeRect(CW / 2 - 110, 40, 220, 18);
    ctx.fillStyle = C.dng; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('⚠ HOSTILE SURVIVORS ⚠', CW / 2, 53); ctx.textAlign = 'left';
  }

  // Mute toggle
  ctx.fillStyle = muted ? 'rgba(80,0,0,0.7)' : 'rgba(0,40,0,0.7)';
  ctx.fillRect(852, 5, 38, 27);
  ctx.strokeStyle = muted ? C.dng : C.uib; ctx.strokeRect(852, 5, 38, 27);
  ctx.fillStyle = muted ? C.dng : C.acc; ctx.font = '15px monospace';
  ctx.fillText(muted ? '🔇' : '🔊', 858, 24);

  // Soldier cards
  gs.soldiers.filter(s => !s.onExpedition).forEach((s, i) => {
    if (s.state === 'dead') return;
    const bx = CW - 385 + i * 128;
    ctx.fillStyle = C.uib; ctx.fillRect(bx, 6, 122, 26);
    ctx.fillStyle = s.ammo === 0 ? C.dng : s.state === 'reload' ? C.wrn : C.acc;
    ctx.font = '9px monospace';
    const lanelbl = ['F', 'M', 'B'][s.lane || 0];
    ctx.fillText(`${s.name}[${lanelbl}] ${s.weapon[0].toUpperCase()} ${s.ammo}/${s.maxAmmo}`, bx + 4, 22);
  });

  if (gs.waveComplete && gs.waveClearAt) {
    const age = now - gs.waveClearAt, f = 1 - Math.min(1, age / 2800);
    if (f > 0) {
      ctx.save(); ctx.globalAlpha = f;
      ctx.fillStyle = 'rgba(0,20,0,0.94)';
      ctx.fillRect(CW / 2 - 182, CH / 2 - 40, 364, 72);
      ctx.strokeStyle = C.acc; ctx.lineWidth = 2;
      ctx.strokeRect(CW / 2 - 182, CH / 2 - 40, 364, 72);
      ctx.fillStyle = C.acc; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
      ctx.fillText('✦ WAVE CLEARED ✦', CW / 2, CH / 2 + 12);
      ctx.textAlign = 'left'; ctx.restore();
    }
  }

  // Radio chatter subtitle. Renders state.radioMsg as a single line
  // near the bottom of the screen for ~2.2 s with fade-out.
  dRadioSubtitle(ctx, gs, now);
}

// Single subtitle line, rendered for any state that carries a
// radioMsg = { text, at, dur, category? }. Used by siege + mission.
export function dRadioSubtitle(ctx, state, now) {
  const rm = state && state.radioMsg;
  if (!rm) return;
  const age = now - rm.at;
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
