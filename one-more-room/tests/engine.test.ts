import { describe, expect, it } from 'vitest';
import {
  CHARACTERS,
  EVENT_NODES,
  GHOST_WALL_LINKS,
  NODE_COUNT,
  NODE_POSITIONS,
  ORDINARY_EDGES,
  ROOMS,
  SECRET_ENDPOINTS,
  SUPER_REAPER,
  TRAP_ELIGIBLE,
  TRAP_WINGS,
  cardType,
  nodeKind,
  type EventType,
} from '../src/engine/config';
import { bfs, ghostBfs, ORDINARY_ADJ, playerRoutes } from '../src/engine/graph';
import {
  apply,
  createGame,
  currentGhostPlan,
  dispatch,
  finalScores,
  isProtected,
  legalRoutes,
  newSession,
  planGhost,
  previewMove,
  undo,
  undoInfo,
} from '../src/engine/engine';
import { publicView, seatView } from '../src/engine/view';
import { deserialize, serialize, defaultPersonalization } from '../src/engine/save';
import { botChallengeInputs, judgeDuel, ropeSchedule, SKILLS } from '../src/engine/challenges';
import { simulateGame } from '../src/engine/sim';
import { botAction, defaultBotProfile, newBotMemory } from '../src/engine/bots';
import type { GameState } from '../src/engine/types';
import { act, choosing, game, move, resolve, withPlayers } from './helpers';

function stackDeck(s: GameState, type: EventType): GameState {
  const id = s.deck.find((c) => cardType(c) === type)!;
  return { ...s, deck: [id, ...s.deck.filter((c) => c !== id)] };
}

describe('board', () => {
  it('keeps exactly 32 spaces, 34 reciprocal edges and three loops', () => {
    expect(NODE_POSITIONS.length).toBe(32);
    expect(ORDINARY_EDGES.length).toBe(34);
    for (let a = 0; a < NODE_COUNT; a++) for (const b of ORDINARY_ADJ[a]) expect(ORDINARY_ADJ[b]).toContain(a);
    expect(ORDINARY_EDGES.length - NODE_COUNT + 1).toBe(3);
    expect(Math.max(...bfs(0).dist)).toBe(9);
    const g = ghostBfs(16).dist;
    for (let i = 1; i < NODE_COUNT; i++) expect(g[i]).toBeLessThan(Infinity);
  });

  it('has valid ghost-only wall links that are not ordinary edges', () => {
    expect(GHOST_WALL_LINKS.map((l) => [...l])).toEqual([[7, 10], [22, 25]]);
    for (const [a, b] of GHOST_WALL_LINKS) {
      expect(ORDINARY_ADJ[a]).not.toContain(b);
      expect(bfs(a).dist[b]).toBe(3);
    }
    expect(playerRoutes(7, 1, { ghost: true }).has(10)).toBe(true);
    expect(playerRoutes(7, 1, {}).has(10)).toBe(false);
    expect(playerRoutes(25, 1, { ghost: true }).has(22)).toBe(true);
  });

  it('has twelve trap-eligible corridor spaces, excluding every protected kind of space', () => {
    expect([...TRAP_ELIGIBLE]).toEqual([2, 4, 6, 9, 14, 18, 19, 20, 21, 26, 28, 30]);
    for (const n of [0, 1, 31, 16, SUPER_REAPER, ...EVENT_NODES, ...SECRET_ENDPOINTS, ...Object.keys(ROOMS).map(Number)]) expect(TRAP_ELIGIBLE).not.toContain(n);
    expect(nodeKind(SUPER_REAPER)).toBe('corridor');
    expect(Object.values(TRAP_WINGS).flat().sort((a, b) => a - b)).toEqual([...TRAP_ELIGIBLE]);
  });
});

