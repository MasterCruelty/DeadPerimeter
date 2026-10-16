// ────────────────────────────────────────────────────────────────
// Zombie actors. Same humanoid rig as the survivors, with rotting
// skin, torn clothes, glowing eyes, slack jaws, and per-type builds:
//
//   walker   six outfits (tee, plaid, work shirt, scrubs, suit, hoodie)
//   runner   wiry, tank top + shorts, sprinting lean
//   spitter  hunched, swollen glowing acid sac on the throat
//   tank     hulking, torn firefighter coat (scaled ×1.35 by the caller)
//   brute    shirtless mass of muscle and bone spurs (×1.7 by the caller)
//
// Whole poses (arms included) are cached as sprite frames.
// ────────────────────────────────────────────────────────────────
import { sprite, blit, blob, shape, detail, mix } from './paint.js';
import {
  rigGeom, fkArm, paintLeg, paintTorso, paintHead, paintArm,
  walkPose, standPose, corpsePose, hashOf,
} from './humanoid.js';

const BOX = { w: 80, h: 80, ox: 34, oy: 76 };
const BOX_DEAD = { w: 100, h: 36, ox: 78, oy: 26 };
const FR = { walk: 10, attack: 6, idle: 4 };

// ── Faces ────────────────────────────────────────────────────────
function zombieFace(eye = '#ff3a1c') {
  return (g, R, expr) => {
    // sunken socket + glowing pupil (emissive in HD)
    g.fillStyle = 'rgba(20,6,6,0.85)';
    g.beginPath(); g.ellipse(R * 0.5, -1.6, 2.3, 1.9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = eye; g.beginPath(); g.arc(R * 0.6, -1.5, 1.05, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,240,200,0.9)'; g.fillRect(R * 0.62, -2.1, 0.6, 0.6);
    // rotted nose hole
    g.fillStyle = '#1a0a08'; g.beginPath(); g.ellipse(R * 0.95, 0.8, 0.9, 1.2, 0, 0, Math.PI * 2); g.fill();
    // slack jaw with teeth
    const open = expr.open ?? 0.4;
    g.fillStyle = '#1a0606';
    g.beginPath(); g.moveTo(R * 0.2, 2.6); g.lineTo(R + 0.6, 2.4); g.lineTo(R * 0.85, 3 + open * 4); g.lineTo(R * 0.25, 3.4 + open * 3); g.fill();
    g.fillStyle = '#d8ccae';
    for (let i = 0; i < 3; i++) g.fillRect(R * 0.35 + i * 1.5, 2.6, 0.9, 1.1);
    for (let i = 0; i < 2; i++) g.fillRect(R * 0.45 + i * 1.6, 2.6 + open * 3.2, 0.9, 1);
    // blood around the mouth
    g.fillStyle = 'rgba(120,10,10,0.75)';
    g.beginPath(); g.ellipse(R * 0.7, 4.6 + open * 2, 2.2, 1.2, 0.3, 0, Math.PI * 2); g.fill();
    // decay blotches
    g.fillStyle = 'rgba(40,30,20,0.35)';
    g.beginPath(); g.ellipse(-R * 0.3, -R * 0.5, 2.2, 1.5, 0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(R * 0.1, R * 0.45, 1.4, 1.1, 0, 0, Math.PI * 2); g.fill();
  };
}

// Torn shirt: skin showing through rips, blood stains, optional ribs.
function rags(o = {}) {
  return (g, P) => {
    if (o.stripes) {
      g.strokeStyle = o.stripes; g.lineWidth = 1.1;
      for (let u = 3; u < 22; u += 3.2) { const a = P(-10, u), b = P(10, u); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let v = -8; v < 10; v += 4) { const a = P(v, 0), b = P(v, 22); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    }
    if (o.suit) {
      const a = P(3, 21), b = P(6, 12), c = P(8, 21);
      g.fillStyle = '#d8d4c8'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.fill();
      const t1 = P(5.5, 19), t2 = P(6.5, 9);
      g.strokeStyle = '#7a1414'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(t1[0], t1[1]); g.lineTo(t2[0], t2[1]); g.stroke();
    }
    // ragged tears with skin behind
    g.fillStyle = o.skin;
    const tear = (v, u, w, h) => {
      const c = P(v, u);
      g.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, r = (i % 2 ? 0.55 : 1);
        g.lineTo(c[0] + Math.cos(a) * w * r, c[1] + Math.sin(a) * h * r);
      }
      g.closePath(); g.fill();
    };
    (o.tears || [[3, 8, 3, 2.4], [-4, 14, 2.4, 3]]).forEach(t => tear(...t));
    // ragged hem: skin of the belly peeking out
    const h0 = P(-7, 0.5), h1 = P(8, 0.5);
    g.beginPath(); g.moveTo(h0[0], h0[1]);
    for (let i = 0; i <= 8; i++) { const p = P(-7 + i * 1.9, 1.5 + (i % 2 ? 2.4 : 0)); g.lineTo(p[0], p[1]); }
    g.lineTo(h1[0], h1[1] + 4); g.lineTo(h0[0], h0[1] + 4); g.fill();
    if (o.ribs) {
      g.strokeStyle = 'rgba(60,20,16,0.8)'; g.lineWidth = 0.7;
      for (let u = 10; u < 18; u += 2) { const a = P(-1, u), b = P(6, u - 0.8); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    }
    // blood
    const bs = P(5, 15);
    const gr = g.createRadialGradient(bs[0], bs[1], 0, bs[0], bs[1], 7);
    gr.addColorStop(0, 'rgba(110,8,8,0.8)'); gr.addColorStop(1, 'rgba(90,6,6,0)');
    g.fillStyle = gr; g.fillRect(bs[0] - 8, bs[1] - 8, 16, 16);
    const drip = P(6, 13);
    g.fillStyle = 'rgba(100,8,8,0.7)'; g.fillRect(drip[0] - 0.6, drip[1], 1.2, 6);
  };
}

function hairFor(col, style) {
  return (T, G, hx, hy, R, a) => {
    if (style === 'bald') {
      detail(T, g => { g.translate(hx, hy); g.rotate(a); g.fillStyle = 'rgba(30,20,12,0.4)'; g.beginPath(); g.ellipse(-1, -R * 0.75, 3, 1.4, 0, 0, Math.PI * 2); g.fill(); });
      return;
    }
    const c = Math.cos(a), s = Math.sin(a);
    const L = (x, y) => [hx + x * c - y * s, hy + x * s + y * c];
    const pts = style === 'long'
      ? [L(-R - 1, 6), [...L(-R - 1.6, -R - 0.8), ...L(0, -R - 1.6)].slice(0, 4), L(R * 0.7, -R * 0.75), L(R * 0.2, -R * 0.4), L(-R * 0.2, -R * 0.6), L(-R * 0.5, 3), L(-R + 0.6, 8)]
      : [L(-R - 0.5, 0), [...L(-R - 0.8, -R - 0.6), ...L(0.5, -R - 1.4)].slice(0, 4), L(R * 0.45, -R * 0.85), L(R * 0.1, -R * 0.55), L(-R * 0.3, -R * 0.75), L(-R * 0.6, -0.5)];
    shape(T, pts, col);
  };
}

// ── Looks per type / variant ─────────────────────────────────────
const WALKERS = [
  { shirt: '#b8b2a0', pants: '#3a4a66', hair: ['#2a1c10', 'short'], tears: [[3, 8, 3.5, 2.6], [-3, 15, 2.6, 3]], ribs: true },
  { shirt: '#7a2a24', pants: '#4a3a28', hair: ['#5a3a1a', 'short'], stripes: 'rgba(20,10,10,0.45)' },
  { shirt: '#3c5272', pants: '#22262e', hair: ['#141414', 'bald'] },
  { shirt: '#4a7a6a', pants: '#4a7a6a', hair: ['#7a6040', 'long'], barefoot: true },
  { shirt: '#24262c', pants: '#24262c', hair: ['#2a2420', 'short'], suit: true },
  { shirt: '#6a6a66', pants: '#2c2c34', hair: ['#3a2410', 'long'], tears: [[-2, 9, 2.4, 3.2]] },
];

const LOOKS = new Map();
export function zombieLook(type, z) {
  const base = z.z.sc;
  const id = z.id || 0;
  const v = type === 'walker' ? hashOf('w' + id) % WALKERS.length : 0;
  const key = `${type}|${v}`;
  let l = LOOKS.get(key);
  if (l) return l;
  if (type === 'walker') {
    const W = WALKERS[v];
    const skin = mix(base, ['#8a8a6a', '#6a7a5a', '#7a8a6a', '#5a6a50', '#8a8270', '#6a7058'][v], 0.35);
    l = {
      skin, shirt: W.shirt, sleeves: W.suit ? 'long' : 'short', pants: W.pants, boots: '#2a2018', barefoot: !!W.barefoot,
      ripPants: true, torsoDetail: rags({ skin, ...W }), headgear: hairFor(...W.hair), face: zombieFace(),
      pose: { lean: 0.22, head: 0.28, reach: v % 2 === 0 },
    };
  } else if (type === 'runner') {
    const skin = mix(base, '#c0b080', 0.15);
    l = {
      skin, shirt: '#8a8a7a', sleeves: 'none', pants: '#3a3a44', shorts: true, boots: '#2a2a2a', ripPants: false,
      torsoDetail: rags({ skin, tears: [[4, 12, 3, 4]], ribs: true }), headgear: hairFor('#1a1208', 'short'),
      face: zombieFace('#ffcc22'), pose: { lean: 0.42, head: 0.15 },
    };
  } else if (type === 'spitter') {
    const skin = mix(base, '#7ab060', 0.2);
    l = {
      skin, shirt: '#3a4a3a', sleeves: 'short', pants: '#2a2a22', boots: '#1a1a14', barefoot: true,
      torsoDetail: rags({ skin, tears: [[2, 10, 4, 3]] }), headgear: hairFor('#1a1a10', 'bald'), face: zombieFace('#c8ff40'),
      sac: true, pose: { lean: 0.36, head: 0.1 },
    };
  } else if (type === 'tank') {
    const skin = mix(base, '#5a6a4a', 0.2);
    l = {
      skin, shirt: '#3a3426', sleeves: 'long', pants: '#2e2a20', boots: '#141210', limbK: 1.35, bulk: 3, belly: 4, chestOut: 2,
      torsoDetail: (g, P) => {
        rags({ skin, tears: [[5, 6, 3, 3], [-5, 12, 3, 4]] })(g, P);
        g.strokeStyle = '#c8b030'; g.lineWidth = 1.6;
        [4, 15].forEach(u => { const a = P(-10, u), b = P(11, u); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); });
      },
      headgear: hairFor('#1a1208', 'bald'), face: zombieFace('#ff7a1c'), skullShape: [7.2, 7.4],
      pose: { lean: 0.18, head: 0.35 },
    };
  } else { // brute
    const skin = mix(base, '#4a5a3c', 0.15);
    l = {
      skin, shirt: skin, sleeves: 'none', pants: '#1e1a14', boots: '#100e0c', barefoot: true, limbK: 1.55, bulk: 4, belly: 3, chestOut: 4,
      torsoDetail: (g, P) => {
        // exposed muscle + veins
        g.fillStyle = 'rgba(140,40,40,0.6)';
        const m = P(4, 12); g.beginPath(); g.ellipse(m[0], m[1], 4, 6, 0.3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(200,90,80,0.55)'; g.lineWidth = 0.6;
        for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(m[0] - 3, m[1] + i * 2); g.lineTo(m[0] + 3, m[1] + i * 2 - 1); g.stroke(); }
        g.strokeStyle = 'rgba(20,30,20,0.5)'; g.lineWidth = 0.7;
        const v1 = P(-6, 4), v2 = P(-2, 18); g.beginPath(); g.moveTo(v1[0], v1[1]); g.quadraticCurveTo(v1[0] + 4, (v1[1] + v2[1]) / 2, v2[0], v2[1]); g.stroke();
        const b = P(1, 3); g.fillStyle = 'rgba(100,8,8,0.6)'; g.beginPath(); g.ellipse(b[0], b[1], 5, 2.5, 0, 0, Math.PI * 2); g.fill();
      },
      headgear: hairFor('#000', 'bald'), face: zombieFace('#ff2a10'), skullShape: [6.4, 6.8], spikes: true,
      pose: { lean: 0.26, head: 0.45 },
    };
  }
  l.key = key;
  LOOKS.set(key, l);
  return l;
}

// ── Poses ────────────────────────────────────────────────────────
function poseFor(type, look, anim, f) {
  const n = FR[anim] || 1, p = f / n, w = p * Math.PI * 2;
  const P = look.pose;
  let pose, armF, armB, open = 0.35;
  if (anim === 'walk') {
    if (type === 'runner') {
      pose = walkPose(p, { stride: 0.8, knee: 1.3, lean: P.lean, head: P.head });
    } else {
      pose = walkPose(p, { stride: type === 'brute' || type === 'tank' ? 0.35 : 0.42, knee: 0.7, lean: P.lean, head: P.head });
      pose.legB[1] *= 0.4; // dragging back leg
    }
  } else if (anim === 'attack') {
    pose = standPose(p, { lean: P.lean + 0.12 + Math.sin(w) * 0.05, head: P.head - 0.2, legF: [0.4, 0.5], legB: [-0.32, 0.15] });
    open = 0.9;
  } else {
    pose = standPose(p, { lean: P.lean + 0.05, head: P.head + 0.15, legF: [0.12, 0.15], legB: [-0.1, 0.1] });
    open = 0.2;
  }
  const G = rigGeom(pose);
  if (anim === 'attack') {
    armF = fkArm(G, 1.75 + Math.sin(w) * 0.35, -0.35);
    armB = fkArm(G, 1.55 + Math.sin(w + Math.PI) * 0.35, -0.25);
  } else if (anim === 'walk' && type === 'runner') {
    armF = fkArm(G, pose.swing * -0.9 + 0.2, -1.4);
    armB = fkArm(G, pose.swing * 0.9 + 0.2, -1.4);
  } else if (anim === 'walk') {
    armF = fkArm(G, 1.3 + Math.sin(w) * 0.12, -0.25);
    armB = look.pose.reach ? fkArm(G, 1.1 + Math.sin(w + 1) * 0.12, -0.2) : fkArm(G, 0.15 - pose.swing * 0.25, 0.25);
  } else {
    armF = fkArm(G, 0.45 + Math.sin(w) * 0.06, 0.15);
    armB = fkArm(G, 0.3, 0.25);
  }
  return { G, armF, armB, open, w };
}

function paintZombie(T, type, look, P) {
  const { G, armF, armB, open, w } = P;
  paintArm(T, G, armB, look, true, { claw: true });
  paintLeg(T, G, G.legB, look, true);
  paintTorso(T, G, look);
  if (look.spikes) {
    // bone spurs along the back
    for (let i = 0; i < 4; i++) {
      const u = 8 + i * 3.6;
      const fw = [-G.up[1], G.up[0]];
      const b = [G.hip[0] - fw[0] * 8 + G.up[0] * u, G.hip[1] - fw[1] * 8 + G.up[1] * u];
      const tip = [b[0] - fw[0] * 5 + G.up[0] * 2, b[1] - fw[1] * 5 + G.up[1] * 2];
      shape(T, [[b[0] + G.up[0] * 1.5, b[1] + G.up[1] * 1.5], tip, [b[0] - G.up[0] * 1.5, b[1] - G.up[1] * 1.5]], '#d8ccae');
    }
  }
  paintLeg(T, G, G.legF, look, false);
  paintHead(T, G, look, { open });
  if (look.sac) {
    // glowing acid sac swelling on the throat
    const pulse = 0.85 + Math.sin(w * 2) * 0.15;
    const sx = G.neck[0] + 4, sy = G.neck[1] - 1;
    blob(T, sx, sy, 4.4 * pulse, 3.6 * pulse, 0.3, '#7ad040');
    detail(T, g => {
      const gl = g.createRadialGradient(sx + 1, sy - 1, 0, sx, sy, 4.4);
      gl.addColorStop(0, 'rgba(230,255,140,0.95)'); gl.addColorStop(1, 'rgba(120,220,60,0)');
      g.fillStyle = gl; g.beginPath(); g.ellipse(sx, sy, 4.2 * pulse, 3.4 * pulse, 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(170,255,90,0.85)'; g.fillRect(G.headC[0] + 5, G.headC[1] + 5, 0.9, 4 + Math.sin(w) * 1.5);
    });
  }
  paintArm(T, G, armF, look, false, { claw: true });
}

function frameSprite(type, look, anim, f) {
  return sprite(`z|${look.key}|${anim}|${f}`, BOX, T => paintZombie(T, type, look, poseFor(type, look, anim, f)), type === 'brute' ? 1.9 : type === 'tank' ? 1.6 : 1.3);
}

function corpse(type, look) {
  return sprite(`zd|${look.key}`, BOX_DEAD, T => {
    let G = rigGeom(corpsePose());
    const aF = fkArm(G, 2.6, 0.3), aB = fkArm(G, -0.15, 0.2);
    const c = Math.cos(-Math.PI / 2), s = Math.sin(-Math.PI / 2);
    const R = p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c - 8];
    const leg = L => ({ knee: R(L.knee), ankle: R(L.ankle), shin: L.shin + Math.PI / 2 });
    G = { ...G, hip: R(G.hip), neck: R(G.neck), shoulder: R(G.shoulder), headC: R(G.headC),
      up: [G.up[0] * c - G.up[1] * s, G.up[0] * s + G.up[1] * c], headAng: G.headAng - Math.PI / 2,
      legF: leg(G.legF), legB: leg(G.legB) };
    detail(T, g => {
      const ctr = R([0, -30]);
      const bp = g.createRadialGradient(ctr[0], ctr[1] + 5, 1, ctr[0], ctr[1] + 5, 24);
      bp.addColorStop(0, 'rgba(70,6,4,0.8)'); bp.addColorStop(1, 'rgba(50,4,4,0)');
      g.fillStyle = bp; g.beginPath(); g.ellipse(ctr[0], ctr[1] + 5, 26, 5.5, 0, 0, Math.PI * 2); g.fill();
    });
    paintZombie(T, type, look, { G, armF: { elbow: R(aF.elbow), hand: R(aF.hand) }, armB: { elbow: R(aB.elbow), hand: R(aB.hand) }, open: 0.7, w: 0 });
  }, type === 'brute' ? 1.9 : 1.3);
}

// Draw in zombie-local space (caller translated to the feet and applied
// lane scale, type scale and facing).
export function drawZombieBody(ctx, z, now) {
  const type = z.type || 'walker';
  const look = zombieLook(type, z);
  const hurt = z.hurtTimer > 0 ? Math.min(1, z.hurtTimer / 180) : 0;
  if (z.state === 'dead') {
    const dp = Math.min(1, (now - (z.deadAt || 0)) / 480);
    if (dp < 1) {
      const ease = 1 - Math.pow(1 - dp, 2.5);
      ctx.save(); ctx.rotate(-ease * Math.PI / 2);
      blit(ctx, frameSprite(type, look, 'idle', 0));
      ctx.restore();
    } else blit(ctx, corpse(type, look));
    return;
  }
  const anim = z.state === 'attack' ? 'attack' : z.state === 'walk' ? 'walk' : 'idle';
  const speed = anim === 'attack' ? 260 : type === 'runner' ? 230 : anim === 'walk' ? 420 : 900;
  let p = ((now / speed + (z.walkPhase || 0)) / (Math.PI * 2)) % 1;
  if (p < 0) p += 1;
  const f = Math.floor(p * FR[anim]) % FR[anim];
  blit(ctx, frameSprite(type, look, anim, f), hurt);
}


// Pre-render the common zombie frames in idle time (command screen) so
// the first seconds of a wave don't stutter while the cache fills.
export function* zombiePrewarm() {
  const { ZTP } = ZTP_REF;
  if (!ZTP) return;
  for (let v = 0; v < 60; v++) {
    const look = zombieLook('walker', { id: v, z: ZTP.walker });
    if (look._warm) continue;
    look._warm = true;
    for (let f = 0; f < FR.walk; f++) yield () => frameSprite('walker', look, 'walk', f);
    for (let f = 0; f < FR.attack; f++) yield () => frameSprite('walker', look, 'attack', f);
    yield () => corpse('walker', look);
  }
  for (const t of ['runner', 'tank', 'spitter', 'brute']) {
    const look = zombieLook(t, { id: 0, z: ZTP[t] });
    for (let f = 0; f < FR.walk; f++) yield () => frameSprite(t, look, 'walk', f);
    for (let f = 0; f < FR.attack; f++) yield () => frameSprite(t, look, 'attack', f);
  }
}
const ZTP_REF = {};
export function registerZombieTypes(ZTP) { ZTP_REF.ZTP = ZTP; }
