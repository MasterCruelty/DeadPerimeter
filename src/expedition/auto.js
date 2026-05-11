import { rng } from '../constants.js';
import { RECRUIT_NAMES, RECRUIT_WEAPONS } from '../data/expeditions.js';

export function resolveExpedition(soldier, dest, gs) {
  const dmg = rng(dest.solDmg[0], dest.solDmg[1]);
  const roll = Math.random();
  const threshold = dest.risk === 'LOW' ? 0.80 : dest.risk === 'MED' ? 0.60 : 0.40;
  let outcome, reward = {}, recruit = null;
  if (roll < threshold) {
    outcome = 'success';
    if (dest.risk === 'LOW') { reward.medicine = rng(15, 25); reward.food = rng(10, 18); }
    else if (dest.risk === 'MED') { reward.ammo = rng(20, 40); reward.materials = rng(5, 12); reward.sniperAmmo = rng(2, 5); }
    else { reward.ammo = rng(15, 25); reward.medicine = rng(8, 15); reward.food = rng(10, 20); reward.materials = rng(8, 18); reward.sniperAmmo = rng(4, 8); }
    const availNames = RECRUIT_NAMES.filter(n => !gs.usedNames.has(n));
    if (availNames.length > 0 && gs.soldiers.filter(s => s.state !== 'dead').length < 6) {
      const name = availNames[Math.floor(Math.random() * availNames.length)];
      const weapon = RECRUIT_WEAPONS[Math.floor(Math.random() * RECRUIT_WEAPONS.length)];
      recruit = { name, weapon, hp: rng(55, 85) };
      gs.usedNames.add(name);
    }
  } else if (roll < threshold + 0.25) {
    outcome = 'injured';
  } else {
    outcome = 'kia';
  }
  soldier.hp = Math.max(1, soldier.hp - dmg);
  if (outcome === 'kia') { soldier.hp = 0; soldier.state = 'dead'; }
  return { soldierName: soldier.name, destName: dest.name, outcome, reward, recruit, dmgTaken: dmg };
}
