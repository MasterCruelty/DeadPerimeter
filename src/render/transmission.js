import { CW, CH, GY, WX } from '../constants.js';
import { dBg } from './background.js';
import { dBase } from './base.js';
import { dHelicopter } from './evac.js';
import { t as tr } from '../i18n/index.js';

// Returns the line that should be visible at offsetMs, or null.
function currentLine(t, offsetMs) {
  let cur = null;
  for (const l of t.data.lines) {
    if (offsetMs >= l.at) cur = l; else break;
  }
  return cur;
}

// Soft text-wrap into 2 lines max so very long callouts stay readable.
function wrapTwo(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(' ');
  let l1 = '';
  for (let i = 0; i < words.length; i++) {
    const test = l1 ? `${l1} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxW) l1 = test;
    else return [l1, words.slice(i).join(' ')];
  }
  return [l1];
}

// Transmission cinematic (waves 10 / 20 / 25).
//
// Fort Omega at night fills the frame (same parallax city as the siege,
// dimmed), with a field-radio console in the top-left whose waveform
// pulses while Command speaks. When the drop starts a Black Hawk crosses
// the sky, releases a parachuted crate that lands in front of the wall
// with a dust burst, and the console logs it. Audio cues are scheduled
// here and drained by the game loop (t.soundQ).
const DROP_X = WX + 190;

function scheduleTxAudio(t, off) {
  if (!t._fired) t._fired = new Set();
  if (!t.soundQ) t.soundQ = [];
  const fire = (k, cond, ev) => { if (cond && !t._fired.has(k)) { t._fired.add(k); t.soundQ.push(ev); } };
  fire('static', off > 0, { t: 'staticStart', level: 0.8 });
  t.data.lines.forEach((l, i) => fire('sq' + i, off >= l.at - 60, { t: 'squelch' }));
  if (typeof t.data.dropAt === 'number') {
    fire('heliIn', off > t.data.dropAt - 1800, { t: 'heliStart', intensity: 0.7 });
    fire('heliOut', off > t.data.dropAt + 2600, { t: 'heliStop' });
    fire('thud', off > (t.data.landAt ?? t.data.dropAt + 4000), { t: 'thud' });
  }
  fire('staticOff', off > t.data.durMs - 600, { t: 'staticStop' });
}

export function dCrate(ctx, x, y, chute, now) {
  if (chute > 0) {
    ctx.save(); ctx.globalAlpha = chute;
    const sway = Math.sin(now / 420) * 0.08;
    ctx.translate(x, y); ctx.rotate(sway);
    // canopy
    const cg = ctx.createLinearGradient(0, -58, 0, -36);
    cg.addColorStop(0, '#e6e2d4'); cg.addColorStop(1, '#9a968a');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(-26, -36); ctx.quadraticCurveTo(-24, -62, 0, -64); ctx.quadraticCurveTo(24, -62, 26, -36);
    ctx.quadraticCurveTo(13, -42, 0, -38); ctx.quadraticCurveTo(-13, -42, -26, -36); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(200,200,190,0.7)'; ctx.lineWidth = 0.7;
    [[-26, -36], [-9, -39], [9, -39], [26, -36]].forEach(([px, py]) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px * 0.25, -8); ctx.stroke(); });
    ctx.restore();
  }
  ctx.save(); ctx.translate(x, y);
  const g = ctx.createLinearGradient(0, -10, 0, 8);
  g.addColorStop(0, '#6a5228'); g.addColorStop(1, '#3a2a10');
  ctx.fillStyle = 'rgba(6,6,4,0.9)'; ctx.fillRect(-13, -11, 26, 20);
  ctx.fillStyle = g; ctx.fillRect(-12, -10, 24, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-12, -3, 24, 2); ctx.fillRect(-1, -10, 2, 18);
  ctx.fillStyle = '#d8b040'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
  ctx.fillText('US ARMY', 0, 5); ctx.textAlign = 'left';
  ctx.restore();
}

export function dTransmissionScene(ctx, t, now) {
  const off = now - t.startedAt;
  scheduleTxAudio(t, off);

  // Fort Omega at night, dimmed so the radio UI reads on top.
  dBg(ctx, 0, now);
  dBase(ctx, 300, 300, now);
  ctx.fillStyle = 'rgba(0,6,2,0.45)'; ctx.fillRect(0, 0, CW, CH);

  // Supply drop: helicopter pass + crate.
  if (typeof t.data.dropAt === 'number') {
    const dropAt = t.data.dropAt, landAt = t.data.landAt ?? dropAt + 4000;
    const heliT = (off - (dropAt - 1800)) / 4400;
    if (heliT > 0 && heliT < 1) {
      const hx = -160 + (CW + 320) * heliT, hy = 120 + Math.sin(heliT * Math.PI) * -18;
      dHelicopter(ctx, hx, hy, now, { engineGlow: true, doorOpen: heliT > 0.3 && heliT < 0.6 });
    }
    if (off >= dropAt) {
      const p = Math.min(1, (off - dropAt) / Math.max(800, landAt - dropAt));
      const startX = -160 + (CW + 320) * (1800 / 4400), startY = 132;
      const ease = 1 - Math.pow(1 - p, 1.6);
      const cx = startX + (DROP_X - startX) * Math.min(1, p * 1.4);
      const cy = startY + (GY - 8 - startY) * ease;
      dCrate(ctx, cx, cy, p < 1 ? 1 : Math.max(0, 1 - (off - landAt) / 700), now);
      if (p >= 1) {
        const dt = Math.min(1, (off - landAt) / 900);
        ctx.fillStyle = `rgba(190,170,130,${0.45 * (1 - dt)})`;
        ctx.beginPath(); ctx.ellipse(DROP_X, GY + 2, 24 + dt * 30, 5 + dt * 3, 0, 0, Math.PI * 2); ctx.fill();
        // Smoke marker the squad pops for the pick-up
        for (let i = 0; i < 6; i++) {
          const k = ((now / 1400) + i / 6) % 1;
          ctx.fillStyle = `rgba(120,200,110,${0.25 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(DROP_X + 18 + k * 14, GY - 4 - k * 60, 4 + k * 12, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  // Header band
  ctx.fillStyle = 'rgba(4,12,6,0.88)'; ctx.fillRect(0, 26, CW, 54);
  ctx.fillStyle = '#22cc44'; ctx.fillRect(0, 26, CW, 1.5); ctx.fillRect(0, 79, CW, 1.5);
  ctx.fillStyle = '#22cc44'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
  ctx.fillText(tr(t.data.title), CW / 2, 52);
  ctx.fillStyle = '#88ee99'; ctx.font = '11px monospace';
  ctx.fillText(tr('{sender} · DAY {n} · ENCRYPTED', { sender: tr(t.data.sender), n: t.wave }), CW / 2, 70);
  if (Math.floor(off / 500) % 2 === 0) {
    ctx.fillStyle = '#dd2222';
    ctx.beginPath(); ctx.arc(CW - 60, 48, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('REC', CW - 50, 52);
  }
  ctx.textAlign = 'left';

  // Field-radio console with live waveform
  const line = currentLine(t, off);
  const since = line ? off - line.at : 9999;
  const speaking = !!line && since < Math.min(4200, 600 + line.text.length * 55);
  const px = 24, py = 94, pw = 300, ph = 86;
  ctx.fillStyle = 'rgba(8,16,10,0.9)'; ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#2a6a34'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  ctx.fillStyle = '#6aaa70'; ctx.font = '9px monospace';
  ctx.fillText('CH 7 · 148.250 MHz', px + 8, py + 14);
  ctx.fillText(speaking ? '◉ RX' : '○ STBY', px + pw - 52, py + 14);
  // signal bars
  for (let i = 0; i < 5; i++) {
    const on = speaking ? (i < 3 + Math.floor((Math.sin(now / 90) + 1) * 1.1)) : i < 2;
    ctx.fillStyle = on ? '#44dd66' : '#1a3a20';
    ctx.fillRect(px + pw - 92 + i * 6, py + 14 - i * 2 - 3, 4, i * 2 + 3);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(px + 6, py + 20, pw - 12, ph - 26); ctx.clip();
  ctx.strokeStyle = 'rgba(40,120,60,0.25)'; ctx.lineWidth = 0.5;
  for (let gx = px + 6; gx < px + pw; gx += 16) { ctx.beginPath(); ctx.moveTo(gx, py + 20); ctx.lineTo(gx, py + ph); ctx.stroke(); }
  const wfY = py + 20 + (ph - 26) / 2;
  ctx.strokeStyle = speaking ? '#44ee66' : '#1e5a28'; ctx.lineWidth = 1.6;
  ctx.shadowColor = '#44ee66'; ctx.shadowBlur = speaking ? 6 : 0;
  ctx.beginPath();
  for (let x = px + 6; x < px + pw - 6; x += 2) {
    const amp = speaking
      ? (Math.sin(x * 0.09 + now * 0.02) * 12 + Math.sin(x * 0.23 + now * 0.031) * 6) * (0.6 + 0.4 * Math.sin(now / 130))
      : Math.sin(x * 0.05 + now * 0.004) * 1.5;
    if (x === px + 6) ctx.moveTo(x, wfY + amp); else ctx.lineTo(x, wfY + amp);
  }
  ctx.stroke();
  ctx.restore();
  if (typeof t.data.dropAt === 'number' && off >= t.data.dropAt) {
    const landed = off >= (t.data.landAt ?? t.data.dropAt + 4000);
    ctx.fillStyle = landed ? '#88ee99' : '#ffcc66'; ctx.font = 'bold 10px monospace';
    ctx.fillText(landed ? tr('◆ CRATE ON THE GROUND') : tr('◇ SUPPLY DROP INBOUND'), px + 8, py + ph + 16);
  }

  // Subtitle band
  if (line) {
    ctx.font = '14px monospace'; ctx.textAlign = 'center';
    const wrapped = wrapTwo(ctx, tr(line.text), CW - 120);
    const bandH = 32 + wrapped.length * 18;
    const by = CH - 110 - (wrapped.length - 1) * 18;
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(40, by, CW - 80, bandH);
    ctx.strokeStyle = '#22cc44'; ctx.lineWidth = 1; ctx.strokeRect(40.5, by + 0.5, CW - 81, bandH - 1);
    ctx.fillStyle = '#ff8866'; ctx.font = 'bold 10px monospace';
    ctx.fillText(`◯ ${tr(line.speaker)}`, CW / 2, by + 14);
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace';
    // Typewriter reveal, like text coming over the wire.
    const chars = Math.floor(since / 28);
    let left = chars;
    wrapped.forEach((w, i) => {
      const shown = w.slice(0, Math.max(0, left)); left -= w.length + 1;
      ctx.fillText(shown, CW / 2, by + 34 + i * 18);
    });
    ctx.textAlign = 'left';
  }

  // Progress bar + skip hint
  const t01 = Math.min(1, off / t.data.durMs);
  ctx.fillStyle = '#0a1410'; ctx.fillRect(40, CH - 26, CW - 80, 4);
  ctx.fillStyle = '#22cc44'; ctx.fillRect(40, CH - 26, (CW - 80) * t01, 4);
  ctx.fillStyle = '#9a9'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText(tr('[SPACE / TAP] to skip'), CW / 2, CH - 12);
  ctx.textAlign = 'left';
}
