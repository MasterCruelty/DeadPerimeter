// ────────────────────────────────────────────────────────────────
// Humanoid rig: forward kinematics for legs / torso / head, two-bone IK
// for arms, and the part painters shared by soldiers, survivors and
// zombies. Everything is in actor-local space (feet at the origin,
// facing +x, y down); see paint.js for the colour / normal passes.
// ────────────────────────────────────────────────────────────────
import { limb, blob, shape, detail, shade } from './paint.js';

// Body dimensions (logical px at lane scale 1).
export const BODY = {
  thigh: 12, shin: 12, torso: 19, neck: 3, headR: 7.4,
  upper: 10.5, fore: 10, hipW: 5.5, chest: 9,
};

// Hanging-limb direction: θ = 0 points straight down, + swings forward.
const down = t => [Math.sin(t), Math.cos(t)];

// pose = { lean, head, legF: [thigh, knee], legB: [thigh, knee], drop }
export function rigGeom(pose, D = BODY) {
  const [tF, kF] = pose.legF, [tB, kB] = pose.legB;
  const vert = (t, k) => D.thigh * Math.cos(t) + D.shin * Math.cos(t - k);
  const hipY = -Math.max(vert(tF, kF), vert(tB, kB)) + (pose.drop || 0);
  const hip = [pose.hx || 0, hipY];
  const leg = (t, k) => {
    const [ax, ay] = down(t);
    const knee = [hip[0] + ax * D.thigh, hip[1] + ay * D.thigh];
    const [bx, by] = down(t - k);
    const ankle = [knee[0] + bx * D.shin, knee[1] + by * D.shin];
    return { knee, ankle, shin: t - k };
  };
  const lean = pose.lean || 0;
  const up = [Math.sin(lean), -Math.cos(lean)];
  const neck = [hip[0] + up[0] * D.torso, hip[1] + up[1] * D.torso];
  const shoulder = [neck[0] - up[0] * 3 - 1, neck[1] - up[1] * 3];
  const hl = lean + (pose.head || 0);
  const headC = [neck[0] + Math.sin(hl) * (D.neck + D.headR), neck[1] - Math.cos(hl) * (D.neck + D.headR)];
  return { hip, lean, up, neck, shoulder, headC, headAng: hl, legF: leg(tF, kF), legB: leg(tB, kB), D };
}

// Two-bone IK: elbow position so the hand reaches (tx,ty). bend = +1
// bends the elbow downward / backward (natural for arms in side view).
export function ik(sx, sy, tx, ty, l1, l2, bend = 1) {
  let dx = tx - sx, dy = ty - sy;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const base = Math.atan2(dy, dx);
  const ang = base + a * bend;
  const elbow = [sx + Math.cos(ang) * l1, sy + Math.sin(ang) * l1];
  return { elbow, hand: [sx + dx, sy + dy] };
}

// FK arm: shoulder angle (0 = hanging, + forward/up) and elbow bend.
export function fkArm(G, sh, el) {
  const D = G.D;
  const a1 = sh, a2 = sh + el;
  const elbow = [G.shoulder[0] + Math.sin(a1) * D.upper, G.shoulder[1] + Math.cos(a1) * D.upper];
  const hand = [elbow[0] + Math.sin(a2) * D.fore, elbow[1] + Math.cos(a2) * D.fore];
  return { elbow, hand };
}

// ── Part painters ────────────────────────────────────────────────

