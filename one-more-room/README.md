# One More Room

A Halloween board game for 2–6 players around one shared screen, with an
optional phone controller for each player. Sneak through a miniature haunted
mansion, grab candy, bank it at the Entrance Hall, and decide whether to risk
one more room before midnight. Each turn you roll two dice. One moves you and
the other moves the house's ghost. Getting caught is no longer the end of your
turn. It starts a short survival game, and losing one turns you into a
playable ghost.

## Rules in brief

* **Ten rounds.** Living players score banked candy + ⌊carried ÷ 2⌋, plus
  **+5** if they are still alive with at least 6 banked. Ghosts score their
  bank plus their bounty. The game ends after round 10, or at once if nobody
  is left alive.
* **Secret traps.** Before round 1, each player secretly nominates one
  corridor space for a Reaper. The game fills the list up to exactly 6 traps
  using the seeded RNG, preferring wings that have fewer traps. Traps stay
  hidden until a living player lands on one with a normal move.
* **Survival challenges replace catch-and-respawn:**
  * *Break the Curse* (an escape ring): when the house ghost catches you.
  * *Dance for Death* or *Graveyard Jump Rope*: a solo test when you land on a
    Reaper trap.
  * *Haunted Jump Rope*: a duel when a player ghost reaches a living player,
    or when you challenge another player. In rounds 1–7 each player needs 5
    of 8 jumps. From round 8 only one survives. Ties go to up to 4
    sudden-death sweeps, then to the smaller timing error, and finally to a
    seeded curse.
  * *Super Reaper* (space 12): a lethal duel against an opponent you choose.
    If nobody is eligible, it is a solo game.
* **Death is irreversible.** A losing player drops all carried candy where
  they fell, keeps their bank, and becomes a spectral ghost. A ghost:
  * rolls one die;
  * can use the ghost-only wall links (7↔10, 22↔25) and the secret passages;
  * can never enter the Entrance Hall;
  * never banks, harvests, picks up candy or draws cards;
  * earns a bounty of 3 for each kill it starts, up to a maximum of 6.
* **Protection.** Surviving a challenge protects you until the end of your
  next turn. A Reaper you already know about, and the Super Reaper, ignore
  protection.
* **One encounter per move.** Checks run in this order: Super Reaper, then a
  duel, then a solo Reaper. The house ghost stops at its first encounter.

The full rules are in the game under *How to play*.

## Run it

```sh
cd one-more-room
npm install
npm run dev        # http://localhost:5173 — development server (local play only)
npm run build      # typecheck, then build the static game into dist/ and the room service into dist-server/
npm run room       # serve dist/ and the phone rooms at http://<this computer>:8787
npm run preview    # serve dist/ at http://localhost:4173 (static, no rooms)
npm test           # engine, fuzz and room-service tests (Vitest)
npm run balance    # headless balance simulations (slow)
node tests/browser/e2e.mjs   # end-to-end checks in headless Chromium (after a build)
```

`dist/` is fully static and uses relative paths and hash routes (`#/join`),
so it works from any sub-path. This repository's Pages workflow publishes it
at `https://asadk26.github.io/BoardGameCentral/one-more-room/`.

### Local play vs phone rooms

* **Local play** needs only the static build. Up to six people share the
  screen and take turns with the mouse or touch. In challenges, two people can
  play at once with separate keys (F/J, A/L, left/right Shift). Bots can fill
  any seat. This works on GitHub Pages.
* **Phone rooms** need the room service, a small Node process
  (`server/main.ts`). It serves the game and a WebSocket endpoint at `/ws`.
  GitHub Pages cannot run it. To play on a home network:
  1. Run `npm run build && npm run room` on a laptop.
  2. Open `http://localhost:8787` on the TV or laptop and choose *Host a phone
     room*.
  3. Phones scan the QR code.
  The QR code and link use the laptop's LAN address, never `localhost`. If
  the service cannot be reached (for example on the Pages site), the game says
  so and does not show a join code. Local play keeps working.

Room service settings (environment variables): `PORT` (default 8787), `HOST`
(default `0.0.0.0`), `STATIC_DIR` (default `dist`), and `ALLOWED_ORIGINS`
(comma-separated; when set, WebSocket upgrades from other origins are
refused). A build with `VITE_ROOM_URL=wss://…/ws` points the static site at a
hosted service instead.

### Hosting the room service publicly

It is **not deployed**. Two ready-to-use options are included; both need an
account and plan chosen by the repository owner:

* `Dockerfile`: a two-stage `node:22-slim` image that runs the tests, builds,
  and starts `node dist-server/main.js` on port 8787, with a `/health` check.
* `render.yaml`: a Render Blueprint that uses that Dockerfile.

After deploying either one, set `ALLOWED_ORIGINS=https://asadk26.github.io`.
Then either rebuild the Pages site with `VITE_ROOM_URL=wss://<host>/ws`, or
simply use the service's own address: it serves the same game.

## Trust boundaries and fairness

* **The engine is authoritative in one place.** In local play that is the
  browser, which holds the full state, including hidden traps, the seed and
  the RNG. Anyone who opens the developer tools can see it. Local play is a
  family game on one screen, not a secure one.
* **In phone rooms the service is authoritative.** It holds the only full
  game state. The TV receives a public view (revealed traps only; the seed,
  the RNG streams and the deck order are removed). Each phone receives a seat
  view, which adds only its own nomination. Bots on the service receive the
  same filtered seat views as humans. The full save never leaves the service.
* **Actions** carry an ID and the phase revision they were made in. The
  service drops duplicates, stale actions, actions for another seat, and
  floods (a token-bucket rate limit). Rooms expire when idle.
