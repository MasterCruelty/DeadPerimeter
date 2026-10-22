import { ammoPool } from '../data/weapons.js';
import { hasUnlock } from '../update/quests.js';
import { mkMission } from '../update/mission.js';
import { VACCINE_SCENARIOS } from '../data/vaccineMission.js';
import { mkSoldier } from '../entities/soldier.js';
import { recordDeath } from '../entities/gameState.js';
import { KIND_HP, RECRUIT_WEAPONS } from '../data/expeditions.js';

// Build the playable party for the vaccine delivery — every alive
// squad member plus every reserve member (civilians + benched extras).
// Reserve members aren't real soldier objects, so we promote them to
// gs.soldiers for the duration of the campaign. On the way back
// (finishVaccineCampaign) we either re-bench survivors or record the
// death, so promotion is reversible.
//
// Returns the promoted soldier array; gs.soldiers is mutated in place.
function gatherVaccineParty(gs) {
  const alive = gs.soldiers.filter(s => s.state !== 'dead' && !s.onExpedition);
  const promoted = [];
  for (const r of (gs.reserve || [])) {
    const weapon = r.weapon || RECRUIT_WEAPONS[0];
    const hp = r.hp ?? (r.civilian ? KIND_HP.civilian : r.veteran ? KIND_HP.veteran : KIND_HP.recruit);
    const s = mkSoldier(r.name, weapon, 200, hp, 0, !!r.civilian, false, { veteran: !!r.veteran });
    s.state = 'idle';
    s.fromReserve = true;
    promoted.push(s);
    gs.soldiers.push(s);
  }
  gs.reserve = [];
  return [...alive, ...promoted];
}

// Make the campaign object. The first scenario's mkMission is built
// up-front; subsequent scenarios are built lazily on advance so they
// can pick up the survivors of the previous segment with their
// post-segment HP / ammo.
export function mkVaccineCampaign(gs, mags = 3) {
  const party = gatherVaccineParty(gs);
  if (party.length === 0) return null;
  // Issue a generous ammo loadout — there's no resupply between scenarios.
  party.forEach(soldier => {
    const poolKey = ammoPool(soldier.weapon);
    const wantLoaded = Math.max(0, soldier.maxAmmo - (soldier.ammo || 0));
    const giveLoaded = Math.min(wantLoaded, gs.resources[poolKey] || 0);
    gs.resources[poolKey] = (gs.resources[poolKey] || 0) - giveLoaded;
    soldier.ammo = (soldier.ammo || 0) + giveLoaded;
    const wantSpare = (mags - 1) * soldier.maxAmmo;
    const giveSpare = Math.min(wantSpare, gs.resources[poolKey] || 0);
    gs.resources[poolKey] = (gs.resources[poolKey] || 0) - giveSpare;
    soldier._sortieMags = 1 + Math.floor(giveSpare / soldier.maxAmmo);
    soldier.onExpedition = true;
  });
  const campaign = {
    vaccine: true,
    party,
    mags,
    current: null,
    currentIndex: 0,
    scenariosCleared: 0,
    // Carrier / pickup state — wired in a later commit. Kept here so
    // the renderer and finalizer can already read it without crashing.
    vaccinePickedUp: false,
    vaccineCarrierId: null,
    // Act checkpoints: unlimited retries, every one counted. The finale
    // closes a 30-wave run, so a hard cap would push the player into an
    // ending for running out of tries rather than for how they played;
    // the count goes into the final grade instead.
    checkpoint: null,
    retries: 0,
    retriesByAct: VACCINE_SCENARIOS.map(() => 0),
  };
  buildAct(campaign, gs, 0);
  saveVaccineCheckpoint(campaign);
  return campaign;
}

// Mint the mkMission for act `idx` from the party members still alive.
// carrierOrigId: the soldier who walks in holding the vial (undefined =
// no vial yet); null falls back to the lead.
function buildAct(campaign, gs, idx, carrierOrigId) {
  const survivors = campaign.party.filter(s => s.state !== 'dead');
  const m = mkMission(survivors, VACCINE_SCENARIOS[idx], gs.wave || 1, campaign.mags, gs.research?.completed);
  m._vaccineCampaign = true;
  m._vaccineIndex = idx;
  m._vaccineScenarioName = VACCINE_SCENARIOS[idx].name;
  // Grenades left over from the previous act (undefined: the default).
  if (campaign.grenades !== undefined) m.grenades = campaign.grenades;
  // If the vaccine was picked up in a previous scenario, hand it off
  // to a survivor in the new scenario so the carrier mechanic stays
  // continuous (no need to spawn another pickup).
  if (carrierOrigId !== undefined) {
    const carrier = [m.soldier, ...(m.followers || [])]
      .find(p => carrierOrigId && p.origId === carrierOrigId)
      || m.soldier;
    m._vaccineCollected = true;
    m._vaccineCarrierId = carrier.id;
    m._vaccineDropped = false;
  }
  campaign.current = m;
  campaign.currentIndex = idx;
  return m;
}

