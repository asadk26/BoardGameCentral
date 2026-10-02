import { describe, expect, it } from 'vitest';
import { CHALLENGE, CHARACTERS, curseMultiplier, ENTRANCE, GHOST_SPAWNS, ROUNDS, SUPER_REAPER, TRAP_ELIGIBLE, trapEligible } from '../src/engine/config';
import { exactReach, exitsFrom, inAttackRange, ORDINARY_ADJ, ordinaryDistance, SECRET_ADJ, WALL_ADJ } from '../src/engine/graph';
import {
  activeController,
  apply,
  buildSchedule,
  canHunt,
  completedRounds,
  createGame,
  dispatch,
  finalScores,
  moveExits,
  moveLandings,
  newSession,
  previewMove,
  retreatNode,
  undo,
  undoInfo,
} from '../src/engine/engine';
import { airTime, judgeRope, ropeSchedule } from '../src/engine/challenges';
import { publicView, seatView } from '../src/engine/view';
import { defaultPersonalization, deserialize, serialize } from '../src/engine/save';
import { simulateGame } from '../src/engine/sim';
import { botAction, defaultBotProfile, newBotMemory } from '../src/engine/bots';
import type { GameState } from '../src/engine/types';
import { act, aliveCount, DEFAULT_TRAPS, game, jumps, living, move, resolve, rolled, setup, skipMove, walk } from './helpers';

describe('setup: the life roll and spawns', () => {
  it('the highest roll starts alive; only tied leaders reroll; ghosts spawn apart', () => {
    for (let seed = 1; seed < 200; seed++) {
      for (const n of [2, 3, 4]) {
        const r = apply(game(n, seed), { type: 'rollForLife' });
        const s = r.state;
        const ev = r.events.find((e) => e.kind === 'lifeRoll')!;
        if (ev.kind !== 'lifeRoll') throw new Error();
        expect(aliveCount(s)).toBe(1);
        expect(living(s)).toBe(ev.winner);
        // Each reroll row only contains the previous row's tied leaders.
        for (let k = 1; k < ev.rolls.length; k++) {
          const prev = ev.rolls[k - 1];
          const top = Math.max(...prev.filter((x): x is number => x !== null));
          ev.rolls[k].forEach((v, i) => expect(v !== null).toBe(prev[i] === top));
        }
        const last = ev.rolls[ev.rolls.length - 1];
        expect(last[ev.winner]).toBe(Math.max(...last.filter((x): x is number => x !== null)));
        expect(last.filter((v) => v === last[ev.winner]).length).toBe(1);
        expect(s.pieces[ev.winner].node).toBe(ENTRANCE);
        const ghostNodes = s.pieces.filter((p) => !p.alive).map((p) => p.node);
        expect(new Set(ghostNodes).size).toBe(ghostNodes.length);
        ghostNodes.forEach((g) => expect(GHOST_SPAWNS).toContain(g));
        expect(s.pieces.every((p) => p.score === 0)).toBe(true);
        expect(s.phase).toBe('turnStart');
        expect(s.schedule[0]).toBe(ev.winner);
      }
    }
  });

  it('ghost spawns are assigned independently of seat order', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const s = act(game(4, seed), { type: 'rollForLife' });
      seen.add(s.pieces.map((p) => p.node).join(','));
    }
    expect(seen.size).toBeGreaterThan(6);
  });
});

