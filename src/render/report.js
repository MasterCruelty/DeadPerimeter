// Grade box for the end-of-sortie overlay: the letter on the left, the
// report rows in two columns beside it.
import { C } from '../constants.js';
import { GRADE_COL, reportRows } from '../expedition/report.js';
import { t } from '../i18n/index.js';

export function dReportGrade(ctx, rep, cx, y, alpha = 1) {
  const rows = reportRows(rep);
  const half = Math.ceil(rows.length / 2);
  const w = 500, h = 18 + half * 13, x = cx - w / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(6,12,6,0.9)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const col = GRADE_COL[rep.grade] || C.txt;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(184,204,170,0.6)'; ctx.font = '8px monospace';
  ctx.fillText(t('GRADE'), x + 36, y + 14);
  ctx.fillStyle = col; ctx.font = 'bold 40px monospace';
  ctx.fillText(rep.grade, x + 36, y + h / 2 + 22);
  ctx.strokeStyle = C.uib; ctx.beginPath(); ctx.moveTo(x + 72.5, y + 6); ctx.lineTo(x + 72.5, y + h - 6); ctx.stroke();
  rows.forEach(([label, value], i) => {
    const colX = x + 84 + (i < half ? 0 : 210), ry = y + 16 + (i % half) * 13;
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(184,204,170,0.7)'; ctx.font = '9px monospace';
    ctx.fillText(label, colX, ry);
    ctx.textAlign = 'right'; ctx.fillStyle = C.txt; ctx.font = 'bold 10px monospace';
    ctx.fillText(String(value), colX + 196, ry);
  });
  ctx.restore();
}
