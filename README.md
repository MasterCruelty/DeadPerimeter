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
