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
    const poolKey = soldier.weapon === 'sniper' ? 'sniperAmmo' : 'ammo';
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
  const first = mkMission(party, VACCINE_SCENARIOS[0], gs.wave || 1, mags);
  first._vaccineCampaign = true;
  first._vaccineIndex = 0;
  return {
    vaccine: true,
    party,
    mags,
    current: first,
    currentIndex: 0,
    scenariosCleared: 0,
    // Carrier / pickup state — wired in a later commit. Kept here so
    // the renderer and finalizer can already read it without crashing.
    vaccinePickedUp: false,
    vaccineCarrierId: null,
  };
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
    }
  }
  const nextIdx = campaign.currentIndex + 1;
  campaign.scenariosCleared = nextIdx;
  if (nextIdx >= VACCINE_SCENARIOS.length) return null;
  const survivors = campaign.party.filter(s => s.state !== 'dead');
  if (survivors.length === 0) return null;
  const next = mkMission(survivors, VACCINE_SCENARIOS[nextIdx], gs.wave || 1, campaign.mags);
  next._vaccineCampaign = true;
  next._vaccineIndex = nextIdx;
  campaign.current = next;
  campaign.currentIndex = nextIdx;
  return next;
}

// Wrap up the campaign — write the active mission's state back to
// gs.soldiers, demote any reserve-origin survivors back into reserve
// (so the victory screen survivor count still matches), tally lost
// soldiers, and surface the outcome tier.
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
  let tier;
  if (cleared >= VACCINE_SCENARIOS.length && survivors >= 4) tier = 'gold';
  else if (cleared >= VACCINE_SCENARIOS.length && survivors >= 1) tier = 'silver';
  else if (cleared >= 2 && survivors >= 1) tier = 'bronze';
  else tier = 'failure';
  return { tier, survivors, scenariosCleared: cleared };
}
