// The rules of One More Room: One Life, as a pure, deterministic state
// machine. Every function here takes a snapshot and returns a new one;
// nothing is mutated in place and nothing reads the clock or Math.random.
//
// One piece is alive. Everyone else is a ghost trying to steal that life.
// Whoever holds it when a round ends scores a point.

import {
  CHARACTERS,
  curseMultiplier,
  ENTRANCE,
  GHOST_MIN_MOVE,
  GHOST_SPAWNS,
  LIVING_SPAWN,
  MAX_CONTROLLERS_PER_PIECE,
  MAX_PIECES,
  MIN_PIECES,
  NODE_COUNT,
  POLICY,
  ROUNDS,
  SEANCE_LIMIT,
  SUPER_REAPER,
  TRAP_COUNT,
  TRAP_EFFECTS,
  TRAP_ELIGIBLE,
  TRAP_WINGS,
  trapEligible,
  type CharacterId,
  type TrapEffect,
} from './config';
import { inAttackRange, ordinaryDistance, pieceRoutes, type PlayerRoute } from './graph';
import { nextFloat, rollDie, seedFrom, shuffle } from './rng';
import { judgeRope, type ChallengeInput } from './challenges';
import type { Action, ActionResult, Challenge, ChallengeHost, ChallengeOutcome, GameState, KnownEffect, LogEntry, MovePreview, PieceState, Trap } from './types';

export interface PieceSetup {
  character: CharacterId;
  /** One name per person (one or two); a bot has exactly one. */
  controllers: string[];
  bot?: boolean;
  /** Display name; defaults to the controllers joined with “&”. */
  name?: string;
}

export interface NewGameOptions {
  pieces: PieceSetup[];
  seed: number;
  /** Skip secret placement with these six traps (tests and tools only). */
  presetTraps?: Array<{ node: number; effect: TrapEffect }>;
}

export function createGame({ pieces, seed, presetTraps }: NewGameOptions): GameState {
  if (pieces.length < MIN_PIECES || pieces.length > MAX_PIECES) throw new Error(`One More Room needs ${MIN_PIECES}–${MAX_PIECES} pieces`);
  if (new Set(pieces.map((p) => p.character)).size !== pieces.length) throw new Error('Each piece needs a distinct character');
  if (!pieces.every((p) => CHARACTERS.some((c) => c.id === p.character))) throw new Error('Unknown character');
  for (const p of pieces) {
    const max = p.bot ? 1 : MAX_CONTROLLERS_PER_PIECE;
    if (p.controllers.length < 1 || p.controllers.length > max) throw new Error('A piece has one or two people, or one bot');
  }
  const rng0 = seed >>> 0;
  const state: GameState = {
    schema: 3,
    seed: rng0,
    rng: seedFrom(`board:${rng0}`),
    challengeRng: seedFrom(`challenge:${rng0}`),
    challengeCount: 0,
    pieces: pieces.map<PieceState>((p, i) => ({
      id: `p${i + 1}`,
      name: p.name ?? p.controllers.join(' & '),
      character: p.character,
      controllers: p.controllers.slice(),
      bot: !!p.bot,
      node: ENTRANCE,
      alive: false,
      score: 0,
      streak: 0,
      facingFrom: null,
    })),
    phase: 'placement',
    round: 1,
    schedule: [],
    slot: 0,
    actionNumber: 0,
    die: null,
    allowance: 0,
    selection: { dest: null },
    origin: null,
    minigameUsed: false,
    pick: null,
    challenge: null,
    lastOutcome: null,
    nominations: pieces.map(() => null),
    traps: [],
    seancesUsed: 0,
    log: [],
    turnDirty: false,
  };
  if (presetTraps) {
    const nodes = presetTraps.map((t) => t.node);
    if (new Set(nodes).size !== TRAP_COUNT || !nodes.every(trapEligible)) throw new Error('Preset traps must be six distinct eligible nodes');
    state.traps = presetTraps.map((t) => ({ node: t.node, effect: t.effect, revealed: false, spent: false }));
    state.phase = 'lifeRoll';
  }
  return state;
}

// ── small immutable helpers ─────────────────────────────────────────────