describe('schedules: every piece acts exactly once per round', () => {
  it('living first, then hunters from a seat that advances each round', () => {
    const base = setup(4, { living: 2, nodes: [8, 16, 0, 24] });
    const orders = [1, 2, 3, 4, 5].map((round) => buildSchedule({ ...base, round }));
    expect(orders[0]).toEqual([2, 0, 1, 3]);
    expect(orders[1]).toEqual([2, 1, 3, 0]);
    expect(orders[2]).toEqual([2, 3, 0, 1]);
    expect(orders[3]).toEqual([2, 3, 0, 1]); // offset 3: seats 3,0,1,(2 is alive)
    expect(orders[4]).toEqual([2, 0, 1, 3]);
    for (const o of orders) expect(new Set(o).size).toBe(4);
    // The last hunter slot rotates between seats.
    expect(new Set(orders.map((o) => o[3])).size).toBeGreaterThan(1);
  });

  it('the worked example: A moves, B steals, C steals back, D steals last and scores; A gets no bonus turn', () => {
    // A=0 alive at the entrance; B, C, D hunt in seat order in round 1.
    let s = setup(4, { living: 0, nodes: [0, 2, 5, 20] });
    expect(s.schedule).toEqual([0, 1, 2, 3]);
    s = skipMove(s);
    s = act(s, { type: 'nextTurn' });
    // B: to 1, next to A, and challenges.
    s = move(s, 1, 1);
    expect(s.phase).toBe('hunt');
    s = act(s, { type: 'hunt' });
    s = resolve(s, { 1: 8, 0: 2 });
    expect(living(s)).toBe(1);
    expect(s.pieces[1].node).toBe(0); // the thief takes the defender's space
    expect(ordinaryDistance(0, s.pieces[0].node)).toBe(2); // the loser retreats two steps
    expect(s.phase).toBe('summary'); // one minigame per action: no chain
    s = act(s, { type: 'nextTurn' });
    expect(s.schedule[s.slot]).toBe(2); // C, not A
    s = move(s, 1, 4);
    s = act(s, { type: 'hunt' });
    s = resolve(s, { 2: 7, 1: 3 });
    expect(living(s)).toBe(2);
    s = act(s, { type: 'nextTurn' });
    expect(s.schedule[s.slot]).toBe(3);
    // D walks past the Poltergeist on 30 (passing is safe) to 31, then challenges C.
    s = move(s, 31, 4);
    expect(s.traps.find((t) => t.node === 30)!.revealed).toBe(false);
    s = act(s, { type: 'hunt' });
    s = resolve(s, { 3: 8, 2: 1 });
    expect(living(s)).toBe(3);
    // Forced retreats never trigger or reveal anything.
    expect(s.traps.every((t) => !t.revealed)).toBe(true);
    s = act(s, { type: 'nextTurn' });
    // The bell: D scores the round; the next round begins with D.
    expect(s.pieces.map((p) => p.score)).toEqual([0, 0, 0, 1]);
    expect(s.round).toBe(2);
    expect(s.schedule[0]).toBe(3);
    expect(s.schedule.length).toBe(4);
    expect(new Set(s.pieces.map((p) => p.node)).size).toBe(4);
  });

  it('a pending piece that wins life in a Séance takes its scheduled action as the living piece', () => {
    // Round 1: 0 alive; 1 lands on the Séance tile 14 and wins; 2 still acts — now as a ghost.
    let s = setup(3, { living: 0, nodes: [0, 13, 18] });
    s = skipMove(s);
    s = act(s, { type: 'nextTurn' });
    s = move(s, 14, 1);
    expect(s.challenge?.kind).toBe('seance');
    s = resolve(s, { 0: 1, 1: 2, 2: 8 });
    expect(living(s)).toBe(2);
    s = act(s, { type: 'nextTurn' });
    expect(s.schedule[s.slot]).toBe(2);
    s = act(s, { type: 'roll' });
    expect(s.allowance).toBe(s.die); // living allowance: the roll itself
  });
});

describe('scoring', () => {
  it('exactly one point per completed round; scores never decrease; the game ends after round 10', () => {
    for (let seed = 1; seed < 30; seed++) {
      const r = simulateGame({ seed, profiles: [0, 1, 2].map(defaultBotProfile) });
      const g = r.session.game;
      expect(g.phase).toBe('gameOver');
      expect(g.pieces.reduce((a, p) => a + p.score, 0)).toBe(ROUNDS);
      expect(completedRounds(g)).toBe(ROUNDS);
      expect(r.stats.roundScorers.length).toBe(ROUNDS);
    }
  });

  it('tied top scores share the win without overtime', () => {
    const s = setup(3, { living: 0, nodes: [0, 8, 16] });
    const g: GameState = { ...s, phase: 'gameOver', round: 10, pieces: s.pieces.map((p, i) => ({ ...p, score: [4, 4, 2][i] })) };
    const lines = finalScores(g);
    expect(lines.filter((l) => l.winner).map((l) => l.piece)).toEqual([0, 1]);
    expect(lines.find((l) => l.piece === 2)!.rank).toBe(3);
  });
});