export function paintLeg(T, G, L, look, back) {
  const pants = back ? shade(look.pants, -0.14) : look.pants;
  const k = look.limbK || 1;
  const shinCol = look.shorts ? (back ? shade(look.skin, -0.14) : look.skin) : pants;
  limb(T, G.hip[0] + (back ? -1 : 1), G.hip[1], 4.4 * k, L.knee[0], L.knee[1], 3.5 * k, pants);
  if (look.ripPants && !back) {
    detail(T, g => { g.fillStyle = look.skin; g.beginPath(); g.ellipse(L.knee[0] + 0.5, L.knee[1] + 1, 2, 2.6, 0.3, 0, Math.PI * 2); g.fill(); });
  }
  limb(T, L.knee[0], L.knee[1], 3.3 * k, L.ankle[0], L.ankle[1], 2.6 * k, shinCol);
  if (look.kneePad && !back) blob(T, L.knee[0] + 1.2, L.knee[1], 2.6, 2.9, 0, look.kneePad);
  // Footwear: points along the foot direction (perpendicular to shin).
  const s = L.shin, fx = Math.cos(s), fy = -Math.sin(s);
  const a = L.ankle;
  const toe = [a[0] + fx * 8.5, a[1] + fy * 8.5];
  const heel = [a[0] - fx * 3, a[1] - fy * 3];
  const nx = -fy, ny = fx; // sole normal (down)
  const boot = back ? shade(look.boots, -0.2) : look.boots;
  if (look.barefoot) {
    shape(T, [[heel[0] - nx * 2, heel[1] - ny * 2], [a[0] - nx * 3, a[1] - ny * 3], [toe[0] - nx * 1, toe[1] - ny * 1],
      [toe[0] + nx * 1.4, toe[1] + ny * 1.4], [heel[0] + nx * 1.6, heel[1] + ny * 1.6]], back ? shade(look.skin, -0.25) : look.skin);
    return;
  }
  shape(T, [[heel[0] - nx * 3, heel[1] - ny * 3], [a[0] + fx * 2 - nx * 4.2, a[1] + fy * 2 - ny * 4.2],
    [toe[0] - nx * 2, toe[1] - ny * 2], [toe[0] + fx * 1 + nx * 0.5, toe[1] + fy * 1 + ny * 0.5, toe[0] + nx * 1.8, toe[1] + ny * 1.8],
    [heel[0] + nx * 1.8, heel[1] + ny * 1.8]], boot);
  detail(T, g => { g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.moveTo(heel[0] + nx * 1.8, heel[1] + ny * 1.8); g.lineTo(toe[0] + nx * 1.8, toe[1] + ny * 1.8); g.lineTo(toe[0] + nx * 0.6, toe[1] + ny * 0.6); g.lineTo(heel[0] + nx * 0.6, heel[1] + ny * 0.6); g.fill(); });
}

// Torso outline points in torso space (v = forward, u = up).
function torsoPts(G, look) {
  const { hip, up } = G;
  const fw = [-up[1], up[0]]; // forward perpendicular to the spine
  const P = (v, u) => [hip[0] + fw[0] * v + up[0] * u, hip[1] + fw[1] * v + up[1] * u];
  const belly = look.belly || 0, chest = look.chestOut || 0, bulk = look.bulk || 0;
  return {
    P,
    pts: [
      P(-6 - bulk, 1), P(6 + belly * 0.4, 1),
      [...P(9 + belly, 6), ...P(8 + chest, 11)].slice(0, 4),
      P(7 + chest + bulk * 0.5, 16), [...P(7 + bulk, 21), ...P(3, 21.5)].slice(0, 4),
      P(-6 - bulk, 21), [...P(-9 - bulk, 16), ...P(-8 - bulk, 9)].slice(0, 4),
    ],
  };
}

