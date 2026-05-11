# Dead Perimeter

> A 2D side-scrolling **zombie siege survival** game built in React + Canvas 2D.
> Defend **Fort Omega** across three depth lanes, send soldiers on expeditions,
> recruit civilians, build barricades, and fend off the occasional **hostile
> survivor gang** before the wall comes down.

![Build](https://img.shields.io/badge/build-vite%205-blue) ![Node](https://img.shields.io/badge/node-%3E%3D20-success) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Highlights

- **3 depth lanes** (FRONT / MID / BACK) with per-lane scaling, occlusion, and
  click-to-position movement.
- **4 starting soldiers** including **Delta**, the rooftop sniper, with a
  dedicated `sniperAmmo` resource pool. Delta climbs down to fight on the
  ground when the pool runs dry.
- **Two expedition modes**:
  - **Auto-dispatch**: animated text narrative + dice roll on risk.
  - **Play live**: a side-scrolling mini-mission with pickups, parallax
    backgrounds, and a goal beacon.
- **Civilian recruits** with a distinct sprite palette (brown jacket, blue
  jeans, red baseball cap).
- **Barricades** that span all three lanes as a single perspective wall.
- **Knife melee** fallback when soldiers run out of ammo.
- **Hostile human survivor waves** (every 5 waves from wave 4): knifemen rush
  the wall while gunmen open fire from range. They **drop ammo on death**.
- **Procedural Web Audio** — gunshots, reloads, zombie groans, base hits, kick
  beats; no audio files required.

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

### Siege screen

| Action | Input |
| --- | --- |
| Select a soldier | Click on him in the canvas |
| Deselect | Click on the same soldier again |
| Move the selected soldier to a lane | Click on an empty spot in the desired lane |
| Move the whole squad (no selection) | Click anywhere on the battlefield |
| Retreat / advance | `◀ RETREAT` / `ADVANCE ▶` buttons |
| Mute / unmute | Speaker icon in the top-right of the canvas |

Lanes are picked by Y coordinate of the click:
`above GY-50 → BACK`, `above GY-20 → MID`, `else → FRONT`.

### Playable expedition (mission)

| Action | Input |
| --- | --- |
| Move left | `←` or `A` |
| Move right | `→` or `D` |
| Fire | `Space` (held) or **left-mouse hold** on the canvas |
| Knife (when dry) | Auto-swing in melee range |
| Return to base | "RETURN TO BASE" button once the mission ends |

---

For module-by-module developer documentation see [`CODE.md`](./CODE.md).

## Architecture overview

```
src/
├── DeadPerimeter.jsx          React component + game loop only
├── constants.js               CW, CH, GY, WX, LANES, color palette, helpers
├── audio/AudioEngine.js       procedural Web Audio (no samples)
├── data/
│   ├── weapons.js             WPN dictionary
│   ├── zombies.js             ZTP dictionary
│   ├── expeditions.js         EXPEDITION_DESTS, RECRUIT_NAMES, etc.
│   └── humans.js              HTP, HUMAN_AMMO_DROP, wave cadence
├── entities/
│   ├── soldier.js   zombie.js  barricade.js
│   ├── human.js     wave.js    gameState.js
├── render/
│   ├── background.js  base.js   weapons.js
│   ├── soldier.js     zombie.js human.js
│   ├── effects.js     hud.js
├── update/
│   ├── siege.js               main tick — branches on isHumanWave
│   └── mission.js             playable side-scroll mission
└── expedition/
    ├── auto.js                resolveExpedition
    ├── missionFinish.js       finishMission
    └── events.js              genEvents (narrative log)
```

Architectural rules worth preserving (see `PROJECT_STATE.md` §18):

1. Game state lives in a **single mutable object** held by a `useRef`. React
   only sees periodic snapshots via `setUi`, not every frame.
2. **`missionRef.current` is checked first** in the loop — playable missions
   override the siege scene entirely.
3. The **lane scale** is applied on the canvas transform, never baked into
   entity coordinates.
4. **Audio uses a per-frame queue** (`gs.soundQ`) drained at end-of-update so
   sound triggers are decoupled from the AudioContext.

---

## Roadmap

Tracked in [`PROJECT_STATE.md`](./PROJECT_STATE.md) §17.

- ✅ Hostile human survivor waves (Priority 1, shipped)
- ✅ Pause / resume with `Esc` (shipped)
- ✅ Save / load to `localStorage` (shipped)
- ✅ Mobile touch controls (shipped)
- ✅ Configurable wave difficulty curve (shipped, `data/difficulty.js`)
- ⏳ Optional real audio samples
- ⏳ Sprite caching (offscreen canvas) for perf

---

## License

[MIT](./LICENSE) © 2026 MasterCruelty.
