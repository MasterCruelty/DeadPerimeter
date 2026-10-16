import { C, CW, CH, GY, WX, LANES, WORLD_W, DPR } from '../constants.js';
import { SIEGE_DECOR } from '../data/expeditions.js';

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

// ── Siege backdrop ───────────────────────────────────────────────
// Layered parallax night city. Static layers are rendered once into
// offscreen canvases (at DPR resolution) and blitted every frame, so the
// richer art costs one drawImage per layer instead of hundreds of path
// fills. Animated bits (smoke plumes, fog, embers) are drawn on top.
//
//   layer        parallax   content
//   sky          0.00       gradient, stars, moon, cloud streaks
//   far city     0.22       hazy blue silhouettes, sparse windows
//   mid city     0.50       detailed blocks, rooftop props, lit windows
//   fire plumes  0.50       animated smoke columns over burning blocks
//   ground       1.00       lanes + asphalt texture (world space)
//
// dBg is called inside the world transform (translate(-camX)); each
// layer counter-translates by camX·(1-f) to get its parallax.

const HORIZON = GY - 66;          // where the skyline meets the back lane

// Small deterministic RNG so the city is the same every run.
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mkLayer(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * DPR); c.height = Math.ceil(h * DPR);
  const g = c.getContext('2d');
  g.scale(DPR, DPR);
  draw(g);
  return { c, w, h };
}

// Layer widths so a layer with parallax f still covers the viewport at
// the far end of the world: CW + (WORLD_W - CW) · f.
const layerW = f => Math.ceil(CW + (WORLD_W - CW) * f) + 40;

