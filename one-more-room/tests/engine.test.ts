import { describe, expect, it } from 'vitest';
import {
  CHARACTERS,
  ENTRANCE,
  EVENT_NODES,
  NODE_COUNT,
  NODE_POSITIONS,
  ORDINARY_EDGES,
  ROOMS,
  SECRET_ENDPOINTS,
  cardType,
  nodeKind,
  type EventType,
  EVENT_TYPES,
} from '../src/engine/config';
import { bfs, ghostBfs, ORDINARY_ADJ, playerRoutes } from '../src/engine/graph';
import {
  apply,
  createGame,
  currentGhostPlan,
  dispatch,
  finalScores,
  ghostTarget,
  legalRoutes,
  newSession,
  planGhost,
  previewMove,
  undo,
  undoInfo,
  type Session,
} from '../src/engine/engine';
import type { Action, GameState } from '../src/engine/types';
import { deserialize, serialize, defaultPersonalization, sanitizePersonalization, cleanText } from '../src/engine/save';

const chars = CHARACTERS.map((c) => c.id);

function game(n = 2, seed = 1234): GameState {
  return createGame({ players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, character: chars[i] })), seed });
}

function act(s: GameState, a: Action): GameState {
  const r = apply(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/** A state mid-turn with fixed dice, ready for the 'choose' phase. */
function choosing(s: GameState, dice: [number, number]): GameState {
  return { ...s, phase: 'choose', dice, selection: { moveDie: 0, dest: null } };
}

function withPlayers(s: GameState, patch: Array<Partial<GameState['players'][number]>>): GameState {
  return { ...s, players: s.players.map((p, i) => ({ ...p, ...(patch[i] ?? {}) })) };
}

/** Force the next card drawn to be of a given type. */
function stackDeck(s: GameState, type: EventType): GameState {
  const id = s.deck.find((c) => cardType(c) === type)!;
  return { ...s, deck: [id, ...s.deck.filter((c) => c !== id)] };
}

describe('board topology', () => {
  it('has exactly 32 unique nodes with reciprocal ordinary edges', () => {
    expect(NODE_POSITIONS.length).toBe(32);
    expect(ORDINARY_EDGES.length).toBe(34);
    const keys = new Set(ORDINARY_EDGES.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
    expect(keys.size).toBe(34);
    expect(keys.has('4-12')).toBe(true);
    expect(keys.has('20-28')).toBe(true);
    for (let a = 0; a < NODE_COUNT; a++) for (const b of ORDINARY_ADJ[a]) expect(ORDINARY_ADJ[b]).toContain(a);
    const pos = new Set(NODE_POSITIONS.map(([x, z]) => `${x},${z}`));
    expect(pos.size).toBe(32);
  });

  it('is connected, with three independent loops', () => {
    const { dist } = bfs(0);
    expect(dist.every((d) => d < Infinity)).toBe(true);
    // cyclomatic number = E - V + 1 = 34 - 32 + 1
    expect(ORDINARY_EDGES.length - NODE_COUNT + 1).toBe(3);
  });

  it('assigns node types exactly', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < NODE_COUNT; i++) counts[nodeKind(i)] = (counts[nodeKind(i)] ?? 0) + 1;
    expect(counts).toEqual({ entrance: 1, room: 8, event: 3, secret: 4, corridor: 16 });
    expect(Object.fromEntries(Object.entries(ROOMS).map(([k, r]) => [k, r.stock]))).toEqual({
      3: 6, 7: 8, 10: 8, 15: 12, 17: 12, 22: 10, 25: 8, 29: 6,
    });
    expect([...EVENT_NODES]).toEqual([5, 13, 23]);
    expect([...SECRET_ENDPOINTS].sort((a, b) => a - b)).toEqual([8, 11, 24, 27]);
  });

  it('puts the farthest spaces 8–10 steps from the entrance without passages', () => {
    const { dist } = bfs(0);
    const max = Math.max(...dist);
    expect(max).toBeGreaterThanOrEqual(8);
    expect(max).toBeLessThanOrEqual(10);
    expect(dist[16]).toBe(9);
  });

  it('keeps the ghost graph connected without the entrance', () => {
    const { dist, parent } = ghostBfs(16);
    // Without the entrance, the ghost's only cycles are the two 9-edge wings, so its
    // shortest paths are unique; BFS still expands lowest ids first.
    expect(parent[15]).toBe(16);
    for (let i = 1; i < NODE_COUNT; i++) expect(dist[i]).toBeLessThan(Infinity);
    expect(dist[0]).toBe(Infinity);
  });
});

describe('setup', () => {
  it('starts everyone at the entrance with a decoy, ghost at 16', () => {
    const s = game(6);
    expect(s.players.every((p) => p.node === 0 && p.carried === 0 && p.banked === 0 && !p.decoyUsed)).toBe(true);
    expect(s.ghost).toBe(16);
    expect(s.deck.length).toBe(18);
    for (const t of EVENT_TYPES) expect(s.deck.filter((c) => cardType(c) === t).length).toBe(3);
  });

  it('rejects duplicate characters and bad player counts', () => {
    expect(() => createGame({ players: [{ name: 'a', character: 'witch' }, { name: 'b', character: 'witch' }], seed: 1 })).toThrow();
    expect(() => createGame({ players: [{ name: 'a', character: 'witch' }], seed: 1 })).toThrow();
  });
});

describe('player movement', () => {
  it('offers destinations 1..allowance by shortest legal route', () => {
    const routes = playerRoutes(0, 3, 16);
    expect([...routes.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 29, 30, 31]);
    expect(routes.get(3)!.path).toEqual([0, 1, 2, 3]);
  });

  it('uses both dice assignments and lets the assignment change before confirming', () => {
    let s = choosing(game(), [2, 5]);
    expect(Math.max(...[...legalRoutes(s, 0).values()].map((r) => r.path.length - 1))).toBe(2);
    expect(Math.max(...[...legalRoutes(s, 1).values()].map((r) => r.path.length - 1))).toBe(5);
    s = act(s, { type: 'select', moveDie: 1, dest: 5 });
    expect(s.selection).toEqual({ moveDie: 1, dest: 5 });
    s = act(s, { type: 'select', moveDie: 0 }); // 5 steps no longer reachable
    expect(s.selection.dest).toBe(null);
    expect(s.dice).toEqual([2, 5]);
  });

  it('allows at most one secret passage per move', () => {
    const r = playerRoutes(7, 6, 16);
    expect(r.get(24)!.path).toEqual([7, 8, 24]);
    // 8→24 then back via 27→11 would need two passages; 11 is reached ordinarily.
    for (const route of r.values()) {
      let secrets = 0;
      for (let i = 1; i < route.path.length; i++) {
        const [a, b] = [route.path[i - 1], route.path[i]];
        if ((a === 8 && b === 24) || (a === 24 && b === 8) || (a === 11 && b === 27) || (a === 27 && b === 11)) secrets++;
      }
      expect(secrets).toBeLessThanOrEqual(1);
    }
    expect(r.get(11)!.path).toEqual([7, 8, 9, 10, 11]);
  });

  it('picks the shortest route when lengths differ', () => {
    const routes = playerRoutes(12, 6, 30);
    expect(routes.get(7)!.path).toEqual([12, 4, 5, 6, 7]); // 4 steps beats 12-11-10-9-8-7
    expect(routes.get(8)!.path).toEqual([12, 11, 10, 9, 8]); // 4 steps beats 12-4-5-6-7-8
  });

  it('resolves a genuine equal-length tie toward the lower next node id', () => {
    // 8 → 27: 8-24-25-26-27 and 8-9-10-11-27 both take 4 steps; next node 9 < 24.
    const r = playerRoutes(8, 6, 16);
    expect(r.get(27)!.path).toEqual([8, 9, 10, 11, 27]);
  });

  it('never passes through or ends on the ghost', () => {
    const r = playerRoutes(0, 6, 2);
    expect(r.has(2)).toBe(false);
    expect(r.has(3)).toBe(false); // only reachable through 2 within 6? 0-31-30-29-28-... no
    expect(r.get(1)!.path).toEqual([0, 1]);
  });

  it('stops at the entrance and cannot pass through it', () => {
    const r = playerRoutes(2, 6, 16);
    expect(r.get(0)!.path).toEqual([2, 1, 0]);
    expect(r.has(31)).toBe(false);
    expect(r.has(30)).toBe(false);
  });

  it('never routes back onto the starting space', () => {
    for (let start = 0; start < NODE_COUNT; start++) {
      const r = playerRoutes(start, 6, start === 16 ? 15 : 16);
      expect(r.has(start)).toBe(false);
      for (const route of r.values()) expect(new Set(route.path).size).toBe(route.path.length);
    }
  });

  it('always allows Stay, even when boxed in', () => {
    let s = game();
    s = withPlayers(s, [{ node: 1 }]);
    s = { ...s, ghost: 2 };
    s = choosing(s, [1, 1]);
    // Only 0 is reachable; select Stay anyway.
    s = act(s, { type: 'select', dest: 'stay' });
    s = act(s, { type: 'confirmMove' });
    expect(s.players[0].node).toBe(1);
    expect(s.phase).toBe('ghost');
  });

  it('staying never harvests, collects a pile or triggers an event', () => {
    let s = withPlayers(game(), [{ node: 5 }]);
    s = { ...s, piles: s.piles.map((v, i) => (i === 5 ? 4 : v)) };
    s = choosing(s, [3, 4]);
    s = act(s, { type: 'select', dest: 'stay' });
    s = act(s, { type: 'confirmMove' });
    expect(s.players[0].carried).toBe(0);
    expect(s.piles[5]).toBe(4);
    expect(s.event).toBe(null);
    expect(s.phase).toBe('ghost');
  });

  it('passing through rooms and events does nothing; landing resolves once', () => {
    let s = choosing(game(), [5, 1]);
    s = act(s, { type: 'select', dest: 4 });
    s = act(s, { type: 'confirmMove' });
    expect(s.stocks[3]).toBe(6);
    expect(s.players[0].carried).toBe(0);
    let t = choosing(game(), [3, 1]);
    t = act(t, { type: 'select', dest: 3 });
    t = act(t, { type: 'confirmMove' });
    expect(t.players[0].carried).toBe(3);
    expect(t.stocks[3]).toBe(3);
  });

  it('ignores repeated confirm clicks', () => {
    let s = choosing(game(), [3, 1]);
    s = act(s, { type: 'select', dest: 3 });
    s = act(s, { type: 'confirmMove' });
    const again = apply(s, { type: 'confirmMove' });
    expect(again.error).toBeTruthy();
    expect(again.state).toBe(s);
    const rollAgain = apply(s, { type: 'roll' });
    expect(rollAgain.error).toBeTruthy();
  });
});

describe('landing effects and stocks', () => {
  it('takes min(3, stock) and exhausts rooms without refilling', () => {
    let s = withPlayers(game(), [{ node: 2 }]);
    s = { ...s, stocks: s.stocks.map((v, i) => (i === 3 ? 2 : v)) };
    s = choosing(s, [1, 1]);
    s = act(s, { type: 'select', dest: 3 });
    s = act(s, { type: 'confirmMove' });
    expect(s.players[0].carried).toBe(2);
    expect(s.stocks[3]).toBe(0);
    let t = withPlayers(game(), [{ node: 2 }]);
    t = { ...t, stocks: t.stocks.map((v, i) => (i === 3 ? 0 : v)) };
    t = act(choosing(t, [1, 1]), { type: 'select', dest: 3 });
    t = act(t, { type: 'confirmMove' });
    expect(t.players[0].carried).toBe(0);
    expect(t.stocks[3]).toBe(0);
  });

  it('collects a whole pile in addition to the room harvest', () => {
    let s = withPlayers(game(), [{ node: 2 }]);
    s = { ...s, piles: s.piles.map((v, i) => (i === 3 ? 5 : v)) };
    s = act(choosing(s, [1, 1]), { type: 'select', dest: 3 });
    s = act(s, { type: 'confirmMove' });
    expect(s.players[0].carried).toBe(8);
    expect(s.piles[3]).toBe(0);
    expect(s.stocks[3]).toBe(3);
  });

  it('banks carried candy on arrival and the bank is never touched by events or catches', () => {
    let s = withPlayers(game(), [{ node: 2, carried: 7, banked: 4 }, { node: 13, carried: 0 }]);
    s = act(choosing(s, [2, 3]), { type: 'select', dest: 0 });
    s = act(s, { type: 'confirmMove' });
    expect(s.players[0]).toMatchObject({ node: 0, carried: 0, banked: 11 });
  });
});

describe('ghost targeting', () => {
  it('hunts the richest carrier, ignoring banked candy', () => {
    const s = withPlayers(game(3), [{ node: 3, carried: 2, banked: 50 }, { node: 29, carried: 5 }, { node: 10, carried: 1 }]);
    expect(ghostTarget(s)).toEqual({ kind: 'player', player: 1, node: 29 });
  });

  it('keeps zero-candy players eligible', () => {
    const s = withPlayers(game(2), [{ node: 0 }, { node: 3, carried: 0 }]);
    expect(ghostTarget(s)).toEqual({ kind: 'player', player: 1, node: 3 });
  });

  it('breaks wealth ties by ghost distance', () => {
    const s = withPlayers(game(3), [{ node: 3, carried: 2 }, { node: 18, carried: 2 }, { node: 29, carried: 2 }]);
    expect(ghostTarget(s)).toMatchObject({ player: 1 });
  });

  it('then prefers the active player, then clockwise after them', () => {
    // 14 and 18 are both 2 from the ghost at 16.
    let s = withPlayers(game(4), [{ node: 14, carried: 1 }, { node: 18, carried: 1 }, { node: 14, carried: 1 }, { node: 0 }]);
    s = { ...s, turn: 0 };
    expect(ghostTarget(s)).toMatchObject({ player: 0 });
    s = { ...s, turn: 3 }; // active at the entrance → clockwise after 3 is 0
    expect(ghostTarget(s)).toMatchObject({ player: 0 });
    s = { ...s, turn: 1 };
    expect(ghostTarget(s)).toMatchObject({ player: 1 });
    s = withPlayers({ ...s, turn: 1 }, [{}, { node: 0, carried: 0 }]);
    expect(ghostTarget(s)).toMatchObject({ player: 2 }); // clockwise after 1 → 2 before 0
  });

  it('waits when everyone is in the entrance and there is no decoy', () => {
    let s = choosing(game(2), [3, 4]);
    s = act(s, { type: 'select', dest: 'stay' });
    s = act(s, { type: 'confirmMove' });
    expect(currentGhostPlan(s)!.target).toBe(null);
    s = act(s, { type: 'moveGhost' });
    expect(s.ghost).toBe(16);
    expect(s.log.some((e) => e.kind === 'ghostWaits')).toBe(true);
  });

  it('never enters the entrance or uses secret passages', () => {
    // Target at 24, ghost at 8: secret edge 8-24 is ignored.
    let s = withPlayers(game(2), [{ node: 24, carried: 3 }, { node: 0 }]);
    s = { ...s, ghost: 8 };
    const plan = planGhost(s, 20);
    expect(plan.fullPath[1]).not.toBe(24);
    expect(plan.fullPath).not.toContain(0);
    expect(plan.fullPath.length - 1).toBeGreaterThan(1);
  });

  it('stops at its target even with movement left, and catches intervening players', () => {
    const s = withPlayers(game(3), [{ node: 14, carried: 1 }, { node: 13, carried: 6 }, { node: 15, carried: 0 }]);
    const plan = planGhost(s, 6);
    expect(plan.target).toMatchObject({ player: 1 });
    expect(plan.path).toEqual([16, 15, 14, 13]);
    expect(plan.reachesTarget).toBe(true);
    expect(plan.catches.map((c) => c.player)).toEqual([2, 0, 1]);
  });

  it('moves only up to its allowance and does not retarget', () => {
    const s = withPlayers(game(2), [{ node: 3, carried: 4 }, { node: 0 }]);
    const plan = planGhost(s, 2);
    expect(plan.path.length - 1).toBe(2);
    expect(plan.reachesTarget).toBe(false);
  });

  it('follows a decoy instead of players, then the decoy vanishes', () => {
    let s = withPlayers(game(2), [{ node: 18, carried: 0 }, { node: 13, carried: 9 }]);
    s = act(s, { type: 'placeDecoy' });
    expect(s.decoy).toBe(18);
    expect(s.players[0].decoyUsed).toBe(true);
    expect(ghostTarget(s)).toEqual({ kind: 'decoy', node: 18 });
    s = { ...s, dice: [1, 1], phase: 'choose' as const };
    s = act(s, { type: 'select', dest: 19 });
    s = act(s, { type: 'confirmMove' });
    s = act(s, { type: 'moveGhost' });
    expect(s.ghost).toBe(17);
    expect(s.decoy).toBe(null);
    expect(s.players[1].node).toBe(13);
  });

  it('refuses a decoy in the entrance hall or a second decoy', () => {
    const s = game(2);
    expect(apply(s, { type: 'placeDecoy' }).error).toBeTruthy();
    const t = withPlayers(s, [{ node: 5, decoyUsed: true }]);
    expect(apply(t, { type: 'placeDecoy' }).error).toBeTruthy();
  });
});

describe('catches', () => {
  function catchOf(carried: number) {
    let s = withPlayers(game(2), [{ node: 15, carried, banked: 10 }, { node: 0 }]);
    s = { ...s, piles: s.piles.map((v, i) => (i === 15 ? 2 : v)) };
    s = act(choosing(s, [1, 1]), { type: 'select', dest: 'stay' });
    s = act(s, { type: 'confirmMove' });
    return act(s, { type: 'moveGhost' });
  }
  it('drops the larger half on odd candy and banks the rest', () => {
    const s = catchOf(7);
    expect(s.piles[15]).toBe(2 + 4);
    expect(s.players[0]).toMatchObject({ node: 0, carried: 0, banked: 13, decoyUsed: false });
  });
  it('drops half on even candy', () => {
    const s = catchOf(6);
    expect(s.piles[15]).toBe(5);
    expect(s.players[0].banked).toBe(13);
  });
  it('drops nothing on zero candy but still sends the player home', () => {
    const s = catchOf(0);
    expect(s.piles[15]).toBe(2);
    expect(s.players[0]).toMatchObject({ node: 0, banked: 10 });
  });
  it('catches each player once and never auto-collects piles for bystanders', () => {
    let s = withPlayers(game(3), [{ node: 15, carried: 4 }, { node: 15, carried: 2 }, { node: 17, carried: 0 }]);
    s = act(choosing(s, [1, 6]), { type: 'select', dest: 'stay' });
    s = act(s, { type: 'confirmMove' });
    s = act(s, { type: 'moveGhost' });
    expect(s.players[0].node).toBe(0);
    expect(s.players[1].node).toBe(0);
    expect(s.piles[15]).toBe(3);
    const ghostEntry = s.log.find((e) => e.kind === 'ghost');
    expect(ghostEntry && ghostEntry.kind === 'ghost' && ghostEntry.plan.catches.length).toBe(2);
    expect(s.players[2]).toMatchObject({ node: 17, carried: 0 });
  });
});

describe('events', () => {
  function toEvent(type: EventType, patch: Array<Partial<GameState['players'][number]>> = [], n = 3): GameState {
    let s = withPlayers(game(n), [{ node: 4, carried: 3 }, ...patch.slice(1)]);
    if (patch[0]) s = withPlayers(s, [patch[0]]);
    s = stackDeck(s, type);
    s = act(choosing(s, [1, 1]), { type: 'select', dest: 5 });
    return act(s, { type: 'confirmMove' });
  }

  it('secret passage relocates without collecting and can be declined', () => {
    let s = toEvent('secretPassage');
    expect(s.phase).toBe('event');
    expect(s.event!.options.sort((a, b) => a - b)).toEqual([8, 11, 24, 27]);
    s = { ...s, piles: s.piles.map((v, i) => (i === 24 ? 5 : v)) };
    const moved = act(s, { type: 'eventChoose', option: 24 });
    expect(moved.players[0]).toMatchObject({ node: 24, carried: 3 });
    expect(moved.piles[24]).toBe(5);
    expect(moved.phase).toBe('ghost');
    const declined = act(s, { type: 'eventDecline' });
    expect(declined.players[0].node).toBe(5);
    expect(declined.phase).toBe('ghost');
  });

  it('secret passage excludes the ghost’s endpoint', () => {
    let s = withPlayers(game(2), [{ node: 4, carried: 3 }]);
    s = stackDeck({ ...s, ghost: 24 }, 'secretPassage');
    s = act(act(choosing(s, [1, 1]), { type: 'select', dest: 5 }), { type: 'confirmMove' });
    expect(s.event!.options).not.toContain(24);
  });

  it('sticky fingers steals up to 2 from a neighbour, never from the entrance', () => {
    let s = toEvent('stickyFingers', [{}, { node: 6, carried: 1 }, { node: 0, carried: 0, banked: 9 }]);
    expect(s.event!.options).toEqual([1]);
    s = act(s, { type: 'eventChoose', option: 1 });
    expect(s.players[0].carried).toBe(4);
    expect(s.players[1].carried).toBe(0);
    expect(s.players[2].banked).toBe(9);
    const none = toEvent('stickyFingers', [{}, { node: 20, carried: 5 }, { node: 0 }]);
    expect(none.phase).toBe('ghost');
    expect(none.log.some((e) => e.kind === 'noEffect')).toBe(true);
  });

  it('sweet discovery adds 2 without touching stocks', () => {
    const before = game(3).stocks.slice();
    const s = toEvent('sweetDiscovery');
    expect(s.players[0].carried).toBe(5);
    expect(s.stocks).toEqual(before);
    expect(s.phase).toBe('ghost');
  });

  it('creaky floorboards adds 2 to ghost movement this turn only', () => {
    let s = toEvent('creakyFloorboards', [{}, { node: 29, carried: 9 }]);
    expect(currentGhostPlan(s)!.allowance).toBe(3);
    s = act(s, { type: 'moveGhost' });
    s = act(s, { type: 'nextTurn' });
    expect(s.ghostBonus).toBe(0);
  });

  it('costume mix-up swaps positions only, and can be declined', () => {
    let s = toEvent('costumeMixup', [{}, { node: 29, carried: 1 }, { node: 0 }]);
    expect(s.event!.options).toEqual([1]);
    s = act(s, { type: 'eventChoose', option: 1 });
    expect(s.players[0]).toMatchObject({ node: 29, carried: 3, name: 'P1' });
    expect(s.players[1]).toMatchObject({ node: 5, carried: 1, name: 'P2' });
    expect(s.stocks[29]).toBe(6); // no harvest on arrival by swap
    const none = toEvent('costumeMixup', [{}, { node: 0 }, { node: 0 }]);
    expect(none.phase).toBe('ghost');
  });

  it('flying candy drops up to 2 on the current space', () => {
    const s = toEvent('flyingCandy');
    expect(s.players[0].carried).toBe(1);
    expect(s.piles[5]).toBe(2);
    const empty = toEvent('flyingCandy', [{ node: 4, carried: 0 }]);
    expect(empty.piles[5]).toBe(0);
    expect(empty.log.some((e) => e.kind === 'noEffect')).toBe(true);
  });

  it('never chains: relocating onto an event space or room does nothing more', () => {
    let s = toEvent('costumeMixup', [{}, { node: 13, carried: 1 }]);
    const deckBefore = s.deck.length;
    s = act(s, { type: 'eventChoose', option: 1 });
    expect(s.players[0].node).toBe(13);
    expect(s.deck.length).toBe(deckBefore);
    expect(s.phase).toBe('ghost');
  });

  it('reshuffles the discard pile when the deck runs out', () => {
    let s = withPlayers(game(2), [{ node: 4 }]);
    s = { ...s, discard: [...s.deck.slice(1)], deck: [s.deck[0]] };
    s = act(act(choosing(s, [1, 1]), { type: 'select', dest: 5 }), { type: 'confirmMove' });
    expect(s.deck.length + s.discard.length).toBe(18);
    let t = withPlayers(game(2), [{ node: 4 }]);
    t = { ...t, discard: [...t.deck], deck: [] };
    const rngBefore = t.rng;
    t = act(act(choosing(t, [1, 1]), { type: 'select', dest: 5 }), { type: 'confirmMove' });
    expect(t.deck.length).toBe(17);
    expect(t.discard.length).toBe(1);
    expect(t.rng).not.toBe(rngBefore);
  });
});

describe('previews', () => {
  it('match committed resolution when no event intervenes, without mutating or consuming RNG', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let s = withPlayers(game(3, seed), [{ node: 0 }, { node: 22, carried: 4 }, { node: 17, carried: 2 }]);
      s = act(s, { type: 'roll' });
      for (const moveDie of [0, 1] as const) {
        for (const dest of [...legalRoutes(s, moveDie).keys(), 'stay' as const]) {
          const frozen = JSON.stringify(s);
          const p = previewMove(s, moveDie, dest)!;
          expect(JSON.stringify(s)).toBe(frozen);
          if (p.provisional) continue;
          let c = act(s, { type: 'select', moveDie, dest });
          c = act(c, { type: 'confirmMove' });
          const plan = currentGhostPlan(c)!;
          expect(plan).toEqual(p.ghost);
          expect(c.players[0].carried).toBe(p.carriedAfter);
          expect(c.rng).toBe(s.rng);
        }
      }
    }
  });

  it('labels event destinations provisional', () => {
    let s = withPlayers(game(2), [{ node: 4 }]);
    s = choosing(s, [1, 3]);
    expect(previewMove(s, 0, 5)!.provisional).toBe(true);
    expect(previewMove(s, 0, 3)!.provisional).toBe(false);
  });
});

