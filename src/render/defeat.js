import { C, CW, CH, GY, WX } from '../constants.js';
import { dBg } from './background.js';
import { dBase } from './base.js';
import { dSoldier } from './soldier.js';
import { dZombie } from './zombie.js';
import { ZTP } from '../data/zombies.js';
import { pushRadio, RADIO_LINES } from '../audio/radio.js';
import { dRadioSubtitle } from './hud.js';

// Sprite scaling + reuse helpers (mirrors the intro module's versions
// so dSoldier / dZombie can be rendered at arbitrary scale + foot Y).
function dSpriteAt(drawFn, ctx, entity, screenX, screenFootY, scale, now) {
  ctx.save();
  ctx.translate(screenX, screenFootY - GY * scale);
  ctx.scale(scale, scale);
  const e = { ...entity, x: 0, lane: 0 };
  drawFn(ctx, e, now);
  ctx.restore();
}
function mkSold(opts = {}) {
  return {
    id: 'd' + Math.random(),
    name: opts.name || 'X', weapon: opts.weapon || 'rifle',
    hp: opts.hp ?? 100, maxHp: 100,
    ammo: opts.ammo ?? 30, maxAmmo: 30,
    state: opts.state || 'idle',
    facing: opts.facing ?? 1,
    civilian: false, bandit: false, police: false, swat: false,
    onRoof: false, onExpedition: false,
    walkPhase: opts.walkPhase ?? 0,
    lastShot: opts.lastShot ?? 0, reloadStart: 0, shootAt: 0, knifeTimer: 0,
    hurtTimer: 0, recoil: 0,
    deadAt: opts.deadAt,
  };
}
function mkZom(opts = {}) {
  const type = opts.type || 'walker';
  const ztp = ZTP[type] || ZTP.walker;
  return {
    id: 'dz' + Math.random(),
    type, z: ztp,
    hp: opts.hp ?? ztp.hp, maxHp: ztp.hp,
    state: opts.state || 'walk',
    facing: opts.facing ?? -1,
    walkPhase: opts.walkPhase ?? Math.random() * Math.PI * 2,
    atkTimer: 0, hurtTimer: 0,
    deadAt: opts.deadAt ?? 0,
    activated: true,
  };
}

// Game-over cinematic. ~24 seconds, four chained beats that show
// Fort Omega being overrun. Skippable like the intro.
export const DEFEAT_DURATION = 24000;

const PHASES = {
  breach:    { start: 0,     end: 5000  },
  overrun:   { start: 5000,  end: 12000 },
  lastStand: { start: 12000, end: 19000 },
  silence:   { start: 19000, end: 24000 },
};

function phaseAt(t) {
  for (const [name, p] of Object.entries(PHASES)) {
    if (t >= p.start && t < p.end) return { name, t: (t - p.start) / (p.end - p.start), local: t - p.start };
  }
  return { name: 'silence', t: 1, local: PHASES.silence.end - PHASES.silence.start };
}

// ── Scripted defenders ─────────────────────────────────────────
// Deployed IN FRONT of the wall, facing right (toward the horde
// pressing in). Charlie is the forward man and falls first; Alpha
// is dug in near the wall and fights to the very end.
// fallAt / hurtAt are CUMULATIVE ms from the start of the cinematic.
const DEFENDERS = [
  { name: 'Alpha',   x: WX + 14,  weapon: 'rifle',   fallAt: 17500, hurtAt: 16800, line: 'For Fort Omega!',  urgent: true, hero: true },
  { name: 'Delta',   x: WX + 70,  weapon: 'pistol',  fallAt: 14000, hurtAt: 13300, line: "They're everywhere!", urgent: true },
  { name: 'Bravo',   x: WX + 140, weapon: 'rifle',   fallAt:  9500, hurtAt:  8700, line: 'Mag dry!' },
  { name: 'Charlie', x: WX + 220, weapon: 'shotgun', fallAt:  6500, hurtAt:  5700, line: "I'm hit!" },
];