function drawSky(g) {
  const sg = g.createLinearGradient(0, 0, 0, HORIZON);
  sg.addColorStop(0, '#02040a'); sg.addColorStop(0.55, '#081120'); sg.addColorStop(1, '#16182a');
  g.fillStyle = sg; g.fillRect(0, 0, CW, HORIZON + 2);
  // Burning-city glow on the horizon
  const hg = g.createLinearGradient(0, HORIZON - 120, 0, HORIZON);
  hg.addColorStop(0, 'rgba(120,40,10,0)'); hg.addColorStop(1, 'rgba(150,60,20,0.32)');
  g.fillStyle = hg; g.fillRect(0, HORIZON - 120, CW, 122);
  const r = rng32(7);
  for (let i = 0; i < 140; i++) {
    const x = r() * CW, y = r() * (HORIZON - 90), s = r();
    g.fillStyle = `rgba(${200 + s * 55},${210 + s * 45},255,${0.15 + s * 0.6 * (1 - y / HORIZON)})`;
    g.fillRect(x, y, s > 0.92 ? 1.6 : 0.9, s > 0.92 ? 1.6 : 0.9);
  }
  // Moon with halo and maria
  // Kept clear of the HUD radar strip (top-right).
  const mx = CW * 0.56, my = 112;
  const halo = g.createRadialGradient(mx, my, 10, mx, my, 120);
  halo.addColorStop(0, 'rgba(190,205,255,0.20)'); halo.addColorStop(1, 'rgba(190,205,255,0)');
  g.fillStyle = halo; g.fillRect(mx - 120, my - 120, 240, 240);
  const mg = g.createRadialGradient(mx - 6, my - 6, 2, mx, my, 22);
  mg.addColorStop(0, '#d8d6ca'); mg.addColorStop(1, '#a4a79e');
  g.fillStyle = mg; g.beginPath(); g.arc(mx, my, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(120,124,118,0.35)';
  [[-7, -4, 6], [6, 5, 4], [3, -9, 3], [-4, 9, 3.5]].forEach(([dx, dy, rr]) => { g.beginPath(); g.arc(mx + dx, my + dy, rr, 0, Math.PI * 2); g.fill(); });
  // Thin cloud streaks catching moonlight
  for (let i = 0; i < 7; i++) {
    const cx = r() * CW, cy = 40 + r() * 140, cw = 120 + r() * 260;
    const cg = g.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
    cg.addColorStop(0, 'rgba(60,70,100,0)'); cg.addColorStop(0.5, `rgba(70,80,110,${0.10 + r() * 0.12})`); cg.addColorStop(1, 'rgba(60,70,100,0)');
    g.fillStyle = cg; g.beginPath(); g.ellipse(cx, cy, cw / 2, 3 + r() * 5, 0, 0, Math.PI * 2); g.fill();
  }
}

function drawCity(g, w, seed, opts) {
  const r = rng32(seed);
  let x = -10;
  while (x < w) {
    const bw = opts.minW + r() * (opts.maxW - opts.minW);
    const bh = opts.minH + r() * (opts.maxH - opts.minH);
    const top = HORIZON - bh;
    g.fillStyle = opts.body;
    // Body with an optional setback crown
    g.fillRect(x, top, bw, bh + 2);
    if (r() < 0.4) { const sw = bw * (0.4 + r() * 0.3); g.fillRect(x + (bw - sw) / 2, top - 10 - r() * 18, sw, 30); }
    // Shattered / collapsed roofline
    if (r() < opts.broken) {
      g.fillStyle = opts.sky;
      g.beginPath(); g.moveTo(x + bw * 0.3, top - 1);
      for (let k = 0; k <= 6; k++) g.lineTo(x + bw * (0.3 + k * 0.1), top + (k % 2 ? 6 + r() * 14 : r() * 4));
      g.lineTo(x + bw, top - 1); g.closePath(); g.fill();
      g.fillStyle = opts.body;
    }
    // Rooftop props
    if (r() < 0.35) { // water tower
      const tx = x + 6 + r() * (bw - 20);
      g.fillRect(tx, top - 16, 1.5, 16); g.fillRect(tx + 10, top - 16, 1.5, 16);
      g.beginPath(); g.ellipse(tx + 6, top - 20, 8, 7, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(tx - 3, top - 24); g.lineTo(tx + 6, top - 32); g.lineTo(tx + 15, top - 24); g.fill();
    }
    if (r() < 0.45) { const ax = x + r() * bw; g.fillRect(ax, top - 22 - r() * 26, 1.2, 40); }
    // Edge light (moon rim on the right side)
    g.fillStyle = opts.rim; g.fillRect(x + bw - 1.5, top, 1.5, bh);
    // Windows
    const cols = Math.floor((bw - 8) / opts.winDX), rows = Math.floor((bh - 10) / opts.winDY);
    for (let cx = 0; cx < cols; cx++) for (let ry = 0; ry < rows; ry++) {
      const v = r();
      const wx = x + 5 + cx * opts.winDX, wy = top + 8 + ry * opts.winDY;
      if (v < opts.lit) {
        const warm = r();
        g.fillStyle = warm < 0.7 ? `rgba(255,${170 + warm * 60},${90 + warm * 60},${0.45 + r() * 0.4})` : 'rgba(170,200,255,0.5)';
      } else if (v < opts.lit + 0.35) g.fillStyle = opts.winDark;
      else continue;
      g.fillRect(wx, wy, opts.winW, opts.winH);
    }
    x += bw + r() * opts.gap;
  }
  // Atmospheric haze toward the horizon
  const hz = g.createLinearGradient(0, HORIZON - opts.maxH, 0, HORIZON);
  hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, opts.haze);
  g.fillStyle = hz; g.fillRect(0, HORIZON - opts.maxH - 40, w, opts.maxH + 42);
}

// Burning blocks in mid-city layer space (parallax 0.5). Exported so the
// HD lighting layer can put fire lights exactly under the plumes.
export const CITY_FIRES = [
  { x: 330, y: HORIZON - 70, s: 1.0 },
  { x: 760, y: HORIZON - 40, s: 1.3 },
  { x: 1180, y: HORIZON - 90, s: 0.8 },
];
export const CITY_FIRE_PARALLAX = 0.5;

function drawGround(g) {
  // Back + mid lane strips and the front ground, as before but textured.
  g.fillStyle = '#0d0c08'; g.fillRect(0, HORIZON - 2, WORLD_W, 8);
  g.fillStyle = LANES[2].gshade; g.fillRect(WX, GY + LANES[2].dy - 4, WORLD_W - WX, 38);
  g.fillStyle = LANES[1].gshade; g.fillRect(WX, GY + LANES[1].dy - 4, WORLD_W - WX, 38);
  const gg = g.createLinearGradient(0, GY, 0, CH);
  gg.addColorStop(0, C.g1); gg.addColorStop(1, C.g2);
  g.fillStyle = gg; g.fillRect(0, GY, WORLD_W, CH - GY);
  // Lane edges catch a little light
  g.strokeStyle = 'rgba(120,110,80,0.18)'; g.lineWidth = 1;
  [GY + LANES[2].dy, GY + LANES[1].dy].forEach(y => { g.beginPath(); g.moveTo(WX, y + 0.5); g.lineTo(WORLD_W, y + 0.5); g.stroke(); });
  g.strokeStyle = '#2a2716'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, GY); g.lineTo(WORLD_W, GY); g.stroke();
  // Asphalt grain
  const r = rng32(99);
  for (let i = 0; i < 5200; i++) {
    const x = WX + r() * (WORLD_W - WX), y = HORIZON + r() * (CH - HORIZON);
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.12 + v * 0.2})` : `rgba(140,130,100,${(v - 0.5) * 0.10})`;
    g.fillRect(x, y, 1 + r() * 1.5, 1);
  }
  // Cracks and patches
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.8;
  for (let i = 0; i < 46; i++) {
    let x = WX + r() * (WORLD_W - WX), y = GY + 6 + r() * (CH - GY - 12);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (r() - 0.3) * 22; y += (r() - 0.5) * 8; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '10,10,8' : '40,38,30'},0.35)`;
    g.fillRect(WX + r() * (WORLD_W - WX), GY + 10 + r() * 90, 30 + r() * 60, 6 + r() * 10);
  }
  // Faded centre-line dashes on the front road
  g.fillStyle = 'rgba(190,170,90,0.10)';
  for (let x = WX + 30; x < WORLD_W; x += 70) g.fillRect(x, GY + 64, 34, 3);
  // Puddles that reflect the sky (and, in HD, the lights)
  for (let i = 0; i < 9; i++) {
    const px = WX + 120 + r() * (WORLD_W - WX - 200), py = GY + 20 + r() * 90, pw = 30 + r() * 50;
    const pg = g.createLinearGradient(0, py - 4, 0, py + 4);
    pg.addColorStop(0, 'rgba(60,75,110,0.35)'); pg.addColorStop(1, 'rgba(20,25,40,0.25)');
    g.fillStyle = pg; g.beginPath(); g.ellipse(px, py, pw, 4 + r() * 3, 0, 0, Math.PI * 2); g.fill();
  }
}