describe('secret placement', () => {
  const place = (n: number, noms: number[], seed = 7) => {
    let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, character: CHARACTERS[i].id })), seed });
    expect(s.phase).toBe('placement');
    noms.forEach((node, seat) => (s = act(s, { type: 'nominate', seat, node })));
    return s;
  };

  it('always ends with exactly six distinct eligible traps, including every nomination', () => {
    for (let n = 2; n <= 6; n++) {
      for (let seed = 1; seed < 40; seed++) {
        const noms = Array.from({ length: n }, (_, i) => TRAP_ELIGIBLE[(seed * 3 + i * 5) % TRAP_ELIGIBLE.length]);
        const s = place(n, noms, seed);
        expect(s.phase).toBe('turnStart');
        const nodes = s.traps.map((t) => t.node);
        expect(new Set(nodes).size).toBe(6);
        expect(nodes.every((x) => TRAP_ELIGIBLE.includes(x))).toBe(true);
        for (const x of noms) expect(nodes).toContain(x);
        expect(s.traps.every((t) => !t.revealed)).toBe(true);
      }
    }
  });

  it('merges duplicate and unanimous picks silently and fills the rest', () => {
    const s = place(6, [2, 2, 2, 2, 2, 2]);
    expect(s.traps.length).toBe(6);
    expect(s.traps.map((t) => t.node)).toContain(2);
    const t = place(4, [2, 2, 18, 18]);
    expect(t.traps.length).toBe(6);
  });

  it('spreads computer picks toward under-represented wings', () => {
    const s = place(2, [2, 4]); // both west
    const nodes = s.traps.map((t) => t.node);
    expect(nodes.some((x) => TRAP_WINGS.north.includes(x))).toBe(true);
    expect(nodes.some((x) => TRAP_WINGS.east.includes(x))).toBe(true);
  });

  it('is seeded: same seed and picks give the same map; the seed matters', () => {
    expect(place(3, [2, 18, 26], 11).traps).toEqual(place(3, [2, 18, 26], 11).traps);
    const maps = new Set(Array.from({ length: 12 }, (_, k) => JSON.stringify(place(2, [2, 18], 100 + k).traps)));
    expect(maps.size).toBeGreaterThan(1);
  });

  it('rejects ineligible or repeated nominations', () => {
    const s = createGame({ players: [{ name: 'a', character: 'witch' }, { name: 'b', character: 'knight' }], seed: 1 });
    for (const bad of [0, 1, 3, 5, 8, 12, 16, 31]) expect(apply(s, { type: 'nominate', seat: 0, node: bad }).error).toBeTruthy();
    const once = act(s, { type: 'nominate', seat: 0, node: 2 });
    expect(apply(once, { type: 'nominate', seat: 0, node: 4 }).error).toBeTruthy();
    expect(apply(once, { type: 'roll' }).error).toBeTruthy();
  });

  it('never shows picks, overlaps, the map or the seed in public views', () => {
    let s = createGame({ players: [{ name: 'a', character: 'witch' }, { name: 'b', character: 'knight' }, { name: 'c', character: 'goblin' }], seed: 9 });
    s = act(s, { type: 'nominate', seat: 1, node: 26 });
    const pub = publicView(s);
    expect(pub.nominations).toEqual([null, -1, null]);
    expect(JSON.stringify(pub)).not.toMatch(/"node":26/);
    expect(seatView(s, 1).ownNomination).toBe(26);
    expect(seatView(s, 0).ownNomination).toBe(null);
    s = act(act(s, { type: 'nominate', seat: 0, node: 26 }), { type: 'nominate', seat: 2, node: 2 });
    const after = publicView(s);
    expect(after.traps).toEqual([]);
    expect(after.seed).toBe(0);
    expect(after.rng).toBe(0);
    expect(after.challengeRng).toBe(0);
    expect(after.deck.every((c) => c === -1)).toBe(true);
    expect(after.nominations).toEqual([-1, -1, -1]);
  });
});