// Killer zombies — each appears next to its assigned defender just
// before that defender's hurtAt and stays there in 'attack' state,
// mauling the body. This is the "physics" the player was missing:
// a defender doesn't just topple, they're EATEN.
const KILLERS = [
  // Charlie — overrun first by a fast runner
  { defenderIdx: 3, type: 'runner', dx:  28, appearAt:  5300, walkPhase: 0.0 },
  // Bravo — flanked by a walker
  { defenderIdx: 2, type: 'walker', dx:  28, appearAt:  8300, walkPhase: 0.5 },
  // Delta — pinned by a walker
  { defenderIdx: 1, type: 'walker', dx:  28, appearAt: 12900, walkPhase: 1.0 },
  // Alpha — surrounded, three zombies converging
  { defenderIdx: 0, type: 'walker', dx:  30, appearAt: 16300, walkPhase: 0.0 },
  { defenderIdx: 0, type: 'runner', dx: -26, appearAt: 16500, walkPhase: 0.7 },
  { defenderIdx: 0, type: 'walker', dx:  46, appearAt: 16800, walkPhase: 1.4 },
];

// Foreground dead zombies on the ground — killed by defender fire
// before reaching the line. Each appears at killedAt and stays.
const DEAD_ZOMBIES = [
  { x: WX + 320, killedAt: 1400 },
  { x: WX + 260, killedAt: 2300 },
  { x: WX + 380, killedAt: 3100 },
  { x: WX + 290, killedAt: 4000 },
  { x: WX + 350, killedAt: 4800 },
  { x: WX + 200, killedAt: 7200 },
  { x: WX + 270, killedAt: 8400 },
  { x: WX + 160, killedAt: 10500 },
  { x: WX + 180, killedAt: 11800 },
];

