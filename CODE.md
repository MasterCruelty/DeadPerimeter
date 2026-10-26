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
│   ┌────────────── React tree ──────────────────────┐                 │
│   │ DeadPerimeter.jsx                              │                 │
│   │   useState: scr, ui, muted, paused, voiceOn,   │  snapshots      │
│   │             hasSave, expSoldierIdxs, expDests, │◄── every 250 ms │
│   │             expResult, expPhase, magsPerSoldier│    via setUi()  │
│   │                                                │                 │
│   │   useRef:  cvs, gsRef, rafId, prevT, mutedR,   │                 │
│   │            pausedRef, missionRef, evacRef,     │                 │
│   │            introRef, defeatRef, transmissionRef│                 │
│   │            extractionRef, vaccineRef,          │                 │
│   │            vaccineResultRef, placementRef,     │                 │
│   │            inputRef, expSolsRef, expDstRef,    │                 │
│   │            expDestsRef, magsRef                │                 │
│   │                                                │                 │
│   │   ┌──── requestAnimationFrame loop ─────┐      │                 │
│   │   │  override refs first (in order)     │      │                 │
│   │   │  then update(gs) + processSounds    │      │                 │
│   │   │  then draw layers                   │      │                 │
│   │   └─────────────────────────────────────┘      │                 │
│   └──┬─────────────────────────────────────────────┘                 │
│      │ mutates                                                       │
│      ▼                                                               │
│   ┌────────────── gsRef.current ──────────────────────┐              │
│   │ phase, day, wave, baseHp, baseMaxHp,              │              │
│   │ resources, soldiers (with upgrades), reserve,     │              │
│   │ zombies, humans, barricades, turrets,             │              │
│   │ bullets, effects, soundQ, isHumanWave,            │              │
│   │ radioMsg, cameraX, expeditionsToday,              │              │
│   │ transmissionsDone, pendingTransmission,           │              │
│   │ workbench, researchLab, research,                 │              │
│   │ startedAt, playMs, soldiersLost, civiliansLost …  │              │
│   └───────────────────────────────────────────────────┘              │
│                                                                      │
│   ┌─── localStorage (entities/persistence.js) ───┐                   │
│   │ key: "dead-perimeter-save-v3"                │                   │
│   │ saved on management entry, recruit, build,   │                   │
│   │ heal, bench / activate, EVAC, scenario       │                   │
│   │ advance. Cleared on game-over / victory.     │                   │
│   └──────────────────────────────────────────────┘                   │
│                                                                      │
│   ┌─── Web Audio (audio/AudioEngine.js, lazy) ───┐                   │
│   │ master → fx + bg; per-frame queues drained   │                   │
│   │ by processSounds(); radioChatter + heli loop │                   │
│   │ + wind / cityHum loops managed from gs.      │                   │
│   │ Optional: radioVoice.js → SpeechSynthesis    │                   │
│   │ for transmission dialog (toggled by 🗣).     │                   │
│   └──────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.1 Data flow per frame

