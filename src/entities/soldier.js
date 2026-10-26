import { uid, WX } from '../constants.js';
import { WPN } from '../data/weapons.js';
import { KIND_HP } from '../data/expeditions.js';

// Deterministic per-soldier voice pitch (Hz). Hashes the name + kind
// so the same soldier always sounds like the same person across
// reloads, but two recruits with different names get different voices.
function pickVoicePitch(name, kind) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  h = (h ^ (kind || '').length * 17) & 0x7fffffff;
  // Six steps across the speaking range so the cast sounds varied.
  const PITCHES = [115, 140, 160, 185, 210, 235];
  return PITCHES[h % PITCHES.length];
}

// mkSoldier(name, weapon, destX, hp?, lane?, civilian?, onRoof?, opts?)
//   opts = { veteran?: bool, volunteer?: bool, lookId?: number }
// lookId: what the look is seeded from instead of the id (see
// render/actors/people.js lookSeed), carried across the bench.
// HP cap depends on the kind: civilians 70, veterans 120, recruits 100.
// hp defaults to that cap when not explicitly passed.
export const mkSoldier = (name, weapon, destX, hp, lane = 0, civilian = false, onRoof = false, opts = {}) => {
  const w = WPN[weapon];
  const veteran = !!opts.veteran;
  const kind = civilian ? 'civilian' : veteran ? 'veteran' : 'recruit';
  const maxHp = KIND_HP[kind];
  const startHp = (typeof hp === 'number' ? hp : maxHp);
  return {
    id: uid(), name, weapon, destX, lane, x: WX + 20,
    hp: startHp, maxHp,
    kind,
    ammo: 0, maxAmmo: w.ammo, state: 'walk', facing: 1,
    civilian, veteran, onRoof,
    ...(civilian && opts.volunteer ? { volunteer: true } : {}),
    ...(opts.lookId != null ? { lookId: opts.lookId } : {}),
    voicePitch: pickVoicePitch(name, kind),
    lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0, recoil: 0,
    walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0, reloadTriggered: false,
    onExpedition: false,
    // Owned weapon perks (see data/difficulty.js PERKS). Sparse map of
    // perk-id → true. Persisted across saves.
    upgrades: {},
  };
};

// Bench entry (gs.reserve) for a soldier, and the mkSoldier opts to
// bring one back. Reserve entries have no id, so the look id travels
// with them; entries from older saves without one look like `name|0`
// on the bench and keep that face once activated.
export const benchEntry = s => ({
  name: s.name, weapon: s.weapon, civilian: !!s.civilian, veteran: !!s.veteran,
  ...(s.volunteer ? { volunteer: true } : {}), lookId: s.lookId ?? s.id, hp: s.hp,
});
export const reserveOpts = r => ({ veteran: !!r.veteran, volunteer: !!r.volunteer, lookId: r.lookId ?? 0 });
