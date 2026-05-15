import { C, CW, CH, GY, WX } from '../constants.js';
import { dBg } from './background.js';
import { dBase } from './base.js';

// Animation total duration in ms. Split into three phases.
export const EVAC_DURATION = 5400;
const PHASE_ARRIVE = 1500;          // 0 – 1500 ms
const PHASE_BOARD  = 4000;          // 1500 – 4000 ms (civilians climb)
// Phase LEAVE: 4000 – 5400 ms

// Hover x-position above Fort Omega (centred over the wall + a bit out)
const HOVER_X = WX + 50;
const HOVER_Y = GY - 130;

// Procedural UH-60 Black Hawk silhouette: cockpit on the right (facing
// direction of travel), 4-blade main rotor, twin engine humps, tail
// boom with horizontal stabilizer + side-mounted tail rotor, military
// wheel landing gear, white army-star insignia, nav lights.
function dHelicopter(ctx, cx, cy, now, opts = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  if (opts.facing === -1) ctx.scale(-1, 1);

  const HULL_LIT  = '#3a4a30';   // top highlight
  const HULL      = '#2a3826';   // base olive drab
  const HULL_SH   = '#1f2818';   // shadow
  const HULL_DK   = '#0e1408';   // panel lines / very dark
  const GLASS     = '#0a1418';   // tinted cockpit glass
  const GLASS_HI  = 'rgba(150,190,220,0.30)';
  const METAL     = '#181614';

  // ── Landing wheels (military). 2 rear + 1 front, struts visible.
  ctx.strokeStyle = HULL_DK; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-14, 14); ctx.lineTo(-14, 21); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(  2, 14); ctx.lineTo(  2, 21); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( 22, 14); ctx.lineTo( 22, 20); ctx.stroke();
  ctx.fillStyle = METAL;
  ctx.beginPath(); ctx.ellipse(-14, 22, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(  2, 22, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( 22, 21, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3530';
  ctx.beginPath(); ctx.arc(-14, 22, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(  2, 22, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( 22, 21, 1.2, 0, Math.PI * 2); ctx.fill();

  // ── Tail boom: long tapering tube to the back-left
  ctx.fillStyle = HULL;
  ctx.beginPath();
  ctx.moveTo(-12, -2); ctx.lineTo(-58, 0);
  ctx.lineTo(-58, 4);  ctx.lineTo(-12, 6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = HULL_SH;
  ctx.beginPath();
  ctx.moveTo(-12, 4); ctx.lineTo(-58, 3); ctx.lineTo(-58, 4); ctx.lineTo(-12, 6);
  ctx.closePath(); ctx.fill();
  // Boom highlight line
  ctx.fillStyle = HULL_LIT;
  ctx.fillRect(-58, -0.5, 46, 0.8);

  // ── Horizontal stabilizer (the little wing near the tail)
  ctx.fillStyle = HULL_SH;
  ctx.fillRect(-54, -3, 14, 2);
  ctx.fillStyle = HULL;
  ctx.fillRect(-54, -4, 14, 1);

  // ── Tail fin (vertical) with end-mounted tail rotor
  ctx.fillStyle = HULL_SH;
  ctx.beginPath();
  ctx.moveTo(-58, 0); ctx.lineTo(-67, -10);
  ctx.lineTo(-63, -10); ctx.lineTo(-56, 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = HULL_DK;
  ctx.fillRect(-66, -10, 4, 1.2);

  // Tail rotor disk (smaller + spinning faster)
  ctx.save();
  ctx.translate(-64, -5); ctx.rotate(now / 10);
  ctx.fillStyle = METAL;
  ctx.fillRect(-7, -0.9, 14, 1.8);
  ctx.fillRect(-0.9, -7, 1.8, 14);
  ctx.restore();
  ctx.fillStyle = HULL_DK;
  ctx.beginPath(); ctx.arc(-64, -5, 1.8, 0, Math.PI * 2); ctx.fill();

  // ── Main fuselage: angular with raked nose to the right.
  ctx.fillStyle = HULL;
  ctx.beginPath();
  ctx.moveTo(-14, -10);  // top-back
  ctx.lineTo( 18, -10);  // top-front (pre-nose break)
  ctx.lineTo( 28,  -6);  // upper nose
  ctx.lineTo( 34,   2);  // nose tip
  ctx.lineTo( 30,  10);  // lower nose
  ctx.lineTo( 20,  14);  // bottom-front
  ctx.lineTo(-14,  14);  // bottom-back
  ctx.closePath(); ctx.fill();
  // Underside shadow
  ctx.fillStyle = HULL_SH;
  ctx.beginPath();
  ctx.moveTo(-14, 11); ctx.lineTo(22, 11);
  ctx.lineTo(20, 14);  ctx.lineTo(-14, 14);
  ctx.closePath(); ctx.fill();
  // Top highlight strip
  ctx.fillStyle = HULL_LIT;
  ctx.fillRect(-14, -10, 32, 1.5);
  // Panel line
  ctx.fillStyle = HULL_DK;
  ctx.fillRect(-14, 1, 32, 0.8);

  // ── Engine compartment + twin engine humps on the spine
  ctx.fillStyle = HULL_SH;
  ctx.fillRect(-10, -15, 22, 6);
  ctx.fillStyle = HULL;
  ctx.beginPath(); ctx.ellipse(-4, -13, 6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( 8, -13, 6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  // Exhaust ports
  ctx.fillStyle = HULL_DK;
  ctx.fillRect(-9, -11, 2.5, 2);
  ctx.fillRect( 3, -11, 2.5, 2);
  // Exhaust glow when arriving / departing (engine running hot)
  if (opts.engineGlow) {
    ctx.fillStyle = 'rgba(255,160,60,0.6)';
    ctx.beginPath(); ctx.arc(-8, -10, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( 4, -10, 1.1, 0, Math.PI * 2); ctx.fill();
  }

  // ── Cockpit windshield (front, slanted) + side window
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(20, -10); ctx.lineTo(28, -6);
  ctx.lineTo(28,  4);  ctx.lineTo(20,  0);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(8, -8, 12, 6);
  // Glass reflections
  ctx.fillStyle = GLASS_HI;
  ctx.beginPath();
  ctx.moveTo(21, -9); ctx.lineTo(27, -6); ctx.lineTo(26, -3); ctx.lineTo(21, -5);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(9, -7, 10, 1.5);
  // Window frame between front + side
  ctx.fillStyle = METAL;
  ctx.fillRect(19, -8, 1.5, 8);

  // ── Cargo door on the rear-left of the body
  if (opts.doorOpen) {
    ctx.fillStyle = '#080a06';
    ctx.fillRect(-12, -4, 14, 16);
    // Cabin floor light spill
    ctx.fillStyle = 'rgba(255,200,110,0.35)';
    ctx.fillRect(-12, 8, 14, 4);
    ctx.strokeStyle = HULL_DK; ctx.lineWidth = 1;
    ctx.strokeRect(-12, -4, 14, 16);
  } else {
    ctx.fillStyle = HULL_SH;
    ctx.fillRect(-12, -4, 14, 16);
    ctx.fillStyle = GLASS;
    ctx.fillRect(-10, -2, 10, 4);
    ctx.strokeStyle = HULL_DK; ctx.lineWidth = 0.8;
    ctx.strokeRect(-12, -4, 14, 16);
  }

  // ── Army-style white star insignia on the side
  const drawStar = (sx, sy, r) => {
    ctx.fillStyle = '#dde2d0';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = (i % 2 === 0) ? r : r * 0.45;
      const px = sx + Math.cos(a) * rr;
      const py = sy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    // Surrounding bar (USAF / USA-style flanking stripes)
    ctx.fillRect(sx - r * 2.2, sy - r * 0.45, r * 0.9, r * 0.9);
    ctx.fillRect(sx + r * 1.3, sy - r * 0.45, r * 0.9, r * 0.9);
  };
  drawStar(6, 5, 3.2);

  // Stencil-style hull number
  ctx.fillStyle = '#dde2d0'; ctx.font = 'bold 4px monospace';
  ctx.fillText('OMEGA-1', -10, -5);

  // ── Rotor mast assembly
  ctx.fillStyle = HULL_DK; ctx.fillRect(-2, -20, 4, 6);
  ctx.fillStyle = METAL;
  ctx.beginPath(); ctx.arc(0, -20, 2.8, 0, Math.PI * 2); ctx.fill();

  // ── Main rotor: 4 blades with motion blur and metallic tips
  const rot = now / 7;
  ctx.save(); ctx.translate(0, -22);
  for (let i = 0; i < 4; i++) {
    const a = rot + i * (Math.PI / 2);
    ctx.save(); ctx.rotate(a);
    ctx.fillStyle = 'rgba(18,16,14,0.78)';
    ctx.fillRect(-52, -1.3, 104, 2.6);
    // Bright metal blade tip
    ctx.fillStyle = 'rgba(180,180,170,0.75)';
    ctx.fillRect(46, -1.3, 6, 2.6);
    ctx.restore();
  }
  // Wide-area motion blur disk
  ctx.fillStyle = 'rgba(40,40,40,0.18)';
  ctx.beginPath(); ctx.ellipse(0, 0, 54, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  // Hub
  ctx.fillStyle = '#0a0c08';
  ctx.beginPath(); ctx.arc(0, 0, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ── Nav / anti-collision lights
  // Red beacon on tail (blinks ~2 Hz)
  const blinkR = (Math.floor(now / 280) % 2) ? 1 : 0.28;
  ctx.fillStyle = `rgba(220,40,30,${blinkR})`;
  ctx.beginPath(); ctx.arc(-58, -2, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(255,90,80,${blinkR * 0.5})`;
  ctx.beginPath(); ctx.arc(-58, -2, 3, 0, Math.PI * 2); ctx.fill();
  // Green starboard nav on the nose
  const blinkG = (Math.floor(now / 350) % 2) ? 0.9 : 0.35;
  ctx.fillStyle = `rgba(60,220,90,${blinkG})`;
  ctx.beginPath(); ctx.arc(31, 9, 1.4, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// Tiny civilian silhouette — used for the boarding queue beside the wall.
function dEvacCivilian(ctx, x, y, t) {
  ctx.save(); ctx.translate(x, y);
  // Body
  ctx.fillStyle = '#5a3a28'; ctx.fillRect(-4, -10, 8, 10);
  // Legs (small walk wobble)
  const wob = Math.sin(t / 180) * 1;
  ctx.fillStyle = '#3a4858'; ctx.fillRect(-3, 0, 3, 6); ctx.fillRect(0, 0, 3, 6);
  ctx.fillStyle = '#171210'; ctx.fillRect(-3, 5, 3, 2); ctx.fillRect(0, 5, 3, 2);
  // Head
  ctx.fillStyle = '#bf8a6a'; ctx.beginPath(); ctx.arc(0, -13, 3, 0, Math.PI * 2); ctx.fill();
  // Red baseball cap
  ctx.fillStyle = '#a04020'; ctx.beginPath(); ctx.arc(0, -14, 3.2, Math.PI, 0); ctx.fill();
  ctx.fillRect(-3, -14, 6, 1.5);
  // Subtle bob (panic / cold)
  void wob;
  ctx.restore();
}

// Schedules audio for the evac cinematic: rotor loop kicks in
// immediately and runs through the whole sequence, with the volume
// stepping up as the chopper closes the distance to the LZ.
function scheduleEvacAudio(evac, elapsed) {
  if (!evac._fired) evac._fired = new Set();
  if (!evac.soundQ) evac.soundQ = [];
  const fire = (k, cond, ev) => {
    if (!cond || evac._fired.has(k)) return;
    evac._fired.add(k); evac.soundQ.push(ev);
  };
  // Distant rotor as the chopper enters from off-screen.
  fire('heliFar', elapsed > 50,   { t: 'heliStart', intensity: 0.55 });
  // Close-in rotor once it's on station (slight delay to feel like a
  // gain ramp — heliStop+restart gives a louder layer over the same loop).
  fire('heliStop1', elapsed > 1300, { t: 'heliStop' });
  fire('heliNear',  elapsed > 1450, { t: 'heliStart', intensity: 1.0 });
  // Stop when the helicopter is gone.
  fire('heliOff',   elapsed >= EVAC_DURATION - 200, { t: 'heliStop' });
}

export function dEvacScene(ctx, evac, now) {
  // Background + base reused from the siege scene so the player sees
  // Fort Omega in the same posture they're used to.
  ctx.save(); ctx.clearRect(0, 0, CW, CH);
  dBg(ctx);
  dBase(ctx, evac.baseHp ?? 200, evac.baseMaxHp ?? 200);

  const elapsed = now - (evac.startedAt || now);
  scheduleEvacAudio(evac, elapsed);
  let heliX, doorOpen = false;
  if (elapsed < PHASE_ARRIVE) {
    // Arriving — slide in from off-screen left
    const t = elapsed / PHASE_ARRIVE;
    const ease = 1 - Math.pow(1 - t, 2);
    heliX = -140 + (HOVER_X - (-140)) * ease;
  } else if (elapsed < PHASE_BOARD) {
    // Hovering — gentle bob
    heliX = HOVER_X + Math.sin(elapsed / 320) * 1.5;
    doorOpen = true;
  } else {
    // Leaving — accelerate to the right, slight rise
    const t = Math.min(1, (elapsed - PHASE_BOARD) / (EVAC_DURATION - PHASE_BOARD));
    const ease = t * t;
    heliX = HOVER_X + (CW + 160 - HOVER_X) * ease;
  }
  const heliY = HOVER_Y + (elapsed > PHASE_BOARD ? -((elapsed - PHASE_BOARD) / 100) : Math.sin(elapsed / 240) * 1.2);

  // Civilians: queued near the wall during arrive + board, climbing one
  // by one into the chopper during board. Once boarded they vanish.
  const civCount = evac.civCount || 0;
  for (let i = 0; i < civCount; i++) {
    const baseX = 18 + i * 14;
    const baseY = GY - 7;
    if (elapsed < PHASE_ARRIVE) {
      // Just stand near the wall
      dEvacCivilian(ctx, baseX, baseY, now + i * 130);
    } else if (elapsed < PHASE_BOARD) {
      // Stagger each civilian's climb across the boarding window
      const window = PHASE_BOARD - PHASE_ARRIVE;
      const slotDur = window / civCount;
      const myStart = PHASE_ARRIVE + i * slotDur;
      if (elapsed < myStart) {
        dEvacCivilian(ctx, baseX, baseY, now + i * 130);
      } else {
        const climbT = Math.min(1, (elapsed - myStart) / slotDur);
        if (climbT >= 0.95) continue; // boarded
        // Cargo door is on the rear-left of the body (local x = -12..+2).
        const doorX = heliX - 5, doorY = heliY + 4;
        const cx = baseX + (doorX - baseX) * climbT;
        const cy = baseY + (doorY - baseY) * climbT;
        dEvacCivilian(ctx, cx, cy, now + i * 130);
        // Rope from helicopter cargo door
        ctx.strokeStyle = 'rgba(200,200,160,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(doorX, doorY); ctx.lineTo(cx, cy + 4); ctx.stroke();
      }
    }
    // After PHASE_BOARD: civilians are aboard, no more sprites
  }

  // Ground shadow of the helicopter, scaled by altitude (faded the
  // higher the chopper is) and positioned right under the body.
  const groundY = GY - 1;
  const altitude = groundY - heliY;
  const shadowA = Math.max(0.05, 0.32 - altitude / 600);
  ctx.fillStyle = `rgba(0,0,0,${shadowA})`;
  ctx.beginPath();
  ctx.ellipse(heliX, groundY, 50 - altitude * 0.04, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Helicopter on top. Engine exhaust glow shows when running hot
  // (i.e. during the arrive and depart phases).
  const engineGlow = elapsed < PHASE_ARRIVE || elapsed >= PHASE_BOARD;
  dHelicopter(ctx, heliX, heliY, now, { doorOpen, engineGlow });

  // Spotlight cone (only while hovering)
  if (elapsed >= PHASE_ARRIVE && elapsed < PHASE_BOARD + 200) {
    ctx.save();
    const grd = ctx.createLinearGradient(heliX, heliY + 14, heliX, GY);
    grd.addColorStop(0, 'rgba(255,235,160,0.20)');
    grd.addColorStop(1, 'rgba(255,235,160,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(heliX - 6, heliY + 14);
    ctx.lineTo(heliX + 6, heliY + 14);
    ctx.lineTo(heliX + 36, GY);
    ctx.lineTo(heliX - 36, GY);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Top banner: status text
  ctx.fillStyle = 'rgba(0,0,0,0.74)'; ctx.fillRect(0, 0, CW, 38);
  ctx.strokeStyle = C.uib; ctx.lineWidth = 1; ctx.strokeRect(0, 0, CW, 38);
  ctx.fillStyle = '#88ddff'; ctx.font = 'bold 13px monospace';
  const status = elapsed < PHASE_ARRIVE
    ? '🚁 INBOUND — Stand clear of the LZ'
    : elapsed < PHASE_BOARD
      ? `🚁 BOARDING — ${civCount} civilian${civCount === 1 ? '' : 's'} extracting`
      : '🚁 DEPARTING — Safe transit confirmed';
  ctx.fillText(status, 14, 24);

  // Reward tally on the right
  ctx.fillStyle = '#cce6ff'; ctx.font = '11px monospace';
  const r = evac.reward || {};
  ctx.fillText(`+${r.food || 0} 🥫   +${r.medicine || 0} 💊   +${r.sniperAmmo || 0} 🎯`, CW - 240, 24);

  ctx.restore();
}
