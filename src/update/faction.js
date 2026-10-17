// Northgate Compact logic (data in data/faction.js): trade, treasury
// growth, the assault sortie and its outcome, and reprisal raids.
import { uid } from '../constants.js';
import { WPN, FOUND_GUNS } from '../data/weapons.js';
import { COMPACT, COMPACT_STOCK, STANDING_PER_BUY, tierOf, discountOf, mkCompact } from '../data/faction.js';
import { stashGear } from '../entities/gear.js';
import { ensureCity } from '../data/city.js';

export function ensureCompact(gs) {
  if (!gs.compact) gs.compact = mkCompact();
  return gs.compact;
}

export const priceOf = (gs, item) => {
  const k = discountOf(ensureCompact(gs).standing);
  return Object.fromEntries(Object.entries(item.price).map(([r, v]) => [r, Math.max(1, Math.round(v * k))]));
};
export const stockFor = gs => COMPACT_STOCK.filter(i => i.tier <= tierOf(ensureCompact(gs).standing));
export const canAfford = (gs, price) => Object.entries(price).every(([k, v]) => (gs.resources[k] || 0) >= v);

// The first purchase of a day sends an envoy: one sortie slot.
export const envoyNeeded = gs => ensureCompact(gs).envoyDay !== gs.day;

export function buy(gs, itemId, sortiesPerDay) {
  const c = ensureCompact(gs);
  const item = stockFor(gs).find(i => i.id === itemId);
  if (!item || c.status !== 'neutral') return null;
  if (item.gun && c.guns <= 0) return null;
  const price = priceOf(gs, item);
  if (!canAfford(gs, price)) return null;
  if (envoyNeeded(gs)) {
    if ((gs.expeditionsToday || 0) >= sortiesPerDay) return null;
    gs.expeditionsToday = (gs.expeditionsToday || 0) + 1;
    c.envoyDay = gs.day;
  }
  Object.entries(price).forEach(([k, v]) => {
    gs.resources[k] -= v;
    c.treasury[k] = (c.treasury[k] || 0) + v;       // it all ends up in their vault
  });
  if (item.gun) { c.guns--; stashGear(gs, { kind: 'gun', w: item.gun }); }
  if (item.give) Object.entries(item.give).forEach(([k, v]) => { gs.resources[k] = Math.min(k === 'sniperAmmo' ? 99 : 999, (gs.resources[k] || 0) + v); });
  c.standing = Math.min(100, c.standing + STANDING_PER_BUY);
  return item.gun ? WPN[item.gun].name : Object.entries(item.give).map(([k, v]) => `${v} ${k}`).join(', ');
}

// A day passes: the Compact's stockpile grows.
export function compactDayTick(gs) {
  const c = ensureCompact(gs);
  if (c.status === 'destroyed') return;
  const t = c.treasury;
  t.materials += 4; t.food += 6; t.medicine += 2; t.ammo += 10;
  if ((gs.day || 1) % 4 === 0) c.guns = Math.min(8, c.guns + 1);
}

// ── Assault sortie ────────────────────────────────────────────────
// Called from setupCityMission when the destination is the compound:
// few dead, a garrison of trained soldiers (incl. the colonel), and the
// locked armory holding their guns and treasury.
export function setupAssault(m, dest, segs, lockedSeg, wave) {
  const info = dest.compactInfo || mkCompact();
  m.compactAssault = true;
  // The garrison keeps the dead away.
  m.zombies = m.zombies.filter((z, i) => i % 3 === 0 && z.type !== 'brute');
  const n = Math.min(14, 8 + Math.floor(wave / 4));
  const guns = ['rifle', 'rifle', 'ak', 'smg', 'shotgun', 'pistol'];
  const W = segs.length ? segs[segs.length - 1].x1 + 200 : 2400;
  for (let i = 0; i < n; i++) {
    const inside = i % 5 >= 2 && segs.length;
    const s = inside ? segs[i % segs.length] : null;
    const x = s ? s.x0 + 60 + Math.random() * (s.x1 - s.x0 - 120) : 600 + Math.random() * (W - 800);
    m.humans.push(mkTrooper(guns[i % guns.length], x, 80));
  }
  const arm = lockedSeg || segs[segs.length - 1];
  const voss = mkTrooper('ak', arm ? arm.x1 - 80 : W - 300, 260);
  voss.colonel = true; voss.name = COMPACT.leader;
  m.humans.push(voss);
  m.compactTotal = n + 1;
  // Armory + treasury: everything behind the locked door.
  if (arm) {
    const at = k => Math.round(arm.x0 + 80 + (arm.x1 - arm.x0 - 160) * k);
    for (let g = 0; g < info.guns; g++) {
      m.pickups.push({ id: uid(), x: at((g + 0.5) / Math.max(1, info.guns)), type: 'gear', item: { kind: 'gun', w: FOUND_GUNS[g % FOUND_GUNS.length] }, value: 1, collected: false, lane: 0 });
    }
    Object.entries(info.treasury).forEach(([k, v], j) => {
      if (!(v > 0)) return;
      const half = Math.ceil(v / 2);
      m.pickups.push({ id: uid(), x: at(0.15 + j * 0.2), type: k, value: half, collected: false, lane: 0 });
      m.pickups.push({ id: uid(), x: at(0.25 + j * 0.2), type: k, value: v - half, collected: false, lane: 0 });
    });
  }
}

function mkTrooper(weapon, x, hp) {
  const meta = WPN[weapon];
  return {
    id: uid(), x, hp, maxHp: hp, weapon, maxAmmo: meta.ammo, ammo: meta.ammo,
    state: 'idle', facing: -1, civilian: false, bandit: false, hostile: true, compact: true,
    walkPhase: Math.random() * Math.PI * 2, lastShot: 0, reloadStart: 0, hurtTimer: 0, deadAt: 0,
    activated: false, forkLane: 0, _laneY: 0,
  };
}

// After the assault sortie: did the Compact fall?
export function assaultOutcome(gs, m) {
  if (!m.compactAssault) return null;
  const c = ensureCompact(gs);
  const troops = (m.humans || []).filter(h => h.compact);
  const dead = troops.filter(h => h.state === 'dead' || h.hp <= 0).length;
  const colonel = troops.some(h => h.colonel && (h.state === 'dead' || h.hp <= 0));
  if (m.state === 'won' && (colonel || dead >= Math.ceil(troops.length * 0.8))) {
    c.status = 'destroyed'; c.guns = 0; c.treasury = { materials: 0, food: 0, medicine: 0, ammo: 0 };
    const st = ensureCity(gs).locs[COMPACT.locId];
    if (st) { st.infest = 0.15; st.loot = 0.1; }
    return { fallen: true, line: `${COMPACT.name} is finished. Their armory is ours.` };
  }
  c.status = 'hostile';
  c.nextRaidDay = gs.day + 1;
  return { fallen: false, line: `${COMPACT.name} survived the attack. Expect them at the wall.` };
}

// Hostile Compact: every few days a raid replaces the wave's enemies.
export function raidDue(gs) {
  const c = ensureCompact(gs);
  return c.status === 'hostile' && (gs.day || 1) >= c.nextRaidDay;
}
export function raidLaunched(gs) { ensureCompact(gs).nextRaidDay = (gs.day || 1) + 5; }

