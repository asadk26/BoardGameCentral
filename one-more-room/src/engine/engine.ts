// The rules of One More Room as a pure, deterministic state machine.
// Every function here takes a snapshot and returns a new one; nothing is
// mutated in place and nothing reads the clock or Math.random.
//
// Living players collect and bank candy. Encounters are survival games:
// failing one turns that player into a ghost for the rest of the game.

import {
  cardType,
  CHARACTERS,
  DECK_SIZE,
  ENTRANCE,
  EVENT_NODES,
  GHOST_START,
  HARVEST_PER_LANDING,
  LETHAL_DUELS_FROM_ROUND,
  MAX_PLAYERS,
  MIDNIGHT_WARNING_AFTER_ROUND,
  MIN_PLAYERS,
  NODE_COUNT,
  nodeKind,
  ROOMS,
  ROUNDS,
  SCORING,
  SECRET_ENDPOINTS,
  SUPER_REAPER,
  TRAP_COUNT,
  TRAP_ELIGIBLE,
  TRAP_WINGS,
  trapEligible,
  type CharacterId,
} from './config';
import { ghostBfs, ghostPath, nearestWhere, ORDINARY_ADJ, playerRoutes, type PlayerRoute } from './graph';
import { nextFloat, rollDie, seedFrom, shuffle } from './rng';
import { judgeDance, judgeDuel, judgeEscape, judgeSoloRope, type ChallengeKind } from './challenges';
import type {
  Action,
  ActionResult,
  Challenge,
  ChallengeHost,
  ChallengeOutcome,
  Continuation,
  Encounter,
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
  /** Skip secret placement with these six trap nodes (tests and tools only). */
  presetTraps?: number[];
}