describe('rounds and scoring', () => {
  function playThrough(n: number, seed: number) {
    let session = newSession(game(n, seed));
    const turns = new Array(n).fill(0);
    let midnightAt: number | null = null;
    let sweet = 0;
    let steps = 0;
    while (session.game.phase !== 'gameOver' && steps++ < 5000) {
      const g = session.game;
      let action: Action;
      switch (g.phase) {
        case 'turnStart':
          turns[g.turn]++;
          action = { type: 'roll' };
          break;
        case 'choose': {
          const routes = [...legalRoutes(g, 1).keys()];
          const dest = routes.length ? routes[routes.length - 1] : 'stay';
          session = dispatch(session, { type: 'select', moveDie: 1, dest }).session;
          action = { type: 'confirmMove' };
          break;
        }
        case 'event':
          action = g.event!.canDecline ? { type: 'eventDecline' } : { type: 'eventChoose', option: g.event!.options[0] };
          break;
        case 'ghost':
          action = { type: 'moveGhost' };
          break;
        default:
          action = { type: 'nextTurn' };
      }
      const r = dispatch(session, action);
      if (r.error) throw new Error(r.error);
      if (r.events.some((e) => e.kind === 'midnight')) midnightAt = r.session.game.round;
      for (const e of r.events) if (e.kind === 'gain') sweet += e.amount;
      session = r.session;
    }
    return { session, turns, midnightAt, sweet };
  }

  it('gives every player exactly ten turns and warns once entering round 8', () => {
    for (const n of [2, 6]) {
      const { session, turns, midnightAt } = playThrough(n, 99 + n);
      expect(session.game.phase).toBe('gameOver');
      expect(turns).toEqual(new Array(n).fill(10));
      expect(midnightAt).toBe(8);
      expect(session.game.round).toBe(10);
    }
  });

  it('conserves candy through a whole game', () => {
    const { session, sweet } = playThrough(4, 7);
    const g = session.game;
    const initial = Object.values(ROOMS).reduce((a, r) => a + r.stock, 0);
    const inRooms = g.stocks.reduce((a, b) => a + b, 0);
    const piles = g.piles.reduce((a, b) => a + b, 0);
    const players = g.players.reduce((a, p) => a + p.carried + p.banked, 0);
    // Candy only enters play from room stocks and Sweet Discovery; nothing is created or lost.
    expect(players + piles).toBe(initial - inRooms + sweet);
    expect(initial - inRooms).toBeGreaterThan(0);
  });

  it('scores banked + floor(carried/2) and shares ties', () => {
    const s = withPlayers(game(3), [{ banked: 10, carried: 3 }, { banked: 11, carried: 0 }, { banked: 5, carried: 1 }]);
    const scores = finalScores(s);
    expect(scores.map((l) => [l.player, l.total, l.rank, l.winner])).toEqual([
      [0, 11, 1, true],
      [1, 11, 1, true],
      [2, 5, 3, false],
    ]);
    expect(scores[0].carriedHalf).toBe(1);
  });
});

