import { CW, CH, GY } from '../constants.js';
import { dBg } from './background.js';
import { dHelicopter } from './evac.js';
import { dZombie } from './zombie.js';
import { ZTP } from '../data/zombies.js';
import { drawSoldierBody } from './actors/people.js';
import { t as tr } from '../i18n/index.js';

// Ending cinematic, played after the vaccine campaign and before the
// stats screen. Depends on the outcome tier:
//
//   gold / silver / bronze — LZ Bravo rooftop at dawn: the Black Hawk
//     is down on the pad, the survivors run aboard (the carrier holds
//     the glowing sample case when it was delivered), walkers spill out
//     of the stairwell as the chopper lifts off into the sunrise.
//   failure — Highway 17: the convoy's APC burns on the asphalt, the
//     vial lies shattered in a green puddle, walkers drift past while
//     Command calls a convoy that never answers.
//
// Both end on a title card. Audio cues go to e.soundQ (drained by the
// game loop); radio lines go through speakRadio / chatter by the loop.

const SCRIPTS = {
  gold: [
    { at:   600, speaker: 'Dustoff 2-1', pitch: 'mid',  text: 'LZ Bravo, Dustoff Two-One. Wheels down, load them up!' },
    { at:  4600, speaker: 'Omega',       pitch: 'mid',  text: 'Sample secure. Everybody made it. Let\'s go home.' },
    { at:  9600, speaker: 'Dustoff 2-1', pitch: 'mid',  text: 'Lifting. Contacts on the roof, not our problem anymore.' },
    { at: 13800, speaker: 'Command',     pitch: 'low',  text: 'Fort Omega, you did it. Broadcasting the formula on every channel.' },
  ],
  silver: [
    { at:   600, speaker: 'Dustoff 2-1', pitch: 'mid',  text: 'LZ Bravo, wheels down. Where is the rest of your team?' },
    { at:  4600, speaker: 'Omega',       pitch: 'mid',  text: 'This is all of us. The sample is intact.' },
    { at:  9600, speaker: 'Dustoff 2-1', pitch: 'mid',  text: 'Copy. Lifting off, hang on.' },
    { at: 13800, speaker: 'Command',     pitch: 'low',  text: 'We have the formula. Their names will be remembered.' },
  ],
  bronze: [
    { at:   600, speaker: 'Dustoff 2-1', pitch: 'mid',  text: 'LZ Bravo, wheels down. Do you have the package?' },
    { at:  4600, speaker: 'Omega',       pitch: 'mid',  text: 'Negative. The sample is gone. Just get us out.' },
    { at:  9600, speaker: 'Dustoff 2-1', pitch: 'mid',  text: 'Copy. Lifting.' },
    { at: 13800, speaker: 'Command',     pitch: 'low',  text: 'Understood, Omega. We will find another vault. Come home.' },
  ],
  failure: [
    { at:   900, speaker: 'Command', pitch: 'low', text: 'Convoy Omega, this is Central Command. Respond.' },
    { at:  5600, speaker: 'Command', pitch: 'low', text: 'Convoy Omega, do you copy? Report status.' },
    { at: 10400, speaker: 'Command', pitch: 'low', text: 'No contact. Mark Highway 17 as lost.' },
    { at: 14200, speaker: 'Command', pitch: 'low', text: 'All garrisons, this is Command. We need volunteers.' },
  ],
};

const CARDS = {
  gold:    { title: 'VACCINE DELIVERED',      sub: 'Full extraction from LZ Bravo',       color: '#f0c850' },
  silver:  { title: 'VACCINE DELIVERED',      sub: 'At a heavy price',                    color: '#d8d8d8' },
  bronze:  { title: 'EVACUATED',              sub: 'The sample was lost en route',        color: '#d0905a' },
  failure: { title: 'CONVOY LOST',            sub: 'Fort Omega held. The road did not.',  color: '#cc4030' },
};

export const EXTRACTION_DURATION = 21000;
const CARD_AT = 16200;
// Kept for the legacy wave-30 path (stale saves land on the gold script).
export const EXTRACTION_SCRIPT = SCRIPTS.gold;

