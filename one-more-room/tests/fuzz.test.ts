// Plays hundreds of complete random games through the engine and checks the
// invariants the rules rely on after every single action.

import { expect, it } from 'vitest';
import { CHARACTERS, ENTRANCE } from '../src/engine/config';
import { createGame, dispatch, finalScores, legalRoutes, newSession } from '../src/engine/engine';
import type { Action } from '../src/engine/types';

it('random full games keep every invariant', () => {
  for (let seed = 1; seed < 400; seed++) {
    const n = 2 + (seed % 5);
    let s = newSession(createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, character: CHARACTERS[i].id })), seed }));
    let k = seed;
    const rnd = () => (k = (Math.imul(k, 1103515245) + 12345) >>> 0) / 2 ** 32;
    let turns = 0;
    for (let guard = 0; s.game.phase !== 'gameOver' && guard < 3000; guard++) {
      const g = s.game;
      let a: Action;
      if (g.phase === 'turnStart') {
        turns++;
        const r = rnd() < 0.1 ? dispatch(s, { type: 'placeDecoy' }) : null;
        if (r && !r.error) s = r.session;
        a = { type: 'roll' };
      } else if (g.phase === 'choose') {
        const moveDie = rnd() < 0.5 ? 0 : 1;
        const dests = [...legalRoutes(g, moveDie).keys()];
        const dest = dests.length && rnd() < 0.9 ? dests[Math.floor(rnd() * dests.length)] : 'stay';
        s = dispatch(s, { type: 'select', moveDie, dest }).session;
        a = { type: 'confirmMove' };
      } else if (g.phase === 'event') {
        const ev = g.event!;
        a = ev.canDecline && rnd() < 0.3 ? { type: 'eventDecline' } : { type: 'eventChoose', option: ev.options[Math.floor(rnd() * ev.options.length)] };
      } else if (g.phase === 'ghost') {
        expect(g.players.some((p) => p.node === g.ghost)).toBe(false);
        a = { type: 'moveGhost' };
      } else a = { type: 'nextTurn' };
      const r = dispatch(s, a);
      expect(r.error).toBeUndefined();
      s = r.session;
      expect(s.game.ghost).not.toBe(ENTRANCE);
      expect(s.game.stocks.every((v) => v >= 0)).toBe(true);
      for (const p of s.game.players) {
        expect(p.carried).toBeGreaterThanOrEqual(0);
        if (p.node === ENTRANCE) expect(p.carried).toBe(0);
      }
    }
    expect(s.game.phase).toBe('gameOver');
    expect(turns).toBe(n * 10);
    expect(finalScores(s.game).length).toBe(n);
  }
});
