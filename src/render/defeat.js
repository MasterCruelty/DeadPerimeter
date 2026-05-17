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

// ── Scripted defenders: each falls at their scheduled time. ────
// Positions are slightly irregular so they don't read as a row.
// dipY shifts a soldier down so the parapet covers more of him
// (some defenders peek from cover, others stand more exposed).
const DEFENDERS = [
  { name: 'Bravo',   x: WX - 10, dipY:  0, scale: 0.88, weapon: 'rifle',   fallAt: 7500,  hurtAt: 6800, line: "I'm hit!" },
  { name: 'Charlie', x: WX - 36, dipY:  6, scale: 0.82, weapon: 'shotgun', fallAt: 11500, hurtAt: 10800, line: 'Mag dry!' },
  { name: 'Delta',   x: WX - 58, dipY:  2, scale: 0.84, weapon: 'pistol',  fallAt: 16500, hurtAt: 15500, line: "They're everywhere!", urgent: true },
  // The last man — Alpha — fires until the very end. Standing tallest
  // and on the inner-right corner near the watchtower.
  { name: 'Alpha',   x: WX - 78, dipY: -2, scale: 0.92, weapon: 'rifle',   fallAt: 21500, hurtAt: 20500, line: 'For Fort Omega!', urgent: true, hero: true },
];

