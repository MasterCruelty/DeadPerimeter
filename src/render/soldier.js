import { C, GY, laneY, laneSc, WEAPON_SCALE } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { dWpn } from './weapons.js';

// Deterministic per-soldier palette variant based on name + id so a given
// soldier always renders the same way across frames and across saves.
// Civilians keep their distinctive red-cap + brown-jacket palette, but the
// hash still picks a skin tone and beard flag for them.
const JACKET_VARIANTS = ['#465737', '#3f5230', '#4b5a3a', '#3a4a30']; // olive shades
const HELMET_VARIANTS = ['#2a3922', '#324228', '#2f3a20', '#3a4628']; // helmet shades
const SKIN_VARIANTS   = ['#bf8a6a', '#b07a5c', '#cf9676', '#8e6048']; // light → dark
function variantFor(s) {
  const key = `${s.name || ''}|${s.id || 0}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  h = Math.abs(h);
  return {
    jacket: JACKET_VARIANTS[h % JACKET_VARIANTS.length],
    helmet: HELMET_VARIANTS[(h >> 3) % HELMET_VARIANTS.length],
    skin:   SKIN_VARIANTS[(h >> 5) % SKIN_VARIANTS.length],
    beard:  ((h >> 7) & 1) === 1, // ~50%
  };
}

// Rooftop sniper sprite (stationary, on top of the fort wall).
export function dRooftopSniper(ctx, sn, now) {
  ctx.save();
  ctx.translate(sn.x, sn.y);

  // Sandbag emplacement under sniper
  ctx.fillStyle = '#483c28';
  ctx.beginPath(); ctx.ellipse(-12, 8, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3c3020';
  ctx.beginPath(); ctx.ellipse(8, 8, 13, 5, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a4830';
  ctx.beginPath(); ctx.ellipse(-2, 4, 12, 5, -0.1, 0, Math.PI * 2); ctx.fill();

  // Idle subtle bob
  const bob = Math.sin(now / 650) * 1.2;
  ctx.translate(0, bob);

  // Crouched / prone profile (kneeling).
  ctx.fillStyle = C.pan; ctx.fillRect(-6, -2, 14, 6);
  ctx.fillStyle = C.boot; ctx.fillRect(-7, 2, 7, 4); ctx.fillRect(2, 2, 7, 4);

  // Torso
  ctx.fillStyle = C.jac; ctx.fillRect(-9, -15, 18, 15);
  ctx.fillStyle = '#3b4d2e'; ctx.fillRect(-7, -12, 5, 4); ctx.fillRect(2, -12, 5, 4);
  ctx.fillStyle = '#181408'; ctx.fillRect(-9, -3, 18, 2);

  // Head & helmet
  ctx.fillStyle = C.sk; ctx.beginPath(); ctx.ellipse(2, -19, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.hel; ctx.beginPath(); ctx.arc(2, -21, 8, Math.PI, 0); ctx.fill();
  ctx.fillRect(-6, -21, 16, 5); ctx.fillRect(-7, -17, 18, 3);
  ctx.fillStyle = '#0a1808'; ctx.fillRect(-2, -17, 8, 3);

  // Sniper rifle
  ctx.fillStyle = '#3a2810'; ctx.fillRect(-10, -9, 8, 5);
  ctx.fillStyle = '#181614'; ctx.fillRect(-2, -10, 16, 5);
  ctx.fillStyle = '#222018'; ctx.fillRect(2, -5, 6, 7);
  const recoil = sn.recoil > 0 ? Math.sin(now / 30) * 1.5 : 0;
  ctx.fillStyle = '#0e0c0a'; ctx.fillRect(14 - recoil, -9, 28, 3);
  ctx.strokeStyle = '#222018'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(20, -7); ctx.lineTo(18, 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(24, -7); ctx.lineTo(26, 1); ctx.stroke();
  ctx.fillStyle = '#1a1816'; ctx.fillRect(2, -15, 10, 5);
  ctx.fillStyle = '#3e3838'; ctx.fillRect(3, -14, 8, 3);
  ctx.fillStyle = '#1a1816';
  ctx.beginPath(); ctx.arc(3, -12, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(11, -12, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1c1a18'; ctx.fillRect(40 - recoil, -10, 8, 5);

  // Muzzle flash on shot
  if (now - sn.shootAt < 90) {
    const fa = 1 - (now - sn.shootAt) / 90;
    ctx.save(); ctx.globalAlpha = fa;
    const fl = ctx.createRadialGradient(50, -7, 0, 50, -7, 16);
    fl.addColorStop(0, 'rgba(255,230,80,1)'); fl.addColorStop(0.4, 'rgba(255,100,0,0.7)'); fl.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(50, -7, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(50, -7, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // "SNIPER" label and kill counter
  ctx.fillStyle = C.acc; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
  ctx.fillText('SNIPER', sn.x, sn.y + 18);
  if (sn.kills > 0) {
    ctx.fillStyle = C.txt; ctx.font = '7px monospace';
    ctx.fillText(`☠ ${sn.kills}`, sn.x, sn.y - 30);
  }
  ctx.textAlign = 'left';
}

export function dSoldier(ctx, s, now, isSelected) {
  // Rooftop variant
  if (s.onRoof && s.state !== 'dead') {
    const sn = { x: s.x, y: GY - 160, shootAt: s.shootAt || 0, recoil: s.recoil || 0, kills: s.kills || 0 };
    dRooftopSniper(ctx, sn, now);
    if (s.hp < s.maxHp) {
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(s.x - 18, GY - 188, 36, 4);
      ctx.fillStyle = s.hp > 60 ? '#44bb44' : s.hp > 30 ? C.wrn : C.dng;
      ctx.fillRect(s.x - 18, GY - 188, 36 * (s.hp / s.maxHp), 4);
    }
    if (s.state === 'reload') {
      ctx.fillStyle = C.wrn; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('RELOAD', s.x, GY - 194); ctx.textAlign = 'left';
    }
    if (s.ammo <= 1 && s.state !== 'reload') {
      ctx.fillStyle = 'rgba(200,40,20,0.95)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
      ctx.fillText(s.ammo === 0 ? 'DRY' : 'LOW', s.x, GY - 194); ctx.textAlign = 'left';
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
  const isCiv = s.civilian;
  const isBandit = !!s.bandit;
  const isPolice = !!s.police;
  const v = variantFor(s);
  const SK = v.skin;
  const COL_jac = isPolice ? '#1a2840' : isBandit ? '#4a2222' : isCiv ? '#5a3a28' : v.jacket;
  const COL_pan = isPolice ? '#1f1f24' : isBandit ? '#1f1f24' : isCiv ? '#3a4858' : C.pan;
  const COL_hel = isPolice ? '#0e1622' : isBandit ? '#181614' : isCiv ? '#a04020' : v.helmet;
  // const COL_pkt = isCiv ? '#4a2a18' : '#3b4d2e';
  ctx.save();
  ctx.translate(s.x, ly);
  ctx.scale(sc * s.facing, sc);

  // ── DEAD SOLDIER ─────────────────────────────────────────────────
  if (s.state === 'dead') {
    ctx.save();
    ctx.scale(s.facing, 1);

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(-20, 2, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(110,5,5,0.58)';
    ctx.beginPath(); ctx.ellipse(-24, 0, 12, 5, 0.2, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = C.boot;
    ctx.fillRect(-6, -4, 7, 5); ctx.fillRect(-6, 0, 7, 4);
    ctx.fillRect(-8, 3, 8, 4); ctx.fillRect(1, 3, 8, 4);
    ctx.fillStyle = '#0a0808'; ctx.fillRect(-8, 6, 16, 2);

    ctx.fillStyle = COL_pan;
    ctx.fillRect(-24, -4, 18, 4); ctx.fillRect(-24, 0, 18, 4);
    ctx.fillStyle = '#2a321e'; ctx.fillRect(-22, -5, 5, 2);

    ctx.fillStyle = '#181408'; ctx.fillRect(-25, -2, 5, 3);
    ctx.fillStyle = '#372c1a'; ctx.fillRect(-26, -2, 4, 4);

    ctx.fillStyle = COL_jac; ctx.fillRect(-40, -8, 18, 14);
    ctx.fillStyle = '#3b4d2e';
    ctx.fillRect(-39, -6, 5, 4); ctx.fillRect(-31, -6, 5, 4);
    ctx.fillStyle = '#181408'; ctx.fillRect(-40, 4, 18, 2);

    ctx.save(); ctx.translate(-32, -2); ctx.rotate(-0.22);
    ctx.fillStyle = COL_jac; ctx.fillRect(-3, -12, 6, 14);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, -13, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.fillStyle = COL_jac; ctx.fillRect(-38, 5, 14, 4);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(-38 + 13, 7, 4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = SK; ctx.fillRect(-44, -4, 5, 6);

    ctx.beginPath(); ctx.ellipse(-49, 0, 7, 9, 0, 0, Math.PI * 2); ctx.fillStyle = SK; ctx.fill();
    ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-53, 0); ctx.lineTo(-47, 0); ctx.stroke();

    ctx.fillStyle = COL_hel;
    ctx.beginPath(); ctx.arc(-49, -2, 10, Math.PI * 1.05, 0, false); ctx.fill();
    ctx.fillRect(-59, -2, 20, 4);
    ctx.fillRect(-60, 1, 22, 3);
    ctx.fillStyle = '#1a2918'; ctx.fillRect(-56, 1, 14, 3);
    ctx.fillStyle = '#243318'; ctx.fillRect(-50, -10, 3, 5);

    ctx.save(); ctx.translate(-20, -14); ctx.rotate(0.05);
    ctx.fillStyle = '#1a1816'; ctx.fillRect(-22, -2, 14, 4);
    ctx.fillStyle = '#252220'; ctx.fillRect(-8, -3, 30, 6);
    ctx.fillStyle = '#1e1c18'; ctx.save(); ctx.translate(4, 4); ctx.rotate(-0.3); ctx.fillRect(-3, -1, 6, 12); ctx.restore();
    ctx.fillStyle = '#181614'; ctx.fillRect(22, -1, 22, 3);
    ctx.fillStyle = '#141210'; ctx.fillRect(41, -2, 5, 5);
    ctx.restore();

    ctx.restore(); ctx.restore();
    return;
  }

  // ── LIVING SOLDIER ─────────────────────────────────────────────
  const isWalk = s.state === 'walk', isShoot = s.state === 'shoot', isRl = s.state === 'reload', isKnife = s.state === 'knife';
  const t = now / 300 + s.walkPhase;
  const la = isWalk ? Math.sin(t) * 28 : 0;
  const bb = isWalk ? Math.abs(Math.sin(t)) * 2.5 : 0;
  const aa = isWalk ? Math.sin(t) * 12 : 0;
  const breath = (!isWalk && !isShoot && !isRl) ? Math.sin(now / 900 + s.walkPhase) * 0.7 : 0;
  const by = -(bb + breath);
  const rcl = isShoot ? Math.max(0, 1 - (now - s.shootAt) / 185) * 5 : 0;
  const rlp = isRl ? Math.min(1, (now - s.reloadStart) / WPN[s.weapon].rl) : 0;
  const rla = isRl ? (rlp < 0.35 ? (rlp / 0.35) * 68 : rlp < 0.65 ? 68 : 68 - ((rlp - 0.65) / 0.35) * 68) : 0;

  ctx.save(); ctx.translate(4, -bb); ctx.rotate(la * Math.PI / 180);
  ctx.fillStyle = COL_pan; ctx.fillRect(-4, 0, 8, 20);
  ctx.fillStyle = C.boot; ctx.fillRect(-4, 18, 9, 8); ctx.fillRect(-4, 24, 14, 5);
  ctx.restore();
  ctx.save(); ctx.translate(-4, -bb); ctx.rotate(-la * Math.PI / 180);
  ctx.fillStyle = COL_pan; ctx.fillRect(-4, 0, 8, 20);
  ctx.fillStyle = C.boot; ctx.fillRect(-4, 18, 9, 8); ctx.fillRect(-4, 24, 14, 5);
  ctx.restore();

  ctx.fillStyle = COL_jac; ctx.fillRect(-11, by - 34, 22, 25);
  ctx.fillStyle = '#3b4d2e'; ctx.fillRect(-9, by - 28, 7, 5); ctx.fillRect(2, by - 28, 7, 5);
  ctx.fillStyle = '#181408'; ctx.fillRect(-11, by - 10, 22, 4);
  ctx.fillStyle = '#372c1a'; ctx.fillRect(-3, by - 13, 6, 7);

  if (isRl) {
    ctx.save(); ctx.translate(6, by - 30); ctx.rotate(rla * Math.PI / 180);
    ctx.fillStyle = COL_jac; ctx.fillRect(-4, 0, 7, 16);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, 16, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(-4, by - 30); ctx.rotate(rla * 0.65 * Math.PI / 180);
    ctx.fillStyle = COL_jac; ctx.fillRect(-4, 0, 7, 14);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, 14, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(8, by - 17); ctx.rotate(rla * 0.38 * Math.PI / 180); dWpn(ctx, s.weapon, 0); ctx.restore();
    if (rlp > 0.28 && rlp < 0.67) {
      const drop = (rlp - 0.28) / 0.39 * 34, spin = (rlp - 0.28) * 2.4;
      ctx.save(); ctx.translate(14, by - 15 + drop); ctx.rotate(spin);
      ctx.fillStyle = '#252018'; ctx.fillRect(-3, -6, 7, 14);
      ctx.fillStyle = '#3a3028'; ctx.fillRect(-2, -4, 5, 3); ctx.restore();
    }
  } else if (isKnife) {
    ctx.save(); ctx.translate(-5, by - 31);
    ctx.fillStyle = COL_jac; ctx.fillRect(-3, 0, 7, 16);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, 16, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const kf = Math.max(0, 1 - (now - (s.shootAt || 0)) / 300);
    ctx.save(); ctx.translate(4 + kf * 16, by - 30); ctx.rotate(-0.25 + kf * 0.55);
    ctx.fillStyle = COL_jac; ctx.fillRect(-3, 0, 7, 14);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, 14, 4, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(0, 14); ctx.rotate(-1.0 + kf * 0.3);
    ctx.fillStyle = '#9090a0';
    ctx.beginPath(); ctx.moveTo(-1, -22); ctx.lineTo(2, -22); ctx.lineTo(1, 0); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#888'; ctx.fillRect(-1, -24, 3, 3);
    ctx.fillStyle = '#5a3010'; ctx.fillRect(-3, 0, 7, 9);
    ctx.fillStyle = '#3a1a08'; ctx.fillRect(-3, 8, 7, 3);
    ctx.restore(); ctx.restore();
  } else {
    // shoot / idle — front arm + weapon (back arm omitted as in V8)
    ctx.save(); ctx.translate(4, by - 30); ctx.rotate(-aa * 0.4 * Math.PI / 180 + (isShoot ? 0.12 : 0));
    ctx.fillStyle = COL_jac; ctx.fillRect(-3, 0, 7, 14);
    ctx.fillStyle = SK; ctx.beginPath(); ctx.arc(0, 14, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(0, by - 22); dWpn(ctx, s.weapon, rcl);
    if (isShoot && now - s.shootAt < 90) {
      const fa = 1 - (now - s.shootAt) / 90;
      // Anchor the muzzle flash to the (scaled) end of the barrel for each
      // weapon. Coordinates are in soldier-local space; weapon sprites are
      // drawn with WEAPON_SCALE in dWpn, so we mirror that scaling here.
      const muzzleRaw = s.weapon === 'rifle'  ? { x: 68, y: -4 }
                     :  s.weapon === 'pistol' ? { x: 41, y: -9 }
                     :  s.weapon === 'sniper' ? { x: 80, y: -4 }
                     :                          { x: 48, y: -10 };
      const mx = muzzleRaw.x * WEAPON_SCALE;
      const my = muzzleRaw.y * WEAPON_SCALE;
      ctx.save(); ctx.globalAlpha = fa;
      const fl = ctx.createRadialGradient(mx, my, 0, mx, my, 18);
      fl.addColorStop(0, 'rgba(255,230,80,1)'); fl.addColorStop(0.4, 'rgba(255,100,0,0.7)'); fl.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(mx, my, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
      for (let sp = 0; sp < 5; sp++) {
        const ang = sp * 1.26 + fa * 4;
        ctx.fillStyle = C.muz;
        ctx.fillRect(mx + Math.cos(ang) * 10, my + Math.sin(ang) * 10, 2, 2);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  if (s.ammo <= 3 && s.ammo > 0 && !isRl) {
    ctx.fillStyle = 'rgba(200,160,20,0.9)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('LOW', 0, by - 52); ctx.textAlign = 'left';
  }
  if (s.ammo === 0 && !isRl) {
    ctx.fillStyle = 'rgba(200,40,20,0.95)'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
    ctx.fillText(isKnife ? '🔪' : ' DRY', 0, by - 52); ctx.textAlign = 'left';
  }

  const hy = by - 34;
  ctx.fillStyle = SK; ctx.fillRect(-3, hy - 5, 6, 7);
  ctx.beginPath(); ctx.ellipse(0, hy - 14, 8, 9, 0, 0, Math.PI * 2); ctx.fillStyle = SK; ctx.fill();
  if (isCiv) {
    ctx.fillStyle = COL_hel;
    ctx.beginPath(); ctx.arc(0, hy - 15, 9, Math.PI, 0); ctx.fill();
    ctx.fillRect(-9, hy - 15, 18, 3);
    ctx.fillStyle = '#7a2810'; ctx.fillRect(2, hy - 18, 5, 3);
    ctx.fillStyle = '#5a2010'; ctx.beginPath(); ctx.ellipse(6, hy - 12, 10, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2818'; ctx.fillRect(-2, hy - 7, 4, 2);
  } else {
    ctx.fillStyle = COL_hel;
    ctx.beginPath(); ctx.arc(0, hy - 16, 10, Math.PI, 0); ctx.fill();
    ctx.fillRect(-10, hy - 16, 20, 6); ctx.fillRect(-12, hy - 11, 24, 4);
    ctx.fillStyle = '#1a2918'; ctx.fillRect(-6, hy - 11, 12, 4);
  }
  // Beard scruff — purely cosmetic variant tied to the soldier hash.
  if (v.beard) {
    ctx.fillStyle = '#1a1108';
    ctx.fillRect(-3, hy - 9, 6, 2);
    ctx.fillRect(-2, hy - 7, 4, 1);
  }
  if (s.hurtTimer > 0) {
    ctx.fillStyle = `rgba(255,30,30,${Math.min(1, s.hurtTimer / 200) * 0.4})`;
    ctx.fillRect(-15, hy - 22, 30, 68);
  }
  ctx.restore();

  if (s.hp < s.maxHp) {
    const bary = ly - Math.round(60 * sc);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(s.x - 18, bary, 36, 4);
    ctx.fillStyle = s.hp > 60 ? '#44bb44' : s.hp > 30 ? C.wrn : C.dng;
    ctx.fillRect(s.x - 18, bary, 36 * (s.hp / s.maxHp), 4);
  }
  if (isRl) {
    ctx.fillStyle = C.wrn; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('RELOAD', s.x, ly - Math.round(68 * sc)); ctx.textAlign = 'left';
  }
  if (isSelected) {
    const ring = 0.7 + 0.3 * Math.sin(now / 180);
    ctx.strokeStyle = `rgba(114,188,64,${ring})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(s.x, ly + 2, 18, 5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(114,188,64,${ring})`;
    const arrY = ly - Math.round(74 * sc);
    ctx.beginPath(); ctx.moveTo(s.x, arrY); ctx.lineTo(s.x - 5, arrY - 7); ctx.lineTo(s.x + 5, arrY - 7); ctx.closePath(); ctx.fill();
  }
}
