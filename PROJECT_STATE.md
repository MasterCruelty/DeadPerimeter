# Dead Perimeter — Project State

> Canonical handoff for continuing development. Captures the architecture,
> game systems, completed features, known issues, and the pending roadmap.
> Read this together with `src/` before making changes. For module-by-
> module API see [`CODE.md`](./CODE.md); for user-facing setup see
> [`README.md`](./README.md).

---

## 1. Concept

Dead Perimeter is a 2D side-scrolling **zombie siege survival** game. The
player defends **Fort Omega** from successive waves of zombies and the
occasional hostile-survivor wave. Between waves they:

- **Send sortie parties** into the ruined city — auto-resolved or played
  live as a 1900 px side-scrolling mission. Sorties unlock after wave 1
  so the first wave is a controlled tutorial.
- **Recruit** new soldiers from saved food + materials, or **rescue
  civilians / lost military soldiers** during sorties.
- **Trade** with peaceful survivor camps encountered mid-mission, or
  refuse and fight them as bandits.
- **Build barricades** and **mount machine-gun turrets**.
- **Evacuate** rescued civilians on a procedurally animated helicopter
  for a resource payout.
- **Bench / activate** soldiers from a reserve roster (8 slots).

The game uses **React + Canvas 2D**. All rendering is procedural via
`CanvasRenderingContext2D`. No external sprite sheets, no audio files —
the soundtrack and every SFX are generated at runtime via Web Audio.

---

## 2. File layout

Dependency direction is strictly top-down (no cycles):
`constants` → `data` → `entities` → `render` / `update` / `expedition` →
`DeadPerimeter.jsx`.

