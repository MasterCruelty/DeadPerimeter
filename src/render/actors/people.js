// ────────────────────────────────────────────────────────────────
// Human actors (soldiers, civilians, bandits, police, hostile
// survivors). The body — legs, torso, head — comes from the sprite
// cache; arms are drawn live with IK so they stay locked to a weapon
// that recoils, tilts for a reload or thrusts a knife.
// ────────────────────────────────────────────────────────────────
import { WEAPON_SCALE } from '../../constants.js';
import { dWpn, PISTOL_K } from '../weapons.js';
import { sprite, blit, live, detail } from './paint.js';
import {
  BODY, rigGeom, ik, fkArm, paintLeg, paintTorso, paintHead, paintArm,
  walkPose, standPose, kneelPose, corpsePose, humanLook, hashOf,
} from './humanoid.js';

const BOX_STAND = { w: 70, h: 80, ox: 30, oy: 74 };
const BOX_DEAD = { w: 100, h: 36, ox: 78, oy: 26 };
export const WALK_FRAMES = 10, IDLE_FRAMES = 4;

// Weapon anchor relative to the shoulder, and the two hand holds in
// weapon space (already scaled by WEAPON_SCALE).
const HOLD = {
  rifle:   { at: [4, 8],  grip: [6, 11],   fore: [22, -4.5] },
  sniper:  { at: [5, 8],  grip: [-1.6, 7.8], fore: [21, -1.5] },
  shotgun: { at: [3, 9],  grip: [7.8, 11], fore: [18, 3] },
  pistol:  { at: [13, 5], grip: [1.6 * PISTOL_K, 9.4 * PISTOL_K], fore: [3.2 * PISTOL_K, 10.6 * PISTOL_K] },
};

const LOOKS = new Map();
function lookOf(kind, seed, extra) {
  const key = `${kind}|${seed}|${extra ? JSON.stringify(extra) : ''}`;
  let l = LOOKS.get(key);
  if (!l) { l = humanLook(kind, seed, extra); l.key = key; LOOKS.set(key, l); }
  return l;
}

export function actorKind(a) {
  if (a.police) return a.swat ? 'swat' : 'police';
  if (a.bandit) return 'bandit';
  if (a.civilian) return 'civilian';
  if (a.veteran) return 'veteran';
  return 'recruit';
}

function rotateGeom(G, th, dx, dy) {
  const c = Math.cos(th), s = Math.sin(th);
  const R = p => [p[0] * c - p[1] * s + dx, p[0] * s + p[1] * c + dy];
  const leg = L => ({ knee: R(L.knee), ankle: R(L.ankle), shin: L.shin - th });
  return {
    ...G, hip: R(G.hip), neck: R(G.neck), shoulder: R(G.shoulder), headC: R(G.headC),
    up: [G.up[0] * c - G.up[1] * s, G.up[0] * s + G.up[1] * c], headAng: G.headAng + th,
    legF: leg(G.legF), legB: leg(G.legB), R,
  };
}

function paintBody(T, G, look) {
  paintLeg(T, G, G.legB, look, true);
  paintTorso(T, G, look);
  paintLeg(T, G, G.legF, look, false);
  paintHead(T, G, look);
}

function bodySprite(look, anim, frame) {
  return sprite(`h|${look.key}|${anim}|${frame}`, BOX_STAND, T => {
    const pose = anim === 'walk' ? walkPose(frame / WALK_FRAMES) : anim === 'kneel' ? kneelPose(frame / IDLE_FRAMES) : standPose(frame / IDLE_FRAMES);
    paintBody(T, rigGeom(pose), look);
  });
}

