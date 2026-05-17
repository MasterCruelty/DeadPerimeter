# Dead Perimeter

> A 2D side-scrolling **zombie siege survival** game built in React + Canvas 2D.
> Defend **Fort Omega** across three depth lanes against waves of the dead,
> ambushes by hostile survivor gangs, and the occasional Brute boss. Between
> waves, send sortie parties into the ruined city — auto-resolved or played
> live as a 1900 px side-scrolling mission — to scavenge supplies, rescue
> civilians, recover lost soldiers, and trade with survivor camps.

![Build](https://img.shields.io/badge/build-vite%205-blue) ![Node](https://img.shields.io/badge/node-%3E%3D20-success) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Highlights

### The siege
- **3 depth lanes** (FRONT / MID / BACK) with per-lane scaling, occlusion, and
  click-to-position movement.
- **Up to 6 active soldiers** plus a reserve roster of up to 8, swappable
  between sieges.
- **Delta the rooftop sniper** with a dedicated `sniperAmmo` pool — climbs
  down to fight on the ground when the pool runs dry.
- **Machine-gun turrets** with a dedicated `turretAmmo` pool, built from
  materials.
- **Barricades** that span all three lanes as a single perspective wall.
- **Knife melee** fallback when soldiers run out of ammo.
- **Hostile human survivor waves** (every 5 waves from wave 4): knifemen rush
  the wall while gunmen open fire from range. They drop ammo on death.
- **Pause / resume** with `Esc`, **save / load** to `localStorage`, **mobile
  touch controls**, and a **configurable difficulty curve**.

### Sorties & expeditions
- **Two modes** per sortie: **AUTO-DISPATCH** (animated text narrative + dice
  roll on risk) or **PLAY LIVE** (a 1900 px side-scrolling mini-mission).
- **Multi-soldier playable missions**: pick up to 3 soldiers; the first is
  the player avatar, the rest follow as AI companions.
- **Lead-down promotion**: when the player avatar falls, a living follower
  is promoted to take point — the mission only fails when the entire party
  is dead.
- **Rotating city destinations**: every sortie session rolls one location
  per risk tier from a pool of 16 (Pharmacy, Supermarket, Hardware Store,
  Police Station, Gun Shop, School, Clinic, Gas Station, Central Hospital,
  Office Tower, Shopping Mall, Precinct HQ, Industrial Depot, …) — each
  with its own loot table and biome.
- **Three biomes** (Hospital / Armory / Downtown) with palette, building
  silhouettes, obstacle props, and lighting.
- **Three soldier kinds**: standard recruits (cost food + materials), rescued
  civilians (weaker, pistol-only), and rare lost military soldiers
  (veterans — sniper-capable, 120 max HP).
- **Mission objectives**: REACH (run-to-the-goal) or DEFEND (hold a sandbag
  emplacement for 45 s against a scripted ambush) — DEFEND missions are
  signposted with a sandbag U-fortification and a "LAST STAND" flag.
- **Branching paths** in some missions: high and low lanes with exclusive
  pickup clusters; switch with `W` / `S`.
- **Hazards**: shootable AOE mines + acid pools (slow + damage tick).
- **Ranged zombies** (Spitters), **Brutes** (HIGH-risk end-of-stage boss),
  Tanks, Runners, Walkers — wave-scaled.
- **Survivor encounters** mid-mission: peaceful trader camps (offer trades
  via a centered dialog — accept to swap resources, refuse to fight) or
  hostile bandits (immediate firefight). Zombies leave both camps alone
  until they activate.

### Cinematics & audio
- **Opening cinematic** (50 s, 14 storyboarded shots): café patron reading
  a CITY ALERT on his phone, the outbreak hitting, NHPD containment line
  with classic peaked caps and SWAT helmets, the line falling, a burning
  city, a military convoy of Humvees + troop truck rolling toward Fort
  Omega, and the squad deployed on the ground in front of the wall as
  zombies approach from the horizon.
- **Game-over cinematic** (24 s): the wall is breached, the perimeter is
  overrun, defenders fall one by one (each visibly mauled by a specific
  zombie), Alpha makes a last stand and goes to knife when his ammo runs
  out, and finally Fort Omega has fallen.
- **Helicopter evacuation animation**: a procedural UH-60 Black Hawk flies
  in, hovers over the wall, civilians ascend a rope ladder to the open
  cargo door, and the chopper departs.
- **Tactical radio chatter** with **per-soldier voice pitch** (deterministic
  hash of name → six tonal steps), HUD subtitles, and triggered events:
  ADVANCE / RETREAT, reload, low-HP "I'm hit", kill confirmation, evac
  pilot callouts, and defeat lines.
- **Procedural Web Audio** for everything (no audio files): gunshots,
  reloads, zombie groans, base hits, kick beats, helicopter rotor, city
  hum, wind, sirens, screams, fire crackle, two-tone musical sting.

---

## Requirements

| | |
| --- | --- |
| Node.js | **20 or newer** (Vite 5 dropped support for older versions) |
| Package manager | npm 10+ (bundled with Node 20) |
| Browser | Anything modern with Canvas 2D + Web Audio (Chrome, Firefox, Safari, Edge) |
| OS | Linux, macOS, Windows. Tested on Linux. |

A `.nvmrc` file pinning Node 20 is included. If you use `nvm`:

```bash
nvm use   # picks up .nvmrc
```

If `node -v` reports an older version, upgrade via your package manager or
NodeSource:

```bash
# Debian / Ubuntu / Raspberry Pi OS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## Quick start

```bash
git clone https://github.com/MasterCruelty/DeadPerimeter.git
cd DeadPerimeter
npm install
npm run dev
```

Then open `http://localhost:5173/` in a browser. **Click the canvas once** so
the browser unlocks the AudioContext (browser autoplay policy), then play.

### Production build

```bash
npm run build       # bundles to dist/
npm run preview     # serves dist/ on http://localhost:4173
```

The game is fully client-side. `dist/` can be served by any static host
(nginx, Caddy, GitHub Pages, Netlify, `npx serve dist`, etc.).

---

## Running with Docker

The repo ships with a multi-stage `Dockerfile` and a `docker-compose.yml`
so you can run the game in a fully isolated container — no local Node
install required.

### Production (nginx serves the static bundle)

```bash
docker compose up -d                # → http://localhost:8080
docker compose logs -f              # tail nginx logs
docker compose down                 # stop and remove the container
```

The image is built by the `prod` stage:
- Stage 1 (`deps`)  → `node:20-alpine`, installs dependencies via `npm ci`.
- Stage 2 (`build`) → runs `npm run build`, emits `/app/dist`.
- Stage 3 (`prod`)  → `nginx:1.27-alpine` with our `nginx.conf` (gzip,
  hashed-asset caching, SPA fallback), serving `dist/` on port 80.
- Built-in `HEALTHCHECK` hits `http://127.0.0.1/`.

You can also build it directly with the Docker CLI:

```bash
docker build -t dead-perimeter .
docker run --rm -p 8080:80 dead-perimeter
```

### Development (Vite dev server with hot reload)

```bash
docker compose --profile dev up     # → http://localhost:5173
```

This builds the `dev` stage of the Dockerfile, mounts your source tree
into `/app`, and starts `npm run dev`. Edits on the host trigger HMR
inside the container. `CHOKIDAR_USEPOLLING=true` is set so file watching
is reliable across the bind mount on every host platform.

Direct CLI equivalent:

```bash
docker build --target dev -t dead-perimeter:dev .
docker run --rm -it -p 5173:5173 \
  -v "$PWD":/app -v /app/node_modules \
  dead-perimeter:dev
```

### Notes

- Image size: ~50 MB for the prod image (alpine + nginx + ~1 MB of static
  assets) and ~350 MB for the dev image (alpine + Node 20 + node_modules).
- The Dockerfile uses no privileged build flags and no BuildKit-only
  syntax — it builds on any Docker ≥ 20.10.
- `.dockerignore` excludes `node_modules`, `dist`, `.git`, and editor /
  OS junk from the build context.

---

## Controls

### Menu / management

| Action | Input |
| --- | --- |
| Start a new game | `⚔  BEGIN OPERATION` (plays the 50 s intro cinematic) |
| Continue a saved game | `↻  CONTINUE SAVED RUN` (skips the intro) |
| Skip a cinematic | `SKIP →` button top-right of canvas |

### Siege screen

| Action | Input |
| --- | --- |
| Select a soldier | Click on him in the canvas |
| Deselect | Click the same soldier again |
| Move the selected soldier to a lane | Click on an empty spot in the desired lane |
| Move the whole squad (no selection) | Click anywhere on the battlefield |
| Retreat / advance | `◀ RETREAT` / `ADVANCE ▶` buttons (also fires radio chatter) |
| Pause / resume | `Esc` or the button under the canvas |
| Mute / unmute | Speaker icon in the top-right of the canvas |

Lanes are picked by Y coordinate of the click:
`above GY-50 → BACK`, `above GY-20 → MID`, `else → FRONT`.

### Playable expedition (mission)

| Action | Input |
| --- | --- |
| Move left / right | `←` / `→` or `A` / `D` (or tap left/right thirds of canvas on mobile) |
| Switch lane (in fork sections) | `W` / `↑` (high) or `S` / `↓` (low) |
| Fire | `Space` (held) or **left-mouse hold** on the canvas (or tap-center on mobile) |
| Knife (when dry) | Auto-swing in melee range |
| Accept / refuse a trade offer | Click the `✓ ACCEPT` or `✖ REFUSE (fight)` button in the dialog |
| Return to base | "RETURN TO BASE" button once the mission ends |

---

For module-by-module developer documentation see [`CODE.md`](./CODE.md).
For the design / architecture handoff see [`PROJECT_STATE.md`](./PROJECT_STATE.md).

## Architecture overview

```
src/
├── DeadPerimeter.jsx          React component + game loop only
├── constants.js               CW, CH, GY, WX, LANES, color palette, helpers
├── audio/
│   ├── AudioEngine.js         procedural Web Audio (no samples)
│   └── radio.js               RADIO_LINES + pushRadio (tactical chatter)
├── data/
│   ├── weapons.js             WPN dictionary
│   ├── zombies.js             ZTP dictionary (walker, runner, tank, spitter, brute)
│   ├── humans.js              HTP (knifeman, gunman), wave cadence
│   ├── biomes.js              hospital / armory / downtown palettes
│   ├── difficulty.js          DIFFICULTY + BALANCE knobs
│   └── expeditions.js         DEST_POOL, RISK_BASE, TRADE_OFFERS, rollDestinations
├── entities/
│   ├── soldier.js     mkSoldier (kind: recruit / civilian / veteran, voicePitch)
│   ├── zombie.js      mkZombie
│   ├── human.js       mkHuman (hostile knifeman / gunman)
│   ├── barricade.js   mkBarricade
│   ├── turret.js      mkTurret
│   ├── wave.js        mkWave, mkHumanWave, isHumanWaveNumber
│   ├── gameState.js   mkGS
│   └── persistence.js save/load to localStorage
├── render/
│   ├── background.js  base.js   weapons.js
│   ├── soldier.js     zombie.js human.js   turret.js
│   ├── effects.js     hud.js    (dRadioSubtitle)
│   ├── evac.js        UH-60 Black Hawk helicopter cinematic
│   ├── intro.js       50 s opening cinematic (14 shots)
│   └── defeat.js      24 s game-over cinematic
├── update/
│   ├── siege.js               main tick — branches on isHumanWave
│   └── mission.js             playable side-scroll mission engine
└── expedition/
    ├── auto.js                resolveExpedition + resolvePartyExpedition
    ├── missionFinish.js       finishMission (live mission → game state)
    └── events.js              genEvents (narrative log)
```

Architectural rules worth preserving (see `PROJECT_STATE.md` §17):

1. Game state lives in a **single mutable object** held by a `useRef`. React
   only sees periodic snapshots via `setUi`, not every frame.
2. **The render loop checks override refs first**: `introRef` → `defeatRef` →
   `evacRef` → `missionRef` → `gs.phase === 'siege'`. Each cinematic phase
   owns the canvas fully when active.
3. The **lane scale** is applied on the canvas transform, never baked into
   entity coordinates.
4. **Audio uses a per-frame queue** (`gs.soundQ`, `m.soundQ`, etc.) drained
   at end-of-update so sound triggers are decoupled from the AudioContext.

---

## Roadmap

Tracked in [`PROJECT_STATE.md`](./PROJECT_STATE.md) §17.

- ✅ Hostile human survivor waves
- ✅ Pause / resume / save / load / touch controls
- ✅ Multi-soldier playable expeditions with AI followers
- ✅ Mines + acid pools + Spitter + Brute boss
- ✅ DEFEND objective + sandbag emplacement
- ✅ Branching mission paths (high / low lanes)
- ✅ Survivor encounters (bandits + trader dialog)
- ✅ Helicopter evacuation animation
- ✅ Opening + defeat cinematics with procedural audio
- ✅ Tactical radio chatter with per-soldier voices
- ✅ Civilian / veteran / lost-soldier rescue kinds
- ✅ Machine-gun turrets with dedicated ammo pool
- ✅ Reserve roster + bench / activate
- ⏳ Optional real audio samples
- ⏳ Sprite caching (offscreen canvas) for perf

---

## License

[MIT](./LICENSE) © 2026 MasterCruelty.
