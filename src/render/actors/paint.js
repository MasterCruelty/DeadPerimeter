// ────────────────────────────────────────────────────────────────
// Actor painter: shaded, outlined primitives that can render either
// COLOUR (what the player sees) or NORMALS (surface orientation for the
// HD lighting layer). Characters are built from these primitives by the
// rigs in humanoid.js / zombies.js, rendered once per animation frame
// into a sprite cache, and then blitted with drawImage.
//
// Coordinates are actor-local: origin at the feet, +x = facing
// direction, y down (screen convention).
//
// Normal encoding (normal pass): rgb = n * 0.5 + 0.5 with n in screen
// space (x right, y DOWN, z towards the viewer). A sprite drawn mirrored
// (facing left) needs its x component negated, so every normal-pass
// target carries a `flip` flag.
// ────────────────────────────────────────────────────────────────
import { DPR } from '../../constants.js';

// ── Normal-buffer plumbing ───────────────────────────────────────
// The game loop points this at the HD layer's normal canvas each frame
// (null in classic mode). Sprite blits mirror themselves into it using
// the colour context's current transform.
let NORMAL_CTX = null;
export function setNormalTarget(g) { NORMAL_CTX = g; }
export function normalTarget() { return NORMAL_CTX; }

const enc = (nx, ny, nz) => {
  const l = Math.hypot(nx, ny, nz) || 1;
  return `rgb(${Math.round((nx / l * 0.5 + 0.5) * 255)},${Math.round((ny / l * 0.5 + 0.5) * 255)},${Math.round((nz / l * 0.5 + 0.5) * 255)})`;
};

// ── Colour helpers ───────────────────────────────────────────────
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return c.length === 4
    ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
    : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const cache = new Map();
// shade('#556644', 0.3) → lighter, shade(c, -0.4) → darker.
export function shade(c, k) {
  const key = c + k;
  const hit = cache.get(key); if (hit) return hit;
  const [r, g, b] = hex(c);
  const f = k >= 0 ? (v => v + (255 - v) * k) : (v => v * (1 + k));
  const out = `rgb(${Math.round(f(r))},${Math.round(f(g))},${Math.round(f(b))})`;
  cache.set(key, out);
  return out;
}
export function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  const h = v => Math.round(v).toString(16).padStart(2, '0');
  return '#' + h(A[0] + (B[0] - A[0]) * t) + h(A[1] + (B[1] - A[1]) * t) + h(A[2] + (B[2] - A[2]) * t);
}

const OUTLINE = 'rgba(8,8,6,0.92)';
const OUT_W = 1.0;

// A paint target: { g, normal: bool, flip: bool }
// ── Primitives ───────────────────────────────────────────────────

// Tapered limb from (x1,y1,r1) to (x2,y2,r2) with rounded ends.
function capsulePath(g, x1, y1, r1, x2, y2, r2) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 0.001;
  const ux = dx / len, uy = dy / len;
  const a = Math.atan2(uy, ux);
  g.beginPath();
  g.arc(x2, y2, r2, a - Math.PI / 2, a + Math.PI / 2);
  g.arc(x1, y1, r1, a + Math.PI / 2, a + Math.PI * 1.5);
  g.closePath();
  return { ux, uy };
}