// Snapshot taken as an act starts: everything needed to replay it.
// Mission soldiers are copies, so the originals in campaign.party still
// hold the act-start HP / ammo / mags / melee wear until the act is
// written back — the snapshot keeps them safe from that write-back.
export function saveVaccineCheckpoint(campaign) {
  const m = campaign.current;
  const carrier = m._vaccineCollected && !m._vaccineDropped
    ? [m.soldier, ...(m.followers || [])].find(p => p && p.id === m._vaccineCarrierId)
    : null;
  campaign.checkpoint = {
    index: campaign.currentIndex,
    scenariosCleared: campaign.scenariosCleared,
    vaccinePickedUp: campaign.vaccinePickedUp,
    caseHeld: !!carrier,
    carrierOrigId: carrier ? carrier.origId : null,
    grenades: campaign.grenades,
    party: campaign.party.map(s => ({
      id: s.id, hp: s.hp, maxHp: s.maxHp, state: s.state,
      ammo: s.ammo, _sortieMags: s._sortieMags, onExpedition: s.onExpedition,
      melee: s.melee ? { ...s.melee } : null,
    })),
  };
  return campaign.checkpoint;
}

// Restart the current act from its checkpoint. The street is rolled
// again (fresh mkMission); the squad, the vial and the campaign progress
// are put back exactly as they were when the act began.
export function retryVaccineCheckpoint(campaign, gs) {
  const cp = campaign.checkpoint;
  if (!cp) return null;
  for (const snap of cp.party) {
    const s = campaign.party.find(p => p.id === snap.id);
    if (s) Object.assign(s, snap, { melee: snap.melee ? { ...snap.melee } : null });
  }
  campaign.scenariosCleared = cp.scenariosCleared;
  campaign.vaccinePickedUp = cp.vaccinePickedUp;
  campaign.grenades = cp.grenades;
  campaign.retries = (campaign.retries || 0) + 1;
  campaign.retriesByAct[cp.index] = (campaign.retriesByAct[cp.index] || 0) + 1;
  return buildAct(campaign, gs, cp.index, cp.caseHeld ? cp.carrierOrigId : undefined);
}

// Why the act that just ended counts as failed, or null: 'wiped' (no
// one left standing) or 'case' (won, but the vial was lost in this act —
// the hospital, where it is picked up, or a later act that began with
// it in hand).
export function vaccineActFailure(campaign) {
  const m = campaign && campaign.current;
  if (!m) return null;
  if (m.state === 'lost') return 'wiped';
  if (m.state !== 'won') return null;
  const mustHold = VACCINE_SCENARIOS[m._vaccineIndex]?._vaccineSegment === 'hospital'
    || !!campaign.checkpoint?.caseHeld;
  return mustHold && !(m._vaccineCollected && !m._vaccineDropped) ? 'case' : null;
}