let CACHE = null;
function cache() {
  if (CACHE) return CACHE;
  const farW = layerW(0.22), midW = layerW(CITY_FIRE_PARALLAX);
  CACHE = {
    sky: mkLayer(CW, HORIZON + 2, drawSky),
    far: mkLayer(farW, HORIZON + 2, g => drawCity(g, farW, 11, {
      minW: 30, maxW: 70, minH: 90, maxH: 210, gap: 6, broken: 0.25,
      body: '#121a2b', rim: 'rgba(120,140,190,0.10)', sky: '#0d1424',
      winDX: 7, winDY: 9, winW: 3, winH: 4, lit: 0.05, winDark: 'rgba(30,40,60,0.6)',
      haze: 'rgba(40,40,60,0.55)',
    })),
    mid: mkLayer(midW, HORIZON + 2, g => drawCity(g, midW, 23, {
      minW: 46, maxW: 120, minH: 70, maxH: 200, gap: 18, broken: 0.35,
      body: '#090c13', rim: 'rgba(140,160,210,0.16)', sky: '#111a2c',
      winDX: 11, winDY: 13, winW: 5, winH: 7, lit: 0.07, winDark: 'rgba(16,24,40,0.9)',
      haze: 'rgba(60,30,20,0.40)',
    })),
    ground: mkLayer(WORLD_W, CH, drawGround),
  };
  return CACHE;
}

function blit(ctx, L, x) { ctx.drawImage(L.c, x, 0, L.w, L.h); }

