// Plays hundreds of complete random games through the engine — random but
// always-legal actions, random jump-rope inputs, random undos — and checks
// the invariants the rules rely on after every single action.

import { expect, it } from 'vitest';
import { CHARACTERS, NODE_COUNT, ROUNDS, TRAP_ELIGIBLE } from '../src/engine/config';
import { actingPiece, completedRounds, createGame, dispatch, legalRoutes, newSession, undo, undoInfo } from '../src/engine/engine';
import { botRopeInputs, SKILLS } from '../src/engine/challenges';
import type { Action, GameState } from '../src/engine/types';

function check(g: GameState, prev: GameState | null) {
  const started = g.phase !== 'placement' && g.phase !== 'lifeRoll';
  expect(g.pieces.filter((p) => p.alive).length).toBe(started ? 1 : 0);
  expect(g.pieces.reduce((a, p) => a + p.score, 0)).toBe(completedRounds(g));
  g.pieces.forEach((p, i) => {
    expect(p.node).toBeGreaterThanOrEqual(0);
    expect(p.node).toBeLessThan(NODE_COUNT);
    expect(p.streak).toBeLessThanOrEqual(p.score);
    if (prev && prev.round <= g.round) expect(p.score).toBeGreaterThanOrEqual(prev.pieces[i].score);
  });
  if (started) {
    expect(new Set(g.schedule).size).toBe(g.pieces.length);
    expect(g.schedule.length).toBe(g.pieces.length);
    expect(new Set(g.traps.map((t) => t.node)).size).toBe(6);
  }
  expect(g.seancesUsed).toBeLessThanOrEqual(2);
  if (g.phase === 'challenge') expect(g.challenge).not.toBeNull();
}

it('random full games keep every invariant', () => {
  for (let seed = 1; seed < 300; seed++) {
    const n = 2 + (seed % 3);
    let s = newSession(createGame({ pieces: Array.from({ length: n }, (_, i) => ({ character: CHARACTERS[i].id, controllers: [`p${i}`] })), seed }));
    let k = seed;
    const rnd = () => (k = (Math.imul(k, 1103515245) + 12345) >>> 0) / 2 ** 32;
    let prev: GameState | null = null;
    // Actions taken per piece per round, and minigames per action.
    let actedThisRound = new Map<number, number>();
    let round = 0;
    let minigames = 0;
    for (let guard = 0; s.game.phase !== 'gameOver' && guard < 6000; guard++) {
      const g = s.game;
      let a: Action;
      if (g.phase === 'placement') {
        const piece = g.nominations.findIndex((x) => x === null);
        a = { type: 'nominate', piece, node: TRAP_ELIGIBLE[Math.floor(rnd() * TRAP_ELIGIBLE.length)] };
      } else if (g.phase === 'lifeRoll') a = { type: 'rollForLife' };
      else if (g.phase === 'turnStart') {
        if (rnd() < 0.03 && undoInfo(s).available) {
          s = undo(s);
          actedThisRound = new Map();
          round = s.game.round;
          continue;
        }
        a = { type: 'roll' };
      } else if (g.phase === 'choose') {
        const dests = [...legalRoutes(g).keys()];
        const dest = dests.length && rnd() < 0.85 ? dests[Math.floor(rnd() * dests.length)] : 'stay';
        s = dispatch(s, { type: 'select', dest }).session;
        a = { type: 'confirmMove' };
      } else if (g.phase === 'pick') a = { type: 'pickOpponent', option: g.pick!.options[Math.floor(rnd() * g.pick!.options.length)] };
      else if (g.phase === 'hunt') a = rnd() < 0.85 ? { type: 'hunt' } : { type: 'declineHunt' };
      else if (g.phase === 'challenge') {
        const ch = g.challenge!;
        const inputs: Record<number, ReturnType<typeof botRopeInputs>> = {};
        for (const p of ch.participants) inputs[p] = botRopeInputs(ch.seed, p, rnd() < 0.5 ? SKILLS.shaky : SKILLS.sharp);
        a = { type: 'challengeResult', id: ch.id, inputs };
        minigames++;
      } else a = { type: 'nextTurn' };
      if (a.type === 'roll') {
        if (g.round !== round) {
          actedThisRound = new Map();
          round = g.round;
        }
        const me = actingPiece(g);
        actedThisRound.set(me, (actedThisRound.get(me) ?? 0) + 1);
        expect(actedThisRound.get(me)).toBe(1);
        minigames = 0;
      }
      const r = dispatch(s, a);
      expect(r.error).toBeUndefined();
      s = r.session;
      expect(minigames).toBeLessThanOrEqual(1);
      check(s.game, prev);
      prev = s.game;
    }
    expect(s.game.phase).toBe('gameOver');
    expect(s.game.pieces.reduce((a, p) => a + p.score, 0)).toBe(ROUNDS);
  }
}, 120000);