// Pull the alive party from the just-completed scenario back into
// gs.soldiers (HP + ammo), then mint a fresh mkMission for the next
// scenario using those same originals as the party. Returns the new
// mission, or null if there are no survivors / no scenarios left.
export function advanceVaccineScenario(campaign, gs) {
  const m = campaign.current;
  const allMSol = [m.soldier, ...(m.followers || [])];
  for (const ms of allMSol) {
    const orig = gs.soldiers.find(s => s.id === ms.origId);
    if (!orig) continue;
    if (ms.hp <= 0 || ms.state === 'dead') {
      const wasAlive = orig.state !== 'dead';
      orig.hp = 0; orig.state = 'dead';
      if (wasAlive) recordDeath(gs, orig);
    } else {
      orig.hp = Math.max(1, ms.hp);
      orig.ammo = ms.ammo;
      // Carry the spare magazines over too — there is no resupply
      // between legs, but mkMission re-seeds magsLeft from _sortieMags,
      // which used to hand out a full fresh loadout every scenario.
      orig._sortieMags = 1 + Math.max(0, ms.magsLeft | 0);
    }
  }
  const nextIdx = campaign.currentIndex + 1;
  campaign.scenariosCleared = nextIdx;
  if (nextIdx >= VACCINE_SCENARIOS.length) return null;
  if (!campaign.party.some(s => s.state !== 'dead')) return null;
  // Roll the vaccine state from the cleared scenario forward. If the
  // sample was secured in the hospital, the carrier (or whoever's still
  // alive if the original carrier didn't make it) keeps holding it
  // through the rooftop scenario.
  const prevHadVaccine = m._vaccineCollected && !m._vaccineDropped;
  let carryCarrier;
  if (prevHadVaccine) {
    const prevCarrier = [m.soldier, ...(m.followers || [])].find(p => p && p.id === m._vaccineCarrierId);
    carryCarrier = (prevCarrier && prevCarrier.hp > 0 && prevCarrier.state !== 'dead')
      ? prevCarrier.origId
      : null;
  }
  campaign.vaccinePickedUp = campaign.vaccinePickedUp || !!m._vaccineCollected;
  if (m.grenades !== undefined) campaign.grenades = m.grenades;
  const next = buildAct(campaign, gs, nextIdx, carryCarrier);
  saveVaccineCheckpoint(campaign);
  return next;
}

// Wrap up the campaign — write the active mission's state back to
// gs.soldiers, demote any reserve-origin survivors back into reserve
// (so the victory screen survivor count still matches), tally lost
// soldiers, and surface the outcome tier (plus the retry count).
//
// Outcome tiers — three endings, to be expanded in the next commit:
//   gold:    all scenarios cleared, ≥4 survivors                (full win)
//   silver:  all scenarios cleared, 1-3 survivors               (pyrrhic win)
//   bronze:  partial — at least the hospital was cleared
//   failure: wiped on the highway or no survivors at all
export function finishVaccineCampaign(campaign, gs) {
  const m = campaign.current;
  const allMSol = [m.soldier, ...(m.followers || [])];
  for (const ms of allMSol) {
    const orig = gs.soldiers.find(s => s.id === ms.origId);
    if (!orig) continue;
    if (ms.hp <= 0 || ms.state === 'dead') {
      const wasAlive = orig.state !== 'dead';
      orig.hp = 0; orig.state = 'dead';
      if (wasAlive) recordDeath(gs, orig);
    } else {
      orig.hp = Math.max(1, ms.hp);
      orig.ammo = ms.ammo;
    }
    orig.onExpedition = false;
  }
  // Demote alive reserve-origin members back into gs.reserve so the
  // victory survivor count (alive squad + reserve) still works.
  const stillAlive = campaign.party.filter(s => s.state !== 'dead');
  for (const s of campaign.party) {
    if (!s.fromReserve) continue;
    const idx = gs.soldiers.indexOf(s);
    if (idx >= 0) gs.soldiers.splice(idx, 1);
    if (s.state !== 'dead') {
      gs.reserve.push({
        name: s.name, weapon: s.weapon,
        civilian: !!s.civilian, veteran: !!s.veteran,
        hp: s.hp,
      });
    }
  }
  const cleared = campaign.scenariosCleared + (m.state === 'won' ? 1 : 0);
  const survivors = stillAlive.length;
  // Vaccine "delivered" means: the sample was picked up at the hospital
  // AND the carrier was still holding it (vial not dropped on a dead
  // body) AND the rooftop scenario was cleared. Anything else = lost.
  const vaccineDelivered = !!(
    campaign.vaccinePickedUp
    && cleared >= VACCINE_SCENARIOS.length
    && m._vaccineCollected
    && !m._vaccineDropped
  );
  let tier;
  // The Hospital archive (story step 6) makes the gold ending reachable
  // with a smaller surviving squad.
  if (vaccineDelivered && survivors >= (hasUnlock(gs, 'vaccine') ? 3 : 4)) tier = 'gold';
  else if (vaccineDelivered && survivors >= 1) tier = 'silver';
  else if (cleared >= 2 && survivors >= 1) tier = 'bronze';
  else tier = 'failure';
  return { tier, survivors, scenariosCleared: cleared, vaccineDelivered, retries: campaign.retries || 0 };
}
