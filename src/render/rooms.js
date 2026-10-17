// Rooms off the street (update/rooms.js): the doors in the buildings'
// back walls, the inside of each kind of room, and the "E" prompts.
import { MGY } from '../data/expeditions.js';
import { ROOM_KINDS, ROOM_EXIT_X, ROOM_W, doorAt } from '../update/rooms.js';

// Small deterministic rng for per-room decor.
const rng = seed => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function prompt(ctx, x, y, text, now) {
  const b = Math.sin(now / 260) * 1.5;
  ctx.font = 'bold 10px monospace';
  const w = ctx.measureText(text).width + 30;
  ctx.fillStyle = 'rgba(8,10,6,0.88)'; ctx.fillRect(x - w / 2, y - 14 + b, w, 18);
  ctx.strokeStyle = 'rgba(232,216,176,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y - 13.5 + b, w - 1, 17);
  ctx.fillStyle = '#ffd54a'; ctx.fillRect(x - w / 2 + 5, y - 11 + b, 14, 12);
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.fillText('E', x - w / 2 + 12, y - 1.5 + b);
  ctx.fillStyle = '#e8d8b0'; ctx.fillText(text, x + 9, y - 1.5 + b);
  ctx.textAlign = 'left';
}

// ── Street side ────────────────────────────────────────────────────
function plaqueText(d) {
  const K = ROOM_KINDS[d.kind];
  return d.kind === 'apartment' || d.kind === 'office' ? `${K.label} ${d.num}` : K.label;
}

export function dRoomDoor(ctx, d, now) {
  const K = ROOM_KINDS[d.kind];
  const x = d.x, y = MGY, w = 30, h = 60, top = y - h;
  // Frame (architrave) and a worn step
  ctx.fillStyle = '#16120e'; ctx.fillRect(x - w / 2 - 6, top - 6, w + 12, h + 6);
  ctx.fillStyle = '#2e2620'; ctx.fillRect(x - w / 2 - 4, top - 4, w + 8, h + 4);
  ctx.fillStyle = '#3a3229'; ctx.fillRect(x - w / 2 - 8, y - 3, w + 16, 3);
  if (d.visited) {
    // Left ajar: a dark gap and the panel swung in
    ctx.fillStyle = '#060504'; ctx.fillRect(x - w / 2, top, w, h);
    ctx.fillStyle = 'rgba(255,214,150,0.10)'; ctx.fillRect(x - w / 2, top, w * 0.55, h);
    ctx.fillStyle = K.door; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x + w / 2, top); ctx.lineTo(x + w / 2 - 9, top + 4); ctx.lineTo(x + w / 2 - 9, y - 3); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    const g = ctx.createLinearGradient(0, top, 0, y);
    g.addColorStop(0, K.door); g.addColorStop(1, '#14100c');
    ctx.fillStyle = g; ctx.fillRect(x - w / 2, top, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 4.5, top + 5.5, w - 9, 20); ctx.strokeRect(x - w / 2 + 4.5, top + 31.5, w - 9, 22);
    if (d.kind === 'clinic' || d.kind === 'office') {   // wired-glass window, lit from inside
      ctx.fillStyle = d.kind === 'clinic' ? 'rgba(190,240,220,0.55)' : 'rgba(255,220,160,0.45)';
      ctx.fillRect(x - 6, top + 8, 12, 14);
      ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.beginPath(); ctx.moveTo(x, top + 8); ctx.lineTo(x, top + 22); ctx.moveTo(x - 6, top + 15); ctx.lineTo(x + 6, top + 15); ctx.stroke();
    }
    ctx.fillStyle = '#d8b850'; ctx.beginPath(); ctx.arc(x + w / 2 - 6, y - 30, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,210,130,0.7)'; ctx.fillRect(x - w / 2, y - 2, w, 2);    // light under the door
    if (d.kind === 'clinic') { ctx.fillStyle = '#c02020'; ctx.fillRect(x - 2, top + 34, 4, 12); ctx.fillRect(x - 6, top + 38, 12, 4); }
    if (d.kind === 'armory' || d.kind === 'storage') {     // hazard tape
      ctx.fillStyle = '#d8b020'; ctx.fillRect(x - w / 2, y - 12, w, 4);
      ctx.fillStyle = '#111'; for (let k = 0; k < w; k += 6) ctx.fillRect(x - w / 2 + k, y - 12, 3, 4);
    }
  }
  // Blood handprint on some doors
  if (d.seed % 3 === 0) {
    ctx.fillStyle = 'rgba(110,10,10,0.75)';
    ctx.beginPath(); ctx.ellipse(x - 6, top + 30, 3.5, 4.5, 0.2, 0, Math.PI * 2); ctx.fill();
    for (let f = 0; f < 4; f++) ctx.fillRect(x - 9 + f * 2.2, top + 23 - (f === 1 || f === 2 ? 1 : 0), 1.4, 5);
  }
  // Caged lamp + plaque
  const on = 0.85 + 0.15 * Math.sin(now / 900 + x);
  ctx.fillStyle = `rgba(255,214,140,${0.16 * on})`; ctx.beginPath(); ctx.arc(x, top - 12, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1714'; ctx.fillRect(x - 4, top - 16, 8, 2);
  ctx.fillStyle = `rgba(255,226,160,${on})`; ctx.fillRect(x - 3, top - 14, 6, 4);
  const t = plaqueText(d);
  ctx.font = 'bold 7px monospace';
  const pw = ctx.measureText(t).width + 8;
  ctx.fillStyle = '#c8c0a8'; ctx.fillRect(x - pw / 2, top - 6 - 22, pw, 9);
  ctx.fillStyle = '#1a1a14'; ctx.textAlign = 'center'; ctx.fillText(t, x, top - 6 - 15.5); ctx.textAlign = 'left';
}

