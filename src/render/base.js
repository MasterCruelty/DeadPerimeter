import { C, CH, GY, WX } from '../constants.js';

// Fort Omega — the player's fortified position. Designed to read as
// a hand-built military strongpoint: stacked sandbag base, brick/
// concrete wall body, concertina-wire-topped parapet, a corner
// watchtower with a swinging searchlight, mounted floodlights, a
// reinforced gate panel, and weathering/battle damage.
export function dBase(ctx, hp, mhp) {
  // ── Wall body (back fill — the interior of the fort beyond
  // the rampart, mostly hidden but provides depth)
  const g = ctx.createLinearGradient(0, 0, WX, 0);
  g.addColorStop(0, '#141210'); g.addColorStop(1, '#272219');
  ctx.fillStyle = g;
  ctx.fillRect(0, GY - 160, WX + 12, 160 + (CH - GY));

  // ── Brick/panel courses on the visible face of the wall
  for (let py = GY - 150; py < GY + 15; py += 32) {
    ctx.fillStyle = '#2d2720';
    ctx.fillRect(5, py, WX, 24);
    ctx.strokeStyle = '#181310'; ctx.lineWidth = 1;
    ctx.strokeRect(5, py, WX, 24);
    // Half-brick offset on alternate courses
    const oddCourse = ((py - (GY - 150)) / 32) & 1;
    ctx.strokeStyle = '#1a1612'; ctx.lineWidth = 0.5;
    for (let bx = oddCourse ? 5 : 17; bx < WX; bx += 24) {
      ctx.beginPath(); ctx.moveTo(bx, py); ctx.lineTo(bx, py + 24); ctx.stroke();
    }
  }

  // ── Battle damage: scorch streaks dripping from the parapet
  ctx.fillStyle = 'rgba(20,15,10,0.45)';
  [22, 58, 96, 132].forEach(sx => {
    ctx.beginPath();
    ctx.moveTo(sx - 4, GY - 158);
    ctx.lineTo(sx - 2, GY - 80);
    ctx.lineTo(sx + 4, GY - 60);
    ctx.lineTo(sx + 2, GY - 100);
    ctx.lineTo(sx + 6, GY - 158);
    ctx.closePath(); ctx.fill();
  });

  // ── Loopholes (firing slits) in the lower wall — 4 horizontal slots
  ctx.fillStyle = '#0a0806';
  [38, 70, 102, 134].forEach(sx => {
    ctx.fillRect(sx, GY - 78, 14, 5);
    ctx.fillStyle = '#1a1612'; ctx.fillRect(sx, GY - 75, 14, 1);
    ctx.fillStyle = '#0a0806';
  });

  // ── Reinforced gate panel near the center
  const gx = WX / 2 + 30, gy = GY - 90;
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(gx, gy, 38, 90);
  // Vertical metal bars on the gate
  ctx.fillStyle = '#2a2620';
  for (let bx = gx + 3; bx < gx + 38; bx += 7) {
    ctx.fillRect(bx, gy + 2, 4, 86);
  }
  // Cross-brace
  ctx.fillStyle = '#3a342a';
  ctx.fillRect(gx, gy + 26, 38, 3);
  ctx.fillRect(gx, gy + 56, 38, 3);
  // Hinges
  ctx.fillStyle = '#5a4030';
  ctx.fillRect(gx - 2, gy + 6, 4, 6);
  ctx.fillRect(gx - 2, gy + 72, 4, 6);
  // Padlock
  ctx.fillStyle = '#d4af37';
  ctx.fillRect(gx + 16, gy + 40, 6, 8);
  ctx.beginPath(); ctx.arc(gx + 19, gy + 38, 3, Math.PI, 0); ctx.stroke();

  // ── Sandbag base course at ground level (wider than before, two
  // staggered rows)
  ctx.fillStyle = '#5a4828';
  for (let sx = -8; sx < WX + 100; sx += 22) {
    ctx.beginPath(); ctx.ellipse(sx, GY + 4, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#705836';
  for (let sx = 0; sx < WX + 100; sx += 22) {
    ctx.beginPath(); ctx.ellipse(sx + 11, GY + 12, 12, 7, 0.1, 0, Math.PI * 2); ctx.fill();
  }
  // Sandbag top stripes (highlight)
  ctx.fillStyle = '#8a6c44';
  for (let sx = -8; sx < WX + 100; sx += 22) {
    ctx.fillRect(sx - 7, GY + 1, 14, 2);
  }
  ctx.strokeStyle = '#3a2c18'; ctx.lineWidth = 0.6;
  for (let sx = -8; sx < WX + 100; sx += 22) {
    ctx.beginPath(); ctx.moveTo(sx - 6, GY + 6); ctx.lineTo(sx + 6, GY + 6); ctx.stroke();
  }

  // ── Top beam (the rampart edge)
  ctx.fillStyle = '#37312a';
  ctx.fillRect(0, GY - 160, WX + 12, 8);
  ctx.fillStyle = '#1a1714';
  ctx.fillRect(0, GY - 153, WX + 12, 2);

  // ── Crenellations (parapet blocks)
  for (let bx = 8; bx < WX; bx += 22) {
    ctx.fillStyle = '#1e1a15'; ctx.fillRect(bx, GY - 175, 13, 20);
    ctx.fillStyle = '#2a241e'; ctx.fillRect(bx, GY - 175, 13, 4); // top cap
    ctx.fillStyle = '#0a0806'; ctx.fillRect(bx, GY - 158, 13, 3); // shadow underneath
  }

  // ── Concertina (razor) wire running along the parapet top
  ctx.strokeStyle = '#a09e96'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let wx = 0; wx <= WX; wx += 4) {
    const wy = GY - 182 + Math.sin(wx * 0.18) * 4;
    if (wx === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
  }
  ctx.stroke();
  // Barb spurs along the wire (every ~16 px)
  ctx.strokeStyle = '#c4c0b4'; ctx.lineWidth = 1;
  for (let wx = 6; wx < WX; wx += 16) {
    const wy = GY - 182 + Math.sin(wx * 0.18) * 4;
    ctx.beginPath(); ctx.moveTo(wx, wy - 3); ctx.lineTo(wx, wy + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx - 3, wy); ctx.lineTo(wx + 3, wy); ctx.stroke();
  }

  // ── Bullet holes scattered across the wall
  ctx.strokeStyle = '#484840'; ctx.lineWidth = 1;
  for (let wx = 5; wx < WX; wx += 10) {
    ctx.beginPath(); ctx.arc(wx, GY - 160, 5, 0, Math.PI * 2); ctx.stroke();
  }

  // ── Floodlights mounted on the parapet (3 of them) shining downward
  // toward the killzone outside the wall.
  for (let li = 0; li < 3; li++) {
    const lx = 30 + li * 50;
    const ly = GY - 185;
    // Mount bracket
    ctx.fillStyle = '#0a0806'; ctx.fillRect(lx - 1, ly, 2, 6);
    // Lamp housing (tilted)
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(0.7);
    ctx.fillStyle = '#3a342a';
    ctx.fillRect(-5, -3, 10, 6);
    ctx.fillStyle = '#fff5c4';
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
    // Light cone reaching out into the field
    const lgr = ctx.createLinearGradient(lx + 8, ly + 5, lx + 100, ly + 70);
    lgr.addColorStop(0, 'rgba(255,250,200,0.22)');
    lgr.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = lgr;
    ctx.beginPath();
    ctx.moveTo(lx + 6, ly + 3); ctx.lineTo(lx + 10, ly + 8);
    ctx.lineTo(lx + 130, ly + 80); ctx.lineTo(lx + 116, ly + 60);
    ctx.closePath(); ctx.fill();
  }

  // ── Watchtower on the inner-right edge of the wall
  const tx = WX - 22;
  // Vertical wooden posts
  ctx.fillStyle = '#181410';
  ctx.fillRect(tx - 14, GY - 230, 4, 70);
  ctx.fillRect(tx + 8, GY - 230, 4, 70);
  // Tower cabin
  ctx.fillStyle = '#2a2418';
  ctx.fillRect(tx - 18, GY - 240, 36, 30);
  ctx.fillStyle = '#3a3022';
  ctx.fillRect(tx - 18, GY - 240, 36, 5); // roof rim
  // Roof (pyramid)
  ctx.fillStyle = '#1a1410';
  ctx.beginPath();
  ctx.moveTo(tx - 20, GY - 240);
  ctx.lineTo(tx, GY - 258);
  ctx.lineTo(tx + 20, GY - 240);
  ctx.closePath(); ctx.fill();
  // Window slit on the cabin (lit from inside)
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(tx - 12, GY - 232, 24, 8);
  ctx.fillStyle = 'rgba(255,200,120,0.55)';
  ctx.fillRect(tx - 11, GY - 231, 22, 6);
  // Antenna on top
  ctx.fillStyle = '#181410'; ctx.fillRect(tx - 0.5, GY - 268, 1.5, 12);
  // Red blinker
  ctx.fillStyle = '#cc1818';
  ctx.beginPath(); ctx.arc(tx + 0.5, GY - 268, 1.5, 0, Math.PI * 2); ctx.fill();
  // Cross-braces between the posts
  ctx.strokeStyle = '#181410'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tx - 12, GY - 220); ctx.lineTo(tx + 12, GY - 180); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx + 12, GY - 220); ctx.lineTo(tx - 12, GY - 180); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx - 12, GY - 200); ctx.lineTo(tx + 12, GY - 200); ctx.stroke();
  // Searchlight on the tower side
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(tx + 16, GY - 226, 6, 8);
  ctx.fillStyle = '#fff5c4';
  ctx.fillRect(tx + 18, GY - 225, 4, 6);

  // ── Faded unit insignia: a white outlined star + "Ω" symbol
  ctx.strokeStyle = 'rgba(220,220,210,0.5)'; ctx.lineWidth = 2;
  const insX = 50, insY = GY - 100;
  ctx.save(); ctx.translate(insX, insY);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rr = (i % 2 === 0) ? 14 : 6;
    const px = Math.cos(ang) * rr;
    const py = Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = 'rgba(220,220,210,0.40)';
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  ctx.fillText('Ω', 0, 5);
  ctx.textAlign = 'left'; ctx.restore();

  // ── "FORT OMEGA" name plaque, with rivets at the corners
  ctx.fillStyle = '#15120e';
  ctx.fillRect(14, GY - 135, 126, 26);
  ctx.strokeStyle = '#467822'; ctx.lineWidth = 1;
  ctx.strokeRect(14, GY - 135, 126, 26);
  // Rivets
  ctx.fillStyle = '#3a3022';
  ctx.beginPath(); ctx.arc(20, GY - 130, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(134, GY - 130, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(20, GY - 113, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(134, GY - 113, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace';
  ctx.fillText('✦ FORT OMEGA ✦', 20, GY - 115);

  // ── HP bar on top of the parapet
  const bw = WX + 12, pct = hp / mhp;
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, GY - 195, bw, 5);
  ctx.fillStyle = pct > 0.6 ? C.acc : pct > 0.3 ? C.wrn : C.dng;
  ctx.fillRect(0, GY - 195, bw * pct, 5);
}
