# Dead Perimeter — Project State

> Canonical handoff for continuing development. Captures the architecture,
> game systems, completed features, known issues, and the pending roadmap.
> Read this together with `src/` before making changes. For module-by-
> module API see [`CODE.md`](./CODE.md); for user-facing setup see
> [`README.md`](./README.md).

---

## 1. Concept

Dead Perimeter is a 2D side-scrolling **zombie siege survival** game. The
player defends **Fort Omega** for **30 waves** against successive zombie
hordes and the occasional hostile-survivor wave. Surviving the final wave
triggers a **three-act playable finale** — push a vaccine sample down
Highway 17, recover it from a besieged hospital, and hold a rooftop LZ
for a helicopter extraction.

Between waves the player:

- **Sends sortie parties** into the ruined city — a 1900 px side-scrolling
  mission with multi-floor buildings, ladders, hazards, survivor
  encounters, searchable loot, and an APC extraction at the end of
  successful DEFEND objectives. Auto-dispatch was retired in favour of
  the playable-only mode.
- **Recruits** new soldiers from saved food + materials, or **rescues
  civilians / lost military soldiers** during sorties (they join the
  reserve bench up to 10 slots).
- **Trades** with peaceful survivor camps encountered mid-mission, or
  refuses and fights them as bandits.
- **Builds barricades** and **mounts machine-gun turrets** via a
  click-to-place flow with valid-range preview.
- **Evacuates** rescued civilians on a procedurally animated UH-60 Black
  Hawk for a resource payout.
- **Benches / activates** soldiers from a reserve roster.
- **Spends materials on the workshop** — a one-shot **Workbench** unlocks
  per-soldier weapon perks; a one-shot **Research Lab** unlocks a research
  queue with global multipliers. The workbench also exposes a crafting
  panel that converts materials into ammo / medicine / sniper rounds /
  turret belts.

The game uses **React + Canvas 2D**. All rendering is procedural via
`CanvasRenderingContext2D`. No external sprite sheets, no audio files —
the soundtrack and every SFX are generated at runtime via Web Audio.
An optional Web Speech TTS layer (`audio/radioVoice.js`) speaks
transmission dialog when the browser supports it.

---

## 2. File layout

Dependency direction is strictly top-down (no cycles):
`constants` → `data` → `entities` → `render` / `update` / `expedition` /
`audio` → `DeadPerimeter.jsx`.

```
src/
├── DeadPerimeter.jsx          React component + game loop
├── App.jsx  main.jsx          Vite + React bootstrap
├── constants.js               CW, CH, WORLD_W, GY, WX, LANES, C, helpers
├── audio/
│   ├── AudioEngine.js         procedural Web Audio engine + processSounds
│   ├── radio.js               RADIO_LINES + pushRadio (tactical chatter)
│   └── radioVoice.js          Web Speech TTS layer for transmission lines
├── data/
│   ├── weapons.js             WPN dictionary
│   ├── zombies.js             ZTP (walker, runner, tank, spitter, brute)
│   ├── humans.js              HTP, HUMAN_AMMO_DROP, wave cadence
│   ├── biomes.js              BIOMES — 6 palettes (3 outdoor + 3 indoor)
│   ├── difficulty.js          DIFFICULTY, BALANCE, CRAFT_RECIPES,
│   │                          RESEARCHES, PERKS + getResearchEffect +
│   │                          getSoldierPerkEffect
│   ├── expeditions.js         DEST_POOL (16 locs), RISK_BASE, TRADE_OFFERS,
│   │                          rollDestinations, RECRUIT_NAMES,
│   │                          RECRUIT/CIVILIAN/VETERAN weapon pools,
│   │                          KIND_HP, objIcons, rollEncounter,
│   │                          MISSION_W, MISSION_VIEW, MGY
│   ├── transmissions.js       TRANSMISSION_WAVES [10,20,25] + per-wave
│   │                          dialog / supply-drop payloads
│   └── vaccineMission.js      VACCINE_SCENARIOS (highway/hospital/rooftop)
├── entities/
│   ├── soldier.js             mkSoldier (kind + voicePitch + upgrades{})
│   ├── zombie.js              mkZombie
│   ├── human.js               mkHuman (hostile)
│   ├── barricade.js           mkBarricade
│   ├── turret.js              mkTurret
│   ├── wave.js                mkWave + mkHumanWave
│   ├── gameState.js           mkGS + recordDeath helper
│   └── persistence.js         hasSavedGame / saveGame / loadGame /
│                              clearSave (v3 format)
├── render/
│   ├── background.js          dBg (with WORLD_W parallax)
│   ├── base.js                dBase — Fort Omega rebuilt
│   ├── weapons.js             dWpn
│   ├── soldier.js             dSoldier + dRooftopSniper
│   ├── zombie.js              dZombie
│   ├── human.js               dHuman (hostile)
│   ├── turret.js              dTurret + placement preview
│   ├── effects.js             dBarricade / dBlt / dFx
│   ├── hud.js                 dHUD + dSquadMarker + dRadioSubtitle
│   ├── evac.js                UH-60 Black Hawk civilian-evac cinematic
│   ├── intro.js               50 s opening cinematic (14 shots)
│   ├── defeat.js              24 s game-over cinematic
│   ├── transmission.js        Wave-10/20/25 full-screen radio overlay
│   │                          with waveform + parachute supply drop
│   └── extraction.js          (legacy) wave-30 convoy cinematic — kept
│                              for stale-save compatibility; superseded
│                              by the playable vaccine campaign
├── update/
│   ├── siege.js               siege tick (`update`) + wave-30 trigger
│   └── mission.js             playable side-scroll mission engine
│                              (platforms, ladders, jump, indoor multi-
│                              segment, vaccine carrier, APC extraction)
└── expedition/
    ├── missionFinish.js       finishMission (live → game state) +
    │                          recordDeath hook
    └── vaccineCampaign.js     mkVaccineCampaign + advanceVaccineScenario
                               + finishVaccineCampaign (4 ending tiers)
```