export function clone(state: GameState): GameState {
  return {
    ...state,
    pieces: state.pieces.map((p) => ({ ...p, controllers: p.controllers.slice() })),
    schedule: state.schedule.slice(),
    selection: { ...state.selection },
    pick: state.pick ? { ...state.pick, options: state.pick.options.slice() } : null,
    nominations: state.nominations.slice(),
    traps: state.traps.map((t) => ({ ...t })),
    log: state.log.slice(),
  };
}

function fail(state: GameState, error: string): ActionResult {
  return { state, events: [], error };
}

function draw(s: GameState): number {
  let v: number;
  [v, s.rng] = nextFloat(s.rng);
  return v;
}

/** The one living piece (−1 before the life roll). */
export function livingPiece(state: GameState): number {
  return state.pieces.findIndex((p) => p.alive);
}

/** The piece whose scheduled action it is (−1 outside the action phases). */
export function actingPiece(state: GameState): number {
  return state.schedule[state.slot] ?? -1;
}

/**
 * Which of a piece's people controls it this round: the first person in odd
 * rounds, the second in even rounds. A solo piece's person controls every round.
 */
export function activeController(state: GameState, piece: number): number {
  const p = state.pieces[piece];
  return p.controllers.length >= 2 ? (state.round % 2 === 1 ? 0 : 1) : 0;
}

export function movementAllowance(die: number, alive: boolean): number {
  return alive ? die : Math.max(GHOST_MIN_MOVE, die);
}

/** Legal destinations for the acting piece. Never depends on hidden traps. */
export function legalRoutes(state: GameState): Map<number, PlayerRoute> {
  const i = actingPiece(state);
  if (i < 0 || state.die === null) return new Map();
  const p = state.pieces[i];
  return pieceRoutes(p.node, state.allowance, !p.alive);
}

/** The frozen order for a round: the living piece first, then the hunters by a rotating priority. */
export function buildSchedule(state: GameState): number[] {
  const n = state.pieces.length;
  const living = livingPiece(state);
  const offset = POLICY.rotateHunters ? (state.round - 1) % n : 0;
  const hunters = Array.from({ length: n }, (_, k) => (offset + k) % n).filter((i) => i !== living);
  return [living, ...hunters];
}

/** Can this ghost challenge the living piece from where it stands? */
export function canHunt(state: GameState, ghost: number): boolean {
  const living = livingPiece(state);
  if (living < 0 || ghost === living || state.pieces[ghost].alive) return false;
  return inAttackRange(state.pieces[ghost].node, state.pieces[living].node);
}

// ── secret placement ────────────────────────────────────────────────────

function wingOf(node: number): string {
  for (const [w, nodes] of Object.entries(TRAP_WINGS)) if (nodes.includes(node)) return w;
  return 'other';
}

/**
 * Merge the nominations (duplicates silently collapse), top up to six with
 * seeded picks that favour the least-cursed wing, then privately shuffle the
 * six effects over the six spaces. Players choose places, never effects.
 */
function finalizeTraps(s: GameState) {
  const chosen: number[] = [];
  for (const n of s.nominations) if (n !== null && !chosen.includes(n)) chosen.push(n);
  while (chosen.length < TRAP_COUNT) {
    const pool = TRAP_ELIGIBLE.filter((n) => !chosen.includes(n));
    const count = (w: string) => chosen.filter((c) => wingOf(c) === w).length;
    const fewest = Math.min(...pool.map((n) => count(wingOf(n))));
    const preferred = pool.filter((n) => count(wingOf(n)) === fewest);
    chosen.push(preferred[Math.floor(draw(s) * preferred.length)]);
  }
  let effects: TrapEffect[];
  [effects, s.rng] = shuffle(TRAP_EFFECTS, s.rng);
  s.traps = chosen.map((node, k) => ({ node, effect: effects[k], revealed: false, spent: false }));
}

// ── the life roll and spawns ────────────────────────────────────────────

