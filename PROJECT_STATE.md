# Dead Perimeter — Project State (V8 + Modular)

> This document is the canonical handoff for continuing development of "Dead
> Perimeter". It captures architecture, game systems, completed features,
> known issues, and the pending roadmap. Read it together with `src/` before
> making changes.

---

## 1. Concept

Dead Perimeter is a 2D side-scrolling **zombie siege survival** game. The
player defends **Fort Omega** from successive waves of zombies. Between waves
they can:
- Send a soldier on an **expedition** (auto-resolved with narrative log, or
  played as a side-scrolling mini-game).
- Recruit new soldiers from rescued civilians or from spent resources.
- Build defensive **barricades**.
- Heal injured soldiers.

The game uses **React + Canvas 2D**. All rendering is procedural via
`CanvasRenderingContext2D`. No external sprites, no external audio files
(everything is generated via Web Audio).

---

## 2. File layout

The original V8 source was a single ~2050-line JSX file. It has been split
into the layout below following `MIGRATION.md` §7. Dependency direction is
strictly top-down (no cycles): `constants` → `data` → `entities` →
`render` / `update` / `expedition` → `DeadPerimeter.jsx`.

```
src/
├── DeadPerimeter.jsx          React component + game loop
├── constants.js               CW, CH, GY, WX, LANES, C palette, helpers
├── audio/AudioEngine.js       procedural Web Audio
├── data/
│   ├── weapons.js             WPN dictionary
│   ├── zombies.js             ZTP dictionary
│   ├── expeditions.js         EXPEDITION_DESTS, mission constants, recruits
│   └── humans.js              HTP, HUMAN_AMMO_DROP, wave cadence
├── entities/
│   ├── soldier.js   zombie.js  barricade.js
│   ├── human.js     wave.js    gameState.js
├── render/
│   ├── background.js  base.js   weapons.js
│   ├── soldier.js     zombie.js human.js
│   ├── effects.js     hud.js
├── update/
│   ├── siege.js               main siege tick (branches on isHumanWave)
│   └── mission.js             playable side-scroll mission
└── expedition/
    ├── auto.js                resolveExpedition
    ├── missionFinish.js       finishMission
    └── events.js              genEvents (narrative log)
```

---

## 3. Core constants

```js
CW = 900, CH = 530    // canvas dimensions
GY = 400              // ground y (front lane)
WX = 162              // Fort Omega's right edge — base wall position

LANES = [
  { dy:   0, sc: 1.00 }, // 0 = FRONT
  { dy: -34, sc: 0.80 }, // 1 = MID
  { dy: -64, sc: 0.64 }, // 2 = BACK
];
```

Lane Y position: `laneY(lane) = GY + LANES[lane].dy`
Lane scale: `laneSc(lane) = LANES[lane].sc`

The rooftop position for Delta the sniper is at `(WX-40, GY-160)` — drawn at
full scale, ignoring lanes.

---

## 4. Game state (`mkGS`)

```js
{
  phase: 'menu' | 'management' | 'siege' | 'expedition' | 'mission' | 'gameover',
  day: 1, wave: 1,
  baseHp: 200, baseMaxHp: 200,
  resources: {
    food: 40, ammo: 80, medicine: 6, materials: 25,
    sniperAmmo: 5,
  },
  soldiers: [Alpha, Bravo, Charlie, Delta (rooftop sniper)],
  zombies: [], humans: [], bullets: [], effects: [],
  barricades: [], soundQ: [],
  spawnQueue: [],
  waveTime, waveClearAt, waveComplete,
  score, kills, zombiesSpawned,
  shakeTimer,
  squadTarget, squadLane, selectedSoldierId,
  isHumanWave: false,       // toggled true on hostile human waves
  usedNames: Set<string>,
}
```

---

## 5. Entities

### Soldier (`mkSoldier`)
Same as previous versions. `onRoof: true` for Delta. Civilian recruits get a
distinct palette.

### Zombie (`mkZombie`)
- `walker` (hp 60, spd 0.55, dmg 6)
- `runner` (hp 35, spd 1.30, dmg 4)
- `tank`   (hp 220, spd 0.28, dmg 18)

### Human (`mkHuman`) — NEW in V8 modular
Hostile human survivor. Only spawned during human waves. Carries
`hostile: true`. Two types live in `data/humans.js`:

| Type | hp | spd | dmg | range | rate | Behaviour |
| --- | --- | --- | --- | --- | --- | --- |
| `knifeman` | 50 | 0.85 | 8 | 0 | melee | Closes to melee like a walker |
| `gunman`   | 60 | 0.55 | 4 | 340 | 1600 ms | Stops at range, fires hostile bullets |

On death humans drop **3–8 ammo** into `gs.resources.ammo` (configurable via
`HUMAN_AMMO_DROP`).

### Barricade
```js
{ id, x, hp: 140, maxHp: 140 }
```
Spans all three lanes. Max 2 alive. Damaged by both zombies and humans.

### Bullet
```js
{ id, x, y, dx, dy, dmg, life, targetLane, hostile?, shooterId? }
```
`hostile: true` bullets damage soldiers; friendly bullets damage zombies or
humans depending on `gs.isHumanWave`.

### Effect — same as before (`blood`, `shell`, `txt`, `hit`, `slash`).

---

## 6. Weapons (`WPN`)

| Key       | Name      | dmg | range | rate  | mag | reload | speed | spread | ammoCost |
|-----------|-----------|-----|-------|-------|-----|--------|-------|--------|----------|
| `rifle`   | M4A1      | 25  | 430   | 720ms | 30  | 1900ms | 14    | 0.030  | 30       |
| `pistol`  | Glock 17  | 14  | 265   | 430ms | 15  | 1050ms | 11    | 0.060  | 15       |
| `shotgun` | SPAS-12   | 50  | 158   | 1300  | 8   | 2200ms | 9     | 0.180  | 8 (×5)   |
| `sniper`  | M24 SWS   | 60  | 900   | 1400  | 5   | 2400ms | 22    | 0.005  | 5        |

---

## 7. Lane / depth system

Render order is back-to-front (lane 2 first, lane 0 last). Zombies and humans
engage same-lane targets; soldiers can shoot any lane but prefer same-lane.
Barricades block all lanes at once.

---

## 8. Soldier selection / movement

Click on a living ground soldier to select; click again to deselect; click an
empty spot to move (only the selected soldier, or the whole squad when no
selection). Rooftop soldiers are excluded from click-to-select.

---

## 9. The rooftop sniper (Delta)

Delta starts at `(WX-40, GY-160)` on the rooftop with the sniper rifle and the
dedicated `sniperAmmo` pool. When the pool is empty mid-wave she descends to
lane MID with a pistol. Between waves, if `sniperAmmo > 0`, she climbs back up.
During human waves she targets `gs.humans` instead of `gs.zombies`.

---

## 10. Audio

`AudioEngine` is procedural Web Audio. No samples.

- `master` → `fx` (gunshots, hits, zombie sounds) + `bg` (drone + kick beats).
- `startBg()` plays a low-frequency drone + intermittent kick during siege.
- `processSounds(gs.soundQ, ...)` drains the per-frame queue.
- AudioContext is created lazily on first `getAM()` call (after a user
  gesture).

---

## 11. Expedition system

Unchanged from V7. Auto-resolve produces a result + narrative event log;
"PLAY LIVE" enters the playable side-scroll mission. Mission pickups include
medicine (💊), ammo (🔫), food (🥫), materials (🔧), sniper ammo (🎯), and
civilian (👤).

---

## 12. Civilians

Civilian recruits get a brown jacket, blue jeans, red baseball cap, and a
beard scruff. They show as `· civ` in the management roster.

---

## 13. Barricades

15 materials to build, max 2 alive, span all lanes. Damaged by both zombies
and hostile humans; soldiers cannot cross them.

---

## 14. Game loop architecture

The `useEffect` in `DeadPerimeter.jsx` runs a single `requestAnimationFrame`
loop. Each frame:

1. `dt = min(now - prevT, 50)` (clamp).
2. If a mission is active, `updateMission` + `dMissionWorld`/`dMissionHUD` and
   early return.
3. Else if `gs.phase === 'siege'`: `update(gs, now, dt)` then either transition
   screens or render the siege.
4. UI snapshots happen every 250 ms (`Math.floor(now/250)`) to avoid 60 fps
   React reconciliation.

---

## 15. Versions changelog

