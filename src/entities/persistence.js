// Persist + restore the game state to localStorage.
//
// We only save the durable management-screen state (resources, soldiers,
// barricades, wave/day). We never serialise in-flight siege state (live
// zombies, bullets, effects) — restoring mid-wave would be confusing.
//
// Save format version is bumped whenever the shape changes so old saves
// are silently discarded rather than crashing.

// v2 added workshop fields (workbench / researchLab / research).
// v3 added per-soldier upgrades (PERKS). Older versions are silently
// discarded — keeps the load path free of compatibility branches.
const STORAGE_KEY = 'dead-perimeter-save-v3';

export function hasSavedGame() {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch (_e) {
    return false;
  }
}

export function saveGame(gs) {
  if (!gs) return false;
  try {
    const snapshot = {
      v: 3, savedAt: Date.now(),
      day: gs.day, wave: gs.wave,
      baseHp: gs.baseHp, baseMaxHp: gs.baseMaxHp,
      resources: { ...gs.resources },
      soldiers: gs.soldiers.map(s => ({
        id: s.id, name: s.name, weapon: s.weapon, destX: s.destX,
        lane: s.lane, x: s.x, hp: s.hp, maxHp: s.maxHp,
        ammo: s.ammo, maxAmmo: s.maxAmmo,
        state: s.state === 'dead' ? 'dead' : 'idle',
        facing: s.facing,
        civilian: !!s.civilian, veteran: !!s.veteran,
        kind: s.kind,
        onRoof: !!s.onRoof,
        upgrades: { ...(s.upgrades || {}) },
      })),
      barricades: gs.barricades.map(b => ({ id: b.id, x: b.x, hp: b.hp, maxHp: b.maxHp })),
      turrets: (gs.turrets || []).map(t => ({ id: t.id, x: t.x, lane: t.lane })),
      score: gs.score, kills: gs.kills,
      reserve: (gs.reserve || []).map(r => ({
        name: r.name, weapon: r.weapon,
        civilian: !!r.civilian, veteran: !!r.veteran,
        hp: r.hp ?? 100,
      })),
      expeditionsToday: gs.expeditionsToday || 0,
      lastEvacWave: gs.lastEvacWave ?? -10,
      lastFoodReport: gs.lastFoodReport || null,
      transmissionsDone: Array.isArray(gs.transmissionsDone) ? [...gs.transmissionsDone] : [],
      lastSupplyDrop: gs.lastSupplyDrop || null,
      usedNames: Array.from(gs.usedNames || []),
      workbench: { built: !!(gs.workbench && gs.workbench.built) },
      researchLab: { built: !!(gs.researchLab && gs.researchLab.built) },
      research: {
        activeId: gs.research?.activeId ?? null,
        progress: gs.research?.progress ?? 0,
        completed: Array.isArray(gs.research?.completed) ? [...gs.research.completed] : [],
      },
      // Roll the live session's elapsed time into playMs at save time so
      // closing the tab doesn't lose it. startedAt is reset to "now" on
      // reload so the next session starts a fresh delta.
      playMs: (gs.playMs || 0) + Math.max(0, Date.now() - (gs.startedAt || Date.now())),
      soldiersLost: gs.soldiersLost || 0,
      civiliansLost: gs.civiliansLost || 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (_e) {
    return false;
  }
}

export function loadGame(mkGS) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v !== 3) return null;

    const gs = mkGS();
    gs.day = data.day; gs.wave = data.wave;
    gs.baseHp = data.baseHp; gs.baseMaxHp = data.baseMaxHp;
    gs.resources = { ...gs.resources, ...data.resources };

    gs.soldiers = data.soldiers.map(s => {
      const civilian = !!s.civilian;
      const veteran = !!s.veteran;
      const kind = s.kind || (civilian ? 'civilian' : veteran ? 'veteran' : 'recruit');
      return {
        id: s.id, name: s.name, weapon: s.weapon, destX: s.destX,
        lane: s.lane, x: s.x, hp: s.hp, maxHp: s.maxHp,
        ammo: s.ammo, maxAmmo: s.maxAmmo,
        state: s.state, facing: s.facing,
        civilian, veteran, kind,
        onRoof: s.onRoof,
        lastShot: 0, reloadStart: 0, shootAt: 0, knifeTimer: 0, recoil: 0,
        walkPhase: Math.random() * Math.PI * 2, hurtTimer: 0,
        reloadTriggered: false, onExpedition: false,
        upgrades: { ...(s.upgrades || {}) },
      };
    });
    gs.barricades = data.barricades.map(b => ({ ...b }));
    gs.turrets = (data.turrets || []).map(t => ({ ...t, lastShot: 0 }));
    gs.score = data.score || 0; gs.kills = data.kills || 0;
    gs.reserve = (data.reserve || []).map(r => ({ ...r }));
    gs.expeditionsToday = data.expeditionsToday || 0;
    gs.lastEvacWave = data.lastEvacWave ?? -10;
    gs.lastFoodReport = data.lastFoodReport || null;
    gs.transmissionsDone = Array.isArray(data.transmissionsDone) ? [...data.transmissionsDone] : [];
    gs.lastSupplyDrop = data.lastSupplyDrop || null;
    gs.usedNames = new Set(data.usedNames || []);
    gs.workbench = { built: !!(data.workbench && data.workbench.built) };
    gs.researchLab = { built: !!(data.researchLab && data.researchLab.built) };
    gs.research = {
      activeId: data.research?.activeId ?? null,
      progress: data.research?.progress ?? 0,
      completed: Array.isArray(data.research?.completed) ? [...data.research.completed] : [],
    };
    gs.playMs = data.playMs || 0;
    gs.startedAt = Date.now();
    gs.soldiersLost = data.soldiersLost || 0;
    gs.civiliansLost = data.civiliansLost || 0;
    gs.phase = 'management';
    return gs;
  } catch (_e) {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
}