function rollForLife(s: GameState, events: LogEntry[]) {
  const n = s.pieces.length;
  let contenders = Array.from({ length: n }, (_, i) => i);
  const rolls: Array<Array<number | null>> = [];
  for (let guard = 0; guard < 50 && contenders.length > 1; guard++) {
    const row: Array<number | null> = new Array(n).fill(null);
    for (const i of contenders) [row[i], s.rng] = rollDie(s.rng);
    rolls.push(row);
    const top = Math.max(...contenders.map((i) => row[i]!));
    contenders = contenders.filter((i) => row[i] === top);
  }
  const winner = contenders[0];
  events.push({ kind: 'lifeRoll', rolls, winner });
  let spawns: number[];
  [spawns, s.rng] = shuffle(GHOST_SPAWNS, s.rng);
  let k = 0;
  s.pieces.forEach((p, i) => {
    p.alive = i === winner;
    p.node = i === winner ? LIVING_SPAWN : spawns[k++ % spawns.length];
    events.push({ kind: 'spawn', piece: i, node: p.node, alive: p.alive });
  });
}

function startRound(s: GameState, events: LogEntry[]) {
  s.schedule = buildSchedule(s);
  s.slot = 0;
  events.push({ kind: 'roundStart', round: s.round, schedule: s.schedule.slice() });
  startAction(s);
}

function startAction(s: GameState) {
  s.actionNumber += 1;
  s.phase = 'turnStart';
  s.die = null;
  s.allowance = 0;
  s.selection = { dest: null };
  s.origin = s.pieces[actingPiece(s)].node;
  s.minigameUsed = false;
  s.pick = null;
  s.lastOutcome = null;
}

// ── life ────────────────────────────────────────────────────────────────

/** Move life from one piece to another in one step. The loser's streak resets at once. */
function transferLife(s: GameState, from: number, to: number, events: LogEntry[]) {
  if (from === to) return;
  s.pieces[from].alive = false;
  s.pieces[from].streak = 0;
  s.pieces[to].alive = true;
  events.push({ kind: 'lifeTransfer', from, to });
}

// ── challenges ──────────────────────────────────────────────────────────

function newChallenge(s: GameState, kind: 'duel' | 'seance', participants: number[], host: ChallengeHost, node: number, contact: boolean, events: LogEntry[]) {
  let seedVal: number;
  [seedVal, s.challengeRng] = nextFloat(s.challengeRng);
  s.challengeCount += 1;
  const living = livingPiece(s);
  const sorted = participants.slice().sort((a, b) => a - b);
  const ch: Challenge = {
    id: `c${s.challengeCount}`,
    kind,
    seed: Math.floor(seedVal * 0xffffffff) >>> 0,
    participants: sorted,
    host,
    node,
    multipliers: sorted.map((i) => (i === living ? curseMultiplier(s.pieces[i].streak) : 1)),
    livingAtStart: living,
    instigator: actingPiece(s),
    contact,
    attempt: 0,
  };
  s.challenge = ch;
  s.minigameUsed = true;
  s.phase = 'challenge';
  events.push({ kind: 'challenge', challenge: ch });
}

function startSeance(s: GameState, node: number, host: ChallengeHost, events: LogEntry[]) {
  s.seancesUsed += 1;
  newChallenge(s, 'seance', s.pieces.map((_, i) => i), host, node, false, events);
}

function startRemoteDuel(s: GameState, a: number, b: number, host: ChallengeHost, node: number, events: LogEntry[]) {
  newChallenge(s, 'duel', [a, b], host, node, false, events);
}

/** Judge a challenge from everyone's inputs. Pure; used by the engine and the room. */
export function judgeChallenge(ch: Challenge, inputs: Record<number, ChallengeInput[]>) {
  return judgeRope(
    ch.seed,
    ch.participants,
    ch.participants.map((p) => inputs[p] ?? []),
    ch.multipliers,
  );
}

function occupied(s: GameState, except: number): Set<number> {
  return new Set(s.pieces.filter((_, i) => i !== except).map((p) => p.node));
}

/**
 * Where a duel's loser goes: an unoccupied space exactly two ordinary steps
 * from the encounter, preferring where the loser began its action, then the
 * lowest id; otherwise the nearest unoccupied space at least one step away.
 * Never looks at traps.
 */
