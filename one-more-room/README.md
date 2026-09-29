# One More Room: One Life

A Halloween board game in a miniature 3D haunted mansion for **2–4 pieces**. A
piece is one person, a pair of teammates, or a bot, so up to eight people can
play. There is **one life** in the mansion. One piece holds it; every other
piece is a ghost trying to steal it. Whoever holds the life when a round's bell
rings scores a point. Ten rounds, and the most points wins.

Play on one shared screen (mouse, keyboard, touch, bots), or give everyone a
phone controller through a small room service on your home network.

## Rules in brief

* **Setup.**
  * Each piece secretly picks one corridor. The house tops these up to exactly
    six hidden traps; matching picks merge silently.
  * The six traps are dealt six secret effects: two *Reaper’s Challenges*, two
    *Séances* and two *Poltergeists*. You choose places, never effects, and your
    own trap works on you too.
  * Everyone then rolls a die. The highest starts **alive** in the Entrance Hall
    (tied leaders reroll). The rest start as ghosts on spaces 8, 16 and 24,
    assigned at random.
* **A round.**
  * The piece holding the life acts first. Then every other piece acts once, in
    an order that shifts by one seat each round. The order is frozen when the
    round starts and shown on screen.
  * Roles can change mid-round, but actions don't. A piece acts in its slot as
    whatever it is by then; nobody gains or loses an action.
  * When all have acted, the holder scores **+1**.
* **Moving.**
  * Roll one die. The living piece moves up to its roll. A ghost always drifts
    at least 3 ("Rolled 1 • Ghost drift: 3 spaces").
  * You may stay. Pieces never block each other.
  * Everyone may use one secret passage per move. Only ghosts may use the two
    dotted wall links (7↔10 and 22↔25).
* **Stealing the life.**
  * A ghost ending its action on the living piece’s space, or one *ordinary*
    edge away, may challenge. Wall links and passages don’t count as adjacent.
  * The two jump **Haunted Jump Rope**. If the ghost wins, it takes the life and
    the defender’s space. The loser is pushed exactly two ordinary steps away (to
    a free space, preferring where it started its action, then the lowest id).
  * The living piece can never start a challenge.
* **Haunted Jump Rope.**
  * Eight shared sweeps, one press per sweep; holding or mashing never counts
    twice. The rope **speeds up after every sweep** (about 1.3 s between floor
    passes at first, 0.8 s by the eighth, sudden death at top speed), the same
    for everyone. The most clean jumps wins.
  * Tied leaders (only they) take up to four sudden-death sweeps. Then the lower
    mean timing error on the eight sweeps wins. An exact tie gets the Reaper’s
    seeded, announced verdict.
  * Exactly one piece holds the life afterwards.
* **The curse.** The longer the living piece keeps the life, the narrower its
  personal jump window: ×1.0 after 0–1 rounds held, ×0.9 after 2, ×0.8 after 3,
  ×0.7 after 4 or more (the cap).
  * The multiplier is frozen when a challenge starts, and the same rule applies
    to humans and bots.
  * Losing the life resets the streak at once. A successful defence neither
    resets nor adds to it.
  * Each lane shows its own window, and its ✓/✗ comes from the same judge that
    decides the game.
* **Traps** trigger only when a movement ends on them (living or ghost). Passing
  over, staying, and forced moves never trigger or reveal anything.
  * *Reaper’s Challenge.* A ghost landing here duels the living piece from
    anywhere. The living piece landing here picks a ghost. Nobody moves, and the
    tile stays active.
  * *Séance.* Every piece jumps, and the winner holds the life. Each tile works
    once. There are **two Séances per game** in total, shared with the Super
    Reaper; after that a Séance tile is revealed "cold" and does nothing.
  * *Poltergeist.* Throws the lander to a random free space at least three steps
    away (never the entrance), with the same role and score. A ghost may still
    challenge from where it lands.
  * *Super Reaper* (space 12, always visible): a Séance while any are left, then
    a Reaper’s Challenge.
  * A trap is resolved before any contact. **One minigame per action** at most.
* **Winning.** After round 10 the most points wins, alive or not. Tied top scores
  share the win. Exactly ten points are handed out per game.

There is no candy, banking, protection or elimination any more. Stealing the
life *is* coming back to life.

### Teams and control

* **Free-for-all:** one person or a bot per piece.
* **Team Battle:** one or two people per piece. Uneven teams are fine: five
  people can play 2+1+1+1 or 2+2+1; six can play 2+2+1+1; eight fill four
  pairs.