describe('movement', () => {
  it('blocks the living from crossing or ending on any ghost; living pass each other', () => {
    let s = withPlayers(game(3), [{}, { alive: false, node: 2 }, { node: 1 }]);
    s = choosing(s, [3, 1]);
    const r = legalRoutes(s);
    expect(r.has(2)).toBe(false);
    expect(r.has(3)).toBe(false);
    expect(r.has(1)).toBe(true);
    expect(r.get(30)!.path).toEqual([0, 31, 30]);
  });

  it('lets player ghosts pass anything, use wall links, and never enter the entrance', () => {
    let s = withPlayers(game(2), [{ node: 1 }, { alive: false, node: 7 }]);
    s = { ...choosing({ ...s, turn: 1 }, [2]) };
    const r = legalRoutes(s);
    expect(r.has(10)).toBe(true);
    const t = choosing({ ...withPlayers(game(2), [{}, { alive: false, node: 2 }]), turn: 1 }, [3]);
    expect(legalRoutes(t).has(0)).toBe(false);
    expect(legalRoutes(t).has(31)).toBe(false);
  });

  it('gives identical route output whatever the hidden trap map', () => {
    for (let seed = 1; seed < 30; seed++) {
      const a = choosing(withPlayers(game(2, seed, [2, 4, 6, 9, 14, 18]), [{ node: 20 }]), [5, 3]);
      const b = choosing(withPlayers(game(2, seed, [19, 20, 21, 26, 28, 30]), [{ node: 20 }]), [5, 3]);
      expect([...legalRoutes(a).entries()]).toEqual([...legalRoutes(b).entries()]);
      for (const d of legalRoutes(a).keys()) {
        const pa = previewMove(a, 0, d)!;
        const pb = previewMove(b, 0, d)!;
        expect(pa).toEqual(pb);
      }
    }
  });
});

describe('Reaper traps', () => {
  it('passing is safe; landing reveals and starts a Reaper performance', () => {
    const pass = move(withPlayers(game(), [{ node: 10 }]), 8, [2, 1]);
    expect(pass.traps.find((t) => t.node === 9)!.revealed).toBe(false);
    expect(pass.phase).toBe('ghost');
    const land = move(withPlayers(game(), [{ node: 10 }]), 9, [1, 1]);
    expect(land.traps.find((t) => t.node === 9)!.revealed).toBe(true);
    expect(land.phase).toBe('challenge');
    expect(['dance', 'rope']).toContain(land.challenge!.kind);
    expect(land.challenge!.host).toBe('reaper');
    expect(land.log.some((e) => e.kind === 'trapRevealed')).toBe(true);
  });

  it('stay never triggers; a revealed trap stays active for later landings', () => {
    let s = move(withPlayers(game(), [{ node: 10, carried: 2 }]), 9, [1, 1]);
    s = resolve(s, { 0: 'win' });
    expect(s.players[0].alive).toBe(true);
    const stay = move({ ...s, phase: 'turnStart' }, 'stay', [1, 1]);
    expect(stay.phase).toBe('ghost');
    const again = move(withPlayers({ ...s, phase: 'turnStart', turnNumber: 99 }, [{ node: 10, protectedUntil: null }]), 9, [1, 1]);
    expect(again.phase).toBe('challenge');
  });

  it('ghosts neither trigger nor reveal traps', () => {
    const s = move({ ...withPlayers(game(2), [{}, { alive: false, node: 10 }]), turn: 1 }, 9, [1]);
    expect(s.traps.find((t) => t.node === 9)!.revealed).toBe(false);
    expect(s.phase).toBe('summary');
  });

  it('spares a protected player on an unknown trap but reveals it; a known one waives protection', () => {
    const prot = withPlayers(game(), [{ node: 10, protectedUntil: 5 }]);
    const spared = move(prot, 9, [1, 1]);
    expect(spared.phase).toBe('ghost');
    expect(spared.traps.find((t) => t.node === 9)!.revealed).toBe(true);
    expect(spared.log.some((e) => e.kind === 'spared')).toBe(true);
    const known = { ...prot, traps: prot.traps.map((t) => (t.node === 9 ? { ...t, revealed: true } : t)) };
    const pv = previewMove(choosing(known, [1, 1]), 0, 9)!;
    expect(pv.waivesProtection).toBe(true);
    expect(pv.encounter.kind).toBe('reaper');
    expect(move(known, 9, [1, 1]).phase).toBe('challenge');
  });

  it('event relocations and swaps never trigger or reveal a trap', () => {
    let s = withPlayers(game(2), [{ node: 4 }, { node: 9 }]);
    s = stackDeck(s, 'costumeMixup');
    s = move(s, 5, [1, 1]);
    expect(s.phase).toBe('event');
    s = act(s, { type: 'eventChoose', option: 1 });
    expect(s.players[0].node).toBe(9);
    expect(s.traps.find((t) => t.node === 9)!.revealed).toBe(false);
    expect(s.phase).toBe('ghost');
  });
});