export function createGame({ players, seed, presetTraps }: NewGameOptions): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`One More Room needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  const chars = new Set(players.map((p) => p.character));
  if (chars.size !== players.length) throw new Error('Each player needs a distinct character');
  if (!players.every((p) => CHARACTERS.some((c) => c.id === p.character))) throw new Error('Unknown character');

  const stocks = new Array<number>(NODE_COUNT).fill(0);
  for (const [id, room] of Object.entries(ROOMS)) stocks[Number(id)] = room.stock;

  const rng0 = seed >>> 0;
  const [deck, rng] = shuffle(
    Array.from({ length: DECK_SIZE }, (_, i) => i),
    rng0,
  );

  const state: GameState = {
    schema: 2,
    seed: rng0,
    rng,
    challengeRng: seedFrom(`challenge:${rng0}`),
    challengeCount: 0,
    players: players.map<PlayerState>((p, i) => ({
      id: `p${i + 1}`,
      name: p.name,
      character: p.character,
      node: ENTRANCE,
      carried: 0,
      banked: 0,
      decoyUsed: false,
      facingFrom: null,
      alive: true,
      bounty: 0,
      protectedUntil: null,
      diedInRound: null,
    })),
    ghost: GHOST_START,
    stocks,
    piles: new Array<number>(NODE_COUNT).fill(0),
    deck,
    discard: [],
    round: 1,
    turn: 0,
    turnNumber: 1,
    phase: 'placement',
    dice: null,
    selection: { moveDie: 0, dest: null },
    decoy: null,
    ghostBonus: 0,
    event: null,
    pick: null,
    challenge: null,
    lastOutcome: null,
    nominations: players.map(() => null),
    traps: [],
    log: [],
    turnDirty: false,
    midnight: false,
    endReason: null,
  };
  if (presetTraps) {
    if (new Set(presetTraps).size !== TRAP_COUNT || !presetTraps.every(trapEligible)) throw new Error('Preset traps must be six distinct eligible nodes');
    state.traps = presetTraps.map((node) => ({ node, revealed: false }));
    state.phase = 'turnStart';
  }
  return state;
}

// ── small immutable helpers ─────────────────────────────────────────────

export function clone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    stocks: state.stocks.slice(),
    piles: state.piles.slice(),
    deck: state.deck.slice(),
    discard: state.discard.slice(),
    dice: state.dice ? state.dice.slice() : null,
    selection: { ...state.selection },
    event: state.event ? { ...state.event, options: state.event.options.slice() } : null,
    pick: state.pick ? { ...state.pick, options: state.pick.options.slice() } : null,
    nominations: state.nominations.slice(),
    traps: state.traps.map((t) => ({ ...t })),
    log: state.log.slice(),
  };
}

function fail(state: GameState, error: string): ActionResult {
  return { state, events: [], error };
}

export function activePlayer(state: GameState): PlayerState {
  return state.players[state.turn];
}

export function isProtected(state: GameState, i: number): boolean {
  const p = state.players[i];
  return p.alive && p.protectedUntil !== null && state.turnNumber <= p.protectedUntil;
}

/** A living player outside the entrance who can be drawn into an encounter. */
export function isExposed(state: GameState, i: number): boolean {
  const p = state.players[i];
  return p.alive && p.node !== ENTRANCE && !isProtected(state, i);
}

export function livingCount(state: GameState): number {
  return state.players.filter((p) => p.alive).length;
}

/** Nodes a living player may not enter or cross: the resident ghost and every player ghost. */
export function hostileNodes(state: GameState): Set<number> {
  const s = new Set([state.ghost]);
  for (const p of state.players) if (!p.alive) s.add(p.node);
  return s;
}

/** turnNumber of seat i's next scheduled turn after the current one. */
function nextTurnNumberOf(state: GameState, i: number): number {
  const n = state.players.length;
  const ahead = (i - state.turn + n) % n;
  return state.turnNumber + (ahead === 0 ? n : ahead);
}

export function survivalBonusQualifies(p: PlayerState): boolean {
  return p.alive && p.banked >= SCORING.survivalBonusMinBanked;
}

export function movementAllowance(state: GameState, moveDie: 0 | 1 = state.selection.moveDie): number {
  if (!state.dice) return 0;
  return state.dice.length === 1 ? state.dice[0] : state.dice[moveDie];
}

export function ghostAllowance(state: GameState, moveDie: 0 | 1 = state.selection.moveDie): number {
  if (!state.dice || state.dice.length < 2) return 0;
  return state.dice[moveDie === 0 ? 1 : 0] + state.ghostBonus;
}

/** Legal destinations for the active seat (living or ghost). Never depends on hidden traps. */
export function legalRoutes(state: GameState, moveDie: 0 | 1 = state.selection.moveDie): Map<number, PlayerRoute> {
  if (!state.dice) return new Map();
  const p = activePlayer(state);
  if (!p.alive) return playerRoutes(p.node, state.dice[0], { ghost: true });
  return playerRoutes(p.node, state.dice[moveDie], { blocked: hostileNodes(state) });
}

// ── secret placement ────────────────────────────────────────────────────

function wingOf(node: number): string {
  for (const [wing, nodes] of Object.entries(TRAP_WINGS)) if (nodes.includes(node)) return wing;
  return 'other';
}

/**
 * Turn the nominations into exactly six traps: duplicates merge silently,
 * then the game fills the remaining slots without replacement, preferring
 * the wings with the fewest traps so far.
 */
function finalizeTraps(s: GameState) {
  const picks: number[] = [];
  for (const n of s.nominations) if (n !== null && !picks.includes(n)) picks.push(n);
  let rng = s.rng;
  while (picks.length < TRAP_COUNT) {
    const free = TRAP_ELIGIBLE.filter((n) => !picks.includes(n));
    const counts = new Map<string, number>();
    for (const w of Object.keys(TRAP_WINGS)) counts.set(w, 0);
    for (const n of picks) counts.set(wingOf(n), (counts.get(wingOf(n)) ?? 0) + 1);
    const wingsWithRoom = [...counts.keys()].filter((w) => free.some((n) => wingOf(n) === w));
    const least = Math.min(...wingsWithRoom.map((w) => counts.get(w)!));
    const wings = wingsWithRoom.filter((w) => counts.get(w) === least);
    let v: number;
    [v, rng] = nextFloat(rng);
    const wing = wings[Math.floor(v * wings.length)];
    const pool = free.filter((n) => wingOf(n) === wing);
    [v, rng] = nextFloat(rng);
    picks.push(pool[Math.floor(v * pool.length)]);
  }
  s.rng = rng;
  s.traps = picks.map((node) => ({ node, revealed: false }));
}

// ── resident ghost targeting and movement ───────────────────────────────

/**
 * Who the resident ghost hunts: a live decoy, else the exposed living player
 * carrying the most; ties to the nearest, then the active player, then the
 * first clockwise after them. Ghosts and protected players are ignored.
 */
export function ghostTarget(state: GameState): GhostTarget | null {
  if (state.decoy !== null) return { kind: 'decoy', node: state.decoy };
  const n = state.players.length;
  const { dist } = ghostBfs(state.ghost);
  let best: number | null = null;
  let bestKey: [number, number, number] | null = null;
  for (let i = 0; i < n; i++) {
    if (!isExposed(state, i)) continue;
    const p = state.players[i];
    const key: [number, number, number] = [-p.carried, dist[p.node], (i - state.turn + n) % n];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = i;
      bestKey = key;
    }
  }
  if (best === null) return null;
  return { kind: 'player', player: best, node: state.players[best].node };
}

/** Plan this ghost phase without changing anything. It stops at its first encounter. */
export function planGhost(state: GameState, allowance: number): GhostPlan {
  const target = ghostTarget(state);
  if (!target) return { target: null, allowance, fullPath: [state.ghost], path: [state.ghost], reachesTarget: false, encounter: null };
  const fullPath = ghostPath(state.ghost, target.node) ?? [state.ghost];
  const steps = Math.min(allowance, fullPath.length - 1);
  let path = fullPath.slice(0, steps + 1);
  let encounter: GhostPlan['encounter'] = null;
  const n = state.players.length;
  for (let k = 1; k < path.length && !encounter; k++) {
    const node = path[k];
    const here = state.players.map((_, i) => i).filter((i) => state.players[i].node === node && isExposed(state, i));
    if (!here.length) continue;
    const chosen = target.kind === 'player' && here.includes(target.player!) ? target.player! : here.sort((a, b) => ((a - state.turn + n) % n) - ((b - state.turn + n) % n))[0];
    encounter = { player: chosen, node };
    path = path.slice(0, k + 1);
  }
  return { target, allowance, fullPath, path, reachesTarget: path[path.length - 1] === target.node, encounter };
}

// ── challenges ──────────────────────────────────────────────────────────

function newChallenge(
  s: GameState,
  kind: ChallengeKind,
  host: ChallengeHost,
  participants: number[],
  node: number,
  oneSurvivor: boolean,
  attacker: number | null,
  cont: Continuation,
  events: LogEntry[],
): Challenge {
  let v: number;
  [v, s.challengeRng] = nextFloat(s.challengeRng);
  s.challengeCount += 1;
  const ch: Challenge = {
    id: `c${s.turnNumber}-${s.challengeCount}`,
    kind,
    seed: Math.floor(v * 0x7fffffff),
    participants,
    host,
    node,
    origins: participants.map((p) => s.players[p].node),
    oneSurvivor,
    attacker,
    attempt: 0,
    cont,
  };
  s.challenge = ch;
  s.phase = 'challenge';
  events.push({ kind: 'challenge', challenge: ch });
  return ch;
}

/** A regular Reaper performance: Dance for Death or Graveyard Jump Rope, chosen privately. */
function soloReaper(s: GameState, host: ChallengeHost, player: number, node: number, cont: Continuation, events: LogEntry[]) {
  let v: number;
  [v, s.challengeRng] = nextFloat(s.challengeRng);
  newChallenge(s, v < 0.5 ? 'dance' : 'rope', host, [player], node, false, null, cont, events);
}

function startDuel(s: GameState, a: number, b: number, host: ChallengeHost, node: number, cont: Continuation, events: LogEntry[]) {
  const oneSurvivor = host === 'superReaper' || s.round >= LETHAL_DUELS_FROM_ROUND;
  newChallenge(s, 'duel', host, [a, b], node, oneSurvivor, null, cont, events);
}

function startEscape(s: GameState, player: number, host: ChallengeHost, attacker: number | null, cont: Continuation, events: LogEntry[]) {
  newChallenge(s, 'escape', host, [player], s.players[player].node, false, attacker, cont, events);
}

export interface JudgedResult {
  survivors: number[];
  scores: number[];
  decidedBy?: string;
}

/** Judge a challenge's inputs. Pure: same challenge + same inputs → same verdict. */
export function judgeChallenge(ch: Challenge, inputs: Record<number, import('./challenges').ChallengeInput[]>): JudgedResult {
  const get = (p: number) => inputs[p] ?? [];
  if (ch.kind === 'duel') {
    const [a, b] = ch.participants;
    const v = judgeDuel(ch.seed, [a, b], [get(a), get(b)], ch.oneSurvivor);
    return { survivors: v.survivors, scores: v.scores, decidedBy: v.decidedBy };
  }
  const p = ch.participants[0];
  if (ch.kind === 'escape') {
    const r = judgeEscape(ch.seed, get(p));
    return { survivors: r.survived ? [p] : [], scores: [r.hits.filter(Boolean).length] };
  }
  if (ch.kind === 'dance') {
    const r = judgeDance(ch.seed, get(p));
    return { survivors: r.survived ? [p] : [], scores: [r.attempts.filter(Boolean).length] };
  }
  const r = judgeSoloRope(ch.seed, get(p));
  return { survivors: r.survived ? [p] : [], scores: [r.score] };
}

function kill(s: GameState, player: number, node: number): number {
  const p = s.players[player];
  const dropped = p.carried;
  s.piles[node] += dropped;
  p.carried = 0;
  p.alive = false;
  p.node = node;
  p.decoyUsed = true;
  p.protectedUntil = null;
  p.diedInRound = s.round;
  return dropped;
}

function protect(s: GameState, player: number) {
  s.players[player].protectedUntil = nextTurnNumberOf(s, player);
}

/** Nearest empty corridor space, by ordinary edges, for a survivor who broke a curse. */
export function escapeDestination(s: GameState, origin: number): number | null {
  const hostile = hostileNodes(s);
  return nearestWhere(origin, (n) => {
    const k = nodeKind(n);
    return (k === 'corridor' || k === 'secret') && n !== ENTRANCE && !hostile.has(n) && !s.players.some((p) => p.node === n);
  });
}

function resolveChallenge(s: GameState, ch: Challenge, verdict: JudgedResult, events: LogEntry[]) {
  const outcome: ChallengeOutcome = {
    challengeId: ch.id,
    kind: ch.kind,
    host: ch.host,
    participants: ch.participants.slice(),
    survivors: verdict.survivors.slice(),
    deaths: [],
    relocations: [],
    scores: verdict.scores,
    decidedBy: verdict.decidedBy,
  };
  // Deaths and survivals settle together, before anything else is checked.
  ch.participants.forEach((p, k) => {
    if (verdict.survivors.includes(p)) return;
    const dropped = kill(s, p, ch.origins[k]);
    outcome.deaths.push({ player: p, node: ch.origins[k], dropped });
  });
  if (ch.attacker !== null && outcome.deaths.length) {
    const hunter = s.players[ch.attacker];
    const amount = Math.max(0, Math.min(SCORING.bountyCap - hunter.bounty, SCORING.bountyPerKill));
    hunter.bounty += amount;
    outcome.bounty = { player: ch.attacker, amount };
  }
  for (const p of verdict.survivors) protect(s, p);
  if (ch.kind === 'escape') {
    for (const p of verdict.survivors) {
      const from = s.players[p].node;
      const to = escapeDestination(s, from);
      if (to !== null) {
        s.players[p].facingFrom = from;
        s.players[p].node = to;
        outcome.relocations.push({ player: p, from, to });
      }
    }
  }
  s.challenge = null;
  s.lastOutcome = outcome;
  events.push({ kind: 'outcome', outcome });

  if (livingCount(s) === 0) {
    s.phase = 'gameOver';
    s.endReason = 'noneAlive';
    events.push({ kind: 'gameOver', reason: 'noneAlive' });
    return;
  }

  const cont = ch.cont;
  if (cont.kind !== 'landing') {
    s.phase = 'summary';
    return;
  }
  // Rewards for the landing come only after surviving it, and only once.
  s.phase = 'ghost';
  const arriving = cont.arriving;
  const arrivingLives = verdict.survivors.includes(arriving);
  if (ch.kind === 'duel' && ch.host !== 'superReaper') {
    const defender = ch.participants.find((p) => p !== arriving)!;
    if (arrivingLives) landingRewards(s, arriving, cont.dest, true, events);
    else if (verdict.survivors.includes(defender)) landingRewards(s, defender, cont.dest, false, events);
  } else if (arrivingLives) {
    landingRewards(s, arriving, cont.dest, true, events);
  }
}

// ── landing ─────────────────────────────────────────────────────────────

/** Room harvest, dropped candy, and (for the mover) a Trick or Treat card. */
function landingRewards(s: GameState, pi: number, dest: number, allowEvent: boolean, events: LogEntry[], drawEvent = true) {
  const p = s.players[pi];
  const out = { harvest: 0, pile: 0, triggersEvent: false };
  if (ROOMS[dest]) {
    const take = Math.min(HARVEST_PER_LANDING, s.stocks[dest]);
    s.stocks[dest] -= take;
    p.carried += take;
    out.harvest = take;
    events.push({ kind: 'harvest', player: pi, node: dest, amount: take, remaining: s.stocks[dest] });
  }
  if (s.piles[dest] > 0) {
    out.pile = s.piles[dest];
    p.carried += s.piles[dest];
    s.piles[dest] = 0;
    events.push({ kind: 'pile', player: pi, node: dest, amount: out.pile });
  }
  if (allowEvent && EVENT_NODES.includes(dest)) {
    out.triggersEvent = true;
    if (drawEvent) drawCard(s, events);
  }
  return out;
}

/** Living opponents a Super Reaper summons could choose (anywhere outside the entrance). */
export function summonOptions(s: GameState, arriving: number): number[] {
  return s.players.map((_, i) => i).filter((i) => i !== arriving && isExposed(s, i));
}

/**
 * What a living player's normal landing would set off. With `knownOnly`,
 * hidden traps are ignored — used for anything a player can see.
 */
export function encounterAt(s: GameState, i: number, dest: number, knownOnly: boolean): { encounter: Encounter; hiddenTrap: boolean; spared: boolean } {
  const none = { encounter: { kind: 'none' } as Encounter, hiddenTrap: false, spared: false };
  if (dest === ENTRANCE) return none;
  if (dest === SUPER_REAPER) return { encounter: { kind: 'superReaper', opponents: summonOptions(s, i) }, hiddenTrap: false, spared: false };
  const trap = s.traps.find((t) => t.node === dest && (!knownOnly || t.revealed));
  const hiddenTrap = !!trap && !trap.revealed;
  const prot = isProtected(s, i);
  const opponents = prot ? [] : s.players.map((_, j) => j).filter((j) => j !== i && s.players[j].node === dest && isExposed(s, j));
  if (opponents.length) return { encounter: { kind: 'duel', lethal: s.round >= LETHAL_DUELS_FROM_ROUND, opponents }, hiddenTrap, spared: false };
  if (trap) {
    // A known Reaper waives protection; an unknown one cannot silently strip it.
    if (trap.revealed || !prot) return { encounter: { kind: 'reaper' }, hiddenTrap, spared: false };
    return { encounter: { kind: 'none' }, hiddenTrap, spared: true };
  }
  return none;
}

function resolveLivingLanding(s: GameState, route: PlayerRoute | null, events: LogEntry[]) {
  const pi = s.turn;
  const p = s.players[pi];
  s.phase = 'ghost';
  if (!route) {
    events.push({ kind: 'stay', player: pi, node: p.node });
    return;
  }
  const dest = route.dest;
  p.facingFrom = route.path[route.path.length - 2];
  p.node = dest;
  events.push({ kind: 'move', player: pi, path: route.path, usesSecret: route.usesSecret });

  if (dest === ENTRANCE) {
    const amount = p.carried;
    p.banked += amount;
    p.carried = 0;
    events.push({ kind: 'bank', player: pi, amount, total: p.banked });
    return;
  }
  const { encounter, hiddenTrap, spared } = encounterAt(s, pi, dest, false);
  if (hiddenTrap) {
    s.traps.find((t) => t.node === dest)!.revealed = true;
    events.push({ kind: 'trapRevealed', node: dest, player: pi });
  }
  const cont: Continuation = { kind: 'landing', arriving: pi, dest };
  switch (encounter.kind) {
    case 'superReaper':
      if (encounter.opponents.length === 1) startDuel(s, pi, encounter.opponents[0], 'superReaper', dest, cont, events);
      else if (encounter.opponents.length > 1) {
        s.pick = { kind: 'summon', options: encounter.opponents, cont };
        s.phase = 'pick';
      } else soloReaper(s, 'superReaper', pi, dest, cont, events);
      return;
    case 'duel':
      if (encounter.opponents.length === 1) startDuel(s, pi, encounter.opponents[0], hiddenTrap || s.traps.some((t) => t.node === dest) ? 'reaper' : 'duel', dest, cont, events);
      else {
        s.pick = { kind: 'duel', options: encounter.opponents, cont };
        s.phase = 'pick';
      }
      return;
    case 'reaper':
      soloReaper(s, 'reaper', pi, dest, cont, events);
      return;
    default:
      if (spared) events.push({ kind: 'spared', node: dest, player: pi });
      landingRewards(s, pi, dest, true, events);
  }
}

function drawCard(s: GameState, events: LogEntry[]): void {
  if (s.deck.length === 0) {
    const [deck, rng] = shuffle(s.discard, s.rng);
    s.deck = deck;
    s.discard = [];
    s.rng = rng;
  }
  const cardId = s.deck[0];
  s.deck = s.deck.slice(1);
  s.discard = [...s.discard, cardId];
  const pi = s.turn;
  const me = s.players[pi];
  const type = cardType(cardId);
  const hostile = hostileNodes(s);
  events.push({ kind: 'card', player: pi, cardId });

  const ev: EventState = { cardId, type, status: 'resolved', options: [], canDecline: false };
  switch (type) {
    case 'secretPassage': {
      ev.options = SECRET_ENDPOINTS.filter((n) => !hostile.has(n) && n !== me.node);
      ev.canDecline = true;
      if (ev.options.length) ev.status = 'choice';
      else events.push({ kind: 'noEffect', player: pi, reason: 'No secret passage is free of ghosts.' });
      break;
    }
    case 'stickyFingers': {
      ev.options = stickyTargets(s);
      if (ev.options.length) ev.status = 'choice';
      else events.push({ kind: 'noEffect', player: pi, reason: 'No living opponent with candy is on or next to your space.' });
      break;
    }
    case 'sweetDiscovery': {
      me.carried += 2;
      events.push({ kind: 'gain', player: pi, amount: 2 });
      break;
    }
    case 'creakyFloorboards': {
      s.ghostBonus += 2;
      events.push({ kind: 'ghostBonus', amount: 2 });
      break;
    }
    case 'costumeMixup': {
      ev.options = s.players
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => i !== pi && p.alive && p.node !== ENTRANCE && !hostile.has(p.node) && !hostile.has(me.node))
        .map(({ i }) => i);
      ev.canDecline = true;
      if (ev.options.length) ev.status = 'choice';
      else events.push({ kind: 'noEffect', player: pi, reason: 'No living opponent is out in the house to swap with.' });
      break;
    }
    case 'flyingCandy': {
      const amount = Math.min(2, me.carried);
      if (amount > 0) {
        me.carried -= amount;
        s.piles[me.node] += amount;
        events.push({ kind: 'drop', player: pi, node: me.node, amount });
      } else {
        events.push({ kind: 'noEffect', player: pi, reason: 'Your sack is empty, so nothing flies out.' });
      }
      break;
    }
  }
  s.event = ev;
  s.phase = ev.status === 'choice' ? 'event' : 'ghost';
}

export function stickyTargets(state: GameState): number[] {
  const me = state.players[state.turn];
  if (me.node === ENTRANCE || !me.alive) return [];
  const near = new Set([me.node, ...ORDINARY_ADJ[me.node]]);
  return state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== state.turn && p.alive && p.node !== ENTRANCE && p.carried > 0 && near.has(p.node))
    .map(({ i }) => i);
}

// ── previews ────────────────────────────────────────────────────────────

/** A copy with hidden traps removed: what anyone at the table may know. */
export function withoutHiddenTraps(state: GameState): GameState {
  return { ...clone(state), traps: state.traps.filter((t) => t.revealed).map((t) => ({ ...t })) };
}

/**
 * Forecast a move. Never mutates the given state, never consumes randomness,
 * and never looks at unrevealed traps.
 */
export function previewMove(state: GameState, moveDie: 0 | 1, dest: number | 'stay'): MovePreview | null {
  if (state.phase !== 'choose' || !state.dice) return null;
  const pub = withoutHiddenTraps(state);
  const pi = pub.turn;
  const me = pub.players[pi];
  let route: PlayerRoute | null = null;
  if (dest !== 'stay') {
    route = legalRoutes(pub, moveDie).get(dest) ?? null;
    if (!route) return null;
  }
  const base = {
    dest,
    path: route ? route.path : [me.node],
    usesSecret: route?.usesSecret ?? false,
    harvest: 0,
    pile: 0,
    bank: 0,
    carriedAfter: me.carried,
    triggersEvent: false,
    encounter: { kind: 'none' } as Encounter,
    waivesProtection: false,
    ghost: null as GhostPlan | null,
    provisional: false,
  };
  if (!me.alive) {
    if (dest !== 'stay') {
      const targets = pub.players.map((_, i) => i).filter((i) => i !== pi && pub.players[i].node === dest && isExposed(pub, i));
      if (targets.length) base.encounter = { kind: 'haunt', targets };
    }
    return base;
  }
  const sim = clone(pub);
  sim.selection = { moveDie, dest };
  const p = sim.players[pi];
  let encounter: Encounter = { kind: 'none' };
  if (route) {
    p.facingFrom = route.path[route.path.length - 2];
    p.node = route.dest;
    if (route.dest === ENTRANCE) {
      base.bank = p.carried;
      p.banked += p.carried;
      p.carried = 0;
    } else {
      encounter = encounterAt(sim, pi, route.dest, true).encounter;
      const known = sim.traps.some((t) => t.node === route!.dest) || route.dest === SUPER_REAPER;
      base.waivesProtection = known && isProtected(sim, pi);
      if (encounter.kind === 'none' || encounter.kind === 'duel') {
        // Rewards are shown as what surviving would bring.
        const r = landingRewards(sim, pi, route.dest, true, [], false);
        base.harvest = r.harvest;
        base.pile = r.pile;
        base.triggersEvent = r.triggersEvent;
      }
    }
  }
  base.carriedAfter = sim.players[pi].carried;
  base.encounter = encounter;
  base.ghost = planGhost(sim, ghostAllowance(state, moveDie));
  base.provisional = base.triggersEvent || encounter.kind !== 'none';
  return base;
}

/** The exact resident-ghost plan once the move and any event have resolved. */
export function currentGhostPlan(state: GameState): GhostPlan | null {
  if (state.phase !== 'ghost' || !state.dice || state.dice.length < 2) return null;
  return planGhost(state, ghostAllowance(state));
}

// ── the state machine ───────────────────────────────────────────────────

export function canPlaceDecoy(state: GameState): boolean {
  const p = activePlayer(state);
  return state.phase === 'turnStart' && p.alive && !p.decoyUsed && p.node !== ENTRANCE && state.decoy === null;
}

export function apply(state: GameState, action: Action): ActionResult {
  const s = clone(state);
  const events: LogEntry[] = [];
  const me = s.players[s.turn];

  switch (action.type) {
    case 'nominate': {
      if (s.phase !== 'placement') return fail(state, 'Placement is over.');
      if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= s.players.length) return fail(state, 'No such seat.');
      if (s.nominations[action.seat] !== null) return fail(state, 'That seat has already chosen.');
      if (!trapEligible(action.node)) return fail(state, 'That space cannot hold a trap.');
      s.nominations[action.seat] = action.node;
      if (s.nominations.every((n) => n !== null)) {
        finalizeTraps(s);
        s.phase = 'turnStart';
        events.push({ kind: 'placementDone' });
      }
      // Placement never counts as turn progress, so undo stays clean.
      return { state: s, events };
    }
    case 'placeDecoy': {
      if (!canPlaceDecoy(state)) return fail(state, 'You cannot place a decoy now.');
      me.decoyUsed = true;
      s.decoy = me.node;
      events.push({ kind: 'decoy', player: s.turn, node: me.node });
      break;
    }
    case 'roll': {
      if (s.phase !== 'turnStart') return fail(state, 'Already rolled.');
      let a: number;
      [a, s.rng] = rollDie(s.rng);
      if (me.alive) {
        let b: number;
        [b, s.rng] = rollDie(s.rng);
        s.dice = [a, b];
      } else s.dice = [a];
      s.selection = { moveDie: 0, dest: null };
      s.phase = 'choose';
      events.push({ kind: 'roll', player: s.turn, dice: s.dice.slice() });
      break;
    }
    case 'select': {
      if (s.phase !== 'choose') return fail(state, 'Nothing to select now.');
      if (action.moveDie !== undefined && me.alive) {
        s.selection.moveDie = action.moveDie;
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
      if (me.alive) resolveLivingLanding(s, route, events);
      else resolveGhostMove(s, route, events);
      break;
    }
    case 'pickOpponent': {
      const pk = s.pick;
      if (s.phase !== 'pick' || !pk) return fail(state, 'Nothing to pick.');
      if (!pk.options.includes(action.option)) return fail(state, 'That is not a legal choice.');
      s.pick = null;
      if (pk.kind === 'haunt') startEscape(s, action.option, 'playerGhost', s.turn, pk.cont, events);
      else {
        const cont = pk.cont as Extract<Continuation, { kind: 'landing' }>;
        const host: ChallengeHost = pk.kind === 'summon' ? 'superReaper' : s.traps.some((t) => t.node === cont.dest) ? 'reaper' : 'duel';
        startDuel(s, cont.arriving, action.option, host, cont.dest, cont, events);
      }
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
    case 'challengeResult': {
      const ch = s.challenge;
      if (s.phase !== 'challenge' || !ch) return fail(state, 'No challenge in progress.');
      if (action.id !== ch.id) return fail(state, 'That challenge is already over.');
      if (!ch.participants.every((p) => Array.isArray(action.inputs[p]))) return fail(state, 'Inputs are missing for a participant.');
      resolveChallenge(s, ch, judgeChallenge(ch, action.inputs), events);
      break;
    }
    case 'moveGhost': {
      if (s.phase !== 'ghost') return fail(state, 'The ghost is not ready to move.');
      const plan = planGhost(s, ghostAllowance(s));
      s.decoy = null;
      if (!plan.target) {
        events.push({ kind: 'ghostWaits' });
        s.phase = 'summary';
      } else {
        s.ghost = plan.path[plan.path.length - 1];
        events.push({ kind: 'ghost', plan });
        if (plan.encounter) startEscape(s, plan.encounter.player, 'npc', null, { kind: 'npc' }, events);
        else s.phase = 'summary';
      }
      break;
    }
    case 'nextTurn': {
      if (s.phase !== 'summary') return fail(state, 'Finish this turn first.');
      const n = s.players.length;
      if (s.turn === n - 1 && s.round === ROUNDS) {
        s.phase = 'gameOver';
        s.endReason = 'midnight';
        events.push({ kind: 'gameOver', reason: 'midnight' });
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
      for (const p of s.players) if (p.protectedUntil !== null && s.turnNumber > p.protectedUntil) p.protectedUntil = null;
      s.phase = 'turnStart';
      s.dice = null;
      s.selection = { moveDie: 0, dest: null };
      s.decoy = null;
      s.ghostBonus = 0;
      s.event = null;
      s.pick = null;
      s.lastOutcome = null;
      s.log = [];
      s.turnDirty = false;
      return { state: s, events };
    }
  }
  s.log = [...s.log, ...events];
  s.turnDirty = true;
  return { state: s, events };
}

/** A player ghost's move: no traps, no candy, no cards; ending on the living starts a hunt. */
function resolveGhostMove(s: GameState, route: PlayerRoute | null, events: LogEntry[]) {
  const pi = s.turn;
  const p = s.players[pi];
  s.phase = 'summary';
  if (!route) {
    events.push({ kind: 'stay', player: pi, node: p.node });
    return;
  }
  p.facingFrom = route.path[route.path.length - 2];
  p.node = route.dest;
  events.push({ kind: 'move', player: pi, path: route.path, usesSecret: route.usesSecret });
  const targets = s.players.map((_, i) => i).filter((i) => i !== pi && s.players[i].node === route.dest && isExposed(s, i));
  if (targets.length === 1) startEscape(s, targets[0], 'playerGhost', pi, { kind: 'playerGhost' }, events);
  else if (targets.length > 1) {
    s.pick = { kind: 'haunt', options: targets, cont: { kind: 'playerGhost' } };
    s.phase = 'pick';
  }
}

// ── scoring ─────────────────────────────────────────────────────────────

export interface ScoreLine {
  player: number;
  alive: boolean;
  banked: number;
  carried: number;
  carriedHalf: number;
  survivalBonus: number;
  bounty: number;
  total: number;
  rank: number;
  winner: boolean;
}

export function scoreOf(p: PlayerState): Omit<ScoreLine, 'player' | 'rank' | 'winner'> {
  if (!p.alive) return { alive: false, banked: p.banked, carried: 0, carriedHalf: 0, survivalBonus: 0, bounty: p.bounty, total: p.banked + p.bounty };
  const carriedHalf = Math.floor(p.carried / 2);
  const survivalBonus = survivalBonusQualifies(p) ? SCORING.survivalBonus : 0;
  return { alive: true, banked: p.banked, carried: p.carried, carriedHalf, survivalBonus, bounty: 0, total: p.banked + carriedHalf + survivalBonus };
}

export function finalScores(state: GameState): ScoreLine[] {
  const lines: ScoreLine[] = state.players.map((p, i) => ({ player: i, ...scoreOf(p), rank: 0, winner: false }));
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
 * RNG, deck, stocks, traps and all — so a replayed turn rolls the same dice.
 * `known` is the table's memory of revealed traps: undo never erases it.
 */
export interface Session {
  game: GameState;
  turnStart: GameState;
  previousTurnStart: GameState | null;
  known: number[];
}

export function newSession(game: GameState): Session {
  return { game, turnStart: game, previousTurnStart: null, known: [] };
}

function remember(known: number[], game: GameState): number[] {
  const add = game.traps.filter((t) => t.revealed && !known.includes(t.node)).map((t) => t.node);
  return add.length ? [...known, ...add] : known;
}

export function dispatch(session: Session, action: Action): { session: Session; events: LogEntry[]; error?: string } {
  const result = apply(session.game, action);
  if (result.error) return { session, events: [], error: result.error };
  const known = remember(session.known ?? [], result.state);
  if (action.type === 'nominate' && result.state.phase === 'turnStart') {
    // Placement is finished: this is the game's first real snapshot.
    return { session: { game: result.state, turnStart: result.state, previousTurnStart: null, known }, events: result.events };
  }
  if (action.type === 'nominate') return { session: { ...session, game: result.state, turnStart: result.state, known }, events: result.events };
  if (action.type === 'nextTurn' && result.state.phase === 'turnStart') {
    return {
      session: { game: result.state, turnStart: result.state, previousTurnStart: session.turnStart, known },
      events: result.events,
    };
  }
  return { session: { ...session, game: result.state, known }, events: result.events };
}

export interface UndoInfo {
  available: boolean;
  which: 'current' | 'previous' | null;
  playerName: string;
  round: number;
}

export function undoInfo(session: Session): UndoInfo {
  const g = session.game;
  if (g.phase === 'placement') return { available: false, which: null, playerName: '', round: g.round };
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
    return { game: session.previousTurnStart, turnStart: session.previousTurnStart, previousTurnStart: null, known: session.known };
  }
  return session;
}