---

## 3. Core constants

```js
CW = 900, CH = 530        // canvas dimensions
WORLD_W = 1980            // siege world width (camera-scrolled)
GY = 400                  // ground y (front lane)
WX = 162                  // Fort Omega's right edge — base wall position
WEAPON_SCALE = 0.78       // shared weapon-sprite scale

LANES = [
  { dy:   0, sc: 1.00, gshade: '#1d1b11' }, // 0 = FRONT
  { dy: -34, sc: 0.80, gshade: '#171510' }, // 1 = MID
  { dy: -64, sc: 0.64, gshade: '#111008' }, // 2 = BACK
];
```

`laneY(lane) = GY + LANES[lane].dy`, `laneSc(lane) = LANES[lane].sc`.
`clickToLane(canvasY)` returns the lane index from a click Y.
The rooftop sniper is drawn at `(WX-40, GY-160)` at full scale.

The **siege world** is wider than the canvas: `WORLD_W = 1980` while the
visible viewport stays `CW = 900`. `gs.cameraX` is the scroll offset
(arrow keys pan during siege). The mission world is a separate, also-
wider 1900 px sandbox: `MISSION_W = 1900`, `MISSION_VIEW = CW`, `MGY = GY`.

---

## 4. Game state (`mkGS`)

The `gs` object is the single mutable source of truth in `gsRef.current`.

**Core**
- `phase` — siege / management / gameover / victory / vaccine-briefing /
  vaccine-mission / extraction (one of 13 React-shell screens; full list
  in §14).
- `day, wave` — day = wave count, `wave` capped at `BALANCE.maxWaves`.
- `baseHp, baseMaxHp` — wall HP. Boosted by Reinforced Walls research.
- `resources` — `ammo, sniperAmmo, turretAmmo, medicine, food, materials`.

**Rosters**
- `soldiers` — active squad. Cap `BALANCE.maxActiveSoldiers = 6` alive
  non-expedition. Dead soldiers stay in the array as memorials.
- `reserve` — bench, cap `BALANCE.maxReserveSoldiers = 10`. Records of
  `{ name, weapon, civilian, veteran, hp }`. Auto-promoted on wave-clear
  when a squad slot opens.

**Combat / spawn**
- `zombies, humans, barricades, turrets, bullets, effects` — live entities.
- `spawnQueue` — queued spawns sorted by `at` (ms offset from wave start).
- `waveTime, waveClearAt, waveComplete` — wave progression.
- `cameraX` — siege camera scroll within WORLD_W.
- `squadTarget, squadLane, selectedSoldierId` — input state.
- `isHumanWave` — true while the wave is a knifeman/gunman wave.
- `shakeTimer` — screen-shake decay.

**Audio**
- `soundQ` — event queue drained by `processSounds()`.
- `radioMsg` — `{ text, at, dur, category }` for the HUD subtitle.

**Day / story**
- `expeditionsToday, lastEvacWave` — cooldown gates.
- `transmissionsDone, pendingTransmission` — wave-10/20/25 cinematic state.
- `lastFoodReport, lastSupplyDrop` — banner data for the management
  screen.
- `usedNames` — `Set` of recruit names seen so far.

**Workshop progression**
- `workbench: { built }` — gate for the perks panel.
- `researchLab: { built }` — gate for the research queue.
- `research: { activeId, progress, completed }` — ongoing + finished
  research nodes (one active at a time; progress = wave-clears since
  start).

**End-of-run stats** (added with the wave-30 finale)
- `startedAt` — wall-clock at newGame. Reset to `Date.now()` on load.
- `playMs` — cumulative across save/load sessions.
- `soldiersLost, civiliansLost` — death counters, populated by
  `recordDeath(gs, victim)` (`entities/gameState.js`).

---

## 5. Entities

### Soldier (`mkSoldier`)
`mkSoldier(name, weapon, destX, hp?, lane?, civilian?, onRoof?, opts?)`
where `opts = { veteran }`. Stamps `kind` ('recruit' / 'civilian' /
'veteran'), `maxHp` from `KIND_HP` (100 / 70 / 120), a deterministic
`voicePitch` Hz (six tonal steps hashed from name + kind), and an
empty `upgrades: {}` perk map. All gameplay state zeroed.