export function paintTorso(T, G, look) {
  const { P, pts } = torsoPts(G, look);
  shape(T, pts, look.shirt);
  // Clothing details clipped to the torso silhouette.
  detail(T, g => {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.length === 4) g.quadraticCurveTo(p[0], p[1], p[2], p[3]); else g.lineTo(p[0], p[1]); }
    g.closePath(); g.clip();
    if (look.torsoDetail) look.torsoDetail(g, P, G);
  });
  if (look.vest) {
    // Plate carrier: front + back panels, pouches, shoulder strap.
    shape(T, [P(-7.5, 7), P(8.5 + (look.chestOut || 0), 7), P(8 + (look.chestOut || 0), 19), P(3, 20.5), P(-7, 20)], look.vest);
    detail(T, g => {
      g.fillStyle = shade(look.vest, -0.3);
      [[1.5, 8.2], [5.2, 8.2]].forEach(([v, u]) => {
        const a = P(v, u), b = P(v + 3.2, u + 5.2);
        g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]) + 0.5, Math.abs(b[1] - a[1]) + 0.5);
      });
      g.strokeStyle = shade(look.vest, -0.45); g.lineWidth = 0.8;
      const s1 = P(-5, 20), s2 = P(-3, 7); g.beginPath(); g.moveTo(s1[0], s1[1]); g.lineTo(s2[0], s2[1]); g.stroke();
      // Molle stitching
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let u = 9; u < 19; u += 2.5) { const a = P(-6, u), b = P(7, u); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      if (look.patch) { const c = P(-4, 15); g.fillStyle = look.patch; g.fillRect(c[0] - 1.5, c[1] - 1.5, 3, 3); }
    });
  }
  if (look.belt) {
    const a = P(-6.5, 1.5), b = P(7, 1.5), c = P(7, 4), d = P(-6.5, 4);
    shape(T, [a, b, c, d], look.belt, { flat: true });
    detail(T, g => { const k = P(5, 2.75); g.fillStyle = '#8a7a50'; g.fillRect(k[0] - 1, k[1] - 1, 2, 2); });
  }
}

