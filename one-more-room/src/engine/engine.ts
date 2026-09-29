// The rules of One More Room as a pure, deterministic state machine.
// Every function here takes a snapshot and returns a new one; nothing is
// mutated in place and nothing reads the clock or Math.random.

import {
  cardType,
  DECK_SIZE,
  ENTRANCE,
  EVENT_NODES,
  GHOST_START,
  HARVEST_PER_LANDING,
  MAX_PLAYERS,
  MIDNIGHT_WARNING_AFTER_ROUND,
  MIN_PLAYERS,
  NODE_COUNT,
  ROOMS,
  ROUNDS,
  SECRET_ENDPOINTS,
  type CharacterId,
} from './config';
import { ghostBfs, ghostPath, ORDINARY_ADJ, playerRoutes, type PlayerRoute } from './graph';
import { rollDie, shuffle } from './rng';
import type {
  Action,
  ActionResult,
  Catch,
  EventState,
  GameState,
  GhostPlan,
  GhostTarget,
  LogEntry,
  MovePreview,
  PlayerState,
} from './types';

export interface NewGameOptions {
  players: Array<{ name: string; character: CharacterId }>;
  seed: number;
}

export function createGame({ players, seed }: NewGameOptions): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`One More Room needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  const chars = new Set(players.map((p) => p.character));
  if (chars.size !== players.length) throw new Error('Each player needs a distinct character');

  const stocks = new Array<number>(NODE_COUNT).fill(0);
  for (const [id, room] of Object.entries(ROOMS)) stocks[Number(id)] = room.stock;

  const rng0 = seed >>> 0;
  const [deck, rng] = shuffle(
    Array.from({ length: DECK_SIZE }, (_, i) => i),
    rng0,
  );

  return {
    schema: 1,
    seed: rng0,
    rng,
    players: players.map<PlayerState>((p, i) => ({
      id: `p${i + 1}`,
      name: p.name,
      character: p.character,
      node: ENTRANCE,
      carried: 0,
      banked: 0,
      decoyUsed: false,
      facingFrom: null,
    })),
    ghost: GHOST_START,
    stocks,
    piles: new Array<number>(NODE_COUNT).fill(0),
    deck,
    discard: [],
    round: 1,
    turn: 0,
    turnNumber: 1,
    phase: 'turnStart',
    dice: null,
    selection: { moveDie: 0, dest: null },
    decoy: null,
    ghostBonus: 0,
    event: null,
    log: [],
    turnDirty: false,
    midnight: false,
  };
}

// ── small immutable helpers ─────────────────────────────────────────────

function clone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    stocks: state.stocks.slice(),
    piles: state.piles.slice(),
    deck: state.deck.slice(),
    discard: state.discard.slice(),
    dice: state.dice ? [state.dice[0], state.dice[1]] : null,
    selection: { ...state.selection },
    event: state.event ? { ...state.event, options: state.event.options.slice() } : null,
    log: state.log.slice(),
  };
}

function fail(state: GameState, error: string): ActionResult {
  return { state, events: [], error };
}

export function activePlayer(state: GameState): PlayerState {
  return state.players[state.turn];
}

export function movementAllowance(state: GameState, moveDie: 0 | 1 = state.selection.moveDie): number {
  return state.dice ? state.dice[moveDie] : 0;
}

export function ghostAllowance(state: GameState, moveDie: 0 | 1 = state.selection.moveDie): number {
  return state.dice ? state.dice[moveDie === 0 ? 1 : 0] + state.ghostBonus : 0;
}

/** Legal destinations for the active player with the given die as movement. */
export function legalRoutes(state: GameState, moveDie: 0 | 1 = state.selection.moveDie): Map<number, PlayerRoute> {
  if (!state.dice) return new Map();
  const p = activePlayer(state);
  return playerRoutes(p.node, state.dice[moveDie], state.ghost);
}

// ── ghost targeting and movement ────────────────────────────────────────

/**
 * Who the ghost hunts right now: a live decoy, else the richest carrier
 * outside the entrance; ties go to the nearest (ordinary ghost-walkable
 * distance), then the active player, then the first clockwise after them.
 */
export function ghostTarget(state: GameState): GhostTarget | null {
  if (state.decoy !== null) return { kind: 'decoy', node: state.decoy };
  const n = state.players.length;
  const { dist } = ghostBfs(state.ghost);
  let best: number | null = null;
  let bestKey: [number, number, number] | null = null;
  for (let i = 0; i < n; i++) {
    const p = state.players[i];
    if (p.node === ENTRANCE) continue;
    const clockwise = (i - state.turn + n) % n; // 0 = active player
    const key: [number, number, number] = [-p.carried, dist[p.node], clockwise];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = i;
      bestKey = key;
    }
  }
  if (best === null) return null;
  return { kind: 'player', player: best, node: state.players[best].node };
}

/** Plan this ghost phase without changing anything. */
export function planGhost(state: GameState, allowance: number): GhostPlan {
  const target = ghostTarget(state);
  if (!target) {
    return { target: null, allowance, fullPath: [state.ghost], path: [state.ghost], reachesTarget: false, catches: [] };
  }
  const fullPath = ghostPath(state.ghost, target.node) ?? [state.ghost];
  const steps = Math.min(allowance, fullPath.length - 1);
  const path = fullPath.slice(0, steps + 1);
  const caught = new Set<number>();
  const catches: Catch[] = [];
  for (const node of path.slice(1)) {
    state.players.forEach((p, i) => {
      if (p.node !== node || caught.has(i)) return;
      caught.add(i);
      const dropped = Math.ceil(p.carried / 2);
      catches.push({ player: i, node, carriedBefore: p.carried, dropped, retained: p.carried - dropped });
    });
  }
  return { target, allowance, fullPath, path, reachesTarget: path[path.length - 1] === target.node, catches };
}

function applyGhost(state: GameState, plan: GhostPlan): void {
  state.ghost = plan.path[plan.path.length - 1];
  for (const c of plan.catches) {
    const p = state.players[c.player];
    state.piles[c.node] += c.dropped;
    p.carried = 0;
    p.banked += c.retained;
    p.facingFrom = null;
    p.node = ENTRANCE;
  }
}

// ── player movement and landing ─────────────────────────────────────────

interface LandingOutcome {
  harvest: number;
  pile: number;
  bank: number;
  triggersEvent: boolean;
}

/**
 * Move the active player along a legal route and resolve the landing. This is
 * the single simulator used by both previews and committed moves; previews
 * pass drawEvent=false so no card is drawn and no randomness is consumed.
 */
function resolveMove(state: GameState, route: PlayerRoute | null, drawEvent: boolean, events: LogEntry[]): LandingOutcome {
  const pi = state.turn;
  const p = state.players[pi];
  const out: LandingOutcome = { harvest: 0, pile: 0, bank: 0, triggersEvent: false };
  if (!route) {
    events.push({ kind: 'stay', player: pi, node: p.node });
    return out;
  }
  const dest = route.dest;
  p.facingFrom = route.path[route.path.length - 2];
  p.node = dest;
  events.push({ kind: 'move', player: pi, path: route.path, usesSecret: route.usesSecret });

  if (dest === ENTRANCE) {
    out.bank = p.carried;
    p.banked += p.carried;
    p.carried = 0;
    events.push({ kind: 'bank', player: pi, amount: out.bank, total: p.banked });
    return out;
  }
  if (ROOMS[dest]) {
    const take = Math.min(HARVEST_PER_LANDING, state.stocks[dest]);
    state.stocks[dest] -= take;
    p.carried += take;
    out.harvest = take;
    events.push({ kind: 'harvest', player: pi, node: dest, amount: take, remaining: state.stocks[dest] });
  }
  if (state.piles[dest] > 0) {
    out.pile = state.piles[dest];
    p.carried += state.piles[dest];
    state.piles[dest] = 0;
    events.push({ kind: 'pile', player: pi, node: dest, amount: out.pile });
  }
  if (EVENT_NODES.includes(dest)) {
    out.triggersEvent = true;
    if (drawEvent) drawCard(state, events);
  }
  return out;
}

function drawCard(state: GameState, events: LogEntry[]): void {
  if (state.deck.length === 0) {
    const [deck, rng] = shuffle(state.discard, state.rng);
    state.deck = deck;
    state.discard = [];
    state.rng = rng;
  }
  const cardId = state.deck[0];
  state.deck = state.deck.slice(1);
  state.discard = [...state.discard, cardId];
  const pi = state.turn;
  const me = state.players[pi];
  const type = cardType(cardId);
  events.push({ kind: 'card', player: pi, cardId });

  const ev: EventState = { cardId, type, status: 'resolved', options: [], canDecline: false };
  switch (type) {
    case 'secretPassage': {
      ev.options = SECRET_ENDPOINTS.filter((n) => n !== state.ghost && n !== me.node);
      ev.canDecline = true;
      if (ev.options.length) ev.status = 'choice';
      else events.push({ kind: 'noEffect', player: pi, reason: 'No secret passage is free.' });
      break;
    }
    case 'stickyFingers': {
      ev.options = stickyTargets(state);
      if (ev.options.length) ev.status = 'choice';
      else events.push({ kind: 'noEffect', player: pi, reason: 'No opponent with candy is on or next to your space.' });
      break;
    }
    case 'sweetDiscovery': {
      me.carried += 2;
      events.push({ kind: 'gain', player: pi, amount: 2 });
      break;
    }
    case 'creakyFloorboards': {
      state.ghostBonus += 2;
      events.push({ kind: 'ghostBonus', amount: 2 });
      break;
    }
    case 'costumeMixup': {
      ev.options = state.players
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => i !== pi && p.node !== ENTRANCE && p.node !== state.ghost && me.node !== state.ghost)
        .map(({ i }) => i);
      ev.canDecline = true;
      if (ev.options.length) ev.status = 'choice';
      else events.push({ kind: 'noEffect', player: pi, reason: 'Every opponent is safe in the entrance hall.' });
      break;
    }
    case 'flyingCandy': {
      const amount = Math.min(2, me.carried);
      if (amount > 0) {
        me.carried -= amount;
        state.piles[me.node] += amount;
        events.push({ kind: 'drop', player: pi, node: me.node, amount });
      } else {
        events.push({ kind: 'noEffect', player: pi, reason: 'Your sack is empty, so nothing flies out.' });
      }
      break;
    }
  }
  state.event = ev;
  state.phase = ev.status === 'choice' ? 'event' : 'ghost';
}

export function stickyTargets(state: GameState): number[] {
  const me = state.players[state.turn];
  if (me.node === ENTRANCE) return [];
  const near = new Set([me.node, ...ORDINARY_ADJ[me.node]]);
  return state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== state.turn && p.node !== ENTRANCE && p.carried > 0 && near.has(p.node))
    .map(({ i }) => i);
}

// ── previews ────────────────────────────────────────────────────────────

/** Forecast a move. Never mutates the given state and never consumes RNG. */
export function previewMove(state: GameState, moveDie: 0 | 1, dest: number | 'stay'): MovePreview | null {
  if (state.phase !== 'choose' || !state.dice) return null;
  let route: PlayerRoute | null = null;
  if (dest !== 'stay') {
    route = legalRoutes(state, moveDie).get(dest) ?? null;
    if (!route) return null;
  }
  const sim = clone(state);
  const outcome = resolveMove(sim, route, false, []);
  const ghost = planGhost(sim, ghostAllowance(state, moveDie));
  return {
    dest,
    path: route ? route.path : [state.players[state.turn].node],
    usesSecret: route?.usesSecret ?? false,
    harvest: outcome.harvest,
    pile: outcome.pile,
    bank: outcome.bank,
    carriedAfter: sim.players[state.turn].carried,
    triggersEvent: outcome.triggersEvent,
    ghost,
    provisional: outcome.triggersEvent,
  };
}

/** The exact ghost plan once the move and any event have resolved. */
export function currentGhostPlan(state: GameState): GhostPlan | null {
  if (state.phase !== 'ghost' || !state.dice) return null;
  return planGhost(state, ghostAllowance(state));
}

// ── the state machine ───────────────────────────────────────────────────

export function canPlaceDecoy(state: GameState): boolean {
  const p = activePlayer(state);
  return state.phase === 'turnStart' && !p.decoyUsed && p.node !== ENTRANCE && state.decoy === null;
}

export function apply(state: GameState, action: Action): ActionResult {
  const s = clone(state);
  const events: LogEntry[] = [];
  const me = s.players[s.turn];

  switch (action.type) {
    case 'placeDecoy': {
      if (!canPlaceDecoy(state)) return fail(state, 'You cannot place a decoy now.');
      me.decoyUsed = true;
      s.decoy = me.node;
      events.push({ kind: 'decoy', player: s.turn, node: me.node });
      break;
    }
    case 'roll': {
      if (s.phase !== 'turnStart') return fail(state, 'Already rolled.');
      let a: number, b: number;
      [a, s.rng] = rollDie(s.rng);
      [b, s.rng] = rollDie(s.rng);
      s.dice = [a, b];
      s.selection = { moveDie: 0, dest: null };
      s.phase = 'choose';
      events.push({ kind: 'roll', player: s.turn, dice: [a, b] });
      break;
    }
    case 'select': {
      if (s.phase !== 'choose') return fail(state, 'Nothing to select now.');
      if (action.moveDie !== undefined) {
        s.selection.moveDie = action.moveDie;
        // A destination out of reach of the new allowance is cleared.
        if (typeof s.selection.dest === 'number' && !legalRoutes(s).has(s.selection.dest)) s.selection.dest = null;
      }
      if (action.dest !== undefined) {
        if (typeof action.dest === 'number' && !legalRoutes(s).has(action.dest)) return fail(state, 'That space is out of reach.');
        s.selection.dest = action.dest;
      }
      break;
    }
    case 'confirmMove': {
      if (s.phase !== 'choose') return fail(state, 'Nothing to confirm.');
      const dest = s.selection.dest;
      if (dest === null) return fail(state, 'Choose a destination or Stay first.');
      let route: PlayerRoute | null = null;
      if (dest !== 'stay') {
        route = legalRoutes(s).get(dest) ?? null;
        if (!route) return fail(state, 'That space is out of reach.');
      }
      s.phase = 'ghost';
      resolveMove(s, route, true, events); // may move the phase to 'event'
      break;
    }
    case 'eventChoose': {
      const ev = s.event;
      if (s.phase !== 'event' || !ev || ev.status !== 'choice') return fail(state, 'No card choice pending.');
      if (!ev.options.includes(action.option)) return fail(state, 'That is not a legal choice.');
      const pi = s.turn;
      if (ev.type === 'secretPassage') {
        const from = me.node;
        me.facingFrom = from;
        me.node = action.option;
        events.push({ kind: 'relocate', player: pi, from, to: action.option });
      } else if (ev.type === 'stickyFingers') {
        const victim = s.players[action.option];
        const amount = Math.min(2, victim.carried);
        victim.carried -= amount;
        me.carried += amount;
        events.push({ kind: 'steal', player: pi, victim: action.option, amount });
      } else if (ev.type === 'costumeMixup') {
        const other = s.players[action.option];
        const a = me.node;
        const b = other.node;
        me.facingFrom = a;
        other.facingFrom = b;
        me.node = b;
        other.node = a;
        events.push({ kind: 'swap', player: pi, other: action.option, playerTo: b, otherTo: a });
      }
      ev.status = 'resolved';
      s.phase = 'ghost';
      break;
    }
    case 'eventDecline': {
      const ev = s.event;
      if (s.phase !== 'event' || !ev || ev.status !== 'choice' || !ev.canDecline) return fail(state, 'Cannot decline now.');
      ev.status = 'resolved';
      s.phase = 'ghost';
      events.push({ kind: 'declined', player: s.turn });
      break;
    }
    case 'moveGhost': {
      if (s.phase !== 'ghost') return fail(state, 'The ghost is not ready to move.');
      const plan = planGhost(s, ghostAllowance(s));
      if (!plan.target) {
        events.push({ kind: 'ghostWaits' });
      } else {
        applyGhost(s, plan);
        events.push({ kind: 'ghost', plan });
      }
      s.decoy = null;
      s.phase = 'summary';
      break;
    }
    case 'nextTurn': {
      if (s.phase !== 'summary') return fail(state, 'Finish this turn first.');
      const n = s.players.length;
      if (s.turn === n - 1 && s.round === ROUNDS) {
        s.phase = 'gameOver';
        events.push({ kind: 'gameOver' });
        break;
      }
      s.turn = (s.turn + 1) % n;
      if (s.turn === 0) {
        s.round += 1;
        if (s.round === MIDNIGHT_WARNING_AFTER_ROUND + 1) {
          s.midnight = true;
          events.push({ kind: 'midnight' });
        }
      }
      s.turnNumber += 1;
      s.phase = 'turnStart';
      s.dice = null;
      s.selection = { moveDie: 0, dest: null };
      s.decoy = null;
      s.ghostBonus = 0;
      s.event = null;
      s.log = [];
      s.turnDirty = false;
      return { state: s, events };
    }
  }
  s.log = [...s.log, ...events];
  s.turnDirty = true;
  return { state: s, events };
}

// ── scoring ─────────────────────────────────────────────────────────────

export interface ScoreLine {
  player: number;
  banked: number;
  carried: number;
  carriedHalf: number;
  total: number;
  rank: number;
  winner: boolean;
}

export function finalScores(state: GameState): ScoreLine[] {
  const lines = state.players.map((p, i) => {
    const carriedHalf = Math.floor(p.carried / 2);
    return { player: i, banked: p.banked, carried: p.carried, carriedHalf, total: p.banked + carriedHalf, rank: 0, winner: false };
  });
  const sorted = lines.slice().sort((a, b) => b.total - a.total || a.player - b.player);
  const top = sorted[0]?.total ?? 0;
  for (const line of sorted) {
    line.rank = 1 + lines.filter((l) => l.total > line.total).length;
    line.winner = line.total === top;
  }
  return sorted;
}

// ── undo-aware session ──────────────────────────────────────────────────

/**
 * A session wraps the live snapshot with the snapshot taken when this turn
 * began and the one from the turn before. Undo restores one of those whole —
 * RNG, deck, stocks and all — so a replayed turn rolls the same dice.
 */
export interface Session {
  game: GameState;
  turnStart: GameState;
  previousTurnStart: GameState | null;
}

export function newSession(game: GameState): Session {
  return { game, turnStart: game, previousTurnStart: null };
}

export function dispatch(session: Session, action: Action): { session: Session; events: LogEntry[]; error?: string } {
  const result = apply(session.game, action);
  if (result.error) return { session, events: [], error: result.error };
  if (action.type === 'nextTurn' && result.state.phase === 'turnStart') {
    return {
      session: { game: result.state, turnStart: result.state, previousTurnStart: session.turnStart },
      events: result.events,
    };
  }
  return { session: { ...session, game: result.state }, events: result.events };
}

export interface UndoInfo {
  available: boolean;
  which: 'current' | 'previous' | null;
  playerName: string;
  round: number;
}

export function undoInfo(session: Session): UndoInfo {
  const g = session.game;
  if (g.turnDirty || g.phase === 'gameOver') {
    const t = session.turnStart;
    return { available: true, which: 'current', playerName: t.players[t.turn].name, round: t.round };
  }
  if (session.previousTurnStart) {
    const t = session.previousTurnStart;
    return { available: true, which: 'previous', playerName: t.players[t.turn].name, round: t.round };
  }
  return { available: false, which: null, playerName: '', round: g.round };
}

export function undo(session: Session): Session {
  const info = undoInfo(session);
  if (info.which === 'current') return { ...session, game: session.turnStart };
  if (info.which === 'previous' && session.previousTurnStart) {
    return { game: session.previousTurnStart, turnStart: session.previousTurnStart, previousTurnStart: null };
  }
  return session;
}