### Zombie (`mkZombie`)
Spawns at `x = WORLD_W` (siege) — at the world edge, NOT the screen edge,
so they walk a real distance through the camera-scrolled killzone.
Mission zombies are placed directly by `mkMission`.

### Human (`mkHuman`)
Hostile knifeman or gunman, random lane. Drops `[3, 8]` ammo on death.

### Barricade (`mkBarricade`)
3-lane perspective wall, 140 HP. Zombies attack barricades before the
wall behind them. Built via the placement flow (click button → click
valid range in canvas).

### Turret (`mkTurret`)
Machine-gun emplacement. Costs `BALANCE.turretCostMaterials` (25) +
`BALANCE.turretCostAmmo` (20) initial belt. Fires at the closest
in-range enemy, draws from `gs.resources.turretAmmo` (decoupled from
infantry ammo). Click-to-place like barricades.

### Bullet
`{ id, x, y, dx, dy, dmg, life, shooterId? | hostile? | spit? | targetLane? }`.
Tagged so the collision pipeline routes the bullet to the right target
list (zombies / humans / soldiers). Siege bullets travel the full
`WORLD_W`, not just the visible viewport.

### Effect
`blood`, `shell`, `txt`, `hit`, `slash` — short-lived particle records
with `at, dur` gating their lifetime.

---

## 6. Weapons (`WPN`)

`rifle, pistol, shotgun, sniper` — each with `name, dmg, range, rate (ms),
ammo (mag size), rl (reload ms), spd (bullet px/frame), sp (spread
radians), pel (pellet count, shotgun only), ammoCost`.

The sniper's base range was buffed from 220 to **700** (commit `2be7cd4`)
to match its narrative role. The Bipod perk adds another +150.

Soldier weapon pools by kind (see `data/expeditions.js`):
- `RECRUIT_WEAPONS`  = `[rifle, rifle, pistol, pistol, shotgun]`
- `CIVILIAN_WEAPONS` = `[pistol, pistol, pistol, shotgun]`
- `VETERAN_WEAPONS`  = `[rifle, rifle, rifle, shotgun, sniper]`

`KIND_HP = { recruit: 100, civilian: 70, veteran: 120 }`.

Per-shot multipliers (damage, reload time, range) are read via
`getSoldierPerkEffect(sol, key, default)` at fire time, so the perk
panel can mutate combat numerics without touching `WPN`.

---

## 7. Lane / depth system

3 lanes, each with a `dy` (Y offset), `sc` (sprite scale), and `gshade`
(ground strip color). Soldiers, zombies, and humans are all positioned
via `(x, lane)` and rendered via `laneY` + `laneSc` applied on the canvas
transform. Lane order during render: back → mid → front so depth
occlusion reads correctly.

Missions add a **second axis of depth**: `standingY` (Y offset from
`MGY`) for soldiers / zombies standing on platforms or upper floors,
and `forkLane` (0 = low road, 1 = high road) for fork-section pickups.

---

## 8. Soldier selection / movement

Click on a soldier to select (highlight ring). Click empty space to move
the selected soldier (or the whole squad if nothing selected) to that
target lane + x. Buttons in the management screen also let you select via
the soldier-card row.

ADVANCE / RETREAT shift the squad target by ±80 px in the active lane,
and fire a radio chatter callout in the selected soldier's voice
("Moving up!" / "Falling back!").

Arrow keys pan the siege camera across the wider WORLD_W when no soldier
is selected.

---

## 9. The rooftop sniper (Delta)

Delta starts on the rooftop at `(WX-40, GY-160)`. She has her own
`sniperAmmo` resource pool and her own renderer (`dRooftopSniper`).
She targets the furthest visible enemy and fires through-and-over the
wall at her current range (base 700, +150 with the Bipod perk, +X% with
the Marksmanship research). When `sniperAmmo === 0` she climbs down to
the ground at the start of the next wave; she climbs back up on wave
clear if the pool is replenished.

---

## 10. Audio

`AudioEngine` is lazy-created on first `getAM()` so we never violate
browser autoplay policy. The siege loop pushes events onto `gs.soundQ`
and once per frame `processSounds()` drains the queue.

### SFX library (procedural)
`shot`, `reload`, `shell`, `hit`, `zdie`, `groan`, `zatk`, `bhit`,
`wclr`, `heliStart` / `heliStop`, `siren`, `scream`, `crackle`,
`windStart` / `windStop`, `cityHum` / `cityHumStop`, `titleSting`,
`chatter`, `chuteRustle` (transmission supply drops).

### Radio chatter (`audio/radio.js`)
`pushRadio(state, category, opts)` picks a line from `RADIO_LINES`,
hashes the text → stable pitch (or uses `opts.speaker.voicePitch`), and
schedules a procedural buzz through vowel-formant bandpass filters
bracketed by radio-click noise bursts. A subtitle is stored on
`state.radioMsg` for `dRadioSubtitle` to render. Categories: `advance`,
`retreat`, `reload`, `hurt`, `kill`, `evacIn` / `evacBoard` / `evacOut`,
`deploy`, `lowAmmo`, `baseHit`, `defeat`. Per-state cooldown 1.3 s.

