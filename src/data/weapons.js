// Firearms. `base` is the handling class (rig pose, sound, research and
// perk eligibility): rifle | pistol | shotgun | sniper. `pool` is the
// stash the magazines come from. The four starting guns are their own
// base; the rest are found on sorties (see GUN_LOOT) and stored in the
// fort's armory until equipped.
export const WPN = {
  rifle:   { name: 'M4A1',     dmg: 25, range: 430, rate: 720,  ammo: 30, rl: 1900, spd: 14, sp: 0.030, ammoCost: 20 },
  pistol:  { name: 'Glock 17', dmg: 14, range: 265, rate: 430,  ammo: 15, rl: 1050, spd: 11, sp: 0.060, ammoCost: 12 },
  shotgun: { name: 'SPAS-12',  dmg: 50, range: 158, rate: 1300, ammo: 8,  rl: 2200, spd: 9,  sp: 0.180, pel: 5, ammoCost: 8 },
  // Sniper covers the area JUST past the rifle line (range 430), so
  // riflemen handle mid-range and the sniper picks off distant
  // targets / approaching tanks before they get close. Still capped
  // well short of WORLD_W (1980) — the bullet-life cap in siege.js
  // also enforces this, so picking a target outside 700 px is a
  // no-op.
  sniper:  { name: 'M24 SWS',  dmg: 60, range: 700, rate: 1100, ammo: 5,  rl: 2400, spd: 22, sp: 0.005, ammoCost: 5, pool: 'sniperAmmo' },

  // Found weapons.
  ak:      { name: 'AK-47',        base: 'rifle',   dmg: 34, range: 440, rate: 820,  ammo: 30, rl: 2100, spd: 14, sp: 0.045, ammoCost: 20,
             desc: 'Hits hard, kicks harder.' },
  smg:     { name: 'MP5',          base: 'rifle',   dmg: 13, range: 300, rate: 170,  ammo: 30, rl: 1500, spd: 13, sp: 0.090, ammoCost: 20,
             desc: 'A hose of 9 mm. Eats ammo.' },
  revolver:{ name: '.357 Revolver', base: 'pistol', dmg: 32, range: 285, rate: 720,  ammo: 6,  rl: 1700, spd: 12, sp: 0.040, ammoCost: 6,
             desc: 'Six heavy rounds, slow reload.' },
  hunting: { name: 'Hunting Rifle', base: 'sniper', dmg: 55, range: 600, rate: 1250, ammo: 5,  rl: 2300, spd: 20, sp: 0.010, ammoCost: 5,
             desc: 'Long reach on regular ammo.' },
  dbarrel: { name: 'Double Barrel', base: 'shotgun', dmg: 64, range: 140, rate: 380, ammo: 2,  rl: 1600, spd: 9,  sp: 0.220, pel: 6, ammoCost: 2,
             desc: 'Two shells, a wall of lead.' },
};

export const wbase = w => (WPN[w] && WPN[w].base) || w;
export const ammoPool = w => (WPN[w] && WPN[w].pool) || 'ammo';
export const FOUND_GUNS = ['ak', 'smg', 'revolver', 'hunting', 'dbarrel'];

// Melee weapons, used when the gun runs dry. `dur` = hits before it
// breaks (the knife never breaks). Damage is per swing.
export const MELEE = {
  knife:   { name: 'Combat Knife', icon: '🔪', dmg: 15, rate: 650, dur: Infinity },
  bat:     { name: 'Baseball Bat', icon: '🏏', dmg: 24, rate: 800, dur: 40 },
  machete: { name: 'Machete',      icon: '🗡', dmg: 30, rate: 650, dur: 35 },
  axe:     { name: 'Fire Axe',     icon: '🪓', dmg: 42, rate: 950, dur: 30 },
};
export const meleeOf = sol => (sol && sol.melee && MELEE[sol.melee.type]) ? sol.melee.type : 'knife';

// Where found weapons turn up (city location id → chances). Guns are
// rarer than melee; weapon-themed places stock more of them.
export const GEAR_LOOT = {
  gunshop:  { gun: 0.9, melee: 0.2, guns: ['revolver', 'hunting', 'dbarrel', 'smg'] },
  precinct: { gun: 0.8, melee: 0.2, guns: ['ak', 'smg', 'revolver'] },
  police:   { gun: 0.55, melee: 0.25, guns: ['revolver', 'smg', 'dbarrel'] },
  depot:    { gun: 0.45, melee: 0.5, guns: ['ak', 'hunting'] },
  hardware: { gun: 0.05, melee: 0.95, guns: ['dbarrel'] },
  gas:      { gun: 0.15, melee: 0.5, guns: ['dbarrel', 'revolver'] },
  _default: { gun: 0.12, melee: 0.3, guns: FOUND_GUNS },
};
export const MELEE_FINDS = ['bat', 'bat', 'machete', 'axe'];
export function rollGear(locId, lootLeft = 1) {
  const t = GEAR_LOOT[locId] || GEAR_LOOT._default, out = [];
  const k = 0.4 + 0.6 * lootLeft;
  if (Math.random() < t.gun * k) out.push({ kind: 'gun', w: t.guns[Math.floor(Math.random() * t.guns.length)] });
  if (Math.random() < t.melee * k) out.push({ kind: 'melee', type: MELEE_FINDS[Math.floor(Math.random() * MELEE_FINDS.length)] });
  return out;
}
