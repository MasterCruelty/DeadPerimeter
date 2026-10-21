import { C, GY, laneY, laneSc } from '../constants.js';
import { dContactShadow } from './background.js';
import { drawSoldierBody } from './actors/people.js';
import { wpt } from './weapons.js';
import { wbase } from '../data/weapons.js';
import { t } from '../i18n/index.js';

// Rooftop sniper: kneeling behind sandbags on the parapet. Uses the
// shared actor rig; sandbags are drawn in front of the legs.
export function dRooftopSniper(ctx, s, now) {
  ctx.save();
  ctx.translate(s.x, GY - 154);
  const R = drawSoldierBody(ctx, { ...s, state: s.state === 'reload' ? 'reload' : (now - (s.shootAt || 0) < 200 ? 'shoot' : 'idle'), kneel: true, weapon: 'sniper', facing: 1 }, now);
  const bag = (x, y, rx, ry, rot, col) => {
    ctx.fillStyle = 'rgba(8,8,6,0.9)'; ctx.beginPath(); ctx.ellipse(x, y, rx + 1, ry + 1, rot, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, '#8a7448'); g.addColorStop(0.5, col); g.addColorStop(1, '#2e2414');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
  };
  bag(-12, 2, 12, 5, 0, '#5a4830'); bag(9, 2, 13, 5, 0.1, '#54442c'); bag(-2, -5, 12, 5, -0.1, '#625034');
  if (R && now - (s.shootAt || 0) < 90) {
    const fa = 1 - (now - s.shootAt) / 90;
    const [mx0, my] = wpt('sniper', 'muzzle'); const mx = mx0 - R.rcl;
    ctx.save(); ctx.translate(R.anchor[0], R.anchor[1]); ctx.rotate(R.tilt); ctx.globalAlpha = fa;
    const fl = ctx.createRadialGradient(mx, my, 0, mx, my, 16);
    fl.addColorStop(0, 'rgba(255,230,80,1)'); fl.addColorStop(0.4, 'rgba(255,100,0,0.7)'); fl.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function dSoldier(ctx, s, now, isSelected) {
  // Rooftop variant
  if (s.onRoof && s.state !== 'dead') {
    dRooftopSniper(ctx, s, now);
    if (s.hp < s.maxHp) {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(s.x - 18, GY - 188, 36, 4);
      ctx.fillStyle = s.hp > 60 ? '#44bb44' : s.hp > 30 ? C.wrn : C.dng;
      ctx.fillRect(s.x - 18, GY - 188, 36 * (s.hp / s.maxHp), 4);
    }
    if (s.state === 'reload') {
      ctx.fillStyle = C.wrn; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('RELOAD'), s.x, GY - 194); ctx.textAlign = 'left';
    }
    if (s.ammo <= 1 && s.state !== 'reload') {
      ctx.fillStyle = 'rgba(200,40,20,0.95)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText(s.ammo === 0 ? t('DRY') : t('LOW'), s.x, GY - 194); ctx.textAlign = 'left';
    }
    if (isSelected) {
      const ring = 0.7 + 0.3 * Math.sin(now / 180);
      ctx.strokeStyle = `rgba(114,188,64,${ring})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(s.x, GY - 152, 22, 6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    return;
  }

  const ly = laneY(s.lane);
  const sc = laneSc(s.lane);
  dContactShadow(ctx, s.x, ly + 1, sc, s.state === 'dead' ? 26 : 15);
  ctx.save();
  ctx.translate(s.x, ly);
  ctx.scale(sc * s.facing, sc);
  const R = drawSoldierBody(ctx, s, now);
  // World-space muzzle position, returned so cinematics can anchor
  // their own (bigger) flashes on the actual barrel tip.
  let muzzle = null;
  if (R) {
    const [m0, m1] = wpt(s.weapon, 'muzzle'), c = Math.cos(R.tilt), sn = Math.sin(R.tilt);
    const lx = R.anchor[0] + (m0 - R.rcl) * c - m1 * sn, lyy = R.anchor[1] + (m0 - R.rcl) * sn + m1 * c;
    muzzle = [s.x + lx * sc * s.facing, ly + lyy * sc];
  }
  if (R && s.state === 'shoot' && now - s.shootAt < 90) {
    // Muzzle flash at the (scaled) end of the barrel, in weapon space.
    const fa = 1 - (now - s.shootAt) / 90;
    const [mx0, my] = wpt(s.weapon, 'muzzle');
    const mx = mx0 - R.rcl;
    const fr = wbase(s.weapon) === 'pistol' ? 10 : 15;
    ctx.save(); ctx.translate(R.anchor[0], R.anchor[1]); ctx.rotate(R.tilt); ctx.globalAlpha = fa;
    // Forward-biased cone of flame rather than a round blob.
    const fl = ctx.createRadialGradient(mx, my, 0, mx, my, fr);
    fl.addColorStop(0, 'rgba(255,230,80,1)'); fl.addColorStop(0.4, 'rgba(255,100,0,0.7)'); fl.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = fl; ctx.beginPath(); ctx.ellipse(mx + fr * 0.35, my, fr, fr * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff6d0';
    ctx.beginPath(); ctx.moveTo(mx, my - 2); ctx.lineTo(mx + fr * 1.1, my); ctx.lineTo(mx, my + 2); ctx.fill();
    for (let sp = 0; sp < 4; sp++) {
      const ang = (sp - 1.5) * 0.5 + (fa - 0.5) * 0.3;
      ctx.fillStyle = C.muz;
      ctx.fillRect(mx + Math.cos(ang) * fr * 0.8, my + Math.sin(ang) * fr * 0.8, 1.5, 1.5);
    }
    ctx.restore();
  }
  ctx.restore();
  if (s.state !== 'dead' && !s.npc) {
    const isRl = s.state === 'reload';
    const isKnife = s.state === 'knife' || s.knifeReady;
    if (s.ammo <= 3 && s.ammo > 0 && !isRl) {
      ctx.fillStyle = 'rgba(200,160,20,0.9)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('LOW'), s.x, ly - Math.round(76 * sc)); ctx.textAlign = 'left';
    }
    if (s.ammo === 0 && !isRl) {
      ctx.fillStyle = 'rgba(200,40,20,0.95)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText(isKnife ? '🔪' : t('DRY'), s.x, ly - Math.round(76 * sc)); ctx.textAlign = 'left';
    }
  }
  if (s.state === 'dead') return null;

  const isRl = s.state === 'reload';
  if (s.hp < s.maxHp) {
    const bary = ly - Math.round(70 * sc);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(s.x - 18, bary, 36, 4);
    ctx.fillStyle = s.hp > 60 ? '#44bb44' : s.hp > 30 ? C.wrn : C.dng;
    ctx.fillRect(s.x - 18, bary, 36 * (s.hp / s.maxHp), 4);
  }
  if (isRl) {
    ctx.fillStyle = C.wrn; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(t('RELOAD'), s.x, ly - Math.round(80 * sc)); ctx.textAlign = 'left';
  }
  if (isSelected) {
    const ring = 0.7 + 0.3 * Math.sin(now / 180);
    ctx.strokeStyle = `rgba(114,188,64,${ring})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(s.x, ly + 2, 18, 5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(114,188,64,${ring})`;
    const arrY = ly - Math.round(86 * sc);
    ctx.beginPath(); ctx.moveTo(s.x, arrY); ctx.lineTo(s.x - 5, arrY - 7); ctx.lineTo(s.x + 5, arrY - 7); ctx.closePath(); ctx.fill();
  }
  return muzzle;
}