### Web Speech TTS (`audio/radioVoice.js`)
Optional layer that speaks transmission dialog (wave 10/20/25 cinematics
and the vaccine briefing) when `window.speechSynthesis` is available.
Wraps each line in a low-pass + bandpass "comms envelope" so the
synthesised speech matches the procedural radio chatter aesthetic. The
player toggles it via the 🗣 / 🚫 button in the HUD.

---

## 11. Workshop & progression

Both gates are one-shot builds spending materials. Once built the panel
becomes interactive in the management screen.

### Workbench (🔨 — 30 materials)
Unlocks two sub-panels:

- **Crafting** — `CRAFT_RECIPES` (`data/difficulty.js`): convert materials
  into Rifle Mag (4 → 30 ammo), Pistol Mag (2 → 15 ammo), Sniper Box
  (8 → 5 sniperAmmo), Turret Belt (3 → 15 turretAmmo), First Aid
  (6 → 3 medicine). The `improvedMags` research multiplies every output
  by 1.5×.
- **Per-soldier perks** — `PERKS`: seven one-shot upgrades owned per
  soldier (`gs.soldiers[i].upgrades[perkId] = true`), persisted across
  saves. Perks gate by `weapons: 'all' | ['rifle', …]`. Combat effects
  are read via `getSoldierPerkEffect(sol, key, default)` from
  `siege.js` at fire / reload time.

| Perk | Cost | Weapons | Effect |
| --- | --- | --- | --- |
| Ballistic Vest 🦺 | 20 mat | all | +30 max HP, patches up |
| Extended Mag 📦 | 12 mat | rifle, pistol | +10 rounds per mag |
| Heavy Barrel ⚙ | 18 mat | rifle | +25 % damage |
| Hollow Points 🔴 | 14 mat | pistol | +30 % damage |
| Bipod 🦿 | 20 mat + 3 sniperAmmo | sniper | +150 range |
| Match Ammo 🎯 | 18 mat + 5 sniperAmmo | sniper | +40 % damage |
| Quick Reload ⚡ | 15 mat | all | −25 % reload time |

### Research Lab (🧪 — 50 materials + 5 medicine)
Unlocks the research queue. `RESEARCHES`: seven nodes, **one active at a
time**, progress ticks one per wave-clear. Cost is deducted on START.
Effects are global, applied via `getResearchEffect(gs, key, default)`
in the relevant call sites.

| Node | Cost | Waves | Effect |
| --- | --- | --- | --- |
| Improved Magazines | 20 mat | 3 | craft outputs × 1.5 |
| Reinforced Walls | 25 mat + 3 med | 4 | wall +50 max HP, repair +20 |
| Combat Drills | 15 mat + 10 food | 5 | soldier damage × 1.20 |
| Field Medicine | 18 mat + 6 med | 4 | heal +50 % HP per medicine |
| AP Rounds | 22 mat | 5 | bullet damage × 1.15 vs all |
| Marksmanship | 16 mat | 4 | sniper range +120, damage × 1.10 |
| Reload Drills | 12 mat + 6 food | 3 | reload time × 0.85 |

Completed research IDs live in `gs.research.completed` (string array,
persisted).

---

## 12. Expedition system

### Sortie limit
`BALANCE.expeditionsPerDay = 2`. Counter resets on wave-clear.
`BALANCE.maxExpeditionParty = 3` — pick up to three soldiers per sortie.

### Location pool (`data/expeditions.js`)
`DEST_POOL.{LOW, MED, HIGH}` lists **16 city locations**. `rollDestinations()`
picks one location per risk tier — re-rolled on every fresh sortie session.
Each location carries a `biome`, `loot[]` table, and `desc`.

**LOW** (5): Pharmacy, Supermarket, Hardware Store, Convenience Store, Diner.
**MED** (6): Police Station ⟂ (indoor), Residential Block, Gun Shop ⟂
(indoor), School Shelter, Gas Station, Clinic.
**HIGH** (5): Central Hospital, Office Tower ⟂ (indoor), Shopping Mall,
Precinct HQ, Industrial Depot.

`⟂` = indoor biome (`police_interior` / `armory_interior` /
`office_interior`). When the destination's biome is `*_interior`, the
mission generates an **outdoor → indoor multi-segment** map: the lead
walks the front segment, crosses an `entranceX` boundary, then continues
inside a real building interior with stairs, multiple floors, and
indoor-specific props.

### Mission engine (`update/mission.js`)
1900 px world. Lead soldier is player-controlled; followers AI-shoot in
range and switch to knife on dry magazine. Key systems:

- **Pre-mission magazine loadout** — the player picks 1-4 magazines per
  soldier on the expedition screen. Each mag is drawn from `gs.resources`
  at deploy; mission ammo is **finite**. The "RELOAD" UI is gated by the
  `magsLeft` count carried into the mission.