// ── Inside ─────────────────────────────────────────────────────────
function picture(ctx, x, y, w, h, r) {
  ctx.fillStyle = '#2a1c10'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const hue = Math.floor(r() * 360);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `hsl(${hue},25%,42%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},20%,22%)`);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.4, y + h * 0.45); ctx.lineTo(x + w * 0.7, y + h * 0.7); ctx.lineTo(x + w, y + h * 0.35); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
}

function nightWindow(ctx, x, y, w, h, curtain) {
  ctx.fillStyle = '#0a1220'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(200,215,255,0.8)'; ctx.beginPath(); ctx.arc(x + w * 0.7, y + h * 0.3, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#05080e';
  for (let k = 0; k < 5; k++) ctx.fillRect(x + k * w / 5, y + h - 14 - (k * 7) % 18, w / 5 - 2, 30);
  ctx.fillStyle = 'rgba(255,150,60,0.35)'; ctx.fillRect(x + w * 0.2, y + h - 8, 3, 3); ctx.fillRect(x + w * 0.55, y + h - 12, 2, 3);
  ctx.strokeStyle = '#2a2420'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
  if (curtain) {
    ctx.fillStyle = curtain;
    ctx.beginPath(); ctx.moveTo(x - 8, y - 6); ctx.quadraticCurveTo(x + 8, y + h / 2, x - 2, y + h + 8); ctx.lineTo(x - 12, y + h + 8); ctx.lineTo(x - 12, y - 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + w + 8, y - 6); ctx.quadraticCurveTo(x + w - 8, y + h / 2, x + w + 2, y + h + 8); ctx.lineTo(x + w + 12, y + h + 8); ctx.lineTo(x + w + 12, y - 6); ctx.fill();
  }
  // Moonlight shaft on the floor
  ctx.fillStyle = 'rgba(170,190,255,0.06)';
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w + 70, MGY); ctx.lineTo(x + 50, MGY); ctx.closePath(); ctx.fill();
}

function shelfRack(ctx, x, w, r) {
  const top = MGY - 150;
  ctx.fillStyle = '#3a3e40'; ctx.fillRect(x, top, 4, 150); ctx.fillRect(x + w - 4, top, 4, 150);
  for (let lv = 0; lv < 4; lv++) {
    const y = top + 18 + lv * 36;
    ctx.fillStyle = '#4a4e50'; ctx.fillRect(x, y, w, 3);
    for (let bx = x + 6; bx < x + w - 14; bx += 14 + r() * 10) {
      if (r() < 0.25) continue;
      const bh = 10 + r() * 18, bw = 10 + r() * 10;
      ctx.fillStyle = ['#7a5a32', '#6a4a28', '#5a6a3a', '#8a7a5a', '#4a5a6a'][Math.floor(r() * 5)];
      ctx.fillRect(bx, y - bh, Math.min(bw, x + w - 6 - bx), bh);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx, y - bh, Math.min(bw, x + w - 6 - bx), 2);
    }
  }
}

