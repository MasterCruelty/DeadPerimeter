import { C, laneY, laneSc } from '../constants.js';

export function dZombie(ctx, z, now) {
  const ly = laneY(z.lane), sc = laneSc(z.lane);
  ctx.save(); ctx.translate(z.x, ly); ctx.scale(sc, sc);
  if (z.type === 'tank') ctx.scale(1.35, 1.35);
  else if (z.type === 'brute') ctx.scale(1.7, 1.7);
  ctx.scale(z.facing, 1);
  const cc = z.z.cc;
  const sc2 = z.z.sc;

  if (z.state === 'dead') {
    const dp = Math.min(1, (now - z.deadAt) / 480);
    const ease = 1 - Math.pow(1 - dp, 2.5);
    const angle = ease * Math.PI * 0.5;
    ctx.rotate(angle);
    if (dp > 0.6) {
      ctx.globalAlpha = Math.min(1, (dp - 0.6) / 0.25);
      ctx.fillStyle = C.bldd;
      ctx.beginPath(); ctx.arc(16, 2, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(26, -2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = cc; ctx.fillRect(-9, -32, 18, 32);
    ctx.fillStyle = sc2; ctx.fillRect(-6, -22, 5, 8); ctx.fillRect(2, -18, 5, 8);
    ctx.fillStyle = C.bldd; ctx.beginPath(); ctx.arc(-1, -26, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cc;
    ctx.save(); ctx.translate(9, -24); ctx.rotate(0.3 + ease * 0.6); ctx.fillRect(-3, 0, 6, 14); ctx.restore();
    ctx.save(); ctx.translate(-9, -24); ctx.rotate(-(0.3 + ease * 0.6)); ctx.fillRect(-3, 0, 6, 14); ctx.restore();
    ctx.fillStyle = sc2; ctx.beginPath(); ctx.arc(0, -35, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ee3020'; ctx.beginPath(); ctx.arc(3, -34, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0606'; ctx.beginPath(); ctx.arc(2, -31, 4, 0, Math.PI); ctx.fill();
    ctx.restore(); return;
  }

  const t = now / 420 + z.walkPhase, isAtk = z.state === 'attack';
  const la = isAtk ? 0 : Math.sin(t) * 22, reach = Math.sin(t * 0.55) * 8 + (isAtk ? 28 : 0);
  ctx.save(); ctx.translate(4, 0); ctx.rotate(la * Math.PI / 180);
  ctx.fillStyle = cc; ctx.fillRect(-4, 0, 8, 19);
  ctx.fillStyle = sc2; ctx.fillRect(-3, 14, 6, 6);
  ctx.fillStyle = '#181208'; ctx.fillRect(-4, 23, 9, 6); ctx.restore();
  ctx.save(); ctx.translate(-4, 0); ctx.rotate(-la * 1.4 * Math.PI / 180);
  ctx.fillStyle = cc; ctx.fillRect(-4, 0, 8, 19);
  ctx.fillStyle = sc2; ctx.fillRect(-2, 12, 5, 7);
  ctx.fillStyle = '#181208'; ctx.fillRect(-4, 23, 9, 6); ctx.restore();
  ctx.save(); ctx.rotate(-0.22);
  ctx.fillStyle = cc; ctx.fillRect(-10, -31, 20, 23);
  ctx.fillStyle = sc2; ctx.fillRect(-8, -22, 5, 6); ctx.fillRect(3, -18, 5, 9);
  ctx.fillStyle = C.bldd; ctx.beginPath(); ctx.arc(-1, -25, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(7, -16, 3, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(9, -27); ctx.rotate((-32 - reach) * Math.PI / 180);
  ctx.fillStyle = cc; ctx.fillRect(-3, 0, 7, 14);
  ctx.fillStyle = sc2; ctx.fillRect(-3, 12, 7, 10); ctx.beginPath(); ctx.arc(0, 23, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(-6, -27); ctx.rotate((18 + Math.sin(t * 0.8) * 9) * Math.PI / 180);
  ctx.fillStyle = cc; ctx.fillRect(-3, 0, 7, 14);
  ctx.fillStyle = sc2; ctx.fillRect(-3, 12, 7, 8); ctx.restore();
  ctx.save(); ctx.translate(2, -33); ctx.rotate(0.18);
  ctx.fillStyle = sc2; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(3, -2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cc1800'; ctx.beginPath(); ctx.arc(3, -2, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a0606'; ctx.beginPath(); ctx.arc(2, 4, 4, 0, Math.PI); ctx.fill();
  ctx.fillStyle = C.bld; ctx.beginPath(); ctx.arc(-2, 6, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.restore(); ctx.restore();

  if (z.hp < z.maxHp) {
    const scaleMul = z.type === 'brute' ? 1.7 : z.type === 'tank' ? 1.35 : 1;
    const bary = ly - Math.round(58 * sc * scaleMul);
    const w = z.type === 'brute' ? 60 : 36;
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(z.x - w / 2, bary, w, 4);
    ctx.fillStyle = z.type === 'brute' ? '#cc4400' : C.dng;
    ctx.fillRect(z.x - w / 2, bary, w * (z.hp / z.maxHp), 4);
    if (z.type === 'brute') {
      ctx.fillStyle = '#cc4400'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('★ BRUTE ★', z.x, bary - 4); ctx.textAlign = 'left';
    }
  }
}