- **Platforms + ladders + multi-floor buildings** — second-floor
  interiors are real walkable surfaces. `W`/`↑` climb / go up stairs,
  `S`/`↓` descend, `Space` jumps onto adjacent platforms. Bullets and
  zombies respect Y-level: a soldier on the second floor can shoot down,
  and zombies will climb ladders to reach a kill.
- **Jump ability** — short forward leap when grounded. Useful for
  hopping over mines or onto low ledges.
- **Auto-knife when dry** — soldiers automatically switch to knife
  attacks once their mag count hits zero (no infinite reloads).
- **Searchable loot containers** — lockers, ammo crates, glass cases,
  workbenches, photocopiers, water coolers, etc. Hold proximity for ~700 ms
  to extract loot. Container type drives the loot table.
- **Hazards** — mines (shootable, AoE 40 px, hp 1) + acid pools (slow
  50 %, 2 dmg per tick).
- **Zombies** — walker / runner / tank / spitter / brute. Spitter is
  gated to `wave >= 5` and scales damage + fire rate with wave.
- **Brute boss** at the end of HIGH-risk missions: 600 HP, 1.7× scale.
  Spawned automatically on HIGH-risk dests; also scripted on the
  wave-30 rooftop scenario.
- **Pickups**: per-biome loot table + civilian (rescue, +HP) +
  lostSoldier (rescue, veteran recruit) + **vaccine** (wave-30 hospital).
- **Rescuables**: civilians along the path the player can lead back to
  the goal zone.
- **Survivor encounters** (MED 28 %, HIGH 40 %):
  - **Hostile** bandits — immediate firefight. Bandits carry civilian
    weapons, damage × 0.55, rate × 1.6 slower, spread × 2.2 wider.
  - **Trader** camp — dialog with `✓ ACCEPT` / `✖ REFUSE`. Accept swaps
    resources from `gs.resources` against `m.collected`. Refuse turns
    every camper hostile.
  - Zombies attack activated humans too. The encounter zone (220 px
    around the camp) is cleared of zombies at spawn AND on player
    approach so the player fights one faction at a time.
- **DEFEND objective**: reach a sandbag emplacement at `MISSION_W * 0.45`,
  then hold for 45 s (75 s on the wave-30 rooftop). A scripted ambush of
  3-6 zombies is pre-placed past the anchor. When the hold ends, an
  **APC extraction** rolls in from the Fort Omega side, soldiers
  board, then it drives back across the map — the mission only flips
  to `won` after the convoy has cleared the screen.
- **Fork sections** (50 % chance on MED+HIGH non-DEFEND, non-vaccine
  missions): high and low lanes between 40 % and 62 % of the map with
  exclusive pickup clusters. Switch lanes with W / S.
- **Lead promotion**: if the player avatar dies, the first living
  follower is promoted to lead. Mission only fails when the whole party
  is dead. New lead's name is announced via a radio callout.
- **Goal kill-ratio gate**: the goal beacon only unlocks once the
  player has killed at least `BALANCE.missionGoalKillRatio` (~45 %) of
  activated enemies.

### Civilians and reserve
Rescued civilians go to `gs.reserve`. The `🚁 EVAC` button (cooldown
`BALANCE.evacWaveCooldown = 3` waves, min `BALANCE.evacMinReserve = 3`
reserve civilians) flies them out via the procedural helicopter cinematic
for a resource payout (`BALANCE.evac*PerCiv` constants).

### Sortie food cost
Every returning party member eats `BALANCE.sortieFoodCostPerSoldier = 3`
food on return — stamped on the result so the post-mission log can
surface the deduction.

---

## 13. Wave-30 vaccine campaign

The structural endgame. Triggered automatically when wave 30 is cleared:
`update/siege.js` flips `gs.phase` to `'vaccine-briefing'` instead of the
old `'extraction'`. The chain:

```
wave 30 cleared
    │
    ▼
vaccine-briefing screen
  (Central Command transmission text + party headcount + DEPLOY button)
    │  DEPLOY
    ▼
mkVaccineCampaign (expedition/vaccineCampaign.js)
  - Promotes every reserve member to a real soldier for the campaign
  - Issues 3 magazines per soldier from the stash
  - Builds scenario 0 (Highway 17) via mkMission with the vaccine flag
    │
    ▼
Scenario 0 — Highway 17 (MED, downtown biome, reach objective)
    │  state === 'won' → advanceVaccineScenario writes HP/ammo back,
    │                    builds scenario 1 with survivors only
    ▼
Scenario 1 — Central Hospital (HIGH, hospital biome, reach objective)
  - Spawns one guaranteed 'vaccine' pickup at MISSION_W - 180
  - First party member to touch it becomes the carrier
  - Vial renders above their head; on death the vial drops as a fresh
    pickup that any teammate can recover
    │  state === 'won' → vaccine state carries to next scenario
    ▼
Scenario 2 — Rooftop Evac (HIGH, office_interior biome, DEFEND 75 s)
  - At 32 s into the hold, a Brute spawns with "BRUTE INBOUND" callout
  - APC extraction (the existing defend-mode chopper-substitute) at
    the end of the hold
    │  state === 'won' → finishVaccineCampaign
    ▼
Tier resolution
  gold:    vaccine delivered + ≥4 survivors
  silver:  vaccine delivered + 1-3 survivors
  bronze:  ≥2 scenarios cleared but vaccine lost / dropped on a body
  failure: party wiped before scenario 2 completed
    │
    ▼
Victory screen — tier-specific emoji / header / blurb / stats grid
```

