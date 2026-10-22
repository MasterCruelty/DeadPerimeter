// Sortie objectives panel (top right, under the HUD bar; the squad
// roster sits top left, boss bar and defend timer in the middle) and the
// toast shown when an objective completes or fails.
import { C } from '../constants.js';
import { MISSION_CONDS } from '../data/missionExtras.js';
import { missionObjectives } from '../update/objectives.js';
import { t } from '../i18n/index.js';

const RIGHT = 892, TOP = 45, ROW = 12, MAX_W = 286;
const TOAST_MS = 2600;

function fit(ctx, s, w) {
  if (ctx.measureText(s).width <= w) return s;
  while (s.length > 4 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
  return s + '…';
}

export function dObjectives(ctx, m, now) {
  const objs = missionObjectives(m, now);
  const cd = m.cond && MISSION_CONDS[m.cond];
  ctx.save();
  ctx.textAlign = 'left';
  if (objs.length || cd) {
    ctx.font = 'bold 9px monospace';
    const rows = objs.map(o => ({
      o, text: `${o.state === 'done' ? '✔' : o.state === 'failed' ? '✖' : o.side ? '◇' : '▸'} ${o.text}`,
      count: o.state === 'active' && o.count ? o.count : '',
    }));
    const head = t('OBJECTIVES'), tag = cd ? `${cd.icon} ${t(cd.name)}` : '';
    let w = ctx.measureText(head).width + (tag ? ctx.measureText(tag).width + 18 : 0) + 16;
    rows.forEach(r => { w = Math.max(w, ctx.measureText(r.text).width + (r.count ? ctx.measureText(r.count).width + 10 : 0) + 16); });
    w = Math.min(MAX_W, Math.max(150, Math.ceil(w)));
    const x = RIGHT - w, h = 15 + rows.length * ROW + 3;
    ctx.fillStyle = 'rgba(6,10,6,0.8)'; ctx.fillRect(x, TOP, w, h);
    ctx.strokeStyle = C.uib; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, TOP + 0.5, w - 1, h - 1);
    ctx.font = '8px monospace'; ctx.fillStyle = 'rgba(184,204,170,0.6)';
    ctx.fillText(head, x + 7, TOP + 11);
    if (tag) {
      ctx.font = 'bold 8px monospace'; ctx.fillStyle = cd.color; ctx.textAlign = 'right';
      ctx.fillText(fit(ctx, tag, w - ctx.measureText(head).width - 22), RIGHT - 7, TOP + 11);
      ctx.textAlign = 'left';
    }
    rows.forEach((r, i) => {
      const y = TOP + 15 + i * ROW + 8;
      const st = r.o.state;
      const col = st === 'done' ? C.acc : st === 'failed' ? C.dng : r.o.side || r.o.job ? '#ffd54a' : C.txt;
      ctx.font = 'bold 9px monospace';
      const cw = r.count ? ctx.measureText(r.count).width + 10 : 0;
      ctx.globalAlpha = st === 'done' ? 0.8 : 1;
      ctx.fillStyle = col;
      ctx.fillText(fit(ctx, r.text, w - 14 - cw), x + 7, y);
      if (r.count) {
        ctx.textAlign = 'right'; ctx.fillStyle = r.o.side ? '#ffd54a' : C.wrn;
        ctx.fillText(r.count, RIGHT - 7, y);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    });
  }

  const ts = m.objToast;
  const age = ts ? now - ts.at : Infinity;
  if (m.state === 'active' && age >= 0 && age < TOAST_MS) {
    ctx.globalAlpha = Math.min(1, age / 150, (TOAST_MS - age) / 400);
    ctx.font = 'bold 12px monospace';
    const tw = ctx.measureText(ts.title).width;
    ctx.font = '10px monospace';
    const bw = Math.min(440, Math.max(tw, ctx.measureText(ts.text).width) + 36), bx = 450 - bw / 2, by = 80;
    const col = ts.ok ? '#ffd54a' : C.dng;
    ctx.fillStyle = 'rgba(8,12,6,0.88)'; ctx.fillRect(bx, by, bw, 36);
    ctx.strokeStyle = col; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 35);
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px monospace'; ctx.fillStyle = col;
    ctx.fillText(ts.title, 450, by + 15);
    ctx.font = '10px monospace'; ctx.fillStyle = C.txt;
    ctx.fillText(fit(ctx, ts.text, bw - 20), 450, by + 29);
  }
  ctx.restore();
}