describe('dying and becoming a ghost', () => {
  it('a failed performance drops all carried candy, keeps the bank, and spends the decoy', () => {
    let s = move(withPlayers(game(), [{ node: 10, carried: 7, banked: 4 }]), 9, [1, 2]);
    s = resolve(s, { 0: 'lose' });
    expect(s.players[0]).toMatchObject({ alive: false, node: 9, carried: 0, banked: 4, decoyUsed: true });
    expect(s.piles[9]).toBe(7);
    // The already-assigned ghost die still resolves this turn, then play passes on.
    expect(s.phase).toBe('ghost');
    s = act(s, { type: 'moveGhost' });
    s = act(s, s.phase === 'challenge' ? { type: 'challengeResult', id: s.challenge!.id, inputs: { [s.challenge!.participants[0]]: [] } } : { type: 'nextTurn' });
    if (s.phase === 'summary') s = act(s, { type: 'nextTurn' });
    expect(s.turn).toBe(1);
  });

  it('solo rope needs five of eight jumps', () => {
    const land = (q: number) => {
      let s = move(withPlayers(game(2, 5), [{ node: 10 }]), 9, [1, 1]);
      s = { ...s, challenge: { ...s.challenge!, kind: 'rope' } };
      return resolve(s, { 0: q });
    };
    expect(land(5).players[0].alive).toBe(true);
    expect(land(4).players[0].alive).toBe(false);
  });

  it('a survivor keeps their candy, collects the floor pile once, and is protected', () => {
    let s = withPlayers(game(), [{ node: 10, carried: 3 }]);
    s = { ...s, piles: s.piles.map((v, i) => (i === 9 ? 4 : v)) };
    s = resolve(move(s, 9, [1, 1]), { 0: 'win' });
    expect(s.players[0].carried).toBe(7);
    expect(s.piles[9]).toBe(0);
    expect(isProtected(s, 0)).toBe(true);
  });
});

describe('the resident ghost', () => {
  const caught = (win: boolean) => {
    let s = withPlayers(game(2), [{ node: 15, carried: 5, banked: 2 }, {}]);
    s = move(s, 'stay', [1, 1]);
    s = act(s, { type: 'moveGhost' });
    expect(s.challenge).toMatchObject({ kind: 'escape', host: 'npc', participants: [0] });
    return resolve(s, { 0: win ? 'win' : 'lose' });
  };
  it('a successful escape relocates to the nearest empty corridor (ties by id) and protects', () => {
    const s = caught(true);
    expect(s.players[0]).toMatchObject({ alive: true, node: 14, carried: 5 });
    expect(s.traps.find((t) => t.node === 14)!.revealed).toBe(false);
    expect(isProtected(s, 0)).toBe(true);
    expect(s.phase).toBe('summary');
  });
  it('a failed escape transforms at the catch space', () => {
    const s = caught(false);
    expect(s.players[0]).toMatchObject({ alive: false, node: 15, carried: 0, banked: 2 });
    expect(s.piles[15]).toBe(5);
    expect(s.players.every((p) => p.bounty === 0)).toBe(true);
  });
  it('ignores ghosts and protected players, and waits if nobody is exposed', () => {
    const s = withPlayers(game(3), [{ node: 0 }, { alive: false, node: 15 }, { node: 17, protectedUntil: 9 }]);
    expect(planGhost(s, 6).target).toBe(null);
    const t = move(s, 'stay', [1, 6]);
    expect(act(t, { type: 'moveGhost' }).log.some((e) => e.kind === 'ghostWaits')).toBe(true);
  });
  it('stops at its first encounter and runs only one challenge', () => {
    const s = withPlayers(game(3), [{ node: 14, carried: 9 }, { node: 15, carried: 1 }, {}]);
    const plan = planGhost(s, 6);
    expect(plan.target!.player).toBe(0);
    expect(plan.encounter).toEqual({ player: 1, node: 15 });
    expect(plan.path).toEqual([16, 15]);
  });
  it('passes protected players and still follows a decoy', () => {
    let s = withPlayers(game(2), [{ node: 18 }, { node: 15, carried: 9, protectedUntil: 9 }]);
    s = act(s, { type: 'placeDecoy' });
    expect(planGhost(s, 6).target).toMatchObject({ kind: 'decoy', node: 18 });
  });
});

