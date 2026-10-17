// Mission extras (see update/missionExtras.js): cache, nest, car alarm,
// SOS timer, and the condition / side-objective tags under the HUD bar.
import { C } from '../constants.js';
import { MGY } from '../data/expeditions.js';
import { MISSION_CONDS, SIDE_OBJ } from '../data/missionExtras.js';
import { sosLeft } from '../update/missionExtras.js';

function label(ctx, x, y, text, col, now) {
  const b = Math.sin(now / 200) * 2;
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(text, x + 1, y + b + 1);
  ctx.fillStyle = col; ctx.fillText(text, x, y + b);
  ctx.textAlign = 'left';
}

function dCache(ctx, sd, now) {
  const x = sd.x, y = MGY;
  const open = sd.state === 'done';
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 30, 5, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(0, y - 30, 0, y);
  g.addColorStop(0, '#5a6440'); g.addColorStop(1, '#2a3020');
  ctx.fillStyle = '#0c0e08'; ctx.fillRect(x - 27, y - 31, 54, 31);
  ctx.fillStyle = g; ctx.fillRect(x - 26, y - 30, 52, 29);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 26, y - 18, 52, 2);
  ctx.fillStyle = '#d8c070'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
  ctx.fillText('★ U.S. ★', x, y - 8); ctx.textAlign = 'left';
  // Lid
  ctx.save(); ctx.translate(x - 27, y - 31); ctx.rotate(open ? -0.9 : 0);
  ctx.fillStyle = '#4a5434'; ctx.fillRect(0, -6, 54, 7); ctx.restore();
  if (!open) {
    ctx.fillStyle = '#c8a040'; ctx.fillRect(x - 4, y - 28, 8, 7);
    ctx.strokeStyle = '#c8a040'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y - 28, 3, Math.PI, 0); ctx.stroke();
  }
  if (sd.state === 'active') {
    if (sd.progress > 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y - 56, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y - 56, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sd.progress); ctx.stroke();
    }
    label(ctx, x, y - 74, '🔒 CACHE', '#ffd54a', now);
  }
}

