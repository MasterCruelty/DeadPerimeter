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
  sniper:  { name: 'M24 SWS',  dmg: 60, range: 700, rate: 1100, ammo: 5,  rl: 2400, spd: 22, sp: 0.005, ammoCost: 5 },
};