describe('undo and saves', () => {
  it('restores the whole turn and replays the same dice and draws', () => {
    let session: Session = newSession(withPlayers(game(2, 555), [{ node: 4 }]));
    session = { ...session, turnStart: session.game };
    const r1 = dispatch(session, { type: 'roll' });
    const dice1 = r1.session.game.dice;
    expect(undoInfo(r1.session)).toMatchObject({ available: true, which: 'current', playerName: 'P1' });
    const back = undo(r1.session);
    expect(back.game).toEqual(session.game);
    const r2 = dispatch(back, { type: 'roll' });
    expect(r2.session.game.dice).toEqual(dice1);
  });

  it('can undo the just-finished turn before the next player acts, only once', () => {
    let session = newSession(game(2, 3));
    for (const a of [{ type: 'roll' }, { type: 'select', dest: 'stay' }, { type: 'confirmMove' }, { type: 'moveGhost' }, { type: 'nextTurn' }] as Action[]) {
      session = dispatch(session, a).session;
    }
    expect(session.game.turn).toBe(1);
    const info = undoInfo(session);
    expect(info).toMatchObject({ which: 'previous', playerName: 'P1', round: 1 });
    const back = undo(session);
    expect(back.game.turn).toBe(0);
    expect(back.game.phase).toBe('turnStart');
    expect(undoInfo(back).available).toBe(false);
  });

  it('round-trips a mid-event save without duplicating effects or rerolling', () => {
    let s = withPlayers(game(2, 77), [{ node: 4, carried: 3 }, { node: 6, carried: 2 }]);
    s = stackDeck(s, 'stickyFingers');
    let session = newSession(s);
    session = dispatch(session, { type: 'roll' }).session;
    session = { ...session, game: { ...session.game, dice: [1, 1] } };
    session = dispatch(session, { type: 'select', dest: 5 }).session;
    session = dispatch(session, { type: 'confirmMove' }).session;
    expect(session.game.phase).toBe('event');
    const raw = serialize(session, defaultPersonalization());
    const loaded = deserialize(raw);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session).toEqual(session);
    const done = dispatch(loaded.session, { type: 'eventChoose', option: 1 }).session;
    expect(done.game.players[0].carried).toBe(5);
    expect(dispatch(done, { type: 'eventChoose', option: 1 }).error).toBeTruthy();
  });

  it('rejects corrupt and incompatible saves', () => {
    expect(deserialize(null)).toEqual({ ok: false, reason: 'missing' });
    expect(deserialize('{nope')).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize(JSON.stringify({ schema: 99 }))).toEqual({ ok: false, reason: 'incompatible' });
    expect(deserialize(JSON.stringify({ schema: 1, session: { game: { schema: 1 } } }))).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('cleans custom text and keeps defaults', () => {
    expect(cleanText('  <b>Hi</b>\n there ', 10, 'x')).toBe('<b>Hi</b>');
    expect(cleanText('', 10, 'x')).toBe('x');
    const p = sanitizePersonalization({ mansionName: 'A'.repeat(99), roomNames: { 3: 'Pantry' }, flavors: { flyingCandy: 'Whee' } });
    expect(p.mansionName.length).toBe(28);
    expect(p.roomNames[3]).toBe('Pantry');
    expect(p.roomNames[7]).toBe('Dining Room');
    expect(p.flavors).toEqual({ flyingCandy: 'Whee' });
  });
});

describe('entrance', () => {
  it('is node 0', () => expect(ENTRANCE).toBe(0));
});
