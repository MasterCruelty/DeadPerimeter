// Job board logic (data in data/quests.js): offers, accepting, mission
// hooks (quest items / people placed at the target location), completion
// and rewards, and the fort upgrades unlocked by the main story.
import { NPCS, STORY, MAX_ACTIVE, FORT_UNLOCKS, SIDE_THANKS, sideJob, withArticle, FETCH_OFFER, CLEAR_OFFER, DELIVER_OFFER } from '../data/quests.js';
import { LOCATIONS, ensureCity } from '../data/city.js';
import { BALANCE } from '../data/difficulty.js';
import { FOUND_GUNS, WPN } from '../data/weapons.js';
import { stashGear } from '../entities/gear.js';
import { mkSoldier } from '../entities/soldier.js';
import { addXp } from '../data/progression.js';
import { t } from '../i18n/index.js';

export function ensureQuests(gs) {
  if (!gs.quests) gs.quests = {};
  const q = gs.quests;
  q.done = Array.isArray(q.done) ? q.done : [];
  q.active = Array.isArray(q.active) ? q.active : [];
  q.offers = q.offers || {};
  q.unlocks = q.unlocks || {};
  q.nextSide = q.nextSide || {};
  q.seq = q.seq || 0;
  q.log = Array.isArray(q.log) ? q.log : [];
  return q;
}

export const hasUnlock = (gs, k) => !!(gs && gs.quests && gs.quests.unlocks && gs.quests.unlocks[k]);
export const sortiesPerDay = gs => BALANCE.expeditionsPerDay + (hasUnlock(gs, 'radio') ? 1 : 0);
export const healCost = gs => (hasUnlock(gs, 'infirmary') ? 3 : 5);
export const turretMaterials = gs => Math.round(BALANCE.turretCostMaterials * (hasUnlock(gs, 'generator') ? 0.6 : 1));

// English name (ids and saves); tLocName for display.
export const locName = id => (LOCATIONS.find(l => l.id === id) || {}).name || id;
const tLocName = id => t(locName(id));

// Everything below returns display text in the current language. Saved
// jobs keep their English fields; side-job offers are rebuilt from the
// job's kind / item / location, so offers stored by older versions
// (already filled in English) display translated too.
export const jobTitle = job => t(job.title);
const isSide = job => !job.story && !STORY.some(s => s.id === job.id);
export function jobText(job) {
  const side = isSide(job);
  if (side && job.kind === 'fetch' && job.item) return t(FETCH_OFFER, { item: t(withArticle(job.item)), loc: tLocName(job.loc) });
  if (side && job.kind === 'clear') return t(CLEAR_OFFER, { loc: tLocName(job.loc) });
  if (side && job.kind === 'deliver') return t(DELIVER_OFFER);
  return t(job.offer || '').replace('{loc}', job.loc ? tLocName(job.loc) : '');
}

const resList = b => Object.entries(b || {}).map(([k, v]) => `${v} ${t(k)}`).join(', ');

// Short objective line for HUDs and lists.
export function jobGoal(job) {
  if (job.kind === 'fetch') return t('Recover the {item} — {loc}', { item: t(job.item), loc: tLocName(job.loc) });
  if (job.kind === 'rescue') return t('Bring {person} home — {loc}', { person: t(job.person), loc: tLocName(job.loc) });
  if (job.kind === 'clear') return t('Clear {loc} (infestation < {pct}%)', { loc: tLocName(job.loc), pct: Math.round(job.below * 100) });
  if (job.kind === 'deliver') return t('Hand over {list}', { list: resList(job.need) });
  return t(job.title);
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

// "+12 medicine, a weapon" (translated). `tr` = false gives the English
// text stored in the journal for older readers of the save.
export const rewardText = (r, tr = t) => Object.entries(r || {}).filter(([k, v]) => v && k !== 'xp' && k !== 'gear')
  .map(([k, v]) => `+${v} ${tr ? tr(k) : k}`).concat(r && r.gear ? [tr ? tr('a weapon') : 'a weapon'] : []).join(', ');
const gunText = (w, tr = t) => (w && WPN[w] ? ` + ${tr ? tr(WPN[w].name) : WPN[w].name}` : '');
// Offer card reward line: fort upgrade or resources.
export const offerReward = job => (job.unlock && FORT_UNLOCKS[job.unlock]
  ? `🏗 ${t(FORT_UNLOCKS[job.unlock].name)} — ${t(FORT_UNLOCKS[job.unlock].desc)}`
  : rewardText(job.reward));
// Journal entry text (entries from older saves only have the English).
export const logTitle = e => t(e.title);
export const logReward = e => (e.res ? rewardText(e.res) + gunText(e.gun) : t(e.reward));
export const unlockName = k => (k && FORT_UNLOCKS[k] ? t(FORT_UNLOCKS[k].name) : null);

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
  let gun = null;
  if (r.gear) {
    gun = FOUND_GUNS[Math.floor(Math.random() * FOUND_GUNS.length)];
    stashGear(gs, { kind: 'gun', w: gun });
  }
  const xp = r.xp || job.xp || 0;
  if (xp) gs.soldiers.forEach(s => { if (s.state !== 'dead') addXp(s, Math.round(xp / 2)); });
  if (job.unlock) {
    q.unlocks[job.unlock] = true;
    if (job.unlock === 'radio') {
      // First thing the new radio picks up: the Compact's broadcast.
      const st = ensureCity(gs).locs.compound;
      if (st) st.discovered = true;
    }
    if (job.unlock === 'cole') {
      const full = gs.soldiers.filter(s => s.state !== 'dead').length >= BALANCE.maxActiveSoldiers;
      if (full) {
        // Squad full: he waits on the bench (the reserve keeps no XP).
        gs.reserve = gs.reserve || [];
        gs.reserve.push({ name: 'Cole', weapon: 'ak', veteran: true, hp: 120 });
      } else {
        const cole = mkSoldier('Cole', 'ak', 270, 120, 1, false, false, { veteran: true });
        cole.ammo = 0; cole.level = 3; cole.xp = 180; cole.skillPts = 2;
        gs.soldiers.push(cole);
      }
      if (gs.usedNames) gs.usedNames.add('Cole');
    }
  }
  if (!job.story) q.nextSide[job.npc] = (gs.day || 1) + 1;
  // Journal entry (newest first, capped).
  // `reward` keeps the English text; `res` / `gun` let logReward
  // rebuild it in the current language.
  q.log.unshift({ day: gs.day || 1, npc: job.npc, title: job.title, story: !!job.story,
    reward: rewardText(r, false) + gunText(gun, false), res: r, gun, unlock: job.unlock || null });
  if (q.log.length > 30) q.log.length = 30;
  // Shown right away (sortie report / fort note): translated text.
  return {
    id: job.id, npc: job.npc, title: t(job.title),
    line: t(job.done || (SIDE_THANKS[job.npc] || ['Good work out there.'])[Math.floor(Math.random() * 3)]),
    reward: rewardText(r) + gunText(gun), unlock: unlockName(job.unlock),
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