// Head: neck, skull, face, then headgear from the look.
export function paintHead(T, G, look, expr = {}) {
  const [hx, hy] = G.headC, R = G.D.headR, a = G.headAng;
  limb(T, G.neck[0], G.neck[1] + 1, 2.6, hx - Math.sin(a) * R * 0.6, hy + Math.cos(a) * R * 0.6, 2.4, look.neckCol || look.skin);
  const skull = look.skullShape || [R * 0.95, R * 1.08];
  blob(T, hx, hy, skull[0], skull[1], a, look.skin);
  // Face (forward = +x, rotated with head tilt)
  detail(T, g => {
    g.translate(hx, hy); g.rotate(a);
    // jaw / chin shadow
    g.fillStyle = shade(look.skin, -0.35);
    g.beginPath(); g.ellipse(2.5, 5.5, 4.2, 2, 0.15, 0, Math.PI * 2); g.fill();
    // nose
    g.fillStyle = shade(look.skin, -0.12);
    g.beginPath(); g.moveTo(R * 0.85, -1.5); g.lineTo(R + 1.6, 1.4); g.lineTo(R * 0.85, 2.2); g.fill();
    // ear
    g.fillStyle = shade(look.skin, -0.25);
    g.beginPath(); g.ellipse(-1.5, 0.5, 1.6, 2.4, 0, 0, Math.PI * 2); g.fill();
    if (look.face) look.face(g, R, expr);
    else {
      // eye + brow
      g.fillStyle = '#f0e8dc'; g.beginPath(); g.ellipse(R * 0.52, -1.6, 1.4, 1.1, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1a1410'; g.beginPath(); g.arc(R * 0.62, -1.5, 0.75, 0, Math.PI * 2); g.fill();
      g.strokeStyle = shade(look.hair || '#2a1a10', -0.2); g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(R * 0.25, -3.6); g.lineTo(R * 0.85, -3.2); g.stroke();
      // mouth
      g.strokeStyle = shade(look.skin, -0.45); g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(R * 0.55, 3.6); g.lineTo(R * 0.9, 3.4); g.stroke();
      if (look.beard) {
        g.fillStyle = look.beard;
        g.beginPath(); g.moveTo(-0.5, 1.5); g.quadraticCurveTo(R * 0.2, 7.5, R * 0.95, 4.6); g.lineTo(R * 0.95, 3.6); g.quadraticCurveTo(R * 0.4, 5, 0, 1); g.fill();
      }
    }
    // Lower-face mask (balaclava / bandana / shemagh)
    if (look.mask) {
      g.fillStyle = look.mask;
      g.beginPath(); g.moveTo(-R * 0.6, 0.2); g.lineTo(R + 1.4, 0); g.lineTo(R + 0.6, 4.2); g.quadraticCurveTo(R * 0.5, 7.4, -R * 0.2, 6.4); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(R * 0.1, 2.4); g.lineTo(R + 0.8, 2.2); g.stroke();
    }
    // Glasses / sunglasses / ski goggles
    if (look.eyewear) {
      const dark = look.eyewear === 'shades';
      g.fillStyle = dark ? '#0c0c10' : 'rgba(170,200,220,0.35)';
      g.fillRect(R * 0.22, -2.9, R * 0.8, 2.4);
      g.strokeStyle = dark ? '#0c0c10' : '#2a2420'; g.lineWidth = 0.7;
      g.strokeRect(R * 0.22, -2.9, R * 0.8, 2.4);
      g.beginPath(); g.moveTo(R * 0.22, -1.8); g.lineTo(-1.2, -1.2); g.stroke();
      if (dark) { g.fillStyle = 'rgba(160,190,220,0.5)'; g.fillRect(R * 0.5, -2.6, R * 0.2, 0.7); }
    }
  });
  if (look.headgear) look.headgear(T, G, hx, hy, R, a);
}

export function paintArm(T, G, arm, look, back, opts = {}) {
  const sleeve = back ? shade(look.sleeve || look.shirt, -0.16) : (look.sleeve || look.shirt);
  const skin = back ? shade(look.skin, -0.2) : look.skin;
  const [sx, sy] = G.shoulder;
  const longSleeve = look.sleeves !== 'none';
  const k = look.limbK || 1;
  limb(T, sx, sy, 2.9 * k, arm.elbow[0], arm.elbow[1], 2.5 * k, longSleeve ? sleeve : skin);
  if (look.armband && longSleeve) {
    const at = f => [sx + (arm.elbow[0] - sx) * f, sy + (arm.elbow[1] - sy) * f];
    const a0 = at(0.32), a1 = at(0.5);
    limb(T, a0[0], a0[1], 3.05 * k, a1[0], a1[1], 2.85 * k, back ? shade(look.armband, -0.2) : look.armband);
  }
  const foreCol = look.sleeves === 'long' ? sleeve : skin;
  limb(T, arm.elbow[0], arm.elbow[1], 2.4 * k, arm.hand[0], arm.hand[1], 2.0 * k, foreCol);
  const handCol = look.gloves ? (back ? shade(look.gloves, -0.2) : look.gloves) : skin;
  if (opts.claw) {
    // Clawed, splayed zombie hand
    const [hx, hy] = arm.hand;
    const d = Math.atan2(arm.hand[1] - arm.elbow[1], arm.hand[0] - arm.elbow[0]);
    blob(T, hx, hy, 2.6 * k, 2.2 * k, d, handCol);
    detail(T, g => {
      g.strokeStyle = shade(handCol, -0.35); g.lineWidth = 1; g.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const fa = d + i * 0.45;
        g.beginPath(); g.moveTo(hx + Math.cos(fa) * 2, hy + Math.sin(fa) * 2);
        g.lineTo(hx + Math.cos(fa) * 5.2, hy + Math.sin(fa) * 5.2 + 0.8); g.stroke();
      }
    });
  } else {
    blob(T, arm.hand[0], arm.hand[1], 2.2, 2.0, 0, handCol);
  }
}

// ── Looks ────────────────────────────────────────────────────────
// Deterministic small hash so a given name always gets the same face.
export function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) & 0x7fffffff;   // |-2^31| would stay negative in bit ops
}

const SKINS = ['#d6a283', '#c48b6a', '#a8724f', '#8a5a3c', '#6e4630', '#e0b296'];
const HAIRS = ['#1e140c', '#3a2414', '#5a3a1e', '#141414', '#7a5a34'];
const CAMO = ['#4b5a3a', '#55603f', '#465436', '#5a5a42', '#6a5e44', '#4a5048', '#5e5236'];
const DESERT = ['#9a8460', '#a08a62', '#8a7a58'];
const CIV_TOPS = ['#6a4430', '#3c4e6a', '#5a5a3a', '#6a2e2e', '#2e4a3a', '#7a6a4a', '#4a3a5a', '#8a8070', '#2a2a30', '#9a5a2a', '#506a7a', '#7a3a4a'];
const CIV_PANTS = ['#33415a', '#2a3448', '#4a4232', '#22222a', '#5a5048', '#3a2e24'];