export function retreatNode(s: GameState, loser: number, encounter: number, preferred: number | null): number {
  const taken = occupied(s, loser);
  const steps = POLICY.loserRetreatSteps;
  const exact: number[] = [];
  for (let n = 0; n < NODE_COUNT; n++) if (ordinaryDistance(encounter, n) === steps && !taken.has(n)) exact.push(n);
  if (preferred !== null && exact.includes(preferred)) return preferred;
  if (exact.length) return exact[0];
  let best = -1;
  for (let n = 0; n < NODE_COUNT; n++) {
    const d = ordinaryDistance(encounter, n);
    if (d < 1 || taken.has(n)) continue;
    if (best < 0 || d < ordinaryDistance(encounter, best) || (d === ordinaryDistance(encounter, best) && n < best)) best = n;
  }
  return best < 0 ? s.pieces[loser].node : best;
}

/** A Poltergeist's throw: a seeded unoccupied space at least three ordinary steps away, never the entrance. */
function poltergeistNode(s: GameState, piece: number): number {
  const from = s.pieces[piece].node;
  const taken = occupied(s, piece);
  const ok = (n: number) => n !== ENTRANCE && n !== from && !taken.has(n);
  const far: number[] = [];
  for (let n = 0; n < NODE_COUNT; n++) if (ok(n) && ordinaryDistance(from, n) >= POLICY.poltergeistMinSteps) far.push(n);
  if (far.length) return far[Math.floor(draw(s) * far.length)];
  let best = from;
  for (let n = 0; n < NODE_COUNT; n++) {
    if (!ok(n)) continue;
    if (best === from || ordinaryDistance(from, n) > ordinaryDistance(from, best)) best = n;
  }
  return best;
}

function resolveChallenge(s: GameState, ch: Challenge, inputs: Record<number, ChallengeInput[]>, events: LogEntry[]) {
  const v = judgeChallenge(ch, inputs);
  const before = livingPiece(s);
  const moves: ChallengeOutcome['moves'] = [];
  const transferred = v.winner !== before;
  if (transferred) transferLife(s, before, v.winner, events);
  if (ch.contact) {
    // A contact duel: the winner holds the encounter space, the loser retreats.
    const loser = ch.participants.find((p) => p !== v.winner)!;
    const encounter = ch.node;
    const winnerPiece = s.pieces[v.winner];
    if (winnerPiece.node !== encounter) {
      moves.push({ piece: v.winner, from: winnerPiece.node, to: encounter, reason: 'claim' });
      winnerPiece.facingFrom = winnerPiece.node;
      winnerPiece.node = encounter;
    }
    const loserPiece = s.pieces[loser];
    const preferred = loser === ch.instigator ? s.origin : null;
    const to = retreatNode(s, loser, encounter, preferred);
    if (to !== loserPiece.node) {
      moves.push({ piece: loser, from: loserPiece.node, to, reason: 'retreat' });
      loserPiece.facingFrom = loserPiece.node;
      loserPiece.node = to;
    }
  }
  const outcome: ChallengeOutcome = {
    challengeId: ch.id,
    kind: ch.kind,
    host: ch.host,
    participants: ch.participants.slice(),
    winner: v.winner,
    previousLiving: before,
    transferred,
    scores: v.scores,
    multipliers: ch.multipliers.slice(),
    decidedBy: v.decidedBy,
    finalists: v.finalists,
    extraSweepsUsed: v.extraSweepsUsed,
    moves,
  };
  events.push({ kind: 'outcome', outcome });
  s.lastOutcome = outcome;
  s.challenge = null;
  s.phase = 'summary';
}

// ── landing ─────────────────────────────────────────────────────────────

/** What the Super Reaper does right now: a Séance while the allowance lasts, then a Reaper's Challenge. */
export function superReaperEffect(state: GameState): 'seance' | 'reaper' {
  return state.seancesUsed < SEANCE_LIMIT ? 'seance' : 'reaper';
}

/** Ghosts the living piece may pick on a Reaper's Challenge. */
export function reaperOptions(s: GameState, living: number): number[] {
  return s.pieces.map((_, i) => i).filter((i) => i !== living);
}

function reaperChallenge(s: GameState, pi: number, node: number, host: ChallengeHost, events: LogEntry[]) {
  const living = livingPiece(s);
  if (pi === living) {
    const options = reaperOptions(s, living);
    if (options.length === 1) startRemoteDuel(s, living, options[0], host, node, events);
    else {
      s.pick = { options, node };
      s.phase = 'pick';
    }
  } else {
    startRemoteDuel(s, pi, living, host, node, events);
  }
}