export function mkExtraction(gs, result = null, party = null) {
  const tier = (result && result.tier) || 'gold';
  const alive = party || (gs.soldiers || []).filter(s => s.state !== 'dead');
  const crew = alive.slice(0, 6).map((s, i) => ({
    name: s.name, id: s.lookId ?? s.origId ?? s.id ?? i, weapon: s.weapon || 'rifle', jacket: s.jacket,
    civilian: !!s.civilian, veteran: !!s.veteran, police: !!s.police, swat: !!s.swat, bandit: !!s.bandit,
  }));
  return {
    startedAt: 0, lineIdx: 0, tier, crew,
    survivors: result ? result.survivors : alive.length + (gs.reserve || []).length,
    vaccine: !!(result ? result.vaccineDelivered : true),
    day: gs.day || 0,
    script: SCRIPTS[tier] || SCRIPTS.gold,
    durMs: EXTRACTION_DURATION,
  };
}

// Feet-anchored draw of an in-game actor at any position/scale.
function spriteAt(fn, ctx, ent, x, footY, sc, now) {
  ctx.save(); ctx.translate(x, footY - GY * sc); ctx.scale(sc, sc);
  fn(ctx, { ...ent, x: 0, lane: 0 }, now);
  ctx.restore();
}
function mkZ(i, type = 'walker') {
  const z = ZTP[type] || ZTP.walker;
  return { id: 'ez' + i, type, z, hp: z.hp, maxHp: z.hp, state: 'walk', facing: 1, walkPhase: i * 1.9,
    atkTimer: 0, hurtTimer: 0, deadAt: 0, activated: true };
}

function scheduleAudio(e, off) {
  if (!e._fired) e._fired = new Set();
  if (!e.soundQ) e.soundQ = [];
  const fire = (k, cond, ev) => { if (cond && !e._fired.has(k)) { e._fired.add(k); e.soundQ.push(ev); } };
  fire('wind', off > 0, { t: 'windStart', intensity: 0.6 });
  e.script.forEach((l, i) => fire('sq' + i, off >= l.at - 60, { t: 'squelch' }));
  if (e.tier === 'failure') {
    fire('static', off > 0, { t: 'staticStart', level: 0.9 });
    fire('fire1', off > 300, { t: 'crackle' });
    fire('fire2', off > 7000, { t: 'crackle' });
    fire('g1', off > 3500, { t: 'groan', zt: 'walker' });
    fire('g2', off > 9000, { t: 'groan', zt: 'walker' });
    fire('staticOff', off > CARD_AT, { t: 'staticStop' });
  } else {
    fire('heli', off > 0, { t: 'heliStart', intensity: 1.0 });
    fire('g1', off > 6800, { t: 'groan', zt: 'walker' });
    fire('heliOff', off > 13800, { t: 'heliStop' });
  }
  fire('windOff', off > EXTRACTION_DURATION - 400, { t: 'windStop' });
  fire('sting', off > CARD_AT, { t: 'titleSting' });
}

