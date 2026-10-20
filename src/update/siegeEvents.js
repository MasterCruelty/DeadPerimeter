// Mid-wave radio events for the siege. At most one per wave, rolled at
// wave start and fired 12–30 s in, so the player has to react while the
// fight is on:
//
//   survivor — a civilian sprints for the gate with runners on their
//              heels. Keep the lane clear; if they make it they join
//              the reserve.
//   supply   — Command drops a crate in the field. A soldier has to walk
//              out to it (click the lane) before it's lost.
import { WX, rng, laneY } from '../constants.js';
import { BALANCE } from '../data/difficulty.js';
import { mkZombie } from '../entities/zombie.js';
import { pushRadio } from '../audio/radio.js';

const SURVIVOR_NAMES = ['Lena', 'Marco', 'Rosa', 'Ivan', 'Jun', 'Sami', 'Nora', 'Teo', 'Ada', 'Omar'];
const CRATE_LIFE = 26000;

export function rollSiegeEvent(gs) {
  if (gs.wave < 3 || gs.wave >= BALANCE.maxWaves) return null;
  // Safety net: when the stash is nearly empty Command may fly in an
  // ammo crate — at most once every 3 waves, so it can't replace sorties.
  if ((gs.resources.ammo || 0) < 15 + gs.wave * 2 && gs.wave - (gs.lastRichCrate ?? -9) >= 3 && Math.random() < 0.6) {
    return { type: 'supply', at: rng(9000, 20000), state: 'pending', rich: true };
  }
  if (Math.random() > 0.45) return null;
  const type = gs.isHumanWave || Math.random() < 0.5 ? 'supply' : 'survivor';
  return { type, at: rng(12000, 30000), state: 'pending' };
}

function startEvent(gs, ev, now) {
  ev.state = 'active'; ev.startedAt = now;
  ev.lane = Math.floor(Math.random() * 3);
  if (ev.type === 'survivor') {
    ev.name = SURVIVOR_NAMES[Math.floor(Math.random() * SURVIVOR_NAMES.length)];
    ev.x = WX + 820; ev.hp = 40; ev.maxHp = 40;
    // Runners already on their heels.
    if (!gs.isHumanWave) {
      for (let i = 0; i < 2 + Math.floor(gs.wave / 8); i++) {
        const z = mkZombie('runner');
        z.lane = ev.lane; z.x = ev.x + 90 + i * 45;
        gs.zombies.push(z); gs.zombiesSpawned++;
      }
    }
    pushRadio(gs, 'deploy', { line: `Survivor running for the gate, lane ${ev.lane + 1}! Cover them!`, urgent: true, cooldown: 0 });
  } else {
    ev.x = WX + rng(320, 640); ev.dropY = -320; ev.landed = false;
    if (ev.rich) gs.lastRichCrate = gs.wave;   // the cooldown starts when it actually flies in
    pushRadio(gs, 'deploy', { line: ev.rich ? 'Command heard we are running dry. Ammo crate inbound!' : 'Command dropping a crate in the field. Go get it!', cooldown: 0 });
    gs.soundQ.push({ t: 'heliStart', intensity: 0.5 });
  }
}

function finish(gs, ev, ok, now, line) {
  ev.state = ok ? 'done' : 'failed'; ev.endedAt = now;
  pushRadio(gs, ok ? 'kill' : 'hurt', { line, cooldown: 0, urgent: !ok });
}

export function tickSiegeEvent(gs, now, dt) {
  const ev = gs.waveEvent;
  if (!ev || ev.state === 'done' || ev.state === 'failed') return;
  if (ev.state === 'pending') { if (gs.waveTime >= ev.at && !gs.waveComplete) startEvent(gs, ev, now); return; }

  if (ev.type === 'survivor') {
    ev.x -= 1.15 * (dt / 16);
    // Any walking dead touching them in their lane chews on them.
    const biters = gs.zombies.filter(z => z.state !== 'dead' && z.lane === ev.lane && Math.abs(z.x - ev.x) < 26);
    if (biters.length) { ev.hp -= biters.length * 0.012 * dt; ev.hurtAt = now; }
    if (ev.hp <= 0) { finish(gs, ev, false, now, `We lost ${ev.name}...`); return; }
    if (ev.x <= WX + 30) {
      if (!Array.isArray(gs.reserve)) gs.reserve = [];
      if (gs.reserve.length < BALANCE.maxReserveSoldiers) gs.reserve.push({ name: ev.name, weapon: 'pistol', civilian: true, hp: Math.max(20, Math.round(ev.hp * 1.5)) });
      gs.score += 150;
      gs.effects.push({ type: 'txt', x: WX + 40, y: laneY(ev.lane) - 70, v: `+ ${ev.name} JOINS THE RESERVE`, col: '#88ee99', at: now, dur: 2200 });
      finish(gs, ev, true, now, `${ev.name} is inside! Good work!`);
    }
    return;
  }

  // Supply crate: parachute descent, then a recovery timer.
  if (!ev.landed) {
    ev.dropY += 2.2 * (dt / 16);
    if (ev.dropY >= 0) {
      ev.dropY = 0; ev.landed = true; ev.landedAt = now;
      gs.soundQ.push({ t: 'thud', x: ev.x }); gs.soundQ.push({ t: 'heliStop' });
    }
    return;
  }
  const s = gs.soldiers.find(q => q.state !== 'dead' && !q.onExpedition && !q.onRoof && Math.abs(q.x - ev.x) < 30);
  if (s) {
    const r = gs.resources;
    const pool = [['ammo', 40], ['medicine', 10], ['materials', 15], ['turretAmmo', 30], ['sniperAmmo', 6]]
      .sort(() => Math.random() - 0.5);
    const loot = ev.rich
      ? [['ammo', 25 + gs.wave * 2], pool.find(([k]) => k !== 'ammo')]
      : pool.slice(0, 2);
    loot.forEach(([k, v]) => { r[k] = Math.min(k === 'sniperAmmo' ? 99 : 999, (r[k] || 0) + v); });
    ev.loot = loot;
    gs.soundQ.push({ t: 'pickup', x: ev.x });
    const icon = { ammo: '🔫', medicine: '💊', materials: '🔧', turretAmmo: '🟠', sniperAmmo: '🎯' };
    gs.effects.push({ type: 'txt', x: ev.x, y: laneY(ev.lane) - 70, v: loot.map(([k, v]) => `+${v} ${icon[k]}`).join('  '), col: '#ffd54a', at: now, dur: 2000 });
    finish(gs, ev, true, now, `${s.name}: got the crate!`);
  } else if (now - ev.landedAt > CRATE_LIFE) {
    finish(gs, ev, false, now, 'Crate is lost. They overran it.');
  }
}

// Seconds left on the crate timer, for the HUD.
export const crateLeft = (ev, now) => ev && ev.landed ? Math.max(0, Math.ceil((CRATE_LIFE - (now - ev.landedAt)) / 1000)) : null;

// Wave cleared with the crate still out there: the cleanup crew brings it in.
export function settleSiegeEvent(gs, now) {
  const ev = gs.waveEvent;
  if (ev && ev.type === 'supply' && ev.state === 'active') {
    const s = gs.soldiers.find(q => q.state !== 'dead' && !q.onExpedition && !q.onRoof);
    if (s) { s.x = ev.x; ev.landed = true; tickSiegeEvent(gs, now, 0); }
  }
}