describe('survival streak and the curse', () => {
  it('curse tiers are capped at 0.7', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(curseMultiplier)).toEqual([1, 1, 0.9, 0.8, 0.7, 0.7, 0.7]);
  });

  it('the curse is frozen into the challenge and only for the living piece', () => {
    let s = setup(2, { living: 0, nodes: [5, 6], acting: 1, streaks: [3, 0] });
    s = skipMove(s);
    s = act(s, { type: 'hunt' });
    expect(s.challenge!.multipliers).toEqual([0.8, 1]);
    s = resolve(s, { 0: 8, 1: 2 });
    // A successful defence keeps (and does not add to) the streak.
    expect(s.pieces[0].streak).toBe(3);
  });

  it('losing life resets the streak at once; reclaiming it in the same round starts from zero', () => {
    let s = setup(3, { living: 0, nodes: [5, 6, 30], acting: 1, streaks: [4, 0, 0] });
    s = skipMove(s);
    s = act(s, { type: 'hunt' });
    s = resolve(s, { 0: 1, 1: 8 });
    expect(s.pieces[0].streak).toBe(0);
    expect(living(s)).toBe(1);
    // Piece 2 lands on Séance tile 26 and piece 0 wins it back.
    s = act(s, { type: 'nextTurn' });
    s = move(s, 26, 4);
    expect(s.challenge!.kind).toBe('seance');
    s = resolve(s, { 0: 8, 1: 3, 2: 2 });
    expect(living(s)).toBe(0);
    expect(s.pieces[0].streak).toBe(0);
    expect(s.pieces[1].streak).toBe(0);
  });

  it('the curse means shorter, lower jumps: a jump timed for a full hop lands too soon when cursed', () => {
    const seed = 424242;
    const sch = ropeSchedule(seed);
    const at = (lead: number) => sch.bottoms.slice(0, 8).map((b) => ({ t: b - lead }));
    // Take-off 440 ms before the rope: a full jump (540 ms) is still high; a 0.7 jump (378 ms) has already landed.
    expect(judgeRope(seed, [0, 1], [at(440), at(440)], [1, 0.7]).scores).toEqual([8, 0]);
    expect(judgeRope(seed, [0, 1], [at(440), at(440)], [0.7, 1]).scores).toEqual([0, 8]);
    // A jump centred on the rope clears at every tier.
    for (const m of [1, 0.9, 0.8, 0.7]) expect(judgeRope(seed, [0], [at(airTime(m) / 2)], [m]).scores).toEqual([8]);
  });

  it('streak increments at the bell for the holder only', () => {
    let s = setup(2, { living: 0, nodes: [0, 16] });
    s = skipMove(s);
    s = act(s, { type: 'nextTurn' });
    s = skipMove(s);
    if (s.phase === 'hunt') s = act(s, { type: 'declineHunt' });
    s = act(s, { type: 'nextTurn' });
    expect(s.pieces[0].score).toBe(1);
    expect(s.pieces[0].streak).toBe(1);
    expect(s.pieces[1].streak).toBe(0);
  });
});