function dNest(ctx, sd, now) {
  const x = sd.x, y = MGY;
  if (sd.state === 'done') {
    ctx.fillStyle = '#141008'; ctx.beginPath(); ctx.ellipse(x, y - 4, 34, 9, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const ph = (now / 2200 + i / 4) % 1;
      ctx.fillStyle = `rgba(40,36,30,${0.4 * (1 - ph)})`;
      ctx.beginPath(); ctx.arc(x - 8 + i * 6 + ph * 10, y - 14 - ph * 60, 6 + ph * 12, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }
  const p = 1 + 0.06 * Math.sin(now / 260), hurt = sd.hurtAt && now - sd.hurtAt < 120;
  const g = ctx.createRadialGradient(x, y - 22, 4, x, y - 18, 40 * p);
  g.addColorStop(0, hurt ? '#ffb0a0' : '#9a3a4a'); g.addColorStop(0.5, '#5a1e2c'); g.addColorStop(1, '#22080e');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x - 40, y);
  ctx.quadraticCurveTo(x - 44 * p, y - 34 * p, x - 10, y - 46 * p);
  ctx.quadraticCurveTo(x + 18, y - 54 * p, x + 36 * p, y - 26);
  ctx.quadraticCurveTo(x + 46, y - 6, x + 40, y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(10,2,4,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  // Pustules + tendrils
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3, r = 3 + (i % 3);
    ctx.fillStyle = `rgba(200,${90 + i * 15},80,${0.6 + 0.3 * Math.sin(now / 300 + i)})`;
    ctx.beginPath(); ctx.arc(x - 20 + i * 10, y - 24 - Math.sin(a) * 12, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#3a1018'; ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath(); ctx.moveTo(x + i * 30, y - 4);
    ctx.quadraticCurveTo(x + i * 52, y - 10 + Math.sin(now / 400) * 4, x + i * 64, y); ctx.stroke();
  }
  // HP bar
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x - 30, y - 66, 60, 5);
  ctx.fillStyle = '#cc3355'; ctx.fillRect(x - 30, y - 66, 60 * Math.max(0, sd.hp / sd.maxHp), 5);
  label(ctx, x, y - 74, '🪺 NEST', '#ff7799', now);
}

function dAlarmCar(ctx, al, now) {
  const x = al.x, y = MGY;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 46, 5, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(0, y - 30, 0, y);
  g.addColorStop(0, '#6a2a24'); g.addColorStop(1, '#2a100c');
  ctx.fillStyle = g; ctx.strokeStyle = '#0a0606'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 44, y - 6); ctx.lineTo(x - 42, y - 18); ctx.lineTo(x - 22, y - 20); ctx.lineTo(x - 12, y - 32);
  ctx.lineTo(x + 16, y - 32); ctx.lineTo(x + 28, y - 20); ctx.lineTo(x + 44, y - 17); ctx.lineTo(x + 45, y - 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(120,150,170,0.35)'; ctx.fillRect(x - 9, y - 29, 22, 9);
  ctx.fillStyle = '#0a0a0a';
  [-26, 28].forEach(wx => { ctx.beginPath(); ctx.arc(x + wx, y - 5, 7, 0, Math.PI * 2); ctx.fill(); });
  const blink = al.triggered && now - al.at < 9000 && Math.floor(now / 220) % 2 === 0;
  ctx.fillStyle = blink ? '#ffb030' : '#5a3a10';
  ctx.fillRect(x + 40, y - 16, 4, 4); ctx.fillRect(x - 44, y - 16, 4, 4);
  if (blink) {
    const gl = ctx.createRadialGradient(x, y - 16, 4, x, y - 16, 80);
    gl.addColorStop(0, 'rgba(255,170,40,0.35)'); gl.addColorStop(1, 'rgba(255,140,30,0)');
    ctx.fillStyle = gl; ctx.fillRect(x - 80, y - 96, 160, 160);
  }
}

// World pass (camera space), before pickups and actors.
export function dMissionExtras(ctx, m, now) {
  if (m.alarm) dAlarmCar(ctx, m.alarm, now);
  const sd = m.side;
  if (!sd) return;
  if (sd.type === 'cache') dCache(ctx, sd, now);
  else if (sd.type === 'nest') dNest(ctx, sd, now);
  else if (sd.type === 'sos' && sd.state === 'active') {
    const r = (m.rescuables || []).find(q => q.id === sd.rid);
    const left = sosLeft(m, now);
    if (r && left !== null) label(ctx, r.x, MGY - 96, `🆘 ${left}s`, left < 15 ? '#ff5544' : '#88ddff', now);
  }
}

// Screen-space tags under the mission HUD bar.
export function dMissionExtrasHUD(ctx, m, now) {
  // Right-aligned under the bar (the left side holds the squad roster).
  const tags = [];
  const cd = m.cond && MISSION_CONDS[m.cond];
  if (cd) tags.push([`${cd.icon} ${cd.name}`, cd.color]);
  const sd = m.side;
  if (sd) {
    const o = SIDE_OBJ[sd.type];
    let st;
    if (sd.state === 'done') st = '✔';
    else if (sd.state === 'failed') st = '✖';
    else if (sd.type === 'cache') st = `${Math.round(sd.progress * 100)}%`;
    else if (sd.type === 'nest') st = `${Math.max(0, Math.round(sd.hp / sd.maxHp * 100))}%`;
    else st = `${sosLeft(m, now)}s`;
    tags.push([`★ ${o.icon} ${o.name} ${st}`, sd.state === 'done' ? C.acc : sd.state === 'failed' ? C.dng : '#ffd54a']);
  }
  // Jobs from the fort that need something from this place.
  ((m.dest && m.dest.quests) || []).forEach(q => {
    const got = q.kind === 'fetch'
      ? (m.collected.quests || []).includes(q.id)
      : (m.rescuables || []).some(r => r.questId === q.id && r.state === 'following');
    tags.push([`📋 ${q.kind === 'fetch' ? q.item : q.person}${got ? ' ✔ → VAN' : ''}`, got ? C.acc : '#ffd54a']);
  });
  ctx.font = 'bold 9px monospace';
  let x = 888;
  tags.reverse().forEach(([text, col]) => {
    const w = ctx.measureText(text).width + 14;
    x -= w;
    ctx.fillStyle = 'rgba(10,12,8,0.85)'; ctx.fillRect(x, 45, w, 16);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, 45.5, w - 1, 15);
    ctx.fillStyle = col; ctx.fillText(text, x + 7, 56);
    x -= 6;
  });
}
