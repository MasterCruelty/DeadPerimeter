import { dContactShadow } from './background.js';
import { drawHostileBody } from './actors/people.js';
import { C, laneY, laneSc } from '../constants.js';

// Hostile human survivor sprite. Civilian silhouette + weapon (knife / pistol).
export function dHuman(ctx, h, now) {
  const ly = laneY(h.lane), sc = laneSc(h.lane);
  dContactShadow(ctx, h.x, ly + 1, sc, h.state === 'dead' ? 26 : 15);
  ctx.save(); ctx.translate(h.x, ly); ctx.scale(sc * h.facing, sc);
  drawHostileBody(ctx, h, now);
  ctx.restore();
  if (h.state === 'dead') return;

  if (h.hp < h.maxHp) {
    const bary = ly - Math.round(70 * sc);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(h.x - 18, bary, 36, 4);
    ctx.fillStyle = C.dng; ctx.fillRect(h.x - 18, bary, 36 * (h.hp / h.maxHp), 4);
  }
}