// ── Actor renderers using the real in-game sprites ────────────
function dDefeatSoldier(ctx, d, elapsed, now) {
  const dead = elapsed >= d.fallAt;
  const dying = !dead && elapsed >= d.hurtAt;
  // Defenders stand on the wall TOP behind the parapet — feet at the
  // wall body top with a 12 px overlap so the crenellations hide
  // their boots and the figure reads as manning the wall, not
  // floating on it.
  const footY = GY - 148 + (d.dipY || 0);

  if (dead) {
    const sol = mkSold({
      name: d.name, weapon: d.weapon, facing: 1, state: 'dead',
      deadAt: d.fallAt,
    });
    dSpriteAt(dSoldier, ctx, sol, d.x, footY, d.scale || 0.85, now);
    // Pool of blood on the rampart
    ctx.fillStyle = 'rgba(110,5,5,0.55)';
    ctx.beginPath(); ctx.ellipse(d.x, footY + 2, 14 * (d.scale || 0.85), 3, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // Living: alternate idle/shoot for muzzle-flash sync, more frantic
  // when dying.
  const cadence = dying ? 110 : 180;
  const firing = Math.floor(now / cadence + d.x) % 2 === 0;
  const sol = mkSold({
    name: d.name, weapon: d.weapon, facing: 1,
    state: firing ? 'shoot' : 'idle',
    lastShot: now - 30,
    walkPhase: d.x * 0.05,
  });
  dSpriteAt(dSoldier, ctx, sol, d.x, footY, d.scale || 0.85, now);
  if (firing) {
    // Muzzle flash overlay tuned for ~0.85x scale (rifle barrel tip
    // ends roughly 18 px right of feet x, 36 px above).
    const fx = d.x + 22, fy = footY - 36;
    ctx.fillStyle = 'rgba(255,210,80,0.95)';
    ctx.beginPath();
    ctx.moveTo(fx, fy); ctx.lineTo(fx + 12, fy - 4);
    ctx.lineTo(fx + 12, fy + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,140,0.85)';
    ctx.fillRect(fx + 14, fy - 0.5, 24 + (d.x % 20), 1.4);
  }
}

function dGOZombie(ctx, x, y, t) {
  // y is GY-aligned floor in the call sites. Use a small scale so
  // a horde reads as many.
  const z = mkZom({
    type: 'walker', facing: -1, state: 'walk',
    walkPhase: (t * 0.001) + x * 0.01,
  });
  dSpriteAt(dZombie, ctx, z, x, y, 1.0, t);
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

// ── Phase renderers ────────────────────────────────────────────
function dBreach(ctx, defeat, ph, now) {
  // Night sky tinted angry red where the city burns.
  const sg = ctx.createLinearGradient(0, 0, 0, GY - 40);
  sg.addColorStop(0, '#1a0808'); sg.addColorStop(1, '#3a1a14');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY - 40);
  // Crescent moon — blood-tinted
  ctx.fillStyle = '#cc7a5a';
  ctx.beginPath(); ctx.arc(740, 72, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a0808';
  ctx.beginPath(); ctx.arc(748, 68, 22, 0, Math.PI * 2); ctx.fill();

  // Distant burning city
  const seeds = [40, 120, 220, 320, 420, 520, 620, 720, 820];
  seeds.forEach((sx, i) => {
    const bh = 70 + (i * 41) % 90;
    ctx.fillStyle = '#0a0806'; ctx.fillRect(sx, GY - bh, 55, bh);
    if ((i + ph.local / 600 | 0) % 3 === 0) {
      dFire(ctx, sx + 25, GY - bh - 5, now, 0.6 + (i % 2) * 0.2);
      dSmoke(ctx, sx + 25, GY - bh - 24, now, 0.45, 0.9);
    }
  });

  // Ground
  ctx.fillStyle = '#1a1812'; ctx.fillRect(0, GY, CW, CH - GY);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath();
  ctx.moveTo(0, GY); ctx.lineTo(CW, GY); ctx.stroke();

  // The wall — progressively battered. dBase shows damage already, so
  // we feed it dropping HP.
  const wallHp = Math.max(40, 200 - ph.t * 160);
  dBase(ctx, wallHp, 200);
  // Cracks growing over time
  if (ph.t > 0.4) {
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(WX + 4, GY - 70); ctx.lineTo(WX + 9, GY - 30); ctx.lineTo(WX + 2, GY - 8); ctx.stroke();
  }
  if (ph.t > 0.7) {
    ctx.beginPath(); ctx.moveTo(WX - 2, GY - 80); ctx.lineTo(WX + 14, GY - 40); ctx.lineTo(WX + 6, GY - 4); ctx.stroke();
  }

  // Defenders + zombies (real sprites)
  DEFENDERS.forEach(d => dDefeatSoldier(ctx, d, ph.local, now));
  // Parapet shadow under the defenders to anchor them
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, GY - 160, WX + 12, 12);
  // Zombies massing against the wall — real dZombie sprites at 1x
  // scale. Mix of types to feel like a real horde.
  const zCount = Math.floor(ph.t * 12) + 4;
  for (let i = 0; i < zCount; i++) {
    const zx = WX + 30 + i * 22 + Math.sin(now / 400 + i) * 3;
    if (zx > CW + 10) continue;
    const ztype = i % 6 === 0 ? 'tank' : i % 4 === 0 ? 'runner' : 'walker';
    const z = mkZom({ type: ztype, facing: -1, state: 'walk', walkPhase: i * 0.3 });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }

  // Screen shake on impact ticks
  if (ph.t > 0.3 && (Math.floor(now / 600) % 2) === 0) {
    ctx.fillStyle = 'rgba(180,30,20,0.06)'; ctx.fillRect(0, 0, CW, CH);
  }

  const a = Math.min(1, ph.t * 4) - Math.max(0, (ph.t - 0.8) * 5);
  ctx.globalAlpha = Math.max(0, a);
  centerText(ctx, 'THE WALL IS BREACHED', 60, { size: 18, color: '#ff5544', shadow: 0.7 });
  centerText(ctx, '— hostile contact at the gate —', 80, { size: 11, color: '#ffaa88' });
  ctx.globalAlpha = 1;
}

function dOverrun(ctx, defeat, ph, now) {
  // Same sky / city / ground baseline, more dire
  const sg = ctx.createLinearGradient(0, 0, 0, GY - 40);
  sg.addColorStop(0, '#180606'); sg.addColorStop(1, '#3a1410');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, GY - 40);
  ctx.fillStyle = '#0a0806'; ctx.fillRect(0, GY - 100, CW, 60); // distant city
  ctx.fillStyle = '#1a1410'; ctx.fillRect(0, GY, CW, CH - GY);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath();
  ctx.moveTo(0, GY); ctx.lineTo(CW, GY); ctx.stroke();
  // Fires inside the perimeter
  [WX + 60, WX + 120, WX + 200].forEach((fx, i) => {
    dFire(ctx, fx, GY - 6, now, 1.0 + (i % 2) * 0.3);
    dSmoke(ctx, fx, GY - 24, now, 0.5, 1.1);
  });

  // Wall is now collapsed / broken
  const wallHp = Math.max(0, 40 - ph.t * 40);
  dBase(ctx, wallHp, 200);
  // Big breach gap visualisation
  ctx.fillStyle = '#0a0806';
  ctx.fillRect(WX - 2, GY - 60, 26, 60);

  // Defenders firing wildly
  DEFENDERS.forEach(d => dDefeatSoldier(ctx, d, ph.local + PHASES.breach.end, now));

  // Zombies streaming THROUGH the wall (now inside the perimeter)
  const through = Math.floor(ph.t * 14);
  for (let i = 0; i < through; i++) {
    const zx = WX + 20 - i * 22 + Math.sin(now / 300 + i) * 2;
    if (zx < 30) continue;
    const z = mkZom({
      type: i % 5 === 0 ? 'tank' : i % 3 === 0 ? 'runner' : 'walker',
      facing: 1, state: 'walk', walkPhase: i * 0.3,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }
  // Outside zombies still pressing in through the breach
  for (let i = 0; i < 12; i++) {
    const zx = WX + 30 + i * 26 + Math.sin(now / 400 + i) * 3;
    if (zx > CW + 10) continue;
    const z = mkZom({
      type: i % 4 === 0 ? 'runner' : 'walker',
      facing: -1, state: 'walk', walkPhase: i * 0.4,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }

  // Red flash on heavy hits
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
  // Darker, claustrophobic
  ctx.fillStyle = '#0a0606'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#1a1410'; ctx.fillRect(0, GY, CW, CH - GY);
  // Sparse fires
  dFire(ctx, WX + 80, GY - 6, now, 0.9);
  dSmoke(ctx, WX + 80, GY - 22, now, 0.5, 1.1);

  // Crumbling wall remnants
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(WX - 8, GY - 36, 8, 36);  // jagged stub
  ctx.fillRect(WX + 18, GY - 22, 6, 22);

  // Only the hero defender still standing; the others are bodies
  const heroPhaseLocal = ph.local + PHASES.breach.end + (PHASES.overrun.end - PHASES.overrun.start);
  DEFENDERS.forEach(d => dDefeatSoldier(ctx, d, heroPhaseLocal, now));

  // Wave of zombies closing in from both sides (real dZombie sprites)
  const tideR = Math.floor(ph.t * 14);
  for (let i = 0; i < tideR; i++) {
    const zx = WX + 30 + i * 18 + Math.sin(now / 250 + i) * 2;
    if (zx > CW + 10) continue;
    const z = mkZom({
      type: i % 5 === 0 ? 'tank' : i % 3 === 0 ? 'runner' : 'walker',
      facing: -1, state: 'walk', walkPhase: i * 0.3,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }
  // Some that broke through earlier are now closer
  const tideL = Math.floor(ph.t * 7);
  for (let i = 0; i < tideL; i++) {
    const zx = WX - 90 - i * 20;
    if (zx < 10) continue;
    const z = mkZom({
      type: i % 4 === 0 ? 'runner' : 'walker',
      facing: 1, state: 'walk', walkPhase: i * 0.5,
    });
    dSpriteAt(dZombie, ctx, z, zx, GY, 1.0, now);
  }

  // Pulsing red vignette
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
  // Smouldering rubble
  dSmoke(ctx, WX, GY - 6, now, 0.42, 1.3);
  dSmoke(ctx, WX + 80, GY - 6, now, 0.35, 1.1);
  dSmoke(ctx, WX - 60, GY - 6, now, 0.28, 0.9);

  // Bodies on the ground — real dSoldier sprites in 'dead' state.
  // Scattered across the foreground, not the rampart (the rampart
  // collapsed in the prior phase).
  DEFENDERS.forEach((d, i) => {
    const bx = WX - 60 + i * 50;
    const sol = mkSold({
      name: d.name, weapon: d.weapon, facing: i % 2 === 0 ? 1 : -1,
      state: 'dead', deadAt: now - 8000,
    });
    dSpriteAt(dSoldier, ctx, sol, bx, GY, 0.95, now);
    ctx.fillStyle = 'rgba(110,5,5,0.45)';
    ctx.beginPath(); ctx.ellipse(bx, GY + 2, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
  });

  // A few zombies shambling among the dead — real sprites
  for (let i = 0; i < 5; i++) {
    const zx = WX - 80 + i * 50 + Math.sin(now / 500 + i) * 6;
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
