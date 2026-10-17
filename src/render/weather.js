// Siege wave conditions drawn over the battlefield (see data/waveMods.js).
// Called inside the camera transform (world coordinates), after actors
// and before the HUD, so the HD lighting pass also sees it.
import { CW, CH, GY, WX } from '../constants.js';

// Fog thickens with distance from the wall: the squad is clear, the
// far field is a grey wall the dead walk out of.
function fog(ctx, camX, now) {
  const g = ctx.createLinearGradient(WX + 200, 0, WX + 820, 0);
  g.addColorStop(0, 'rgba(100,110,118,0)'); g.addColorStop(1, 'rgba(100,110,118,0.55)');
  ctx.fillStyle = g; ctx.fillRect(Math.max(WX, camX - 10), 0, CW + 20, CH);
  // Drifting banks for movement.
  for (let i = 0; i < 9; i++) {
    const bx = ((i * 337 + now * 0.012 * (1 + (i % 3) * 0.4)) % (CW + 600)) + camX - 300;
    const by = GY - 150 + (i % 4) * 46;
    const g = ctx.createRadialGradient(bx, by, 10, bx, by, 190);
    g.addColorStop(0, 'rgba(120,128,134,0.22)'); g.addColorStop(1, 'rgba(120,128,134,0)');
    ctx.fillStyle = g; ctx.fillRect(bx - 190, by - 190, 380, 380);
  }
}

function night(ctx, camX) {
  ctx.fillStyle = 'rgba(2,4,14,0.28)';
  ctx.fillRect(camX - 10, 0, CW + 20, CH);
}

// Greenish drizzle + haze for the spitter pack.
function acid(ctx, camX, now) {
  ctx.fillStyle = 'rgba(60,110,30,0.10)'; ctx.fillRect(camX - 10, 0, CW + 20, CH);
  ctx.strokeStyle = 'rgba(150,220,110,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const x = camX + ((i * 97 + now * 0.05) % (CW + 40)) - 20;
    const y = (i * 53 + now * 0.6) % CH;
    ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 11);
  }
  ctx.stroke();
}

export function dWaveCondition(ctx, gs, now) {
  const camX = gs.cameraX || 0;
  if (gs.waveMod === 'fog') fog(ctx, camX, now);
  else if (gs.waveMod === 'night') night(ctx, camX);
  else if (gs.waveMod === 'acid') acid(ctx, camX, now);
}
