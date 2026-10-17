// Job board logic (data in data/quests.js): offers, accepting, mission
// hooks (quest items / people placed at the target location), completion
// and rewards, and the fort upgrades unlocked by the main story.
import { NPCS, STORY, MAX_ACTIVE, FORT_UNLOCKS, SIDE_THANKS, sideJob } from '../data/quests.js';
import { LOCATIONS, ensureCity } from '../data/city.js';
import { BALANCE } from '../data/difficulty.js';
import { FOUND_GUNS, WPN } from '../data/weapons.js';
import { stashGear } from '../entities/gear.js';
import { mkSoldier } from '../entities/soldier.js';
import { addXp } from '../data/progression.js';

export function ensureQuests(gs) {
  if (!gs.quests) gs.quests = {};
  const q = gs.quests;
  q.done = Array.isArray(q.done) ? q.done : [];
  q.active = Array.isArray(q.active) ? q.active : [];
  q.offers = q.offers || {};
  q.unlocks = q.unlocks || {};
  q.nextSide = q.nextSide || {};
  q.seq = q.seq || 0;
  return q;
}

export const hasUnlock = (gs, k) => !!(gs && gs.quests && gs.quests.unlocks && gs.quests.unlocks[k]);
export const sortiesPerDay = gs => BALANCE.expeditionsPerDay + (hasUnlock(gs, 'radio') ? 1 : 0);
export const healCost = gs => (hasUnlock(gs, 'infirmary') ? 3 : 5);
export const turretMaterials = gs => Math.round(BALANCE.turretCostMaterials * (hasUnlock(gs, 'generator') ? 0.6 : 1));

export const locName = id => (LOCATIONS.find(l => l.id === id) || {}).name || id;
export const jobText = job => (job.offer || '').replace('{loc}', job.loc ? locName(job.loc) : '');

// Short objective line for HUDs and lists.
export function jobGoal(job) {
  if (job.kind === 'fetch') return `Recover the ${job.item} — ${locName(job.loc)}`;
  if (job.kind === 'rescue') return `Bring ${job.person} home — ${locName(job.loc)}`;
  if (job.kind === 'clear') return `Clear ${locName(job.loc)} (infestation < ${Math.round(job.below * 100)}%)`;
  if (job.kind === 'deliver') return `Hand over ${Object.entries(job.need).map(([k, v]) => `${v} ${k}`).join(', ')}`;
  return job.title;
}

// Fill empty offer slots (called whenever the command center opens).
export function refreshOffers(gs) {
  const q = ensureQuests(gs), city = ensureCity(gs);
  const busy = new Set(q.active.map(j => j.npc));
  const discovered = LOCATIONS.filter(l => city.locs[l.id].discovered).map(l => l.id);
  Object.keys(NPCS).forEach(npc => {
    if (q.offers[npc] || busy.has(npc)) return;
    const step = STORY.find(s => s.npc === npc && !q.done.includes(s.id) && !q.active.some(j => j.id === s.id)
      && (!s.after || q.done.includes(s.after)) && (gs.wave || 1) >= s.minWave);
    if (step) { q.offers[npc] = { ...step, story: true, reward: { xp: 60 } }; return; }
    // The next story step for this NPC is still gated: side jobs meanwhile.
    if ((q.nextSide[npc] || 0) > (gs.day || 1)) return;
    const job = sideJob(npc, gs, discovered);
    if (job) q.offers[npc] = { ...job, id: `side${++q.seq}`, npc };
  });
}

export function acceptJob(gs, npc) {
  const q = ensureQuests(gs);
  const job = q.offers[npc];
  if (!job || q.active.length >= MAX_ACTIVE) return false;
  delete q.offers[npc];
  q.active.push({ ...job, npc, acceptedDay: gs.day });
  // The NPC tells you where to go: reveal the target on the map.
  if (job.loc) ensureCity(gs).locs[job.loc].discovered = true;
  return true;
}

