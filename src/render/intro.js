import { C, CW, CH, GY, WX } from '../constants.js';
import { dBase } from './base.js';

// Pre-mission opening cinematic. ~28 seconds, 5 chained scenes that
// take the player from "city before the outbreak" through "police
// containment fails" to "Fort Omega is all that's left". Skippable.
export const INTRO_DURATION = 28000;

const PHASES = {
  normal:    { start: 0,     end: 5500  },
  panic:     { start: 5500,  end: 9500  },
  police:    { start: 9500,  end: 15500 },
  collapse:  { start: 15500, end: 20500 },
  fortOmega: { start: 20500, end: 28000 },
};

function phaseAt(t) {
  for (const [name, p] of Object.entries(PHASES)) {
    if (t >= p.start && t < p.end) return { name, t: (t - p.start) / (p.end - p.start), local: t - p.start };
  }
  return { name: 'fortOmega', t: 1, local: PHASES.fortOmega.end - PHASES.fortOmega.start };
}

// Eased fade helper for in/out transitions inside a phase.
const fadeIn  = (t, dur = 0.18) => Math.min(1, t / dur);
const fadeOut = (t, dur = 0.18) => Math.min(1, (1 - t) / dur);
const fade    = (t, inDur = 0.18, outDur = 0.18) => Math.min(fadeIn(t, inDur), fadeOut(t, outDur));

// ── Background helpers ──────────────────────────────────────────
function dSky(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, GY - 40);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, GY - 40);
}

function dGround(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, GY, 0, CH);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, GY, CW, CH - GY);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(CW, GY); ctx.stroke();
}