// Gradient across a direction (px,py) through the segment midpoint.
function crossGrad(g, cx, cy, px, py, w, stops) {
  const gr = g.createLinearGradient(cx - px * w, cy - py * w, cx + px * w, cy + py * w);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

// Surface normal across a cylinder whose cross-direction is (px,py).
function cylNormals(px, py, flip) {
  const f = flip ? -1 : 1;
  return [-1, -0.6, 0, 0.6, 1].map((s, i) => {
    const nz = Math.sqrt(Math.max(0.05, 1 - s * s));
    return [i / 4, enc(px * s * f, py * s, nz)];
  });
}

export function limb(T, x1, y1, r1, x2, y2, r2, col, opts = {}) {
  const g = T.g;
  const { ux, uy } = capsulePath(g, x1, y1, r1, x2, y2, r2);
  // Perpendicular pointing "up-ish" so the lit side is consistent.
  let px = -uy, py = ux;
  if (py > 0) { px = -px; py = -py; }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, w = Math.max(r1, r2);
  if (T.normal) {
    g.fillStyle = crossGrad(g, cx, cy, -px, -py, w, cylNormals(-px, -py, T.flip));
    g.fill();
    return;
  }
  if (!opts.noOutline) { g.strokeStyle = OUTLINE; g.lineWidth = OUT_W * 2; g.lineJoin = 'round'; g.stroke(); }
  g.fillStyle = crossGrad(g, cx, cy, px, py, w, [
    [0, shade(col, 0.28)], [0.32, col], [0.78, shade(col, -0.35)], [1, shade(col, -0.55)],
  ]);
  g.fill();
}

// Rounded body (torso / head / belly). rot in radians.
export function blob(T, cx, cy, rx, ry, rot, col, opts = {}) {
  const g = T.g;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2);
  fillShape(T, cx, cy, Math.max(rx, ry), col, opts);
}

// Arbitrary closed polygon / path given as points, shaded like a
// rounded volume (sphere-ish normals around its centre).
export function shape(T, pts, col, opts = {}) {
  const g = T.g;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) g.quadraticCurveTo(p[0], p[1], p[2], p[3]); else g.lineTo(p[0], p[1]);
  }
  g.closePath();
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  pts.forEach(p => { const x = p[p.length - 2], y = p[p.length - 1]; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  fillShape(T, (minX + maxX) / 2, (minY + maxY) / 2, Math.max(maxX - minX, maxY - minY) / 2, col, opts);
}

function fillShape(T, cx, cy, r, col, opts) {
  const g = T.g;
  if (T.normal) {
    if (opts.flat) { g.fillStyle = enc(0, -0.2, 1); g.fill(); return; }
    // Sphere-ish normals: black base, then add R (x), G (y), B (z)
    // gradients with 'lighter' inside the shape's clip.
    g.save(); g.clip();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);
    g.globalCompositeOperation = 'lighter';
    const f = T.flip ? -1 : 1;
    const gx = g.createLinearGradient(cx - r, 0, cx + r, 0);
    gx.addColorStop(0, f > 0 ? 'rgb(20,0,0)' : 'rgb(235,0,0)'); gx.addColorStop(0.5, 'rgb(128,0,0)'); gx.addColorStop(1, f > 0 ? 'rgb(235,0,0)' : 'rgb(20,0,0)');
    g.fillStyle = gx; g.fillRect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);
    const gy = g.createLinearGradient(0, cy - r, 0, cy + r);
    gy.addColorStop(0, 'rgb(0,20,0)'); gy.addColorStop(0.5, 'rgb(0,128,0)'); gy.addColorStop(1, 'rgb(0,235,0)');
    g.fillStyle = gy; g.fillRect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);
    const gz = g.createRadialGradient(cx, cy, 0, cx, cy, r * 1.05);
    gz.addColorStop(0, 'rgb(0,0,255)'); gz.addColorStop(0.7, 'rgb(0,0,205)'); gz.addColorStop(1, 'rgb(0,0,140)');
    g.fillStyle = gz; g.fillRect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);
    g.restore();
    return;
  }
  if (!opts.noOutline) { g.strokeStyle = OUTLINE; g.lineWidth = OUT_W * 2; g.lineJoin = 'round'; g.stroke(); }
  if (opts.flat) { g.fillStyle = col; g.fill(); return; }
  // Soft volume: light from above-front, core shadow low-back.
  const lx = cx + r * 0.25, ly = cy - r * 0.45;
  const gr = g.createRadialGradient(lx, ly, r * 0.1, cx, cy, r * 1.25);
  gr.addColorStop(0, shade(col, 0.22)); gr.addColorStop(0.45, col); gr.addColorStop(1, shade(col, -0.5));
  g.fillStyle = gr; g.fill();
}