/** After a move (or a stay) with no minigame: a ghost in range may choose to challenge. */
function endOfMovement(s: GameState, pi: number) {
  s.phase = !s.minigameUsed && canHunt(s, pi) ? 'hunt' : 'summary';
}

/** A normal movement landing: resolve the Super Reaper or a trap, before any contact. */
function resolveLanding(s: GameState, pi: number, events: LogEntry[]) {
  const node = s.pieces[pi].node;
  if (node === SUPER_REAPER) {
    const effect = superReaperEffect(s);
    events.push({ kind: 'superReaper', piece: pi, effect });
    if (effect === 'seance') return startSeance(s, node, 'superReaper', events);
    return reaperChallenge(s, pi, node, 'superReaper', events);
  }
  const trap = s.traps.find((t) => t.node === node);
  if (!trap || trap.spent) return endOfMovement(s, pi);
  if (!trap.revealed) {
    trap.revealed = true;
    events.push({ kind: 'trapRevealed', node, effect: trap.effect, piece: pi });
  }
  if (trap.effect === 'reaper') return reaperChallenge(s, pi, node, 'reaper', events);
  if (trap.effect === 'seance') {
    trap.spent = true;
    if (s.seancesUsed < SEANCE_LIMIT) return startSeance(s, node, 'seance', events);
    events.push({ kind: 'seanceDormant', node, piece: pi, super: false });
    return endOfMovement(s, pi);
  }
  // Poltergeist: thrown away. Nothing triggers where it lands.
  const from = node;
  const to = poltergeistNode(s, pi);
  s.pieces[pi].facingFrom = from;
  s.pieces[pi].node = to;
  events.push({ kind: 'poltergeist', piece: pi, from, to });
  return endOfMovement(s, pi);
}

// ── public knowledge and previews ───────────────────────────────────────

/** What the table knows about a space: revealed traps and the Super Reaper only. */
export function knownEffectAt(state: GameState, node: number): KnownEffect {
  const t = state.traps.find((x) => x.node === node && x.revealed);
  if (!t) return null;
  if (t.effect === 'seance') return t.spent ? null : 'seance';
  return t.effect;
}

/**
 * Forecast a move from public facts only: the route, a known effect at the
 * destination, and who would be within ordinary range afterwards. Hidden
 * traps are never consulted, so a preview can never promise a safe landing.
 */
export function previewMove(state: GameState, dest: number | 'stay'): MovePreview | null {
  const pi = actingPiece(state);
  if (pi < 0 || state.die === null) return null;
  const me = state.pieces[pi];
  let route: PlayerRoute | null = null;
  if (dest !== 'stay') {
    route = legalRoutes(state).get(dest) ?? null;
    if (!route) return null;
  }
  const end = dest === 'stay' ? me.node : dest;
  const superReaper = dest !== 'stay' && end === SUPER_REAPER ? superReaperEffect(state) : null;
  const known = dest === 'stay' ? null : superReaper ?? knownEffectAt(state, end);
  const living = livingPiece(state);
  const minigame = known === 'reaper' || known === 'seance';
  const canChallenge = !me.alive && !minigame && known !== 'poltergeist' && inAttackRange(end, state.pieces[living].node);
  const threats = me.alive ? state.pieces.map((_, i) => i).filter((i) => i !== pi && inAttackRange(state.pieces[i].node, end)) : [];
  return {
    dest,
    path: route ? route.path : [me.node],
    usesSecret: route?.usesSecret ?? false,
    usesWall: route?.usesWall ?? false,
    known,
    superReaper,
    canChallenge,
    threats,
  };
}

// ── the action reducer ──────────────────────────────────────────────────

