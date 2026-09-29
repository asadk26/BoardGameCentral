# One More Room

A Halloween board game for 2–6 players or teams sharing one screen. Sneak
through a miniature haunted mansion, grab candy, bank it at the Entrance Hall,
and decide whether to risk one more room before midnight. Every turn you roll
two dice and choose which one moves you; the other moves the ghost, which hunts
whoever is carrying the most.

## Run it

```sh
cd one-more-room
npm install
npm run dev        # http://localhost:5173 — development server
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
npm test           # rules engine tests (Vitest)
node tests/browser/e2e.mjs   # end-to-end checks in headless Chromium (after a build)
```

`dist/` is fully static and uses relative paths, so it runs from any sub-path.
The collection's Pages workflow builds it and publishes it at
`/The_Town/one-more-room/`.

The browser suite starts `vite preview` itself. It uses Playwright's Chromium
at `/opt/pw-browsers/...` by default; set `CHROME=/path/to/chrome` to use
another, or `URL=http://…/` to test a server that is already running.
Screenshots from each run are written to `test-results/`.

## Layout

```
src/
  engine/            the rules — pure, deterministic TypeScript, no rendering
    config.ts        board graph, node types, candy stocks, cards, characters
    graph.ts         adjacency, BFS, player route enumeration
    rng.ts           seeded mulberry32 RNG and shuffles
    engine.ts        turn state machine, ghost planning, previews, scoring, undo
    save.ts          versioned local save format and text sanitising
    types.ts
  director.ts        plays committed events as animation (never decides outcomes)
  store.ts           app state, dispatch → engine → animation → save
  text.ts            plain-language summaries for the HUD
  audio/audio.ts     procedural Web Audio sound effects and music
  scene/             React Three Fiber scene
    Scene.tsx        pieces, ghost, highlights, lighting, cameras
    Board.tsx        slab, corridors, fading walls, tiles, candy, passages
    Characters.tsx   the six miniatures and their numbered bases
    Ghost.tsx        the shared enemy
    Props.tsx        room furnishings
    layout.ts        world positions, room plots, wall doorways, slots
  ui/                DOM HUD, setup, dialogs, dice
tests/
  engine.test.ts     rules coverage
  browser/e2e.mjs    real-browser play-throughs
```

## How the pieces fit

* **Rules are separate from rendering.** `engine.ts` exposes `apply(state,
  action)` over an explicit phase machine (`turnStart → choose → event →
  ghost → summary → … → gameOver`). Snapshots are immutable; the RNG state,
  deck and discard live inside the snapshot.
* **One simulator for previews and moves.** `previewMove` runs the same
  `resolveMove` and `planGhost` code as a committed move, on a copy, without
  drawing a card or touching the RNG. When the destination is a Trick or Treat
  space the forecast is marked provisional.
* **Animation is playback.** The store commits the engine result and saves it
  before the director animates the events. Skipping, or reloading mid-way,
  shows the same committed outcome — nothing is granted twice.
* **Undo** keeps the snapshot from the start of the current turn and the one
  before it. Restoring a snapshot restores RNG and deck, so a replayed turn
  rolls the same dice and draws the same card.
* **Balancing** lives in `config.ts`: room stocks, harvest size, event cards,
  rounds, the midnight warning round.

## Saves and privacy

Everything is stored in this browser's `localStorage` under keys starting with
`one-more-room/` (the game, setup/personalisation, and sound/motion settings).
Nothing else in storage is read, changed or removed. A save that is damaged or
from another version is reported on the title screen and cleared only when the
player confirms. There is no network access at run time.

## Assets and licences

All art is modelled in code from Three.js primitives; all sound and music is
synthesised at run time with the Web Audio API; labels are drawn on canvases
with system fonts. There are no external images, models, fonts or audio files,
and nothing is fetched from a CDN.

Libraries (MIT licensed): React, React DOM, three.js, @react-three/fiber.
Development only: Vite, Vitest, TypeScript (Apache-2.0), playwright-core
(Apache-2.0).
