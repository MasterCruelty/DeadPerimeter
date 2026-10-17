import { rng } from '../constants.js';
import { RECRUIT_NAMES, CIVILIAN_WEAPONS, VETERAN_WEAPONS, KIND_HP } from '../data/expeditions.js';
import { BALANCE } from '../data/difficulty.js';
import { mkSoldier } from '../entities/soldier.js';
import { recordDeath } from '../entities/gameState.js';

export function finishMission(m, gs) {
  // Write each party member's mission state back onto the original soldier
  // in gs.soldiers. The lead drives the win / lose outcome.
  const partyMission = [m.soldier, ...(m.followers || [])];
  let returned = 0;
  const writeBack = (mSol) => {
    const orig = gs.soldiers.find(s => s.id === mSol.origId);
    if (!orig) return;
    if (mSol.hp <= 0 || mSol.state === 'dead') {
      // Was this soldier alive before the mission? Only count NEW deaths so
      // a body left behind on a previous failed expedition isn't tallied twice.
      const wasAlive = orig.state !== 'dead';
      orig.hp = 0; orig.state = 'dead';
      if (wasAlive) recordDeath(gs, orig);
    } else {
      orig.hp = Math.max(1, mSol.hp);
      orig.ammo = mSol.ammo;
      // Unused spare magazines go back into the stash (they used to
      // vanish, so every sortie burned its whole loadout).
      const spare = Math.max(0, mSol.magsLeft || 0) * (mSol.maxAmmo || 0);
      if (spare > 0) {
        const key = mSol.weapon === 'sniper' ? 'sniperAmmo' : 'ammo';
        gs.resources[key] = Math.min(key === 'sniperAmmo' ? 99 : 999, (gs.resources[key] || 0) + spare);
        returned += spare;
      }
    }
    orig.onExpedition = false;
  };
  partyMission.forEach(writeBack);

  const orig = gs.soldiers.find(s => s.id === m.origSoldier.id);
  if (!orig) return null;
  let outcome = m.state === 'won' ? 'success' : 'kia';
  if (m.state === 'lost') outcome = 'kia';

  // Per-sortie food cost (fatigue / rations on the road). Each
  // surviving party member eats sortieFoodCostPerSoldier food on
  // return. Stamped on the result so the post-mission log can
  // surface the deduction.
  const survivors = partyMission.filter(ms => ms.hp > 0 && ms.state !== 'dead').length;
  // City sorties already paid their travel rations at launch.
  const foodCost = m.dest && m.dest.locId ? 0 : Math.min(gs.resources.food || 0, survivors * BALANCE.sortieFoodCostPerSoldier);
  gs.resources.food = Math.max(0, (gs.resources.food || 0) - foodCost);

  const reward = {};
  if (foodCost > 0) reward.foodCost = foodCost;
  if (returned > 0) reward.returnedAmmo = returned;
  // Sortie kills count toward the run's tally + score.
  gs.kills = (gs.kills || 0) + (m.killedCount || 0);
  gs.score = (gs.score || 0) + (m.killedCount || 0) * 10 + (m.state === 'won' ? 50 : 0);
  if (m.collected.ammo)      { gs.resources.ammo      = Math.min(999, gs.resources.ammo + m.collected.ammo);           reward.ammo = m.collected.ammo; }
  if (m.collected.medicine)  { gs.resources.medicine  = Math.min(999, gs.resources.medicine + m.collected.medicine);   reward.medicine = m.collected.medicine; }
  if (m.collected.food)      { gs.resources.food      = Math.min(999, gs.resources.food + m.collected.food);           reward.food = m.collected.food; }
  if (m.collected.materials) { gs.resources.materials = Math.min(999, gs.resources.materials + m.collected.materials); reward.materials = m.collected.materials; }
  if (m.collected.sniperAmmo){ gs.resources.sniperAmmo= Math.min(99,  (gs.resources.sniperAmmo || 0) + m.collected.sniperAmmo); reward.sniperAmmo = m.collected.sniperAmmo; }
  if (m.collected.turretAmmo){ gs.resources.turretAmmo= Math.min(999, (gs.resources.turretAmmo || 0) + m.collected.turretAmmo); reward.turretAmmo = m.collected.turretAmmo; }

  // Rescued civilians (NPCs that followed the lead to the goal alive).
  // Each one is funnelled into the reserve as a future civilian recruit,
  // honouring the existing reserve cap.
  const rescued = m.collected.rescuedCivs || 0;
  if (rescued > 0 && outcome === 'success') {
    gs.reserve = gs.reserve || [];
    for (let i = 0; i < rescued; i++) {
      if (gs.reserve.length >= BALANCE.maxReserveSoldiers) break;
      const availNames = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
      if (availNames.length === 0) break;
      const name = availNames[Math.floor(Math.random() * availNames.length)];
      // Rescued civilians are civilians: pistol/shotgun pool and the
      // civilian HP cap (they used to arrive with rifles and 100 HP).
      const weapon = CIVILIAN_WEAPONS[Math.floor(Math.random() * CIVILIAN_WEAPONS.length)];
      gs.usedNames.add(name);
      gs.reserve.push({ name, weapon, civilian: true, hp: KIND_HP.civilian });
    }
    reward.rescuedCivs = rescued;
  }

  // Helper: pick the right weapon pool / hp range / flags for a recruit
  // depending on whether they're a civilian or a recovered military
  // soldier. Pushes to active duty if there is room, otherwise reserve.
  const pushRecruit = (kind /* 'civilian' | 'veteran' */) => {
    const availNames = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (availNames.length === 0) return null;
    const isVet = kind === 'veteran';
    const name = availNames[Math.floor(Math.random() * availNames.length)];
    const pool = isVet ? VETERAN_WEAPONS : CIVILIAN_WEAPONS;
    const weapon = pool[Math.floor(Math.random() * pool.length)];
    const cap = isVet ? KIND_HP.veteran : KIND_HP.civilian;
    const hp = isVet ? rng(70, cap - 10) : rng(35, cap - 10);
    gs.usedNames.add(name);
    const activeCount = gs.soldiers.filter(s => s.state !== 'dead').length;
    if (activeCount < BALANCE.maxActiveSoldiers) {
      const ns = mkSoldier(name, weapon, 270, hp, Math.floor(Math.random() * 3), !isVet, false, { veteran: isVet });
      ns.ammo = 0;
      gs.soldiers.push(ns);
    } else if ((gs.reserve?.length || 0) < BALANCE.maxReserveSoldiers) {
      gs.reserve = gs.reserve || [];
      gs.reserve.push({ name, weapon, civilian: !isVet, veteran: isVet, hp });
    } else {
      return null;
    }
    return { name, weapon, hp, civilian: !isVet, veteran: isVet };
  };

  let recruit = null;
  if (m.collected.civilian && outcome === 'success') {
    recruit = pushRecruit('civilian');
  }
  if (m.collected.lostSoldier && outcome === 'success') {
    const vet = pushRecruit('veteran');
    if (vet) reward.lostSoldier = 1;
    // The narrative log uses `recruit` for the headline; prefer the
    // veteran when both are collected (it's the rarer find).
    if (vet) recruit = vet;
  }
  const totalDmg = partyMission.reduce((sum, ms) => sum + Math.max(0, ms.maxHp - ms.hp), 0);
  const kiaNames = partyMission.filter(ms => ms.hp <= 0 || ms.state === 'dead').map(ms => ms.name);
  return {
    soldierName: m.soldier.name,
    soldierNames: partyMission.map(ms => ms.name),
    kiaNames,
    destName: m.dest.name,
    outcome,
    reward, recruit,
    dmgTaken: totalDmg,
  };
}