export function declineJob(gs, npc) {
  const q = ensureQuests(gs);
  const job = q.offers[npc];
  if (!job || job.story) return;
  delete q.offers[npc];
  q.nextSide[npc] = (gs.day || 1) + 1;
}

// Active fetch / rescue jobs at a location, for the mission generator.
export const jobsAt = (gs, locId) => ensureQuests(gs).active
  .filter(j => j.loc === locId && (j.kind === 'fetch' || j.kind === 'rescue'))
  .map(j => ({ id: j.id, kind: j.kind, item: j.item, person: j.person }));

const rewardText = r => Object.entries(r || {}).filter(([k, v]) => v && k !== 'xp' && k !== 'gear')
  .map(([k, v]) => `+${v} ${k}`).concat(r && r.gear ? ['a weapon'] : []).join(', ');

function grant(gs, job) {
  const q = ensureQuests(gs);
  q.active = q.active.filter(j => j.id !== job.id);
  if (!q.done.includes(job.id)) q.done.push(job.id);
  const r = job.reward || {};
  const caps = { sniperAmmo: 99 };
  Object.entries(r).forEach(([k, v]) => {
    if (k === 'xp' || k === 'gear' || typeof v !== 'number') return;
    gs.resources[k] = Math.min(caps[k] || 999, (gs.resources[k] || 0) + v);
  });
  let extra = '';
  if (r.gear) {
    const w = FOUND_GUNS[Math.floor(Math.random() * FOUND_GUNS.length)];
    stashGear(gs, { kind: 'gun', w }); extra = ` + ${WPN[w].name}`;
  }
  const xp = r.xp || job.xp || 0;
  if (xp) gs.soldiers.forEach(s => { if (s.state !== 'dead') addXp(s, Math.round(xp / 2)); });
  if (job.unlock) {
    q.unlocks[job.unlock] = true;
    if (job.unlock === 'cole') {
      const cole = mkSoldier('Cole', 'ak', 270, 120, 1, false, false, { veteran: true });
      cole.ammo = 0; cole.level = 3; cole.xp = 180; cole.skillPts = 2;
      gs.soldiers.push(cole);
      if (gs.usedNames) gs.usedNames.add('Cole');
    }
  }
  if (!job.story) q.nextSide[job.npc] = (gs.day || 1) + 1;
  return {
    id: job.id, npc: job.npc, title: job.title,
    line: job.done || (SIDE_THANKS[job.npc] || ['Good work out there.'])[Math.floor(Math.random() * 3)],
    reward: rewardText(r) + extra, unlock: job.unlock ? FORT_UNLOCKS[job.unlock].name : null,
  };
}

// After a sortie: items / people brought back, places cleared.
export function completeAfterSortie(gs, m) {
  const q = ensureQuests(gs);
  const out = [];
  if (m.state === 'won') {
    const got = new Set((m.collected.quests || []));
    (m.rescuables || []).forEach(r => { if (r.questId && r.state === 'following' && r.hp > 0 && r.x < 420) got.add(r.questId); });
    q.active.filter(j => got.has(j.id)).forEach(j => out.push(grant(gs, j)));
  }
  const city = ensureCity(gs);
  q.active.filter(j => j.kind === 'clear' && city.locs[j.loc] && city.locs[j.loc].infest < j.below).forEach(j => out.push(grant(gs, j)));
  return out;
}

export function canDeliver(gs, job) {
  return job.kind === 'deliver' && Object.entries(job.need).every(([k, v]) => (gs.resources[k] || 0) >= v);
}
export function deliverJob(gs, id) {
  const q = ensureQuests(gs);
  const job = q.active.find(j => j.id === id);
  if (!job || !canDeliver(gs, job)) return null;
  Object.entries(job.need).forEach(([k, v]) => { gs.resources[k] -= v; });
  return grant(gs, job);
}

export const NPC_LIST = Object.entries(NPCS).map(([id, n]) => ({ id, ...n }));
