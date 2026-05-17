import { CW, CH } from '../constants.js';

export const EXTRACTION_DURATION = 22000;

// Dialogue track for the wave-30 finale. React loop fires each line
// through speakRadio() the first time off >= line.at.
export const EXTRACTION_SCRIPT = [
  { at:   900, speaker: 'Command', pitch: 'low', text: 'Fort Omega... this is Central Command.' },
  { at:  5200, speaker: 'Command', pitch: 'low', text: 'Convoy is on you. Sample secured. Mount up.' },
  { at: 10500, speaker: 'Omega',   pitch: 'mid', text: 'Copy, Command. Rolling out.' },
  { at: 15000, speaker: 'Omega',   pitch: 'mid', text: 'Fort Omega clearing the gate. Godspeed, all.' },
];

// Convoy composition scales with how many people survived the wall.
// Heavy (4+ survivors): two humvees + a covered transport truck.
// Light (1-3): one armored humvee with a roof turret — they pack in.
function mkConvoy(survivors) {
  if (survivors >= 4) {
    return [
      { type: 'humvee', startX: -120, speed: 32 },
      { type: 'truck',  startX: -300, speed: 32 },
      { type: 'humvee', startX: -500, speed: 32, tail: true },
    ];
  }
  return [
    { type: 'humvee', startX: -150, speed: 28, armored: true },
  ];
}

export function mkExtraction(gs) {
  const alive   = (gs.soldiers || []).filter(s => s.state !== 'dead').length;
  const reserve = (gs.reserve  || []).length;
  const survivors = alive + reserve;
  return { startedAt: 0, survivors, convoy: mkConvoy(survivors), lineIdx: 0 };
}