describe('player ghosts', () => {
  it('roll one die, hunt by ending on the living, and earn a capped bounty', () => {
    let s = withPlayers(game(4), [{ node: 3 }, { alive: false, node: 2 }, { node: 6 }, { node: 10 }]);
    s = { ...s, turn: 1, phase: 'turnStart' };
    s = act(s, { type: 'roll' });
    expect(s.dice!.length).toBe(1);
    const hunt = (st: GameState, dest: number) => resolve(act(act({ ...st, phase: 'choose', dice: [6], turn: 1 }, { type: 'select', dest }), { type: 'confirmMove' }), { [dest === 3 ? 0 : dest === 6 ? 2 : 3]: 'lose' });
    s = hunt(s, 3);
    expect(s.players[1].bounty).toBe(3);
    s = hunt(withPlayers(s, [{}, { node: 3 }]), 6);
    expect(s.players[1].bounty).toBe(6);
    s = hunt(withPlayers(s, [{}, { node: 6 }]), 10);
    expect(s.players[1].bounty).toBe(6); // capped, but still hunting
    expect(s.lastOutcome!.bounty).toEqual({ player: 1, amount: 0 });
  });

  it('never harvests, picks up, draws cards, or triggers a resident-ghost phase', () => {
    let s = withPlayers(game(2), [{}, { alive: false, node: 2 }]);
    s = { ...s, turn: 1, piles: s.piles.map((v, i) => (i === 3 ? 4 : v)) };
    const t = move(s, 3, [1]);
    expect(t.stocks[3]).toBe(6);
    expect(t.piles[3]).toBe(4);
    expect(t.players[1].carried).toBe(0);
    expect(t.phase).toBe('summary');
    const e = move({ ...withPlayers(s, [{}, { node: 4 }]) }, 5, [1]);
    expect(e.event).toBe(null);
  });

  it('leaves protected players alone', () => {
    const s = move({ ...withPlayers(game(2), [{ node: 3, protectedUntil: 9 }, { alive: false, node: 2 }]), turn: 1 }, 3, [1]);
    expect(s.phase).toBe('summary');
  });
});

