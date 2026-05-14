import { rng } from '../constants.js';
import { RECRUIT_NAMES, RECRUIT_WEAPONS } from '../data/expeditions.js';
import { BALANCE } from '../data/difficulty.js';
import { mkSoldier } from '../entities/soldier.js';

export function finishMission(m, gs) {
  // Write each party member's mission state back onto the original soldier
  // in gs.soldiers. The lead drives the win / lose outcome.
  const partyMission = [m.soldier, ...(m.followers || [])];
  const writeBack = (mSol) => {
    const orig = gs.soldiers.find(s => s.id === mSol.origId);
    if (!orig) return;
    if (mSol.hp <= 0 || mSol.state === 'dead') {
      orig.hp = 0; orig.state = 'dead';
    } else {
      orig.hp = Math.max(1, mSol.hp);
      orig.ammo = mSol.ammo;
    }
    orig.onExpedition = false;
  };
  partyMission.forEach(writeBack);

  const orig = gs.soldiers.find(s => s.id === m.origSoldier.id);
  if (!orig) return null;
  let outcome = m.state === 'won' ? 'success' : 'kia';
  if (m.state === 'lost') outcome = 'kia';

  const reward = {};
  if (m.collected.ammo)      { gs.resources.ammo      = Math.min(999, gs.resources.ammo + m.collected.ammo);           reward.ammo = m.collected.ammo; }
  if (m.collected.medicine)  { gs.resources.medicine  = Math.min(999, gs.resources.medicine + m.collected.medicine);   reward.medicine = m.collected.medicine; }
  if (m.collected.food)      { gs.resources.food      = Math.min(999, gs.resources.food + m.collected.food);           reward.food = m.collected.food; }
  if (m.collected.materials) { gs.resources.materials = Math.min(999, gs.resources.materials + m.collected.materials); reward.materials = m.collected.materials; }
  if (m.collected.sniperAmmo){ gs.resources.sniperAmmo= Math.min(99,  (gs.resources.sniperAmmo || 0) + m.collected.sniperAmmo); reward.sniperAmmo = m.collected.sniperAmmo; }
  if (m.collected.turretAmmo){ gs.resources.turretAmmo= Math.min(999, (gs.resources.turretAmmo || 0) + m.collected.turretAmmo); reward.turretAmmo = m.collected.turretAmmo; }

  let recruit = null;
  if (m.collected.civilian && outcome === 'success') {
    const availNames = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (availNames.length > 0) {
      const name = availNames[Math.floor(Math.random() * availNames.length)];
      const weapon = RECRUIT_WEAPONS[Math.floor(Math.random() * RECRUIT_WEAPONS.length)];
      recruit = { name, weapon, hp: rng(55, 85) };
      gs.usedNames.add(name);
      // Push to active duty if there is room, otherwise to the reserve.
      const activeCount = gs.soldiers.filter(s => s.state !== 'dead').length;
      if (activeCount < BALANCE.maxActiveSoldiers) {
        const ns = mkSoldier(name, weapon, 270, recruit.hp, Math.floor(Math.random() * 3), true);
        ns.ammo = 0;
        gs.soldiers.push(ns);
      } else if ((gs.reserve?.length || 0) < BALANCE.maxReserveSoldiers) {
        gs.reserve = gs.reserve || [];
        gs.reserve.push({ name, weapon, civilian: true });
      }
    }
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