```
src/
├── DeadPerimeter.jsx          React component + game loop
├── constants.js               CW, CH, GY, WX, LANES, C palette, helpers
├── audio/
│   ├── AudioEngine.js         procedural Web Audio engine + processSounds
│   └── radio.js               RADIO_LINES + pushRadio
├── data/
│   ├── weapons.js             WPN dictionary
│   ├── zombies.js             ZTP (walker, runner, tank, spitter, brute)
│   ├── humans.js              HTP, HUMAN_AMMO_DROP, wave cadence
│   ├── biomes.js              BIOMES (hospital, armory, downtown)
│   ├── difficulty.js          DIFFICULTY + BALANCE
│   └── expeditions.js         DEST_POOL, RISK_BASE, TRADE_OFFERS,
│                              rollDestinations, RECRUIT/CIVILIAN/VETERAN
│                              weapon pools, KIND_HP, objIcons,
│                              rollEncounter
├── entities/
│   ├── soldier.js             mkSoldier (kind + voicePitch)
│   ├── zombie.js              mkZombie
│   ├── human.js               mkHuman (hostile)
│   ├── barricade.js           mkBarricade
│   ├── turret.js              mkTurret
│   ├── wave.js                mkWave + mkHumanWave
│   ├── gameState.js           mkGS
│   └── persistence.js         hasSavedGame / saveGame / loadGame / clearSave
├── render/
│   ├── background.js          dBg
│   ├── base.js                dBase — Fort Omega rebuilt (watchtower,
│   │                          floodlights, concertina wire, sandbag base,
│   │                          gate panel, loopholes, Ω insignia)
│   ├── weapons.js             dWpn
│   ├── soldier.js             dSoldier + dRooftopSniper (civilian /
│   │                          bandit / police / swat palettes)
│   ├── zombie.js              dZombie
│   ├── human.js               dHuman (hostile)
│   ├── turret.js              dTurret
│   ├── effects.js             dBarricade / dBlt / dFx
│   ├── hud.js                 dHUD + dSquadMarker + dRadioSubtitle
│   ├── evac.js                UH-60 Black Hawk helicopter cinematic
│   ├── intro.js               50 s opening cinematic (14 shots)
│   └── defeat.js              24 s game-over cinematic
├── update/
│   ├── siege.js               siege tick (`update`)
│   └── mission.js             playable side-scroll mission engine
└── expedition/
    ├── auto.js                resolveExpedition + resolvePartyExpedition
    ├── missionFinish.js       finishMission (live → game state)
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

`laneY(lane) = GY + LANES[lane].dy`, `laneSc(lane) = LANES[lane].sc`.
The rooftop sniper is drawn at `(WX-40, GY-160)` at full scale.

Mission world is wider than the siege world:
`MISSION_W = 1900, MISSION_VIEW = CW, MGY = GY`.

---

## 4. Game state (`mkGS`)

The `gs` object is the single mutable source of truth in `gsRef.current`.
Notable fields:

- `phase` — `'siege' | 'management' | 'gameover'` (the React `scr` adds
  `'menu' | 'intro' | 'mission' | 'evac' | 'defeat' | 'expedition'`).
- `day, wave` — day = wave count.
- `resources` — `ammo, sniperAmmo, turretAmmo, medicine, food, materials`.
- `soldiers` — active squad (max 6 alive non-expedition).
- `reserve` — bench (max 8).
- `zombies, humans, barricades, turrets, bullets, effects` — live entities.
- `soundQ` — event queue drained by `processSounds()`.
- `isHumanWave` — true while the wave is a knifeman/gunman wave.
- `lastEvacWave, expeditionsToday` — gating for the evac and sortie buttons.
- `radioMsg` — `{ text, at, dur, category }` for the HUD subtitle.

---

## 5. Entities

### Soldier (`mkSoldier`)
Created with `name, weapon, destX, hp?, lane?, civilian?, onRoof?, opts?`
where `opts = { veteran }`. Stamps `kind` ('recruit' / 'civilian' /
'veteran'), `maxHp` from `KIND_HP` (100 / 70 / 120), and a deterministic
`voicePitch` Hz (six tonal steps hashed from name + kind). All gameplay
state zeroed.

### Zombie (`mkZombie`)
Spawns at `x = CW + 50`, random lane, jittered speed. Type drawn from
ZTP at the spawn site.

### Human (`mkHuman`)
Hostile knifeman or gunman, random lane. Drops `[3, 8]` ammo on death.

### Barricade (`mkBarricade`)
3-lane perspective wall, 140 HP. Zombies attack barricades before the
wall behind them.

### Turret (`mkTurret`)
Machine-gun emplacement. Costs materials + initial belt of turretAmmo.
Fires at the closest in-range enemy, draws from `gs.resources.turretAmmo`
(decoupled from infantry ammo).

### Bullet
`{ id, x, y, dx, dy, dmg, life, shooterId? | hostile? | spit? }`.
Tagged so the collision pipeline routes the bullet to the right target
list (zombies / humans / soldiers).

### Effect — same `blood`, `shell`, `txt`, `hit`, `slash` types.

---

## 6. Weapons (`WPN`)

`rifle, pistol, shotgun, sniper` — each with `name, dmg, range, rate (ms),
ammo (mag size), rl (reload ms), spd (bullet px/frame), sp (spread
radians), pel (pellet count, shotgun only), ammoCost`.

Soldier weapon pools by kind (see `data/expeditions.js`):
- `RECRUIT_WEAPONS`  = `[rifle, rifle, pistol, pistol, shotgun]`
- `CIVILIAN_WEAPONS` = `[pistol, pistol, pistol, shotgun]`
- `VETERAN_WEAPONS`  = `[rifle, rifle, rifle, shotgun, sniper]`

`KIND_HP = { recruit: 100, civilian: 70, veteran: 120 }`.

---

## 7. Lane / depth system

3 lanes, each with a `dy` (Y offset) and `sc` (sprite scale). Soldiers,
zombies, and humans are all positioned via `(x, lane)` and rendered via
`laneY` + `laneSc` applied on the canvas transform. Lane order during
render: back → mid → front so depth occlusion reads correctly.

---

## 8. Soldier selection / movement

Click on a soldier to select (highlight ring). Click empty space to move
the selected soldier (or the whole squad if nothing selected) to that
target lane + x. Buttons in the management screen also let you select via
the soldier-card row.

ADVANCE / RETREAT shift the squad target by ±80 px in the active lane,
and fire a radio chatter callout in the selected soldier's voice
("Moving up!" / "Falling back!").

---

## 9. The rooftop sniper (Delta)

Delta starts on the rooftop at `(WX-40, GY-160)`. She has her own
`sniperAmmo` resource pool and her own renderer (`dRooftopSniper`).
She targets the furthest visible enemy and fires through-and-over the wall.
When `sniperAmmo === 0` she climbs down to the ground at the start of the
next wave; she climbs back up on wave clear if the pool is replenished.

---

## 10. Audio

`AudioEngine` is lazy-created on first `getAM()` so we never violate
browser autoplay policy. The siege loop pushes events onto `gs.soundQ`
and once per frame `processSounds()` drains the queue.

### SFX library (procedural)
`shot`, `reload`, `shell`, `hit`, `zdie`, `groan`, `zatk`, `bhit`,
`wclr`, `heliStart` / `heliStop`, `siren`, `scream`, `crackle`,
`windStart` / `windStop`, `cityHum` / `cityHumStop`, `titleSting`,
`chatter`.

### Radio chatter (`audio/radio.js`)
`pushRadio(state, category, opts)` picks a line from `RADIO_LINES`,
hashes the text → stable pitch (or uses `opts.speaker.voicePitch`), and
schedules a procedural buzz through vowel-formant bandpass filters
bracketed by radio-click noise bursts. A subtitle is stored on
`state.radioMsg` for `dRadioSubtitle` to render. Categories: `advance`,
`retreat`, `reload`, `hurt`, `kill`, `evacIn` / `evacBoard` / `evacOut`,
`deploy`, `lowAmmo`, `baseHit`, `defeat`. Per-state cooldown 1.3 s.

---

## 11. Expedition system

### Sortie limit
`BALANCE.expeditionsPerDay = 2`. Counter resets on next wave.

### Location pool (`data/expeditions.js`)
`DEST_POOL.{LOW, MED, HIGH}` lists 16 city locations (Pharmacy,
Supermarket, Hardware Store, Convenience Store, Diner, Police Station,
Residential Block, Gun Shop, School Shelter, Gas Station, Clinic, Central
Hospital, Office Tower, Shopping Mall, Precinct HQ, Industrial Depot).
`rollDestinations()` picks one location per risk tier — re-rolled on every
fresh sortie session via `resetExp()`. Each location carries a `biome`,
`loot[]` table, and `desc`.

### Auto-dispatch (`expedition/auto.js`)
`resolveExpedition` rolls a threshold-based outcome with damage scaled by
preparation (HP / weapon / ammo). KIA chance is capped. Rewards scale with
the current wave (+5 % per wave above 1, capped at +100 %). Veteran-rescue
chance: LOW 0%, MED 12%, HIGH 25%. `resolvePartyExpedition` aggregates
multi-soldier dispatch with diminishing-returns reward merging.

### Playable mission (`update/mission.js`)
1900 px world. Lead soldier is player-controlled; followers AI-shoot in
range and switch to knife on dry magazine. Components:

- **Hazards**: mines (shootable, AoE 40 px, hp 1) + acid pools (slow 50%,
  2 dmg per tick).
- **Zombies**: walker / runner / tank / spitter / brute. Spitter is gated
  to `wave >= 3` and scales damage + fire rate with wave.
- **Brute boss** at the end of HIGH-risk missions: 600 HP, 1.7× scale,
  labelled `★ BRUTE ★`.
- **Pickups**: per-biome loot table + civilian (rescue, +HP) +
  lostSoldier (rescue, veteran recruit).
- **Rescuables**: civilians along the path the player can lead back to
  the goal zone.
- **Survivor encounters** (MED 28%, HIGH 40%):
  - **Hostile** bandits — immediate firefight. Bandits carry civilian
    weapons (pistol-heavy), damage × 0.55, rate × 1.6 slower, spread
    × 2.2 wider than military weapons.
  - **Trader** camp — dialog with `✓ ACCEPT` / `✖ REFUSE`. Accept swaps
    resources from `gs.resources` against `m.collected`. Refuse turns
    every camper hostile.
  - Zombies attack activated humans too (bandits / refused traders),
    not just the squad. The encounter zone (220 px around the camp) is
    cleared of zombies at spawn AND on player approach so the player
    fights one faction at a time.
- **DEFEND objective** (30 % of MED+HIGH): reach a sandbag emplacement at
  `MISSION_W * 0.45`, then hold for 45 s. A scripted ambush of 3-6
  zombies is pre-placed past the anchor.
- **Fork sections** (50 % chance on MED+HIGH non-DEFEND missions): high
  and low lanes between 40 % and 62 % of the map with exclusive pickup
  clusters. Switch lanes with W / S. Followers track the lead's lane.
- **Lead promotion**: if the player avatar dies, the first living
  follower is promoted to lead and the mission continues. Mission only
  fails when the whole party is dead. New lead's name is announced via a
  radio callout.
- **Goal kill-ratio gate**: the goal beacon only unlocks once the player
  has killed at least `BALANCE.missionGoalKillRatio` (~65 %) of activated
  enemies — prevents a sprint past everything.

### Civilians and reserve
Rescued civilians go to `gs.reserve`. The `🚁 EVAC` button (cooldown
`BALANCE.evacWaveCooldown` waves, min `BALANCE.evacMinReserve` reserve
civilians) flies them out via the procedural helicopter cinematic for a
resource payout.

---

## 12. Cinematics

All three cinematics share the same pattern: a ref state
(`introRef` / `defeatRef` / `evacRef`) is set, `scr` is switched to the
cinematic name, and the render loop checks these refs BEFORE any
gameplay branch. Each cinematic owns its own audio queue
(`intro.soundQ` etc.) drained per frame.

### Opening intro (`render/intro.js`)
50 s, 14 storyboarded shots:

1. **Café Drinker** — patron at a café reading a CITY ALERT on his
   phone, lit by the pulsing red banner.
2. **Quiet Street** — calm pre-outbreak night street, pedestrians,
   parked car, a cat crossing.
3. **Zombie Bite** — close-up of a screaming woman being bitten by a
   real `dZombie` sprite (scaled up).
4. **Family Fleeing** — silhouette adult + child running, three zombies
   pursuing.
5. **Street Chaos** — overturned burning car, ~14 panicked silhouettes,
   zombies mixed in, red alert pulse.
6. **Cop Firing** — full mid-shot NHPD officer in tactical stance
   (`dSoldier` with `police: true`, peaked cap), muzzle flash + brass
   casings + bullet streaks.
7. **Police Line** — five cops (mix of peaked caps + SWAT helmets),
   each with a scripted `deathAt` so the line collapses one by one.
   Ten attacker zombies stop at their target cop and maul on arrival.
   Four corpses on the road from earlier cop fire.
8. **Cop Dragged** — wounded officer on his back, mauled by two
   zombies, firing his pistol wildly into the air.
9. **Last Defender** — lone soldier (`dSoldier`, rifle, shoot state)
   firing right with a burning wreck behind him.
10. **Street Dead** — wide of the killzone with seven bodies, a smoking
    car, helicopter pulling out into the distance.
11. **Convoy Wide** — two Humvees + a 6-wheel troop truck rolling toward
    Fort Omega, white US Army stars + soldiers in roof turrets + headlight
    cones + dust trail.
12. **Convoy Close** — close on a soldier on top of the truck, wind
    streaks, breath cloud, Fort Omega growing on the horizon.
13. **Soldier Aiming** — real `dSoldier` sniper at the wall raising the
    rifle, scope at eye level.
14. **Fort Wide** (closing shot) — squad of 5 soldiers deployed AT
    GROUND LEVEL in front of the wall, facing right, with small dirt-bag
    mounds at their feet. 22 zombies at 0.42× scale slowly approach from
    the far horizon (creep ~120 px over 7 s). Searchlight beam from the
    watchtower over the killzone. Title `DEAD PERIMETER` rises with
    staggered taglines.

### Game-over defeat (`render/defeat.js`)
24 s, 4 phases:

1. **Breach** (0-5 s) — defenders in a line in front of the wall, firing
   at the approaching horde. Wall damage starts (cracks at 2.5 / 4 s).
2. **Overrun** (5-12 s) — black breach gap appears at 5.5 s and widens.
   Charlie falls at 6.5 s, Bravo at 9.5 s. Killer zombies bite into each
   fallen defender in `attack` state with mauling jitter.
3. **Last Stand** (12-19 s) — Delta falls at 14 s. Alpha alone from
   16 s — `dSoldier` switches to `knife` state once his ammo would be
   empty. Three zombies converge on him; he falls at 17.5 s.
4. **Silence** (19-24 s) — wall reduced to jagged stubs, defenders left
   exactly where they fell with killer zombies still on them, dead-zombie
   corpses on the road from the firefight, smoke drifting, a handful of
   walker zombies shambling among the bodies. Title `FORT OMEGA HAS
   FALLEN` rises with staggered taglines.

Per-defender voice lines fire at each `hurtAt` time ("I'm hit!" /
"Mag dry!" / "They're everywhere!" / "For Fort Omega!") via
`pushRadio('defeat', { speaker, line })`.

### Helicopter EVAC (`render/evac.js`)
5.4 s, 3 phases:
1. **Inbound** — UH-60 Black Hawk slides in from the left with eased
   slide-in. Engine-glow ramps up.
2. **Boarding** — chopper hovers over the wall, cargo door open, civilians
   ascend rope ladder to the door staggered, light spotlight cone
   beneath, pilot radio "Door's open!".
3. **Departing** — chopper exits right, engine glow re-ignites, rotor
   sound fades out, "Wheels up!" radio.

Looping rotor SFX layered with sweeping wind. Civilians removed from
`gs.reserve` and resources granted at the end (or on SKIP).

---

## 13. Barricades + turrets

Built from `gs.resources.materials`. Barricades span all 3 lanes as a
single 140-HP perspective wall. Turrets are emplaced at a single x +
lane and fire at the closest in-range enemy using `turretAmmo` (separate
from infantry `ammo` — refilled via `🟠` pickups from playable missions
and as MED+HIGH auto-dispatch rewards).

---

## 14. Game loop architecture

Inside the `useEffect` in `DeadPerimeter.jsx`:

```js
const loop = now => {
  const dt = Math.min(now - prevT.current, 50); prevT.current = now;
  const gs = gsRef.current;

  // Cinematic overrides — owned by their refs, drawn before anything else
  if (introRef.current)   { ...drawIntro;  if (over) finishIntro();  return; }
  if (defeatRef.current)  { ...drawDefeat; if (over) finishDefeat(); return; }
  if (evacRef.current)    { ...drawEvac;   if (over) applyEvac();    return; }

  // Mission override
  const m = missionRef.current;
  if (m) { ...updateMission + dMissionWorld + dMissionHUD; return; }

  // Siege
  if (gs && gs.phase === 'siege') {
    if (!pausedRef.current) { update(gs, now, dt); processSounds(gs.soundQ, ...); }
    if (gs.phase !== 'siege') {
      // Transition: 'gameover' routes through the defeat cinematic
      if (gs.phase === 'gameover' && !defeatRef.current) {
        defeatRef.current = { startedAt: 0 };
        setScr('defeat');
      } else {
        setScr(gs.phase);
      }
    } else {
      // Render siege scene
    }
  }
  rafId.current = requestAnimationFrame(loop);
};
```

UI snapshots happen every 250 ms (`Math.floor(now/250)`) to avoid 60 fps
React reconciliation.

---

## 15. Versions changelog

| Version | Major changes |
|---------|---------------|
| V1–V4   | Base game, lanes, barricades, expeditions, civilians, rooftop sniper. |
| V5–V7   | Per-soldier selection, `sniperAmmo` resource, mission pickups for sniper ammo, Delta climb-back. |
| V8      | Refactored rooftop sniper into a separate `dRooftopSniper` renderer. |
| V8-Modular | Single file split into ~25 modules. Hostile human survivor waves shipped. |
| V8-Modular Polish | Pause / save / touch / configurable difficulty curve. |
| **Current** | Multi-soldier playable missions with AI followers + lead promotion. Mines, acid pools, Spitter, Brute boss. DEFEND objective + sandbag emplacement. Fork (high/low) sections. 16-location rotating destination pool + 3 biomes. Survivor encounters: bandit firefight + trader dialog. Reserve roster + helicopter EVAC animation. Machine-gun turrets with dedicated ammo. 50 s opening cinematic. 24 s defeat cinematic. Procedural Web Audio extended with helicopter rotor, sirens, screams, fire crackle, wind, city hum, title sting, radio chatter. Per-soldier voice pitch + HUD subtitles. Improved Fort Omega base art (watchtower, concertina wire, gate, sandbag emplacement, floodlights, insignia). |

---

## 16. Known issues / quirks

- Switching tabs throttles `requestAnimationFrame` so the game pauses
  automatically; `Esc` is still the preferred pause.
- `selectedSoldierId` is not cleared when returning from a mission. Usually
  fine because the selected soldier was the one on the mission.
- The opening cinematic only plays on `BEGIN OPERATION` (new game), not on
  `CONTINUE SAVED RUN` — by design.
- The defeat cinematic plays on every game-over, including after
  `TRY AGAIN`. Skippable.

---

## 17. Pending features (roadmap)

### ✅ Shipped

- Hostile human survivor waves (knifemen + gunmen + ammo drops)
- Pause / resume with `Esc`
- Save / load to `localStorage`
- Mobile touch controls
- Configurable wave difficulty curve (`data/difficulty.js`)
- Multi-soldier playable expeditions with AI followers
- Day-limit on sorties (gated at wave 2)
- Helicopter civilian evac animation
- Roster bench / activate (reserve up to 8)
- Machine-gun turrets with dedicated ammo pool
- Per-destination biomes (3 palettes) + randomised mission layout
- Mines + acid pools + Spitter + Brute boss
- Rescuable civilians along mission paths
- DEFEND objective + sandbag emplacement
- Branching mission paths (high / low lanes via W/S)
- 16-location rotating destination pool
- Wave-scaled mission difficulty (spitter gated at wave 3) + scaled rewards
- Soldier kinds: recruit / civilian (70 HP, pistol-only) / veteran (120 HP)
- Lost-soldier rescue pickup (rare veteran find)
- Survivor encounters: hostile bandits + trader dialog with accept/refuse
- Zombies attack activated humans
- Mission lead-down promotion
- Opening cinematic (50 s, 14 shots, procedural audio + voices)
- Defeat cinematic (24 s, 4 phases, defender deaths choreographed)
- Tactical-radio chatter with per-soldier voicePitch + HUD subtitles
- Fort Omega base rebuilt (watchtower, sandbags, concertina, gate,
  floodlights, insignia, loopholes, battle damage)

### ⏳ Optional / nice-to-have

- Real audio samples to replace the procedural engine (clean swap in
  `audio/AudioEngine.js`).
- Sprite caching (offscreen canvas per entity type) — not needed at
  current entity counts.

---

## 18. Architectural decisions worth preserving

1. **Game state in a single object**, mutated in place. React only sees
   periodic snapshots via `setUi`.
2. **`gsRef.current`** holds the mutable state; the canvas reads from it.
3. **Cinematic and mission override refs are checked BEFORE `gs.phase`**
   in the loop. Each override owns the canvas fully when active.
4. **Refs for inputs and expedition selections**, not React state, to avoid
   stale closures in `useCallback`.
5. **Lane scaling is applied on the canvas transform**, not pre-baked into
   sprite coordinates.
6. **Audio uses a per-frame queue** (`gs.soundQ` / `m.soundQ` / etc.)
   drained at the end of `update`.
7. **No cycles between modules**: `constants` → `data` → `entities` →
   `render`/`update`/`expedition`/`audio` → `DeadPerimeter.jsx`.
8. **Cinematic sprites reuse the live-game renderers**: intro/defeat
   call `dSoldier` / `dZombie` directly via a `dSpriteAt(drawFn, ctx,
   entity, screenX, screenFootY, scale, now)` helper so the cinematic
   stays visually consistent with gameplay.

---

## 19. Quick file map

- `src/audio/AudioEngine.js` — class + `getAM()` + `processSounds()`.
- `src/audio/radio.js` — `RADIO_LINES`, `pushRadio(state, category, opts)`.
- `src/constants.js` — `CW, CH, GY, WX, LANES, C, laneY, laneSc, clickToLane, uid, rng`.
- `src/data/{weapons,zombies,humans,biomes,difficulty,expeditions}.js` — static config.
- `src/entities/{soldier,zombie,barricade,human,turret,wave,gameState,persistence}.js` — factories + storage.
- `src/render/*` — every `dXxx` draw function. `intro.js` + `defeat.js` +
  `evac.js` are full cinematics.
- `src/update/siege.js` — main siege tick (`update`).
- `src/update/mission.js` — `mkMission`, `updateMission`, mission draw functions.
- `src/expedition/{auto,missionFinish,events}.js` — expedition logic.
- `src/DeadPerimeter.jsx` — React component, hooks, callbacks, JSX screens.

---

## 20. How to run

See [`README.md`](./README.md) for install + launch instructions. TL;DR:

```bash
node -v          # must be >= 20
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```