describe('Haunted Jump Rope duels', () => {
  const duel = (round: number, q0: 'win' | 'lose' | number, q1: 'win' | 'lose' | number) => {
    let s = withPlayers(game(2), [{ node: 2, carried: 2 }, { node: 3, carried: 4 }]);
    s = { ...s, round };
    s = move(s, 3, [1, 1]);
    expect(s.challenge).toMatchObject({ kind: 'duel', host: 'duel', participants: [0, 1], oneSurvivor: round >= 8 });
    return resolve(s, { 0: q0, 1: q1 });
  };
  it('early: both can survive; the arriving player gets the landing reward', () => {
    const s = duel(1, 'win', 'win');
    expect(s.players.every((p) => p.alive)).toBe(true);
    expect(s.players[0].carried).toBe(5);
    expect(s.players[1].carried).toBe(4);
    expect(s.stocks[3]).toBe(3);
  });
  it('early: a sole surviving defender collects the pile and the room reward', () => {
    const s = duel(1, 'lose', 'win');
    expect(s.players[0].alive).toBe(false);
    expect(s.players[1].carried).toBe(4 + 2 + 3);
    expect(s.piles[3]).toBe(0);
  });
  it('early: both can die, and the candy stays on the floor', () => {
    const s = duel(1, 'lose', 'lose');
    expect(s.players.every((p) => !p.alive)).toBe(true);
    expect(s.piles[3]).toBe(6);
    expect(s.stocks[3]).toBe(6);
    expect(s.phase).toBe('gameOver');
    expect(s.endReason).toBe('noneAlive');
  });
  it('late: exactly one survivor, the higher scorer', () => {
    const s = duel(8, 6, 'win');
    expect(s.players.map((p) => p.alive)).toEqual([false, true]);
  });
  it('late ties go to sudden-death sweeps, then timing, then an announced curse', () => {
    const s = duel(8, 9, 8);
    expect(s.players.map((p) => p.alive)).toEqual([true, false]);
    expect(s.lastOutcome!.decidedBy).toBe('suddenDeath');
    const sched = ropeSchedule(77, true);
    const a = sched.bottoms.map((b) => ({ t: b - 250 }));
    const b = sched.bottoms.map((b) => ({ t: b - 300 }));
    expect(judgeDuel(77, [0, 1], [a, b], true)).toMatchObject({ survivors: [0], decidedBy: 'timing' });
    const coin = judgeDuel(77, [0, 1], [a, a], true);
    expect(coin.decidedBy).toBe('curse');
    expect(judgeDuel(77, [0, 1], [a, a], true)).toEqual(coin);
  });
  it('mashing earns nothing: only the first press in a sweep window counts', () => {
    const sched = ropeSchedule(5, false);
    const mash = sched.bottoms.flatMap((bt) => [bt - 690, bt - 600, bt - 250, bt - 100]).map((t) => ({ t }));
    expect(judgeDuel(5, [0, 1], [mash, []], false).scores[0]).toBe(0);
  });
  it('a duel on a hidden trap reveals it and the Reaper hosts only that duel', () => {
    let s = withPlayers(game(2), [{ node: 10 }, { node: 9 }]);
    s = move(s, 9, [1, 1]);
    expect(s.traps.find((t) => t.node === 9)!.revealed).toBe(true);
    expect(s.challenge).toMatchObject({ kind: 'duel', host: 'reaper' });
    s = resolve(s, { 0: 'win', 1: 'win' });
    expect(s.phase).toBe('ghost');
  });
  it('protected players can neither start nor receive a duel; several occupants mean a choice', () => {
    expect(move(withPlayers(game(2), [{ node: 2, protectedUntil: 9 }, { node: 3 }]), 3, [1, 1]).phase).toBe('ghost');
    expect(move(withPlayers(game(2), [{ node: 2 }, { node: 3, protectedUntil: 9 }]), 3, [1, 1]).phase).toBe('ghost');
    const s = move(withPlayers(game(3), [{ node: 2 }, { node: 3 }, { node: 3 }]), 3, [1, 1]);
    expect(s.phase).toBe('pick');
    expect(act(s, { type: 'pickOpponent', option: 2 }).challenge!.participants).toEqual([0, 2]);
  });
  it('previews a lethal late duel explicitly', () => {
    const s = choosing({ ...withPlayers(game(2), [{ node: 2 }, { node: 3 }]), round: 9 }, [1, 1]);
    expect(previewMove(s, 0, 3)!.encounter).toEqual({ kind: 'duel', lethal: true, opponents: [1] });
  });
});

describe('the Super Reaper', () => {
  it('summons a remote opponent into a one-survivor duel even in round 1, without moving them', () => {
    let s = withPlayers(game(2), [{ node: 4, carried: 1 }, { node: 22, carried: 5 }]);
    s = move(s, SUPER_REAPER, [1, 1]);
    expect(s.challenge).toMatchObject({ kind: 'duel', host: 'superReaper', oneSurvivor: true, origins: [12, 22] });
    expect(s.players[1].node).toBe(22);
    s = resolve(s, { 0: 'win', 1: 3 });
    expect(s.players[1]).toMatchObject({ alive: false, node: 22 });
    expect(s.piles[22]).toBe(5);
    expect(s.players[0]).toMatchObject({ node: 12, carried: 1 });
    expect(s.players.every((p) => p.bounty === 0)).toBe(true);
  });
  it('lets the arriving player choose among several opponents', () => {
    const s = move(withPlayers(game(3), [{ node: 4 }, { node: 22 }, { node: 29 }]), SUPER_REAPER, [1, 1]);
    expect(s.phase).toBe('pick');
    expect(s.pick!.kind).toBe('summon');
  });
  it('falls back to a solo performance when nobody is eligible', () => {
    const s = move(withPlayers(game(2), [{ node: 4 }, { node: 0 }]), SUPER_REAPER, [1, 1]);
    expect(s.challenge).toMatchObject({ host: 'superReaper', participants: [0] });
    expect(['dance', 'rope']).toContain(s.challenge!.kind);
  });
});

