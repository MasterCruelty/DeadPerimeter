# Migrating Dead Perimeter to Claude Code

> **Status:** ✅ Migration completed. The Vite + React scaffold described
> below is checked in; the single-file source has been split into the
> module layout from §7. This document is preserved for historical context
> and as a reference for the Pi-deployment options in §8.

This guide walks through moving `DeadPerimeterV7.jsx` from this chat-based artifact
environment into a real local React project that you can run, iterate on, and
develop further with Claude Code.

---

## 1. Why migrate

The chat artifact runtime is convenient but limited:
- No persistent file system between sessions.
- No real dev server, hot module reload, or DevTools profiling.
- Every iteration regenerates the entire file from scratch.
- Difficult to integrate external assets (sprite sheets, real audio files, fonts).

Claude Code runs a proper editor + terminal, so you get:
- A real Vite dev server with HMR.
- Stable file system, git history, branches.
- Multi-file refactors (split the 2000-line file into modules).
- npm packages, browser DevTools, performance profiling.

---

## 2. Prerequisites

Install on your Raspberry Pi (or wherever you'll run dev):

```bash
# Node 20+ is required by Vite. Check current version:
node -v

# If Node is older than 20, upgrade. On Debian/Raspbian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify:
node -v   # should be v20.x
npm -v
```

> Note: building React + Vite on a Raspberry Pi works but is slow. Consider
> developing on a desktop/laptop and only deploying the built bundle to the Pi.

---

## 3. Create the project

```bash
npm create vite@latest dead-perimeter -- --template react
cd dead-perimeter
npm install
```

You should now have a tree like:

```
dead-perimeter/
├── index.html
├── package.json
├── vite.config.js
├── public/
└── src/
    ├── App.jsx
    ├── main.jsx
    └── index.css
```

---

## 4. Drop in the game

1. Copy `DeadPerimeterV7.jsx` into `src/DeadPerimeter.jsx` (drop the `V7`
   suffix — version it via git from now on).
2. Replace the contents of `src/App.jsx` with:

   ```jsx
   import DeadPerimeter from './DeadPerimeter.jsx';

   export default function App() {
     return <DeadPerimeter />;
   }
   ```

3. Clear `src/index.css` (the game renders its own styles inline) or leave it
   empty.

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:5173` (or whatever port Vite prints). The game
   should run with hot reload.

---

## 5. Initialise git

```bash
git init
git add .
git commit -m "Import Dead Perimeter V7 from chat artifact"
```

Tag the import:

```bash
git tag v7-chat-import
```

From here, every feature/fix gets its own commit (or branch). No more
"V8.jsx, V9.jsx" — use git tags or branches instead.

---

## 6. Open the project in Claude Code

```bash
claude  # from inside the dead-perimeter directory
```

Then tell Claude Code something like:

> Read `src/DeadPerimeter.jsx` and `PROJECT_STATE.md`. I want to continue
> development from V7. The first thing I want to add is X.

Claude Code will:
- See the whole file tree (not just one artifact).
- Make targeted edits with the str_replace tool.
- Run `npm run dev`, lint, tests, or any other command via bash.
- Commit changes with descriptive messages.

---

## 7. Recommended next refactors

The 2000-line single-file structure works but is hard to navigate. Split it:

```
src/
├── DeadPerimeter.jsx          # Main component + game loop
├── audio/
│   └── AudioEngine.js
├── constants.js               # CW, CH, GY, WX, LANES, C palette
├── entities/
│   ├── soldier.js             # mkSoldier
│   ├── zombie.js              # mkZombie + ZTP
│   ├── barricade.js           # mkBarricade
│   └── wave.js                # mkWave
├── update/
│   ├── siege.js               # update(gs, now, dt)
│   └── mission.js             # updateMission(m, now, dt)
├── render/
│   ├── background.js          # dBg
│   ├── base.js                # dBase
│   ├── soldier.js             # dSoldier
│   ├── zombie.js              # dZombie
│   ├── weapons.js             # dWpn
│   ├── effects.js             # dFx, dBlt, dBarricade
│   └── hud.js                 # dHUD, dSquadMarker
├── expedition/
│   ├── auto.js                # resolveExpedition
│   ├── mission.js             # mkMission, finishMission
│   └── events.js              # genEvents (narrative log)
└── data/
    ├── weapons.js             # WPN dictionary
    ├── zombies.js             # ZTP dictionary
    └── expeditions.js         # EXPEDITION_DESTS
```

Ask Claude Code to do this in stages — split one module per commit so it stays
reviewable.

---

## 8. Running on the Raspberry Pi

For dev, the dev server is too heavy for a Pi. Two options:

### Option A: develop on desktop, deploy build to Pi

```bash
# On desktop:
npm run build
# Produces dist/

# Copy dist/ to the Pi:
scp -r dist/ pi@raspberrypi.local:/var/www/dead-perimeter
```

Serve it with nginx, or any static server. The game is pure client-side, no
backend required.

### Option B: develop fully on Pi

It works but expect slow first builds. Subsequent HMR reloads are fast. Make
sure `/tmp` is `tmpfs` (you already do this) and that node_modules lives on the
SD card with `noatime` mounted — same SD-safety principles you apply to your
bots.

---

## 9. Things worth doing once on Claude Code

These were impractical in the chat environment:

- **Replace inline styles with a CSS module** or Tailwind. Faster iteration on
  UI tweaks.
- **Move procedural audio into a real `AudioEngine` module** with optional
  sample loading. You could swap in actual gunshot/zombie samples without
  changing the game logic.
- **Persist game state to `localStorage`** so the player can resume after a
  refresh. The artifact runtime forbade browser storage — your local build can
  use it freely.
- **Add a tests folder** (`vitest`) for the pure helpers — `mkWave`, expedition
  reward generation, sniper-descent logic. Pure functions = trivial to test.
- **Profile the canvas render**. With Chrome DevTools you can see exactly which
  draw call dominates. The lane-by-lane render loop is a likely candidate for
  caching.
- **Mobile touch input** for moving soldiers (tap to select, drag to move).
- **Pause / resume** with `Esc` (currently can't pause).
- **Save slot system** so you can keep multiple campaigns.

---

## 10. If anything breaks

The most common issues after migration:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank canvas, console error about `useState` undefined | React not installed | `npm install` |
| `Uncaught ReferenceError: process is not defined` | Code references `process.env` | Use `import.meta.env` instead |
| Audio doesn't start | Browser blocked AudioContext before user gesture | Already handled — first click resumes it |
| Game loop runs but is jittery | Vite HMR re-mounted the component | Refresh the page once; ensure the `useEffect` cleanup cancels `rafId` |
| Build fails on Pi with "JS heap out of memory" | Vite needs more memory | `NODE_OPTIONS=--max-old-space-size=2048 npm run build` |

---

## 11. Next session checklist

When you open Claude Code, paste this as your first message:

> I'm continuing development of "Dead Perimeter", a 2D zombie siege survival
> game in React + Canvas 2D. The full state of the project is documented in
> `PROJECT_STATE.md` at the repository root. Please read that file and
> `src/DeadPerimeter.jsx` before making any changes. The current version is
> V7. Pending work: implement the human survivor wave system (see
> PROJECT_STATE section "Pending features"). Acknowledge once you've read both
> files, then propose an implementation plan.

That gives Claude Code enough context to pick up exactly where you left off.