describe('movement and catches', () => {
  it('everyone moves exactly the roll: a 1 is one space, a 2 two, living or ghost', () => {
    const g = rolled(setup(2, { living: 0, nodes: [0, 16], acting: 1 }), 1);
    expect(g.allowance).toBe(1);
    expect(moveLandings(g)).toEqual([15, 17]);
    const l = rolled(setup(2, { living: 0, nodes: [0, 16] }), 1);
    expect(moveLandings(l)).toEqual([1, 31]);
    // No stopping short: a 3 from the entrance never ends one or two spaces away, nor where it began.
    const three = moveLandings(rolled(setup(2, { living: 0, nodes: [0, 16] }), 3));
    expect(three).toEqual([3, 29]);
    for (const n of three) expect(ordinaryDistance(0, n)).toBe(3);
  });

  it('pauses only at forks; straight corridors walk on by themselves; the move ends exactly on the roll', () => {
    // Living piece on 0 rolls 5 and heads for 1: it walks 1→2→3→4 alone and stops at the fork on 4 (to 5 or across to 12).
    let s = rolled(setup(2, { living: 0, nodes: [0, 16] }), 5);
    expect(moveExits(s).map((e) => e.to)).toEqual([1, 31]); // the start always offers its directions
    s = act(s, { type: 'step', at: 0, left: 5, to: 1 });
    expect(s.phase).toBe('choose');
    expect(s.pieces[0].node).toBe(4);
    expect(s.move!.remaining).toBe(1);
    expect(moveExits(s).map((e) => e.to)).toEqual([5, 12]);
    expect(s.log.filter((e) => e.kind === 'move').map((e) => (e.kind === 'move' ? e.path : []))).toEqual([[0, 1, 2, 3, 4]]);
    s = act(s, { type: 'step', at: 4, left: 1, to: 12 });
    expect(s.pieces[0].node).toBe(12);
    expect(s.move).toBeNull();
    expect(s.phase).not.toBe('choose');
  });

  it('never turns straight back along the edge it just used (the board has no dead ends, so this never locks)', () => {
    for (let n = 0; n < 32; n++) {
      for (const prev of [...ORDINARY_ADJ[n], ...SECRET_ADJ[n], ...WALL_ADJ[n]]) {
        for (const ghost of [true, false]) {
          const ex = exitsFrom(n, prev, false, ghost);
          expect(ex.length).toBeGreaterThan(0);
          if (ORDINARY_ADJ[n].length + (ghost ? WALL_ADJ[n].length : 0) + SECRET_ADJ[n].length > 1) expect(ex.some((e) => e.to === prev)).toBe(false);
        }
      }
    }
    // Loops are fine: a long roll can come round a corridor loop.
    expect(exactReach(4, 6, false).length).toBeGreaterThan(0);
  });

  it('a stale or repeated step is refused and moves nothing', () => {
    const s = rolled(setup(2, { living: 0, nodes: [0, 16] }), 5);
    const t = act(s, { type: 'step', at: 0, left: 5, to: 1 });
    // The same tap again (the piece is now on 4 with 1 left) does nothing.
    expect(apply(t, { type: 'step', at: 0, left: 5, to: 1 }).error).toBe('stale');
    expect(apply(t, { type: 'step', at: 4, left: 1, to: 3 }).error).toBeDefined(); // straight back is closed
    expect(apply(s, { type: 'step', at: 0, left: 5, to: 2 }).error).toBeDefined(); // not adjacent
  });

  it('only ghosts use the wall links; everyone may use one secret passage per move', () => {
    expect(exitsFrom(7, null, false, true).some((e) => e.to === 10 && e.kind === 'w')).toBe(true);
    expect(exitsFrom(7, null, false, false).some((e) => e.to === 10)).toBe(false);
    expect(exitsFrom(8, null, false, false).some((e) => e.to === 24 && e.kind === 's')).toBe(true);
    // After a passage, no second one in the same move.
    expect(exitsFrom(27, 28, true, true).some((e) => e.kind === 's')).toBe(false);
    let s = rolled(setup(2, { living: 0, nodes: [0, 8], acting: 1 }), 4);
    s = act(s, { type: 'step', at: 8, left: 4, to: 24 });
    expect(s.move!.usedSecret).toBe(true);
    expect(moveExits(s).some((e) => e.kind === 's')).toBe(false);
  });

  it('passing over a trap never triggers it; only the landing counts', () => {
    // Ghost on 28 rolls 3 to 31, straight over the hidden Poltergeist on 30.
    const s = move(setup(2, { living: 0, nodes: [0, 28], acting: 1 }), 31, 3);
    expect(s.pieces[1].node).toBe(31);
    expect(s.traps.find((t) => t.node === 30)!.revealed).toBe(false);
  });

  it('pieces never block and the entrance is an ordinary space for ghosts', () => {
    const s = rolled(setup(3, { living: 0, nodes: [1, 2, 3], acting: 1 }), 2);
    expect(moveLandings(s)).toContain(0); // a ghost may enter the entrance
    expect(moveLandings(s)).toContain(4); // straight past the piece on 3
    const t = move(setup(3, { living: 0, nodes: [0, 2, 3], acting: 1 }), 1, 1);
    expect(t.phase).toBe('hunt'); // no camping safety at the entrance
  });

  it('attack range is one ordinary edge — not through a wall link or a secret passage', () => {
    expect(inAttackRange(5, 6)).toBe(true);
    expect(inAttackRange(6, 6)).toBe(true);
    expect(inAttackRange(7, 10)).toBe(false); // wall link
    expect(inAttackRange(8, 24)).toBe(false); // secret passage
    expect(canHunt(setup(2, { living: 0, nodes: [10, 7], acting: 1 }), 1)).toBe(false);
    expect(canHunt(setup(2, { living: 0, nodes: [24, 8], acting: 1 }), 1)).toBe(false);
    // A ghost already in range may stay and challenge.
    const s = move(setup(2, { living: 0, nodes: [6, 3], acting: 1 }), 5, 2);
    expect(s.phase).toBe('hunt');
    // The living piece cannot start a catch by walking up to a ghost.
    const l = move(setup(2, { living: 0, nodes: [4, 6] }), 5, 1);
    expect(l.phase).toBe('summary');
  });

  it('the loser retreats two ordinary steps, preferring its own starting space, then the lowest id', () => {
    // Ghost starts on 8 (two steps from 6), steps to 7, challenges on 6 and loses: back to 8.
    let s = setup(2, { living: 0, nodes: [6, 8], acting: 1 });
    s = move(s, 7, 1);
    s = act(s, { type: 'hunt' });
    s = resolve(s, { 0: 8, 1: 1 });
    expect(s.pieces[1].node).toBe(8);
    expect(s.pieces[0].node).toBe(6);
    // A ghost from further away that loses goes to the lowest-id space two steps out (4).
    let t = setup(2, { living: 0, nodes: [6, 2], acting: 1 });
    t = move(t, 5, 3);
    t = act(t, { type: 'hunt' });
    t = resolve(t, { 0: 8, 1: 0 });
    expect(t.pieces[1].node).toBe(4);
  });

  it('retreat falls back to the nearest free space when every two-step space is taken', () => {
    const s = setup(4, { living: 0, nodes: [6, 4, 8, 5], acting: 3 });
    expect(retreatNode(s, 0, 6, null)).toBe(7);
  });
});

