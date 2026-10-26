// Civilian volunteers. Civilians in the squad man the wall but are not
// sent on sorties: they are waiting for the helicopter. When the fort
// is short of men the player can ask them to step up; a volunteer
// stays one for good (soldier.volunteer, saved with the game).
import { BALANCE } from '../data/difficulty.js';

// Small string hash with a final mix, so 'name' and 'name|day' land
// far apart.
function hash01(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const sortieReady = s => !s.civilian || !!s.volunteer;

// People who could go on a sortie today: alive, at the fort, and not a
// civilian waiting for evac.
export const ableForSortie = gs => (gs?.soldiers || []).filter(s => s.state !== 'dead' && !s.onExpedition && sortieReady(s));

// Civilians in the squad who could be asked. Benched civilians (the
// reserve) are not asked: they are the ones queued for the helicopter.
export const askableCivilians = gs => (gs?.soldiers || []).filter(s => s.state !== 'dead' && !s.onExpedition && s.civilian && !s.volunteer);

export const shortOfMen = gs => ableForSortie(gs).length < BALANCE.volunteerMinAble;

// Willingness is a fixed trait per person (25-75%); the roll is seeded
// by name and day, so asking twice in a day gets the same answer and a
// new day gets a new one.
export const willingness = s => 0.25 + 0.5 * hash01(`will|${s.name}`);

export function askVolunteers(gs) {
  const yes = [], no = [];
  for (const s of askableCivilians(gs)) {
    if (hash01(`ask|${s.name}|${gs.day}`) < willingness(s)) { s.volunteer = true; yes.push(s.name); }
    else no.push(s.name);
  }
  return { yes, no };
}
