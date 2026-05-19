import { C, CW, CH, GY, WX, LANES, WORLD_W } from '../constants.js';
import { STARS, BLDGS, SIEGE_DECOR } from '../data/expeditions.js';

// Draws a single piece of siege scenery (cars, lampposts, rubble,
// signs, craters, dried blood). All decoration sits on or near
// ground level — no collision, purely visual.
function dDecor(ctx, d) {
  const x = d.x;
  // Y baseline depends on lane (back lane = farther, smaller, higher)
  const lane = d.lane ?? 0;
  const y = GY + LANES[lane].dy;
  const sc = LANES[lane].sc;
  switch (d.type) {
    case 'wreck': {
      // Burned-out car: rusted body, smashed-in roof, no wheels
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.fillStyle = '#3a1f12'; ctx.fillRect(-26, -16, 52, 14);
      ctx.fillStyle = '#1a0f08'; ctx.fillRect(-22, -26, 40, 12);
      // Caved-in roof
      ctx.fillStyle = '#0a0604';
      ctx.beginPath();
      ctx.moveTo(-22, -26); ctx.lineTo(-10, -22); ctx.lineTo(8, -28); ctx.lineTo(18, -22); ctx.lineTo(-22, -22);
      ctx.closePath(); ctx.fill();
      // Smashed windshield (jagged)
      ctx.fillStyle = '#1a2a28'; ctx.fillRect(2, -24, 14, 8);
      // Wheel wells (no wheels, just dark holes)
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(-14, -2, 5, Math.PI, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 14, -2, 5, Math.PI, Math.PI * 2); ctx.fill();
      // Rust streaks
      ctx.fillStyle = 'rgba(120,60,20,0.6)';
      ctx.fillRect(-20, -12, 3, 8); ctx.fillRect(10, -10, 2, 6);
      // Bullet holes
      ctx.fillStyle = '#000';
      ctx.fillRect(-6, -22, 2, 2); ctx.fillRect(0, -18, 2, 2); ctx.fillRect(-12, -16, 2, 2);
      ctx.restore();
      break;
    }
    case 'lamppost': {
      // Bent street lamp leaning forward
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.fillStyle = '#1a1612';
      ctx.fillRect(-2, -68, 3, 68);
      // Bent crook
      ctx.fillRect(-2, -68, 18, 3);
      ctx.fillStyle = '#0a0806';
      ctx.fillRect(14, -72, 8, 8);
      // Lamp glow (very faint, the bulb's dead but rusted housing catches moonlight)
      ctx.fillStyle = 'rgba(180,160,100,0.05)';
      ctx.beginPath(); ctx.arc(18, -68, 14, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
    case 'rubble': {
      // Pile of concrete chunks + rebar
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.fillStyle = '#3a3a32';
      ctx.beginPath();
      ctx.moveTo(-20, 0); ctx.lineTo(-14, -10); ctx.lineTo(-4, -18); ctx.lineTo(8, -14); ctx.lineTo(16, -8); ctx.lineTo(20, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1a1a14';
      ctx.fillRect(-12, -8, 6, 4); ctx.fillRect(2, -12, 5, 3); ctx.fillRect(10, -6, 4, 3);
      // Rebar sticking out
      ctx.strokeStyle = '#5a4a30'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-4, -18); ctx.lineTo(-2, -28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, -14); ctx.lineTo(12, -22); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'sign': {
      // Bent traffic sign, signal red
      ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.fillStyle = '#1a1612'; ctx.fillRect(-1, -32, 2, 32);
      ctx.fillStyle = '#5a1818';
      ctx.beginPath();
      ctx.moveTo(-12, -34); ctx.lineTo(12, -38); ctx.lineTo(14, -22); ctx.lineTo(-10, -18);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3a0a0a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#ccaaaa'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('!', 1, -26);
      ctx.textAlign = 'left';
      ctx.restore();
      break;
    }
    case 'crater': {
      // Dark blast crater on the road
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.ellipse(0, 2, 28, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(40,30,20,0.6)';
      ctx.beginPath(); ctx.ellipse(0, 2, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
      // Scorch ring
      ctx.strokeStyle = 'rgba(60,30,10,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 2, 32, 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'blood': {
      // Dried blood streak/pool on the front lane road
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = 'rgba(70,10,10,0.55)';
      ctx.beginPath(); ctx.ellipse(-2, 3, 14, 4, 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(50,5,5,0.7)';
      ctx.beginPath(); ctx.ellipse(2, 5, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      // Drag-mark trail
      ctx.fillStyle = 'rgba(70,10,10,0.30)';
      ctx.beginPath(); ctx.ellipse(14, 4, 12, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
  }
}

// Siege backdrop now paints across the full WORLD_W (~2.2× the
// viewport) so the camera-scroll reveals more skyline / ground as
// it pans, rather than running into a clipped edge.
export function dBg(ctx) {
  // Sky
  const sg = ctx.createLinearGradient(0, 0, 0, GY - 80);
  sg.addColorStop(0, C.sky1); sg.addColorStop(1, C.sky2);
  ctx.fillStyle = sg; ctx.fillRect(0, 0, WORLD_W, GY - 80);
  STARS.forEach(s => {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + s.r * 0.22})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  });
  // Moon and a couple of distant fire glows across the wider skyline
  ctx.fillStyle = 'rgba(200,212,185,0.13)'; ctx.beginPath(); ctx.arc( 818, 42, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,80,0,0.07)'; ctx.beginPath(); ctx.arc( 660, GY - 90,  90, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,80,0,0.05)'; ctx.beginPath(); ctx.arc(1280, GY - 80, 110, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,80,0,0.06)'; ctx.beginPath(); ctx.arc(1720, GY - 95,  80, 0, Math.PI * 2); ctx.fill();

  // Ruined buildings (now spanning the wider world)
  BLDGS.forEach(b => {
    ctx.fillStyle = '#090c11';
    ctx.fillRect(b.x, GY - 80 - b.h, b.w, b.h);
    ctx.fillRect(b.x + b.w - 20, GY - 80 - b.h - 14, 20, 14);
    for (let wx = b.x + 8; wx < b.x + b.w - 8; wx += 18)
      for (let wy = GY - 80 - b.h + 12; wy < GY - 90; wy += 22)
        if (Math.sin((b.x + wx) * 0.1 + wy * 0.07) > 0.15) {
          ctx.fillStyle = '#0d1828';
          ctx.fillRect(wx, wy, 10, 12);
        }
  });

  // Back lane strip
  ctx.fillStyle = LANES[2].gshade;
  ctx.fillRect(WX, GY + LANES[2].dy - 4, WORLD_W - WX, 38);
  ctx.strokeStyle = '#1a1810'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(WX, GY + LANES[2].dy); ctx.lineTo(WORLD_W, GY + LANES[2].dy); ctx.stroke();

  // Mid lane strip
  ctx.fillStyle = LANES[1].gshade;
  ctx.fillRect(WX, GY + LANES[1].dy - 4, WORLD_W - WX, 38);
  ctx.strokeStyle = '#201e12';
  ctx.beginPath(); ctx.moveTo(WX, GY + LANES[1].dy); ctx.lineTo(WORLD_W, GY + LANES[1].dy); ctx.stroke();

  // Front lane + full ground
  const gg = ctx.createLinearGradient(0, GY, 0, CH);
  gg.addColorStop(0, C.g1); gg.addColorStop(1, C.g2);
  ctx.fillStyle = gg; ctx.fillRect(0, GY, WORLD_W, CH - GY);
  ctx.strokeStyle = '#2a2716'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(WORLD_W, GY); ctx.stroke();

  // Decorations sit on the ground. Craters and blood draw first
  // (they're below entities), then back-lane scenery (wrecks /
  // rubble / lampposts / signs) so they read as far-background.
  // Only the wall side (x ≥ WX) gets decor — the area left of the
  // wall is Fort Omega's interior and stays clean.
  SIEGE_DECOR.filter(d => d.x > WX && (d.type === 'crater' || d.type === 'blood')).forEach(d => dDecor(ctx, d));
  SIEGE_DECOR.filter(d => d.x > WX && d.type !== 'crater' && d.type !== 'blood').forEach(d => dDecor(ctx, d));

  // Lane labels (faint)
  ctx.fillStyle = 'rgba(80,80,60,0.28)'; ctx.font = '8px monospace';
  ctx.fillText('FRONT', WX + 6, GY + 12);
  ctx.fillText('MID',   WX + 6, GY + LANES[1].dy + 12);
  ctx.fillText('BACK',  WX + 6, GY + LANES[2].dy + 12);
}
