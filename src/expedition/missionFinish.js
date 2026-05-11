import { rng } from '../constants.js';
import { RECRUIT_NAMES, RECRUIT_WEAPONS } from '../data/expeditions.js';
import { mkSoldier } from '../entities/soldier.js';

export function finishMission(m, gs) {
  const orig = gs.soldiers.find(s => s.id === m.origSoldier.id);
  if (!orig) return null;
  orig.hp = Math.max(1, m.soldier.hp);
  orig.ammo = m.soldier.ammo;
  let outcome = m.state === 'won' ? 'success' : 'kia';
  if (m.state === 'lost') { orig.hp = 0; orig.state = 'dead'; }

  const reward = {};
  if (m.collected.ammo)      { gs.resources.ammo      = Math.min(999, gs.resources.ammo + m.collected.ammo);           reward.ammo = m.collected.ammo; }
  if (m.collected.medicine)  { gs.resources.medicine  = Math.min(999, gs.resources.medicine + m.collected.medicine);   reward.medicine = m.collected.medicine; }
  if (m.collected.food)      { gs.resources.food      = Math.min(999, gs.resources.food + m.collected.food);           reward.food = m.collected.food; }
  if (m.collected.materials) { gs.resources.materials = Math.min(999, gs.resources.materials + m.collected.materials); reward.materials = m.collected.materials; }
  if (m.collected.sniperAmmo){ gs.resources.sniperAmmo= Math.min(99,  (gs.resources.sniperAmmo || 0) + m.collected.sniperAmmo); reward.sniperAmmo = m.collected.sniperAmmo; }

  let recruit = null;
  if (m.collected.civilian && outcome === 'success') {
    const availNames = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (availNames.length > 0 && gs.soldiers.filter(s => s.state !== 'dead').length < 6) {
      const name = availNames[Math.floor(Math.random() * availNames.length)];
      const weapon = RECRUIT_WEAPONS[Math.floor(Math.random() * RECRUIT_WEAPONS.length)];
      recruit = { name, weapon, hp: rng(55, 85) };
      gs.usedNames.add(name);
      const ns = mkSoldier(name, weapon, 270, recruit.hp, Math.floor(Math.random() * 3), true);
      ns.ammo = 0;
      gs.soldiers.push(ns);
    }
  }
  return { soldierName: m.soldier.name, destName: m.dest.name, outcome, reward, recruit, dmgTaken: m.soldier.maxHp - m.soldier.hp };
}