describe('traps', () => {
  it('2–4 nominations, duplicates included, always become exactly six hidden traps with two of each effect', () => {
    for (let seed = 1; seed < 80; seed++) {
      for (const n of [2, 3, 4]) {
        let s = createGame({ pieces: Array.from({ length: n }, (_, i) => ({ character: CHARACTERS[i].id, controllers: [`p${i}`] })), seed });
        for (let i = 0; i < n; i++) s = act(s, { type: 'nominate', piece: i, node: seed % 2 ? 14 : TRAP_ELIGIBLE[(seed + i) % TRAP_ELIGIBLE.length] });
        expect(s.phase).toBe('lifeRoll');
        expect(new Set(s.traps.map((t) => t.node)).size).toBe(6);
        expect(s.traps.every((t) => trapEligible(t.node) && !t.revealed)).toBe(true);
        const counts = { reaper: 0, seance: 0, poltergeist: 0 };
        for (const t of s.traps) counts[t.effect]++;
        expect(counts).toEqual({ reaper: 2, seance: 2, poltergeist: 2 });
        for (const node of s.nominations) expect(s.traps.some((t) => t.node === node)).toBe(true);
      }
    }
  });

  it('spawns, the entrance, its neighbours, shortcut ends, rooms and the Super Reaper are never eligible', () => {
    for (const n of [0, 1, 31, 8, 16, 24, 11, 27, 7, 10, 22, 25, 3, 15, 17, 29, SUPER_REAPER]) expect(trapEligible(n)).toBe(false);
    expect(TRAP_ELIGIBLE.length).toBeGreaterThanOrEqual(6);
  });

  it('player-chosen and computer-filled traps draw effects the same way', () => {
    const effectsOfNominated = { reaper: 0, seance: 0, poltergeist: 0 };
    for (let seed = 1; seed < 600; seed++) {
      let s = createGame({ pieces: [0, 1].map((i) => ({ character: CHARACTERS[i].id, controllers: [`p${i}`] })), seed });
      s = act(s, { type: 'nominate', piece: 0, node: 2 });
      s = act(s, { type: 'nominate', piece: 1, node: 30 });
      effectsOfNominated[s.traps.find((t) => t.node === 2)!.effect]++;
    }
    for (const v of Object.values(effectsOfNominated)) expect(v / 599).toBeGreaterThan(0.26);
  });

  it('a ghost landing on a Reaper challenges the living piece from anywhere; nobody moves', () => {
    let s = setup(2, { living: 0, nodes: [30, 6], acting: 1 });
    s = move(s, 9, 3);
    expect(s.traps.find((t) => t.node === 9)!.revealed).toBe(true);
    expect(s.challenge).toMatchObject({ kind: 'duel', host: 'reaper', contact: false, participants: [0, 1] });
    s = resolve(s, { 1: 8, 0: 0 });
    expect(living(s)).toBe(1);
    expect(s.pieces.map((p) => p.node)).toEqual([30, 9]);
    expect(s.phase).toBe('summary');
  });

  it('the living piece on a Reaper picks its ghost opponent; the tile stays active; staying never retriggers', () => {
    let s = setup(3, { living: 0, nodes: [6, 16, 24] });
    s = move(s, 9, 3);
    expect(s.phase).toBe('pick');
    expect(s.pick!.options).toEqual([1, 2]);
    s = act(s, { type: 'pickOpponent', option: 2 });
    expect(s.challenge!.participants).toEqual([0, 2]);
    s = resolve(s, { 0: 8 });
    expect(living(s)).toBe(0);
    // Next round, staying on the tile does nothing.
    let t = setup(3, { living: 0, nodes: [9, 16, 24], traps: DEFAULT_TRAPS.map((x) => ({ ...x })) });
    t = { ...t, traps: t.traps.map((x) => (x.node === 9 ? { ...x, revealed: true } : x)) };
    t = skipMove(t);
    expect(t.phase).toBe('summary');
    // A ghost landing there later still triggers it.
    let u = setup(2, { living: 0, nodes: [0, 6], acting: 1 });
    u = { ...u, traps: u.traps.map((x) => (x.node === 9 ? { ...x, revealed: true } : x)) };
    u = move(u, 9, 3);
    expect(u.challenge?.host).toBe('reaper');
  });

  it('a Séance involves every piece, keeps positions, is single-use, and shares the global limit with the Super Reaper', () => {
    let s = setup(4, { living: 0, nodes: [0, 13, 25, 20], acting: 1 });
    s = move(s, 14, 1);
    expect(s.challenge).toMatchObject({ kind: 'seance', participants: [0, 1, 2, 3] });
    s = resolve(s, { 3: 8 });
    expect(living(s)).toBe(3);
    expect(s.pieces.map((p) => p.node)).toEqual([0, 14, 25, 20]);
    expect(s.traps.find((t) => t.node === 14)).toMatchObject({ revealed: true, spent: true });
    expect(s.seancesUsed).toBe(1);
    // The Super Reaper uses the second Séance …
    let t = { ...setup(4, { living: 0, nodes: [0, 4, 25, 20], acting: 1 }), seancesUsed: 1 };
    t = move(t, SUPER_REAPER, 1);
    expect(t.challenge?.kind).toBe('seance');
    expect(t.seancesUsed).toBe(2);
    // … after which the other Séance tile is revealed dormant, and a ghost may still hunt.
    let u = { ...setup(3, { living: 0, nodes: [27, 30, 16], acting: 1 }), seancesUsed: 2 };
    u = move(u, 26, 4);
    expect(u.challenge).toBeNull();
    expect(u.traps.find((x) => x.node === 26)).toMatchObject({ revealed: true, spent: true });
    expect(u.log.some((e) => e.kind === 'seanceDormant')).toBe(true);
    expect(u.phase).toBe('hunt');
  });

  it('the Super Reaper becomes a remote Reaper’s Challenge once both Séances are used, and previews say so', () => {
    const before = rolled(setup(2, { living: 0, nodes: [0, 4], acting: 1 }), 1);
    expect(moveLandings(before)).toContain(SUPER_REAPER);
    expect(previewMove(before, SUPER_REAPER)!.superReaper).toBe('seance');
    const after = { ...before, seancesUsed: 2 };
    expect(previewMove(after, SUPER_REAPER)!.superReaper).toBe('reaper');
    let s = walk(after, SUPER_REAPER);
    expect(s.challenge).toMatchObject({ kind: 'duel', host: 'superReaper', contact: false });
    s = resolve(s, { 1: 8 });
    expect(living(s)).toBe(1);
    expect(s.pieces[1].node).toBe(SUPER_REAPER);
  });

  it('a Poltergeist throws the piece three or more steps to a free space, never the entrance; then a ghost may hunt', () => {
    for (let seed = 1; seed < 60; seed++) {
      let s = setup(3, { living: 0, nodes: [18, 21, 3], acting: 1, seed });
      s = move(s, 19, 3);
      const p = s.pieces[1];
      expect(s.traps.find((t) => t.node === 19)!.revealed).toBe(true);
      expect(p.node).not.toBe(ENTRANCE);
      expect(ordinaryDistance(19, p.node)).toBeGreaterThanOrEqual(3);
      expect([18, 3]).not.toContain(p.node);
      expect(p.alive).toBe(false);
      expect(s.challenge).toBeNull();
      expect(s.phase).toBe(inAttackRange(p.node, 18) ? 'hunt' : 'summary');
      // Where it landed never triggers anything.
      expect(s.traps.filter((t) => t.revealed).map((t) => t.node)).toEqual([19]);
    }
  });

  it('one minigame per action: a trap minigame ends the action even if the living piece is adjacent', () => {
    let s = setup(2, { living: 0, nodes: [10, 8], acting: 1 });
    s = move(s, 9, 1);
    expect(s.challenge?.host).toBe('reaper');
    s = resolve(s, { 0: 8 });
    expect(s.phase).toBe('summary');
    expect(apply(s, { type: 'hunt' }).error).toBeTruthy();
  });
});

