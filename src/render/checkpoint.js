import { C, CW } from '../constants.js';
import { t } from '../i18n/index.js';

// "CHECKPOINT" banner over the mission HUD when a finale act starts or
// restarts (m._checkpointBanner = { act, retry }). Timed on the mission's
// own clock, so the slow first frames of a fresh act or a pause can't
// run it out before it is seen.
const DUR = 2800;

export function dCheckpointBanner(ctx, m) {
  const cb = m._checkpointBanner;
  if (!cb) return;
  if (cb.at === undefined) cb.at = m.simNow;
  const age = m.simNow - cb.at;
  if (age >= DUR) { m._checkpointBanner = null; return; }
  const alpha = Math.max(0, Math.min(1, age / 150, (DUR - age) / 500));
  const title = t('CHECKPOINT');
  const sub = t(cb.act).toUpperCase() + (cb.retry > 0 ? ' · ' + t('retry {n}', { n: cb.retry }) : '');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '10px monospace';
  const w = Math.max(200, ctx.measureText(sub).width + 36);
  const x = (CW - w) / 2, y = 64;
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x, y, w, 40);
  ctx.strokeStyle = '#ffcc44'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 39);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffcc44'; ctx.font = 'bold 13px monospace';
  ctx.fillText(title.split('').join(' '), CW / 2, y + 17);
  ctx.fillStyle = C.txt; ctx.font = '10px monospace';
  ctx.fillText(sub, CW / 2, y + 32);
  ctx.restore();
}