* **Challenge inputs** are timestamped on the phone and converted to server
  time with a ping-measured clock offset. The same pure judge scores humans
  and bots from these inputs. Inputs before the challenge starts or after it
  ends are discarded. A modified phone *can* still lie about its own timing.
  Nothing on the service can detect perfect play. The service only guarantees
  that nobody can act for another seat or see hidden information.
* **Disconnects.** If a participant drops during a challenge, the challenge
  freezes and restarts from a fresh countdown on reconnect. The same seed
  gives the same pattern, so there is no advantage in dropping. The host can
  pause, hand a seat to a bot, or let the TV keyboard play for a missing
  phone.

## Layout

```
src/
  engine/            the rules — pure, deterministic TypeScript, no rendering
    config.ts        board graph, traps, scoring, challenge timings, characters
    graph.ts         adjacency, ghost wall links, route enumeration
    challenges.ts    challenge schedules and judges, bot reflex models
    engine.ts        phase machine, encounters, challenges, ghosts, scoring, undo
    view.ts          public and per-seat views (the hidden-information boundary)
    bots.ts          personalities (cautious / greedy / mischievous) over seat views
    sim.ts           headless games for balance runs
    save.ts          versioned save format (schema 2; version-1 saves are refused)
  net/               room protocol, the transport-agnostic Room, browser client
  phone/             the phone controller (#/join), lazy-loaded without three.js
  director.ts        plays committed events as animation (never decides outcomes)
  store.ts           app state, local and room modes, bots, saving
  scene/             React Three Fiber scene: board, pieces, ghosts, Reapers
  ui/                HUD, placement, challenges, lobby, dialogs
server/main.ts       static server + WebSocket room service
tests/
  engine.test.ts     rules coverage, including every redesign rule
  fuzz.test.ts       300 random complete games, invariants after every action
  room.test.ts       room service: seats, tokens, private views, forged/stale actions, disconnects
  balance.test.ts    simulations (BALANCE=1)
  browser/e2e.mjs    real-browser play-throughs
```

The browser suite starts its own servers. It uses Playwright's Chromium at
`/opt/pw-browsers/...` by default; set `CHROME=/path/to/chrome` to use
another. Screenshots are written to `test-results/`. Run one part with
`ONLY=`:

1. Local placement, the pass-and-play curtain, and both cameras.
2. Crafted saves: an escape challenge, transformation, a ghost turn, a hidden
   trap reveal, reload mid-challenge, undo keeping a reveal, a two-key duel,
   the Super Reaper warning, and results.
3. One human against five bots to the end of the game.
4. Phone rooms against the real service: QR/LAN URL, private placement,
   reload keeping the seat, synchronised challenges, and no hidden
   information on the TV.
5. Screen sizes, refusal of a version-1 save, the join page without a
   service, and no WebGL.

The page exposes `window.__omr` (`getState`, `act`, `director`, `project`)
for these checks. Under software WebGL the suite takes about 30–40 minutes.

## Balance

Headless simulation results (`npm run balance`; 150 games per setting; bots
at *steady* reflexes):

| Setting | Result |
|---|---|
| 2 seats | Seat 0 averages 13.3, the others 12.35. |
| A seat that seeks death | Scores about 1–1.5. A ghost's bounty plus its bank never beats staying alive. |
| A seat that camps in the Entrance Hall | Scores 0. Camping is not a strategy. |
| 4 seats | 1.06 deaths per game; 12.7 challenges; about 15½ minutes of estimated play. |
| 6 seats | 1.78 deaths; about 21.5 challenges (≈14.5 of them escapes from the house ghost); about 24 minutes. |

Early endings (everyone dead) are rare. The bounty cap is reached in practice.
The first seat has an advantage of about 10%, as in the original game.

Adjustment made: bots passed the escape ring too often (steady 0.95+). The
target zone was narrowed from 64° to 52°. Pass rates are now about 0.85 /
0.95 / 0.99 (shaky / steady / sharp) for escape, 0.79 / 0.93 / 0.98 for
dance, and 0.77 / 0.97 / 1.0 for rope.

## Deferred: Deadly Charades

Deadly Charades was assessed and **deferred**. It needs a drawing or acting
surface on each phone, free-text guessing, and moderation of what players
write. None of that can be judged by the deterministic, seeded engine that
scores every other challenge. It would also have no fair form in local
single-screen play. It fits best as a phone-rooms-only party round with host
judging.

## Saves and privacy

The game stores data only in this browser's `localStorage`, under keys
starting with `one-more-room/`:

* the game (schema 2);
* setup and personalisation;
* sound, motion and speed settings;
* phone seat tokens and nomination acknowledgements.

Nothing else in storage is read, changed or removed. A damaged or old save is
reported and cleared only when the player confirms. Local play makes no
network requests beyond loading the page. Phone rooms talk only to the room
service that served the page, or to the service set in `VITE_ROOM_URL`.

## Assets and licences

All art is modelled in code from Three.js primitives. All sound is synthesised
with the Web Audio API. There are no external images, models, fonts or audio
files, and nothing is fetched from a CDN.

Libraries (MIT licensed): React, React DOM, three.js, @react-three/fiber,
`ws` (room service), `qrcode` (join codes). Development only: Vite, Vitest,
TypeScript (Apache-2.0), playwright-core (Apache-2.0).

## Provenance

This game came from `asadk26/The_Town`, branch `claude/one-more-room`, at
commit `e8ee27f`, with its history preserved. See the repository's top-level
README for details.