describe('protection and scoring', () => {
  it('lasts until the end of the survivor’s next scheduled turn', () => {
    let s = move(withPlayers(game(2), [{ node: 10 }]), 9, [1, 1]);
    s = resolve(s, { 0: 'win' });
    expect(s.players[0].protectedUntil).toBe(3);
    s = { ...s, phase: 'summary' };
    s = act(s, { type: 'nextTurn' });
    expect(isProtected(s, 0)).toBe(true);
    s = act({ ...s, phase: 'summary' }, { type: 'nextTurn' });
    expect(s.turn).toBe(0);
    expect(isProtected(s, 0)).toBe(true);
    s = act({ ...s, phase: 'summary' }, { type: 'nextTurn' });
    expect(isProtected(s, 0)).toBe(false);
  });

  it('scores the living with a survival bonus at six banked, and ghosts with bank + bounty', () => {
    const s = withPlayers(game(4), [{ banked: 6, carried: 3 }, { banked: 5, carried: 0 }, { alive: false, banked: 4, bounty: 6 }, { alive: false, banked: 11, bounty: 0 }]);
    const lines = finalScores(s);
    const by = (p: number) => lines.find((l) => l.player === p)!;
    expect(by(0)).toMatchObject({ total: 6 + 1 + 5, survivalBonus: 5 });
    expect(by(1)).toMatchObject({ total: 5, survivalBonus: 0 });
    expect(by(2)).toMatchObject({ total: 10, bounty: 6, alive: false });
    expect(by(3).total).toBe(11);
    expect(lines.filter((l) => l.winner).map((l) => l.player)).toEqual([0]);
  });

  it('ends at once when an encounter leaves nobody alive', () => {
    let s = withPlayers(game(2), [{ node: 10 }, { alive: false, node: 20 }]);
    s = resolve(move(s, 9, [1, 1]), { 0: 'lose' });
    expect(s.phase).toBe('gameOver');
    expect(s.endReason).toBe('noneAlive');
  });
});

describe('previews', () => {
  it('match the committed ghost plan when nothing is left to chance, and never consume randomness', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = withPlayers(game(3, seed), [{}, { node: 22, carried: 4 }, { node: 17, carried: 2 }]);
      s = act(s, { type: 'roll' });
      for (const md of [0, 1] as const) {
        for (const dest of [...legalRoutes(s, md).keys(), 'stay' as const]) {
          const frozen = JSON.stringify(s);
          const p = previewMove(s, md, dest)!;
          expect(JSON.stringify(s)).toBe(frozen);
          if (p.provisional) continue;
          const c = act(act(s, { type: 'select', moveDie: md, dest }), { type: 'confirmMove' });
          if (c.phase !== 'ghost') continue; // an unknown trap intervened
          expect(currentGhostPlan(c)).toEqual(p.ghost);
          expect(c.rng).toBe(s.rng);
        }
      }
    }
  });
});

