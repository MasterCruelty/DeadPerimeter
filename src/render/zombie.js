import { C, laneY, laneSc } from '../constants.js';
import { dContactShadow } from './background.js';
import { drawZombieBody } from './actors/zombies.js';

export function dZombie(ctx, z, now) {
  const ly = laneY(z.lane), sc = laneSc(z.lane);
  const bulk = z.type === 'brute' ? 1.7 : z.type === 'tank' ? 1.35 : 1;
  dContactShadow(ctx, z.x, ly + 1, sc * bulk, z.state === 'dead' ? 26 : 15);
  ctx.save(); ctx.translate(z.x, ly); ctx.scale(sc * bulk * z.facing, sc * bulk);
  drawZombieBody(ctx, z, now);
  ctx.restore();
  if (z.state === 'dead') return;

  if (z.hp < z.maxHp) {
    const scaleMul = z.type === 'brute' ? 1.7 : z.type === 'tank' ? 1.35 : 1;
    const bary = ly - Math.round(70 * sc * scaleMul);
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
