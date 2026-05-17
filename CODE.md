# Dead Perimeter — Code Documentation

Module-by-module developer reference. Technical companion to
[`README.md`](./README.md) (user-facing) and
[`PROJECT_STATE.md`](./PROJECT_STATE.md) (game design + roadmap).

Reading order:
1. `§1` Big picture — data flow, render loop, override refs
2. `§2` Module reference — every file in `src/`
3. `§3` Common invariants — rules that must hold across the codebase
4. `§4` Performance + gotchas
5. `§5` How to extend (recipes for common additions)
6. `§6` Where each user-facing feature lives
7. `§7` Glossary

---

## 1. Big picture

The game runs entirely client-side. There is **one canvas** (900×530) and
**one React component**, `DeadPerimeter`. All gameplay state lives in a
single mutable object owned by `gsRef`. React state is used only for
the UI shell (which screen is visible, the per-250 ms HUD snapshot,
paused / muted flags). This keeps the 60 fps render loop independent of
React reconciliation.

```
┌──────────────────────────── browser tab ─────────────────────────────┐
│                                                                      │
│   ┌────────────── React tree ────────────────────┐                   │
│   │ DeadPerimeter.jsx                            │                   │
│   │   useState: scr, ui, muted, paused, hasSave  │  snapshots every  │
│   │   useRef:   gsRef, missionRef, evacRef,      │◄── 250 ms via     │
│   │             introRef, defeatRef, inputRef,   │    setUi()        │
│   │             expSolsRef, expDestsRef          │                   │
│   │                                              │                   │
│   │   ┌───── requestAnimationFrame loop ─┐       │                   │
│   │   │  override refs first             │       │                   │
│   │   │  then update(gs) + processSounds │       │                   │
│   │   │  then draw layers                │       │                   │
│   │   └──────────────────────────────────┘       │                   │
│   └──┬──────────────────────────────────────────┘                   │
│      │ mutates                                                      │
│      ▼                                                              │
│   ┌────────────── gsRef.current ─────────────────┐                  │
│   │ phase, resources, soldiers, reserve,         │                  │
│   │ zombies, humans, barricades, turrets,        │                  │
│   │ bullets, effects, soundQ, isHumanWave,       │                  │
│   │ radioMsg, expeditionsToday, lastEvacWave …   │                  │
│   └──────────────────────────────────────────────┘                  │
│                                                                      │
│   ┌─── localStorage (entities/persistence.js) ───┐                  │
│   │ key: "dead-perimeter-save-v1"                │                  │
│   │ saved on management entry, recruit, build,   │                  │
│   │ heal. cleared on game over / NEW GAME.       │                  │
│   └──────────────────────────────────────────────┘                  │
│                                                                      │
│   ┌─── Web Audio (audio/AudioEngine.js, lazy) ───┐                  │
│   │ master → fx + bg; per-frame queues drained   │                  │
│   │ by processSounds(); radioChatter + heli loop │                  │
│   │ + wind / cityHum loops managed from gs.      │                  │
│   └──────────────────────────────────────────────┘                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.1 Data flow per frame

```
RAF tick (now, dt)
   │
   ├── introRef.current ?   ── yes ──► dIntroScene  + processSounds  ─► return
   ├── defeatRef.current ?  ── yes ──► dDefeatScene + processSounds  ─► return
   ├── evacRef.current ?    ── yes ──► dEvacScene   + processSounds  ─► return
   ├── missionRef.current ? ── yes ──► updateMission + dMission*     ─► return
   │
   ├── gs.phase === 'siege' ?
   │     │
   │     ├── pausedRef.current ?  ── yes ──► skip update & sounds (still render)
   │     │
   │     ├── update(gs, now, dt)
   │     │     ├── drain spawnQueue → push to gs.zombies | gs.humans
   │     │     ├── tick zombies (walk → attack)
   │     │     ├── tick humans  (walk → attack; gunmen → bullets)
   │     │     ├── tick soldiers (incl. rooftop sniper, ground melee)
   │     │     ├── tick turrets (fire at closest enemy in range)
   │     │     ├── advance bullets, branch on b.hostile / b.spit
   │     │     ├── hurtCallout + maybeKillChatter (radio events)
   │     │     ├── auto-promote reserve when active count < cap
   │     │     ├── garbage-collect dead bodies / effects
   │     │     ├── decide wave clear → schedule phase='management'
   │     │     └── push sound events to gs.soundQ
   │     │
   │     ├── processSounds(gs.soundQ, audio, mutedRef)  ── drains queue
   │     │
   │     ├── phase transition?
   │     │     ├── management → saveGame(gs)
   │     │     ├── gameover   → clearSave() + start defeat cinematic
   │     │     └── setScr(gs.phase)
   │     │
   │     └── draw: dBg → dBase → (per lane back→front) zombies → humans
   │              → soldiers → barricades → turrets → effects → bullets
   │              → dSquadMarker → dHUD → pause overlay
   │
   └── requestAnimationFrame(loop)