```
RAF tick (now, dt)
   │
   ├── introRef.current ?        ──► dIntroScene        + processSounds  ─► return
   ├── defeatRef.current ?       ──► dDefeatScene       + processSounds  ─► return
   ├── evacRef.current ?         ──► dEvacScene         + processSounds  ─► return
   ├── transmissionRef.current ? ──► dTransmissionScene + processSounds  ─► return
   ├── extractionRef.current ?   ──► dExtractionScene   + processSounds  ─► return
   ├── missionRef.current ?      ──► updateMission      + dMission*      ─► return
   │
   ├── gs.phase === 'siege' ?
   │     │
   │     ├── pausedRef.current ?  ──► skip update & sounds (still render)
   │     │
   │     ├── update(gs, now, dt)
   │     │     ├── drain spawnQueue → push to gs.zombies | gs.humans (at WORLD_W edge)
   │     │     ├── tick zombies (walk → attack)
   │     │     ├── tick humans  (walk → attack; gunmen → bullets)
   │     │     ├── tick soldiers (incl. rooftop sniper, ground melee)
   │     │     ├── tick turrets (fire at closest enemy in range)
   │     │     ├── advance bullets across full WORLD_W (no viewport cull)
   │     │     ├── apply perk effects via getSoldierPerkEffect at fire time
   │     │     ├── apply research multipliers via getResearchEffect
   │     │     ├── hurtCallout + maybeKillChatter (radio events)
   │     │     ├── auto-promote reserve when active count < cap
   │     │     ├── garbage-collect dead bodies / effects
   │     │     ├── decide wave clear:
   │     │     │     ├── apply daily food consumption + report
   │     │     │     ├── apply per-wave research progress tick
   │     │     │     ├── apply wave-clear ammo bonus
   │     │     │     ├── if wave 10/20/25 → set gs.pendingTransmission
   │     │     │     ├── if wave > maxWaves → phase = 'vaccine-briefing'
   │     │     │     ├── else → phase = 'management'
   │     │     ├── starvation damage if food = 0
   │     │     ├── click-to-place dispatch (placementRef → barricade / turret)
   │     │     └── push sound events to gs.soundQ
   │     │
   │     ├── processSounds(gs.soundQ, audio, mutedRef)  ── drains queue
   │     │
   │     ├── phase transition?
   │     │     ├── management   → saveGame(gs) + setScr('management')
   │     │     ├── gameover     → clearSave() + start defeat cinematic
   │     │     ├── vaccine-briefing → setScr('vaccine-briefing')
   │     │     ├── (legacy) extraction → mkExtraction + setScr('extraction')
   │     │     └── otherwise    → setScr(gs.phase)
   │     │
   │     └── draw: dBg → dBase → (per lane back→front) zombies → humans
   │              → soldiers → barricades → turrets → effects → bullets
   │              → placement ghost (if active) → dSquadMarker → dHUD →
   │              dRadioSubtitle → pause overlay
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
| `evacRef` | `callEvac()` from management | `applyEvac()` (SKIP or natural end) | 5.4 s | Helicopter civilian evac |
| `transmissionRef` | siege loop on `gs.pendingTransmission` (waves 10 / 20 / 25) | `finishTransmission()` | ~14-21 s | Central Command radio overlay + supply drop |
| `extractionRef` | (legacy) siege loop on `gs.phase === 'extraction'` for stale saves | `finishExtraction()` | ~22 s | Old wave-30 convoy cinematic |
| `missionRef` | `playMission()` from expedition or `startVaccineMission()` from briefing | `finalizeMission()` / `advanceOrFinishVaccine()` | until win/loss | Playable side-scroll mission |

Vaccine state is held separately on `vaccineRef` (the campaign object,
holding all three scenarios and the shared carrier state) and
`vaccineResultRef` (the final tier object for the victory screen). The
active scenario is what `missionRef` points to during a vaccine campaign.

Each ref-state holds a `soundQ`, a `startedAt`, and (for some) a `_fired`
Set for fire-once audio events.

### 1.3 Persistence model

We save **between waves**, never mid-wave. The serialised shape
(`entities/persistence.js`) covers exactly the durable management-screen
state. Save format version is bumped whenever the shape changes; older
versions are silently discarded (the menu just shows no `CONTINUE`
button).

**Format history**
- **v1** — base game state.
- **v2** — added workshop fields (`workbench`, `researchLab`, `research`).
- **v3 (current)** — added per-soldier `upgrades` map + end-of-run stats
  (`playMs`, `soldiersLost`, `civiliansLost`).

**Persisted fields (v3)**
`day, wave, baseHp, baseMaxHp, resources, soldiers (with upgrades, kind,
veteran, civilian, volunteer, onRoof, hp, maxHp, ammo, maxAmmo, weapon, lane, x,
destX, facing, state, name, id, lookId), barricades, turrets, score, kills,
reserve (name/weapon/civilian/veteran/volunteer/lookId/hp), expeditionsToday,
lastEvacWave, lastFoodReport, transmissionsDone, lastSupplyDrop, lastConvoy,
usedNames (serialised as Array), workbench, researchLab, research,
playMs, soldiersLost, civiliansLost, savedAt, v.`

Saves happen automatically on: wave clear (entering `management`),
recruit, barricade built, turret built, soldier healed, soldier
benched / activated, EVAC completed. Saves are cleared on `gameover`
and on `NEW GAME` button. Loaded games **skip the intro cinematic**.

`gs.playMs` rolls the live session delta into the persisted total at
save time, and `gs.startedAt` resets to `Date.now()` on load so the
next session starts a fresh delta.

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

`audio/radioVoice.js` is the optional Web Speech TTS layer used by the
transmission cinematics. It wraps each `SpeechSynthesisUtterance` in a
low-pass + bandpass "comms envelope" via a `MediaStreamDestination` →
`AudioContext` chain so the synthesised speech matches the procedural
radio aesthetic. Falls back to silent if `window.speechSynthesis` is
unavailable. Controlled by a 🗣 / 🚫 button in the HUD.

---

## 2. Module reference

Every module is listed below with its inputs, outputs, and notable
behavior. Files are grouped by directory.

### 2.1 `src/constants.js`

Pure data + helpers. No imports of other game modules.

| Export | Purpose |
| --- | --- |
| `CW, CH` | Canvas width/height (900×530). |
| `WORLD_W` | Siege world width (1980). The camera scrolls within this; `cameraX` is the offset. |
| `GY` | Ground Y for the FRONT lane (400). |
| `WX` | Right edge of Fort Omega's wall (162). |
| `WEAPON_SCALE` | Shared weapon-sprite scale (0.78). |
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
Weapons: `rifle, pistol, shotgun, sniper`. The sniper's base range
is **700** (buffed from 220 in commit `2be7cd4`).

#### `data/zombies.js`
`ZTP`: per-type zombie stats.
- `walker` — hp 60, spd 0.55, dmg 6.
- `runner` — hp 35, spd 1.30, dmg 4.
- `tank`   — hp 150, spd 0.28, dmg 18.
- `brute`  — hp 600, spd 0.40, dmg 30 (HIGH-risk boss + wave-30 rooftop).
- `spitter`— hp 80, spd 0.50, dmg 4, ranged with `spitRange/spitRate/
  spitSpd`. Mission-only.

#### `data/humans.js`
- `HTP` — knifeman / gunman stats.
- `HUMAN_AMMO_DROP = [3, 8]` — ammo dropped on death range.
- `HUMAN_WAVE_FIRST = 4`, `HUMAN_WAVE_EVERY = 5` — wave-cadence constants.
- `isHumanWaveNumber(n)` — predicate.

#### `data/biomes.js`
`BIOMES` — **6 palettes**: three outdoor (`hospital, armory, downtown`)
and three indoor (`police_interior, armory_interior, office_interior`).
Each carries `sky` gradient, `ground` gradient, `groundLine`, `bldgFill
/ bldgRoof / bldgWindow`, `bldgCount`, `bldgHRange`, `accentLight`,
obstacle types (`propType`, `propsPerStep`). Indoor biomes also carry
floor / wall tones for the upper-floor renderer. `DEFAULT_BIOME =
'downtown'`.

#### `data/difficulty.js`
Five exports:

- `DIFFICULTY` — wave-generation knobs (`mkWave` and `mkHumanWave` read
  these).
- `BALANCE` — gameplay caps + rewards + costs. Notable keys:
  `maxWaves (30)`, `maxActiveSoldiers (6)`, `maxReserveSoldiers (10)`,
  `sortieEvery (3)`, `firstSortieAfterWave (1)`, `expeditionsPerDay (3,
  slots on a sortie day)`, `quietDayAmmoMul (0.5)`, `quietDayFood (15)`,
  `quietDayMaterials (10)`, `maxExpeditionParty (3)`, `maxTurrets (2)`,
  `maxBarricades (4)`, `evacMinReserve (3)`, `evacWaveCooldown (3)`,
  `evac*PerCiv`, `volunteerMinAble (2)`, `volunteerAimJitter (6)`,
  `volunteerStamMul (0.8)`, `foodPerPersonPerDay (2)`, `starveDmg (15)`,
  `wallRepairCost (8)`, `wallRepairHp (30)`, `waveClearAmmo (15 + 2×wave, max 60)`,
  `sortieFoodCostPerSoldier (3)`, `missionGoalKillRatio (0.45)`,
  `missionActivationRange (700)`, `behindBarricadeDmgMul (0.30)`,
  `barricadeReflectDmg (4)`, `workbenchCost`, `researchLabCost`,
  `megaWaveMultiplier (2.5)`.
- `CRAFT_RECIPES` — five workbench recipes (rifleMag, pistolMag,
  sniperBox, turretBelt, firstAid).
- `RESEARCHES` — seven research nodes with `id, name, desc, cost, waves,
  effects`. One active at a time; progress = wave-clears since start.
- `PERKS` — seven per-soldier weapon perks. Each entry has `id, name,
  icon, cost, weapons` (`'all'` or array of weapon keys), `desc`, and
  effect keys (`maxHpBonus, maxAmmoBonus, damageMul, rangeBonus,
  reloadMul`).

Helpers:
- `waveClearAmmoFor(wave)` — Command's ammo after clearing `wave`.
- `isSortieWave(wave)` / `nextSortieWave(wave)` — sortie days. The
  command center before wave `w` is one when `w - 1 - firstSortieAfterWave`
  is a non-negative multiple of `sortieEvery`: before waves 2, 5, 8 … 29.
  `nextSortieWave` returns a number past `maxWaves` when none is left.
- `getSoldierPerkEffect(sol, key, defaultValue)` — sums perk effects on
  that soldier (mul keys compound, bonus keys add).
- `getResearchEffect(gs, key, defaultValue)` — sums completed-research
  effects (mul keys compound, bonus keys add).

#### `data/expeditions.js`
- `DEST_POOL` — 16 city locations grouped by risk tier (5 LOW, 6 MED,
  5 HIGH). Includes three **indoor** biomes (`police_interior`,
  `armory_interior`, `office_interior`) that trigger outdoor → indoor
  multi-segment mission generation.
- `RISK_BASE` — per-tier mechanics (`riskColor, solDmg, missionLen, zSpawn`).
- `rollDestinations()` — picks one per tier into the live 3-card list.
- `lootSummary(loot)` — pretty-prints the icon list for the card.
- `MISSION_W=1900, MISSION_VIEW=CW, MGY=GY`.
- `objIcons` — emoji map for pickup types (including 'lostSoldier' 🪖
  and 'vaccine' 💉).
- `STARS, BLDGS` — procedural background coords.
- `RECRUIT_NAMES, RECRUIT_WEAPONS, CIVILIAN_WEAPONS, VETERAN_WEAPONS`,
  `KIND_HP = { recruit: 100, civilian: 70, veteran: 120 }`.
- `TRADE_OFFERS` — pool of 8 trader-camp offers (`give / get / desc`).
- `rollEncounter(risk)` — returns `{ type: 'hostile' | 'trader', offer? }`
  or null with MED 28 % / HIGH 40 % chance.

#### `data/transmissions.js`
- `TRANSMISSION_WAVES = [10, 20, 25]` — waves that auto-queue a Central
  Command cinematic on clear.
- `TRANSMISSIONS` — object keyed by wave number, each with
  `{ title, sender, lines: [{ at, speaker, pitch, text }], durMs,
  dropAt, landAt, supplyDrop }`. `at` is ms from cinematic start.
  `supplyDrop` is applied to `gs.resources` on `finishTransmission`.

#### `data/vaccineMission.js`
- `VACCINE_SCENARIOS` — three destination objects fed sequentially to
  `mkMission` by `vaccineCampaign.js`. Each has the regular destination
  shape (`name, icon, biome, loot, desc, risk, riskColor, missionLen,
  zSpawn`) plus a `_vaccineSegment: 'highway' | 'hospital' | 'rooftop'`
  tag that `mkMission` reads to apply scenario-specific overrides
  (rooftop forces DEFEND, no fork lanes, hospital spawns the vaccine
  pickup).

### 2.3 `src/audio/`

#### `audio/AudioEngine.js`
Class: `AudioEngine`. Free functions: `getAM()`, `processSounds(q, am, mutedRef)`.

- Lazily created on first `getAM()`. Returns `null` if `AudioContext`
  fails (e.g. CSP).
- `startBg()` / `stopBg()` toggle a low drone + intermittent kick beat
  used during siege.
- `mute(on)` ducks master to 0 with a 50 ms ramp.
- `processSounds(q, am, mutedRef)` reads events from a per-frame array.

Event types recognised:
- Combat: `shot, shell, reload, hit, zdie, groan, zatk, bhit, wclr`.
- Cinematic / ambient: `heliStart, heliStop, siren, scream, crackle,
  windStart, windStop, cityHum, cityHumStop, titleSting, chuteRustle`.
- Voice: `chatter` (delegates to `radioChatter`).

Looping events (`heliStart, windStart, cityHum`) hold their own
nodes on the engine instance until `*Stop` is queued.

#### `audio/radio.js`
- `RADIO_LINES` — pool of short tactical lines by category:
  `advance, retreat, reload, hurt, kill, evacIn, evacBoard, evacOut,
  deploy, lowAmmo, baseHit, defeat`.
- `pushRadio(state, category, opts)` — picks a line (or uses
  `opts.line` override), computes a pitch (explicit `opts.pitch` →
  `opts.speaker.voicePitch` → text hash), and:
  - Schedules a `chatter` audio event on `state.soundQ`.
  - Stores `state.radioMsg = { text, at, dur, category }` so the HUD
    can render the subtitle.
  Includes a per-state cooldown (`state._lastRadioAt`, default 1300 ms).

#### `audio/radioVoice.js`
Optional Web Speech TTS layer. Free functions:
- `isRadioVoiceAvailable()` — probes for `window.speechSynthesis`.
- `speakRadioLine(text, opts)` — speaks a string through a synthesised
  utterance bracketed by low-pass + bandpass filtering for the "comms"
  texture. `opts = { pitch, rate, voice? }`. No-op when speech synth
  unavailable or the global voice toggle is off.

Used by `render/transmission.js` to speak Central Command's scripted
lines at their `at` offsets. The toggle lives on `voiceOn` state in
`DeadPerimeter.jsx`.

### 2.4 `src/entities/`

Pure factory functions. No rendering, no audio.

| Module | Export | Returns |
| --- | --- | --- |
| `soldier.js` | `mkSoldier(name, weapon, destX, hp?, lane?, civilian?, onRoof?, opts?)` | Soldier object. Stamps `kind` (recruit / civilian / veteran), `maxHp` from `KIND_HP`, deterministic `voicePitch`, empty `upgrades: {}` perk map, all transient state zeroed. `opts`: `veteran`, `volunteer`, `lookId` (the look is seeded from `name` + `lookId ?? origId ?? id`; `benchEntry` keeps the soldier's id as `lookId`, reserve entries without one use 0, so a face never changes between squad, bench, wall and sortie). Also `benchEntry(s)` (soldier → reserve entry) and `reserveOpts(r)` (reserve entry → `mkSoldier` opts). |
| `zombie.js` | `mkZombie(type)` | Zombie object spawning at `x = WORLD_W` (siege edge), random lane, jittered speed. |
| `human.js` | `mkHuman(type)` | Hostile human with `hostile: true`. |
| `barricade.js` | `mkBarricade(x)` | 140-HP perspective wall spanning all lanes. |
| `turret.js` | `mkTurret(x, lane)` | Machine-gun emplacement. |
| `wave.js` | `mkWave(n)`, `mkHumanWave(n)`, `isHumanWaveNumber(n)` | Spawn queues sorted by `at` (ms offset from wave start). |
| `gameState.js` | `mkGS()`, `recordDeath(gs, victim)` | Fresh game state (4 starting soldiers, starting resources, empty arrays, workshop flags off, stats at 0). `recordDeath` bumps `gs.civiliansLost` or `gs.soldiersLost` based on `victim.civilian`. |
| `persistence.js` | `hasSavedGame()`, `saveGame(gs)`, `loadGame(mkGS)`, `clearSave()` | localStorage helpers. v3 format; reads older versions return null (caller falls back to a fresh game). |

### 2.5 `src/render/`

Canvas draw functions. They receive `ctx` plus the entity (or `gs`) and
`now` in ms. They never read or write `gs` outside of the entity passed
in (with the exception of the override-ref cinematics).

#### `background.js`
`dBg(ctx, cameraX?)` — sky, stars, ruined buildings, lane strips, ground
gradient, faint lane labels. Stars and skyline span the full `WORLD_W`
so panning reveals new content.

#### `base.js`
`dBase(ctx, hp, mhp)` — Fort Omega wall: brick courses with offset
masonry pattern, four loophole firing slits, battle-damage streaks,
reinforced gate panel with padlock, two-row sandbag base course
extending past the wall, concertina razor wire along the parapet, three
mounted floodlights with light cones, wooden corner watchtower with
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

Palette by flag: `s.civilian`, `s.bandit`, `s.police && !s.swat`
(peaked cap), `s.police && s.swat` (tactical helmet), else standard
military variant from a hash of name.

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
fire. Also renders the click-to-place ghost preview when a turret
placement is in progress.

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
"📻 Speaker: line!" lozenge near the bottom of the canvas with
category-tinted color and fade in/out. Used from siege HUD, mission
HUD, evac, defeat, transmission.

#### `evac.js`
`dEvacScene(ctx, evac, now)` + `EVAC_DURATION = 5400`. Procedural UH-60
Black Hawk silhouette over three phases (arrive → board → leave) with
rope-ladder boarding civilians and ground-shadow projection.

#### `intro.js`
`dIntroScene(ctx, intro, now)` + `INTRO_DURATION = 50000`. 14 scripted
SHOT entries (each with `from / to / draw / banner`). Shots reuse the
real `dSoldier` / `dZombie` renderers via a shared `dSpriteAt(drawFn,
ctx, entity, screenX, screenFootY, scale, now)` helper. Audio
scheduled via `scheduleIntroAudio()` with a fire-once Set.

#### `defeat.js`
`dDefeatScene(ctx, defeat, now)` + `DEFEAT_DURATION = 24000`. Four
phases (breach / overrun / lastStand / silence). Defenders fall on
scripted timeline with killers attached. Per-defender voice lines fire
at their `hurtAt` times.

#### `transmission.js`
`dTransmissionScene(ctx, tr, now)` + transmission-specific duration
read from `tr.data.durMs`. Full-screen "INCOMING TRANSMISSION" panel
with header, scrolling waveform driven by current line index, dialog
lines printed at their `at` offsets, parachuted supply crate animation
during `dropAt → landAt`. Audio: chatter SFX bracketing each line +
optional `speakRadioLine` via `audio/radioVoice.js`.

#### `extraction.js`
(Legacy) `dExtractionScene(ctx, e, now)` + `EXTRACTION_DURATION = 22000`
+ `EXTRACTION_SCRIPT`. Convoy of one or three vehicles depending on
survivor count, rolling out of Fort Omega with scripted dialog over
22 s. Kept on the codepath only to gracefully handle stale saves whose
`gs.phase === 'extraction'`; new runs go straight to the playable
vaccine campaign and never visit this code.

### 2.6 `src/update/`

Heavy lifters. These are the only places that mutate `gs` (or `m` for
missions). Both functions are pure data flow — they don't touch React
or canvas.

#### `update/siege.js` — `update(gs, now, dt)`

Order of operations in one call:

1. Early return if `gs.phase !== 'siege'`.
2. `gs.waveTime += dt`; decrement shake timer.
3. Drain `gs.spawnQueue` — push new zombies (at `x = WORLD_W`) or humans.
4. Random ambient groan.
5. **Zombie loop**: `walk → attack`. Target priority: same-lane soldier
   > same-lane barricade > base wall.
6. **Human loop** (only when `gs.isHumanWave`): knifemen behave like
   fast walkers, gunmen stop at `meta.range` and fire hostile bullets.
7. **Soldier loop**:
   - Rooftop sniper: own branch with sniper-ammo refill, descend on
     dry pool, target-furthest selection. Range = base 700 + perks +
     research bonus.
   - Ground soldier: walk-collision against barricades, target-prioritise
     same-lane enemies, reload on dry mag, knife melee when both ammo
     and reserve dry. `hurtCallout` fires once when HP < 35 % of max.
     Damage / range / reload all run through `getSoldierPerkEffect` +
     `getResearchEffect`.
8. **Turret loop**: fire at closest in-range enemy using `turretAmmo`.
9. **Bullet loop**: hostile / spit / friendly branches. Friendly bullets
   travel the full `WORLD_W`. On kill, `killTarget()` credits the
   shooter, awards score, possibly rolls a random kill chatter, and
   (for humans) drops `rng(HUMAN_AMMO_DROP[0..1])` ammo. **Every soldier
   death** (lines 144, 227, 463) calls `recordDeath(gs, sol)`.
10. Dead-body caps (60 zombies / 30 humans). Effects GC'd by `dur`.
11. Reserve auto-promotion: if active count < `BALANCE.maxActiveSoldiers`
    and reserve has entries, promote one.
12. Wave-clear check: spawn queue empty + no live enemies → `waveComplete`.
    After 3 s: increment day/wave, give bonus ammo (plus Command's
    convoy — `quietDay*`, `gs.lastConvoy` — when the coming day is not a
    sortie day), tally + apply daily food consumption, tick active
    research progress, climb Delta back up, possibly queue a
    transmission (wave 10/20/25), switch `gs.phase` to `'management'` — **or** to `'vaccine-briefing'` if
    `gs.wave > BALANCE.maxWaves`.
13. Game-over check: base HP ≤ 0 OR every non-expedition soldier dead.

#### `update/mission.js` — `mkMission(party, dest, wave, magsPerSoldier?)` + `updateMission(m, now, dt)`

`mkMission` builds a 1900 px playable level for a multi-soldier party:
- Picks lead (player-controlled) + followers (AI).
- **Multi-segment generation**: if `dest.biome` is an indoor biome
  (`*_interior`), the map splits at an `entranceX` boundary — outdoor
  in front, real building interior behind. Includes multi-floor
  platforms, ladders, stairs.
- Pre-places zombies, pickups, hazards (mines + acid pools), obstacles,
  decorative props, **searchable loot containers** (lockers, ammo crates,
  glass cases, workbenches, etc.) per biome.
- Rolls `objective`:
  - vaccine rooftop scenario → forced 'defend' with 75 s hold.
  - other vaccine scenarios → forced 'reach'.
  - regular mission → 30 % chance 'defend' on MED+HIGH.
- Rolls `fork` (50 % chance for MED+HIGH non-defend non-vaccine).
- For defend missions, pre-places a 3-6 zombie ambush past the anchor.
- Rolls a survivor encounter (MED 28 % / HIGH 40 %), spawns the camp
  humans, and clears zombies within a 220 px radius around the camp.
- Spawns a HIGH-risk Brute boss near the goal.
- For the hospital vaccine scenario, spawns a guaranteed `vaccine`
  pickup at `MISSION_W - 180`.
- Stamps `voicePitch` on the lead + followers via `mkSoldier`.
- Reads `_sortieMags` on each party member (set by `playMission`) to
  seed `magsLeft`; mission ammo is finite.

`updateMission` per frame:
- Init banner: on first tick, if `m._vaccineScenarioName` is set, push
  a big yellow text banner with that scenario name.
- **Vaccine carrier death check**: if `m._vaccineCollected &&
  !m._vaccineDropped` and the carrier is dead, drop a fresh `vaccine`
  pickup at their X and clear the carrier id.
- Top-of-frame guard: if lead is dead, `promoteLeadOnDeath`. Mission
  fails only on full party wipe.
- Trader proximity opens the dialog and pauses world simulation.
- Encounter proximity sweep clears any zombies that wandered into the
  camp area (220 px radius).
- Lead movement: `A` / `D` along the street, `W` / `S` across the depth
  band (`update/depth.js`), `C` jump, `E` climbs the stair / ladder the
  lead stands at (`ladderAt`; a room door at the same spot wins, the
  two never overlap), `S` at the top of one climbs down.
- Follower AI: track lead in a formation spread across the band, walk
  to the target's depth to line up the shot (`_aimDepth`), hold fire
  while misaligned or with a wreck in the way, switch to knife on dry
  mag. When the lead is on another level they take the stairs / ladder
  to it (`update/levels.js`); rescued civilians following the party do
  the same.
- Zombie AI: close in on both axes (a pack far off keeps a personal
  depth offset), bite only when lined up in depth, ranged spitter logic
  (the spit flies across the band toward the target). Zombies on
  platforms or with ladders below them will climb to reach party
  members on a different floor (heading to the back wall first). In a
  fork, a target on the other road means going round the median's
  end (`forkWay`).
- Hostile-human AI: walk to weapon's ideal range, line up on the
  target's depth, fire only when roughly aligned (aim wobbles in
  depth); close in when a wreck is in the way, round the fork's median
  when the target is on the other road. Their shots stay on the street
  (someone up on a floor is out of reach and only a last-resort target).
- Bullet loop with branches: barricade / wreck (`coverStops`) → spit →
  damage party / rescuables; hostile → damage party; friendly → mine
  detonate → human → zombie. Every bullet carries `depth` (+ `dd`
  drift for pellet spread) and hits only within `HIT_TOL` /
  `HOSTILE_TOL` of it. Kill chatter on confirmed kills.
- Hazard ticks: mine proximity trigger (or bullet trigger); acid pool
  (an ellipse at its depth) slow + dot.
- Pickup collection (depth-gated, `GRAB_DEPTH`; floor-gated for
  upper-floor pickups via `standingY` match). Vaccine pickup arms the
  carrier mechanic; a dead carrier drops it where they fell.
- **Searchable container progress** — hold proximity for ~700 ms with
  a progress bar; on completion, roll loot from the container-type
  table.
- Defend timer + scripted wave spawner past the anchor. At
  `elapsed >= 32000` AND `m._vaccineIndex === 2`, spawn the **rooftop
  Brute boss** (single-shot, guarded by `_vaccineBruteSpawned`).
- **APC extraction** when defend hold ends: spawn the APC entity, drive
  it in from the Fort Omega side, embark soldiers, drive it back across
  the map. Mission only flips to `'won'` after the convoy has cleared
  the screen.
- Win condition: `s.x >= MISSION_W - 50` (reach) or extraction complete
  (defend).

`dMissionWorld` + `dMissionHUD` paint the parallax background, the
depth band's surface (`dBand`: sidewalk, road, kerb, or an indoor
floor), multi-floor buildings + ladders + platforms, then everything
standing in the band sorted back to front and drawn through
`atDepth` (obstacles, van, barricade line, cache / nest / alarm car,
fork median, defend sandbags, pickups, zombies, survivors, squad,
APC), `dVaccineVial` over the carrier's head, the E prompts and the
top HUD (progress bar repurposed as defend timer during DEFEND
missions). The radio panel sits up top during sorties so it never
covers the band.

#### `update/depth.js` — the sortie depth band

Constants and helpers for the beat-'em-up street. Every mission actor
and prop carries `depth`: 0 against the back wall (doors, stairs,
ladders, containers), `BAND` (68) at the front kerb; rooms use
`ROOM_BAND` (54). Feet sit at `MGY + depth`, sprites scale by
`depthSc` (1.00 → 1.14). Upper floors / ledges / ladders are a single
line at depth 0 (`aloft`, `clampDepth`).

| Export | Purpose |
| --- | --- |
| `BAND, ROOM_BAND, bandOf(m)` | Band depth on the street / in a room. |
| `DEPTH_SPD` | Depth speed as a share of walking speed (0.67). |
| `HIT_TOL, HOSTILE_TOL` | Depth gap within which a party / hostile bullet hits (13 / 10; +6 Brute, +3 Tank). |
| `BITE_DEPTH, MELEE_DEPTH` | Bites (14) and melee swings (18). |
| `GRAB_DEPTH, SEARCH_DEPTH` | Pickups (22), containers / cache (30). |
| `BACK_REACH, LEDGE_REACH` | E reaches doors, stairs and ladders from depth ≤ 40; a jump lands on a ledge from depth ≤ 18. |
| `dep, dGap, depthSc, anyDepth, stepDepth, clampDepth, aloft` | Basics. |
| `formationDepth(lead, i, band)` | Squad formation across the band (±18, ±34…). |
| `placeObstacle(o, r)` | Cars anywhere (cover), furniture / searchables at the back, clutter anywhere. |
| `coverStops(m, b)`, `coverBetween` | Wrecked cars (and the alarm car) stop bullets along their depth unless fired point-blank over them. |
| `forkMid, holdFork, noteRoad, roadClamp, wrongRoad` | The fork's concrete median: the squad keeps to the road the lead took. |
| `holdMedian(m, list)`, `forkWay(m, e, tx, td)` | The median holds zombies and survivors on the ground too (each keeps the side it was on while the median spans its x, run after their movement); `forkWay` is the waypoint round the near end when the target is on the other road. It's low: bullets fly over it, but a shot has to be lined up in depth and the median (14 px) is wider than `HIT_TOL`, so only big bodies and pellet fringes get hit across; spitters lob over it. |
| `atDepth(ctx, x, d, fn, yOff)` | Draw something authored standing at `(x, MGY)` at depth `d`, scaled. |

#### `update/levels.js` — followers between levels

A level is the street (`null`) or one platform (upper floor or
ledge). `levelOf(m, e)` is the one someone stands on, or is heading to
while on a ladder. `followLevel(m, e, lead, now, dt, opts)` runs at the
top of each follower's (and following civilian's) move and returns
false when both are on the street, leaving the ground formation code
in charge:

- Same floor as the lead: a single line at depth 0, spaced along x
  behind the lead (ahead of it when the floor ends), kept on the floor.
- Lead on another level: pick the nearest stair / ladder that leads
  there (down from the current floor first; one inside the fork is
  skipped from its front road), walk to it heading to the back of the
  band, wait for anyone just setting off on it the same way, then
  climb with the lead's speed and slide (`CLIMB_SPD`). A climb follows
  the lead: it turns round if the lead's level changes.
- No stair reaches the lead's level, or no progress toward it for
  4 s: stay on the current level and fight there (the street
  formation under the lead, or as close as the floor allows), look
  again after 1.5 s.
- Reloading or swinging holds them in place, except halfway up a
  ladder. `aiShoot` keeps firing at whatever is on their level.

Rooms reset everyone to the room's floor (`placeParty`), so a climb
in progress ends there. A follower carrying the vaccine climbs like
the rest; if they fall up there the vial drops on that floor.

#### `update/volunteers.js` — civilians on sorties

Civilians (`civilian: true`) hold the wall but don't go on sorties;
they're waiting for the helicopter. `sortieReady(s)` is the picker's
filter (`!civilian || volunteer`). `shortOfMen(gs)` is true when fewer
than `BALANCE.volunteerMinAble` alive, at-the-fort soldiers are
sortie-ready; the expedition screen then shows ASK FOR VOLUNTEERS.
`askVolunteers(gs)` asks each non-volunteer civilian in the squad (not
the reserve: those are queued for the evac). Willingness is a fixed
per-name trait (25–75 %), the roll is seeded by name + day, so asking
again the same day gives the same answers. Accepting sets
`volunteer: true` for good (saved, carried to and from the bench by
`benchEntry` / `reserveOpts` in `entities/soldier.js`). On a sortie
`missionModifiers` gives volunteers `aimJitter` (shots leave up to
±`volunteerAimJitter` px off their depth) and `stamMul`
(`volunteerStamMul`, read by `maxStam`).

### 2.7 `src/expedition/`

- `missionFinish.js` — `finishMission(m, gs)` transfers collected
  resources from a playable mission back into the game state, handles
  recruit pickup (`civilian` → civilian kind, `lostSoldier` → veteran),
  pushes results to active duty or reserve as space allows. Hooks
  `recordDeath(gs, orig)` in the writeBack path for every party member
  who died on the mission (guarded against double-counting bodies left
  behind on a previous run).
- `vaccineCampaign.js` — wave-30 finale.
  - `mkVaccineCampaign(gs, mags = 3)` — gathers every alive squad
    member + every reserve member (civilians + extras temporarily
    promoted to soldiers via `mkSoldier`), issues 3 mags each from the
    stash, builds scenario 0 (Highway 17) via `mkMission` with the
    first vaccine destination. Returns `{ vaccine, party, mags,
    current, currentIndex, scenariosCleared, vaccinePickedUp,
    vaccineCarrierId }`.
  - `advanceVaccineScenario(campaign, gs)` — writes back HP/ammo/state
    from the just-cleared scenario, calls `recordDeath` for any new
    casualties, then mints a fresh `mkMission` for the next scenario
    using the surviving subset. Carries the vaccine state forward: if
    a carrier survived, the matching origId becomes the new carrier in
    the next scenario.
  - `finishVaccineCampaign(campaign, gs)` — final wrap-up. Writes back
    HP/ammo to gs.soldiers, demotes reserve-origin survivors back into
    `gs.reserve`, computes outcome tier:
    - `gold` if all 3 scenarios cleared + vaccine delivered + ≥4
      survivors.
    - `silver` if all 3 cleared + vaccine delivered + 1-3 survivors.
    - `bronze` if ≥2 cleared but vaccine lost / dropped on a body.
    - `failure` otherwise (party wiped early).
  Returns `{ tier, survivors, scenariosCleared, vaccineDelivered }`.

### 2.8 `src/DeadPerimeter.jsx`

Thin React component that wires everything together. Hooks:

- `useRef` — `cvs, gsRef, rafId, prevT, mutedR, pausedRef, missionRef,
  evacRef, introRef, defeatRef, transmissionRef, extractionRef,
  vaccineRef, vaccineResultRef, placementRef, inputRef, expSolsRef,
  expDstRef, expDestsRef, magsRef`.
- `useState` — `scr, ui, muted, paused, voiceOn, hasSave,
  expSoldierIdxs, expDestIdx, expDests, expEvents, expVisible,
  expResult, expPhase, magsPerSoldier, missionTick`.
- `useCallback` — every event handler: `newGame, continueGame,
  startWave, sendExpedition, playMission, finalizeMission,
  startVaccineMission, advanceOrFinishVaccine, finishIntro,
  finishDefeat, finishTransmission, finishExtraction, applyEvac,
  skipEvac, callEvac, resolveTrade, recruit, buildBarricade,
  buildTurret, cancelPlacement, confirmPlacement, healSoldier,
  moveSquad, toggleMute, togglePause, toggleVoice, benchSoldier,
  activateReserve, toggleSoldier, pickDest, repairWall, craft,
  startResearch, buyPerk, buildWorkbench, buildResearchLab`.
- `useEffect` — load `hasSavedGame()` on mount; expedition animation
  ticker; mission "is-finished" poll; the main RAF + event-listener
  setup/teardown.

Event handlers attached to the canvas: `click`, `mousedown`, `mousemove`
(for placement preview), plus `touchstart`/`touchend`/`touchcancel` for
mobile. Window-level listeners: `keydown` (Esc, A/D/W/S/arrows, Space),
`keyup`, `mouseup`.

JSX renders these screens (controlled by `scr` state, **13 unique
values**):
1. `menu` — title + `BEGIN OPERATION` + `CONTINUE SAVED RUN`.
2. `intro` — canvas (50 s opening cinematic).
3. `management` — resources, soldiers + reserve, barricades, turrets,
   base HP, recruit / barricade / turret / heal / EVAC / expedition /
   deploy / repair-wall / workbench / research-lab / perks / crafting /
   research-queue buttons. Red banner when `isHumanWaveNumber(gs.wave)`.
4. `siege` — canvas + control row (RETREAT, soldier badges, ADVANCE,
   PAUSE/RESUME, MUTE, voice toggle).
5. `placement` — canvas with build-ghost preview, click to commit.
6. `expedition` — pickers (party + 3 rolled destinations) + magazine
   selector + PLAY LIVE / event log / result summary.
7. `mission` — canvas + bottom hint + RETURN TO BASE (regular) /
   ADVANCE TO … (vaccine scenario won) / COMPLETE EXTRACTION (vaccine
   final won) / END CAMPAIGN (vaccine lost) button.
8. `transmission` — canvas (wave 10/20/25 radio overlay) + SKIP.
9. `evac` — canvas (5.4 s helicopter cinematic) + SKIP.
10. `extraction` — (legacy) canvas + SKIP.
11. `vaccine-briefing` — Central Command briefing panel + DEPLOY.
12. `defeat` — canvas (24 s game-over cinematic) + SKIP.
13. `gameover` / `victory` — stats panels. Victory reads
    `vaccineResultRef.current` to show tier-specific (gold/silver/
    bronze/failure) emoji + header + blurb + `Convoy Cleared N/3` +
    `Vaccine ✓/✗`.

---

## 3. Invariants

The codebase relies on these rules. Breaking any of them is a regression.

1. **Module dependency direction is strictly top-down**: `constants` →
   `data` → `entities` → `render` / `update` / `expedition` / `audio` →
   `DeadPerimeter.jsx`. No reverse imports, no cycles.
2. **`gs` is mutated in place**. Never replace it; never `Object.assign`
   over it.
3. **React state is for the UI shell**, not for gameplay. Mutation must
   not flow through `setState`.
4. **Override refs are checked BEFORE `gs.phase`** in the loop, in this
   order: intro → defeat → evac → transmission → extraction → mission →
   siege. Whichever ref is set owns the canvas exclusively.
5. **`gs.soundQ` is drained every frame** by `processSounds`. Pushing a
   sound during render is safe but pointless.
6. **Bullet collisions branch on `b.hostile` / `b.spit`**: hostile
   bullets damage party / rescuables / soldiers; spit globs damage the
   same set with green effects; friendly bullets cascade through mine
   → human → zombie checks.
7. **`gs.isHumanWave` is set in `startWave`**, never derived mid-update.
8. **Rooftop sniper** does not respect lane scaling — drawn at
   `(WX-40, GY-160)` at full size.
9. **Soldier states**: `walk | idle | shoot | reload | knife | dead`.
   Dead soldiers stay in `gs.soldiers` forever as memorials.
10. **Lane scaling is on the canvas transform**, not pre-baked into
    sprite coordinates. Multi-floor Y is a separate `standingY` offset.
    Sorties use the same rule with a continuous depth: sprites are
    drawn at lane 0 inside `atDepth`, never moved by hand.
11. **Mission lead promotion** is checked at the top of `updateMission`
    every frame. Mission fails only when `aliveParty(m).length === 0`.
12. **Cinematic audio loops** (heli, wind, cityHum) MUST be paired —
    every `*Start` event must be followed by a `*Stop` somewhere in the
    same cinematic, or the loop leaks across into siege.
13. **pushRadio cooldown** is per-state. State here is `gs` (siege),
    `m` (mission), `evac`, `defeat`, `intro`, or `transmission`. Each
    carries its own `_lastRadioAt`.
14. **`recordDeath(gs, victim)` is the single death-tracking entry
    point** — every site that flips a soldier to `state = 'dead'` calls
    it so the civilians-vs-soldiers split lives in one place.
15. **Perk and research effects** flow through `getSoldierPerkEffect` /
    `getResearchEffect`. Combat code must NOT hard-code WPN values;
    always read through the helper so workshop progression actually
    applies.
16. **Vaccine campaign reuses `mkMission`** via per-scenario
    destinations with a `_vaccineSegment` tag and runtime flags on
    `m` (`_vaccineCampaign, _vaccineIndex, _vaccineCollected,
    _vaccineCarrierId, _vaccineDropped, _vaccineBruteSpawned,
    _vaccineScenarioName`). No parallel mission engine.

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
  only by `finishMission` (regular missions) or by
  `advanceVaccineScenario` / `finishVaccineCampaign` (vaccine).
- **Cinematic refs share canvas state.** If one cinematic forgets to
  clean up `ctx.save()` calls, the next one will see a corrupted
  transform. Wrap each scene in `ctx.save()` / `ctx.restore()`.
- **`dSpriteAt` math.** To draw a real sprite at screen `(x, footY)`
  with scale `s`, pre-translate by `(x, footY - GY*s)` then scale, so
  the drawer's internal `translate(s.x, laneY(0))` lands the feet at
  `(x, footY)` exactly. Lane 0 is required (the helper sets it).
- **`playMs` accounting** rolls only at save time. If the player rage-
  closes the tab without triggering a save, the current session's
  elapsed time is lost (next session starts fresh).
- **Bullets travel the full `WORLD_W`**, not just the visible viewport
  (commit `6a15fa9`). Don't reintroduce viewport-relative culling on
  the siege bullet loop.

---

## 5. Recipes — how to extend

### 5.1 Add a new weapon

1. Add an entry in `data/weapons.js`.
2. Add a polygon sprite branch in `render/weapons.js`.
3. Add it to `RECRUIT_WEAPONS` / `CIVILIAN_WEAPONS` / `VETERAN_WEAPONS`
   in `data/expeditions.js`.
4. If you want a perk to apply only to this weapon, add the weapon key
   to that perk's `weapons` array in `PERKS` (`data/difficulty.js`).

### 5.2 Add a new zombie type

1. Add an entry in `data/zombies.js`.
2. Add it to `mkWave` in `entities/wave.js` so it spawns in the siege
   queue.
3. If it needs unique rendering, branch on `z.type` in `render/zombie.js`.
4. If it's a mission-only enemy (boss / ranged), add the spawn logic in
   `update/mission.js` `mkMission` or the defend wave spawner.

### 5.3 Add a new mission destination

Append to one of `DEST_POOL.{LOW, MED, HIGH}` in `data/expeditions.js`
with `{ name, icon, biome, loot[], desc }`. `rollDestinations()` picks
it up automatically. For a new indoor biome, also add an entry to
`BIOMES` in `data/biomes.js` (key ending in `_interior` to trigger the
multi-segment generator).

### 5.4 Tune difficulty

Edit `data/difficulty.js`. `DIFFICULTY` controls wave generation;
`BALANCE` controls soldier caps, sortie limits, evac math, mission
goal-kill ratio, barricade damage multipliers, food economy, wall
repair, etc.

### 5.5 Add a new radio chatter category

1. Append to `RADIO_LINES` in `audio/radio.js`.
2. Call `pushRadio(state, 'newCategory', { speaker })` at the right
   game-state event.
3. Optionally tint the subtitle by adding a branch in `dRadioSubtitle`
   (`render/hud.js`).

### 5.6 Add a new saved field

1. Add the field to `mkGS` in `entities/gameState.js`.
2. Add it to both `saveGame` and `loadGame` in
   `entities/persistence.js`.
3. Bump `STORAGE_KEY` (e.g. `-v4`) so old saves are discarded gracefully.

### 5.7 Add a new perk

1. Append to `PERKS` in `data/difficulty.js` with `id, name, icon, cost,
   weapons` (`'all'` or array of weapon keys), `desc`, and the relevant
   effect keys (one of `maxHpBonus, maxAmmoBonus, damageMul, rangeBonus,
   reloadMul`).
2. If the effect key is new, hook it where it should apply (combat
   code that does e.g. `getSoldierPerkEffect(s, 'rangeBonus', 0)`).
3. The buy button + cost-gating UI in the management screen reads
   `PERKS` directly — no extra wiring.

### 5.8 Add a new research node

1. Append to `RESEARCHES` in `data/difficulty.js` with `id, name, desc,
   cost, waves, effects { … }`.
2. Hook the effect at the call site via `getResearchEffect(gs, 'key',
   defaultValue)`.
3. Research panel UI reads `RESEARCHES` directly.

### 5.9 Add a new craft recipe

Append to `CRAFT_RECIPES` in `data/difficulty.js` with `id, icon, name,
cost {…}, output {…}`. The workbench UI in `DeadPerimeter.jsx` iterates
and renders one button per recipe.

### 5.10 Add a new shot to the opening intro

1. Insert a new `{ from, to, draw, banner }` entry into `SHOTS` in
   `render/intro.js` (cumulative ms from intro start, total =
   `INTRO_DURATION`).
2. Write the drawer fn — reuse `dSpriteAt(dSoldier|dZombie, ...)` for
   characters and `centerText()` for any titles.
3. Add the banner branch in `dBannerText` if you need a tagline.
4. Add audio cues to `scheduleIntroAudio` via `fireOnce(intro, key,
   condition, evt)`.

### 5.11 Add a new transmission cinematic

1. Append a wave key to `TRANSMISSION_WAVES` and a corresponding entry
   in `TRANSMISSIONS` in `data/transmissions.js` with `title, sender,
   lines[], durMs, dropAt, landAt, supplyDrop`.
2. The siege loop will detect the new wave automatically and queue it
   via `gs.pendingTransmission`. No extra wiring.

### 5.12 Add a new vaccine scenario / change the wave-30 chain

Append to `VACCINE_SCENARIOS` in `data/vaccineMission.js` with a
destination shape (`name, icon, biome, loot, desc, risk, riskColor,
missionLen, zSpawn, _vaccineSegment`). For scenario-specific overrides
(forced objective, special pickup, scripted boss), branch on
`dest._vaccineSegment` in `update/mission.js` `mkMission` and in
`updateMission`. The campaign factory in
`expedition/vaccineCampaign.js` plays scenarios in order — bumping the
array length is enough.

### 5.13 Change canvas / world dimensions

Update `CW, CH, GY, WX, WORLD_W` in `constants.js`. Most code reads
them by import; the few places that bake them in (e.g. `LANES[*].dy`)
are right next to the constants.

---

## 6. Where each user-facing feature lives

| Feature | Files |
| --- | --- |
| Lane depth | `constants.js` (LANES), every `render/*.js`, `update/siege.js` |
| Rooftop sniper | `render/soldier.js` (`dRooftopSniper`), `update/siege.js` (onRoof branch) |
| Civilian / veteran / bandit palettes | `render/soldier.js` (flag-driven branches), `entities/soldier.js` |
| Barricades + turrets + click-to-place | `entities/barricade.js`, `entities/turret.js`, `render/turret.js`, `render/effects.js`, `update/siege.js`, `DeadPerimeter.jsx` (`buildBarricade`, `buildTurret`, `confirmPlacement`, `cancelPlacement`, `placementRef`) |
| Camera scroll | `constants.js` (`WORLD_W`), `update/siege.js` (cameraX clamp), `DeadPerimeter.jsx` (pan key handlers) |
| Playable missions | `update/mission.js`, `expedition/missionFinish.js`, `DeadPerimeter.jsx` (`playMission`, `finalizeMission`) |
| Pre-mission magazine loadout | `DeadPerimeter.jsx` (`magsRef`, `magsPerSoldier` state, `playMission` ammo issue), `update/mission.js` (`buildMissionSoldier` reads `_sortieMags`) |
| Multi-floor + platforms + ladders + jump | `update/mission.js` (platforms[], ladders[], `ladderAt` + E to climb, C jump impulse, climb checks, Y-level combat), `update/depth.js` (`aloft`, `LEDGE_REACH`, `BACK_REACH`), `update/levels.js` (followers and civilians take the stairs after the lead) |
| Sortie depth band | `update/depth.js` (band, tolerances, formation, cover, fork median, `atDepth`), `update/mission.js` (movement / AI / bullets on both axes, `dBand`, depth-sorted world pass), `update/moves.js` (roll and grenades in depth), `update/cityMission.js` + `update/rooms.js` + `update/missionExtras.js` + `update/faction.js` (spawn depths), `render/cityMission.js` + `render/missionExtras.js` (drawables for the sorted pass), `render/lighting.js`, `DeadPerimeter.jsx` (W/S, C, E, ▲ ▼ touch buttons) |
| Indoor multi-segment missions | `data/biomes.js` (`*_interior`), `data/expeditions.js` (indoor dests), `update/mission.js` (entranceX + indoor generator) |
| Searchable loot containers | `update/mission.js` (`obstacles[].searchable`, progress bar, on-complete loot roll) |
| APC extraction after defend | `update/mission.js` (defend timer → `m.extraction = { … }`, APC entity, embark, drive-out) |
| Mines / acid pools | `update/mission.js` (`mkMission` hazards, hazard loop, bullet → mine check) |
| Spitter / Brute | `data/zombies.js`, `update/mission.js` (mkMission spawn + spitter AI block + scripted rooftop brute) |
| DEFEND objective | `update/mission.js` (objective rolling + ambush spawn + defend tick + sandbag render + APC dispatch) |
| Fork (back / front road) | `update/mission.js` (fork rolling, pickups on each road, `dForkMedian`, zombie / hostile detours), `update/depth.js` (median: `holdFork`, `noteRoad`, `roadClamp`, `wrongRoad` for the squad, `holdMedian`, `forkWay` for everyone else) |
| Survivor encounters | `data/expeditions.js` (`TRADE_OFFERS`, `rollEncounter`), `update/mission.js` (humans block, AI loop, trade dialog), `DeadPerimeter.jsx` (`resolveTrade`) |
| Lead promotion | `update/mission.js` (`promoteLeadOnDeath` + top-of-frame guard) |
| Wave conditions / surge pacing / mini-boss | `data/waveMods.js`, `entities/wave.js` (`mkWave(n, mod)`), `entities/zombie.js` (boss), `update/siege.js` (`modRange`, `spitterTick`, boss spawn + bounty, `nextWaveMod` roll), `render/weather.js`, `render/hud.js` (tag + boss bar), `render/lighting.js`, `DeadPerimeter.jsx` (`ensureNextWaveMod`, intel panel) |
| Siege mid-wave events (survivor, supply crate) | `update/siegeEvents.js`, `render/siegeEvents.js`, `update/siege.js` (tick + wave-clear hold) |
| Mission conditions / side objectives / car alarm | `data/missionExtras.js`, `update/missionExtras.js` (`setupMissionExtras`, `tickMissionExtras`, `bulletHitsSide`), `render/missionExtras.js`, `data/expeditions.js` (`rollDestinations`), `DeadPerimeter.jsx` (destination cards) |
| Found weapons / melee / armory / XP | `data/weapons.js` (`WPN` base + pool, `MELEE`, `GEAR_LOOT`, `rollGear`), `data/progression.js` (XP, levels, skills), `entities/gear.js` (melee stats + wear, armory, `magSize`), `render/weapons.js` (gun art), `render/actors/people.js` (`paintMelee`, base-class handling), `update/siege.js` + `update/mission.js` (melee, XP credit), `update/cityMission.js` (gear pickups, container finds), `expedition/missionFinish.js` (XP, melee wear, gear → armory), `DeadPerimeter.jsx` (armory panel, equip, skills UI, crafting) |
| Fort survivors, jobs & story | `data/quests.js` (NPCs, `STORY`, `FORT_UNLOCKS`, side-job templates), `update/quests.js` (offers, accept/decline, `jobsAt`, completion + rewards, unlock helpers `sortiesPerDay` / `sortieDay` / `sortiesLeftToday` / `healCost` / `turretMaterials` / `hasUnlock`), `data/city.js` (`dest.quests`), `update/cityMission.js` (quest items / people placed), `update/mission.js` (quest pickup), `render/missionExtras.js` (HUD tags), `ui/CityMap.jsx` (`!` markers), `DeadPerimeter.jsx` (survivors panel, result lines) |
| Northgate Compact (faction) | `data/faction.js` (`COMPACT`, `COMPACT_STOCK`, standing tiers/discount, `mkCompact`), `update/faction.js` (`buy` + envoy rations — no sortie slot, `compactDayTick`, `setupAssault`, `assaultOutcome`, `raidDue` / `raidLaunched`), `ui/CompactPanel.jsx` (expedition screen, and command center with `atFort`), `data/city.js` (`compound` location, `dest.faction` / `compactInfo`), `update/cityMission.js` (assault layout), `update/mission.js` (trooper AI, colonel, garrison HUD), `update/siege.js` (raid waves, day tick), `update/quests.js` (radio unlock reveals the compound) |
| Sortie days (sorties every 3 waves, management in between) | `data/difficulty.js` (`sortieEvery`, `firstSortieAfterWave`, `expeditionsPerDay`, `quietDay*`, `isSortieWave` / `nextSortieWave`), `update/quests.js` (`sortieDay`, `sortiesLeftToday`), `update/siege.js` (convoy on days without sorties), `DeadPerimeter.jsx` (header line, EXPEDITION button and note, `playMission` slot check, convoy banner, Compact panel in the command center), `update/faction.js` (envoy takes no slot) |
| Stamina, travel time, journal | `entities/gear.js` (`maxStam`, `tickStam`, `spendStam`, `winded`), `data/progression.js` (Endurance → `stamMul`), `data/city.js` (`travelSlots`), `update/quests.js` (`q.log`), `DeadPerimeter.jsx` (journal block, slot check) |
| Rooms + barricades (explore) | `update/rooms.js` (`placeRoomDoors`, seeded `buildRoom`, `enterRoom` / `exitRoom` swap the mission's world fields, `tickRooms` on the E key, `leaveRoomIfInside` before the result), `render/rooms.js` (street doors, room decor per kind, E prompts; doors are reached from the back of the band, `BACK_REACH`), `data/biomes.js` (`apartment_interior`, `clinic_interior`), `update/cityMission.js` (barricades: `clampCity` keeps the dead pounding on it, `barricadeStops` blocks bullets; bolt cutters), `render/cityMission.js` (`dBarricade` at the wall + a line of sandbag stacks across the band) |
| Siege zoom | `constants.js` (`ZOOM_*`, `zoomOf`, `clampCam`), `update/zoom.js` (`setZoom` keeps the anchor point fixed), `render/lighting.js` (`zoomLights`), `DeadPerimeter.jsx` (world transform, click mapping, wheel / +/−), `render/hud.js` (radar window, off-screen arrows) |
| Audio | `audio/AudioEngine.js` (`_voice` vocal-tract synth for zombies, `_metal` / `_thunk` / `_scrape` reload layers per weapon, formant `radioChatter`), `audio/radioVoice.js` (ranked natural voices, one per speaker, narrow pitch) |
| Languages (i18n) | `i18n/index.js` (`t(english, params)`, `setLang`, `onLangChange`, `speechLang`; English text is the key, `ctx|Word` keys for words with two meanings), `i18n/it/*.js` (Italian by area: ui, hud, data, cine, radio, moves, finale, report, radiomusic), `ui/LangSelect.jsx`, `audio/radioVoice.js` (speaks the translation with a voice for the language, else the English line), `audio/radio.js` (`pushRadio` lines with `{placeholders}` + `params`). Add text: write it in English through `t()` (display time only, never in saved data or ids) and add the Italian to the matching `i18n/it` file. |
| Character looks | `render/actors/humanoid.js` (`humanLook`: recruit / veteran / civilian / bandit / `guard` (Compact) variants; `mask`, `eyewear`, `armband`), `render/actors/zombies.js` (walker archetypes × variants, runner variants, `BOSS_LOOKS` per named mini-boss) |
| Sortie reward model | `data/rewards.js` (shadow prices, pickup/box quantities, risk/distance/depth/wave/locked multipliers), `update/mission.js` (pickup placement + values, container values), `data/city.js` (`valueMul`), `expedition/missionFinish.js` (wipe = loot lost) |
| City map + explore missions | `data/city.js` (locations, `gs.city` state, `cityDests`, `cityDayTick`, `applyCityVisit`), `ui/CityMap.jsx`, `update/cityMission.js` (seeded layout, locked doors, van exit, `isIndoorAt`), `render/cityMission.js`, `data/expeditions.js` (`MISSION_W` live binding + `setMissionWidth`), `update/mission.js` (explore branches), `DeadPerimeter.jsx` (expedition screen, travel cost, `applyCityVisit` + save on finalize) |
| Hostile human waves | `data/humans.js`, `entities/{human,wave,gameState}.js`, `render/human.js`, `update/siege.js`, `render/hud.js` (banner) |
| Helicopter EVAC | `render/evac.js`, `DeadPerimeter.jsx` (`callEvac`, `applyEvac`, `skipEvac`, `evacRef`) |
| Civilian volunteers (civilians stay off sorties unless they step up) | `update/volunteers.js`, `DeadPerimeter.jsx` (party picker, `askVols`, `volNote`), `update/mission.js` (`missionModifiers`: `aimJitter`, `stamMul`; `fireGun`), `entities/gear.js` (`maxStam`), `entities/soldier.js` (`benchEntry`, `reserveOpts`), `entities/persistence.js`, `data/difficulty.js` (`volunteer*`) |
| Opening intro | `render/intro.js`, `DeadPerimeter.jsx` (`newGame` → `introRef`, `finishIntro`) |
| Defeat cinematic | `render/defeat.js`, `DeadPerimeter.jsx` (siege transition → `defeatRef`, `finishDefeat`) |
| Transmission cinematics | `data/transmissions.js`, `render/transmission.js`, `audio/radioVoice.js`, `update/siege.js` (queue at wave 10/20/25), `DeadPerimeter.jsx` (`transmissionRef`, `finishTransmission`) |
| Wave-30 vaccine campaign | `data/vaccineMission.js`, `expedition/vaccineCampaign.js`, `update/siege.js` (phase trigger), `update/mission.js` (`_vaccineSegment` / `_vaccineCampaign` branches + carrier + dropped-vial + rooftop brute), `DeadPerimeter.jsx` (`startVaccineMission`, `advanceOrFinishVaccine`, `vaccineRef`, `vaccineResultRef`, briefing panel, tier-aware victory panel) |
| Workshop progression | `data/difficulty.js` (`PERKS`, `RESEARCHES`, `CRAFT_RECIPES`, `getSoldierPerkEffect`, `getResearchEffect`), `entities/soldier.js` (`upgrades`), `DeadPerimeter.jsx` (`buyPerk`, `startResearch`, `craft`, `buildWorkbench`, `buildResearchLab` + UI panels), `update/siege.js` (effect lookups at fire / reload) |
| End-of-run stats | `entities/gameState.js` (`startedAt`, `playMs`, `soldiersLost`, `civiliansLost`, `recordDeath`), `entities/persistence.js` (persist + roll playMs), `update/siege.js` + `expedition/missionFinish.js` (death hooks), `DeadPerimeter.jsx` (`fmtPlayTime`, victory + gameover stat rows) |
| Radio chatter + subtitles | `audio/radio.js`, `render/hud.js` (`dRadioSubtitle`), call sites in `update/siege.js` + `update/mission.js` + `DeadPerimeter.jsx` (`moveSquad`) |
| Per-soldier voice pitch | `entities/soldier.js` (`pickVoicePitch`), `audio/radio.js` (speaker handling), `audio/AudioEngine.js` (`radioChatter` numeric pitch support) |
| Web Speech TTS for transmissions | `audio/radioVoice.js`, `render/transmission.js`, `DeadPerimeter.jsx` (`voiceOn`, `toggleVoice`) |
| Reserve roster | `entities/gameState.js` (`reserve` array), `entities/persistence.js`, `DeadPerimeter.jsx` (`benchSoldier`, `activateReserve`) |
| Save / load (v3) | `entities/persistence.js`, `DeadPerimeter.jsx` (`continueGame`, autosave hooks) |
| Pause | `DeadPerimeter.jsx` (`togglePause`, Esc handler, render guard, overlay) |
| Mobile touch | `DeadPerimeter.jsx` (`onTouchStart` / `onTouchEnd`) |
| Wall repair | `DeadPerimeter.jsx` (`repairWall`), `data/difficulty.js` (`wallRepairCost`, `wallRepairHp`, `wallRepairBonus` from research) |
| Sortie moveset + hit feel | `update/moves.js` (roll — also across the band with W/S —, grenades lobbed at a depth and hitting by distance with the depth gap weighted, manual reload, swap, melee on demand; hitstop, shake, slow motion via `m._ts`), `render/moves.js` (grenades, moves HUD panel), `render/actors/humanoid.js` + `people.js` (roll pose), `DeadPerimeter.jsx` (keys + touch buttons) |
| Objectives HUD | `update/objectives.js` (`tickObjectives`: primary / job / side lines with live counters, toasts), `render/objectives.js` (`dObjectives`) |
| Reports, grades, records | `expedition/report.js` (sortie / wave / finale stats and S-A-B-C grade, records in localStorage `dp-records`), `render/report.js` (grade box on the end overlay), `ui/ReportCard.jsx`, `update/siege.js` (wave report), `entities/persistence.js` (`lastWaveReport`) |
| Finale checkpoints | `expedition/vaccineCampaign.js` (`saveVaccineCheckpoint` at each act start, `retryVaccineCheckpoint`, `vaccineActFailure`, `retries`), `render/checkpoint.js` (banner), `DeadPerimeter.jsx` (retry / accept panel) |
| Radio panel + log | `audio/radio.js` (`pushRadio` with `from` for named speakers, radio log), `render/portrait.js` (cached head-and-shoulders portraits from the humanoid painter), `render/hud.js` (`dRadioSubtitle` panel), `ui/RadioLog.jsx`, `ui/Face.jsx` |
| Soldier faces in the command center (squad + reserve) | `ui/Face.jsx` (portrait canvas + scanlines), `render/portrait.js`, `render/actors/people.js` (`lookId`, `lookSeed`), `entities/soldier.js` (`lookId` through `benchEntry` / `reserveOpts`), `entities/persistence.js` |
| Music | `audio/music.js` (tracks per state, scheduled on the AudioContext clock, crossfades, siege / sortie intensity, ducking under radio voices), `DeadPerimeter.jsx` (`tickMusic` interval, MUSIC toggle `dp-music`) |
| Daily food consumption + starvation | `update/siege.js` (wave-clear tally + per-person deduction + `starveDmg` on zero) |

---

## 7. Glossary

- **GS** — game state, the single mutable object held in `gsRef.current`.
- **Lane** — depth row; 0 = FRONT (largest sprites), 1 = MID, 2 = BACK.
- **WORLD_W** — siege world width (1980 px). Camera scrolls within it.
- **standingY** — per-entity Y offset for multi-floor / platform
  positioning in missions. Negative = elevated.
- **depth** — per-entity position across a sortie's street band, 0 at
  the back wall to `BAND` at the front kerb (`update/depth.js`).
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
- **Fork** — section of some MED+HIGH reach missions split by a
  concrete median into a back and a front road, each with its own
  pickups; pick one with W/S before the median starts.
- **Lead** — `m.soldier`, the player-controlled soldier in a playable
  mission. Promoted from a follower if the original lead dies.
- **Override ref** — `introRef / defeatRef / evacRef / transmissionRef /
  extractionRef / missionRef`, any of which takes the canvas
  exclusively when set.
- **Radio chatter** — procedural "tactical voice" SFX paired with a HUD
  subtitle, fired by `pushRadio(state, category, opts)`.
- **Transmission** — wave-10/20/25 full-screen Central Command radio
  cinematic with optional Web Speech TTS and a parachuted supply drop
  at the end.
- **Workbench** — one-shot build that unlocks per-soldier weapon
  perks + the crafting panel.
- **Research Lab** — one-shot build that unlocks the research queue
  (one active node at a time, progress = wave-clears).
- **Perk** — per-soldier weapon upgrade. Sparse map at
  `soldier.upgrades[perkId] = true`. Effects read via
  `getSoldierPerkEffect`.
- **Research** — global multiplier / bonus. Effects read via
  `getResearchEffect(gs, key, default)`.
- **Vaccine carrier** — the party member currently holding the vaccine
  vial in the wave-30 hospital + rooftop scenarios. Tracked on
  `m._vaccineCarrierId`. Dies → vial drops as a pickup, can be
  recovered by a teammate.
- **APC extraction** — armoured truck that rolls in at the end of a
  successful DEFEND mission; soldiers board it, then it drives back
  across the map. Mission `won` only after the truck clears the
  screen.
- **Ending tier** — gold / silver / bronze / failure outcome of the
  wave-30 vaccine campaign, computed by `finishVaccineCampaign`.
- **recordDeath** — `entities/gameState.js` helper called at every
  soldier-death site to maintain the `soldiersLost` vs `civiliansLost`
  split.