function corpseSprite(look) {
  return sprite(`hd|${look.key}`, BOX_DEAD, T => {
    let G = rigGeom(corpsePose());
    const aF = fkArm(G, 2.75, 0.25), aB = fkArm(G, -0.12, 0.15);
    G = rotateGeom(G, -Math.PI / 2, 0, -8);
    const rA = a => ({ elbow: G.R(a.elbow), hand: G.R(a.hand) });
    // blood pool under the torso
    detail(T, g => {
      const c = G.R([0, -30]);
      const bp = g.createRadialGradient(c[0], c[1] + 4, 1, c[0], c[1] + 4, 22);
      bp.addColorStop(0, 'rgba(90,6,6,0.75)'); bp.addColorStop(1, 'rgba(60,4,4,0)');
      g.fillStyle = bp; g.beginPath(); g.ellipse(c[0], c[1] + 5, 24, 5, 0, 0, Math.PI * 2); g.fill();
    });
    paintArm(T, G, rA(aB), look, true);
    paintBody(T, G, look);
    paintArm(T, G, rA(aF), look, false);
  });
}

// Pose selection shared by soldiers and survivors.
function animOf(a, now, moving) {
  if (moving) {
    const p = ((now / 300 + (a.walkPhase || 0)) / (Math.PI * 2)) % 1;
    const f = Math.floor((p < 0 ? p + 1 : p) * WALK_FRAMES) % WALK_FRAMES;
    return { anim: 'walk', frame: f, pose: walkPose(f / WALK_FRAMES) };
  }
  const p = ((now / 900 + (a.walkPhase || 0)) / (Math.PI * 2)) % 1;
  const f = Math.floor((p < 0 ? p + 1 : p) * IDLE_FRAMES) % IDLE_FRAMES;
  if (a.kneel) return { anim: 'kneel', frame: f, pose: kneelPose(f / IDLE_FRAMES) };
  return { anim: 'idle', frame: f, pose: standPose(f / IDLE_FRAMES) };
}

// Knife held in a hand, pointing along `ang`.
function paintKnife(T, hand, ang) {
  detail(T, g => {
    g.translate(hand[0], hand[1]); g.rotate(ang);
    g.fillStyle = '#3a1a08'; g.fillRect(-4, -1.4, 5, 2.8);
    g.fillStyle = '#7a7a82'; g.fillRect(1, -2, 1.2, 4);
    const bl = g.createLinearGradient(0, -1.5, 0, 1.5);
    bl.addColorStop(0, '#e8eaf0'); bl.addColorStop(1, '#8a8c96');
    g.fillStyle = bl; g.beginPath(); g.moveTo(2, -1.3); g.lineTo(14, -0.4); g.lineTo(16, 0.4); g.lineTo(2, 1.4); g.fill();
  });
}

