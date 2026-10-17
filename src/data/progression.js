// Soldier progression: experience, levels and skill points.
//
// XP comes from kills (siege and sorties), surviving waves and bringing
// a sortie home. Each level gives +5 max HP and one skill point; skills
// stack up to 5 ranks and feed the same effect lookup as the workbench
// perks (getSoldierPerkEffect), so they work in the siege and on sorties.
export const MAX_LEVEL = 10;
export const xpForLevel = L => 60 * (L - 1) * L / 2;   // L2 = 60, L3 = 180, L4 = 360, L5 = 600 ...

export const SKILLS = [
  { id: 'aim',    icon: '🎯', name: 'Marksman',   desc: '+6% damage per rank' },
  { id: 'reload', icon: '⚡', name: 'Fast Hands', desc: '−6% reload time per rank' },
  { id: 'tough',  icon: '🛡', name: 'Toughness',  desc: '+12 max HP per rank' },
  { id: 'melee',  icon: '🪓', name: 'Brawler',    desc: '+15% melee damage, −15% weapon wear per rank' },
];
export const SKILL_MAX = 5;

export const KILL_XP = { walker: 4, runner: 5, spitter: 7, tank: 14, brute: 30, knifeman: 8, gunman: 10 };
export const BOSS_XP = 80;
export const WAVE_XP = 10;

export const levelOf = sol => (sol && sol.level) || 1;

// Adds XP; returns how many levels were gained (applies HP + points).
export function addXp(sol, n) {
  if (!sol || sol.state === 'dead' || !(n > 0)) return 0;
  sol.xp = (sol.xp || 0) + n;
  let ups = 0;
  while ((sol.level || 1) < MAX_LEVEL && sol.xp >= xpForLevel((sol.level || 1) + 1)) {
    sol.level = (sol.level || 1) + 1; ups++;
    sol.skillPts = (sol.skillPts || 0) + 1;
    sol.maxHp += 5; sol.hp = Math.min(sol.maxHp, sol.hp + 5);
  }
  return ups;
}

export function spendSkill(sol, id) {
  if (!sol || !(sol.skillPts > 0)) return false;
  const skills = sol.skills || (sol.skills = {});
  if ((skills[id] || 0) >= SKILL_MAX) return false;
  skills[id] = (skills[id] || 0) + 1;
  sol.skillPts--;
  if (id === 'tough') { sol.maxHp += 12; sol.hp = Math.min(sol.maxHp, sol.hp + 12); }
  return true;
}

// Skill contribution to the shared perk-effect lookup.
export function skillEffect(sol, key, v) {
  const sk = (sol && sol.skills) || null;
  if (!sk) return v;
  if (key === 'damageMul' && sk.aim) return v * (1 + 0.06 * sk.aim);
  if (key === 'reloadMul' && sk.reload) return v * (1 - 0.06 * sk.reload);
  if (key === 'meleeMul' && sk.melee) return v * (1 + 0.15 * sk.melee);
  if (key === 'wearMul' && sk.melee) return v * (1 - 0.15 * sk.melee);
  return v;
}