// ── Actor renderers using the real in-game sprites ────────────
function dDefeatSoldier(ctx, d, elapsed, now) {
  const dead = elapsed >= d.fallAt;
  const dying = !dead && elapsed >= d.hurtAt;
  // Feet at true ground level (in front of the wall, not on top).
  const footY = GY;

  if (dead) {
    const sol = mkSold({
      name: d.name, weapon: d.weapon, facing: 1, state: 'dead',
      deadAt: d.fallAt,
    });
    dSpriteAt(dSoldier, ctx, sol, d.x, footY, 1.0, now);
    // Pool of blood on the road
    ctx.fillStyle = 'rgba(110,5,5,0.55)';
    ctx.beginPath(); ctx.ellipse(d.x, footY + 4, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // Alpha (hero) switches to knife in the last ~1.5 s before he dies
  // — he's run out of ammo and goes melee.
  const ammoOut = d.hero && (d.fallAt - elapsed) < 1500;
  // Living: alternate idle/shoot for muzzle-flash sync, more frantic
  // when dying.
  const cadence = dying ? 110 : 180;
  const firing = !ammoOut && Math.floor(now / cadence + d.x) % 2 === 0;
  const sol = mkSold({
    name: d.name, weapon: d.weapon, facing: 1,
    state: ammoOut ? 'knife' : (firing ? 'shoot' : 'idle'),
    lastShot: now - 30,
    walkPhase: d.x * 0.05,
  });
  dSpriteAt(dSoldier, ctx, sol, d.x, footY, 1.0, now);
  if (firing) {
    // Muzzle flash overlay tuned for 1.0x scale rifle barrel tip.
    const fx = d.x + 26, fy = footY - 40;
    ctx.fillStyle = 'rgba(255,210,80,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + 14, fy - 5);
    ctx.lineTo(fx + 14, fy + 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,140,0.85)';
    ctx.fillRect(fx + 16, fy - 0.7, 28 + (d.x % 20), 1.4);
    // Ejecting brass casing
    const ejT = (now / cadence) % 1;
    const ecx = d.x - 4 + ejT * 18;
    const ecy = fy - 12 - ejT * 12 + ejT * ejT * 30;
    ctx.fillStyle = '#c4a850';
    ctx.fillRect(ecx, ecy, 4, 2);
  }
  // Blood spatter on dying soldier
  if (dying) {
    ctx.fillStyle = 'rgba(120,4,4,0.7)';
    ctx.fillRect(d.x - 4, footY - 36, 8, 4);
  }
}

// Killer zombies (mauling a downed defender). Drawn AFTER the
// defenders so they layer on top.
function dKiller(ctx, k, elapsed, now) {
  if (elapsed < k.appearAt) return;
  const def = DEFENDERS[k.defenderIdx];
  const facing = k.dx > 0 ? -1 : 1;
  const z = mkZom({
    type: k.type, facing, state: 'attack',
    walkPhase: k.walkPhase + now * 0.001,
  });
  // Light jitter so they look like they're actively biting
  const j = Math.sin(now / 140 + k.dx) * 1.4;
  dSpriteAt(dZombie, ctx, z, def.x + k.dx + j, GY, 1.0, now);
}

// Dead zombies on the foreground street. Each was killed at killedAt
// (cumulative ms), then renders as a fallen body from there on.
function dGroundDeadZombie(ctx, dz, elapsed, now) {
  if (elapsed < dz.killedAt) return;
  // Time since death — long enough that dZombie's rotate-into-dead
  // animation has fully resolved.
  const z = mkZom({
    type: 'walker', facing: (dz.x % 2 === 0) ? -1 : 1, state: 'dead',
    walkPhase: 0,
  });
  z.deadAt = now - Math.min(1500, elapsed - dz.killedAt);
  dSpriteAt(dZombie, ctx, z, dz.x, GY, 1.0, now);
  // Pool
  ctx.fillStyle = 'rgba(110,5,5,0.5)';
  ctx.beginPath(); ctx.ellipse(dz.x, GY + 2, 16, 3.5, 0, 0, Math.PI * 2); ctx.fill();
}

function dFire(ctx, x, y, now, size = 1) {
  const flick = Math.sin(now / 90 + x) * 2;
  ctx.fillStyle = 'rgba(220,80,20,0.85)';
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x - 6 * size, y - 16 * size + flick); ctx.lineTo(x, y - 22 * size);
  ctx.lineTo(x + 6 * size, y - 16 * size - flick); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,200,60,0.75)';
  ctx.beginPath();
  ctx.moveTo(x, y - 3 * size); ctx.lineTo(x - 3 * size, y - 12 * size); ctx.lineTo(x, y - 18 * size);
  ctx.lineTo(x + 3 * size, y - 12 * size); ctx.closePath(); ctx.fill();
}

function dSmoke(ctx, x, y, now, alpha = 0.4, scale = 1) {
  const drift = (now / 80 + x) % 360;
  for (let i = 0; i < 4; i++) {
    const px = x + Math.sin(drift / 20 + i) * 6;
    const py = y - i * 7 * scale - drift * 0.04;
    ctx.fillStyle = `rgba(40,40,40,${alpha * (1 - i / 4)})`;
    ctx.beginPath(); ctx.arc(px, py, 8 * scale + i, 0, Math.PI * 2); ctx.fill();
  }
}