// ── Soldier (and anything drawn through dSoldier) ────────────────
// Draws in actor-local space: the caller has already translated to the
// feet and applied lane scale + facing. Returns the weapon anchor so
// the caller can place the muzzle flash.
export function drawSoldierBody(ctx, s, now) {
  const seed = hashOf(`${s.name || ''}|${s.id || 0}`);
  const look = lookOf(actorKind(s), seed, s.jacket ? { jacket: s.jacket } : null);
  if (s.state === 'dead') {
    const dp = s.deadAt ? Math.min(1, (now - s.deadAt) / 480) : 1;
    if (dp < 1) {
      const ease = 1 - Math.pow(1 - dp, 2.5);
      ctx.save(); ctx.rotate(-ease * Math.PI / 2);
      blit(ctx, bodySprite(look, 'idle', 0));
      ctx.restore();
    } else blit(ctx, corpseSprite(look));
    return null;
  }

  const isWalk = s.state === 'walk', isShoot = s.state === 'shoot', isRl = s.state === 'reload';
  const isKnife = s.state === 'knife' || s.knifeReady;
  const { anim, frame, pose } = animOf(s, now, isWalk);
  const G = rigGeom(pose);
  const hurt = s.hurtTimer > 0 ? Math.min(1, s.hurtTimer / 200) : 0;

  if (s.unarmed) {
    // Rescuable civilians: wave for help while waiting, swing arms
    // while following the squad.
    const wave = Math.sin(now / 160 + (s.walkPhase || 0));
    const near = isWalk ? fkArm(G, pose.swing * 0.55, -0.45) : fkArm(G, 2.75 + wave * 0.25, 0.35);
    const far = isWalk ? fkArm(G, -pose.swing * 0.55, -0.45) : fkArm(G, 2.55 - wave * 0.2, 0.3);
    live(ctx, T => paintArm(T, G, far, look, true));
    blit(ctx, bodySprite(look, anim, frame), hurt);
    live(ctx, T => paintArm(T, G, near, look, false));
    return null;
  }

  const w = s.weapon || 'rifle';
  const H = HOLD[w] || HOLD.rifle;
  const rcl = isShoot ? Math.max(0, 1 - (now - (s.shootAt || 0)) / 185) * 4 : 0;
  const anchor = [G.shoulder[0] + H.at[0], G.shoulder[1] + H.at[1]];
  const D = BODY;

  // Reload: weapon tips muzzle-down while the support hand fetches a mag.
  const WPN_RL = { rifle: 1900, pistol: 1050, shotgun: 2200, sniper: 2400 }[w] || 1900;
  const rlp = isRl ? Math.min(1, (now - (s.reloadStart || 0)) / WPN_RL) : 0;
  const tilt = isRl ? (rlp < 0.25 ? rlp / 0.25 : rlp > 0.8 ? (1 - rlp) / 0.2 : 1) * 0.45 : 0;
  const toWorld = (p, r = rcl) => {
    const x = p[0] - r, y = p[1];
    const c = Math.cos(tilt), sn = Math.sin(tilt);
    return [anchor[0] + x * c - y * sn, anchor[1] + x * sn + y * c];
  };

  let farTarget, nearTarget, knifeAng = 0;
  if (isKnife) {
    const kf = s.state === 'knife' ? Math.max(0, 1 - (now - (s.shootAt || 0)) / 300) : 0;
    nearTarget = [G.shoulder[0] + 9 + kf * 9, G.shoulder[1] + 9 - kf * 5];
    farTarget = [G.shoulder[0] + 6, G.shoulder[1] + 13];
    knifeAng = -0.5 + kf * 0.5;
  } else {
    nearTarget = toWorld(H.grip);
    farTarget = toWorld(H.fore);
    if (isRl && rlp > 0.25 && rlp < 0.8) {
      // to the mag well, down to the vest pouch, back up
      const k = (rlp - 0.25) / 0.55;
      const well = toWorld([4, 6]), pouch = [G.hip[0] + 6, G.hip[1] - 6];
      const t = k < 0.5 ? k * 2 : (1 - k) * 2;
      farTarget = [well[0] + (pouch[0] - well[0]) * t, well[1] + (pouch[1] - well[1]) * t];
    }
  }
  const farArm = ik(G.shoulder[0] - 1.5, G.shoulder[1], farTarget[0], farTarget[1], D.upper, D.fore, 1);
  const nearArm = ik(G.shoulder[0] + 0.5, G.shoulder[1] + 0.5, nearTarget[0], nearTarget[1], D.upper, D.fore, 1);

  live(ctx, T => paintArm(T, G, farArm, look, true));
  blit(ctx, bodySprite(look, anim, frame), hurt);
  if (!isKnife) {
    ctx.save(); ctx.translate(anchor[0], anchor[1]); ctx.rotate(tilt);
    dWpn(ctx, w, rcl);
    ctx.restore();
    if (isRl && rlp > 0.3 && rlp < 0.62) {
      // spent magazine tumbling away
      const drop = (rlp - 0.3) / 0.32 * 30, spin = (rlp - 0.3) * 6;
      ctx.save(); ctx.translate(anchor[0] + 4, anchor[1] + 8 + drop); ctx.rotate(spin);
      ctx.fillStyle = '#252018'; ctx.fillRect(-2.5, -5, 5, 10);
      ctx.fillStyle = '#3a3028'; ctx.fillRect(-2, -4, 4, 2); ctx.restore();
    }
  }
  live(ctx, T => {
    paintArm(T, G, nearArm, look, false);
    if (isKnife) paintKnife(T, nearArm.hand, knifeAng);
  });
  return { anchor, tilt, rcl, G };
}