Total party wipe at any point still routes to the victory screen with
the `failure` tier — Fort Omega did NOT fall in this branch (the wall
held for 30 waves), only the convoy didn't make it. That's why we don't
use the "FORT OMEGA FALLEN" gameover panel here.

The vaccine-carrier mechanic and the rooftop boss spawn live inside
`update/mission.js` (gated on `m._vaccineCampaign` + `m._vaccineIndex`
flags), so the regular expedition path is untouched.

---

## 14. Cinematics

All cinematics share the same pattern: a ref state (`introRef`,
`defeatRef`, `evacRef`, `transmissionRef`, `extractionRef`) is set,
`scr` is switched to the cinematic name, and the render loop checks
these refs BEFORE any gameplay branch. Each cinematic owns its own
audio queue.

### Opening intro (`render/intro.js`)
50 s, 14 storyboarded shots: café drinker, quiet street, zombie bite,
family fleeing, street chaos, cop firing, police line collapse, cop
dragged, last defender, street dead, convoy wide, convoy close, soldier
aiming, fort wide (closing shot with full squad deployed on the ground
and zombies approaching from the horizon). Reuses real `dSoldier` and
`dZombie` renderers via `dSpriteAt` so cinematic characters are visually
identical to gameplay sprites.

### Intermediate transmissions (`render/transmission.js`)
Triggered at waves **10, 20, 25** via `gs.pendingTransmission` set by
`siege.js` after the wave clears. Full-screen "INCOMING TRANSMISSION"
panel with header (`CENTRAL COMMAND` callsign), waveform animation
driven by audio amplitude, scripted dialog lines (each with `at`,
`speaker`, `pitch` for the TTS layer). Last few seconds animate a
parachuted supply crate landing on the perimeter; `finishTransmission`
applies the payload to `gs.resources`.

| Wave | Title | Supply drop |
| --- | --- | --- |
| 10 | "We need that sample." | ammo 60, food 30, med 8, mat 15, sniper 5 |
| 20 | (situation update) | tuned payload, see `data/transmissions.js` |
| 25 | (final brief) | tuned payload |

### Game-over defeat (`render/defeat.js`)
24 s, 4 phases (breach / overrun / lastStand / silence). Defenders fall
on a scripted timeline; killers are attached to each defender. Alpha
makes a last stand and switches to knife when his ammo runs out. Per-
defender voice lines fire at each `hurtAt`.

### Helicopter EVAC (`render/evac.js`)
5.4 s, 3 phases (inbound / boarding / departing) — UH-60 Black Hawk
silhouette, civilians ascend rope ladder to the cargo door, departure
with engine glow + wheels-up callout. Loops rotor SFX + wind. Civilians
removed from `gs.reserve` and resources granted at the end (or on SKIP).

### Wave-30 extraction (legacy)
`render/extraction.js` — short convoy cinematic kept on the codepath
only to handle stale saves whose `gs.phase` was already `'extraction'`
before the playable vaccine campaign shipped. New runs go straight to
the playable campaign and never visit this code.

---

## 15. Barricades + turrets + placement

Built from `gs.resources.materials`. Barricades span all 3 lanes as a
single 140-HP perspective wall. Turrets are emplaced at a single x +
lane and fire at the closest in-range enemy using `turretAmmo`.

**Click-to-place flow**: clicking the build button (`🧱 BARRICADE` /
`🔫 TURRET`) sets `placementRef.current = { kind, validRange, mouseWorldX }`
and switches the canvas cursor + renders a green/red ghost preview at
the cursor X. Clicking inside the valid range commits the build and
deducts cost; clicking outside (or pressing `Esc`) cancels.

`BALANCE.maxBarricades = 4`, `BALANCE.maxTurrets = 2`.

---

## 16. Game loop architecture

Inside the `useEffect` in `DeadPerimeter.jsx`:

```js
const loop = now => {
  const dt = Math.min(now - prevT.current, 50); prevT.current = now;
  const gs = gsRef.current;

  // Cinematic overrides — owned by their refs, drawn before anything else.
  // Order = priority: whichever fires first owns the canvas exclusively.
  if (introRef.current)       { drawIntro;        if (over) finishIntro();       return; }
  if (defeatRef.current)      { drawDefeat;       if (over) finishDefeat();      return; }
  if (evacRef.current)        { drawEvac;         if (over) applyEvac();         return; }
  if (transmissionRef.current){ drawTransmission; if (over) finishTransmission();return; }
  if (extractionRef.current)  { drawExtraction;   if (over) finishExtraction();  return; }

  // Mission override
  const m = missionRef.current;
  if (m) { updateMission(m, now, dt) + dMissionWorld + dMissionHUD; return; }

  // Siege
  if (gs && gs.phase === 'siege') {
    if (!pausedRef.current) { update(gs, now, dt); processSounds(gs.soundQ, ...); }
    if (gs.phase !== 'siege') routePhaseTransition();   // gameover / management /
                                                        // vaccine-briefing / etc.
    else dSiegeScene(ctx, gs, now);
  }
  rafId.current = requestAnimationFrame(loop);
};
```

