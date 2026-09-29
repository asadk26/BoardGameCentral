// Shared test helpers: build states directly and produce perfect / failing
// survival-game inputs from a challenge's own schedule.

import { CHARACTERS, CHALLENGE } from '../src/engine/config';
import { apply, createGame } from '../src/engine/engine';
import { danceSchedule, escapeSchedule, ropeSchedule, type ChallengeInput } from '../src/engine/challenges';
import type { Action, Challenge, GameState, PlayerState } from '../src/engine/types';

export const DEFAULT_TRAPS = [9, 14, 19, 21, 26, 30];

export function game(n = 2, seed = 1234, traps: number[] = DEFAULT_TRAPS): GameState {
  return createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, character: CHARACTERS[i].id })), seed, presetTraps: traps });
}

export function act(s: GameState, a: Action): GameState {
  const r = apply(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

export function choosing(s: GameState, dice: number[]): GameState {
  return { ...s, phase: 'choose', dice, selection: { moveDie: 0, dest: null } };
}

export function withPlayers(s: GameState, patch: Array<Partial<PlayerState>>): GameState {
  return { ...s, players: s.players.map((p, i) => ({ ...p, ...(patch[i] ?? {}) })) };
}

export function move(s: GameState, dest: number | 'stay', dice: number[] = [6, 1], moveDie: 0 | 1 = 0): GameState {
  let t = choosing(s, dice);
  t = act(t, { type: 'select', moveDie, dest });
  return act(t, { type: 'confirmMove' });
}

/** Inputs that pass (quality 'win') or fail ('lose') a challenge for one participant. */
export function inputsFor(ch: Challenge, quality: 'win' | 'lose' | number): ChallengeInput[] {
  if (quality === 'lose') return [];
  if (ch.kind === 'escape') {
    const sch = escapeSchedule(ch.seed);
    return [{ a: 0, t: Math.round((sch.zones[0] / 360) * sch.periodMs) }];
  }
  if (ch.kind === 'dance') {
    const d = danceSchedule(ch.seed);
    return d.sequences[0].map((dir, k) => ({ a: 0, t: 500 + k * 400, d: dir }));
  }
  const sch = ropeSchedule(ch.seed, ch.kind === 'duel' && ch.oneSurvivor);
  const n = quality === 'win' ? sch.bottoms.length : quality;
  return sch.bottoms.slice(0, n).map((b) => ({ t: b - CHALLENGE.rope.idealMs }));
}

export function resolve(s: GameState, quality: Record<number, 'win' | 'lose' | number>): GameState {
  const ch = s.challenge!;
  const inputs: Record<number, ChallengeInput[]> = {};
  for (const p of ch.participants) inputs[p] = inputsFor(ch, quality[p] ?? 'win');
  return act(s, { type: 'challengeResult', id: ch.id, inputs });
}
