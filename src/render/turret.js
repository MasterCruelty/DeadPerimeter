import { C } from '../constants.js';

// Static machine-gun turret on the inside of the wall.
export function dTurret(ctx, t, now) {
  ctx.save();
  ctx.translate(t.x, t.y);

  // Sandbag emplacement
  ctx.fillStyle = '#483c28';
  ctx.beginPath(); ctx.ellipse(-10, 6, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3c3020';
  ctx.beginPath(); ctx.ellipse(8, 6, 12, 4, 0.1, 0, Math.PI * 2); ctx.fill();

  // Tripod
  ctx.strokeStyle = '#222018'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-6, 6); ctx.lineTo(-2, -4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(2, -4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -6); ctx.stroke();

  // Receiver / mount
  ctx.fillStyle = '#1a1816';
  ctx.fillRect(-7, -10, 14, 6);
  ctx.fillStyle = '#2c2a26';
  ctx.fillRect(-6, -9, 12, 3);

  // Ammo box on the side
  ctx.fillStyle = '#36321e'; ctx.fillRect(-12, -8, 5, 6);
  ctx.fillStyle = '#1a1814'; ctx.fillRect(-11, -7, 3, 4);
  // Belt feed
  ctx.fillStyle = '#cc9900';
  for (let bx = -6; bx < -2; bx += 1.5) ctx.fillRect(bx, -8, 1, 1);

  // Barrel — recoil-driven shake on shot
  const recoil = now - (t.lastShot || 0) < 100 ? Math.sin(now / 28) * 1.6 : 0;
  ctx.fillStyle = '#0e0c0a';
  ctx.fillRect(6 - recoil, -8, 26, 3);
  // Cooling perforations
  ctx.fillStyle = '#1a1816';
  for (let bx = 9; bx < 29; bx += 4) ctx.fillRect(bx - recoil, -8, 2, 3);
  // Muzzle device
  ctx.fillStyle = '#171514';
  ctx.fillRect(32 - recoil, -9, 4, 5);

  // Muzzle flash
  if (now - (t.lastShot || 0) < 90) {
    const fa = 1 - (now - t.lastShot) / 90;
    ctx.save(); ctx.globalAlpha = fa;
    const fx = 38 - recoil, fy = -7;
    const fl = ctx.createRadialGradient(fx, fy, 0, fx, fy, 14);
    fl.addColorStop(0, 'rgba(255,230,80,1)');
    fl.addColorStop(0.4, 'rgba(255,100,0,0.7)');
    fl.addColorStop(1, 'rgba(255,50,0,0)');
    ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(fx, fy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  // Label
  ctx.fillStyle = C.acc; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
  ctx.fillText('MG', t.x, t.y + 17); ctx.textAlign = 'left';
}