// Warm sunrise over the night city.
function dawn(ctx, k) {
  const g = ctx.createLinearGradient(0, 0, 0, GY);
  g.addColorStop(0, `rgba(40,30,70,${0.25 * k})`);
  g.addColorStop(0.6, `rgba(220,110,60,${0.28 * k})`);
  g.addColorStop(1, `rgba(255,170,90,${0.45 * k})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, GY);
  const sx = CW * 0.8, sy = GY - 20 - 40 * k;
  const halo = ctx.createRadialGradient(sx, sy, 10, sx, sy, 220);
  halo.addColorStop(0, `rgba(255,220,150,${0.55 * k})`); halo.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = halo; ctx.fillRect(sx - 220, sy - 220, 440, 440);
}

const ROOF = CH - 96;        // rooftop surface (feet line)
const PAD_X = 560;

function dRooftop(ctx, now, k) {
  // Slab with a front parapet edge.
  const g = ctx.createLinearGradient(0, ROOF - 30, 0, CH);
  g.addColorStop(0, '#3a3836'); g.addColorStop(0.3, '#2c2a28'); g.addColorStop(1, '#151413');
  ctx.fillStyle = g; ctx.fillRect(0, ROOF - 30, CW, CH - ROOF + 30);
  ctx.fillStyle = `rgba(255,170,100,${0.12 * k})`; ctx.fillRect(0, ROOF - 30, CW, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let x = -40; x < CW; x += 90) { ctx.beginPath(); ctx.moveTo(x, ROOF - 28); ctx.lineTo(x - 50, CH); ctx.stroke(); }
  // Helipad
  ctx.save(); ctx.translate(PAD_X, ROOF + 6); ctx.scale(1, 0.22);
  ctx.strokeStyle = 'rgba(230,200,70,0.75)'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(0, 0, 130, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(235,235,225,0.7)';
  ctx.fillRect(PAD_X - 34, ROOF - 1, 10, 14); ctx.fillRect(PAD_X + 24, ROOF - 1, 10, 14); ctx.fillRect(PAD_X - 24, ROOF + 4, 48, 4);
  // Edge lights blinking
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, on = Math.floor(now / 500 + i) % 2 === 0;
    ctx.fillStyle = on ? 'rgba(120,255,140,0.95)' : 'rgba(40,90,50,0.8)';
    ctx.beginPath(); ctx.arc(PAD_X + Math.cos(a) * 140, ROOF + 6 + Math.sin(a) * 30, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  // Stairwell hut (left) and AC units.
  ctx.fillStyle = '#252321'; ctx.fillRect(30, ROOF - 120, 120, 100);
  ctx.fillStyle = '#1a1817'; ctx.fillRect(22, ROOF - 128, 136, 10);
  ctx.fillStyle = '#0c0b0a'; ctx.fillRect(70, ROOF - 92, 44, 72);
  ctx.fillStyle = 'rgba(255,60,40,0.85)'; ctx.fillRect(84, ROOF - 104, 16, 7);
  ctx.fillStyle = '#2e2c2a'; ctx.fillRect(800, ROOF - 54, 70, 34); ctx.fillRect(812, ROOF - 66, 46, 12);
  ctx.strokeStyle = '#1a1918'; ctx.lineWidth = 2;
  for (let x = 806; x < 866; x += 8) { ctx.beginPath(); ctx.moveTo(x, ROOF - 50); ctx.lineTo(x, ROOF - 26); ctx.stroke(); }
}

function dSampleCase(ctx, x, y, now) {
  const p = 0.7 + 0.3 * Math.sin(now / 200);
  const gl = ctx.createRadialGradient(x, y, 1, x, y, 22);
  gl.addColorStop(0, `rgba(120,255,140,${0.55 * p})`); gl.addColorStop(1, 'rgba(80,255,120,0)');
  ctx.fillStyle = gl; ctx.fillRect(x - 22, y - 22, 44, 44);
  ctx.fillStyle = '#c8ccd0'; ctx.fillRect(x - 7, y - 5, 14, 10);
  ctx.fillStyle = '#5ae070'; ctx.fillRect(x - 5, y - 2, 10, 3);
}

function dLZ(ctx, e, off, now) {
  const k = Math.min(1, 0.35 + off / 12000);
  dBg(ctx, 0, now);
  dawn(ctx, k);
  dRooftop(ctx, now, k);

  // Helicopter: landed, then lifts off into the sunrise.
  const LIFT = 9800;
  const HS = 2.3, restY = ROOF - 30;
  let hx = PAD_X, hy = restY;
  if (off > LIFT) {
    const t = (off - LIFT) / 1000;
    hy = restY - t * t * 26 - t * 14;
    hx = PAD_X + Math.max(0, t - 1.2) ** 2 * 70;
  }
  // Rotor downwash dust while it's low.
  const low = Math.max(0, 1 - (restY - hy) / 160);
  if (low > 0) {
    for (let i = 0; i < 12; i++) {
      const ph = ((now / 700 + i / 12) % 1), side = i % 2 ? 1 : -1;
      ctx.fillStyle = `rgba(150,140,125,${0.22 * low * (1 - ph)})`;
      ctx.beginPath(); ctx.ellipse(PAD_X + side * (40 + ph * 200), ROOF + 4 - ph * 10, 18 + ph * 30, 6 + ph * 6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.save(); ctx.translate(hx, hy); ctx.scale(HS, HS);
  dHelicopter(ctx, 0, 0, now, { engineGlow: true, doorOpen: off < LIFT + 600 });
  ctx.restore();

  // Survivors run from the stairwell to the open door and board.
  const door = PAD_X - 14;
  e.crew.forEach((c, i) => {
    const start = 700 + i * 650;
    if (off < start) return;
    const x = 120 + (off - start) * 0.11;
    if (x >= door) return;               // aboard
    ctx.save(); ctx.translate(x, ROOF); ctx.scale(1.15, 1.15);
    drawSoldierBody(ctx, { ...c, state: 'walk', walkPhase: i * 1.3, facing: 1 }, now * 1.35);
    ctx.restore();
    if (i === 0 && e.vaccine) dSampleCase(ctx, x + 10, ROOF - 34, now);
  });

  // Walkers stumble out of the stairwell after the last one is clear.
  for (let i = 0; i < 5; i++) {
    const start = 6600 + i * 900;
    if (off < start) continue;
    const x = 95 + (off - start) * 0.035;
    spriteAt(dZombie, ctx, mkZ(i, i === 3 ? 'runner' : 'walker'), Math.min(x, door - 120), ROOF, 1.15, now);
  }
}

function dWreck(ctx, x, y, now) {
  // Burnt APC hull on its side-ish, wheels gone.
  const hg = ctx.createLinearGradient(0, y - 56, 0, y);
  hg.addColorStop(0, '#3e3426'); hg.addColorStop(0.25, '#23211b'); hg.addColorStop(1, '#0c0c0a');
  ctx.fillStyle = hg; ctx.strokeStyle = '#060605'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x - 96, y - 4); ctx.lineTo(x - 84, y - 50); ctx.lineTo(x + 36, y - 58); ctx.lineTo(x + 98, y - 32); ctx.lineTo(x + 92, y - 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  // Hatch, vision slits and a scorched star.
  ctx.fillStyle = '#1a1a16'; ctx.fillRect(x - 60, y - 48, 70, 14);
  ctx.fillStyle = '#060606'; ctx.fillRect(x + 50, y - 40, 22, 4); ctx.fillRect(x - 76, y - 32, 14, 4);
  ctx.fillStyle = 'rgba(200,200,190,0.25)'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.fillText('★', x + 10, y - 16); ctx.textAlign = 'left';
  // Bent turret barrel.
  ctx.strokeStyle = '#151513'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x - 20, y - 52); ctx.quadraticCurveTo(x + 20, y - 66, x + 50, y - 58); ctx.stroke();
  ctx.fillStyle = '#0a0a09';
  [-62, -20, 30, 66].forEach(wx => { ctx.beginPath(); ctx.arc(x + wx, y - 2, 11, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = 'rgba(120,40,10,0.5)'; ctx.fillRect(x - 40, y - 40, 50, 10);
  // Flames
  for (let i = 0; i < 7; i++) {
    const fx = x - 50 + i * 16, h = 26 + 16 * Math.sin(now / 90 + i * 1.7) + (i % 3) * 8;
    const g = ctx.createLinearGradient(0, y - 50 - h, 0, y - 44);
    g.addColorStop(0, 'rgba(255,220,120,0)'); g.addColorStop(0.4, 'rgba(255,150,40,0.9)'); g.addColorStop(1, 'rgba(255,80,20,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(fx - 8, y - 44); ctx.quadraticCurveTo(fx, y - 50 - h, fx + 8, y - 44); ctx.fill();
  }
  // Smoke column
  for (let i = 0; i < 8; i++) {
    const ph = (now / 2400 + i / 8) % 1;
    ctx.fillStyle = `rgba(30,28,26,${0.45 * (1 - ph)})`;
    ctx.beginPath(); ctx.arc(x - 10 + ph * 60 + Math.sin(i) * 10, y - 70 - ph * 260, 18 + ph * 40, 0, Math.PI * 2); ctx.fill();
  }
  const fl = ctx.createRadialGradient(x - 10, y - 50, 10, x - 10, y - 50, 200);
  fl.addColorStop(0, `rgba(255,120,40,${0.22 + 0.06 * Math.sin(now / 70)})`); fl.addColorStop(1, 'rgba(255,90,30,0)');
  ctx.fillStyle = fl; ctx.fillRect(x - 210, y - 250, 400, 300);
}

function dHighway(ctx, e, off, now) {
  // Frame the road well past the fort, like the siege camera would.
  const cam = 0;
  ctx.save(); ctx.translate(-340, 0); dBg(ctx, 340, now); ctx.restore();
  ctx.fillStyle = 'rgba(6,4,10,0.25)'; ctx.fillRect(0, 0, CW, CH);
  dWreck(ctx, 600 - cam, GY + 14, now);
  // Shattered vial in a green puddle.
  const vx = 420 - cam, vy = GY + 22, p = 0.7 + 0.3 * Math.sin(now / 300);
  const pg = ctx.createRadialGradient(vx, vy, 2, vx, vy, 40);
  pg.addColorStop(0, `rgba(90,255,120,${0.45 * p})`); pg.addColorStop(1, 'rgba(60,220,90,0)');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(vx, vy, 40, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8ccd0'; ctx.fillRect(vx - 14, vy - 5, 14, 9);
  ctx.fillStyle = 'rgba(180,255,190,0.8)';
  [[6, -2], [10, 1], [14, -1]].forEach(([dx, dy]) => ctx.fillRect(vx + dx, vy + dy, 2, 1));
  // Walkers drifting past the wreck, oblivious.
  for (let i = 0; i < 6; i++) {
    const x = CW + 40 + i * 150 - off * (0.03 + (i % 3) * 0.008) - cam;
    if (x < -60 || x > CW + 60) continue;
    spriteAt(dZombie, ctx, { ...mkZ(i, i === 4 ? 'tank' : 'walker'), facing: -1 }, x, GY + 30 + (i % 3) * 8, 1.0, now);
  }
}

function wrap(ctx, text, maxW) {
  const words = text.split(' '), out = [];
  let l = '';
  for (const w of words) {
    const t = l ? `${l} ${w}` : w;
    if (ctx.measureText(t).width > maxW && l) { out.push(l); l = w; } else l = t;
  }
  if (l) out.push(l);
  return out;
}

export function dExtractionScene(ctx, e, now) {
  const off = now - e.startedAt;
  scheduleAudio(e, off);
  ctx.save(); ctx.clearRect(0, 0, CW, CH);
  if (e.tier === 'failure') dHighway(ctx, e, off, now); else dLZ(ctx, e, off, now);

  // Letterbox + location tag.
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, 34); ctx.fillRect(0, CH - 34, CW, 34);
  if (off < 4200) {
    ctx.globalAlpha = Math.min(1, off / 500, (4200 - off) / 600);
    ctx.fillStyle = '#d8d8c8'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
    ctx.fillText(e.tier === 'failure' ? tr('HIGHWAY 17 · 05:41') : tr('LZ BRAVO · ROOFTOP · 05:52'), 24, 58);
    ctx.fillStyle = '#9a9a8a'; ctx.font = '10px monospace';
    ctx.fillText(tr('DAY {day} · OPERATION VACCINE', { day: e.day }), 24, 74);
    ctx.globalAlpha = 1;
  }

  // Radio subtitle with typewriter reveal.
  let cur = null;
  for (const l of e.script) { if (off >= l.at) cur = l; else break; }
  if (cur && off < cur.at + 4200 && off < CARD_AT) {
    const since = off - cur.at;
    const col = cur.speaker === 'Command' ? '#ff9a70' : cur.speaker === 'Omega' ? '#8aff8a' : '#9ad0ff';
    ctx.font = '13px monospace';
    const lines = wrap(ctx, tr(cur.text), CW - 160);
    const bh = 30 + lines.length * 18, by = CH - 46 - bh;
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(60, by, CW - 120, bh);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(60.5, by + 0.5, CW - 121, bh - 1);
    ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.font = 'bold 10px monospace';
    ctx.fillText(`◉ ${tr(cur.speaker).toUpperCase()}`, CW / 2, by + 15);
    ctx.fillStyle = '#f0f0e8'; ctx.font = '13px monospace';
    let left = Math.floor(since / 28);
    lines.forEach((ln, i) => { ctx.fillText(ln.slice(0, Math.max(0, left)), CW / 2, by + 34 + i * 18); left -= ln.length + 1; });
  }

  // Title card.
  if (off > CARD_AT) {
    const a = Math.min(1, (off - CARD_AT) / 1200);
    const card = CARDS[e.tier] || CARDS.gold;
    ctx.fillStyle = `rgba(0,0,0,${0.82 * a})`; ctx.fillRect(0, 0, CW, CH);
    ctx.globalAlpha = a; ctx.textAlign = 'center';
    ctx.fillStyle = card.color; ctx.font = 'bold 34px monospace';
    ctx.fillText(tr(card.title), CW / 2, CH / 2 - 14);
    ctx.fillStyle = '#c8c8b8'; ctx.font = '13px monospace';
    ctx.fillText(tr(card.sub), CW / 2, CH / 2 + 14);
    const a2 = Math.min(1, Math.max(0, (off - CARD_AT - 1200) / 900));
    ctx.globalAlpha = a2; ctx.fillStyle = '#8a8a7a'; ctx.font = '11px monospace';
    ctx.fillText(e.survivors === 1 ? tr('FORT OMEGA · 30 WAVES HELD · {n} SURVIVOR', { n: e.survivors }) : tr('FORT OMEGA · 30 WAVES HELD · {n} SURVIVORS', { n: e.survivors }), CW / 2, CH / 2 + 44);
    ctx.globalAlpha = 1;
  }

  // Progress + skip hint.
  const t01 = Math.min(1, off / e.durMs);
  ctx.fillStyle = '#14141c'; ctx.fillRect(40, CH - 22, CW - 80, 3);
  ctx.fillStyle = (CARDS[e.tier] || CARDS.gold).color; ctx.fillRect(40, CH - 22, (CW - 80) * t01, 3);
  ctx.fillStyle = '#888'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillText(tr('[SPACE / TAP] to continue'), CW / 2, CH - 8);
  ctx.textAlign = 'left';
  ctx.restore();
}