// ── Hostile survivors (siege human waves) ────────────────────────
export function drawHostileBody(ctx, h, now) {
  const seed = hashOf(`h${h.id}`);
  const kind = h.type === 'gunman' ? 'gunman' : 'knifeman';
  const look = lookOf(kind, seed, { color: h.h.color, cap: h.h.cap });
  if (h.state === 'dead') {
    const dp = Math.min(1, (now - (h.deadAt || 0)) / 480);
    if (dp < 1) {
      ctx.save(); ctx.rotate(-(1 - Math.pow(1 - dp, 2.5)) * Math.PI / 2);
      blit(ctx, bodySprite(look, 'idle', 0)); ctx.restore();
    } else blit(ctx, corpseSprite(look));
    return;
  }
  const moving = h.state === 'walk';
  const { anim, frame, pose } = animOf({ walkPhase: h.walkPhase }, now * 1.06, moving);
  const G = rigGeom(pose);
  const hurt = h.hurtTimer > 0 ? Math.min(1, h.hurtTimer / 200) : 0;
  const swing = moving ? pose.swing : 0;

  if (kind === 'gunman') {
    const aiming = h.state === 'attack';
    const kick = aiming && h.lastShot ? Math.max(0, 1 - (now - h.lastShot) / 160) * 3 : 0;
    const near = aiming
      ? ik(G.shoulder[0], G.shoulder[1], G.shoulder[0] + 17 - kick, G.shoulder[1] + 1 - kick, BODY.upper, BODY.fore, 1)
      : fkArm(G, 0.35 + swing * 0.3, -0.5);
    const far = fkArm(G, -swing * 0.4, -0.3);
    live(ctx, T => paintArm(T, G, far, look, true));
    blit(ctx, bodySprite(look, anim, frame), hurt);
    const hand = near.hand;
    const gx = 1.6 * PISTOL_K, gy = 9.4 * PISTOL_K;
    ctx.save(); ctx.translate(hand[0] - gx, hand[1] - gy); ctx.rotate(aiming ? -kick * 0.05 : 0.9);
    dWpn(ctx, 'pistol', 0); ctx.restore();
    live(ctx, T => paintArm(T, G, near, look, false));
    if (h.lastShot && now - h.lastShot < 90) {
      const fa = 1 - (now - h.lastShot) / 90;
      const mx = hand[0] - gx + 41 * WEAPON_SCALE * PISTOL_K, my = hand[1] - gy - 9 * WEAPON_SCALE * PISTOL_K;
      ctx.save(); ctx.globalAlpha = fa;
      const fl = ctx.createRadialGradient(mx, my, 0, mx, my, 11);
      fl.addColorStop(0, 'rgba(255,230,80,1)'); fl.addColorStop(0.5, 'rgba(255,100,0,0.6)'); fl.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  } else {
    const atk = h.state === 'attack';
    const kf = atk ? Math.max(0, Math.sin(now / 140)) : 0;
    const near = atk
      ? ik(G.shoulder[0], G.shoulder[1], G.shoulder[0] + 9 + kf * 10, G.shoulder[1] + 7 - kf * 6, BODY.upper, BODY.fore, 1)
      : fkArm(G, 0.5 + swing * 0.35, -0.9);
    const far = fkArm(G, -swing * 0.5 + 0.2, -0.6);
    live(ctx, T => paintArm(T, G, far, look, true));
    blit(ctx, bodySprite(look, anim, frame), hurt);
    live(ctx, T => { paintArm(T, G, near, look, false); paintKnife(T, near.hand, atk ? -0.3 + kf * 0.4 : 1.2); });
  }
}
