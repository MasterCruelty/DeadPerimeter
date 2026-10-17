// ────────────────────────────────────────────────────────────────
// Human actors (soldiers, civilians, bandits, police, hostile
// survivors). The body — legs, torso, head — comes from the sprite
// cache; arms are drawn live with IK so they stay locked to a weapon
// that recoils, tilts for a reload or thrusts a knife.
// ────────────────────────────────────────────────────────────────
import { dWpn, wpt, WSCALE } from '../weapons.js';
import { WPN, wbase, meleeOf } from '../../data/weapons.js';
import { sprite, blit, live, detail } from './paint.js';
import {
  BODY, rigGeom, ik, fkArm, paintLeg, paintTorso, paintHead, paintArm,
  walkPose, standPose, kneelPose, corpsePose, humanLook, hashOf,
} from './humanoid.js';

const BOX_STAND = { w: 70, h: 80, ox: 30, oy: 74 };
const BOX_DEAD = { w: 100, h: 36, ox: 78, oy: 26 };
export const WALK_FRAMES = 10, IDLE_FRAMES = 4;

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
    const pose = anim === 'walk' ? walkPose(frame / WALK_FRAMES) : anim === 'kneel' ? kneelPose(frame / IDLE_FRAMES)
      : anim === 'aim' ? standPose(frame / IDLE_FRAMES, { lean: 0.13, head: 0.2 }) : standPose(frame / IDLE_FRAMES);
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
  // Aiming: lean into the gun, cheek down towards the stock.
  if (a._aim) return { anim: 'aim', frame: f, pose: standPose(f / IDLE_FRAMES, { lean: 0.13, head: 0.2 }) };
  return { anim: 'idle', frame: f, pose: standPose(f / IDLE_FRAMES) };
}