function camo(base) {
  return (g, P) => {
    const spots = [[-4, 4, 3], [3, 9, 2.6], [-2, 15, 3.2], [5, 17, 2], [-6, 11, 2.4], [1, 3, 2]];
    spots.forEach(([v, u, r], i) => {
      const c = P(v, u);
      g.fillStyle = i % 2 ? shade(base, -0.28) : shade(base, 0.12);
      g.beginPath(); g.ellipse(c[0], c[1], r * 1.3, r * 0.8, i, 0, Math.PI * 2); g.fill();
    });
  };
}

function helmet(col, opts = {}) {
  return (T, G, hx, hy, R, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    // Dome that stops above the brow, with a short front lip.
    shape(T, [L(-R - 1.4, 0.5), [...L(-R - 1.4, -R - 2.2), ...L(0.5, -R - 2.6)].slice(0, 4), [...L(R + 2, -R - 1.4), ...L(R + 1.6, -3.4)].slice(0, 4),
      L(R + 2.8, -2.8), L(R * 0.2, -3.2), L(-R * 0.5, -1.2), L(-R - 1.8, 1.2)], col);
    detail(T, g => {
      g.translate(hx, hy); g.rotate(a);
      // helmet band + cover texture
      g.fillStyle = shade(col, -0.35); g.beginPath(); g.moveTo(-R - 1.2, -2.2); g.lineTo(R + 1.6, -4.6); g.lineTo(R + 1.6, -3.4); g.lineTo(-R - 1.4, -0.6); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 0.6;
      for (let i = -R; i < R; i += 2.4) { g.beginPath(); g.moveTo(i, -R - 1.5); g.lineTo(i + 2, -4); g.stroke(); }
      // chin strap
      g.strokeStyle = '#141210'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(-1, 0.5); g.quadraticCurveTo(2, 7, 4.5, 6); g.stroke();
      if (opts.nvg) { g.fillStyle = '#16181a'; g.fillRect(R - 1, -R + 0.5, 3.5, 2.5); }
      if (opts.goggles) {
        g.fillStyle = '#22262a'; g.fillRect(-R + 1, -R - 1.2, R * 1.7, 2.2);
        g.fillStyle = 'rgba(120,180,200,0.6)'; g.fillRect(R * 0.15, -R - 0.9, R * 0.55, 1.6);
      }
    });
  };
}

function cap(col, visor = '#1a1a1a', opts = {}) {
  return (T, G, hx, hy, R, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    shape(T, [L(-R - 0.5, -1.5), [...L(-R, -R - 1.5), ...L(1, -R - 2)].slice(0, 4), [...L(R + 1, -R - 1), ...L(R + 0.8, -2)].slice(0, 4), L(-R - 0.5, -1.5)], col);
    shape(T, [L(R * 0.2, -3.2), L(R + 6.5, -2.2), L(R + 6.2, -0.9), L(R * 0.2, -1.6)], visor);
    if (opts.badge) detail(T, g => { g.translate(hx, hy); g.rotate(a); g.fillStyle = '#dfb84a'; g.beginPath(); g.ellipse(R * 0.6, -R * 0.75, 1.4, 1.8, 0, 0, Math.PI * 2); g.fill(); });
  };
}

function boonie(col) {
  return (T, G, hx, hy, R, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    shape(T, [L(-R - 0.5, -2), [...L(-R + 1, -R - 2.5), ...L(1, -R - 3)].slice(0, 4), [...L(R, -R - 2), ...L(R, -2)].slice(0, 4)], col);
    shape(T, [L(-R - 4.5, -0.4), L(R + 4.8, -1.4), L(R + 4.2, 0.6), L(-R - 4.2, 1.3)], shade(col, -0.1));
  };
}

function beanie(col) {
  return (T, G, hx, hy, R, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    shape(T, [L(-R - 0.8, -0.5), [...L(-R, -R - 3), ...L(0.5, -R - 3.5)].slice(0, 4), [...L(R + 0.8, -R - 2), ...L(R + 0.8, -2)].slice(0, 4)], col);
    detail(T, g => { g.translate(hx, hy); g.rotate(a); g.fillStyle = shade(col, -0.3); g.fillRect(-R - 0.8, -3.2, 2 * R + 1.6, 1.8); });
  };
}