function bed(ctx, x, hospital) {
  const y = MGY;
  ctx.fillStyle = hospital ? '#8a9490' : '#3a2416'; ctx.fillRect(x - 4, y - 46, 8, 46);         // headboard / rail
  ctx.fillStyle = hospital ? '#5a6460' : '#2a1a0e'; ctx.fillRect(x, y - 18, 120, 8); ctx.fillRect(x + 114, y - 26, 6, 26);
  ctx.fillStyle = hospital ? '#d8dcd4' : '#c8b8a0'; ctx.fillRect(x + 2, y - 28, 112, 10);       // mattress
  ctx.fillStyle = hospital ? '#9ab4c0' : '#6a3a3a'; ctx.fillRect(x + 34, y - 30, 80, 13);      // blanket
  ctx.fillStyle = '#e8e4d8'; ctx.fillRect(x + 6, y - 34, 24, 8);                               // pillow
  ctx.fillStyle = 'rgba(110,10,10,0.6)'; ctx.beginPath(); ctx.ellipse(x + 50, y - 26, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1612'; ctx.fillRect(x + 4, y - 10, 4, 10); ctx.fillRect(x + 110, y - 10, 4, 10);
}

function decorApartment(ctx, r) {
  nightWindow(ctx, 470, 70, 110, 90, '#6a2a2a');
  picture(ctx, 230, 90, 54, 40, r); picture(ctx, 300, 100, 30, 38, r);
  bed(ctx, 640, false);
  // Sofa
  ctx.fillStyle = '#4a5a3a'; ctx.fillRect(220, MGY - 40, 130, 24); ctx.fillRect(214, MGY - 34, 12, 30); ctx.fillRect(344, MGY - 34, 12, 30);
  ctx.fillStyle = '#3a4a2c'; ctx.fillRect(222, MGY - 22, 126, 16);
  ctx.fillStyle = '#1a140e'; ctx.fillRect(222, MGY - 6, 6, 6); ctx.fillRect(342, MGY - 6, 6, 6);
  // TV on a stand (dead screen)
  ctx.fillStyle = '#2a2018'; ctx.fillRect(400, MGY - 30, 60, 30);
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(404, MGY - 72, 52, 40);
  ctx.fillStyle = 'rgba(120,150,180,0.12)'; ctx.fillRect(408, MGY - 68, 30, 10);
  // Fridge
  ctx.fillStyle = '#c8c8bc'; ctx.fillRect(150, MGY - 110, 46, 110);
  ctx.fillStyle = '#a8a89c'; ctx.fillRect(150, MGY - 72, 46, 2); ctx.fillRect(188, MGY - 100, 3, 20); ctx.fillRect(188, MGY - 62, 3, 24);
  // Rug
  ctx.fillStyle = 'rgba(120,40,30,0.35)'; ctx.beginPath(); ctx.ellipse(300, MGY + 10, 120, 8, 0, 0, Math.PI * 2); ctx.fill();
}

function decorStorage(ctx, r) {
  shelfRack(ctx, 170, 150, r); shelfRack(ctx, 520, 150, r); shelfRack(ctx, 690, 150, r);
  // Pallet stack
  ctx.fillStyle = '#6a5030'; for (let k = 0; k < 4; k++) ctx.fillRect(360, MGY - 8 - k * 9, 100, 6);
  ctx.fillStyle = '#4a6a7a'; ctx.fillRect(372, MGY - 70, 76, 34); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(372, MGY - 70, 76, 4);
  // Sign
  ctx.fillStyle = '#d8d0b8'; ctx.fillRect(360, 90, 110, 28); ctx.fillStyle = '#b02020'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillText('NO SMOKING', 415, 104); ctx.fillStyle = '#333'; ctx.font = '7px monospace'; ctx.fillText('STAFF ONLY', 415, 114); ctx.textAlign = 'left';
}

function decorOffice(ctx, r) {
  // Blinds window
  ctx.fillStyle = '#0a1220'; ctx.fillRect(560, 70, 150, 100);
  ctx.fillStyle = '#b8b4a4'; for (let k = 0; k < 14; k++) if (k % 5 !== 2) ctx.fillRect(560, 72 + k * 7, 150, 3);
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3; ctx.strokeRect(560, 70, 150, 100);
  // Whiteboard
  ctx.fillStyle = '#e8ece8'; ctx.fillRect(230, 80, 150, 80); ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 3; ctx.strokeRect(230, 80, 150, 80);
  ctx.strokeStyle = '#2a4aa0'; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(245, 100); ctx.lineTo(300, 100); ctx.moveTo(245, 112); ctx.lineTo(330, 112); ctx.moveTo(250, 140); ctx.lineTo(290, 125); ctx.lineTo(320, 135); ctx.lineTo(360, 105); ctx.stroke();
  ctx.strokeStyle = '#b02020'; ctx.beginPath(); ctx.arc(345, 145, 9, 0, Math.PI * 2); ctx.stroke();
  // Clock + plant + coat rack
  ctx.fillStyle = '#e8e4d8'; ctx.beginPath(); ctx.arc(470, 90, 14, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(470, 90, 14, 0, Math.PI * 2); ctx.moveTo(470, 90); ctx.lineTo(470, 80); ctx.moveTo(470, 90); ctx.lineTo(477, 94); ctx.stroke();
  ctx.fillStyle = '#5a3a24'; ctx.fillRect(800, MGY - 26, 26, 26);
  ctx.fillStyle = '#3a5a2a'; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(813 + Math.sin(k) * 12, MGY - 40 - k * 6, 7, 14, Math.sin(k * 2) * 0.8, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#2a2018'; ctx.fillRect(170, MGY - 120, 4, 120); ctx.fillRect(160, MGY - 4, 24, 4);
  ctx.fillStyle = '#4a3a5a'; ctx.fillRect(168, MGY - 112, 14, 40);
  picture(ctx, 420, 130, 40, 30, r);
}

function decorClinic(ctx) {
  // Tiled lower wall
  ctx.strokeStyle = 'rgba(40,60,50,0.35)'; ctx.lineWidth = 1;
  for (let y = MGY - 120; y < MGY; y += 14) { ctx.beginPath(); ctx.moveTo(110, y); ctx.lineTo(ROOM_W, y); ctx.stroke(); }
  for (let x = 110; x < ROOM_W; x += 14) { ctx.beginPath(); ctx.moveTo(x, MGY - 120); ctx.lineTo(x, MGY); ctx.stroke(); }
  // Curtain rail + curtain
  ctx.fillStyle = '#9aa0a0'; ctx.fillRect(560, 60, 220, 3);
  ctx.fillStyle = 'rgba(150,190,200,0.75)';
  for (let k = 0; k < 6; k++) ctx.fillRect(560 + k * 9, 63, 8, 180 + (k % 2) * 6);
  bed(ctx, 640, true);
  // X-ray lightbox
  ctx.fillStyle = '#e8f4f0'; ctx.fillRect(250, 80, 90, 60); ctx.strokeStyle = '#4a5450'; ctx.lineWidth = 3; ctx.strokeRect(250, 80, 90, 60);
  ctx.fillStyle = '#20282a'; ctx.fillRect(262, 88, 66, 46);
  ctx.strokeStyle = 'rgba(230,240,240,0.8)'; ctx.lineWidth = 2;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(295, 100 + k * 8, 22 - k * 2, 4, 0, Math.PI, 0); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(295, 92); ctx.lineTo(295, 130); ctx.stroke();
  // Cabinet with red cross + sink
  ctx.fillStyle = '#d8dcd4'; ctx.fillRect(400, 80, 60, 70); ctx.fillStyle = '#c02020'; ctx.fillRect(425, 95, 10, 34); ctx.fillRect(413, 107, 34, 10);
  ctx.fillStyle = '#c8ccc4'; ctx.fillRect(170, MGY - 60, 50, 10); ctx.fillStyle = '#8a8e88'; ctx.fillRect(190, MGY - 50, 10, 50); ctx.fillRect(193, MGY - 74, 4, 14);
}

function decorLockers(ctx, r) {
  for (let k = 0; k < 8; k++) {
    const x = 470 + k * 34, open = r() < 0.3;
    ctx.fillStyle = '#4a5a6a'; ctx.fillRect(x, MGY - 130, 32, 130);
    ctx.fillStyle = open ? '#0a0c0e' : '#3a4a5a'; ctx.fillRect(x + 2, MGY - 126, 28, 122);
    if (!open) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; for (let v = 0; v < 4; v++) ctx.fillRect(x + 8, MGY - 118 + v * 5, 16, 2); ctx.fillStyle = '#c8c8c8'; ctx.fillRect(x + 24, MGY - 70, 3, 8); }
  }
  ctx.fillStyle = '#5a4026'; ctx.fillRect(500, MGY - 22, 220, 6); ctx.fillRect(510, MGY - 16, 6, 16); ctx.fillRect(704, MGY - 16, 6, 16);
  // Notice board
  ctx.fillStyle = '#8a6a40'; ctx.fillRect(200, 80, 140, 90);
  ['#e8e4d8', '#f0e090', '#e8e4d8', '#d8e8f0'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(210 + i * 32, 90 + (i % 2) * 22, 26, 34); });
  ctx.fillStyle = '#b02020'; ctx.fillRect(214, 94, 18, 3);
}

function decorArmory(ctx, r) {
  // Pegboard with gun silhouettes
  ctx.fillStyle = '#6a5a40'; ctx.fillRect(220, 70, 260, 130);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 76; y < 196; y += 10) for (let x = 226; x < 476; x += 10) ctx.fillRect(x, y, 2, 2);
  for (let k = 0; k < 4; k++) {
    if (r() < 0.35) continue;                       // empty hooks: someone got here first
    const y = 90 + k * 28;
    ctx.fillStyle = '#1a1a18'; ctx.fillRect(240, y, 150, 6); ctx.fillRect(250, y + 6, 14, 10); ctx.fillRect(330, y + 6, 8, 8);
  }
  // Flag
  ctx.fillStyle = '#2a3a5a'; ctx.fillRect(560, 80, 120, 70);
  ctx.fillStyle = '#d8b060'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.fillText('★', 620, 124); ctx.textAlign = 'left';
  // Sandbags + stacked crates
  ctx.fillStyle = '#8a7a52'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(170 + k * 22, MGY - 8, 12, 8, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#4a5a32'; ctx.fillRect(720, MGY - 40, 60, 40); ctx.fillRect(728, MGY - 72, 46, 32);
  ctx.fillStyle = '#d8d0b0'; ctx.font = 'bold 7px monospace'; ctx.fillText('7.62', 738, MGY - 18);
  ctx.fillStyle = '#d8d0b8'; ctx.fillRect(560, 170, 150, 18); ctx.fillStyle = '#b02020'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
  ctx.fillText('AUTHORIZED ONLY', 635, 182); ctx.textAlign = 'left';
}

const DECOR = { apartment: decorApartment, storage: decorStorage, office: decorOffice, clinic: decorClinic, lockers: decorLockers, armory: decorArmory };

// Background of a room, drawn over the indoor backdrop and behind
// everything else (camera space).
export function dRoomDecor(ctx, m) {
  if (!m.room) return;
  const d = m.room.door, K = ROOM_KINDS[d.kind];
  const r = rng(d.seed);
  // The indoor backdrop stops at the upper-floor line: rooms are one
  // tall storey, so carry the wall down to the floor.
  const wall = ctx.createLinearGradient(0, MGY - 90, 0, MGY);
  wall.addColorStop(0, 'rgba(0,0,0,0)'); wall.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = wall; ctx.fillRect(0, MGY - 90, ROOM_W, 90);
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, MGY - 6, ROOM_W, 6);
  // Side walls
  ctx.fillStyle = '#0c0a08'; ctx.fillRect(0, 0, 14, MGY); ctx.fillRect(ROOM_W - 14, 0, 14, MGY);
  (DECOR[d.kind] || (() => {}))(ctx, r);
  // Wear: cracks and blood
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    let x = 120 + r() * 680, y = 40 + r() * 80; ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (r() - 0.5) * 24; y += 6 + r() * 10; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  if (r() < 0.7) {
    ctx.fillStyle = 'rgba(100,8,8,0.55)';
    const bx = 150 + r() * 600;
    ctx.beginPath(); ctx.ellipse(bx, MGY + 6, 26, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(bx - 12, MGY - 60, 3, 40); ctx.fillRect(bx - 4, MGY - 54, 2, 30);
  }
  // Exit door on the left wall
  const x = ROOM_EXIT_X, top = MGY - 64;
  ctx.fillStyle = '#16120e'; ctx.fillRect(x - 22, top - 6, 44, 70);
  ctx.fillStyle = '#05070a'; ctx.fillRect(x - 17, top, 34, 64);
  ctx.fillStyle = 'rgba(160,180,210,0.12)'; ctx.fillRect(x - 17, top, 34, 64);           // the street outside
  ctx.fillStyle = K.door; ctx.beginPath(); ctx.moveTo(x - 17, top); ctx.lineTo(x - 6, top + 4); ctx.lineTo(x - 6, MGY - 3); ctx.lineTo(x - 17, MGY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0c3a18'; ctx.fillRect(x - 18, top - 22, 36, 12);
  ctx.fillStyle = '#5aff88'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillText('EXIT', x, top - 13); ctx.textAlign = 'left';
}

// Street doors + the "E" prompt (camera space, after the world).
export function dRoomsWorld(ctx, m, now) {
  if (m.room) {
    if (doorAt(m) === 'exit') prompt(ctx, ROOM_EXIT_X + 40, MGY - 96, 'BACK TO THE STREET', now);
    return;
  }
  const near = doorAt(m);
  if (near) prompt(ctx, near.x, MGY - 96, `ENTER · ${ROOM_KINDS[near.kind].name.toUpperCase()}`, now);
}

export function dRoomDoors(ctx, m, now) {
  if (m.room) return;
  (m.rdoors || []).forEach(d => dRoomDoor(ctx, d, now));
}
