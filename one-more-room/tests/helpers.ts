// Shared test helpers: build states directly and produce rope inputs with an
// exact number of clean jumps from a challenge's own schedule.

import { CHARACTERS, CHALLENGE, type TrapEffect } from '../src/engine/config';
import { apply, buildSchedule, createGame, encounterOptions, moveExits, moveLandings, movementAllowance } from '../src/engine/engine';
import { exactReach } from '../src/engine/graph';
import { ropeSchedule, type ChallengeInput } from '../src/engine/challenges';
import type { Action, Challenge, GameState } from '../src/engine/types';

export const DEFAULT_TRAPS: Array<{ node: number; effect: TrapEffect }> = [
  { node: 9, effect: 'reaper' },
  { node: 14, effect: 'seance' },
  { node: 19, effect: 'poltergeist' },
  { node: 21, effect: 'reaper' },
  { node: 26, effect: 'seance' },
  { node: 30, effect: 'poltergeist' },
];

/** A game at the life roll, with known preset traps. */
export function game(n = 2, seed = 1234, traps = DEFAULT_TRAPS): GameState {
  return createGame({
    pieces: Array.from({ length: n }, (_, i) => ({ character: CHARACTERS[i].id, controllers: [`P${i + 1}`] })),
    seed,
    presetTraps: traps,
  });
}

export function act(s: GameState, a: Action): GameState {
  const r = apply(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/**
 * A started game with chosen positions: `living` holds life, `nodes` are the
 * pieces' spaces, and the round's schedule is rebuilt. `acting` (default the
 * living piece) is the piece whose action is about to begin.
 */
export function setup(n: number, opts: { living: number; nodes: number[]; acting?: number; round?: number; streaks?: number[]; seed?: number; traps?: typeof DEFAULT_TRAPS }): GameState {
  let s = act(game(n, opts.seed ?? 1234, opts.traps ?? DEFAULT_TRAPS), { type: 'rollForLife' });
  s = {
    ...s,
    round: opts.round ?? 1,
    pieces: s.pieces.map((p, i) => ({ ...p, alive: i === opts.living, node: opts.nodes[i], streak: opts.streaks?.[i] ?? 0 })),
  };
  const schedule = buildSchedule(s);
  const acting = opts.acting ?? opts.living;
  const slot = schedule.indexOf(acting);
  return {
    ...s,
    schedule,
    slot,
    phase: 'turnStart',
    origin: opts.nodes[acting],
    die: null,
    allowance: 0,
    rollInfo: null,
    itemUsed: null,
    options: null,
    minigameUsed: false,
    log: [],
  };
}

/** Put the acting piece at the start of an exact move of `die` spaces (no randomness drawn). */
export function rolled(s: GameState, die: number): GameState {
  const node = s.pieces[s.schedule[s.slot]].node;
  return { ...s, phase: 'choose', die, allowance: movementAllowance(die), rollInfo: { kind: 'die' }, move: { remaining: die, prev: null, path: [node], usedSecret: false, usedWall: false } };
}

/** Walk the move in progress to `dest`, taking at each fork a way from which `dest` can still be the landing. */
export function walk(s: GameState, dest: number): GameState {
  for (let guard = 0; s.phase === 'choose' && guard < 12; guard++) {
    const exits = moveExits(s);
    const way = exits.find((e) => moveLandings(s, e.to).includes(dest));
    if (!way) throw new Error(`Can't land on ${dest} from ${s.pieces[s.schedule[s.slot]].node} with ${s.move?.remaining} left`);
    s = act(s, { type: 'step', at: s.pieces[s.schedule[s.slot]].node, left: s.move!.remaining, to: way.to });
  }
  return s;
}

/**
 * Roll (without randomness) and move exactly onto `dest`. Uses `die` when the
 * landing is exactly that far, otherwise the smallest roll that lands there.
 */
export function move(s: GameState, dest: number, die?: number): GameState {
  const node = s.pieces[s.schedule[s.slot]].node;
  const ghost = !s.pieces[s.schedule[s.slot]].alive;
  const fits = (d: number) => exactReach(node, d, ghost).includes(dest);
  const d = die !== undefined && fits(die) ? die : [1, 2, 3, 4, 5, 6].find(fits);
  if (d === undefined) throw new Error(`No roll lands ${node} → ${dest}`);
  return walk(rolled(s, d), dest);
}

/** Test shortcut: end the acting piece's movement where it stands (as if it had just landed there, no trap). */
export function skipMove(s: GameState): GameState {
  const pi = s.schedule[s.slot];
  const o = encounterOptions(s, pi, false);
  const any = o.living || o.sameSpace.length > 0 || o.versus.length > 0;
  return { ...s, die: 1, rollInfo: { kind: 'die' }, move: null, phase: any ? 'hunt' : 'summary', options: any ? o : null, turnDirty: true };
}

/** Inputs with exactly `clean` perfect jumps (from the first sweep), optionally including sudden death. */
export function jumps(ch: Challenge, clean: number, suddenDeath = 0): ChallengeInput[] {
  const sch = ropeSchedule(ch.seed);
  const main = sch.bottoms.slice(0, Math.min(clean, CHALLENGE.rope.sweeps));
  const extra = sch.bottoms.slice(CHALLENGE.rope.sweeps, CHALLENGE.rope.sweeps + suddenDeath);
  return [...main, ...extra].map((b) => ({ t: b - CHALLENGE.rope.idealMs }));
}

/** Resolve the current challenge with a number of clean jumps per piece (default 0). */
export function resolve(s: GameState, clean: Record<number, number>): GameState {
  const ch = s.challenge!;
  const inputs: Record<number, ChallengeInput[]> = {};
  for (const p of ch.participants) inputs[p] = jumps(ch, clean[p] ?? 0);
  return act(s, { type: 'challengeResult', id: ch.id, inputs });
}

export function living(s: GameState): number {
  return s.pieces.findIndex((p) => p.alive);
}

export function aliveCount(s: GameState): number {
  return s.pieces.filter((p) => p.alive).length;
}
