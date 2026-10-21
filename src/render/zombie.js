import { C, laneY, laneSc } from '../constants.js';
import { dContactShadow } from './background.js';
import { drawZombieBody } from './actors/zombies.js';
import { t } from '../i18n/index.js';

export function dZombie(ctx, z, now) {
  const ly = laneY(z.lane), sc = laneSc(z.lane);
  const bulk = z.boss ? 1.95 : z.type === 'brute' ? 1.7 : z.type === 'tank' ? 1.35 : 1;
  // Mini-boss: a pulsing red aura so it reads at a glance in the horde.
  if (z.boss && z.state !== 'dead') {
    const a = 0.22 + 0.1 * Math.sin(now / 180), r = 70 * sc;
    const g = ctx.createRadialGradient(z.x, ly - 50 * sc, 4, z.x, ly - 50 * sc, r);
    g.addColorStop(0, `rgba(255,60,30,${a})`); g.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = g; ctx.fillRect(z.x - r, ly - 50 * sc - r, r * 2, r * 2);
  }
  dContactShadow(ctx, z.x, ly + 1, sc * bulk, z.state === 'dead' ? 26 : 15);
  ctx.save(); ctx.translate(z.x, ly); ctx.scale(sc * bulk * z.facing, sc * bulk);
  drawZombieBody(ctx, z, now);
  ctx.restore();
  if (z.state === 'dead') return;

  if (z.hp < z.maxHp && !z.boss) {   // the boss has its own HUD bar
    const scaleMul = z.type === 'brute' ? 1.7 : z.type === 'tank' ? 1.35 : 1;
    const bary = ly - Math.round(70 * sc * scaleMul);
    const w = z.type === 'brute' ? 60 : 36;
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(z.x - w / 2, bary, w, 4);
    ctx.fillStyle = z.type === 'brute' ? '#cc4400' : C.dng;
    ctx.fillRect(z.x - w / 2, bary, w * (z.hp / z.maxHp), 4);
    if (z.type === 'brute') {
      ctx.fillStyle = '#cc4400'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText(t('★ BRUTE ★'), z.x, bary - 4); ctx.textAlign = 'left';
    }
  }
}
