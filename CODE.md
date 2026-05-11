# Dead Perimeter — Code Documentation

This document describes **how the code is organised** and **how each module
works**, module by module. It is the technical companion to `README.md`
(user-facing) and `PROJECT_STATE.md` (game-design notes).

Reading order:
1. `§1` Big picture — data flow, render loop, persistence
2. `§2` Module reference — every file in `src/`
3. `§3` Common invariants — rules that must hold across the codebase
4. `§4` Performance + gotchas
5. `§5` How to extend (recipes for common additions)

---

## 1. Big picture

The game runs entirely client-side. There is **one canvas** (900×530) and
**one React component**, `DeadPerimeter`. All gameplay state lives in a
single mutable object owned by a `useRef`. React state is used only for
the UI shell (which screen is visible, the per-250ms HUD snapshot, paused /
muted flags). This keeps the 60 fps render loop independent of React
reconciliation.

```
┌──────────────────────────── browser tab ─────────────────────────────┐
│                                                                      │
│   ┌────────────── React tree ───────────────┐                        │
│   │ DeadPerimeter.jsx                       │                        │
│   │   useState: scr, ui, muted, paused …    │   periodic snapshots   │
│   │   useRef:   gsRef, missionRef, etc.     │◄──── (every 250 ms)    │
│   │                                         │                        │
│   │   ┌───── requestAnimationFrame loop ─┐  │                        │
│   │   │  update(gs, now, dt)             │  │                        │
│   │   │  processSounds(gs.soundQ, …)     │  │                        │
│   │   │  ctx.clearRect + draw functions  │  │                        │
│   │   └──────────────────────────────────┘  │                        │
│   └──┬──────────────────────────────────────┘                        │
│      │ mutates                                                       │
│      ▼                                                               │
│   ┌────────────── gsRef.current ────────────┐                        │
│   │ phase, resources, soldiers, zombies,    │                        │
│   │ humans, bullets, effects, barricades,   │                        │
│   │ soundQ, isHumanWave, …                  │                        │
│   └─────────────────────────────────────────┘                        │
│                                                                      │
│   ┌─── localStorage (entities/persistence.js) ───┐                   │
│   │ key: "dead-perimeter-save-v1"                │                   │
│   │ saved on management entry, recruit, build,   │                   │
│   │ heal. cleared on game over / NEW GAME.       │                   │
│   └──────────────────────────────────────────────┘                   │
│                                                                      │
│   ┌─── Web Audio (audio/AudioEngine.js, lazy) ───┐                   │
│   │ master → fx + bg; per-frame queue.           │                   │
│   └──────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.1 Data flow per frame (siege)

```
RAF tick (now, dt)
   │
   ├── missionRef.current ?  ── yes ──► updateMission()  ─► dMission*    ─► return
   │
   ├── gs.phase === 'siege' ?
   │     │
   │     ├── pausedRef.current ?  ── yes ──► skip update & sounds (still render)
   │     │
   │     ├── update(gs, now, dt)
   │     │     ├── drain spawnQueue → push to gs.zombies | gs.humans
   │     │     ├── tick zombies (walk → attack)
   │     │     ├── tick humans  (walk → attack; gunmen → bullets)
   │     │     ├── tick soldiers (incl. rooftop sniper, ground melee fallback)
   │     │     ├── advance bullets, check collisions (friendly vs enemy / hostile vs soldier)
   │     │     ├── garbage-collect dead bodies / effects
   │     │     ├── decide wave clear → schedule phase='management'
   │     │     └── push sound events to gs.soundQ
   │     │
   │     ├── processSounds(gs.soundQ, audio, mutedRef)  ── drains queue
   │     │
   │     ├── phase transition?
   │     │     ├── management → saveGame(gs)
   │     │     ├── gameover   → clearSave()
   │     │     └── setScr(gs.phase)
   │     │
   │     └── draw: dBg → dBase → (per lane back→front) zombies → humans → soldiers
   │              → barricades → effects → bullets → dSquadMarker → dHUD → pause overlay
   │
   └── requestAnimationFrame(loop)
