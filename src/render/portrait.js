// Radio portraits: a head-and-shoulders crop of the rigged humanoid
// (actors/humanoid.js), painted once per speaker into a small cached
// canvas. Soldiers get the same look as their body on the field; the
// survivors, Voss and Command have their own. The CRT noise on top is
// drawn live by dPortrait().
import { rigGeom, standPose, fkArm, paintTorso, paintHead, paintArm, humanLook, cap, beanie, helmet, hairCut } from './actors/humanoid.js';
import { actorKind, lookSeed } from './actors/people.js';
import { detail } from './actors/paint.js';
import { DPR } from '../constants.js';

// Actor-local box around head and shoulders (feet at the origin).
const CROP = { x: -12.5, y: -66.5, w: 29, h: 29 };

// Face for the women on the net: lashes, a finer brow, lips.
const femFace = lip => (g, R) => {
  g.fillStyle = '#f0e8dc'; g.beginPath(); g.ellipse(R * 0.52, -1.6, 1.45, 1.1, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a1410'; g.beginPath(); g.arc(R * 0.63, -1.5, 0.75, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#120c08'; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(R * 0.3, -2.6); g.quadraticCurveTo(R * 0.6, -3.1, R * 0.82, -2.4); g.lineTo(R * 0.95, -2.9); g.stroke();
  g.strokeStyle = 'rgba(30,18,10,0.85)'; g.lineWidth = 0.75;
  g.beginPath(); g.moveTo(R * 0.25, -4); g.quadraticCurveTo(R * 0.55, -4.7, R * 0.88, -3.7); g.stroke();
  g.fillStyle = lip; g.beginPath(); g.ellipse(R * 0.8, 3.5, 1.35, 0.7, -0.1, 0, Math.PI * 2); g.fill();
};

// Headset with a boom mic, for the voices on the fort's radio.
const headset = (T, G, hx, hy, R, a) => detail(T, g => {
  g.translate(hx, hy); g.rotate(a);
  g.strokeStyle = '#1a1a1c'; g.lineWidth = 1.3;
  g.beginPath(); g.arc(-1, -0.5, R + 1.2, -Math.PI * 0.95, -Math.PI * 0.35); g.stroke();
  g.fillStyle = '#26282a'; g.beginPath(); g.ellipse(-1.5, 0.5, 2.4, 3.1, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2e3032'; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(-0.5, 2); g.quadraticCurveTo(R * 0.4, 5.5, R * 0.9, 4.4); g.stroke();
  g.fillStyle = '#111'; g.beginPath(); g.arc(R * 0.92, 4.3, 0.9, 0, Math.PI * 2); g.fill();
});
const both = (...hs) => (...args) => hs.forEach(h => h && h(...args));

// Torso extras.
const coat = (g, P) => {
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.8;
  const a = P(5, 4), b = P(1, 21); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  // scrubs under the coat, stethoscope round the neck
  g.fillStyle = '#4a8a8a'; const n = P(2, 21); g.beginPath(); g.moveTo(n[0] - 2, n[1]); g.lineTo(n[0] + 4, n[1]); g.lineTo(n[0] + 1, n[1] + 5); g.fill();
  g.strokeStyle = '#2a2a30'; g.lineWidth = 0.9; const s1 = P(-2, 20), s2 = P(4, 12), s3 = P(6, 19);
  g.beginPath(); g.moveTo(s1[0], s1[1]); g.quadraticCurveTo(s2[0], s2[1], s3[0], s3[1]); g.stroke();
  g.fillStyle = '#9aa0a8'; g.beginPath(); g.arc(s2[0] + 1, s2[1] + 1, 1, 0, Math.PI * 2); g.fill();
};
const overalls = (g, P) => {
  g.fillStyle = '#2e4a6a'; const a = P(-7, 0), b = P(9, 14);
  g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  g.strokeStyle = '#2e4a6a'; g.lineWidth = 1.6; [[-3, 21, -2, 13], [5, 21, 6, 13]].forEach(([v1, u1, v2, u2]) => { const p = P(v1, u1), q = P(v2, u2); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); });
  g.fillStyle = '#c8b040'; [P(-2, 13.5), P(6, 13.5)].forEach(p => g.fillRect(p[0] - 0.8, p[1] - 0.8, 1.6, 1.6));
  g.fillStyle = 'rgba(10,8,6,0.35)'; const o = P(3, 9); g.beginPath(); g.ellipse(o[0], o[1], 2.4, 1.4, 0.4, 0, Math.PI * 2); g.fill();
};
const uniform = (g, P) => {
  g.fillStyle = '#d8c070'; [P(-7, 20), P(6, 20)].forEach(p => g.fillRect(p[0] - 2, p[1] - 0.8, 4, 1.6));
  g.fillStyle = '#b02a20'; const r = P(4, 15); g.fillRect(r[0] - 1.5, r[1] - 1, 3, 1); g.fillStyle = '#3a6ab0'; g.fillRect(r[0] - 1.5, r[1], 3, 1);
};

// NPC looks, built on the shared look table.
const NPC_LOOKS = {
  reyes: () => ({
    ...humanLook('civilian', 11), skin: '#c48b6a', hair: '#1e140c', beard: null, shirt: '#e4e6e2', sleeve: '#e4e6e2', sleeves: 'long', vest: null,
    torsoDetail: coat, eyewear: 'glasses', face: femFace('#8a4a46'), headgear: hairCut('#1e140c', 'long'),
  }),
  hale: () => ({
    ...humanLook('veteran', 4), skin: '#a8724f', hair: '#6a665e', beard: '#8a867c', eyewear: null,
    headgear: both(cap('#3c4430', '#1e2218', { badge: true }), headset),
  }),
  jun: () => ({
    ...humanLook('civilian', 2), skin: '#e0b296', hair: '#141414', beard: null, shirt: '#5a6a7a', sleeve: '#5a6a7a', sleeves: 'short', vest: null,
    torsoDetail: overalls, eyewear: null, headgear: beanie('#a04020'),
  }),
  voss: () => ({
    ...humanLook('guard', 1, { officer: true }), skin: '#6e4630', hair: '#141010', beard: null, mask: null, eyewear: null,
    face: femFace('#5a2a26'), headgear: both(hairCut('#141010', 'long'), cap('#4a4430', '#1a1a14', { badge: true })),
  }),
  command: () => ({
    ...humanLook('police', 3), skin: '#d6a283', hair: '#9a968c', beard: null, shirt: '#24304a', sleeve: '#24304a', patch: '#d8c070',
    torsoDetail: uniform, headgear: both(cap('#1a2236', '#0a0a0a', { badge: true }), headset),
  }),
  // Anyone else on the net: a helmeted radio operator.
  unknown: () => ({ ...humanLook('recruit', 7), mask: null, eyewear: null, headgear: both(helmet('#3a4628'), headset) }),
};

function soldierLook(s) {
  const seed = lookSeed(s);
  const extra = s.jacket || s.colonel ? { ...(s.jacket ? { jacket: s.jacket } : {}), ...(s.colonel ? { officer: true } : {}) } : null;
  return humanLook(actorKind(s), seed, extra);
}

// Cache key + look for a radio "who" ({ soldier } | { npc } | null).
function lookFor(who) {
  if (who && who.soldier) return [`s|${who.soldier.name}|${who.soldier.id}|${actorKind(who.soldier)}`, () => soldierLook(who.soldier)];
  const id = who && who.npc && NPC_LOOKS[who.npc] ? who.npc : 'unknown';
  return [`n|${id}`, NPC_LOOKS[id]];
}

const CACHE = new Map();
// A px × px canvas (device pixels) with the speaker's portrait.
export function portraitCanvas(who, px) {
  const [k0, mk] = lookFor(who);
  const key = `${k0}|${px}`;
  let c = CACHE.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d');
  // Backdrop: dim green radio-screen glow.
  const bg = g.createRadialGradient(px * 0.55, px * 0.35, px * 0.1, px * 0.5, px * 0.5, px * 0.75);
  bg.addColorStop(0, '#1c2c18'); bg.addColorStop(1, '#060a06');
  g.fillStyle = bg; g.fillRect(0, 0, px, px);
  const k = px / CROP.w;
  g.setTransform(k, 0, 0, k, -CROP.x * k, -CROP.y * k);
  const look = mk();
  const G = rigGeom(standPose(0, { lean: 0.03, head: -0.03 }));
  const T = { g, normal: false, flip: false };
  paintArm(T, G, fkArm(G, -0.12, 0.2), look, true);
  paintTorso(T, G, look);
  paintHead(T, G, look);
  paintArm(T, G, fkArm(G, 0.08, 0.25), look, false);
  // Phosphor wash so every face sits on the same screen.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#d6e8cc'; g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = 'source-over';
  if (CACHE.size > 60) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, c);
  return c;
}