export function apply(state: GameState, action: Action): ActionResult {
  const s = clone(state);
  const events: LogEntry[] = [];
  const pi = actingPiece(s);

  switch (action.type) {
    case 'nominate': {
      if (s.phase !== 'placement') return fail(state, 'Traps are placed only before the game starts');
      if (!Number.isInteger(action.piece) || action.piece < 0 || action.piece >= s.pieces.length) return fail(state, 'No such piece');
      if (s.nominations[action.piece] !== null) return fail(state, 'This piece has already chosen');
      if (!trapEligible(action.node)) return fail(state, 'A trap can only go on an eligible corridor space');
      s.nominations[action.piece] = action.node;
      if (s.nominations.every((n) => n !== null)) {
        finalizeTraps(s);
        s.phase = 'lifeRoll';
        events.push({ kind: 'placementDone' });
      }
      return { state: s, events };
    }

    case 'rollForLife': {
      if (s.phase !== 'lifeRoll') return fail(state, 'Not time to roll for life');
      rollForLife(s, events);
      startRound(s, events);
      s.log = events.slice();
      return { state: s, events };
    }

    case 'roll': {
      if (s.phase !== 'turnStart') return fail(state, 'Cannot roll now');
      const me = s.pieces[pi];
      let die: number;
      [die, s.rng] = rollDie(s.rng);
      s.die = die;
      s.allowance = movementAllowance(die, me.alive);
      events.push({ kind: 'roll', piece: pi, die, allowance: s.allowance });
      s.phase = 'choose';
      break;
    }

    case 'select': {
      if (s.phase !== 'choose') return fail(state, 'Nothing to select now');
      if (action.dest !== null && action.dest !== 'stay' && !legalRoutes(s).has(action.dest)) return fail(state, 'That space is out of reach');
      s.selection.dest = action.dest;
      return { state: s, events };
    }

    case 'confirmMove': {
      if (s.phase !== 'choose') return fail(state, 'Nothing to confirm');
      const dest = s.selection.dest;
      if (dest === null) return fail(state, 'Choose a destination or stay');
      const me = s.pieces[pi];
      if (dest === 'stay') {
        events.push({ kind: 'stay', piece: pi, node: me.node });
        endOfMovement(s, pi);
        break;
      }
      const route = legalRoutes(s).get(dest);
      if (!route) return fail(state, 'That space is out of reach');
      me.facingFrom = route.path[route.path.length - 2];
      me.node = dest;
      events.push({ kind: 'move', piece: pi, path: route.path, usesSecret: route.usesSecret, usesWall: route.usesWall });
      resolveLanding(s, pi, events);
      break;
    }

    case 'pickOpponent': {
      if (s.phase !== 'pick' || !s.pick) return fail(state, 'Nothing to pick');
      if (!s.pick.options.includes(action.option)) return fail(state, 'Not a valid opponent');
      const node = s.pick.node;
      s.pick = null;
      startRemoteDuel(s, pi, action.option, node === SUPER_REAPER ? 'superReaper' : 'reaper', node, events);
      break;
    }

    case 'hunt': {
      if (s.phase !== 'hunt' || !canHunt(s, pi) || s.minigameUsed) return fail(state, 'No one in range to challenge');
      const living = livingPiece(s);
      newChallenge(s, 'duel', [pi, living], 'contact', s.pieces[living].node, true, events);
      break;
    }

    case 'declineHunt': {
      if (s.phase !== 'hunt') return fail(state, 'Nothing to decline');
      events.push({ kind: 'huntDeclined', piece: pi });
      s.phase = 'summary';
      break;
    }

    case 'challengeResult': {
      if (s.phase !== 'challenge' || !s.challenge) return fail(state, 'No challenge in progress');
      if (action.id !== s.challenge.id) return fail(state, 'That challenge is already over');
      resolveChallenge(s, s.challenge, action.inputs ?? {}, events);
      break;
    }

    case 'nextTurn': {
      if (s.phase !== 'summary') return fail(state, 'Finish this action first');
      if (s.slot + 1 < s.schedule.length) {
        s.slot += 1;
        startAction(s);
        s.log = [];
        s.turnDirty = false;
        return { state: s, events };
      }
      // The bell: whoever holds life now scores the round.
      const living = livingPiece(s);
      const holder = s.pieces[living];
      holder.score += 1;
      holder.streak += 1;
      events.push({ kind: 'roundEnd', round: s.round, piece: living, score: holder.score, streak: holder.streak });
      if (s.round >= ROUNDS) {
        s.phase = 'gameOver';
        s.pick = null;
        events.push({ kind: 'gameOver' });
        s.log = [...s.log, ...events];
        s.turnDirty = true;
        return { state: s, events };
      }
      s.round += 1;
      startRound(s, events);
      s.log = events.slice();
      s.turnDirty = false;
      return { state: s, events };
    }

    default:
      return fail(state, 'Unknown action');
  }
  s.log = [...s.log, ...events];
  s.turnDirty = true;
  return { state: s, events };
}

