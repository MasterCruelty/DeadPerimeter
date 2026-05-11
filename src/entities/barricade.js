import { uid } from '../constants.js';

// Barricades span all three lanes (visualised as a perspective wall).
export const mkBarricade = x => ({ id: uid(), x, hp: 140, maxHp: 140 });
