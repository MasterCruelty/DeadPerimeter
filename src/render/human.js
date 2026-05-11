import { C, laneY, laneSc } from '../constants.js';

// Hostile human survivor sprite. Civilian silhouette + weapon (knife / pistol).
export function dHuman(ctx, h, now) {
  const ly = laneY(h.lane), sc = laneSc(h.lane);
  const isGun = h.type === 'gunman';
  const palette = h.h.color;
  const cap = h.h.cap;
  ctx.save(); ctx.translate(h.x, ly); ctx.scale(sc * h.facing, sc);

  if (h.state === 'dead') {
    const dp = Math.min(1, (now - h.deadAt) / 480);
    const ease = 1 - Math.pow(1 - dp, 2.5);
    ctx.rotate(ease * Math.PI * 0.5);
    ctx.fillStyle = 'rgba(110,5,5,0.55)';
    ctx.beginPath(); ctx.ellipse(2, 4, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette; ctx.fillRect(-9, -32, 18, 32);
    ctx.fillStyle = C.sk; ctx.beginPath(); ctx.arc(0, -35, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  const t = now / 320 + h.walkPhase;
  const isWalk = h.state === 'walk';
  const la = isWalk ? Math.sin(t) * 24 : 0;
  const bb = isWalk ? Math.abs(Math.sin(t)) * 2.5 : 0;
  const by = -bb;

  // Legs (jeans)
  ctx.save(); ctx.translate(4, -bb); ctx.rotate(la * Math.PI / 180);
  ctx.fillStyle = '#1a2238'; ctx.fillRect(-4, 0, 8, 20);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-4, 18, 9, 8);
  ctx.restore();
  ctx.save(); ctx.translate(-4, -bb); ctx.rotate(-la * Math.PI / 180);
  ctx.fillStyle = '#1a2238'; ctx.fillRect(-4, 0, 8, 20);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-4, 18, 9, 8);
  ctx.restore();

  // Torso (jacket / hoodie)
  ctx.fillStyle = palette; ctx.fillRect(-11, by - 32, 22, 24);
  ctx.fillStyle = '#181408'; ctx.fillRect(-11, by - 10, 22, 3);

  // Arms + weapon
  if (isGun) {
    // Back arm holding pistol forward
    ctx.save(); ctx.translate(6, by - 26); ctx.rotate(0.05);
    ctx.fillStyle = palette; ctx.fillRect(-3, 0, 7, 12);
    ctx.fillStyle = C.sk; ctx.beginPath(); ctx.arc(0, 12, 4, 0, Math.PI * 2); ctx.fill();
    // Pistol silhouette in hand
    ctx.fillStyle = '#1a1816'; ctx.fillRect(2, 10, 14, 5);
    ctx.fillStyle = '#0a0908'; ctx.fillRect(4, 9, 3, 2);
    ctx.restore();
    // Muzzle flash on shoot
    if (h.lastShot && now - h.lastShot < 90) {
      const fa = 1 - (now - h.lastShot) / 90;
      ctx.save(); ctx.globalAlpha = fa; ctx.translate(22, by - 14);
      const fl = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
      fl.addColorStop(0, 'rgba(255,230,80,1)');
      fl.addColorStop(0.5, 'rgba(255,100,0,0.6)');
      fl.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  } else {
    // Knife thrust
    const kf = Math.max(0, 1 - (now - (h.atkTimer || 0)) / 220);
    ctx.save(); ctx.translate(4 + kf * 12, by - 26); ctx.rotate(-0.15 + kf * 0.45);
    ctx.fillStyle = palette; ctx.fillRect(-3, 0, 7, 13);
    ctx.fillStyle = C.sk; ctx.beginPath(); ctx.arc(0, 13, 4, 0, Math.PI * 2); ctx.fill();
    // Knife blade
    ctx.fillStyle = '#bcbcc8';
    ctx.beginPath(); ctx.moveTo(2, 13); ctx.lineTo(16, 11); ctx.lineTo(16, 14); ctx.lineTo(2, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3010'; ctx.fillRect(-1, 12, 4, 3);
    ctx.restore();
  }

  // Head + cap
  const hy = by - 34;
  ctx.fillStyle = C.sk; ctx.fillRect(-3, hy - 5, 6, 7);
  ctx.beginPath(); ctx.ellipse(0, hy - 14, 8, 9, 0, 0, Math.PI * 2); ctx.fillStyle = C.sk; ctx.fill();
  ctx.fillStyle = cap;
  ctx.beginPath(); ctx.arc(0, hy - 15, 9, Math.PI, 0); ctx.fill();
  ctx.fillRect(-9, hy - 15, 18, 3);
  // Visor (baseball cap front)
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.ellipse(6, hy - 12, 10, 2, 0, 0, Math.PI * 2); ctx.fill();

  if (h.hurtTimer > 0) {
    ctx.fillStyle = `rgba(255,30,30,${Math.min(1, h.hurtTimer / 200) * 0.4})`;
    ctx.fillRect(-15, hy - 22, 30, 64);
  }
  ctx.restore();

  if (h.hp < h.maxHp) {
    const bary = ly - Math.round(58 * sc);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(h.x - 18, bary, 36, 4);
    ctx.fillStyle = C.dng; ctx.fillRect(h.x - 18, bary, 36 * (h.hp / h.maxHp), 4);
  }
}
