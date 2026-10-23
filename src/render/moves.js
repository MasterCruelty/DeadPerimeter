// Sortie moveset visuals: grenades in flight (world space) and the
// small loadout panel + key hint (screen space). The blast itself is
// an effect ('blast' in render/effects.js); the roll is drawn by the
// soldier rig (render/actors/people.js).
import { C, CW, CH } from '../constants.js';
import { WPN, MELEE, meleeOf } from '../data/weapons.js';
import { maxStam } from '../entities/gear.js';
import { nadesOf, NADE_MAX, NADE_FUSE, ROLL_COST, ROLL_MS, ROLL_CD } from '../update/moves.js';
import { t } from '../i18n/index.js';

export function dNades(ctx, m, now) {
  (m.nades || []).forEach(g => {
    ctx.save(); ctx.translate(g.x, g.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 5, 5, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(g.spin);
    ctx.fillStyle = '#10140c';
    ctx.beginPath(); ctx.ellipse(0, 0, 5.4, 6.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a5c32';
    ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 5.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6e8448'; ctx.fillRect(-2.6, -3.4, 1.8, 2.2);
    ctx.fillStyle = '#9a9a90'; ctx.fillRect(-1.8, -8.4, 3.6, 2.6);
    ctx.fillRect(1.4, -8, 1.2, 6);
    ctx.restore();
    // Fuse blink, faster as it runs down.
    const left = NADE_FUSE - (now - g.at);
    if (Math.floor(now / (left < 500 ? 70 : 160)) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,60,40,0.95)';
      ctx.beginPath(); ctx.arc(g.x, g.y - 1, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  });
}

export function dMovesHUD(ctx, m, now) {
  if (m.state !== 'active') return;
  const s = m.soldier;
  if (!s || s.hp <= 0) return;
  // Bottom-right corner, under the street's depth band.
  const w = 196, h = 50, x = CW - w - 8, y = CH - h - 3;
  ctx.fillStyle = 'rgba(4,10,4,0.72)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(114,188,64,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textAlign = 'left';
  const key = (k, kx, ky) => {
    ctx.fillStyle = 'rgba(184,204,170,0.55)'; ctx.font = '8px monospace';
    ctx.fillText(k, kx, ky);
  };

  // Grenades: pips up to the carry limit.
  const n = nadesOf(m);
  key('[G]', x + 6, y + 14);
  ctx.font = '11px monospace'; ctx.fillStyle = n > 0 ? '#fff' : 'rgba(255,255,255,0.35)';
  ctx.fillText('💣', x + 26, y + 15);
  for (let i = 0; i < NADE_MAX; i++) {
    ctx.fillStyle = i < n ? '#ffd54a' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 44 + i * 8, y + 7, 5, 8);
  }

  // Roll: ready / cooling down / not enough stamina.
  key('[⇧]', x + 94, y + 14);
  const cd = s.rollCd || 0;
  const tired = (s.stam ?? maxStam(s)) < ROLL_COST;
  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = cd > 0 ? 'rgba(184,204,170,0.5)' : tired ? '#ffaa33' : C.acc;
  ctx.fillText(t('ROLL'), x + 116, y + 14);
  const bx = x + 120 + ctx.measureText(t('ROLL')).width, bw = x + w - 8 - bx;
  ctx.fillStyle = '#141612'; ctx.fillRect(bx, y + 8, bw, 5);
  ctx.fillStyle = cd > 0 ? 'rgba(120,150,110,0.7)' : tired ? '#ffaa33' : C.acc;
  ctx.fillRect(bx, y + 8, bw * (1 - Math.min(1, cd / (ROLL_MS + ROLL_CD))), 5);

  // Weapon in hand + swap / reload / melee keys.
  key('[Q]', x + 6, y + 31);
  const slung = s.knifeReady;
  const dry = s.ammo <= 0 && (s.magsLeft || 0) <= 0 && (s._loose || 0) <= 0;
  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = slung ? '#ffcc66' : C.txt;
  const mel = MELEE[meleeOf(s)];
  let label = slung ? `${mel.icon} ${t(mel.name).toUpperCase()}` : `🔫 ${(WPN[s.weapon] || WPN.rifle).name}`;
  while (ctx.measureText(label).width > 150 && label.length > 4) label = label.slice(0, -2) + '…';
  ctx.fillText(label, x + 26, y + 31);
  key(t('[F] MELEE'), x + 6, y + 44);
  const rx = x + 16 + ctx.measureText(t('[F] MELEE')).width;
  ctx.fillStyle = dry ? C.dng : 'rgba(184,204,170,0.55)'; ctx.font = '8px monospace';
  ctx.fillText(s.state === 'reload' ? t('RELOADING…') : (s._loose || 0) > 0 ? t('[R] RELOAD · {n} LOOSE', { n: s._loose }) : t('[R] RELOAD'), rx, y + 44);
  // Fresh swap: a quick flash on the weapon line.
  if (now - (s.swapAt || -1e9) < 220) {
    ctx.fillStyle = `rgba(255,220,120,${0.3 * (1 - (now - s.swapAt) / 220)})`;
    ctx.fillRect(x + 2, y + 21, w - 4, 13);
  }
  ctx.fillStyle = 'rgba(160,170,120,0.55)'; ctx.font = '9px monospace';
  ctx.fillText(t('SHIFT ROLL · G GRENADE · F MELEE · R RELOAD · Q GUN/MELEE'), 12, CH - 24);
}