UI snapshots happen every 250 ms (`Math.floor(now/250)`) to avoid 60 fps
React reconciliation.

**Screen (`scr`) values** seen across the React shell (13 distinct):
`menu`, `intro`, `management`, `siege`, `placement`, `mission`,
`expedition`, `evac`, `transmission`, `extraction`, `vaccine-briefing`,
`defeat`, `gameover`, `victory`.

---

## 17. Versions changelog

| Version | Major changes |
|---------|---------------|
| V1–V4   | Base game, lanes, barricades, expeditions, civilians, rooftop sniper. |
| V5–V7   | Per-soldier selection, `sniperAmmo` resource, mission pickups for sniper ammo, Delta climb-back. |
| V8      | Refactored rooftop sniper into a separate `dRooftopSniper` renderer. |
| V8-Modular | Single file split into ~25 modules. Hostile human survivor waves shipped. |
| V8-Modular Polish | Pause / save / touch / configurable difficulty curve. |
| V9 (last doc snapshot) | Multi-soldier playable missions with AI followers, mines, acid pools, Spitter, Brute boss, DEFEND objective, fork sections, 16 destinations, survivor encounters, reserve roster + helicopter EVAC, turrets, intro + defeat cinematics, radio chatter. |
| **Review pass** | Tactical siege HUD (radar, wall bar, hostiles left, off-screen indicator), 2× fast-forward on a siege sim clock (`gs.simNow`), 1–9 soldier hotkeys, progressive wall damage art. Missions: perks + research now apply (`missionModifiers`), Esc pause on a mission sim clock (`m.simNow`), Brute must die before extraction, strafe-fire, rebuilt HUD (route bar, party panel, mags, boss bar). Fixes: `mkSnap` scope (post-transmission UI + workshop vanishing after waves), recruit cap, human spawn at world edge, vaccine legs no longer refill mags, rescued civilians use civilian kit, sortie kills count, victory clears save, lint clean. New title screen + wave intel line. |
| **Current** | Wave-30 cap with playable **vaccine delivery finale** (3 scenarios + carrier mechanic + boss + 4 ending tiers). Wave-10/20/25 **Central Command transmission cinematics** with parachuted supply drops + optional Web Speech TTS. **Workshop progression** — workbench (per-soldier perks + crafting) + research lab (global multipliers). **Multi-floor mission interiors** with platforms, ladders, jump ability, indoor multi-segment maps, searchable loot containers, APC extraction after defend. **Wider siege world** (WORLD_W 1980) with camera scroll + click-to-place barricades / turrets. Pre-mission magazine loadout — finite ammo. Auto-dispatch retired (consolidated on playable). Daily food consumption + wall repair. End-of-run stats (play time + soldiers/civilians lost). Save format v3. Sniper range 220 → 700. |

---

## 18. Known issues / quirks

- Switching tabs throttles `requestAnimationFrame` so the game pauses
  automatically; `Esc` is still the preferred pause.
- `selectedSoldierId` is not cleared when returning from a mission. Usually
  fine because the selected soldier was the one on the mission.
- The opening cinematic only plays on `BEGIN OPERATION` (new game), not on
  `CONTINUE SAVED RUN` — by design.
- The defeat cinematic plays on every game-over, including after
  `TRY AGAIN`. Skippable.
- Save format jumps from v1 → v2 → v3 silently discard incompatible
  saves. Stale-save players will land on the menu with no `CONTINUE`
  button instead of a crash.
- The legacy `render/extraction.js` cinematic is still imported even
  though the playable vaccine campaign supersedes it; it would only
  fire on a stale save whose `gs.phase === 'extraction'`. Safe to
  delete in a future commit once we're confident no save in the wild
  still has that phase.

---

## 19. Pending features (roadmap)

### ✅ Shipped (current cycle additions on top of V9)

- Wave-30 playable **vaccine delivery finale** — three sequential
  scenarios (highway / hospital / rooftop), vaccine-carrier mechanic
  with drop-on-death recovery, scripted Brute boss, four ending tiers
  (gold / silver / bronze / failure).
- Wave-10/20/25 **Central Command transmission cinematics** with
  parachuted supply drops + optional Web Speech TTS for dialog.
- **Workshop progression**: workbench unlocks per-soldier weapon perks
  + crafting; research lab unlocks the research queue with global
  multipliers.
- **Multi-floor mission interiors**: platforms, ladders, jump ability,
  Y-level combat (zombies climb ladders), outdoor → indoor multi-
  segment missions, searchable loot containers, APC extraction after
  DEFEND.
- **Pre-mission magazine loadout** (1-4 mags). Finite mission ammo,
  auto-knife when dry.
- **Three indoor destinations** (Police Station, Gun Shop, Office Tower)
  with their own interior biomes.