* A team shares one score, role, position, action slot, trap and streak.
* In a pair, the **first person controls odd rounds and the second even
  rounds**: every move and every jump that round, including out-of-turn duels
  and Séances.
* Only the first person confirms the team’s trap; both see it.
* A bot always controls a whole piece.

## Build and run

Every command runs from the repository root.

```sh
cd one-more-room
npm ci                 # install exactly what package-lock.json says
npm run dev            # http://localhost:5173 — development server (one-screen play)
npm run build          # typecheck, build the game into dist/ and the room service into dist-server/
npm run room           # serve dist/ and phone rooms on port 8787 (after a build)
npm run preview        # serve dist/ only, at http://localhost:4173
npm test               # engine, fuzz and room-service tests
npm run balance        # balance simulations (slow; prints tables)
node tests/browser/e2e.mjs   # end-to-end browser checks (after a build)
```

`dist/` is fully static, with relative paths and hash routes (`#/join`). The
repository’s Pages workflow publishes it at
`https://asadk26.github.io/BoardGameCentral/one-more-room/`. **The Pages site is
for one-screen play with bots.** It has no room service, so “Host a phone room”
there explains that and never shows a join code or QR code.

### Phones on your home network

1. On a laptop connected to the same Wi-Fi as the phones:
   `cd one-more-room && npm ci && npm run build && npm run room`.
2. The service prints its network addresses, such as
   `phones on this network: http://192.168.1.23:8787/#/join`.
3. On the TV (or the laptop), open `http://localhost:8787` and choose **Host a
   phone room**. The lobby shows a room code, a QR code, and a join link that
   uses the laptop’s network address, never `localhost`.
4. Phones scan the QR code (or open the link and type the code), pick a name and
   a costume, and in Team Battle can **join a teammate’s piece**. The host can
   add bots, then presses **Start**.
5. During play, the host menu can **pause**, **hand a disconnected controller’s
   slot to another phone** (never mid-challenge), hand a whole piece to a bot, or
   let a piece jump on the **TV keyboard**. A phone that refreshes rejoins its
   own piece. If someone drops mid-challenge, it freezes and restarts from a
   fresh countdown with the same rope.

The private join address only ever appears on the laptop hosting the room. It
is never part of the public Pages site.

**If phones can’t connect:**

* **Same network.** Phones must be on the same Wi-Fi as the laptop, not on
  mobile data or a guest network. Many routers keep guest-network devices apart
  (“client isolation” or “AP isolation”); use the main network or turn that off.
* **Firewall.** Allow Node.js through the laptop’s firewall. macOS asks the
  first time (“Accept incoming network connections?”); on Windows allow it for
  *Private* networks, and make sure the Wi-Fi is set to *Private*, not
  *Public*. Port **8787** (TCP) must be reachable.
* **VPNs** on the laptop or phone can hide the local network; pause them.
* **Wrong address.** If the laptop has several network cards (Ethernet, Docker,
  VPN), the first address printed may not be the Wi-Fi one. Try the others.
  Use `PORT=9000 npm run room` if 8787 is taken.
* **`https` pages can’t talk to a local `http` service.** Open the game from the
  laptop’s own address, not from the Pages site.
* **The address changes** when the laptop reconnects to Wi-Fi; make a new room if
  the QR code stops working.

Room service settings (environment variables): `PORT` (default 8787), `HOST`
(default `0.0.0.0`), `STATIC_DIR` (default `dist`), and `ALLOWED_ORIGINS` (a
comma-separated list; when set, WebSocket connections from other origins are
refused). The `Dockerfile` runs the same service in a container on your own
machine: `docker build -t one-more-room . && docker run -p 8787:8787 one-more-room`.
No public room service is deployed or offered.

## Trust boundaries and fairness

* **Local play** runs the engine in the browser. That browser holds the full
  state, hidden traps and RNG included. It’s a family game on one screen: a
  determined person with developer tools can see everything. Pass-and-play
  placement hides each pick behind a curtain, and nothing on screen ever shows
  unrevealed traps.
* **In phone rooms the service is authoritative.**
  * It holds the only full state. The TV gets a public view: revealed traps with
    their effects, the Super Reaper, and the Séance count; no seed, RNG or
    nominations.
  * Each phone gets that view plus its own piece’s nomination.
  * Bots receive the same filtered views. Forecasts, destination lists and
    retreat or Poltergeist choices never consult hidden traps.