```

### 1.2 Persistence model

We save **between waves**, never mid-wave. The serialised shape
(`entities/persistence.js`) covers exactly the durable management-screen
state: resources, soldiers (snapshot of equipment/hp, transient fields
reset on load), barricades, wave/day, score/kills, used recruit names.

- Saves happen automatically on: wave clear (entering `management`),
  recruit, barricade built, soldier healed.
- Saves are cleared on: `gameover`, `NEW GAME` button.
- The menu shows `↻ CONTINUE SAVED RUN` when a save is present.

### 1.3 Audio model

`AudioEngine` exposes high-level methods (`shot`, `reload`, `hit`, `groan`,
`zombieAtk`, `baseHit`, `waveCleared`) that build short oscillator/noise
chains and patch them through filters. The engine is lazily created on
first call to `getAM()` so we never violate browser autoplay policy. The
update loop pushes sound *events* onto `gs.soundQ`; once per frame
`processSounds()` drains the queue and calls the matching method (no-op if
muted).

---

## 2. Module reference

Every module is listed below with its inputs, outputs, and notable
behavior. Files are grouped by directory.

### 2.1 `src/constants.js`

Pure data + helpers. No imports of other game modules.

| Export | Purpose |
| --- | --- |
| `CW, CH` | Canvas width/height (900×530). |
| `GY` | Ground Y for the FRONT lane (400). |
| `WX` | Right edge of Fort Omega's wall (162). |
| `LANES` | Array of 3 lane descriptors: `dy` (Y offset from `GY`), `sc` (sprite scale 1.0/0.8/0.64), `gshade` (ground strip color). |
| `laneY(lane)` | `GY + LANES[lane].dy`. |
| `laneSc(lane)` | `LANES[lane].sc`. |
| `clickToLane(my)` | Maps canvas-Y → lane (0=FRONT, 1=MID, 2=BACK). |
| `C` | Color palette. Used everywhere instead of magic hex strings. |
| `uid()` | Monotonic integer ID generator (starts at 200). |
| `rng(a, b)` | Inclusive integer in `[a, b]`. |

### 2.2 `src/data/`

Static configuration tables. Nothing here mutates at runtime.

#### `data/weapons.js`
`WPN`: per-weapon stats. Fields: `name, dmg, range, rate (ms), ammo (mag
size), rl (reload ms), spd (bullet px/frame), sp (spread radians), pel`
(pellet count, shotgun only), `ammoCost` (mag refill cost in resources).

#### `data/zombies.js`
`ZTP`: per-type zombie stats. `hp, spd, dmg, sc` (skin color), `cc`
(clothes color). Color refs come from `constants.C`.

#### `data/expeditions.js`
- `EXPEDITION_DESTS` — list of 3 destinations (hospital, armory, downtown)
  with risk tier, narrative copy, expected reward range, and per-mission
  parameters (`solDmg`, `missionLen`, `zSpawn`).
- `MISSION_W=1900, MISSION_VIEW=CW, MGY=GY` — playable mission world.
- `objIcons` — emoji map for pickup types.
- `STARS, BLDGS` — procedural background coords for the siege scene.
- `RECRUIT_NAMES, RECRUIT_WEAPONS` — pools for civilian/recruit names and
  starter weapons.

#### `data/humans.js` *(V8-modular)*
- `HTP` — knifeman/gunman stats (hp, spd, dmg, range, rate, palette).
- `HUMAN_AMMO_DROP = [3, 8]` — ammo dropped on death range.
- `HUMAN_WAVE_FIRST = 4`, `HUMAN_WAVE_EVERY = 5` — wave-cadence constants.
- `isHumanWaveNumber(n)` — boolean predicate for "is wave N a human wave?".

#### `data/difficulty.js` *(new)*
`DIFFICULTY` — knobs for `mkWave` and `mkHumanWave`. Edit this to retune
the curve without changing wave logic.

### 2.3 `src/audio/AudioEngine.js`

Classes: `AudioEngine`. Free functions: `getAM()`, `processSounds(q, am,
mutedRef)`.

- Lazily created on first `getAM()`. Will return `null` if `AudioContext`
  fails (e.g. CSP).
- `startBg()` / `stopBg()` toggle a low drone + intermittent kick beat.
- `mute(on)` ducks master to 0 with a 50 ms ramp.
- `processSounds(q, am, mutedRef)` reads events from a per-frame array of
  `{t: 'shot'|'shell'|'reload'|'hit'|'zdie'|'groan'|'zatk'|'bhit'|'wclr',
  ...args}` and dispatches; clears the queue afterwards.

### 2.4 `src/entities/`

Pure factory functions. No rendering, no audio.

| Module | Export | Returns |
| --- | --- | --- |
| `soldier.js` | `mkSoldier(name, weapon, destX, hp?, lane?, civilian?, onRoof?)` | Soldier object with animation phases, ammo from `WPN`, all transient state zeroed. |
| `zombie.js` | `mkZombie(type)` | Zombie object spawning at `x = CW+50`, random lane, jittered speed. |
| `human.js` | `mkHuman(type)` | Hostile human (knifeman / gunman) with `hostile: true`, random lane, jittered speed. |
| `barricade.js` | `mkBarricade(x)` | 140-HP perspective wall spanning all lanes. |
| `wave.js` | `mkWave(n)`, `mkHumanWave(n)`, `isHumanWaveNumber(n)` | Spawn queues sorted by `at` (ms offset from wave start). |
| `gameState.js` | `mkGS()` | Fresh game state. Includes 4 starting soldiers (Alpha/Bravo/Charlie/Delta), starting resources, empty arrays for live entities. |
| `persistence.js` | `hasSavedGame()`, `saveGame(gs)`, `loadGame(mkGS)`, `clearSave()` | localStorage helpers. Saves are versioned (`v: 1`); a future shape change will silently invalidate old saves. |

### 2.5 `src/render/`

All canvas draw functions. They receive `ctx` plus the entity (or `gs`)
and `now` in ms. They never read or write `gs` outside of the entity
passed in.

- `background.js` — `dBg(ctx)` paints sky, stars, ruined buildings, lane
  strips, ground gradient, faint lane labels (`FRONT/MID/BACK`).
- `base.js` — `dBase(ctx, hp, mhp)` Fort Omega wall + rooftop + HP strip.
- `weapons.js` — `dWpn(ctx, weaponKey, recoil)` polygon sprites for rifle,
  pistol, shotgun. Local coordinates; caller applies translate/scale.
- `soldier.js` — `dSoldier(ctx, s, now, isSelected)`. Branches:
  - `s.onRoof && s.state !== 'dead'` → `dRooftopSniper` (also exported).
  - `s.state === 'dead'` → flat corpse with rifle next to body.
  - else → animated walking/shoot/idle/knife/reload sprite, civilian
    palette swap when `s.civilian`.
  Selection ring + arrow drawn after the soldier when `isSelected`.
- `zombie.js` — `dZombie(ctx, z, now)`. Walk cycle + lurching attack pose
  + fall-down rotation on death + delayed blood pool fade-in.
- `human.js` *(new)* — `dHuman(ctx, h, now)`. Civilian silhouette with
  jeans + jacket coloured by `h.h.color`. Knifeman has a stabbing blade;
  gunman draws a small pistol + muzzle flash when `h.lastShot < 90 ms`.
- `effects.js` — `dBarricade(ctx, b)` (3-lane perspective wall),
  `dBlt(ctx, b)` (bullet streak; hostile bullets get an orange tracer),
  `dFx(ctx, e, now)` (blood, shell, txt, slash, hit particles).
- `hud.js` — `dHUD(ctx, gs, now, muted)` top status bar + per-soldier
  cards + mute button + wave-clear overlay + the **red "HOSTILE SURVIVORS"
  banner** while `gs.isHumanWave`. `dSquadMarker` paints the squad-target
  arrow in the active lane.

### 2.6 `src/update/`

Heavy lifters. These are the only places that mutate `gs` (or `m` for
missions). Both functions are pure data flow — they don't touch React or
canvas.

#### `update/siege.js` — `update(gs, now, dt)`

Order of operations in one call:

1. Early return if `gs.phase !== 'siege'`.
2. `gs.waveTime += dt`; decrement shake timer.
3. Drain `gs.spawnQueue` — push new zombies or humans depending on
   `gs.isHumanWave`.
4. Random ambient groan.
5. **Zombie loop**: `walk → attack`. Attack target priority is
   same-lane soldier > same-lane barricade > base wall (if `z.x < WX+46`).
6. **Human loop** (only meaningful entries when `gs.isHumanWave`):
   - Knifemen behave like fast walkers.
   - Gunmen stop at `meta.range`, fire hostile bullets toward target,
     drop target if it dies / leaves lane.
7. **Soldier loop**:
   - Rooftop sniper: separate branch with sniper-ammo refill, descend on
     dry pool, target-furthest selection.
   - Ground soldier: walk-collision against barricades, target-prioritise
     same-lane enemies, reload on dry mag, knife melee when both ammo and
     reserve dry.
   - Soldiers re-target `gs.humans` instead of `gs.zombies` when
     `gs.isHumanWave`.
8. **Bullet loop**:
   - Hostile bullets → check soldier collisions in `b.targetLane`.
   - Friendly bullets → check enemy collisions; on kill call
     `killTarget()` which credits the shooter, awards score, and (if
     target is a human) drops `rng(HUMAN_AMMO_DROP[0..1])` ammo.
9. Dead-body caps: 60 zombie corpses max, 30 human corpses max. Effects
   GC'd by `dur`.
10. Wave-clear check: spawn queue empty + no live enemies → `waveComplete
    = true`. After 3 s, increment day/wave, give bonus ammo+food, climb
    Delta back up if she's alive on the ground + sniper ammo > 0, switch
    `phase = 'management'`.
11. Game-over check: base HP ≤ 0 OR every non-expedition soldier is dead.

#### `update/mission.js`

`mkMission(soldier, dest)` builds a 1900 px wide playable level:
pre-placed zombies (activate when soldier within 400 px), pickups along
the way, decorative cars/crates, an end goal. The mission's soldier is a
**copy** of the siege soldier; `finishMission()` writes results back to
the original.

`updateMission(m, now, dt)`: movement from `m.inputLeft/Right`, shoot
from `m.inputShoot`, zombie activation, melee knife fallback, pickup
collisions, bullets, win on `x ≥ MISSION_W-50`, loss on `s.hp ≤ 0`.

`dMissionWorld(ctx, m, now)` + `dMissionHUD(ctx, m, now)` paint the
parallax background + foreground entities + top HUD with progress bar.

### 2.7 `src/expedition/`

- `auto.js` — `resolveExpedition(soldier, dest, gs)`: dice-roll outcome
  using `threshold = {LOW:0.80, MED:0.60, HIGH:0.40}`. Applies damage to
  the soldier and returns `{outcome, reward, recruit, dmgTaken, ...}`.
- `missionFinish.js` — `finishMission(m, gs)`: transfers collected
  resources from a playable mission back into the game state, possibly
  spawns a civilian recruit, marks soldier KIA if the mission was lost.
- `events.js` — `genEvents(soldierName, dest, outcome, dmgTaken, recruit)`
  builds the per-event narrative log (icons, delays, colors) used by the
  expedition "running" UI animation.

### 2.8 `src/DeadPerimeter.jsx`

Thin React component (~500 lines) that wires everything together. Hooks:

- `useRef` — `cvs`, `gsRef`, `rafId`, `prevT`, `mutedR`, `pausedRef`,
  `missionRef`, `inputRef`, `expSolRef`, `expDstRef`.
- `useState` — `scr` (which screen), `ui` (HUD snapshot), `muted`,
  `paused`, `hasSave`, expedition pickers, mission tick.
- `useCallback` — every event handler: `newGame`, `continueGame`,
  `startWave`, `sendExpedition`, `playMission`, `finalizeMission`,
  `recruit`, `buildBarricade`, `healSoldier`, `moveSquad`,
  `toggleMute`, `togglePause`.
- `useEffect` — load `hasSavedGame()` on mount; expedition animation
  ticker; mission "is-finished" poll; the main RAF + event-listener
  setup/teardown.

Event handlers attached to the canvas: `click`, `mousedown`, plus
`touchstart`/`touchend`/`touchcancel` for mobile (mission: tap-left =
move left, tap-right = move right, tap-center = fire). Window-level
listeners: `keydown` (Esc, A/D/arrows, Space), `keyup`, `mouseup`.

JSX renders 5 screens:
1. `menu` — title + `BEGIN OPERATION` + `CONTINUE SAVED RUN` (when save exists).
2. `management` — resources, soldiers, barricades, base HP, recruit /
   barricade / heal / expedition / deploy buttons. Shows a red **HOSTILE
   HUMANS APPROACHING** banner when `isHumanWaveNumber(gs.wave)`.
3. `siege` — the canvas + control row (RETREAT, soldier badges, ADVANCE,
   PAUSE/RESUME, MUTE).
4. `expedition` — pickers + AUTO-DISPATCH / PLAY LIVE / event log /
   result summary.
5. `mission` — the canvas + bottom hint + RETURN TO BASE button.
6. `gameover` — stats + TRY AGAIN.

---

## 3. Invariants

The codebase relies on these rules. Breaking any of them is a
regression.

1. **Module dependency direction is strictly top-down**: `constants` →
   `data` → `entities` → `render` / `update` / `expedition` →
   `DeadPerimeter.jsx`. No reverse imports, no cycles.
2. **`gs` is mutated in place**. Never replace it; never `Object.assign`
   over it.
3. **React state is for the UI shell**, not for gameplay. Mutation must
   not flow through `setState`.
4. **`missionRef.current` overrides `gs.phase`** in the loop. If a
   mission is active, siege is paused entirely.
5. **`gs.soundQ` is drained every frame** by `processSounds`. Pushing a
   sound during render is safe but pointless — the queue is read
   immediately after.
6. **Bullet collisions branch on `b.hostile`**: hostile bullets only
   damage soldiers, friendly bullets only damage zombies or humans (per
   `gs.isHumanWave`).
7. **`gs.isHumanWave` is set in `startWave`**, never derived mid-update.
8. **Rooftop sniper** does not respect lane scaling — it's drawn at
   `(WX-40, GY-160)` at full size.
9. **Soldier states**: `walk | idle | shoot | reload | knife | dead`.
   Dead soldiers stay in `gs.soldiers` forever as memorials.
10. **Lane scaling is on the canvas transform**, not pre-baked into
    sprite coordinates.

---

## 4. Performance & gotchas

- **No sprite caching.** Every entity is drawn from scratch every frame.
  At ~30 entities visible on screen this is well under one ms. If you
  add 100s of entities, consider rendering each sprite once to an
  offscreen `<canvas>` and `drawImage` it (see roadmap §17 Polish).
- **`requestAnimationFrame` is throttled** when the tab is backgrounded.
  This effectively pauses the game without an explicit pause. The
  manual pause (Esc) is the safer way.
- **`AudioContext` autoplay policy** forces the engine to be created
  lazily on first user gesture. `getAM()` resumes a suspended context
  automatically.
- **`gs.usedNames` is a `Set`**. Persistence serialises it as an array.
- **Reload triggers a one-shot sound** (`reloadTriggered`) so the reload
  noise plays once even if the soldier transitions to/from `reload`
  multiple times.
- **Soldier walk collision** stops at `bar.x ± 13` from a barricade.
  Movement gets pinned to that x and `state` becomes `idle`.
- **The mission soldier is a copy** of the siege soldier. Don't expect
  side effects on the original mid-mission; they're written back only by
  `finishMission`.

---

## 5. Recipes — how to extend

### 5.1 Add a new weapon

1. Add an entry in `data/weapons.js` (`WPN[name] = { dmg, range, rate,
   ammo, rl, spd, sp, ammoCost, pel? }`).
2. Add a `else if (w === 'newkey')` branch in `render/weapons.js` with
   the polygon sprite.
3. Add it to `RECRUIT_WEAPONS` if it should appear on recruits.

### 5.2 Add a new zombie type

1. Add an entry in `data/zombies.js` (`ZTP[name] = { hp, spd, dmg, sc,
   cc }`).
2. Add it to `mkWave` in `entities/wave.js` so it spawns in the queue.
3. If it needs unique rendering (e.g. armor), branch on `z.type` in
   `render/zombie.js`.

### 5.3 Tune difficulty

Edit `data/difficulty.js`. The two factory functions in
`entities/wave.js` read these constants. No other code needs touching.

### 5.4 Add a new soldier ability

1. Extend `mkSoldier` in `entities/soldier.js` with the new state field.
2. Add the behaviour in `update/siege.js` (and `update/mission.js` if it
   should work in playable expeditions).
3. Add rendering in `render/soldier.js`.

### 5.5 Add a new expedition destination

Append to `EXPEDITION_DESTS` in `data/expeditions.js`. The auto-resolve
table in `expedition/auto.js` reads `dest.risk` and applies the
appropriate reward block — extend that switch if you introduce a new
risk tier.

### 5.6 Add a new saved field

1. Add the field to `mkGS` in `entities/gameState.js`.
2. Add it to both `saveGame` and `loadGame` in
   `entities/persistence.js`.
3. Bump `STORAGE_KEY` to `-v2` so old saves are discarded gracefully.

### 5.7 Change canvas dimensions

Update `CW, CH, GY, WX` in `constants.js`. Most code reads them by
import; the few places that bake them in (e.g. `LANES[*].dy`) are right
next to the constants.

---

## 6. Where each user-facing feature lives

| Feature | Files |
| --- | --- |
| Lane depth | `constants.js` (LANES), every `render/*.js`, `update/siege.js` |
| Rooftop sniper | `render/soldier.js` (`dRooftopSniper`), `update/siege.js` (onRoof branch) |
| Civilian palette | `render/soldier.js` (`isCiv` block), `entities/soldier.js` |
| Barricades | `entities/barricade.js`, `render/effects.js` (`dBarricade`), `update/siege.js` (walk collision + zombie attack) |
| Expeditions auto | `expedition/auto.js`, `expedition/events.js`, `DeadPerimeter.jsx` (`sendExpedition`) |
| Expeditions playable | `update/mission.js`, `expedition/missionFinish.js`, `DeadPerimeter.jsx` (`playMission`, `finalizeMission`) |
| Hostile human waves | `data/humans.js`, `entities/{human,wave,gameState}.js`, `render/human.js`, `update/siege.js` (human loop + hostile bullets + ammo drop), `render/hud.js` (banner) |
| Save / load | `entities/persistence.js`, `DeadPerimeter.jsx` (`continueGame`, autosave hooks) |
| Pause | `DeadPerimeter.jsx` (`togglePause`, Esc handler, render guard, overlay) |
| Mobile touch | `DeadPerimeter.jsx` (`onTouchStart` / `onTouchEnd`) |

---

## 7. Glossary

- **GS** — game state, the single mutable object held in `gsRef.current`.
- **Lane** — depth row; 0 = FRONT (largest sprites), 1 = MID, 2 = BACK.
- **Hostile** — bullets coming **from** humans **toward** soldiers.
- **Friendly** — bullets from soldiers toward zombies / humans.
- **Wave-clear** — moment when `spawnQueue` is empty and no live enemies
  remain; triggers transition to `management` after 3 s.
- **onRoof** — flag on `Delta` while she's on the rooftop with the
  sniper rifle. Cleared when she descends to fight on the ground.
- **isHumanWave** — flag on `gs` toggled true for human-survivor waves.
  Both spawn logic and bullet collision check it.

---

Last updated alongside this commit. If you change any of the §3
invariants, update this document too.