| Version | Major changes |
|---------|---------------|
| V1–V4   | Base game, lanes, barricades, expeditions, civilians, rooftop sniper. |
| V5–V7   | Per-soldier selection, `sniperAmmo` resource, mission pickups for sniper ammo, Delta climb-back. |
| V8      | Refactored rooftop sniper into a separate `dRooftopSniper` renderer; entity inventory unchanged. |
| **V8 + Modular** | **Current.** Single file split into ~25 modules per `MIGRATION.md` §7. **Hostile human survivor waves (Priority 1) shipped**: knifemen + gunmen, hostile bullets, ammo drops, management/HUD banner. |

---

## 16. Known issues / quirks

- The shoot/idle frame in the existing soldier renderer was inherited from V8
  with one back-arm line accidentally commented out. Visually the soldier
  shows only the front arm + weapon while shooting/idle. Behavioural impact:
  none.
- Mission state leaks: `selectedSoldierId` is not cleared when returning from
  a mission, usually fine because the selected soldier was the one on the
  mission.
- No pause: switching tabs throttles `requestAnimationFrame` so the game
  effectively pauses, but there is no in-game pause button yet.

---

## 17. Pending features (roadmap)

### ✅ Priority 1 — Hostile human survivor waves (SHIPPED)

Implemented in this V8 Modular release. See `data/humans.js`,
`entities/{human,wave}.js`, `render/human.js`, `update/siege.js`,
`render/hud.js`, and `DeadPerimeter.jsx` (`startWave` + management banner).

### ✅ Priority 2 — Polish (mostly shipped)

- ✅ Pause / resume with `Esc` — `pausedRef` + render guard + overlay in
  `DeadPerimeter.jsx`.
- ✅ Save / load to `localStorage` — `entities/persistence.js`.
  Autosaved on management entry, recruit, barricade, heal. Restored from
  menu via `↻ CONTINUE SAVED RUN`. Cleared on game over / new game.
- ✅ Mobile touch controls — `onTouchStart` / `onTouchEnd` on the canvas.
  Siege: tap = click. Mission: tap-left = move left, tap-right = move
  right, tap-center = fire.
- ✅ Configurable wave difficulty curve — `data/difficulty.js`. Both
  `mkWave` and `mkHumanWave` read these constants.
- ⏳ Real audio samples (optional). The procedural engine is enough for
  now; swapping in samples is a clean change in `audio/AudioEngine.js`.
- ⏳ Sprite caching for performance (offscreen canvas per entity type).
  Not necessary at current entity counts.

See `CODE.md` for the full module-by-module reference.

---

## 18. Architectural decisions worth preserving

1. **Game state in a single object**, mutated in place. React only sees
   periodic snapshots via `setUi`.
2. **`gsRef.current`** holds the mutable state; the canvas reads from it.
3. **`missionRef.current` is checked before `gs.phase`** in the loop —
   missions override the siege entirely.
4. **Refs for inputs and expedition selections**, not React state, to avoid
   stale closures in `useCallback`.
5. **Lane scaling is applied on the canvas transform**, not pre-baked into
   sprite coordinates.
6. **Audio uses a per-frame queue** (`gs.soundQ`) drained at the end of
   `update`.
7. **No cycles between modules**: `constants` → `data` → `entities` →
   `render`/`update`/`expedition` → `DeadPerimeter.jsx`.

---

## 19. Quick file map

- `src/audio/AudioEngine.js` — class + `getAM()` + `processSounds()`.
- `src/constants.js` — `CW, CH, GY, WX, LANES, C, laneY, laneSc, clickToLane, uid, rng`.
- `src/data/{weapons,zombies,expeditions,humans}.js` — static config.
- `src/entities/{soldier,zombie,barricade,human,wave,gameState}.js` — factories.
- `src/render/*` — every `dXxx` draw function.
- `src/update/siege.js` — main siege tick (`update`).
- `src/update/mission.js` — `mkMission`, `updateMission`, mission draw functions.
- `src/expedition/{auto,missionFinish,events}.js` — expedition logic.
- `src/DeadPerimeter.jsx` — React component, hooks, callbacks, JSX screens.

---

## 20. How to run

See `README.md` for install + launch instructions. TL;DR:

```bash
node -v          # must be >= 20
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```