function dPlumes(ctx, now) {
  CITY_FIRES.forEach((f, k) => {
    // Fire glow on the rooftop
    const fl = 0.8 + 0.2 * Math.sin(now / 90 + k * 2) * Math.sin(now / 53 + k);
    const gl = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 46 * f.s);
    gl.addColorStop(0, `rgba(255,170,60,${0.75 * fl})`); gl.addColorStop(0.4, `rgba(255,90,20,${0.35 * fl})`); gl.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = gl; ctx.fillRect(f.x - 50 * f.s, f.y - 50 * f.s, 100 * f.s, 100 * f.s);
    // Flame tongues
    for (let j = 0; j < 7; j++) {
      const fx = f.x + (j - 3) * 5 * f.s;
      const h = (12 + 10 * Math.sin(now / 70 + j * 1.7 + k) + (3 - Math.abs(j - 3)) * 5) * f.s;
      const lean = Math.sin(now / 160 + j) * 3 * f.s + h * 0.15;
      const fg = ctx.createLinearGradient(0, f.y, 0, f.y - h);
      fg.addColorStop(0, 'rgba(255,230,140,0.95)'); fg.addColorStop(0.5, 'rgba(255,130,30,0.85)'); fg.addColorStop(1, 'rgba(200,40,10,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(fx - 4.5 * f.s, f.y);
      ctx.quadraticCurveTo(fx - 2 * f.s + lean * 0.4, f.y - h * 0.6, fx + lean, f.y - h);
      ctx.quadraticCurveTo(fx + 2 * f.s + lean * 0.4, f.y - h * 0.5, fx + 4.5 * f.s, f.y);
      ctx.fill();
    }
    // Smoke column: puffs rising, widening, drifting with the wind
    for (let i = 0; i < 14; i++) {
      const t = ((now / 5200) + i / 14 + k * 0.31) % 1;
      const y = f.y - 8 - t * 230 * f.s;
      const x = f.x + t * t * 90 + Math.sin(t * 6 + k + i) * 6;
      const rr = (8 + t * 34) * f.s;
      const a = (1 - t) * 0.32;
      ctx.fillStyle = `rgba(${28 + (1 - t) * 40},${24 + (1 - t) * 14},${26},${a})`;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function dFog(ctx, now) {
  // Slow ground mist banks between the skyline and the lanes.
  for (let i = 0; i < 9; i++) {
    const span = WORLD_W + 400;
    const x = ((i * 271 + now * (0.006 + i * 0.0015)) % span) - 200;
    const y = HORIZON + 6 + (i % 3) * 14;
    const fg = ctx.createRadialGradient(x, y, 4, x, y, 170);
    fg.addColorStop(0, 'rgba(120,130,150,0.10)'); fg.addColorStop(1, 'rgba(120,130,150,0)');
    ctx.fillStyle = fg;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.22); ctx.translate(-x, -y);
    ctx.fillRect(x - 170, y - 170, 340, 340);
    ctx.restore();
  }
}

function dEmbers(ctx, now, camX) {
  // Screen-space ash and embers blowing across the battlefield.
  ctx.save(); ctx.translate(camX, 0);
  for (let i = 0; i < 46; i++) {
    const seed = i * 97.13;
    const t = (now / (7000 + (i % 7) * 900) + (seed % 1)) % 1;
    const x = (CW + 40) * (1 - t) - 20 + Math.sin(t * 9 + i) * 14;
    const y = (i * 53) % (GY + 60) + Math.sin(t * 5 + i * 0.7) * 20 - t * 60;
    const ember = i % 5 === 0;
    ctx.fillStyle = ember ? `rgba(255,${140 + (i % 3) * 30},60,${0.55 + 0.4 * Math.sin(now / 120 + i)})` : 'rgba(150,145,140,0.35)';
    ctx.fillRect(x, y, ember ? 1.6 : 1.2, ember ? 1.6 : 1.2);
  }
  ctx.restore();
}

export function dBg(ctx, camX = 0, now = 0) {
  const C_ = cache();
  ctx.save(); ctx.translate(camX, 0); blit(ctx, C_.sky, 0); ctx.restore();
  ctx.save(); ctx.translate(camX * (1 - 0.22), 0); blit(ctx, C_.far, -20); ctx.restore();
  ctx.save(); ctx.translate(camX * (1 - CITY_FIRE_PARALLAX), 0);
  blit(ctx, C_.mid, -20);
  dPlumes(ctx, now);
  ctx.restore();
  blit(ctx, C_.ground, 0);
  dFog(ctx, now);

  // Decorations sit on the ground. Craters and blood draw first
  // (they're below entities), then back-lane scenery (wrecks /
  // rubble / lampposts / signs) so they read as far-background.
  // Only the wall side (x ≥ WX) gets decor — the area left of the
  // wall is Fort Omega's interior and stays clean.
  SIEGE_DECOR.filter(d => d.x > WX && (d.type === 'crater' || d.type === 'blood')).forEach(d => dDecor(ctx, d));
  SIEGE_DECOR.filter(d => d.x > WX && d.type !== 'crater' && d.type !== 'blood').forEach(d => dDecor(ctx, d));

  dEmbers(ctx, now, camX);

  // Lane labels (faint)
  ctx.fillStyle = 'rgba(80,80,60,0.28)'; ctx.font = '8px monospace';
  ctx.fillText('FRONT', WX + 6, GY + 12);
  ctx.fillText('MID',   WX + 6, GY + LANES[1].dy + 12);
  ctx.fillText('BACK',  WX + 6, GY + LANES[2].dy + 12);
}

// Soft contact shadow under a character's feet. Grounds sprites so they
// stop looking pasted onto the road.
export function dContactShadow(ctx, x, y, sc = 1, w = 16) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, w * sc);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.28); ctx.translate(-x, -y);
  ctx.fillRect(x - w * sc, y - w * sc, w * 2 * sc, w * 2 * sc);
  ctx.restore();
}
