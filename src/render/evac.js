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

// Helicopter polygon. Drawn in world coords; caller passes (cx, cy) for
// the body centre. Rotor spin is now-driven so it animates without state.
function dHelicopter(ctx, cx, cy, now, opts = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  if (opts.facing === -1) ctx.scale(-1, 1);

  // Landing skids
  ctx.strokeStyle = '#1a1814'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-22, 22); ctx.lineTo(22, 22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-16, 18); ctx.lineTo(-22, 22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(16, 18); ctx.lineTo(22, 22); ctx.stroke();

  // Tail boom
  ctx.fillStyle = '#3a4438';
  ctx.beginPath();
  ctx.moveTo(18, -6); ctx.lineTo(54, -2); ctx.lineTo(54, 4); ctx.lineTo(18, 6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a3328'; ctx.fillRect(18, -6, 36, 1.5); // top edge highlight

  // Tail fin
  ctx.fillStyle = '#3a4438';
  ctx.beginPath();
  ctx.moveTo(50, -2); ctx.lineTo(58, -10); ctx.lineTo(58, -2);
  ctx.closePath(); ctx.fill();

  // Tail rotor (small, fast)
  ctx.save(); ctx.translate(56, 1); ctx.rotate(now / 18);
  ctx.fillStyle = '#181614';
  ctx.fillRect(-5, -0.8, 10, 1.6); ctx.fillRect(-0.8, -5, 1.6, 10);
  ctx.restore();

  // Main body
  ctx.fillStyle = '#42503e';
  ctx.beginPath();
  ctx.moveTo(-22, -10); ctx.lineTo(18, -10); ctx.lineTo(22, 0);
  ctx.lineTo(18, 14); ctx.lineTo(-22, 14); ctx.lineTo(-26, 4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#384631';
  ctx.fillRect(-22, 12, 40, 2);

  // Cockpit window (tinted glass)
  ctx.fillStyle = '#1a3a52';
  ctx.beginPath();
  ctx.moveTo(-26, 0); ctx.lineTo(-22, -8); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(180,220,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(-22, -7); ctx.lineTo(-7, -7); ctx.lineTo(-9, -3); ctx.lineTo(-22, -3);
  ctx.closePath(); ctx.fill();

  // Side door (open if boarding)
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(2, -6, 12, 14);
  if (opts.doorOpen) {
    ctx.fillStyle = '#0a0808'; ctx.fillRect(3, -5, 10, 12);
    // Floor light
    ctx.fillStyle = 'rgba(255,210,120,0.35)';
    ctx.fillRect(2, 7, 12, 2);
  }

  // Rotor mast
  ctx.fillStyle = '#181614';
  ctx.fillRect(-2, -14, 4, 6);

  // Main rotor — fast spin via blur stripes
  const rot = now / 7;
  ctx.save(); ctx.translate(0, -16);
  for (let i = 0; i < 3; i++) {
    const a = rot + i * (Math.PI * 2 / 3);
    ctx.save(); ctx.rotate(a);
    ctx.fillStyle = 'rgba(20,18,16,0.85)'; ctx.fillRect(-46, -1.2, 92, 2.4);
    ctx.restore();
  }
  // Motion-blur disk
  ctx.fillStyle = 'rgba(40,40,40,0.18)';
  ctx.beginPath(); ctx.ellipse(0, 0, 48, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Marker / red blink under the body
  const blink = (Math.floor(now / 280) % 2) ? 1 : 0.3;
  ctx.fillStyle = `rgba(220,40,30,${blink})`;
  ctx.beginPath(); ctx.arc(0, 18, 1.6, 0, Math.PI * 2); ctx.fill();

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

export function dEvacScene(ctx, evac, now) {
  // Background + base reused from the siege scene so the player sees
  // Fort Omega in the same posture they're used to.
  ctx.save(); ctx.clearRect(0, 0, CW, CH);
  dBg(ctx);
  dBase(ctx, evac.baseHp ?? 200, evac.baseMaxHp ?? 200);

  const elapsed = now - (evac.startedAt || now);
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
        const cx = baseX + (heliX + 4 - baseX) * climbT;
        const cy = baseY + (heliY + 8 - baseY) * climbT;
        dEvacCivilian(ctx, cx, cy, now + i * 130);
        // Rope from helicopter
        ctx.strokeStyle = 'rgba(200,200,160,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(heliX + 6, heliY + 8); ctx.lineTo(cx, cy + 4); ctx.stroke();
      }
    }
    // After PHASE_BOARD: civilians are aboard, no more sprites
  }

  // Helicopter on top
  dHelicopter(ctx, heliX, heliY, now, { doorOpen });

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