describe('challenges: judging, tiebreaks and idempotence', () => {
  it('ties go to sudden death among tied leaders only, then timing error, then an announced seeded verdict', () => {
    let s = setup(4, { living: 0, nodes: [0, 13, 25, 20], acting: 1 });
    s = move(s, 14, 1);
    const ch = s.challenge!;
    // 0 and 1 tie on 6; 1 clears the first sudden-death sweep; 2 and 3 are spectators.
    const inputs = { 0: jumps(ch, 6), 1: jumps(ch, 6, 1), 2: jumps(ch, 5, 4), 3: [] };
    const r = act(s, { type: 'challengeResult', id: ch.id, inputs });
    expect(r.lastOutcome).toMatchObject({ winner: 1, decidedBy: 'suddenDeath', finalists: [0, 1], extraSweepsUsed: 1 });
    // Perfectly identical jumpers: the Reaper's verdict, still exactly one winner.
    const same = act(s, { type: 'challengeResult', id: ch.id, inputs: { 0: jumps(ch, 8, 4), 1: jumps(ch, 8, 4), 2: jumps(ch, 8, 4), 3: jumps(ch, 8, 4) } });
    expect(same.lastOutcome!.decidedBy).toBe('verdict');
    expect(aliveCount(same)).toBe(1);
    // Timing error breaks a tie that sudden death could not.
    const sch = ropeSchedule(ch.seed);
    const sloppy = sch.bottoms.map((b) => ({ t: b - CHALLENGE.rope.airMs / 2 - 60 })); // every sweep cleared, 60 ms off centre
    const timed = act(s, { type: 'challengeResult', id: ch.id, inputs: { 0: jumps(ch, 8, 4), 1: sloppy, 2: [], 3: [] } });
    expect(timed.lastOutcome).toMatchObject({ winner: 0, decidedBy: 'timing' });
  });

  it('the shared rope speeds up every sweep, but every gap leaves time to land and jump again', () => {
    const c = CHALLENGE.rope;
    for (let seed = 1; seed < 400; seed++) {
      const b = ropeSchedule(seed).bottoms;
      expect(b.length).toBe(c.sweeps + c.extraSweeps);
      for (let i = 1; i < b.length; i++) expect(b[i] - b[i - 1]).toBeGreaterThan(c.airMs + c.groundMs);
    }
    // Averaged over seeds, each gap in the scored sweeps is shorter than the one before.
    const avgGap = (i: number) => {
      let s = 0;
      for (let seed = 1; seed < 400; seed++) {
        const b = ropeSchedule(seed).bottoms;
        s += b[i] - b[i - 1];
      }
      return s / 399;
    };
    for (let i = 2; i < c.sweeps; i++) expect(avgGap(i)).toBeLessThan(avgGap(i - 1));
    expect(avgGap(c.sweeps)).toBeLessThan(avgGap(1) * 0.7);
  });

  it('a result for a finished challenge is rejected, so nothing resolves twice', () => {
    let s = move(setup(2, { living: 0, nodes: [5, 8], acting: 1 }), 6, 2);
    s = act(s, { type: 'hunt' });
    const id = s.challenge!.id;
    const r = resolve(s, { 1: 8 });
    expect(apply(r, { type: 'challengeResult', id, inputs: {} }).error).toBeTruthy();
    expect(r.pieces.reduce((a, p) => a + p.score, 0)).toBe(0);
  });
});

