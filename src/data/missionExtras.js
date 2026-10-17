// Mission conditions and side objectives shown on the destination
// cards (rolled in rollDestinations); behaviour lives in
// update/missionExtras.js.
export const MISSION_CONDS = {
  night:     { name: 'NIGHT RAID', icon: '🌙', color: '#8aa0e0', desc: 'Dark streets: the dead wake later, but you see less.' },
  horde:     { name: 'HORDE',      icon: '☠',  color: '#e06a48', desc: '+60% dead, loot worth +50%.' },
  scavenged: { name: 'PICKED OVER', icon: '🧺', color: '#b8a878', desc: '30% fewer dead, loot worth −40%.' },
};
export const SIDE_OBJ = {
  cache: { name: 'CRACK THE CACHE', icon: '🔒', desc: 'Locked military cache: stand by it to open it. Noise draws a pack.', reward: '🔫 🎯 🟠 💊' },
  nest:  { name: 'BURN THE NEST',  icon: '🪺', desc: 'A nest keeps spawning walkers. Destroy it for salvage.', reward: '🔧 💊' },
  sos:   { name: 'ANSWER THE SOS', icon: '🆘', desc: 'A survivor is trapped. Reach them before time runs out.', reward: '👤' },
};

// Rolled per destination card (data/expeditions.js rollDestinations).
export function rollMissionExtras(risk) {
  const cond = Math.random() < 0.45 ? ['night', 'horde', 'scavenged'][Math.floor(Math.random() * 3)] : null;
  const sides = risk === 'LOW' ? ['cache', 'sos'] : ['cache', 'nest', 'sos'];
  const side = Math.random() < 0.65 ? sides[Math.floor(Math.random() * sides.length)] : null;
  return { cond, side };
}