function dCityBuildings(ctx, tint = '#1c1f24', windowOn = 0.4) {
  // Procedural skyline. Same seed pattern across all phases so the
  // city's identity stays consistent as the scenes change.
  const seeds = [40, 95, 145, 220, 285, 350, 420, 495, 555, 625, 700, 775, 840];
  seeds.forEach((sx, i) => {
    const bw = 50 + (i * 17) % 38;
    const bh = 80 + (i * 47) % 110;
    ctx.fillStyle = tint;
    ctx.fillRect(sx, GY - bh, bw, bh);
    ctx.fillStyle = `rgba(255,225,140,${windowOn})`;
    for (let wx = sx + 6; wx < sx + bw - 4; wx += 12) {
      for (let wy = GY - bh + 10; wy < GY - 20; wy += 16) {
        if (Math.sin((sx + wx) * 0.13 + wy * 0.11) > -0.2) ctx.fillRect(wx, wy, 7, 8);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(sx, GY - bh, bw, 3);
  });
}

// ── Tiny actors (kept very simple so 10-20 fit easily) ─────────
function dPedestrian(ctx, x, y, t, hatColor = null) {
  const wob = Math.sin(t / 200) * 1.2;
  ctx.fillStyle = '#5a3a28'; ctx.fillRect(x - 4, y - 14, 8, 10);
  ctx.fillStyle = '#3a4858'; ctx.fillRect(x - 3, y - 4, 3, 6); ctx.fillRect(x, y - 4, 3, 6);
  ctx.fillStyle = '#171210'; ctx.fillRect(x - 3, y + 1, 3, 2); ctx.fillRect(x, y + 1, 3, 2);
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath(); ctx.arc(x, y - 17 + wob * 0.2, 3, 0, Math.PI * 2); ctx.fill();
  if (hatColor) {
    ctx.fillStyle = hatColor;
    ctx.beginPath(); ctx.arc(x, y - 18 + wob * 0.2, 3.2, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - 3, y - 18, 6, 1.5);
  }
}

function dIntroZombie(ctx, x, y, t) {
  const wob = Math.sin(t / 240) * 1.6;
  ctx.fillStyle = '#3d5a30'; ctx.fillRect(x - 4, y - 14, 8, 10);
  ctx.fillStyle = '#1a2014'; ctx.fillRect(x - 3, y - 4, 3, 6); ctx.fillRect(x, y - 4, 3, 6);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(x - 3, y + 1, 3, 2); ctx.fillRect(x, y + 1, 3, 2);
  ctx.fillStyle = '#5a7042';
  ctx.beginPath(); ctx.arc(x + wob * 0.3, y - 17, 3.2, 0, Math.PI * 2); ctx.fill();
  // Red eyes
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(x - 1.5 + wob * 0.3, y - 17, 1, 1);
  ctx.fillRect(x + 0.7 + wob * 0.3, y - 17, 1, 1);
  // Arms outstretched
  ctx.fillStyle = '#3d5a30';
  ctx.fillRect(x - 7, y - 11, 3, 2);
  ctx.fillRect(x + 4, y - 11, 3, 2);
}

function dPoliceOfficer(ctx, x, y, facing, t, firing = false) {
  const wob = Math.sin(t / 180) * 0.8;
  ctx.save(); ctx.translate(x, y); ctx.scale(facing, 1);
  // Body navy uniform
  ctx.fillStyle = '#1a2840'; ctx.fillRect(-4, -14, 8, 10);
  // Yellow vest stripe
  ctx.fillStyle = '#e0c040'; ctx.fillRect(-4, -10, 8, 1.5);
  ctx.fillStyle = '#1a2840'; ctx.fillRect(-3, -4, 3, 6); ctx.fillRect(0, -4, 3, 6);
  ctx.fillStyle = '#101010'; ctx.fillRect(-3, 1, 3, 2); ctx.fillRect(0, 1, 3, 2);
  // Head + cap
  ctx.fillStyle = '#bf8a6a';
  ctx.beginPath(); ctx.arc(0, -17 + wob * 0.3, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2840';
  ctx.fillRect(-3, -19, 6, 2);
  // Pistol + muzzle flash
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(3, -12, 5, 2);
  if (firing) {
    ctx.fillStyle = 'rgba(255,210,80,0.95)';
    ctx.beginPath();
    ctx.moveTo(9, -11); ctx.lineTo(15, -13); ctx.lineTo(15, -9); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function dPoliceCar(ctx, x, y, now) {
  // Body
  ctx.fillStyle = '#202028'; ctx.fillRect(x - 22, y - 14, 44, 9);
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x - 22, y - 9, 44, 4);
  // Cabin windows
  ctx.fillStyle = '#0a1418'; ctx.fillRect(x - 16, y - 13, 32, 5);
  // Light bar (blue/red flashing)
  const phase = Math.floor(now / 220) % 2;
  ctx.fillStyle = phase ? '#cc1818' : '#1a4ccc';
  ctx.fillRect(x - 10, y - 17, 9, 3);
  ctx.fillStyle = phase ? '#1a4ccc' : '#cc1818';
  ctx.fillRect(x + 1, y - 17, 9, 3);
  // Wheels
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(x - 14, y - 4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 14, y - 4, 4, 0, Math.PI * 2); ctx.fill();
  // "POLICE" stencil
  ctx.fillStyle = '#202028'; ctx.font = 'bold 5px monospace'; ctx.textAlign = 'center';
  ctx.fillText('POLICE', x, y - 5);
  ctx.textAlign = 'left';
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

function dDistantHelicopter(ctx, x, y, now) {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x - 6, y - 2, 12, 3);
  ctx.fillRect(x + 6, y - 1, 7, 1.5);
  ctx.fillRect(x + 11, y - 4, 1.5, 4);
  ctx.fillStyle = 'rgba(20,20,20,0.7)';
  const rot = now / 30;
  ctx.fillRect(x - 10 + Math.sin(rot) * 2, y - 5, 20, 1);
  ctx.fillRect(x - 10 - Math.sin(rot) * 2, y - 5, 20, 1);
}

// Centered text helper with optional shadow + letterspacing.
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

// ── Scene 1: normal city pre-outbreak ──────────────────────────
function dNormal(ctx, ph, now) {
  dSky(ctx, '#1a3450', '#4a4a3e');
  // Faint dawn sun
  ctx.fillStyle = 'rgba(255,210,140,0.45)';
  ctx.beginPath(); ctx.arc(720, 90, 28, 0, Math.PI * 2); ctx.fill();
  dCityBuildings(ctx, '#22262c', 0.55);
  dGround(ctx, '#2a2a2a', '#1a1a1a');
  // Lane markers
  ctx.strokeStyle = '#888'; ctx.setLineDash([12, 14]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, GY + 24); ctx.lineTo(CW, GY + 24); ctx.stroke();
  ctx.setLineDash([]);

  // Civilians walking right
  const offs = (now / 30) % CW;
  for (let i = 0; i < 5; i++) {
    const x = ((i * 200 + offs) % (CW + 80)) - 40;
    dPedestrian(ctx, x, GY - 4, now + i * 200);
  }
  // Title card fades in/out
  const a = fade(ph.t, 0.10, 0.15);
  ctx.globalAlpha = a;
  centerText(ctx, 'NEW HAVEN — POPULATION 2.4M', 60, { size: 16, shadow: 0.6 });
  centerText(ctx, '03:17 LOCAL · MARCH 14',       80, { size: 11, color: '#88ccff' });
  ctx.globalAlpha = 1;
}

// ── Scene 2: panic — outbreak begins ───────────────────────────
function dPanic(ctx, ph, now) {
  dSky(ctx, '#321010', '#3a2818');
  dCityBuildings(ctx, '#1a1814', 0.35);
  dGround(ctx, '#222', '#0a0a0a');
  // Red alert tint pulse
  const pulse = Math.sin(now / 250) * 0.5 + 0.5;
  ctx.fillStyle = `rgba(180,30,30,${0.06 + pulse * 0.10})`;
  ctx.fillRect(0, 0, CW, CH);

  // Civilians fleeing left
  for (let i = 0; i < 6; i++) {
    const x = CW - ((i * 130 + now / 18) % (CW + 80));
    dPedestrian(ctx, x, GY - 4, now + i * 200, '#cc4040');
  }
  // First zombies appearing from the right
  const zCount = Math.min(4, Math.floor(ph.local / 1200));
  for (let i = 0; i < zCount; i++) {
    const startX = CW - 30 - i * 50;
    const x = startX - (ph.local - i * 1200) / 80;
    dIntroZombie(ctx, x, GY - 4, now + i * 300);
  }
  const a = fade(ph.t, 0.18, 0.18);
  ctx.globalAlpha = a;
  centerText(ctx, '⚠ OUTBREAK CONFIRMED', 60, { size: 18, color: '#ff5544', shadow: 0.7 });
  centerText(ctx, 'CITY POLICE DISPATCHED · ALL UNITS', 80, { size: 11, color: '#ffaa88' });
  ctx.globalAlpha = 1;
}

// ── Scene 3: police containment line ───────────────────────────
function dPolice(ctx, ph, now) {
  dSky(ctx, '#2a1410', '#3a2418');
  dCityBuildings(ctx, '#1a1410', 0.25);
  dGround(ctx, '#1a1a1a', '#080808');

  // Police line: 2 cars + 4 officers on the left, zombies advancing
  // from the right. As the phase progresses, the line gets pushed.
  const push = Math.min(1, ph.t * 1.4) * 120;
  dPoliceCar(ctx, 80 + push * 0.4, GY - 2, now);
  dPoliceCar(ctx, 170 + push * 0.4, GY - 2, now);

  const officersX = [110, 140, 200, 235];
  officersX.forEach((ox, i) => {
    const fallen = ph.t > 0.55 && i === 3;
    const fallen2 = ph.t > 0.85 && i === 2;
    if (fallen || fallen2) {
      // Body on the ground
      ctx.fillStyle = '#1a2840';
      ctx.fillRect(ox + push * 0.4 - 8, GY - 5, 16, 4);
      ctx.fillStyle = 'rgba(110,5,5,0.6)';
      ctx.beginPath(); ctx.ellipse(ox + push * 0.4, GY - 1, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      const firing = Math.floor(now / 280 + i) % 2 === 0;
      dPoliceOfficer(ctx, ox + push * 0.4, GY - 4, 1, now + i * 110, firing);
      if (firing) {
        // Bullet streaks
        ctx.fillStyle = 'rgba(255,210,80,0.85)';
        ctx.fillRect(ox + push * 0.4 + 14, GY - 16, 10 + (i * 7) % 30, 1.5);
      }
    }
  });

  // Zombies pouring in from the right
  for (let i = 0; i < 10; i++) {
    const startX = CW + 40 + i * 32;
    const speed = 0.045 + (i % 3) * 0.012;
    const zx = startX - ph.local * speed;
    if (zx < 250 + push * 0.4) continue;
    dIntroZombie(ctx, zx, GY - 4, now + i * 200);
  }

  const a = fade(ph.t, 0.10, 0.18);
  ctx.globalAlpha = a;
  centerText(ctx, 'NHPD — CONTAINMENT LINE', 60, { size: 16, color: '#88aaff', shadow: 0.7 });
  centerText(ctx, '"Hold the perimeter. Civilians evacuate west."', 80, { size: 11, color: '#cce' });
  ctx.globalAlpha = 1;
}

// ── Scene 4: collapse ──────────────────────────────────────────
function dCollapse(ctx, ph, now) {
  dSky(ctx, '#1a0c08', '#3a1a10');
  dCityBuildings(ctx, '#0e0a06', 0.10);
  dGround(ctx, '#101010', '#040404');

  // Fires across the skyline
  const fires = [120, 240, 370, 520, 640, 770];
  fires.forEach((fx, i) => {
    dFire(ctx, fx, GY - 80 - (i % 3) * 18, now + i * 100, 1.2 + (i % 2) * 0.3);
    dSmoke(ctx, fx, GY - 100 - (i % 3) * 18, now + i * 90, 0.55, 1.4);
  });

  // Distant helicopter fleeing right-to-off-screen
  const hx = CW - ph.t * 200;
  const hy = 90 + Math.sin(ph.local / 600) * 6;
  if (hx > -20) dDistantHelicopter(ctx, hx, hy, now);

  // Rubble + dead figures in the foreground
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(220, GY - 4, 40, 4);
  ctx.fillRect(480, GY - 5, 50, 5);
  ctx.fillStyle = '#202028';
  ctx.fillRect(380, GY - 12, 30, 12); // wrecked car
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath(); ctx.arc(388, GY - 1, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(404, GY - 1, 3, 0, Math.PI * 2); ctx.fill();

  const a = fade(ph.t, 0.12, 0.18);
  ctx.globalAlpha = a;
  centerText(ctx, 'CITY LOST — EVACUATION FAILED', 60, { size: 16, color: '#ff6644', shadow: 0.7 });
  centerText(ctx, '0.3% OF CIVILIANS EXTRACTED · MILITARY FALLS BACK', 80, { size: 11, color: '#ffaa88' });
  ctx.globalAlpha = 1;
}

// ── Scene 5: Fort Omega — the last bulwark ─────────────────────
function dFortOmegaScene(ctx, ph, now) {
  dSky(ctx, '#080a18', '#1a1e2a');
  // Stars
  for (let i = 0; i < 50; i++) {
    const sx = (i * 173) % CW;
    const sy = (i * 97) % (GY - 90);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.14})`;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  // Crescent moon
  ctx.fillStyle = '#dde2d0';
  ctx.beginPath(); ctx.arc(740, 72, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1e2a';
  ctx.beginPath(); ctx.arc(748, 68, 22, 0, Math.PI * 2); ctx.fill();
  // Distant burning city to the right
  dCityBuildings(ctx, '#0a0a08', 0.05);
  // Faint orange horizon glow (city still burning)
  const grd = ctx.createLinearGradient(0, GY - 40, 0, GY);
  grd.addColorStop(0, 'rgba(120,40,15,0)');
  grd.addColorStop(1, 'rgba(180,60,20,0.45)');
  ctx.fillStyle = grd; ctx.fillRect(0, GY - 40, CW, 40);

  dGround(ctx, '#1a1814', '#070605');

  // Fort Omega in the foreground — re-use the actual siege wall renderer
  // so it matches the in-game silhouette pixel-for-pixel.
  dBase(ctx, 200, 200);

  // A couple of soldier silhouettes standing on the rampart
  const officerPos = [WX - 14, WX - 30, WX - 46];
  officerPos.forEach((ox, i) => {
    const wob = Math.sin(now / 380 + i) * 0.6;
    // Soldier outline
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(ox - 3, GY - 92 + wob, 6, 18);
    // Helmet
    ctx.fillStyle = '#1a2418';
    ctx.fillRect(ox - 3, GY - 95 + wob, 6, 3);
    // Rifle
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(ox - 6, GY - 86 + wob, 10, 1.2);
  });

  // Distant zombies pressing toward the wall (very small silhouettes)
  for (let i = 0; i < 6; i++) {
    const zx = CW - 40 - i * 35 + Math.sin(now / 600 + i) * 4;
    ctx.fillStyle = '#2a3a20';
    ctx.fillRect(zx, GY - 14, 4, 10);
    ctx.fillRect(zx - 1, GY - 17, 6, 3);
  }

  // Title card and tagline
  const titleA = Math.min(1, Math.max(0, (ph.local - 800) / 1200));
  const taglineA = Math.min(1, Math.max(0, (ph.local - 2400) / 1400));
  const subA    = Math.min(1, Math.max(0, (ph.local - 4200) / 1600));

  ctx.globalAlpha = titleA;
  ctx.fillStyle = '#dde2d0'; ctx.font = 'bold 42px monospace'; ctx.textAlign = 'center';
  ctx.shadowColor = '#cc4422'; ctx.shadowBlur = 16;
  ctx.fillText('DEAD PERIMETER', CW / 2, 120);
  ctx.shadowBlur = 0;
  ctx.font = '11px monospace'; ctx.fillStyle = '#ff8866';
  ctx.fillText('━━━━━━━━━━━━━━━━━━━━━━━━', CW / 2, 138);
  ctx.textAlign = 'left';

  ctx.globalAlpha = taglineA;
  centerText(ctx, 'FORT OMEGA — THE LAST PERIMETER',     162, { size: 14, color: '#cce6ff', shadow: 0.5 });
  centerText(ctx, '12 SOLDIERS · ONE WALL · NO RELIEF',  182, { size: 11, color: C.acc });

  ctx.globalAlpha = subA;
  centerText(ctx, 'DAY 1 · 23:47',                       210, { size: 11, color: '#88ccff' });
  centerText(ctx, '— hold what you can —',               228, { size: 10, color: '#cce', weight: 'normal' });
  ctx.globalAlpha = 1;
}

// Fire-once helper: queues an audio event the first time the
// condition flips true, keyed so repeated frames don't re-fire it.
function fireOnce(intro, key, condition, evt) {
  if (!condition) return;
  if (intro._fired.has(key)) return;
  intro._fired.add(key);
  intro.soundQ.push(evt);
}

// Schedules the soundtrack for the cinematic — looping ambients
// (cityHum / wind / heliRotor), one-shots (sirens, screams, fire
// crackles, gunshots) and the title sting on the Fort Omega beat.
function scheduleIntroAudio(intro, elapsed) {
  if (!intro._fired) intro._fired = new Set();
  if (!intro.soundQ) intro.soundQ = [];

  // Scene 1 — city ambient hum kicks in almost immediately.
  fireOnce(intro, 'hum', elapsed > 200, { t: 'cityHum' });

  // Scene 2 — panic. First screams as the outbreak hits.
  fireOnce(intro, 'scream1', elapsed > 5700, { t: 'scream' });
  fireOnce(intro, 'scream2', elapsed > 7100, { t: 'scream' });
  fireOnce(intro, 'scream3', elapsed > 8600, { t: 'scream' });

  // Scene 3 — police containment. Sirens, then sustained gunfire.
  fireOnce(intro, 'siren1', elapsed >  9500, { t: 'siren' });
  fireOnce(intro, 'siren2', elapsed > 11200, { t: 'siren' });
  fireOnce(intro, 'siren3', elapsed > 13400, { t: 'siren' });
  const shotTimes = [10200, 10650, 11150, 11700, 12250, 12750, 13300, 13900, 14500, 15050];
  shotTimes.forEach((tm, i) => {
    fireOnce(intro, 'shot' + i, elapsed > tm,
      { t: 'shot', w: (i % 3 === 0) ? 'rifle' : 'pistol' });
  });
  // Scream during the police phase too (officer / civvy going down)
  fireOnce(intro, 'screamP1', elapsed > 13200, { t: 'scream' });
  fireOnce(intro, 'screamP2', elapsed > 14600, { t: 'scream' });

  // Scene 4 — collapse. Drop the city hum, start wind, distant heli.
  fireOnce(intro, 'humOff',    elapsed > 15400, { t: 'cityHumStop' });
  fireOnce(intro, 'windOn',    elapsed > 15500, { t: 'windStart', intensity: 0.55 });
  fireOnce(intro, 'heliFar',   elapsed > 15800, { t: 'heliStart',  intensity: 0.32 });
  // Fire crackles staggered across the burning skyline
  [16100, 16800, 17500, 18300, 19000, 19700].forEach((tm, i) => {
    fireOnce(intro, 'crack' + i, elapsed > tm, { t: 'crackle' });
  });
  fireOnce(intro, 'heliFarOff', elapsed > 20100, { t: 'heliStop' });

  // Scene 5 — Fort Omega. Title sting, then drop the wind for the
  // hush that precedes the first wave.
  fireOnce(intro, 'sting',    elapsed > 21900, { t: 'titleSting' });
  fireOnce(intro, 'windOff',  elapsed > 26500, { t: 'windStop' });

  // Backstop: when the cinematic ends, make sure every loop is told
  // to stop even if the user skipped scenes via timing edge cases.
  if (elapsed >= INTRO_DURATION) {
    fireOnce(intro, 'finalHum',  true, { t: 'cityHumStop' });
    fireOnce(intro, 'finalWind', true, { t: 'windStop' });
    fireOnce(intro, 'finalHeli', true, { t: 'heliStop' });
  }
}

export function dIntroScene(ctx, intro, now) {
  const elapsed = now - (intro.startedAt || now);
  scheduleIntroAudio(intro, elapsed);
  const ph = phaseAt(Math.min(elapsed, INTRO_DURATION));
  ctx.save(); ctx.clearRect(0, 0, CW, CH);
  if      (ph.name === 'normal')    dNormal(ctx, ph, now);
  else if (ph.name === 'panic')     dPanic(ctx, ph, now);
  else if (ph.name === 'police')    dPolice(ctx, ph, now);
  else if (ph.name === 'collapse')  dCollapse(ctx, ph, now);
  else                              dFortOmegaScene(ctx, ph, now);

  // Letterboxing for that "cinematic" feel
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, 22);
  ctx.fillRect(0, CH - 22, CW, 22);

  // Progress bar across the bottom letterbox
  const prog = Math.min(1, elapsed / INTRO_DURATION);
  ctx.fillStyle = 'rgba(180,200,160,0.45)';
  ctx.fillRect(20, CH - 14, (CW - 40) * prog, 2);

  // SKIP hint top-right (clickable hit-rect set on the intro state)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(CW - 96, 28, 80, 22);
  ctx.strokeStyle = C.uib; ctx.strokeRect(CW - 96, 28, 80, 22);
  ctx.fillStyle = C.acc; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('SKIP →', CW - 56, 43); ctx.textAlign = 'left';
  intro._skipBtn = { x: CW - 96, y: 28, w: 80, h: 22 };

  ctx.restore();
}
