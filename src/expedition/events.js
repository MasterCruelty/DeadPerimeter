import { C } from '../constants.js';

// Builds the narrative event log shown during auto-resolve expeditions.
export function genEvents(soldierName, dest, outcome, dmgTaken, recruit) {
  const ev = [];
  ev.push({ icon: '🚶', text: `${soldierName} leaves Fort Omega toward ${dest.name}.`, delay: 900, col: C.txt });
  if (dest.risk === 'LOW') {
    ev.push({ icon: '🌆', text: 'Quiet streets. Minimal zombie presence in the area.', delay: 1100, col: C.txt });
    ev.push({ icon: '🔍', text: 'Entering the building. Scanning for survivors...', delay: 1300, col: C.txt });
  } else if (dest.risk === 'MED') {
    ev.push({ icon: '⚠️', text: 'Armory district. Overrun. Taking cover behind vehicle.', delay: 1000, col: C.wrn });
    ev.push({ icon: '🧟', text: 'Three walkers spotted. Moving to engage.', delay: 1200, col: C.txt });
    ev.push({ icon: '🔫', text: `${soldierName} opens fire — clear!`, delay: 900, col: C.acc });
  } else {
    ev.push({ icon: '💀', text: 'Downtown is hell. Zombies crawling every corridor.', delay: 900, col: C.dng });
    ev.push({ icon: '🧟', text: 'Runner pack incoming! Firing on the move!', delay: 1000, col: C.dng });
    ev.push({ icon: '🔫', text: `${soldierName} empties a mag — barely makes it through!`, delay: 1100, col: C.acc });
  }
  if (dmgTaken > 0 && outcome !== 'kia') {
    ev.push({ icon: '🩸', text: `Ambushed — ${soldierName} takes ${dmgTaken} damage!`, delay: 1100, col: C.dng });
  }
  if (outcome === 'success' || outcome === 'injured') {
    if (dest.risk === 'LOW')  ev.push({ icon: '🏥', text: 'Supplies located. Packing medicine and food.', delay: 1400, col: C.txt });
    if (dest.risk === 'MED')  ev.push({ icon: '📦', text: 'Crates breached. Loading ammo and materials.', delay: 1400, col: C.txt });
    if (dest.risk === 'HIGH') ev.push({ icon: '🏙️', text: 'Hub cleared. Gathering everything useful.', delay: 1300, col: C.txt });
  }
  if (recruit) ev.push({ icon: '👤', text: `Found a survivor: ${recruit.name}. They agree to fight!`, delay: 1500, col: '#88ddff' });
  if (outcome === 'success')      ev.push({ icon: '✦',   text: `Mission complete. ${soldierName} returns to base.`, delay: 1000, col: C.acc });
  else if (outcome === 'injured') ev.push({ icon: '⚠️', text: `${soldierName} limps back. Injured, but alive.`, delay: 1000, col: C.wrn });
  else                            ev.push({ icon: '💀', text: `${soldierName} did not return from ${dest.name}.`, delay: 1200, col: C.dng });
  return ev;
}
