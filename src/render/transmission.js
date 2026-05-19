import { CW, CH } from '../constants.js';

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

// Full-screen radio-transmission overlay:
//   black backdrop + scanlines, green header band ("INCOMING TRANSMISSION"
//   / "CENTRAL COMMAND"), animated waveform that pulses while a line is
//   being voiced, and the current subtitle. Voice playback itself is
//   driven by the React loop (it calls speakRadio when a line becomes
//   active) — this renderer is purely visual.
export function dTransmissionScene(ctx, t, now) {
  const off = now - t.startedAt;

  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);

  // Phosphor scanlines
  ctx.fillStyle = 'rgba(40,140,80,0.05)';
  for (let y = 0; y < CH; y += 3) ctx.fillRect(0, y, CW, 1);

  // Header band
  ctx.fillStyle = '#0a1410'; ctx.fillRect(0, 36, CW, 64);
  ctx.fillStyle = '#22cc44'; ctx.fillRect(0, 36, CW, 2);
  ctx.fillStyle = '#22cc44'; ctx.fillRect(0, 98, CW, 2);
  ctx.fillStyle = '#22cc44'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
  ctx.fillText(t.data.title, CW / 2, 64);
  ctx.fillStyle = '#88ee99'; ctx.font = '11px monospace';
  ctx.fillText(t.data.sender, CW / 2, 84);
  // Blinking "REC" dot
  if (Math.floor(off / 500) % 2 === 0) {
    ctx.fillStyle = '#dd2222';
    ctx.beginPath(); ctx.arc(CW - 60, 56, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dd2222'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('REC', CW - 50, 60);
  }
  ctx.textAlign = 'left';

  // Animated waveform — vibrates while a line is being voiced.
  const line = currentLine(t, off);
  const since = line ? off - line.at : 9999;
  const speaking = !!line && since < 4000;
  const wfY = CH / 2 - 10;
  ctx.strokeStyle = speaking ? '#22cc44' : '#1a4a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let x = 80; x < CW - 80; x += 3) {
    const amp = speaking
      ? Math.sin(x * 0.06 + now * 0.014) * 18 + Math.sin(x * 0.15 + now * 0.022) * 10
      : Math.sin(x * 0.04 + now * 0.003) * 2.5;
    if (!started) { ctx.moveTo(x, wfY + amp); started = true; }
    else ctx.lineTo(x, wfY + amp);
  }
  ctx.stroke();

  // Supply crate animation in the last seconds of the cinematic:
  // chopper passes high overhead, releases a crate with a parachute
  // that drifts down to ground level on the bottom of the panel.
  if (typeof t.data.dropAt === 'number' && off >= t.data.dropAt) {
    const fall = Math.max(0, off - t.data.dropAt);
    const span = Math.max(800, (t.data.landAt ?? (t.data.dropAt + 4000)) - t.data.dropAt);
    const p = Math.min(1, fall / span);
    // Side panel framing the drop so it doesn't fight the waveform.
    const px = CW - 120;
    const groundY = CH - 60;
    const startY = 110;
    // Parachute lines visible while airborne
    const cy = startY + (groundY - startY) * p;
    if (p < 0.98) {
      ctx.fillStyle = '#cccccc';
      ctx.beginPath();
      ctx.moveTo(px - 18, cy - 22);
      ctx.quadraticCurveTo(px, cy - 42, px + 18, cy - 22);
      ctx.lineTo(px + 22, cy - 18);
      ctx.quadraticCurveTo(px, cy - 36, px - 22, cy - 18);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - 18, cy - 22); ctx.lineTo(px - 6, cy - 6);
      ctx.moveTo(px,      cy - 32); ctx.lineTo(px,    cy - 6);
      ctx.moveTo(px + 18, cy - 22); ctx.lineTo(px + 6, cy - 6);
      ctx.stroke();
    }
    // Crate
    ctx.fillStyle = '#5a3e18'; ctx.fillRect(px - 10, cy - 6, 20, 14);
    ctx.fillStyle = '#3e2810'; ctx.fillRect(px - 10, cy - 2, 20, 2); ctx.fillRect(px - 10, cy + 4, 20, 2);
    ctx.fillStyle = '#cc8800'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
    ctx.fillText('US', px, cy + 4);
    ctx.textAlign = 'left';
    // Dust kicks up on landing
    if (p >= 0.98) {
      const dustT = Math.min(1, (p - 0.98) * 50);
      ctx.fillStyle = `rgba(200,180,140,${0.5 * (1 - dustT)})`;
      ctx.beginPath();
      ctx.ellipse(px, cy + 10, 22 + dustT * 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Small "INBOUND" label so the player notices
    ctx.fillStyle = '#88ee99'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.fillText(p < 1 ? '◇ CRATE INBOUND' : '◇ CRATE LANDED', px, 100);
    ctx.textAlign = 'left';
  }

  // Subtitle band
  if (line) {
    ctx.font = '14px monospace'; ctx.textAlign = 'center';
    const wrapped = wrapTwo(ctx, line.text, CW - 120);
    const bandH = 32 + wrapped.length * 18;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(40, CH - 110 - (wrapped.length - 1) * 18, CW - 80, bandH);
    ctx.strokeStyle = '#22cc44'; ctx.lineWidth = 1;
    ctx.strokeRect(40, CH - 110 - (wrapped.length - 1) * 18, CW - 80, bandH);
    ctx.fillStyle = '#ff8866'; ctx.font = 'bold 10px monospace';
    ctx.fillText(`◯ ${line.speaker}`, CW / 2, CH - 96 - (wrapped.length - 1) * 18);
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace';
    wrapped.forEach((w, i) => {
      ctx.fillText(w, CW / 2, CH - 76 - (wrapped.length - 1 - i) * 18);
    });
    ctx.textAlign = 'left';
  }

  // Progress bar
  const t01 = Math.min(1, off / t.data.durMs);
  ctx.fillStyle = '#0a1410'; ctx.fillRect(40, CH - 26, CW - 80, 4);
  ctx.fillStyle = '#22cc44'; ctx.fillRect(40, CH - 26, (CW - 80) * t01, 4);

  // Skip hint
  ctx.fillStyle = '#888'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText('[SPACE / TAP] to skip', CW / 2, CH - 12);
  ctx.textAlign = 'left';
}