* **Authority is per piece and per round.**
  * The room accepts board actions and jump inputs only from the phone
    controlling that piece this round.
  * Actions carry an ID and a phase revision; duplicates, stale actions and
    floods are dropped.
  * Challenge results come only from the room’s own judging of timestamped
    presses, applied all at once, so arrival order never matters. A result
    cannot be applied twice.
* A modified phone *can* still fake its own timing. The service only guarantees
  that nobody acts for another piece or sees hidden information.

## Saves

Local games save in this browser’s `localStorage` under keys starting with
`one-more-room/`. Nothing else in storage is read or changed.

* The save (schema 3) holds: the action order and used slots, who holds the
  life, streaks, scores, controllers, trap truth and public knowledge, the
  Séance count, any pending challenge, and the RNG.
* Saves from the candy versions (schema 1 and 2) are refused. The player is told
  why and offered a fresh start; they are never reinterpreted.
* **Undo** (local only) restores the start of the current or previous action with
  the same die rolls. The table’s memory of revealed traps survives undo.
* Phone rooms have no undo. The host can restart for everyone after
  confirming.

## Balance measurements

`npm run balance` simulates games with bots of equal reflex skill, so the
numbers show the rules’ structure rather than who jumps best. **These are
simulation estimates.** They say nothing about fun, and the minutes come from a
simple per-action time model, not from real tables. Figures below are from 400
games per setting:

| Measure | 2 pieces | 3 pieces | 4 pieces |
|---|---|---|---|
| First holder’s points (fair share) | 5.01 (5.00) | 3.23 (3.33) | 2.43 (2.50) |
| First holder’s win share (fair) | 50% (50%) | 30% (33%) | 21% (25%) |
| Points by seat, identical bots | 5.07 · 4.93 | 3.27 · 3.37 · 3.36 | 2.56 · 2.33 · 2.53 · 2.58 |
| Holder at the bell: first slot · … · last hunter | 57% · 43% | 33% · 24% · 43% | 18% · 14% · 25% · 43% |
| Rounds without any encounter | 25% | 5% | 1% |
| Encounters / life swaps per round | 0.76 / 0.43 | 1.57 / 0.85 | 2.48 / 1.31 |
| Rounds with two or more swaps | 0% | 17% | 40% |
| Average longest living streak | 3.7 | 2.5 | 2.0 |
| Round 1: an encounter happens | 64% | 87% | 98% |
| Hunts right after a ghost wall-link move | 14% | 10% | 10% |
| Estimated minutes (model) | ~8 | ~13 | ~19 |

Strategies (piece 1’s points and win share compared with a normal bot):

| Strategy | 2 pieces | 4 pieces |
|---|---|---|
| Normal bot | 5.21 / 56% | 2.35 / 22% |
| Never moves, never challenges (camping) | 0.67 / 2% | 0.38 / 0% |
| Heads for the Super Reaper or a known Reaper tile whenever reachable | 4.56 / 39% | 2.36 / 20% |
| Facing one *shaky* opponent | 7.46 / 96% | 3.04 / 30% |
| …and always picking that opponent on Reaper’s Challenges (farming) | 7.46 / 96% | 3.04 / 30% |

What this shows:

* **Acting last in a round matters a lot.** The last hunter holds the life at
  43–44% of bells in 3- and 4-piece games. The hunter order rotates by one seat
  each round, so over a game every seat gets its turns at the end. Seat totals
  with identical bots stay within noise (±0.1–0.15) of a fair share. The policy
  is in `POLICY.rotateHunters` in `src/engine/config.ts`.
* **The first holder has no lasting advantage**, and in 4-piece games is
  slightly behind (21% of wins against a fair 25%). The Super Reaper is four
  steps from two ghost spawns, and ghosts always move at least 3, so the first
  holder is usually attacked in round 1. Alternative ghost spawns (16/22/25,
  17/22/25, 15/22/25 and others) all measured within noise of the default, so
  the defaults stayed.
* **Two pieces is quieter:** a quarter of rounds have no encounter, and longest
  streaks average 3.7 rounds, so the curse does real work there. **Four
  pieces** is busy: 41% of rounds see two or more swaps.
* **Camping fails.** A piece that never moves or challenges scores well under a
  fair share. Seeking remote Reaper tiles is roughly as good as normal play, not
  better. Farming a weak ghost gains nothing over simply having a weak
  opponent: reflex skill dominates a duel, which a first human playtest should
  look at.
