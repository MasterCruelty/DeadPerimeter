import { C, laneY, laneSc } from '../constants.js';

export function dBarricade(ctx, b) {
  const pct = b.hp / b.maxHp;

  // Connecting side posts (depth perspective back→front)
  for (let i = 0; i < 2; i++) {
    const ly0 = laneY(2 - i), sc0 = laneSc(2 - i);
    const ly1 = laneY(1 - i), sc1 = laneSc(1 - i);
    ctx.fillStyle = '#3a2810';
    ctx.beginPath();
    ctx.moveTo(b.x - 16 * sc0, ly0); ctx.lineTo(b.x - 16 * sc1, ly1);
    ctx.lineTo(b.x - 13 * sc1, ly1); ctx.lineTo(b.x - 13 * sc0, ly0);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(b.x + 13 * sc0, ly0); ctx.lineTo(b.x + 13 * sc1, ly1);
    ctx.lineTo(b.x + 16 * sc1, ly1); ctx.lineTo(b.x + 16 * sc0, ly0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#281c08';
    ctx.beginPath();
    ctx.moveTo(b.x - 16 * sc0, ly0 - 22 * sc0); ctx.lineTo(b.x - 16 * sc1, ly1 - 22 * sc1);
    ctx.lineTo(b.x + 16 * sc1, ly1 - 22 * sc1); ctx.lineTo(b.x + 16 * sc0, ly0 - 22 * sc0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a3210';
    ctx.beginPath();
    ctx.moveTo(b.x - 16 * sc0, ly0 - 13 * sc0); ctx.lineTo(b.x - 16 * sc1, ly1 - 13 * sc1);
    ctx.lineTo(b.x + 16 * sc1, ly1 - 13 * sc1); ctx.lineTo(b.x + 16 * sc0, ly0 - 13 * sc0);
    ctx.closePath(); ctx.fill();
  }

  // Barricade face at each lane (back→front for occlusion)
  for (let lane = 2; lane >= 0; lane--) {
    const ly = laneY(lane), sc = laneSc(lane);
    ctx.save(); ctx.translate(b.x, ly); ctx.scale(sc, sc);

    ctx.fillStyle = '#5a3e18'; ctx.fillRect(-16, -22, 32, 22);
    ctx.fillStyle = '#4a3210';
    ctx.fillRect(-15, -21, 10, 20); ctx.fillRect(-4, -21, 9, 20); ctx.fillRect(6, -21, 9, 20);
    ctx.fillStyle = '#6a4820'; ctx.fillRect(-16, -14, 32, 3); ctx.fillRect(-16, -7, 32, 2);
    ctx.fillStyle = '#3a2810'; ctx.fillRect(-17, -22, 3, 22); ctx.fillRect(14, -22, 3, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let gy = -18; gy < 0; gy += 5) ctx.fillRect(-14, gy, 28, 1);
    if (pct < 0.66) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-3, -20); ctx.lineTo(4, -9); ctx.lineTo(0, -5); ctx.stroke();
    }
    if (pct < 0.33) { ctx.beginPath(); ctx.moveTo(6, -19); ctx.lineTo(12, -7); ctx.stroke(); }

    if (lane === 0) {
      ctx.fillStyle = '#584030'; ctx.beginPath(); ctx.ellipse(-10, 1, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3228'; ctx.beginPath(); ctx.ellipse(5, 2, 11, 5, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#503a2e'; ctx.beginPath(); ctx.ellipse(17, 1, 8, 5, -0.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#484840'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let wx = -12; wx < 12; wx += 7) ctx.arc(wx, -23, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  const frontY = laneY(0);
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(b.x - 20, frontY - 34, 40, 5);
  ctx.fillStyle = pct > 0.5 ? C.wrn : C.dng; ctx.fillRect(b.x - 20, frontY - 34, 40 * pct, 5);
  ctx.fillStyle = C.txt; ctx.font = '8px monospace'; ctx.textAlign = 'center';
  ctx.fillText(`${b.hp}/${b.maxHp}`, b.x, frontY - 37); ctx.textAlign = 'left';
}

export function dBlt(ctx, b) {
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.dy, b.dx));
  if (b.spit) {
    // Acid spit: green blob with a faint trail.
    const g = ctx.createLinearGradient(-10, 0, 0, 0);
    g.addColorStop(0, 'rgba(120,200,40,0)');
    g.addColorStop(1, 'rgba(160,240,80,0.85)');
    ctx.fillStyle = g; ctx.fillRect(-10, -1.5, 10, 3);
    ctx.fillStyle = '#a8e060';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cfff8a';
    ctx.beginPath(); ctx.arc(-1, 0, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const g = ctx.createLinearGradient(-14, 0, 0, 0);
  g.addColorStop(0, 'rgba(255,200,0,0)');
  g.addColorStop(1, b.hostile ? '#ff7733' : C.trc);
  ctx.fillStyle = g; ctx.fillRect(-14, -1, 14, 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(-2, -1.5, 5, 3);
  ctx.restore();
}

export function dFx(ctx, e, now) {
  const life = (now - e.at) / e.dur;
  if (life >= 1) return;
  ctx.save(); ctx.globalAlpha = 1 - life; ctx.translate(e.x, e.y);
  if (e.type === 'blood') {
    e.drops.forEach(d => {
      const gv = life * life * 22;
      ctx.fillStyle = C.bld;
      ctx.beginPath(); ctx.arc(d.x + d.vx * life * 18, d.y + d.vy * life * 14 + gv, d.r * (1 - life * 0.4), 0, Math.PI * 2); ctx.fill();
    });
  } else if (e.type === 'shell') {
    ctx.fillStyle = '#ccaa22';
    ctx.save(); ctx.translate(e.vx * life * 30, life * life * 25); ctx.rotate(life * 9);
    ctx.fillRect(-2, -5, 4, 10); ctx.restore();
  } else if (e.type === 'txt') {
    ctx.fillStyle = e.col || '#fff';
    ctx.font = `bold ${13 - life * 3}px monospace`; ctx.textAlign = 'center';
    ctx.fillText(e.v, 0, -life * 34); ctx.textAlign = 'left';
  } else if (e.type === 'slash') {
    ctx.strokeStyle = `rgba(255,220,100,${(1 - life) * 0.9})`; ctx.lineWidth = 2.5 - life * 1.5;
    ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(14, 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10, 10); ctx.lineTo(10, -10); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,200,${(1 - life) * 0.5})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(7, 5); ctx.stroke();
  } else if (e.type === 'hit') {
    ctx.fillStyle = 'rgba(255,160,0,0.7)';
    ctx.beginPath(); ctx.arc(0, 0, 10 * (1 - life), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