function drawHumvee(ctx, x, y, opts = {}) {
  const armored = !!opts.armored;
  // Lower body
  ctx.fillStyle = armored ? '#2a3022' : '#3a3a2a';
  ctx.fillRect(x - 32, y - 24, 64, 20);
  // Hood / cab
  ctx.fillStyle = '#1a1814';
  ctx.fillRect(x - 28, y - 34, 56, 14);
  // Windshield (slanted)
  ctx.fillStyle = '#1a2a30';
  ctx.fillRect(x + 4, y - 32, 18, 10);
  // Front bumper
  ctx.fillStyle = '#0a0a06'; ctx.fillRect(x + 30, y - 14, 4, 10);
  // Wheels
  ctx.fillStyle = '#0a0a08';
  ctx.beginPath(); ctx.arc(x - 18, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 18, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3a3a';
  ctx.beginPath(); ctx.arc(x - 18, y - 2, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 18, y - 2, 2.5, 0, Math.PI * 2); ctx.fill();
  // Roof turret on the armored variant
  if (armored) {
    ctx.fillStyle = '#2a2a1c';
    ctx.fillRect(x - 6, y - 42, 12, 10);
    ctx.fillStyle = '#1a1812'; ctx.fillRect(x + 6, y - 40, 18, 3);
  }
  // Headlights + cone
  ctx.fillStyle = '#fff5cc'; ctx.fillRect(x + 30, y - 12, 4, 3); ctx.fillRect(x + 30, y - 20, 4, 3);
  ctx.fillStyle = 'rgba(255,240,200,0.12)';
  ctx.beginPath();
  ctx.moveTo(x + 34, y - 20); ctx.lineTo(x + 130, y - 38); ctx.lineTo(x + 130, y - 2); ctx.closePath(); ctx.fill();
  // Star
  ctx.fillStyle = '#bbb'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('★', x, y - 14);
  ctx.textAlign = 'left';
}

function drawTruck(ctx, x, y) {
  // Cab
  ctx.fillStyle = '#3a3a2a'; ctx.fillRect(x - 22, y - 32, 28, 28);
  ctx.fillStyle = '#1a2a30'; ctx.fillRect(x - 18, y - 28, 18, 10);
  // Hood ridge
  ctx.fillStyle = '#1a1814'; ctx.fillRect(x - 22, y - 32, 28, 3);
  // Cargo (tarped)
  ctx.fillStyle = '#2a2a1c'; ctx.fillRect(x + 6, y - 36, 44, 32);
  // Tarp seams
  ctx.fillStyle = '#1a1812';
  for (let dy = -32; dy <= -8; dy += 8) {
    ctx.fillRect(x + 6, y + dy, 44, 1);
  }
  // Frame underrun
  ctx.fillStyle = '#0a0a06'; ctx.fillRect(x + 6, y - 4, 44, 2);
  // Wheels (3 axles)
  ctx.fillStyle = '#0a0a08';
  ctx.beginPath(); ctx.arc(x - 12, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 20, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 42, y - 2, 7, 0, Math.PI * 2); ctx.fill();
  // Star
  ctx.fillStyle = '#bbb'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText('★', x + 28, y - 20);
  ctx.textAlign = 'left';
}

export function dExtractionScene(ctx, e, now) {
  const off = now - e.startedAt;
  const tSec = off / 1000;

  // Dawn sky (purple → ember)
  const sg = ctx.createLinearGradient(0, 0, 0, CH * 0.6);
  sg.addColorStop(0, '#08081a');
  sg.addColorStop(0.6, '#3a1a18');
  sg.addColorStop(1, '#5a2818');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, CW, CH * 0.6);

  // Sun cresting the skyline
  const sunY = CH * 0.6 - 10;
  ctx.fillStyle = 'rgba(255,180,80,0.35)';
  ctx.beginPath(); ctx.arc(CW * 0.75, sunY, 60, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffcc88';
  ctx.beginPath(); ctx.arc(CW * 0.75, sunY, 28, 0, Math.PI * 2); ctx.fill();

  // Distant city silhouette
  ctx.fillStyle = '#0a0808';
  for (let i = 0; i < 18; i++) {
    const bx = i * CW / 18;
    const bw = 35 + (i * 11) % 30;
    const bh = 30 + (i * 17) % 80;
    ctx.fillRect(bx, CH * 0.6 - bh, bw, bh);
  }
  // A couple still burning
  for (let i = 0; i < 3; i++) {
    const bx = ((i * 7 + 3) * CW / 18);
    ctx.fillStyle = `rgba(255,${100 + (i * 30) % 80},40,${0.25 + Math.sin(tSec * 3 + i) * 0.08})`;
    ctx.fillRect(bx, CH * 0.6 - 70, 30, 30);
  }

  // Ground + tarmac
  const gg = ctx.createLinearGradient(0, CH * 0.6, 0, CH);
  gg.addColorStop(0, '#1a1410');
  gg.addColorStop(1, '#080604');
  ctx.fillStyle = gg; ctx.fillRect(0, CH * 0.6, CW, CH * 0.4);

  // Road surface
  const roadTop = CH - 70;
  ctx.fillStyle = '#1a1814'; ctx.fillRect(0, roadTop, CW, 55);
  // Dashed lane line
  ctx.strokeStyle = '#ccaa44'; ctx.lineWidth = 2;
  ctx.setLineDash([20, 18]);
  ctx.beginPath(); ctx.moveTo(0, roadTop + 26); ctx.lineTo(CW, roadTop + 26); ctx.stroke();
  ctx.setLineDash([]);

  // Fort Omega gate on the left (we just left through it)
  const gateX = 30, gateY = CH - 200;
  ctx.fillStyle = '#3a2818'; ctx.fillRect(gateX, gateY, 76, 130);
  ctx.fillStyle = '#2a1c10'; ctx.fillRect(gateX, gateY, 76, 8);
  ctx.fillStyle = '#1a1410'; ctx.fillRect(gateX, gateY + 8, 4, 122); ctx.fillRect(gateX + 72, gateY + 8, 4, 122);
  // Gate banner
  ctx.fillStyle = '#cc3322'; ctx.fillRect(gateX + 6, gateY + 12, 64, 18);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('FORT OMEGA', gateX + 38, gateY + 25);
  // Open gate (dark slot)
  ctx.fillStyle = '#050402'; ctx.fillRect(gateX + 38, gateY + 40, 38, 90);
  // Watch-light
  ctx.fillStyle = 'rgba(255,200,120,0.35)';
  ctx.beginPath(); ctx.arc(gateX + 38, gateY + 12, 28, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left';

  // Convoy: each vehicle starts off-screen left, drives rightwards.
  const carY = CH - 36;
  e.convoy.forEach(v => {
    const x = v.startX + tSec * v.speed * 8;
    if (x < CW + 80 && x > -100) {
      if (v.type === 'humvee') drawHumvee(ctx, x, carY, v);
      else if (v.type === 'truck') drawTruck(ctx, x, carY);
    }
  });

  // Headline band
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, 28);
  ctx.fillStyle = '#88aaff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  ctx.fillText('★ EXTRACTION COMPLETE ★', CW / 2, 19);
  ctx.fillStyle = '#aaa'; ctx.font = '10px monospace';
  ctx.fillText(`Survivors evacuating: ${e.survivors}`, CW / 2, 42);
  ctx.textAlign = 'left';

  // Current line
  let cur = null;
  for (const l of EXTRACTION_SCRIPT) { if (off >= l.at) cur = l; else break; }
  if (cur && off < cur.at + 4500) {
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(40, CH - 180, CW - 80, 54);
    ctx.strokeStyle = cur.speaker === 'Command' ? '#ff8866' : '#88ff88'; ctx.lineWidth = 1;
    ctx.strokeRect(40, CH - 180, CW - 80, 54);
    ctx.fillStyle = cur.speaker === 'Command' ? '#ff8866' : '#88ff88';
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`◯ ${cur.speaker}`, CW / 2, CH - 164);
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace';
    ctx.fillText(cur.text, CW / 2, CH - 144);
    ctx.textAlign = 'left';
  }

  // Progress bar
  const t01 = Math.min(1, off / EXTRACTION_DURATION);
  ctx.fillStyle = '#0a0a18'; ctx.fillRect(40, CH - 14, CW - 80, 3);
  ctx.fillStyle = '#88aaff'; ctx.fillRect(40, CH - 14, (CW - 80) * t01, 3);

  // Skip hint
  ctx.fillStyle = '#888'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText('[SPACE / TAP] to continue', CW / 2, CH - 1);
  ctx.textAlign = 'left';
}