function hood(col) {
  return (T, G, hx, hy, R, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    shape(T, [L(-R - 2.5, 6), [...L(-R - 3, -R - 2), ...L(0, -R - 3)].slice(0, 4), [...L(R + 1.5, -R - 1), ...L(R + 1, -1)].slice(0, 4),
      L(R * 0.2, -R * 0.4), L(-R * 0.3, 4), L(-R - 1, 7)], col);
  };
}

function hairCut(col, style) {
  return (T, G, hx, hy, R, a) => {
    if (style === 'bald') return;
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    if (style === 'long') {
      shape(T, [L(-R - 1.2, 5), [...L(-R - 1.5, -R - 1), ...L(1, -R - 1.6)].slice(0, 4), L(R * 0.8, -R * 0.6), L(R * 0.1, -R * 0.55), L(-R * 0.4, 3), L(-R + 0.5, 6.5)], col);
    } else {
      shape(T, [L(-R - 0.5, 0.5), [...L(-R - 0.8, -R - 0.6), ...L(1, -R - 1.4)].slice(0, 4), L(R * 0.75, -R * 0.65), L(R * 0.1, -R * 0.62), L(-R * 0.5, -1)], col);
    }
  };
}

// Headgear builders, shared with the zombie looks.
export { helmet, cap, beanie };