```

### 1.2 Override-ref priority

The render loop checks these refs **before** touching `gs.phase`. Each
override takes the canvas exclusively for the duration of its cinematic
or mission and drains its own sound queue:

| Ref | Set by | Cleared by | Duration | Purpose |
| --- | --- | --- | --- | --- |
| `introRef` | `newGame()` | `finishIntro()` (SKIP or natural end) | 50 s | Opening cinematic |
| `defeatRef` | siege loop on `gs.phase === 'gameover'` | `finishDefeat()` | 24 s | Game-over cinematic |
| `evacRef` | `callEvac()` from management | `applyEvac()` (SKIP or natural end) | 5.4 s | Helicopter evac |
| `missionRef` | `playMission()` from expedition | `finalizeMission()` | until win/loss | Playable side-scroll mission |

Each ref-state holds a `soundQ`, a `startedAt`, and a `_fired` Set for
fire-once audio events.

### 1.3 Persistence model

We save **between waves**, never mid-wave. The serialised shape
(`entities/persistence.js`) covers exactly the durable management-screen
state: resources, soldiers (snapshot of equipment/hp, transient fields
reset on load), reserve, barricades, turrets, wave/day, score/kills,
used recruit names, `lastEvacWave`.

- Saves happen automatically on: wave clear (entering `management`),
  recruit, barricade built, turret built, soldier healed, soldier
  benched / activated, EVAC completed.
- Saves are cleared on: `gameover`, `NEW GAME` button.
- The menu shows `↻ CONTINUE SAVED RUN` when a save is present.
- Loaded games **skip the intro cinematic**.

### 1.4 Audio model

`AudioEngine` exposes high-level methods that build short
oscillator/noise chains and patch them through filters. The engine is
lazily created on first call to `getAM()` so we never violate browser
autoplay policy. The update loop pushes sound **events** onto
`gs.soundQ` (and each cinematic carries its own `soundQ`); once per
frame `processSounds()` drains the queue.

Persistent loops (helicopter rotor, wind, city hum) are managed by
explicit `heliStart` / `heliStop` etc. events so the engine can keep
the looping nodes alive across frames without re-queuing.

`audio/radio.js` adds the tactical-radio chatter layer: `pushRadio()`
queues a `chatter` event and stores a subtitle on `state.radioMsg`.

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
`WPN`: per-weapon stats — `name, dmg, range, rate (ms), ammo (mag
size), rl (reload ms), spd (bullet px/frame), sp (spread radians),
pel` (pellet count, shotgun only), `ammoCost` (mag refill cost).
Weapons: `rifle, pistol, shotgun, sniper`.

#### `data/zombies.js`
`ZTP`: per-type zombie stats. Walker / runner / tank are siege regulars;
spitter (ranged acid) and brute (HIGH-risk boss) are mission-only. Each
entry has `hp, spd, dmg, sc, cc` plus ranged-zombie extras (`ranged,
spitRange, spitRate, spitSpd`) where applicable.

#### `data/humans.js`
- `HTP` — knifeman / gunman stats.
- `HUMAN_AMMO_DROP = [3, 8]` — ammo dropped on death range.
- `HUMAN_WAVE_FIRST = 4`, `HUMAN_WAVE_EVERY = 5` — wave-cadence constants.
- `isHumanWaveNumber(n)` — predicate.

#### `data/biomes.js`
`BIOMES` — three palettes (hospital, armory, downtown). Each carries
`sky` gradient, `ground` gradient, `groundLine`, `bldgFill / bldgRoof /
bldgWindow`, `bldgCount`, `bldgHRange`, `accentLight`, obstacle types
(`propType`, `propsPerStep`). `DEFAULT_BIOME = 'downtown'`.

#### `data/difficulty.js`
`DIFFICULTY` — wave-generation knobs (`mkWave` and `mkHumanWave` read
these). `BALANCE` — gameplay caps + rewards (`maxActiveSoldiers,
maxReserveSoldiers, expeditionsPerDay, evacMinReserve,
evacWaveCooldown, evacFoodPerCiv, …, missionGoalKillRatio,
partyRewardDiminish, behindBarricadeDmgMul`).

#### `data/expeditions.js`
- `DEST_POOL` — 16 city locations grouped by risk tier
  (`{ LOW: [...5 pharmacy/supermarket/etc.], MED: [...6], HIGH: [...5] }`).
  Each has `name, icon, biome, loot[], desc`.
- `RISK_BASE` — per-tier mechanics (`riskColor, solDmg, missionLen, zSpawn`).
- `rollDestinations()` — picks one per tier into the live 3-card list.
- `lootSummary(loot)` — pretty-prints the icon list for the card.
- `MISSION_W=1900, MISSION_VIEW=CW, MGY=GY`.
- `objIcons` — emoji map for pickup types (including 'lostSoldier' 🪖).
- `STARS, BLDGS` — procedural background coords.
- `RECRUIT_NAMES, RECRUIT_WEAPONS, CIVILIAN_WEAPONS, VETERAN_WEAPONS`,
  `KIND_HP = { recruit: 100, civilian: 70, veteran: 120 }`.
- `TRADE_OFFERS` — pool of 8 trader-camp offers (`give / get / desc`).
- `rollEncounter(risk)` — returns `{ type: 'hostile' | 'trader', offer? }`
  or null with MED 28 % / HIGH 40 % chance.

### 2.3 `src/audio/`

#### `audio/AudioEngine.js`
Classes: `AudioEngine`. Free functions: `getAM()`, `processSounds(q, am, mutedRef)`.

- Lazily created on first `getAM()`. Returns `null` if `AudioContext`
  fails (e.g. CSP).
- `startBg()` / `stopBg()` toggle a low drone + intermittent kick beat
  used during siege.
- `mute(on)` ducks master to 0 with a 50 ms ramp.
- `processSounds(q, am, mutedRef)` reads events from a per-frame array.

Event types recognised:
- Combat: `shot, shell, reload, hit, zdie, groan, zatk, bhit, wclr`.
- Cinematic / ambient: `heliStart, heliStop, siren, scream, crackle,
  windStart, windStop, cityHum, cityHumStop, titleSting`.
- Voice: `chatter` (delegates to `radioChatter`).

Looping events (`heliStart, windStart, cityHum`) hold their own
nodes on the engine instance until `*Stop` is queued; the queue draining
is what keeps loops alive vs. tearing them down.

#### `audio/radio.js`
- `RADIO_LINES` — pool of short tactical lines by category:
  `advance, retreat, reload, hurt, kill, evacIn, evacBoard, evacOut,
  deploy, lowAmmo, baseHit, defeat`.
- `pushRadio(state, category, opts)` — picks a line (or uses
  `opts.line` override), computes a pitch (explicit `opts.pitch` ->
  `opts.speaker.voicePitch` -> text hash), and:
  - Schedules a `chatter` audio event on `state.soundQ`.
  - Stores `state.radioMsg = { text, at, dur, category }` so the HUD
    can render the subtitle.
  Includes a per-state cooldown (`state._lastRadioAt`, default 1300 ms)
  so callouts never overlap.

### 2.4 `src/entities/`

Pure factory functions. No rendering, no audio.

| Module | Export | Returns |
| --- | --- | --- |
| `soldier.js` | `mkSoldier(name, weapon, destX, hp?, lane?, civilian?, onRoof?, opts?)` | Soldier object. Stamps `kind` (recruit / civilian / veteran), `maxHp` from `KIND_HP`, deterministic `voicePitch`, all transient state zeroed. |
| `zombie.js` | `mkZombie(type)` | Zombie object spawning at `x = CW+50`, random lane, jittered speed. |
| `human.js` | `mkHuman(type)` | Hostile human with `hostile: true`. |
| `barricade.js` | `mkBarricade(x)` | 140-HP perspective wall spanning all lanes. |
| `turret.js` | `mkTurret(x, lane)` | Machine-gun emplacement. |
| `wave.js` | `mkWave(n)`, `mkHumanWave(n)`, `isHumanWaveNumber(n)` | Spawn queues sorted by `at` (ms offset from wave start). |
| `gameState.js` | `mkGS()` | Fresh game state. Includes 4 starting soldiers, starting resources, empty arrays. |
| `persistence.js` | `hasSavedGame()`, `saveGame(gs)`, `loadGame(mkGS)`, `clearSave()` | localStorage helpers. Saves are versioned (`v: 1`); shape change should bump the key. |

### 2.5 `src/render/`

Canvas draw functions. They receive `ctx` plus the entity (or `gs`) and
`now` in ms. They never read or write `gs` outside of the entity passed
in (with the exception of the override-ref cinematics).

#### `background.js`
`dBg(ctx)` — sky, stars, ruined buildings, lane strips, ground gradient,
faint lane labels.

#### `base.js`
`dBase(ctx, hp, mhp)` — Fort Omega wall. Now includes: brick courses
with offset masonry pattern, four loophole firing slits, battle-damage
streaks, reinforced gate panel with padlock, two-row sandbag base course
extending past the wall, concertina razor wire along the parapet, three
mounted floodlights with light cones, a wooden corner watchtower with
lit window + antenna + side-mounted searchlight, faded "Ω" star
insignia, "FORT OMEGA" plaque with corner rivets, HP strip on the
parapet.

#### `weapons.js`
`dWpn(ctx, weaponKey, recoil)` — polygon sprites for rifle, pistol,
shotgun, sniper. Local coordinates; caller applies translate/scale.

#### `soldier.js`
`dSoldier(ctx, s, now, isSelected)`. Branches:
- `s.onRoof && s.state !== 'dead'` → `dRooftopSniper`.
- `s.state === 'dead'` → flat corpse with rifle next to body.
- else → animated walking / shoot / idle / knife / reload sprite.

Palette by flag:
- `s.civilian` → brown jacket + blue jeans + red baseball cap.
- `s.bandit` → dark maroon jacket + near-black pants and helmet.
- `s.police && !s.swat` → classic NHPD peaked cap (navy crown + black
  visor + gold badge).
- `s.police && s.swat` → tactical helmet with black strap + small peak.
- else → standard military variant from a hash of name (`HELMET_VARIANTS`).

`variantFor(s)` is a deterministic per-soldier sprite-variant helper
(jacket / helmet / beard) hashed from `s.name`.

#### `zombie.js`
`dZombie(ctx, z, now)`. Walk cycle, lurching attack pose, fall-down
rotation on death, delayed blood pool fade-in. Per-type scale tweaks
(tank 1.35×, brute 1.7×).

#### `human.js`
`dHuman(ctx, h, now)` — knifeman with stabbing blade, gunman with small
pistol + muzzle flash when `h.lastShot < 90 ms`.

#### `turret.js`
`dTurret(ctx, t, now)` — emplacement body + rotating barrel + flash on
fire.

#### `effects.js`
`dBarricade(ctx, b)` (3-lane perspective wall), `dBlt(ctx, b)` (bullet
streak; hostile bullets orange, spit globs green), `dFx(ctx, e, now)`
(blood, shell, txt, slash, hit particles).

#### `hud.js`
`dHUD(ctx, gs, now, muted)` — top status bar, per-soldier cards, mute
button, wave-clear overlay, red "HOSTILE SURVIVORS" banner during
`gs.isHumanWave`.
`dSquadMarker(ctx, target, lane, now)` — squad-target arrow in the
active lane.
`dRadioSubtitle(ctx, state, now)` — renders `state.radioMsg` as a
"📻 Speaker: line!" lozenge near the bottom of the canvas with category-
tinted color and fade in/out. Used from siege HUD, mission HUD, evac,
defeat.

#### `evac.js`
`dEvacScene(ctx, evac, now)` + `EVAC_DURATION = 5400`. Procedural UH-60
Black Hawk silhouette: angular fuselage with raked nose pointing right,
twin engine humps, 4-blade main rotor with motion blur, horizontal
stabilizer + tail rotor, military wheel landing gear, white army-star
insignia, "OMEGA-1" hull stencil, red beacon + green nav lights, optional
engine glow during arrive / depart. Three phases (arrive → board →
leave) with rope-ladder boarding civilians and a ground-shadow ellipse
projected to GY with altitude-scaled alpha.

#### `intro.js`
`dIntroScene(ctx, intro, now)` + `INTRO_DURATION = 50000`. 14 scripted
SHOT entries (each with `from / to / draw / banner`). Shots reuse the
real `dSoldier` / `dZombie` renderers via a shared `dSpriteAt(drawFn,
ctx, entity, screenX, screenFootY, scale, now)` helper, so the
cinematic characters are visually identical to gameplay sprites.
Custom drawings remain for environment (cars, fires, mug, newspaper,
phone, etc.). `mkIntroSoldier()` / `mkIntroZombie()` are minimal record
builders that satisfy the dSoldier / dZombie field expectations.
Audio scheduled via `scheduleIntroAudio()` with a fire-once Set.

#### `defeat.js`
`dDefeatScene(ctx, defeat, now)` + `DEFEAT_DURATION = 24000`. Four
phases (breach / overrun / lastStand / silence). Defenders are a
scripted array (`DEFENDERS = [Alpha, Delta, Bravo, Charlie]` with
cumulative `fallAt` times), `KILLERS` is the list of zombie attackers
attached to each defender at their `hurtAt`, and `DEAD_ZOMBIES` is the
list of corpses on the road from cop fire. `dDefeatSoldier` calls real
`dSoldier` with `shoot / idle / knife / dead` based on time. Helpers
`dCombatBackdrop`, `dCombatWall`, `dInnerFires`, `dHordeWave` keep the
phase functions thin. `scheduleDefenderVoices()` fires the defenders'
radio lines at their `hurtAt` times.

### 2.6 `src/update/`

Heavy lifters. These are the only places that mutate `gs` (or `m` for
missions). Both functions are pure data flow — they don't touch React
or canvas.

#### `update/siege.js` — `update(gs, now, dt)`

Order of operations in one call:

1. Early return if `gs.phase !== 'siege'`.
2. `gs.waveTime += dt`; decrement shake timer.
3. Drain `gs.spawnQueue` — push new zombies or humans depending on
   `gs.isHumanWave`.
4. Random ambient groan.
5. **Zombie loop**: `walk → attack`. Target priority: same-lane soldier
   > same-lane barricade > base wall.
6. **Human loop** (only when `gs.isHumanWave`):
   - Knifemen behave like fast walkers.
   - Gunmen stop at `meta.range`, fire hostile bullets, drop target if
     it dies / leaves lane.
7. **Soldier loop**:
   - Rooftop sniper: own branch with sniper-ammo refill, descend on
     dry pool, target-furthest selection.
   - Ground soldier: walk-collision against barricades, target-prioritise
     same-lane enemies, reload on dry mag, knife melee when both ammo
     and reserve dry. `hurtCallout` fires once when HP < 35 % of max.
8. **Turret loop**: fire at closest in-range enemy using `turretAmmo`.
9. **Bullet loop**:
   - Hostile bullets → soldier collisions in `b.targetLane`.
   - Friendly bullets → enemy collisions; on kill, `killTarget()` credits
     the shooter, awards score, possibly rolls a random kill chatter,
     and (for humans) drops `rng(HUMAN_AMMO_DROP[0..1])` ammo.
10. Dead-body caps (60 zombies / 30 humans). Effects GC'd by `dur`.
11. Reserve auto-promotion: if active count < `BALANCE.maxActiveSoldiers`
    and reserve has entries, promote one.
12. Wave-clear check: spawn queue empty + no live enemies → `waveComplete`.
    After 3 s, increment day/wave, give bonus ammo + food, climb Delta
    back up, switch `phase = 'management'`.
13. Game-over check: base HP ≤ 0 OR every non-expedition soldier dead.

#### `update/mission.js` — `mkMission(party, dest, wave)` + `updateMission(m, now, dt)`

`mkMission` builds a 1900 px playable level for a multi-soldier party:
- Picks lead (player-controlled) + followers (AI).
- Pre-places zombies, pickups, hazards (mines + acid pools), obstacles,
  decorative props per the destination's biome.
- Rolls `objective` (reach / defend at `MISSION_W * 0.45`) and `fork`
  (50 % chance for MED+HIGH non-defend).
- For defend missions, pre-places a 3-6 zombie ambush past the anchor.
- Rolls a survivor encounter (MED 28 % / HIGH 40 %), spawns the camp
  humans, and clears zombies within a 220 px radius around the camp.
- Spawns a HIGH-risk Brute boss near the goal.
- Computes wave-scaled spitter dmg + rate and stamps them on each
  spitter instance.
- Stamps `voicePitch` on the lead + followers via `mkSoldier`.

`updateMission` per frame:
- Top-of-frame guard: if lead is dead, promote a follower via
  `promoteLeadOnDeath`; mission only fails on full party wipe.
- Trader proximity opens the dialog and pauses world simulation.
- Encounter proximity sweep clears any zombies that wandered into the
  camp area (220 px radius).
- Lead movement (including fork-lane switch via `W` / `S`).
- Follower AI: track lead, fire on hostiles in range, switch to knife
  on dry mag.
- Zombie AI: walk-to-target, ranged spitter logic, melee on contact.
- Hostile-human AI: walk to weapon's ideal range, then stop and fire.
- Bullet loop with branches: spit → damage party / rescuables; hostile →
  damage party; friendly → mine detonate → human → zombie. Kill chatter
  on confirmed kills.
- Hazard ticks: mine proximity trigger (or bullet trigger); acid pool
  slow + dot.
- Pickup collection (lane-gated for fork pickups).
- Defend timer + scripted wave spawner past the anchor.
- Win condition: `s.x >= MISSION_W - 50` (reach) or defend timer
  elapsed.

`dMissionWorld` + `dMissionHUD` paint the parallax background +
foreground entities + top HUD (progress bar repurposed as defend timer
during DEFEND missions).

### 2.7 `src/expedition/`

- `auto.js` — `resolveExpedition(soldier, dest, gs)` rolls
  threshold-based outcome with preparation-scaled damage and rewards
  scaled by wave (+5 % per wave above 1, capped at +100 %). Veteran
  rescue chance: LOW 0 %, MED 12 %, HIGH 25 %.
  `resolvePartyExpedition(soldiers, dest, gs)` aggregates with
  diminishing-returns reward merging.
- `missionFinish.js` — `finishMission(m, gs)` transfers collected
  resources from a playable mission back into the game state, handles
  recruit pickup (`civilian` → civilian kind, `lostSoldier` → veteran),
  pushes results to active duty or reserve as space allows.
- `events.js` — `genEvents()` builds the narrative log for the
  expedition "running" UI animation.

### 2.8 `src/DeadPerimeter.jsx`

Thin React component that wires everything together. Hooks:

- `useRef` — `cvs, gsRef, rafId, prevT, mutedR, pausedRef, missionRef,
  evacRef, introRef, defeatRef, inputRef, expSolsRef, expDstRef,
  expDestsRef`.
- `useState` — `scr, ui, muted, paused, hasSave, expSoldierIdxs,
  expDestIdx, expDests, expEvents, expVisible, expResult, expPhase`.
- `useCallback` — every event handler: `newGame, continueGame,
  startWave, sendExpedition, playMission, finalizeMission,
  finishIntro, finishDefeat, applyEvac, skipEvac, callEvac,
  resolveTrade, recruit, buildBarricade, buildTurret, healSoldier,
  moveSquad, toggleMute, togglePause, benchSoldier, activateReserve,
  toggleSoldier, pickDest`.
- `useEffect` — load `hasSavedGame()` on mount; expedition animation
  ticker; mission "is-finished" poll; the main RAF + event-listener
  setup/teardown.

Event handlers attached to the canvas: `click`, `mousedown`, plus
`touchstart`/`touchend`/`touchcancel` for mobile. Window-level
listeners: `keydown` (Esc, A/D/W/S/arrows, Space), `keyup`, `mouseup`.

JSX renders these screens (controlled by `scr` state):
1. `menu` — title + `BEGIN OPERATION` + `CONTINUE SAVED RUN`.
2. `intro` — canvas (50 s opening cinematic).
3. `management` — resources, soldiers + reserve, barricades, turrets,
   base HP, recruit / barricade / turret / heal / EVAC / expedition /
   deploy buttons. Red banner when `isHumanWaveNumber(gs.wave)`.
4. `siege` — canvas + control row (RETREAT, soldier badges, ADVANCE,
   PAUSE/RESUME, MUTE).
5. `expedition` — pickers (party + 3 rolled destinations) + AUTO-DISPATCH
   / PLAY LIVE / event log / result summary.
6. `mission` — canvas + bottom hint + RETURN TO BASE button.
7. `evac` — canvas (5.4 s helicopter cinematic) + SKIP.
8. `defeat` — canvas (24 s game-over cinematic) + SKIP.
9. `gameover` — stats + TRY AGAIN.

---

## 3. Invariants

The codebase relies on these rules. Breaking any of them is a
regression.

1. **Module dependency direction is strictly top-down**: `constants` →
   `data` → `entities` → `render` / `update` / `expedition` / `audio` →
   `DeadPerimeter.jsx`. No reverse imports, no cycles.
2. **`gs` is mutated in place**. Never replace it; never `Object.assign`
   over it.
3. **React state is for the UI shell**, not for gameplay. Mutation must
   not flow through `setState`.
4. **Override refs are checked BEFORE `gs.phase`** in the loop:
   intro → defeat → evac → mission → siege. Whichever ref is set owns
   the canvas exclusively.
5. **`gs.soundQ` is drained every frame** by `processSounds`. Pushing a
   sound during render is safe but pointless.
6. **Bullet collisions branch on `b.hostile` / `b.spit`**: hostile
   bullets damage party / rescuables / soldiers; spit globs damage
   the same set with green effects; friendly bullets cascade through
   mine → human → zombie checks.
7. **`gs.isHumanWave` is set in `startWave`**, never derived mid-update.
8. **Rooftop sniper** does not respect lane scaling — drawn at
   `(WX-40, GY-160)` at full size.
9. **Soldier states**: `walk | idle | shoot | reload | knife | dead`.
   Dead soldiers stay in `gs.soldiers` forever as memorials.
10. **Lane scaling is on the canvas transform**, not pre-baked into
    sprite coordinates.
11. **Mission lead promotion** is checked at the top of `updateMission`
    every frame and at every damage site. Mission fails only when
    `aliveParty(m).length === 0`.
12. **Cinematic audio loops** (heli, wind, cityHum) MUST be paired —
    every `*Start` event must be followed by a `*Stop` somewhere in the
    same cinematic, or the loop leaks across into siege.
13. **pushRadio cooldown** is per-state. State here is `gs` (siege),
    `m` (mission), `evac`, `defeat`, or `intro`. Mixing them is fine
    because each carries its own `_lastRadioAt`.

---

## 4. Performance & gotchas

- **No sprite caching.** Every entity is drawn from scratch every frame.
  At ~30 entities visible on screen this is well under one ms.
- **`requestAnimationFrame` is throttled** when the tab is backgrounded.
  This effectively pauses the game without an explicit pause. The
  manual pause (Esc) is the safer way.
- **`AudioContext` autoplay policy** forces the engine to be created
  lazily on first user gesture. `getAM()` resumes a suspended context
  automatically.
- **`gs.usedNames` is a `Set`**. Persistence serialises it as an array.
- **Reload triggers a one-shot sound** (`reloadTriggered`) so the reload
  noise plays once.
- **Soldier walk collision** stops at `bar.x ± 13` from a barricade.
- **The mission soldier is a copy** of the siege soldier (via
  `buildMissionSoldier`). Side effects on the original are written back
  only by `finishMission`.
- **Cinematic refs share canvas state.** If one cinematic forgets to
  clean up `ctx.save()` calls, the next one will see a corrupted
  transform. Wrap each scene in `ctx.save()` / `ctx.restore()`.
- **`dSpriteAt` math.** To draw a real sprite at screen `(x, footY)`
  with scale `s`, pre-translate by `(x, footY - GY*s)` then scale, so
  the drawer's internal `translate(s.x, laneY(0))` lands the feet at
  `(x, footY)` exactly. Lane 0 is required (the helper sets it).

---

## 5. Recipes — how to extend

### 5.1 Add a new weapon

1. Add an entry in `data/weapons.js`.
2. Add a polygon sprite branch in `render/weapons.js`.
3. Add it to `RECRUIT_WEAPONS` / `CIVILIAN_WEAPONS` / `VETERAN_WEAPONS`
   in `data/expeditions.js` to make it spawn on the relevant soldier
   kinds.

### 5.2 Add a new zombie type

1. Add an entry in `data/zombies.js`.
2. Add it to `mkWave` in `entities/wave.js` so it spawns in the queue.
3. If it needs unique rendering, branch on `z.type` in `render/zombie.js`.
4. If it's a mission-only enemy (boss / ranged), add the spawn logic in
   `update/mission.js` `mkMission`.

### 5.3 Add a new mission destination

Append to one of `DEST_POOL.{LOW, MED, HIGH}` in `data/expeditions.js`
with `{ name, icon, biome, loot[], desc }`. `rollDestinations()` picks
it up automatically. If you want a new biome, also add an entry to
`BIOMES` in `data/biomes.js`.

### 5.4 Tune difficulty

Edit `data/difficulty.js`. `DIFFICULTY` controls wave generation;
`BALANCE` controls soldier caps, sortie limits, evac math, mission
goal-kill ratio, party reward diminish, and barricade damage
multipliers.

### 5.5 Add a new radio chatter category

1. Append to `RADIO_LINES` in `audio/radio.js`.
2. Call `pushRadio(state, 'newCategory', { speaker })` at the right
   game-state event.
3. Optionally tint the subtitle by adding a branch in
   `dRadioSubtitle` (`render/hud.js`).

### 5.6 Add a new saved field

1. Add the field to `mkGS` in `entities/gameState.js`.
2. Add it to both `saveGame` and `loadGame` in
   `entities/persistence.js`.
3. Bump `STORAGE_KEY` to `-v2` so old saves are discarded gracefully.

### 5.7 Add a new shot to the opening intro

1. Insert a new `{ from, to, draw, banner }` entry into `SHOTS` in
   `render/intro.js` (cumulative ms from intro start, total =
   `INTRO_DURATION`).
2. Write the drawer fn — reuse `dSpriteAt(dSoldier|dZombie, ...)` for
   characters and `centerText()` for any titles (wrap text in
   `ctx.setTransform(1,0,0,1,0,0)` if you want screen-space titles
   under a zoomed scene).
3. Add the banner branch in `dBannerText` if you need a tagline.
4. Add audio cues to `scheduleIntroAudio` via `fireOnce(intro, key,
   condition, evt)`.

### 5.8 Change canvas dimensions

Update `CW, CH, GY, WX` in `constants.js`. Most code reads them by
import; the few places that bake them in (e.g. `LANES[*].dy`) are right
next to the constants.

---

## 6. Where each user-facing feature lives

| Feature | Files |
| --- | --- |
| Lane depth | `constants.js` (LANES), every `render/*.js`, `update/siege.js` |
| Rooftop sniper | `render/soldier.js` (`dRooftopSniper`), `update/siege.js` (onRoof branch) |
| Civilian / veteran / bandit palettes | `render/soldier.js` (flag-driven branches), `entities/soldier.js` |
| Barricades | `entities/barricade.js`, `render/effects.js` (`dBarricade`), `update/siege.js` |
| Turrets | `entities/turret.js`, `render/turret.js`, `update/siege.js` (turret loop) |
| Auto-dispatch | `expedition/auto.js`, `expedition/events.js`, `DeadPerimeter.jsx` (`sendExpedition`) |
| Playable missions | `update/mission.js`, `expedition/missionFinish.js`, `DeadPerimeter.jsx` (`playMission`, `finalizeMission`) |
| Mines / acid pools | `update/mission.js` (`mkMission` hazards, hazard loop, bullet → mine check) |
| Spitter / Brute | `data/zombies.js`, `update/mission.js` (mkMission spawn + spitter AI block) |
| DEFEND objective | `update/mission.js` (objective rolling + ambush spawn + defend tick + sandbag render) |
| Fork (high/low) | `update/mission.js` (fork rolling, lane switch input, pickup lane gate, render) |
| Survivor encounters | `data/expeditions.js` (`TRADE_OFFERS`, `rollEncounter`), `update/mission.js` (humans block, AI loop, trade dialog), `DeadPerimeter.jsx` (`resolveTrade`) |
| Lead promotion | `update/mission.js` (`promoteLeadOnDeath` + top-of-frame guard) |
| Hostile human waves | `data/humans.js`, `entities/{human,wave,gameState}.js`, `render/human.js`, `update/siege.js`, `render/hud.js` (banner) |
| Helicopter EVAC | `render/evac.js`, `DeadPerimeter.jsx` (`callEvac`, `applyEvac`, `skipEvac`, `evacRef`) |
| Opening intro | `render/intro.js`, `DeadPerimeter.jsx` (`newGame` → `introRef`, `finishIntro`) |
| Defeat cinematic | `render/defeat.js`, `DeadPerimeter.jsx` (siege transition → `defeatRef`, `finishDefeat`) |
| Radio chatter + subtitles | `audio/radio.js`, `render/hud.js` (`dRadioSubtitle`), call sites in `update/siege.js` + `update/mission.js` + `DeadPerimeter.jsx` (`moveSquad`) |
| Per-soldier voice pitch | `entities/soldier.js` (`pickVoicePitch`), `audio/radio.js` (speaker handling), `audio/AudioEngine.js` (`radioChatter` numeric pitch support) |
| Reserve roster | `entities/gameState.js` (`reserve` array), `entities/persistence.js`, `DeadPerimeter.jsx` (`benchSoldier`, `activateReserve`) |
| Save / load | `entities/persistence.js`, `DeadPerimeter.jsx` (`continueGame`, autosave hooks) |
| Pause | `DeadPerimeter.jsx` (`togglePause`, Esc handler, render guard, overlay) |
| Mobile touch | `DeadPerimeter.jsx` (`onTouchStart` / `onTouchEnd`) |

---

## 7. Glossary

- **GS** — game state, the single mutable object held in `gsRef.current`.
- **Lane** — depth row; 0 = FRONT (largest sprites), 1 = MID, 2 = BACK.
- **Hostile** — bullets coming **from** humans **toward** soldiers.
- **Spit** — acid globs fired by Spitter zombies; behave like hostile
  bullets but green and arcing.
- **Friendly** — bullets from soldiers / turrets toward zombies / humans.
- **Wave-clear** — moment when `spawnQueue` is empty and no live enemies
  remain; triggers transition to `management` after 3 s.
- **onRoof** — flag on Delta while she's on the rooftop with the sniper
  rifle. Cleared when she descends.
- **isHumanWave** — flag on `gs` toggled true for human-survivor waves.
- **Kind** — soldier classification: recruit / civilian / veteran.
  Drives `maxHp` and weapon pool.
- **voicePitch** — per-soldier deterministic Hz (115 / 140 / 160 / 185
  / 210 / 235) used by `radioChatter`.
- **Encounter** — mid-mission survivor camp (hostile bandits or
  peaceful traders).
- **Activated** (humans) — bandits flagged hostile after the proximity
  check, or refused traders flipped hostile by `resolveTrade('refuse')`.
- **Fork** — high/low lane section in some MED+HIGH missions; switch
  via W/S.
- **Lead** — `m.soldier`, the player-controlled soldier in a playable
  mission. Promoted from a follower if the original lead dies.
- **Override ref** — `introRef / defeatRef / evacRef / missionRef`, any
  of which takes the canvas exclusively when set.
- **Radio chatter** — procedural "tactical voice" SFX paired with a HUD
  subtitle, fired by `pushRadio(state, category, opts)`.