// Unshaded detail (stripes, straps, stains, eyes). In the normal pass
// details are skipped unless `normal` is given (keep underlying volume).
export function detail(T, draw, opts = {}) {
  if (T.normal && !opts.normal) return;
  T.g.save(); draw(T.g); T.g.restore();
}

// Re-apply the outline of the current path without fill (for overlaps).
export function line(T, pts, col, w = 1) {
  if (T.normal) return;
  const g = T.g;
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.stroke();
}

// ── Sprite cache ─────────────────────────────────────────────────
// key → { w, h, ox, oy, col, nrm: [unflipped, flipped], hurt }
// Frames are rendered at RES × DPR so they stay crisp after the lane
// scale and the tank / brute up-scaling.
const SPRITES = new Map();
const MAX_SPRITES = 900;

export function sprite(key, box, draw, res = 1.5) {
  let s = SPRITES.get(key);
  if (s) { SPRITES.delete(key); SPRITES.set(key, s); return s; } // LRU touch
  const k = res * DPR;
  const c = document.createElement('canvas');
  c.width = Math.ceil(box.w * k); c.height = Math.ceil(box.h * k);
  const g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, box.ox * k, box.oy * k);
  draw({ g, normal: false, flip: false });
  s = { ...box, k, col: c, nrm: [null, null], hurt: null, draw };
  SPRITES.set(key, s);
  if (SPRITES.size > MAX_SPRITES) SPRITES.delete(SPRITES.keys().next().value);
  return s;
}

function normalFrame(s, flip) {
  const i = flip ? 1 : 0;
  if (s.nrm[i]) return s.nrm[i];
  const c = document.createElement('canvas');
  c.width = s.col.width; c.height = s.col.height;
  const g = c.getContext('2d');
  g.setTransform(s.k, 0, 0, s.k, s.ox * s.k, s.oy * s.k);
  s.draw({ g, normal: true, flip });
  // Keep the colour sprite's silhouette exactly (anti-aliased edges).
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(s.col, 0, 0);
  s.nrm[i] = c;
  return c;
}

function hurtFrame(s) {
  if (s.hurt) return s.hurt;
  const c = document.createElement('canvas');
  c.width = s.col.width; c.height = s.col.height;
  const g = c.getContext('2d');
  g.drawImage(s.col, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#ff3b2a'; g.fillRect(0, 0, c.width, c.height);
  s.hurt = c;
  return c;
}

// Draw a cached frame with its origin at (0,0) of the current transform.
// hurt: 0..1 red flash strength.
export function blit(ctx, s, hurt = 0, alpha = 1) {
  const x = -s.ox, y = -s.oy;
  if (alpha < 1) { ctx.save(); ctx.globalAlpha *= alpha; }
  ctx.drawImage(s.col, x, y, s.w, s.h);
  if (hurt > 0) {
    ctx.save(); ctx.globalAlpha *= Math.min(1, hurt) * 0.45;
    ctx.drawImage(hurtFrame(s), x, y, s.w, s.h);
    ctx.restore();
  }
  if (alpha < 1) ctx.restore();
  if (NORMAL_CTX) {
    const m = ctx.getTransform();
    NORMAL_CTX.save();
    NORMAL_CTX.setTransform(m);
    if (alpha < 1) NORMAL_CTX.globalAlpha = alpha;
    NORMAL_CTX.drawImage(normalFrame(s, m.a < 0), x, y, s.w, s.h);
    NORMAL_CTX.restore();
  }
}

// Draw live (uncached) parts — arms holding a recoiling weapon — into
// both the colour context and, in HD, the normal buffer.
export function live(ctx, draw) {
  draw({ g: ctx, normal: false, flip: false });
  if (NORMAL_CTX) {
    const m = ctx.getTransform();
    NORMAL_CTX.save();
    NORMAL_CTX.setTransform(m);
    draw({ g: NORMAL_CTX, normal: true, flip: m.a < 0 });
    NORMAL_CTX.restore();
  }
}

export function spriteCount() { return SPRITES.size; }