// The look table. `kind` comes from the actor; `seed` picks variants.
export function humanLook(kind, seed = 0, extra) {
  extra = extra || {};
  const skin = SKINS[seed % SKINS.length];
  const hair = HAIRS[(seed >> 3) % HAIRS.length];
  const beard = ((seed >> 6) & 3) === 1 ? hair : null;
  const base = { skin, hair, beard, boots: '#1d1712', belt: '#221a12' };
  switch (kind) {
    case 'veteran': {
      const shirt = CAMO[(seed >> 2) % CAMO.length], hv = (seed >> 7) % 4;
      return { ...base, beard: beard || hair, shirt, sleeve: shirt, sleeves: (seed >> 9) & 1 ? 'short' : 'long', pants: shade(shirt, -0.12), vest: ['#7a6a48', '#5a5a44', '#3a3a32'][(seed >> 5) % 3], kneePad: '#2a2a24', gloves: '#3a3226',
        torsoDetail: camo(shirt), patch: '#c8b040', eyewear: ((seed >> 11) & 3) === 0 ? 'shades' : null,
        headgear: hv === 0 ? boonie('#6a6648') : hv === 1 ? cap('#4a4a36', '#2a2a20') : hv === 2 ? beanie('#3a3a2e') : boonie('#5a5a48') };
    }
    case 'civilian': {
      const top = CIV_TOPS[(seed >> 2) % CIV_TOPS.length], hg = (seed >> 4) % 7, style = (seed >> 8) % 5;
      const torso = (g, P) => {
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.8; const a = P(5, 2), b = P(4, 20); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        if (style === 1) { g.fillStyle = '#d8d8c8'; const t = P(4, 20); g.fillRect(t[0] - 1, t[1] - 5, 2, 5); }                        // collar / tie
        if (style === 2) { g.fillStyle = 'rgba(230,220,200,0.85)'; const a2 = P(-6, 0), b2 = P(8, 14); g.fillRect(Math.min(a2[0], b2[0]), Math.min(a2[1], b2[1]), Math.abs(b2[0] - a2[0]), Math.abs(b2[1] - a2[1])); }  // apron
        if (style === 3) { g.strokeStyle = '#e0d040'; g.lineWidth = 1.6; [6, 14].forEach(u => { const a3 = P(-9, u), b3 = P(10, u); g.beginPath(); g.moveTo(a3[0], a3[1]); g.lineTo(b3[0], b3[1]); g.stroke(); }); }  // hi-vis stripes
        if (style === 4) { g.fillStyle = shade(top, 0.25); const s1 = P(2, 19), s2 = P(9, 15); g.fillRect(Math.min(s1[0], s2[0]), Math.min(s1[1], s2[1]), 4, 4); }   // scarf knot
      };
      return { ...base, shirt: style === 3 ? '#d86a1a' : top, sleeves: (seed >> 6) & 1 ? 'short' : 'long', pants: CIV_PANTS[(seed >> 9) % CIV_PANTS.length], boots: ['#2a2018', '#1a1a1a', '#4a3a2a'][(seed >> 12) % 3],
        vest: style === 0 && (seed & 8) ? shade(top, -0.3) : null, torsoDetail: torso,
        eyewear: ((seed >> 10) & 7) === 0 ? 'glasses' : null,
        headgear: hg === 0 ? cap(['#a04020', '#20406a', '#2a2a2a', '#6a6a2a'][(seed >> 13) % 4], '#1a1a1a')
          : hg === 1 ? beanie(['#5a2a2a', '#2a3a5a', '#3a3a3a'][(seed >> 13) % 3])
          : hg === 2 ? hood(shade(top, -0.15))
          : hairCut(hair, hg === 3 ? 'long' : hg === 4 && (seed & 32) ? 'bald' : 'short') };
    }
    case 'bandit':
      return { ...base, shirt: ['#3a2424', '#2a2a2e', '#3a3226', '#24303a'][(seed >> 2) % 4], sleeves: 'long', pants: '#1f1f24', gloves: '#141414',
        vest: (seed >> 5) & 1 ? '#2a2018' : null,
        headgear: [beanie('#161616'), hood('#262626'), beanie('#3a1414'), cap('#141414', '#0a0a0a')][(seed >> 6) % 4],
        face: (g, R) => {
          g.fillStyle = '#f0e8dc'; g.beginPath(); g.ellipse(R * 0.52, -1.6, 1.3, 1, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#100808'; g.beginPath(); g.arc(R * 0.62, -1.5, 0.7, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#7a1818'; g.beginPath(); g.moveTo(-R * 0.3, 0.6); g.lineTo(R + 1.6, 0.4); g.lineTo(R * 0.7, 6.5); g.lineTo(-R * 0.2, 6); g.fill();
        },
        torsoDetail: (g, P) => { g.fillStyle = 'rgba(0,0,0,0.25)'; const a = P(1, 3); g.fillRect(a[0] - 1, a[1] - 16, 1.4, 16); } };
    case 'police':
      return { ...base, shirt: '#1d2a44', sleeves: 'long', pants: '#1a1c24', belt: '#0e0e10', boots: '#0e0e10', patch: '#dfb84a',
        torsoDetail: (g, P) => { const b = P(4, 15); g.fillStyle = '#dfb84a'; g.beginPath(); g.arc(b[0], b[1], 1.3, 0, Math.PI * 2); g.fill(); },
        headgear: cap('#121a2a', '#050505', { badge: true }) };
    case 'guard': {
      // Northgate Compact: Guard deserters in desert camo with a gold
      // armband; the colonel wears an officer's cap.
      const shirt = DESERT[(seed >> 2) % DESERT.length];
      return { ...base, shirt, sleeve: shirt, sleeves: 'long', pants: shade(shirt, -0.12), vest: ['#6a5a3a', '#4a4232', '#5a5040'][(seed >> 5) % 3], kneePad: '#3a3226', gloves: '#3a3022',
        torsoDetail: camo(shirt), armband: '#d8b060', patch: '#d8b060', mask: ((seed >> 7) & 3) === 0 ? '#8a7a5a' : null,
        headgear: extra.officer ? cap('#4a4430', '#1a1a14', { badge: true }) : (seed >> 9) & 1 ? helmet('#7a6a48', { goggles: ((seed >> 10) & 1) === 1 }) : cap('#7a6a48', '#3a3226') };
    }
    case 'swat':
      return { ...base, shirt: '#1a1c22', sleeves: 'long', pants: '#16181e', vest: '#0f1014', gloves: '#0c0c0c', kneePad: '#0c0c0e', boots: '#0c0c0c',
        headgear: helmet('#121418', { goggles: true }) };
    case 'knifeman':
      return { ...base, shirt: extra.color || '#7a5a3a', sleeves: 'long', pants: '#1a2238', boots: '#0a0a0a', headgear: hood(shade(extra.color || '#7a5a3a', -0.15)),
        torsoDetail: (g, P) => { g.fillStyle = 'rgba(0,0,0,0.22)'; const a = P(-2, 6), b = P(6, 11); g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); } };
    case 'gunman':
      return { ...base, shirt: extra.color || '#3a4858', sleeves: 'long', pants: '#22242a', boots: '#0e0e0e', gloves: '#1a1a1a',
        headgear: cap(extra.cap || '#1f1f1f', '#0e0e0e') };
    default: { // recruit
      const shirt = extra.jacket || CAMO[(seed >> 2) % CAMO.length];
      const hv = (seed >> 7) % 10;
      const lid = extra.helmet || ['#3a4628', '#4a4a34', '#2e3626'][(seed >> 11) % 3];
      return { ...base, shirt, sleeve: shirt, sleeves: ((seed >> 9) & 3) === 0 ? 'short' : 'long', pants: shade(shirt, -0.15),
        vest: ['#3e4632', '#4a4430', '#2a2c26'][(seed >> 13) % 3], kneePad: '#2a3022', gloves: (seed >> 10) & 1 ? '#262a20' : null,
        torsoDetail: camo(shirt), patch: '#6a8a40', mask: ((seed >> 14) & 7) === 0 ? '#2a2a26' : null,
        eyewear: ((seed >> 15) & 7) === 1 ? 'shades' : null,
        headgear: hv < 6 ? helmet(lid, { nvg: ((seed >> 5) & 3) === 0, goggles: ((seed >> 5) & 3) === 1 })
          : hv === 6 ? boonie('#5a5e40') : hv === 7 ? cap(shade(shirt, -0.2), '#1a1a14') : hv === 8 ? beanie('#2a2e24') : hairCut(hair, 'short') };
    }
  }
}