* **Ghost wall links matter:** about one hunt in ten follows a wall-link move.
* **The rope speeds up.** The shared rope gets faster after every sweep
  (`CHALLENGE.rope.accel`, floor `minPeriodMs`). Simulated bots' timing error
  grows with rope speed (by the square root of the speed-up), a rough stand-in
  for people; how the ramp *feels* needs a human playtest. It barely moves the
  structural numbers above, which come from order, spawns and traps.
* **No other numbers were changed after measuring.** The ghost minimum move (3),
  spawns, curse steps and rope timing are still the starting values; nothing
  measured justified a change before human playtesting.

## Not in this iteration

* **Draw for Your Life / Deadly Charades** stays deferred. It needs a drawing or
  acting surface on phones, free-text guessing and moderation, none of which the
  seeded, judged engine can score.
* No public room-service hosting.

## Layout

```
src/
  engine/            the rules — pure, deterministic TypeScript, no rendering
    config.ts        board graph, spawns, traps, curse, rope timings, turn-order policy
    graph.ts         adjacency, ghost wall links, routes, ordinary distance and attack range
    challenges.ts    Haunted Jump Rope schedule and judge (2–4 jumpers, curse windows), bot reflexes
    engine.ts        life roll, schedules, moves, hunts, traps, relocation, scoring, undo
    view.ts          public and per-piece views (the hidden-information boundary)
    bots.ts          personalities (cautious / greedy / mischievous) over filtered views
    sim.ts           headless games and strategies for balance runs
    save.ts          versioned save format (schema 3)
  net/               room protocol, the transport-agnostic Room (pieces, controllers), browser client
  phone/             the phone controller (#/join), lazy-loaded without three.js
  director.ts        plays committed events as animation (never decides outcomes)
  store.ts           app state, local and room modes, bots, saving
  scene/             React Three Fiber scene: board, pieces, spectral ghosts, traps, Super Reaper
  ui/                HUD, placement, jump rope, lobby, setup, dialogs
server/main.ts       static server + WebSocket room service
tests/
  engine.test.ts     rules: setup, schedules, scoring, curse, movement, catches, traps, tiebreaks, secrecy, undo, saves
  fuzz.test.ts       300 random complete games, invariants after every action
  room.test.ts       teams and controllers, private views, forged/stale input, disconnect, handover, pause
  balance.test.ts    simulations (npm run balance)
  browser/e2e.mjs    real-browser play-throughs
```

The browser suite starts its own room service and uses Playwright’s Chromium
(`CHROME=/path/to/chrome` to override). Screenshots are written to
`test-results/`. Run one part with `ONLY=`:

1. Local play: setup, a secret trap, the life roll, the overview, and a full
   two-piece game through the UI.
2. Four bots, fast-forwarded, through a full game.
3. Crafted positions:
   * two life transfers in one round, and the loser’s retreat;
   * a four-piece Séance;
   * a remote Reaper, a reload mid-challenge, and undo keeping the reveal;
   * the living piece picking a ghost;
   * a Poltergeist, a cold Séance, and the Super Reaper forecast;
   * the curse shown before play, with a narrower lane;
   * a shared win at the last bell.
4. Phone rooms against the real service:
   * Team Battle with a pair, a solo phone and a bot;
   * characters picked on phones;
   * a private team trap;
   * odd/even control, with the inactive phone having no controls;
   * reconnecting mid-challenge and after a refresh;
   * no hidden information on the TV.
5. Laptop, tablet, small and mobile layouts, refusal of old saves, the join page,
   the Pages-style static fallback, and no WebGL.

The browser suite uses software WebGL, simulated phones as separate browser
contexts on one machine, and no audio output. It does not show how the game
plays on real phones over Wi-Fi, on a GPU, or with sound.

## Assets and licences

All art is modelled in code from Three.js primitives. All sound is synthesised
with the Web Audio API. There are no external images, models, fonts or audio
files, and nothing is fetched from a CDN.

Libraries (MIT licensed): React, React DOM, three.js, @react-three/fiber,
`ws` (room service), `qrcode` (join codes). Development only: Vite, Vitest,
TypeScript (Apache-2.0), playwright-core (Apache-2.0).

## Provenance

This game came from `asadk26/The_Town`, branch `claude/one-more-room`, commit
`e8ee27f`, with its history preserved; see the repository’s top-level README.
The One Life rules replaced the candy rules in this repository.
