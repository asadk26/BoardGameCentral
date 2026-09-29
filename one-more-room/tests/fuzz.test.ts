// Plays hundreds of complete random games through the engine — random but
// always-legal actions, random survival-game inputs — and checks the
// invariants the rules rely on after every single action.

import { expect, it } from 'vitest';
import { CHARACTERS, ENTRANCE, SCORING, TRAP_ELIGIBLE } from '../src/engine/config';
import { createGame, dispatch, finalScores, legalRoutes, newSession } from '../src/engine/engine';
import { botChallengeInputs, SKILLS } from '../src/engine/challenges';
import type { Action } from '../src/engine/types';

it('random full games keep every invariant', () => {
  for (let seed = 1; seed < 300; seed++) {
    const n = 2 + (seed % 5);
    let s = newSession(createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, character: CHARACTERS[i].id })), seed }));
    let k = seed;
    const rnd = () => (k = (Math.imul(k, 1103515245) + 12345) >>> 0) / 2 ** 32;
    let deadBefore = new Set<number>();
    for (let guard = 0; s.game.phase !== 'gameOver' && guard < 4000; guard++) {
      const g = s.game;
      let a: Action;
      if (g.phase === 'placement') {
        const seat = g.nominations.findIndex((x) => x === null);
        a = { type: 'nominate', seat, node: TRAP_ELIGIBLE[Math.floor(rnd() * TRAP_ELIGIBLE.length)] };
      } else if (g.phase === 'turnStart') {
        const r = rnd() < 0.1 ? dispatch(s, { type: 'placeDecoy' }) : null;
        if (r && !r.error) s = r.session;
        a = { type: 'roll' };
      } else if (g.phase === 'choose') {
        const moveDie = rnd() < 0.5 ? 0 : 1;
        const dests = [...legalRoutes(g, moveDie).keys()];
        const dest = dests.length && rnd() < 0.9 ? dests[Math.floor(rnd() * dests.length)] : 'stay';
        s = dispatch(s, { type: 'select', moveDie, dest }).session;
        a = { type: 'confirmMove' };
      } else if (g.phase === 'pick') {
        a = { type: 'pickOpponent', option: g.pick!.options[Math.floor(rnd() * g.pick!.options.length)] };
      } else if (g.phase === 'event') {
        const ev = g.event!;
        a = ev.canDecline && rnd() < 0.3 ? { type: 'eventDecline' } : { type: 'eventChoose', option: ev.options[Math.floor(rnd() * ev.options.length)] };
      } else if (g.phase === 'challenge') {
        const ch = g.challenge!;
        const inputs: Record<number, ReturnType<typeof botChallengeInputs>> = {};
        for (const p of ch.participants) inputs[p] = botChallengeInputs(ch.kind, ch.seed, p, rnd() < 0.5 ? SKILLS.shaky : SKILLS.sharp, ch.oneSurvivor);
        a = { type: 'challengeResult', id: ch.id, inputs };
      } else if (g.phase === 'ghost') {
        a = { type: 'moveGhost' };
      } else a = { type: 'nextTurn' };
      const r = dispatch(s, a);
      expect(r.error).toBeUndefined();
      s = r.session;
      const st = s.game;
      expect(st.ghost).not.toBe(ENTRANCE);
      expect(st.stocks.every((v) => v >= 0)).toBe(true);
      if (st.phase !== 'placement') expect(new Set(st.traps.map((t) => t.node)).size).toBe(6);
      st.players.forEach((p, i) => {
        expect(p.carried).toBeGreaterThanOrEqual(0);
        if (p.node === ENTRANCE) expect(p.carried).toBe(0);
        if (!p.alive) {
          expect(p.carried).toBe(0);
          expect(p.node).not.toBe(ENTRANCE);
        }
        if (deadBefore.has(i)) expect(p.alive).toBe(false); // irreversible
        expect(p.bounty).toBeLessThanOrEqual(SCORING.bountyCap);
      });
      deadBefore = new Set(st.players.map((p, i) => (p.alive ? -1 : i)).filter((i) => i >= 0));
    }
    expect(s.game.phase).toBe('gameOver');
    expect(finalScores(s.game).length).toBe(n);
  }
});