function centerText(ctx, text, y, opts = {}) {
  const fontSize = opts.size || 14;
  ctx.font = `${opts.weight || 'bold'} ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  if (opts.shadow) {
    ctx.fillStyle = `rgba(0,0,0,${opts.shadow})`;
    ctx.fillText(text, CW / 2 + 1, y + 1);
  }
  ctx.fillStyle = opts.color || '#e8f0e0';
  ctx.fillText(text, CW / 2, y);
  ctx.textAlign = 'left';
}

// Audio schedule for the cinematic.
function scheduleDefeatAudio(defeat, elapsed) {
  if (!defeat._fired) defeat._fired = new Set();
  if (!defeat.soundQ) defeat.soundQ = [];
  const fire = (k, cond, ev) => {
    if (!cond || defeat._fired.has(k)) return;
    defeat._fired.add(k); defeat.soundQ.push(ev);
  };
  // Phase 1 — breach: rising base-hits, wind.
  fire('windOn', elapsed > 50, { t: 'windStart', intensity: 0.6 });
  [400, 1200, 2200, 3100, 3900, 4500].forEach((tm, i) => {
    fire('bhit' + i, elapsed > tm, { t: 'bhit' });
  });
  // Phase 2 — overrun: gunshots galore + zombie attack noises.
  for (let i = 0; i < 18; i++) {
    fire('shot' + i, elapsed > 5100 + i * 320,
      { t: 'shot', w: (i % 4 === 0) ? 'shotgun' : (i % 2 === 0) ? 'rifle' : 'pistol' });
  }
  [5400, 6800, 8300, 9700, 11200].forEach((tm, i) => {
    fire('zatk' + i, elapsed > tm, { t: 'zatk' });
  });
  // Phase 3 — last stand: heroic chatter.
  for (let i = 0; i < 8; i++) {
    fire('shotLS' + i, elapsed > 12200 + i * 420,
      { t: 'shot', w: (i % 3 === 0) ? 'rifle' : 'pistol' });
  }
  // Phase 4 — silence: zombie groans drift in.
  [19500, 20800, 22200, 23300].forEach((tm, i) => {
    fire('groan' + i, elapsed > tm, { t: 'groan', now: elapsed, zt: 'walker' });
  });
  // Final wind-down
  fire('windOff', elapsed > DEFEAT_DURATION - 800, { t: 'windStop' });
}

// Per-defender scripted voice lines.
function scheduleDefenderVoices(defeat, elapsed) {
  if (!defeat._vfired) defeat._vfired = new Set();
  DEFENDERS.forEach((d, i) => {
    const k = 'voice' + i;
    if (defeat._vfired.has(k)) return;
    if (elapsed < d.hurtAt) return;
    defeat._vfired.add(k);
    pushRadio(defeat, 'defeat', { line: d.line, urgent: !!d.urgent, cooldown: 50 });
  });
}

// ── Shared scene helpers ───────────────────────────────────────
// Backdrop sky + burning city for the active-combat phases.
function dCombatBackdrop(ctx, elapsed, now, opts = {}) {
  const sg = ctx.createLinearGradient(0, 0, 0, GY - 40);
  sg.addColorStop(0, opts.skyTop || '#1a0808');
  sg.addColorStop(1, opts.skyBot || '#3a1a14');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY - 40);
  // Blood-tinted crescent moon
  ctx.fillStyle = '#cc7a5a';
  ctx.beginPath(); ctx.arc(740, 72, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = opts.skyTop || '#1a0808';
  ctx.beginPath(); ctx.arc(748, 68, 22, 0, Math.PI * 2); ctx.fill();
  // Distant burning city
  const seeds = [40, 120, 220, 320, 420, 520, 620, 720, 820];
  seeds.forEach((sx, i) => {
    const bh = 70 + (i * 41) % 90;
    ctx.fillStyle = '#0a0806'; ctx.fillRect(sx, GY - bh, 55, bh);
    if ((i + elapsed / 600 | 0) % 3 === 0) {
      dFire(ctx, sx + 25, GY - bh - 5, now, 0.6 + (i % 2) * 0.2);
      dSmoke(ctx, sx + 25, GY - bh - 24, now, 0.45, 0.9);
    }
  });
  // Ground (killzone road)
  ctx.fillStyle = '#1a1812'; ctx.fillRect(0, GY, CW, CH - GY);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath();
  ctx.moveTo(0, GY); ctx.lineTo(CW, GY); ctx.stroke();
}

// Wall, damaged proportionally to elapsed time. After OVERRUN phase
// the wall starts collapsing (rubble + a black breach gap).
function dCombatWall(ctx, elapsed) {
  const dmgFraction = Math.min(1, elapsed / 12000); // 0..1 over the
                                                      // first 12 s
  const wallHp = Math.max(2, 200 - dmgFraction * 200);
  dBase(ctx, wallHp, 200);
  // Cracks growing over time
  if (elapsed > 2500) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(WX - 30, GY - 70); ctx.lineTo(WX - 25, GY - 30);
    ctx.lineTo(WX - 32, GY - 8); ctx.stroke();
  }
  if (elapsed > 4000) {
    ctx.beginPath();
    ctx.moveTo(WX - 50, GY - 80); ctx.lineTo(WX - 34, GY - 40);
    ctx.lineTo(WX - 42, GY - 4); ctx.stroke();
  }
  // Breach gap once OVERRUN starts (>5 s)
  if (elapsed > 5500) {
    const gapW = Math.min(60, (elapsed - 5500) / 60);
    ctx.fillStyle = '#0a0806';
    ctx.fillRect(WX - 30 - gapW / 2, GY - 80, gapW, 80);
    // Jagged rubble in front
    ctx.fillStyle = '#1a1814';
    ctx.beginPath();
    ctx.moveTo(WX - 30 - gapW / 2, GY);
    ctx.lineTo(WX - 30 - gapW / 2 + 6, GY - 12);
    ctx.lineTo(WX - 30 - gapW / 2 + 14, GY - 6);
    ctx.lineTo(WX - 30 + gapW / 2 - 14, GY - 10);
    ctx.lineTo(WX - 30 + gapW / 2 - 4, GY - 4);
    ctx.lineTo(WX - 30 + gapW / 2, GY);
    ctx.closePath(); ctx.fill();
  }
}

// Smoke/fire patches inside the perimeter, growing as the wall falls.
function dInnerFires(ctx, elapsed, now) {
  if (elapsed < 6000) return;
  const intensity = Math.min(1, (elapsed - 6000) / 6000);
  const fires = [WX - 50, WX - 10, WX + 40, WX + 110, WX + 180];
  fires.forEach((fx, i) => {
    if (i / fires.length > intensity) return;
    dFire(ctx, fx, GY - 4, now, 0.9 + (i % 2) * 0.3);
    dSmoke(ctx, fx, GY - 24, now, 0.5, 1.1);
  });
}

// Background advancing horde — count grows with time, types harden
// as the fight wears on.
function dHordeWave(ctx, elapsed, now) {
  const tNorm = Math.min(1, elapsed / 16000);
  const total = Math.floor(8 + tNorm * 18);
  for (let i = 0; i < total; i++) {
    // Stagger their start times so they trickle in
    const startTime = (i * 800) % 6000;
    if (elapsed < startTime) continue;
    const tWalk = (elapsed - startTime) / 1000;
    const baseStartX = CW + 40 + (i * 18) % 200;
    const speed = 12 + (i % 5) * 4;
    const zx = baseStartX - tWalk * speed + Math.sin(now / 400 + i) * 2;
    // Don't draw past the defender line (those are mauling killer
    // zombies, handled separately)
    if (zx < WX + 240) continue;
    if (zx > CW + 20) continue;
    const ztype = (i % 7 === 0) && elapsed > 8000 ? 'tank'
                : (i % 4 === 0) ? 'runner'
                : 'walker';
    const z = mkZom({
      type: ztype, facing: -1, state: 'walk', walkPhase: i * 0.3,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }
  // After overrun, additional zombies INSIDE the perimeter (came
  // through the breach).
  if (elapsed > 6500) {
    const inside = Math.floor(((elapsed - 6500) / 600));
    for (let i = 0; i < Math.min(inside, 8); i++) {
      const zx = WX - 30 - i * 22 + Math.sin(now / 300 + i) * 2;
      if (zx < 30) continue;
      const z = mkZom({
        type: i % 4 === 0 ? 'runner' : 'walker',
        facing: 1, state: 'walk', walkPhase: i * 0.4,
      });
      dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
    }
  }
}

// The full action layer: defenders + killer zombies attached to
// fallen defenders + dead zombies on the ground + background wave.
function dActionLayer(ctx, elapsed, now) {
  // Dead zombies on the road first (so defenders + killers layer
  // on top).
  DEAD_ZOMBIES.forEach(dz => dGroundDeadZombie(ctx, dz, elapsed, now));
  // Background wave
  dHordeWave(ctx, elapsed, now);
  // Defenders (alive and fallen)
  DEFENDERS.forEach(d => dDefeatSoldier(ctx, d, elapsed, now));
  // Killer zombies on top of fallen defenders
  KILLERS.forEach(k => dKiller(ctx, k, elapsed, now));
}

// ── Phase renderers ────────────────────────────────────────────
// Each phase just sets up the right backdrop tint + screen accents
// and stamps the banner. The actual fight is driven by elapsed
// (cumulative) inside dActionLayer.
function dBreach(ctx, defeat, ph, now) {
  const elapsed = ph.local;
  dCombatBackdrop(ctx, elapsed, now);
  dCombatWall(ctx, elapsed);
  dActionLayer(ctx, elapsed, now);
  // Screen shake red flash on impacts later in the phase
  if (ph.t > 0.5 && (Math.floor(now / 600) % 2) === 0) {
    ctx.fillStyle = 'rgba(180,30,20,0.06)'; ctx.fillRect(0, 0, CW, CH);
  }
  // Banner
  const a = Math.min(1, ph.t * 4) - Math.max(0, (ph.t - 0.8) * 5);
  ctx.globalAlpha = Math.max(0, a);
  centerText(ctx, 'THE WALL IS BREACHED', 60, { size: 18, color: '#ff5544', shadow: 0.7 });
  centerText(ctx, '— hostile contact at the gate —', 80, { size: 11, color: '#ffaa88' });
  ctx.globalAlpha = 1;
}

function dOverrun(ctx, defeat, ph, now) {
  const elapsed = ph.local + PHASES.breach.end;
  dCombatBackdrop(ctx, elapsed, now, { skyTop: '#180606', skyBot: '#3a1410' });
  dCombatWall(ctx, elapsed);
  dInnerFires(ctx, elapsed, now);
  dActionLayer(ctx, elapsed, now);
  // Heavy hits: red flash
  if (Math.floor(now / 320) % 4 === 0) {
    ctx.fillStyle = 'rgba(180,30,20,0.08)'; ctx.fillRect(0, 0, CW, CH);
  }
  const a = Math.min(1, ph.t * 6) - Math.max(0, (ph.t - 0.85) * 7);
  ctx.globalAlpha = Math.max(0, a);
  centerText(ctx, 'PERIMETER OVERRUN', 60, { size: 18, color: '#ff5544', shadow: 0.7 });
  centerText(ctx, '— last positions, last bullets —', 80, { size: 11, color: '#ffaa88' });
  ctx.globalAlpha = 1;
}

function dLastStand(ctx, defeat, ph, now) {
  const elapsed = ph.local + PHASES.breach.end + (PHASES.overrun.end - PHASES.overrun.start);
  dCombatBackdrop(ctx, elapsed, now, { skyTop: '#0a0606', skyBot: '#1a1410' });
  dCombatWall(ctx, elapsed);
  dInnerFires(ctx, elapsed, now);
  dActionLayer(ctx, elapsed, now);
  // Pulsing red vignette during LAST STAND
  const pulse = 0.10 + 0.04 * Math.sin(now / 180);
  ctx.fillStyle = `rgba(180,20,20,${pulse})`; ctx.fillRect(0, 0, CW, CH);
  const a = Math.min(1, ph.t * 6) - Math.max(0, (ph.t - 0.85) * 7);
  ctx.globalAlpha = Math.max(0, a);
  centerText(ctx, 'LAST STAND', 60, { size: 18, color: '#ffaa44', shadow: 0.7 });
  centerText(ctx, '— one rifle, one mag, one wall —', 80, { size: 11, color: '#ffcc88' });
  ctx.globalAlpha = 1;
}

function dSilence(ctx, defeat, ph, now) {
  // Near-black, distant smoke. Only sounds remain.
  ctx.fillStyle = '#050404'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#0a0806'; ctx.fillRect(0, GY, CW, CH - GY);
  // The wall has fallen — only jagged stubs remain
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(0, GY - 30, 28, 30);    // left stub
  ctx.fillRect(WX - 14, GY - 22, 14, 22); // middle remnant
  ctx.fillRect(WX + 8, GY - 12, 10, 12);  // right tip
  // Smouldering rubble + dust
  dSmoke(ctx, WX - 60, GY - 6, now, 0.42, 1.3);
  dSmoke(ctx, WX, GY - 6, now, 0.38, 1.2);
  dSmoke(ctx, WX + 80, GY - 6, now, 0.35, 1.1);
  dSmoke(ctx, WX + 180, GY - 6, now, 0.28, 0.9);

  // Defenders left where they fell (using the same x-positions as
  // their final death poses). dDefeatSoldier already handles the
  // 'dead' state past fallAt — we just call it with a high enough
  // elapsed value.
  const elapsedFinal = PHASES.silence.end; // everyone dead by this t
  DEFENDERS.forEach(d => dDefeatSoldier(ctx, d, elapsedFinal, now));
  // Killer zombies + the rest of the dead litter the scene too
  KILLERS.forEach(k => dKiller(ctx, k, elapsedFinal, now));
  DEAD_ZOMBIES.forEach(dz => dGroundDeadZombie(ctx, dz, elapsedFinal, now));

  // A few extra zombies shambling among the dead — real sprites
  for (let i = 0; i < 5; i++) {
    const zx = WX - 100 + i * 70 + Math.sin(now / 500 + i) * 6;
    const z = mkZom({
      type: 'walker', facing: i % 2 === 0 ? 1 : -1,
      state: 'walk', walkPhase: i * 0.5,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }

  // Title card
  const titleA  = Math.min(1, Math.max(0, (ph.local - 500)  / 1200));
  const sub1A   = Math.min(1, Math.max(0, (ph.local - 1900) / 1400));
  const sub2A   = Math.min(1, Math.max(0, (ph.local - 3400) / 1400));
  ctx.globalAlpha = titleA;
  ctx.fillStyle = '#e8d0a0'; ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center';
  ctx.shadowColor = '#cc2222'; ctx.shadowBlur = 18;
  ctx.fillText('FORT OMEGA HAS FALLEN', CW / 2, 130);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#cc6644'; ctx.font = '11px monospace';
  ctx.fillText('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', CW / 2, 150);
  ctx.textAlign = 'left';

  ctx.globalAlpha = sub1A;
  centerText(ctx, 'THEY HELD UNTIL THE LAST ROUND',  178, { size: 13, color: '#ccc6b0', shadow: 0.5 });
  ctx.globalAlpha = sub2A;
  centerText(ctx, '— no relief ever came —',         206, { size: 11, color: '#cc9988', weight: 'normal' });
  ctx.globalAlpha = 1;
}

export function dDefeatScene(ctx, defeat, now) {
  const elapsed = now - (defeat.startedAt || now);
  scheduleDefeatAudio(defeat, elapsed);
  scheduleDefenderVoices(defeat, elapsed);

  const ph = phaseAt(Math.min(elapsed, DEFEAT_DURATION));
  ctx.save(); ctx.clearRect(0, 0, CW, CH);
  if      (ph.name === 'breach')    dBreach(ctx, defeat, ph, now);
  else if (ph.name === 'overrun')   dOverrun(ctx, defeat, ph, now);
  else if (ph.name === 'lastStand') dLastStand(ctx, defeat, ph, now);
  else                              dSilence(ctx, defeat, ph, now);

  // Letterboxing
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, 22);
  ctx.fillRect(0, CH - 22, CW, 22);

  // Progress bar
  const prog = Math.min(1, elapsed / DEFEAT_DURATION);
  ctx.fillStyle = 'rgba(200,80,60,0.50)';
  ctx.fillRect(20, CH - 14, (CW - 40) * prog, 2);

  // SKIP button (top-right)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(CW - 96, 28, 80, 22);
  ctx.strokeStyle = C.uib; ctx.strokeRect(CW - 96, 28, 80, 22);
  ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('SKIP →', CW - 56, 43); ctx.textAlign = 'left';
  defeat._skipBtn = { x: CW - 96, y: 28, w: 80, h: 22 };

  // Radio subtitle for the defender voice lines.
  dRadioSubtitle(ctx, defeat, now);

  ctx.restore();
}