// Draw a portrait with live static: scanlines, snow, and a horizontal
// tear for the first moments of a transmission. `age` = ms since the
// line started (Infinity for a still frame).
export function dPortrait(ctx, who, x, y, size, age = Infinity, alpha = 1) {
  const c = portraitCanvas(who, Math.round(size * DPR));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  const tear = age < 260;
  ctx.drawImage(c, x + (tear ? (Math.random() - 0.5) * 4 : 0), y, size, size);
  if (tear) {
    const ty = y + Math.random() * size, th = 3 + Math.random() * 6;
    ctx.drawImage(c, 0, (ty - y) * DPR, c.width, th * DPR, x + (Math.random() - 0.5) * 10, ty, size, th);
  }
  // Scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let sy = y; sy < y + size; sy += 2) ctx.fillRect(x, sy, size, 1);
  // Snow: a few specks, heavier while the channel opens.
  const n = tear ? 60 : 14;
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 200 + 55 | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.18 + Math.random() * 0.3})`;
    ctx.fillRect(x + Math.random() * size, y + Math.random() * size, 1, 1);
  }
  // Rolling bright band
  const by = y + ((performance.now() / 18) % (size + 10)) - 10;
  ctx.fillStyle = 'rgba(180,230,160,0.06)'; ctx.fillRect(x, by, size, 6);
  ctx.restore();
}