// ── scoring ─────────────────────────────────────────────────────────────

export interface ScoreLine {
  piece: number;
  score: number;
  alive: boolean;
  rank: number;
  winner: boolean;
}

export function finalScores(state: GameState): ScoreLine[] {
  const lines: ScoreLine[] = state.pieces.map((p, i) => ({ piece: i, score: p.score, alive: p.alive, rank: 0, winner: false }));
  const sorted = lines.slice().sort((a, b) => b.score - a.score || a.piece - b.piece);
  const top = sorted[0]?.score ?? 0;
  for (const line of sorted) {
    line.rank = 1 + lines.filter((l) => l.score > line.score).length;
    line.winner = line.score === top;
  }
  return sorted;
}

/** Rounds whose bell has rung: always equal to the sum of all scores. */
export function completedRounds(state: GameState): number {
  if (state.phase === 'placement' || state.phase === 'lifeRoll') return 0;
  return state.phase === 'gameOver' ? state.round : state.round - 1;
}

// ── undo-aware session ──────────────────────────────────────────────────

/**
 * A session wraps the live snapshot with the snapshot taken when this action
 * began and the one from the action before. Undo restores one of those whole
 * — RNG and traps included — so a replayed action rolls the same die.
 * `known` is the table's memory of revealed traps: undo never erases it.
 */
export interface Session {
  game: GameState;
  turnStart: GameState;
  previousTurnStart: GameState | null;
  known: Array<Pick<Trap, 'node' | 'effect'>>;
}

export function newSession(game: GameState): Session {
  return { game, turnStart: game, previousTurnStart: null, known: [] };
}

function remember(known: Session['known'], game: GameState): Session['known'] {
  const add = game.traps.filter((t) => t.revealed && !known.some((k) => k.node === t.node)).map((t) => ({ node: t.node, effect: t.effect }));
  return add.length ? [...known, ...add] : known;
}

export function dispatch(session: Session, action: Action): { session: Session; events: LogEntry[]; error?: string } {
  const result = apply(session.game, action);
  if (result.error) return { session, events: [], error: result.error };
  const known = remember(session.known ?? [], result.state);
  const g = result.state;
  if (action.type === 'nominate' || action.type === 'rollForLife') {
    // Placement and the life roll cannot be undone: the first real snapshot starts here.
    return { session: { game: g, turnStart: g, previousTurnStart: null, known }, events: result.events };
  }
  if (action.type === 'nextTurn' && g.phase === 'turnStart') {
    return { session: { game: g, turnStart: g, previousTurnStart: session.turnStart, known }, events: result.events };
  }
  return { session: { ...session, game: g, known }, events: result.events };
}

export interface UndoInfo {
  available: boolean;
  which: 'current' | 'previous' | null;
  pieceName: string;
  round: number;
}

export function undoInfo(session: Session): UndoInfo {
  const g = session.game;
  const none: UndoInfo = { available: false, which: null, pieceName: '', round: g.round };
  if (g.phase === 'placement' || g.phase === 'lifeRoll') return none;
  const nameAt = (t: GameState) => t.pieces[actingPiece(t)]?.name ?? '';
  if (g.turnDirty || g.phase === 'gameOver') {
    const t = session.turnStart;
    if (t.phase !== 'turnStart') return none;
    return { available: true, which: 'current', pieceName: nameAt(t), round: t.round };
  }
  if (session.previousTurnStart) {
    const t = session.previousTurnStart;
    return { available: true, which: 'previous', pieceName: nameAt(t), round: t.round };
  }
  return none;
}

export function undo(session: Session): Session {
  const info = undoInfo(session);
  if (info.which === 'current') return { ...session, game: session.turnStart };
  if (info.which === 'previous' && session.previousTurnStart) {
    return { game: session.previousTurnStart, turnStart: session.previousTurnStart, previousTurnStart: null, known: session.known };
  }
  return session;
}