// ── Poses ────────────────────────────────────────────────────────
// Walk cycle sampled at phase p ∈ [0, 1).
export function walkPose(p, o = {}) {
  const w = p * Math.PI * 2;
  const stride = o.stride ?? 0.5;
  const tF = Math.sin(w) * stride, tB = -Math.sin(w) * stride;
  const kF = Math.max(0, Math.sin(w + 1.6)) * (o.knee ?? 0.9) + 0.08;
  const kB = Math.max(0, Math.sin(w + 1.6 + Math.PI)) * (o.knee ?? 0.9) + 0.08;
  return {
    lean: (o.lean ?? 0.06) + Math.sin(w * 2) * 0.02,
    head: o.head ?? 0,
    legF: [tF, kF], legB: [tB, kB],
    drop: Math.abs(Math.cos(w)) * -1.2 + 1.2,
    swing: Math.sin(w),
  };
}

export function standPose(p = 0, o = {}) {
  const b = Math.sin(p * Math.PI * 2);
  return {
    lean: (o.lean ?? 0.07) + b * 0.012,
    head: (o.head ?? 0) + b * 0.02,
    legF: o.legF || [0.34, 0.42], legB: o.legB || [-0.3, 0.1],
    drop: 0.4 + b * 0.4,
    swing: 0,
  };
}

// Kneeling firing position (rooftop sniper behind sandbags).
export function kneelPose(p = 0) {
  const b = Math.sin(p * Math.PI * 2);
  return { lean: 0.16 + b * 0.01, head: 0.05, legF: [1.25, 1.35], legB: [0.12, 1.62], drop: 0.3 + b * 0.3, swing: 0 };
}

// Relaxed pose used for corpses (rendered rotated onto the ground).
export function corpsePose() {
  // Rotated -90° onto the ground: anything swung forward would stick
  // up in the air, so limbs stay close to the body axis.
  return { lean: 0, head: 0.12, legF: [0.1, 0.16], legB: [-0.06, 0.04], drop: 0, swing: 0 };
}
