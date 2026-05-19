import { uid, WX, GY } from '../constants.js';

// Fixed machine-gun emplacement, built on the front lane at the inner
// side of Fort Omega's wall. Always aims forward, can target any lane
// in range. Draws ammo from gs.resources.ammo (1 per shot).
//
// x defaults to a staggered slot beside the wall when not passed —
// kept for backward compatibility with any older save / call path.
// New click-to-place flow always provides an explicit x.
export const mkTurret = (idx = 0, x) => ({
  id: uid(),
  x: x ?? (WX + 10 + idx * 18),
  y: GY - 50,
  lane: 0,
  lastShot: 0,
  hp: 200, maxHp: 200, // shown on UI but currently indestructible
});