describe('sessions, undo and saves', () => {
  it('undo restores mechanics but the table keeps what it has seen', () => {
    let ses = newSession(withPlayers(game(2, 3), [{ node: 10 }]));
    ses = dispatch(ses, { type: 'roll' }).session;
    ses = { ...ses, game: { ...ses.game, dice: [1, 1] } };
    ses = dispatch(ses, { type: 'select', dest: 9 }).session;
    ses = dispatch(ses, { type: 'confirmMove' }).session;
    const seed1 = ses.game.challenge!.seed;
    expect(ses.known).toEqual([9]);
    const back = undo(ses);
    expect(back.game.traps.find((t) => t.node === 9)!.revealed).toBe(false);
    expect(back.known).toEqual([9]);
    expect(back.game.traps).toEqual(ses.turnStart.traps);
    let replay = dispatch(back, { type: 'roll' }).session;
    replay = { ...replay, game: { ...replay.game, dice: [1, 1] } };
    replay = dispatch(dispatch(replay, { type: 'select', dest: 9 }).session, { type: 'confirmMove' }).session;
    expect(replay.game.challenge!.seed).toBe(seed1);
    expect(undoInfo(replay).available).toBe(true);
  });

  it('saves round-trip traps, reveals and a live challenge; old-rules saves are refused', () => {
    let ses = newSession(withPlayers(game(2, 3), [{ node: 10 }]));
    ses = { ...ses, game: move(ses.game, 9, [1, 1]) };
    const loaded = deserialize(serialize(ses, defaultPersonalization()));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.game.traps).toEqual(ses.game.traps);
    expect(loaded.session.game.challenge).toEqual(ses.game.challenge);
    const v1 = JSON.parse(serialize(ses, defaultPersonalization()));
    v1.schema = 1;
    expect(deserialize(JSON.stringify(v1))).toEqual({ ok: false, reason: 'incompatible' });
  });

  it('refuses stale or duplicate challenge results', () => {
    let s = move(withPlayers(game(2), [{ node: 10 }]), 9, [1, 1]);
    const id = s.challenge!.id;
    s = resolve(s, { 0: 'win' });
    expect(apply(s, { type: 'challengeResult', id, inputs: { 0: [] } }).error).toBeTruthy();
    const t = move(withPlayers(game(2), [{ node: 10 }]), 9, [1, 1]);
    expect(apply(t, { type: 'challengeResult', id: 'nope', inputs: { 0: [] } }).error).toBeTruthy();
    expect(apply(t, { type: 'challengeResult', id: t.challenge!.id, inputs: {} }).error).toBeTruthy();
  });
});

describe('bots and whole games', () => {
  it('bots see the same thing whatever the hidden map, and so decide the same', () => {
    for (let seed = 1; seed < 25; seed++) {
      const a = withPlayers(game(3, seed, [2, 4, 6, 9, 14, 18]), [{ node: 20, carried: 3 }]);
      const b = withPlayers(game(3, seed, [19, 20, 21, 26, 28, 30]), [{ node: 20, carried: 3 }]);
      const sa = act(a, { type: 'roll' });
      const sb = act(b, { type: 'roll' });
      expect(seatView(sa, 0)).toEqual(seatView(sb, 0));
      expect(botAction(seatView(sa, 0), defaultBotProfile(0), newBotMemory(seed))).toEqual(botAction(seatView(sb, 0), defaultBotProfile(0), newBotMemory(seed)));
    }
  });

  it('finish complete games for 2–6 seats without stalling, ten turns each at most', () => {
    let early = 0;
    for (let n = 2; n <= 6; n++) {
      for (let seed = 1; seed <= 12; seed++) {
        const r = simulateGame({ seed: seed * 101 + n, profiles: Array.from({ length: n }, (_, i) => defaultBotProfile(i + seed)) });
        expect(r.session.game.phase).toBe('gameOver');
        if (r.endedEarly) early++;
        else expect(r.turns).toBe(n * 10);
        expect(r.session.game.traps.length).toBe(6);
        const total = r.session.game.players.reduce((a, p) => a + p.carried + p.banked, 0) + r.session.game.piles.reduce((a, b) => a + b, 0);
        const drawn = Object.values(ROOMS).reduce((a, x) => a + x.stock, 0) - r.session.game.stocks.reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThanOrEqual(drawn);
      }
    }
    expect(early).toBeLessThan(60);
  });

  it('two bots with the same skill do not simply mirror each other', () => {
    let differ = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const a = botChallengeInputs('duel', seed, 0, SKILLS.steady, true);
      const b = botChallengeInputs('duel', seed, 1, SKILLS.steady, true);
      if (JSON.stringify(a) !== JSON.stringify(b)) differ++;
      const v = judgeDuel(seed, [0, 1], [a, b], true);
      expect(v.survivors.length).toBe(1);
    }
    expect(differ).toBe(30);
  });
});
