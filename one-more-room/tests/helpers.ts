// Shared test helpers: build states directly and produce rope inputs with an
// exact number of clean jumps from a challenge's own schedule.

import { CHARACTERS, CHALLENGE, type TrapEffect } from '../src/engine/config';
import { apply, buildSchedule, createGame, movementAllowance } from '../src/engine/engine';
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
  return { ...s, schedule, slot, phase: 'turnStart', origin: opts.nodes[acting], die: null, allowance: 0, minigameUsed: false, log: [] };
}

/** Put the acting piece straight into choosing with a given die. */
export function rolled(s: GameState, die: number): GameState {
  const me = s.pieces[s.schedule[s.slot]];
  return { ...s, phase: 'choose', die, allowance: movementAllowance(die, me.alive), selection: { dest: null } };
}

export function move(s: GameState, dest: number | 'stay', die = 6): GameState {
  let t = rolled(s, die);
  t = act(t, { type: 'select', dest });
  return act(t, { type: 'confirmMove' });
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