// Melee weapon in hand, pointing along `ang` (bat / machete / axe;
// anything else falls back to the knife).
function paintMelee(T, hand, ang, type) {
  if (type === 'knife' || !type) { paintKnife(T, hand, ang); return; }
  detail(T, g => {
    g.translate(hand[0], hand[1]); g.rotate(ang);
    if (type === 'bat') {
      const wd = g.createLinearGradient(0, -2.5, 0, 2.5);
      wd.addColorStop(0, '#c8a070'); wd.addColorStop(1, '#7a5530');
      g.fillStyle = '#1a1208'; g.fillRect(-4, -1.6, 5, 3.2);
      g.fillStyle = wd; g.beginPath(); g.moveTo(0, -1.4); g.lineTo(22, -2.8); g.quadraticCurveTo(25, 0, 22, 2.8); g.lineTo(0, 1.4); g.fill();
    } else if (type === 'machete') {
      g.fillStyle = '#2a1a0c'; g.fillRect(-5, -1.6, 6, 3.2);
      const bl = g.createLinearGradient(0, -2.4, 0, 2);
      bl.addColorStop(0, '#e8eaf0'); bl.addColorStop(1, '#7a7c86');
      g.fillStyle = bl; g.beginPath(); g.moveTo(1, -1.6); g.lineTo(19, -2.6); g.quadraticCurveTo(23, -1, 21, 1.6); g.lineTo(1, 1.4); g.fill();
    } else if (type === 'axe') {
      g.fillStyle = '#6a4424'; g.fillRect(-4, -1.3, 24, 2.6);
      g.fillStyle = '#b02a20'; g.beginPath(); g.moveTo(15, -1.3); g.lineTo(22, -6.5); g.quadraticCurveTo(25, -1, 22, 4.5); g.lineTo(15, 1.3); g.fill();
      g.fillStyle = '#d8dce4'; g.beginPath(); g.moveTo(22, -6.5); g.quadraticCurveTo(25, -1, 22, 4.5); g.lineTo(21, 4); g.quadraticCurveTo(23.5, -1, 21, -6); g.fill();
    }
  });
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
  // "Aiming" while engaged (shot in the last ~1.3 s); otherwise low ready.
  const sinceShot = now - (s.shootAt || -1e9);
  const aimK = isShoot ? 1 : Math.max(0, Math.min(1, 1 - (sinceShot - 1300) / 250));
  const { anim, frame, pose } = animOf({ ...s, _aim: !isWalk && !isKnife && !isRl && aimK > 0.5 }, now, isWalk);
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
  const D = BODY;
  const isPistol = wbase(w) === 'pistol';
  const rcl = isShoot ? Math.max(0, 1 - (now - (s.shootAt || 0)) / 185) * 3 : 0;

  // Reload timeline (support hand fetches a fresh magazine).
  const WPN_RL = (WPN[w] && WPN[w].rl) || 1900;
  const rlp = isRl ? Math.min(1, (now - (s.reloadStart || 0)) / WPN_RL) : 0;
  const rlTilt = isRl ? (rlp < 0.2 ? rlp / 0.2 : rlp > 0.85 ? (1 - rlp) / 0.15 : 1) : 0;

  // Long guns pivot on the shoulder pocket: the butt sits on the
  // shoulder and the gun rotates around it. Aimed = level; low ready =
  // muzzle dipped; reload = dipped further and pulled in.
  const lowReady = isPistol ? 0.62 : 0.36;
  let tilt = (1 - aimK) * lowReady + rlTilt * (isPistol ? 0.4 : 0.32);
  if (isShoot) tilt -= rcl * (isPistol ? 0.09 : 0.02);          // muzzle climb
  const butt = wpt(w, 'butt');
  let pivot;
  if (isPistol) {
    // Two-handed pistol at arm's length, eye level when aimed.
    const reach = 13 - (1 - aimK) * 3 - rlTilt * 4;
    pivot = [G.shoulder[0] + reach, G.shoulder[1] - 2 + (1 - aimK) * 5 + rlTilt * 3];
  } else {
    pivot = [G.shoulder[0] + 1.5 - rlTilt * 2, G.shoulder[1] - 2.5 + rlTilt * 2];
  }
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  // weapon art point → actor space (recoil slides the gun back along its axis)
  const toWorld = p => {
    const x = p[0] - butt[0] - rcl, y = p[1] - butt[1];
    return [pivot[0] + x * c - y * sn, pivot[1] + x * sn + y * c];
  };
  const origin = toWorld([0, 0]); // where dWpn's origin lands
  const anchor = [origin[0] + rcl * c, origin[1] + rcl * sn];

  // Hand targets. "far" = trigger hand (behind the gun), "near" = support
  // hand (in front of the gun, on the hand-guard / pump / under the barrel).
  let farT, nearT, knifeAng = 0;
  if (isKnife) {
    const kf = s.state === 'knife' ? Math.max(0, 1 - (now - (s.shootAt || 0)) / 300) : 0;
    nearT = [G.shoulder[0] + 9 + kf * 9, G.shoulder[1] + 9 - kf * 5];
    farT = [G.shoulder[0] + 6, G.shoulder[1] + 13];
    // Heavier melee weapons wind up higher and swing through further.
    const heavy = meleeOf(s) !== 'knife';
    knifeAng = heavy ? -1.25 + kf * 1.6 : -0.5 + kf * 0.5;
  } else {
    farT = toWorld(wpt(w, 'grip'));
    let fore = wpt(w, 'fore');
    if (w === 'shotgun' && sinceShot > 120 && sinceShot < 520) {
      // rack the pump after each shot
      const k = Math.sin(((sinceShot - 120) / 400) * Math.PI);
      fore = [fore[0] - k * 5, fore[1]];
    }
    nearT = toWorld(fore);
    if (isRl && rlp > 0.22 && rlp < 0.82) {
      // support hand: mag well → vest pouch → mag well
      const k = (rlp - 0.22) / 0.6;
      const well = toWorld(isPistol ? wpt(w, 'grip') : [16, 12].map(v => v * (WSCALE[w] || 0.5)));
      const pouch = [G.hip[0] + 7, G.hip[1] - 5];
      const t = k < 0.5 ? k * 2 : (1 - k) * 2;
      nearT = [well[0] + (pouch[0] - well[0]) * t, well[1] + (pouch[1] - well[1]) * t];
    }
  }
  const farArm = ik(G.shoulder[0] - 1.5, G.shoulder[1] + 0.5, farT[0], farT[1], D.upper, D.fore, 1);
  const nearArm = ik(G.shoulder[0] + 1, G.shoulder[1] + 1, nearT[0], nearT[1], D.upper, D.fore, 1);

  // Layering: body → trigger arm (reads against the torso) → gun →
  // support arm wrapping under the hand-guard.
  blit(ctx, bodySprite(look, anim, frame), hurt);
  live(ctx, T => paintArm(T, G, farArm, look, true));
  if (!isKnife) {
    ctx.save(); ctx.translate(anchor[0], anchor[1]); ctx.rotate(tilt);
    dWpn(ctx, w, rcl);
    ctx.restore();
    if (isRl && rlp > 0.25 && rlp < 0.55) {
      // spent magazine tumbling away
      const drop = (rlp - 0.25) / 0.3 * 28, spin = (rlp - 0.25) * 6;
      const m0 = toWorld([16, 12].map(v => v * (WSCALE[w] || 0.5)));
      ctx.save(); ctx.translate(m0[0], m0[1] + drop); ctx.rotate(spin);
      ctx.fillStyle = '#252018'; ctx.fillRect(-1.6, -3.5, 3.2, 7);
      ctx.fillStyle = '#3a3028'; ctx.fillRect(-1.2, -3, 2.4, 1.4); ctx.restore();
    }
  }
  live(ctx, T => {
    paintArm(T, G, nearArm, look, false);
    if (isKnife) paintMelee(T, nearArm.hand, knifeAng, meleeOf(s));
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
    const [gx, gy] = wpt('pistol', 'grip');
    ctx.save(); ctx.translate(hand[0] - gx, hand[1] - gy); ctx.rotate(aiming ? -kick * 0.05 : 0.9);
    dWpn(ctx, 'pistol', 0); ctx.restore();
    live(ctx, T => paintArm(T, G, near, look, false));
    if (h.lastShot && now - h.lastShot < 90) {
      const fa = 1 - (now - h.lastShot) / 90;
      const mz = wpt('pistol', 'muzzle');
      const mx = hand[0] - gx + mz[0], my = hand[1] - gy + mz[1];
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
