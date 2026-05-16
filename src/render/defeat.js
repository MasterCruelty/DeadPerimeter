import { C, CW, CH, GY, WX } from '../constants.js';
import { dBg } from './background.js';
import { dBase } from './base.js';
import { pushRadio, RADIO_LINES } from '../audio/radio.js';
import { dRadioSubtitle } from './hud.js';

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
const DEFENDERS = [
  { x: WX - 12, weapon: 'rifle',   fallAt: 7500,  hurtAt: 6800, line: "I'm hit!" },
  { x: WX - 32, weapon: 'shotgun', fallAt: 11500, hurtAt: 10800, line: "Mag dry!" },
  { x: WX - 50, weapon: 'pistol',  fallAt: 16500, hurtAt: 15500, line: "They're everywhere!", urgent: true },
  // The last man — Alpha — fires until the very end.
  { x: WX - 70, weapon: 'rifle',   fallAt: 21500, hurtAt: 20500, line: 'For Fort Omega!', urgent: true, hero: true },
];

// ── Tiny actors (same style as the intro for consistency) ──────
function dDefeatSoldier(ctx, d, elapsed, now) {
  const dead = elapsed >= d.fallAt;
  const dying = !dead && elapsed >= d.hurtAt;
  const x = d.x;
  const baseY = GY - 88; // standing on the rampart

  if (dead) {
    // Body lying on the rampart, blood pool
    ctx.fillStyle = 'rgba(110,5,5,0.55)';
    ctx.beginPath(); ctx.ellipse(x, baseY + 16, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a2418';
    ctx.fillRect(x - 9, baseY + 13, 18, 4);
    ctx.fillStyle = '#101010';
    ctx.fillRect(x - 11, baseY + 12, 4, 3);
    return;
  }

  // Standing
  const sway = Math.sin(now / 240 + d.x) * 0.6 + (dying ? Math.sin(now / 90) * 1.4 : 0);
  ctx.fillStyle = dying ? '#3a2418' : '#1a2418';
  ctx.fillRect(x - 3, baseY + sway, 6, 16);
  // Helmet
  ctx.fillStyle = dying ? '#3a2412' : '#1a1812';
  ctx.fillRect(x - 3, baseY - 3 + sway, 6, 3);
  // Rifle
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(x + 3, baseY + 4 + sway, 10, 1.4);
  // Muzzle flash if firing (random)
  const firing = !dying && Math.floor(now / 180 + d.x) % 3 === 0;
  if (firing) {
    ctx.fillStyle = 'rgba(255,210,80,0.95)';
    ctx.beginPath();
    ctx.moveTo(x + 13, baseY + 5 + sway);
    ctx.lineTo(x + 18, baseY + 3 + sway);
    ctx.lineTo(x + 18, baseY + 7 + sway);
    ctx.closePath(); ctx.fill();
    // Bullet streak
    ctx.fillStyle = 'rgba(255,210,80,0.85)';
    ctx.fillRect(x + 19, baseY + 5 + sway, 12 + (d.x % 20), 1.4);
  }
  // Blood smear if dying
  if (dying) {
    ctx.fillStyle = 'rgba(110,5,5,0.6)';
    ctx.fillRect(x - 3, baseY + 5 + sway, 6, 2);
  }
}

function dGOZombie(ctx, x, y, t) {
  const wob = Math.sin(t / 220 + x) * 1.4;
  ctx.fillStyle = '#3d5a30'; ctx.fillRect(x - 4, y - 14, 8, 10);
  ctx.fillStyle = '#1a2014'; ctx.fillRect(x - 3, y - 4, 3, 6); ctx.fillRect(x, y - 4, 3, 6);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(x - 3, y + 1, 3, 2); ctx.fillRect(x, y + 1, 3, 2);
  ctx.fillStyle = '#5a7042';
  ctx.beginPath(); ctx.arc(x + wob * 0.3, y - 17, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cc1818';
  ctx.fillRect(x - 1.5 + wob * 0.3, y - 17, 1, 1);
  ctx.fillRect(x + 0.7 + wob * 0.3, y - 17, 1, 1);
  ctx.fillStyle = '#3d5a30';
  ctx.fillRect(x - 7, y - 11, 3, 2);
  ctx.fillRect(x + 4, y - 11, 3, 2);
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

  // Defenders + zombies
  DEFENDERS.forEach(d => dDefeatSoldier(ctx, d, ph.local, now));
  // Zombies massing against the wall on the right side
  const zCount = Math.floor(ph.t * 14) + 4;
  for (let i = 0; i < zCount; i++) {
    const zx = WX + 30 + i * 18 + Math.sin(now / 400 + i) * 3;
    if (zx > CW + 10) continue;
    dGOZombie(ctx, zx, GY - 6, now + i * 130);
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

  // Zombies streaming THROUGH the wall (some on the inside now)
  const through = Math.floor(ph.t * 16);
  for (let i = 0; i < through; i++) {
    const zx = WX + 20 - i * 18 + Math.sin(now / 300 + i) * 2;
    if (zx < 30) continue;
    dGOZombie(ctx, zx, GY - 6, now + i * 130);
  }
  // Outside zombies still pressing
  for (let i = 0; i < 14; i++) {
    const zx = WX + 30 + i * 22 + Math.sin(now / 400 + i) * 3;
    if (zx > CW + 10) continue;
    dGOZombie(ctx, zx, GY - 6, now + i * 110);
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

  // Wave of zombies closing in from both sides
  const tideR = Math.floor(ph.t * 18);
  for (let i = 0; i < tideR; i++) {
    const zx = WX + 30 + i * 14 + Math.sin(now / 250 + i) * 2;
    if (zx > CW + 10) continue;
    dGOZombie(ctx, zx, GY - 6, now + i * 90);
  }
  // Some that broke through earlier are now closer
  const tideL = Math.floor(ph.t * 8);
  for (let i = 0; i < tideL; i++) {
    const zx = WX - 90 - i * 16;
    if (zx < 0) continue;
    dGOZombie(ctx, zx, GY - 6, now + i * 110);
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

  // Bodies on the ground
  DEFENDERS.forEach(d => {
    ctx.fillStyle = 'rgba(110,5,5,0.45)';
    ctx.beginPath(); ctx.ellipse(d.x, GY - 2, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1814';
    ctx.fillRect(d.x - 9, GY - 5, 18, 4);
  });

  // A few zombies shambling among the dead
  for (let i = 0; i < 5; i++) {
    const zx = WX - 80 + i * 50 + Math.sin(now / 500 + i) * 6;
    dGOZombie(ctx, zx, GY - 6, now + i * 220);
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