describe('hidden information', () => {
  it('public views hold revealed traps only, and no RNG or nominations', () => {
    let s = createGame({ pieces: [0, 1, 2].map((i) => ({ character: CHARACTERS[i].id, controllers: [`p${i}`] })), seed: 7 });
    s = act(s, { type: 'nominate', piece: 0, node: 14 });
    const mid = publicView(s);
    expect(mid.nominations).toEqual([-1, null, null]);
    s = act(act(s, { type: 'nominate', piece: 1, node: 19 }), { type: 'nominate', piece: 2, node: 30 });
    const v = publicView(s);
    expect(v.traps).toEqual([]);
    expect(v.rng).toBe(0);
    expect(v.seed).toBe(0);
    expect(v.challengeRng).toBe(0);
    expect(seatView(s, 1).ownNomination).toBe(19);
    expect(JSON.stringify(v)).not.toMatch(/"effect"/);
  });

  it('routes and previews are identical whatever the hidden traps are', () => {
    const a = rolled(setup(3, { living: 0, nodes: [0, 16, 24], acting: 1, traps: DEFAULT_TRAPS }), 6);
    const otherTraps = [2, 4, 13, 18, 20, 28].map((node, k) => ({
      node,
      effect: DEFAULT_TRAPS[k].effect,
    }));
    const b = rolled(setup(3, { living: 0, nodes: [0, 16, 24], acting: 1, traps: otherTraps }), 6);
    expect(moveExits(a)).toEqual(moveExits(b));
    expect(moveLandings(a)).toEqual(moveLandings(b));
    for (const d of moveLandings(a)) expect(previewMove(a, d)).toEqual(previewMove(b, d));
  });

  it('bots decide from seat views; the same view gives the same decision', () => {
    const s = rolled(setup(3, { living: 0, nodes: [0, 16, 24], acting: 1 }), 5);
    const m1 = newBotMemory(5);
    const m2 = newBotMemory(5);
    expect(botAction(seatView(s, 1), defaultBotProfile(1), m1)).toEqual(botAction(seatView({ ...s, traps: [] as GameState['traps'] } as GameState, 1), defaultBotProfile(1), m2));
  });
});