- **Wider siege world** (WORLD_W 1980) with camera scroll and click-to-
  place for barricades + turrets.
- **End-of-run stats** — play time (cumulative across save/load),
  soldiers lost, civilians lost.
- **Wall repair** + daily food consumption + 30-wave structural cap.
- **Sniper range buff** 220 → 700.
- **Auto-dispatch retired** — every sortie is now played live.

### Previously shipped (still in)

- Hostile human survivor waves (knifemen + gunmen + ammo drops)
- Pause / resume with `Esc`
- Save / load to `localStorage` (v3)
- Mobile touch controls
- Multi-soldier playable expeditions with AI followers
- Day-limit on sorties + lead-down promotion
- Helicopter civilian evac animation
- Roster bench / activate (reserve up to 10)
- Machine-gun turrets with dedicated ammo pool
- Per-destination biomes (6 palettes) + randomised mission layout
- Mines + acid pools + Spitter + Brute boss
- Rescuable civilians along mission paths
- DEFEND objective + sandbag emplacement
- Branching mission paths (high / low lanes via W/S)
- Soldier kinds: recruit / civilian (70 HP, pistol-only) / veteran (120 HP)
- Lost-soldier rescue pickup (rare veteran find)
- Survivor encounters: hostile bandits + trader dialog
- Zombies attack activated humans
- Opening cinematic (50 s, 14 shots, procedural audio)
- Defeat cinematic (24 s, 4 phases)
- Tactical-radio chatter with per-soldier voicePitch + HUD subtitles
- Fort Omega base art (watchtower, sandbags, concertina, gate,
  floodlights, insignia, loopholes, battle damage)

### ⏳ Optional / nice-to-have

- Real audio samples to replace the procedural engine (clean swap in
  `audio/AudioEngine.js`).
- Sprite caching (offscreen canvas per entity type) — not needed at
  current entity counts.
- Delete `render/extraction.js` once we drop support for v3 saves stuck
  in `phase = 'extraction'`.

---

## 20. Architectural decisions worth preserving

1. **Game state in a single object**, mutated in place. React only sees
   periodic snapshots via `setUi`.
2. **`gsRef.current`** holds the mutable state; the canvas reads from it.
3. **Cinematic and mission override refs are checked BEFORE `gs.phase`**
   in the loop. Each override owns the canvas fully when active. Order
   matters: intro → defeat → evac → transmission → extraction → mission
   → siege.
4. **Refs for inputs and expedition selections**, not React state, to avoid
   stale closures in `useCallback`.
5. **Lane scaling is applied on the canvas transform**, not pre-baked into
   sprite coordinates. Y-level (`standingY`) is a separate offset for
   multi-floor interiors.
6. **Audio uses a per-frame queue** (`gs.soundQ` / `m.soundQ` / etc.)
   drained at the end of `update`.
7. **No cycles between modules**: `constants` → `data` → `entities` →
   `render`/`update`/`expedition`/`audio` → `DeadPerimeter.jsx`.
8. **Cinematic sprites reuse the live-game renderers**: intro/defeat
   call `dSoldier` / `dZombie` directly via `dSpriteAt(drawFn, ctx,
   entity, screenX, screenFootY, scale, now)` so cinematics stay
   visually consistent with gameplay.
9. **Vaccine campaign reuses mkMission**: the wave-30 finale is just
   three sequentially-played expeditions with a flag (`m._vaccineCampaign`,
   `m._vaccineIndex`, `m._vaccineSegment`). No parallel mission engine.
10. **Death tracking is centralised** in `recordDeath(gs, victim)`. Every
    site that flips a soldier to `state = 'dead'` calls this helper
    so the soldiers-vs-civilians split lives in one place.

---

## 21. Quick file map

- `src/audio/{AudioEngine,radio,radioVoice}.js` — engine, chatter, TTS.
- `src/constants.js` — `CW, CH, WORLD_W, GY, WX, LANES, C, laneY, laneSc, clickToLane, uid, rng, WEAPON_SCALE`.
- `src/data/{weapons,zombies,humans,biomes,difficulty,expeditions,transmissions,vaccineMission}.js` — static config.
- `src/entities/{soldier,zombie,human,barricade,turret,wave,gameState,persistence}.js` — factories + storage. `gameState.js` exports `recordDeath`.
- `src/render/*` — every `dXxx` draw function. `intro.js`, `defeat.js`,
  `evac.js`, `transmission.js`, `extraction.js` are full cinematics.
- `src/update/siege.js` — main siege tick (`update`) + wave-30 phase trigger.
- `src/update/mission.js` — `mkMission`, `updateMission`, mission draw
  functions, platforms / ladders / jump / vaccine-carrier / APC logic.
- `src/expedition/{missionFinish,vaccineCampaign}.js` — mission writeback,
  vaccine campaign factory + advance + finalize.
- `src/DeadPerimeter.jsx` — React component, hooks, callbacks, every
  screen panel including `vaccine-briefing` and the tiered victory panel.

---

## 22. How to run

See [`README.md`](./README.md) for install + launch instructions. TL;DR:

```bash
node -v          # must be >= 20
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```