describe('undo, saves and controllers', () => {
  it('undo restores the action start with the same die and keeps the table’s memory of reveals', () => {
    // A table whose first roll is a 1, so the living piece on 29 can step onto the hidden Poltergeist on 30.
    let seed = 1;
    while (act(setup(2, { living: 0, nodes: [29, 16], seed }), { type: 'roll' }).die !== 1) seed++;
    const start = setup(2, { living: 0, nodes: [29, 16], seed });
    let ses = { ...newSession(start) };
    ses = dispatch(ses, { type: 'roll' }).session;
    const die = ses.game.die;
    ses = dispatch(ses, { type: 'step', at: 29, left: 1, to: 30 }).session;
    expect(ses.game.traps.find((t) => t.node === 30)!.revealed).toBe(true);
    expect(ses.known).toContainEqual({ node: 30, effect: 'poltergeist' });
    expect(undoInfo(ses).which).toBe('current');
    const back = undo(ses);
    expect(back.game.traps.find((t) => t.node === 30)!.revealed).toBe(false);
    expect(back.known).toContainEqual({ node: 30, effect: 'poltergeist' });
    expect(aliveCount(back.game)).toBe(1);
    expect(dispatch(back, { type: 'roll' }).session.game.die).toBe(die);
  });

  it('saves round-trip as schema 5, migrate One Life v3 and v4 saves, and refuse older candy-rule saves', () => {
    const ses = dispatch(newSession(game(3, 9)), { type: 'rollForLife' }).session;
    const raw = serialize(ses, defaultPersonalization());
    const back = deserialize(raw);
    expect(back.ok).toBe(true);
    expect(deserialize(raw.replace('"schema":5', '"schema":2'))).toEqual({ ok: false, reason: 'incompatible' });
    expect(deserialize(JSON.stringify({ schema: 1, session: {} }))).toEqual({ ok: false, reason: 'incompatible' });
    // A save claiming two living pieces is corrupt.
    const bad = JSON.parse(raw);
    bad.session.game.pieces[1].alive = true;
    bad.session.game.pieces[0].alive = true;
    expect(deserialize(JSON.stringify(bad))).toEqual({ ok: false, reason: 'corrupt' });
    // A v3 (pre-battle) save migrates with empty inventories and no cooldowns.
    const toV3 = (g: Record<string, unknown>) => {
      const o = {
        ...g,
        schema: 3,
        pieces: (g.pieces as Array<Record<string, unknown>>).map(({ item: _i, itemAwardedAt: _a, ...p }) => p),
      } as Record<string, unknown>;
      for (const k of ['rewardRng', 'rollInfo', 'itemUsed', 'options', 'battlesThisRound', 'pendingReward', 'move']) delete o[k];
      o.selection = { dest: null };
      return o;
    };
    const v3 = JSON.parse(raw);
    v3.schema = 3;
    v3.session.game = toV3(v3.session.game);
    v3.session.turnStart = toV3(v3.session.turnStart);
    const mig = deserialize(JSON.stringify(v3));
    expect(mig.ok).toBe(true);
    if (mig.ok) {
      expect(mig.session.game.schema).toBe(5);
      expect(mig.session.game.pieces.every((p) => p.item === null && p.itemAwardedAt === null)).toBe(true);
      expect(mig.session.game.battlesThisRound).toEqual([]);
      expect(mig.session.game.traps).toEqual(ses.game.traps);
    }
    // A v3 save with a trap on a new Versus space is refused as a layout clash, never silently altered.
    const clash = JSON.parse(JSON.stringify(v3));
    clash.session.game.traps[0].node = 5;
    clash.session.turnStart.traps[0].node = 5;
    expect(deserialize(JSON.stringify(clash))).toEqual({ ok: false, reason: 'layout' });
    // A v4 save that had rolled a 4 (but not moved) resumes as an exact four-space move from the same space.
    const mid = rolled(setup(3, { living: 0, nodes: [0, 16, 24], acting: 1 }), 4);
    const v4game = { ...mid, schema: 4, selection: { dest: null } } as Record<string, unknown>;
    delete v4game.move;
    const v4 = { schema: 4, savedAt: '', personalization: defaultPersonalization(), session: { game: v4game, turnStart: { ...v4game, phase: 'turnStart', die: null, rollInfo: null }, previousTurnStart: null, known: [] } };
    const m4 = deserialize(JSON.stringify(v4));
    expect(m4.ok).toBe(true);
    if (m4.ok) {
      expect(m4.session.game.move).toEqual({ remaining: 4, prev: null, path: [16], usedSecret: false, usedWall: false });
      expect(moveLandings(m4.session.game)).toEqual(moveLandings(mid));
    }
  });

  it('a move saved at a fork resumes with the same remaining steps and triggers nothing twice', () => {
    let s = rolled(setup(2, { living: 0, nodes: [0, 16] }), 5);
    s = act(s, { type: 'step', at: 0, left: 5, to: 1 }); // walks to the fork on 4 with 1 left
    const ses = { ...newSession(s), turnStart: s };
    const back = deserialize(serialize(ses, defaultPersonalization()));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const g = back.session.game;
    expect(g.pieces[0].node).toBe(4);
    expect(g.move).toEqual(s.move);
    expect(g.log.filter((e) => e.kind === 'trapRevealed')).toEqual([]);
    const done = act(g, { type: 'step', at: 4, left: 1, to: 5 });
    expect(done.pieces[0].node).toBe(5);
    expect(done.move).toBeNull();
    // Replaying the step after resuming does nothing.
    expect(apply(done, { type: 'step', at: 4, left: 1, to: 5 }).error).toBeDefined();
  });

  it('pairs alternate controllers by round parity; solo pieces keep one', () => {
    const s = act(createGame({ pieces: [
      { character: 'knight', controllers: ['Ana', 'Ben'] },
      { character: 'witch', controllers: ['Cy'] },
    ], seed: 3, presetTraps: DEFAULT_TRAPS }), { type: 'rollForLife' });
    expect(s.pieces[0].name).toBe('Ana & Ben');
    expect(activeController({ ...s, round: 1 }, 0)).toBe(0);
    expect(activeController({ ...s, round: 2 }, 0)).toBe(1);
    expect(activeController({ ...s, round: 7 }, 0)).toBe(0);
    expect(activeController({ ...s, round: 2 }, 1)).toBe(0);
    expect(() => createGame({ pieces: [{ character: 'knight', controllers: ['a', 'b', 'c'] }, { character: 'witch', controllers: ['d'] }], seed: 1 })).toThrow();
    expect(() => createGame({ pieces: Array.from({ length: 5 }, (_, i) => ({ character: CHARACTERS[i].id, controllers: ['x'] })), seed: 1 })).toThrow();
  });
});
