// Ghost battles and the three consumable items: eligibility, cooldowns,
// weighted rewards, keep/replace, each item's exact rules, and what clears
// or protects inventory.

import { describe, expect, it } from 'vitest';
import { ITEM_WEIGHTS, itemFromDraw, STRIDE_ALLOWANCE, VERSUS_SPACES, TRAP_ELIGIBLE, SUPER_REAPER, type ItemId } from '../src/engine/config';
import { dispatch, encounterOptions, itemBlock, legalRoutes, newSession, previewMove, undo } from '../src/engine/engine';
import { nextFloat, rollDie } from '../src/engine/rng';
import { publicView, seatView } from '../src/engine/view';
import type { GameState } from '../src/engine/types';
import { act, jumps, living, move, resolve, rolled, setup } from './helpers';

/** Three pieces: 0 living far away at 16, ghosts 1 (acting) and 2. */
function trio(n1: number, n2: number, extra: Partial<GameState> = {}): GameState {
  return {
    ...setup(3, { living: 0, nodes: [16, n1, n2], acting: 1 }),
    ...extra,
  };
}

function withItem(s: GameState, piece: number, item: ItemId | null, awardedAt: number | null = null): GameState {
  return {
    ...s,
    pieces: s.pieces.map((p, i) => (i === piece ? { ...p, item, itemAwardedAt: awardedAt } : p)),
  };
}

function nextReward(s: GameState): ItemId {
  return itemFromDraw(nextFloat(s.rewardRng)[0]);
}

describe('reward draw', () => {
  it('maps draws to the exact 40/40/20 weights at the boundaries', () => {
    expect(ITEM_WEIGHTS.map(([, w]) => w)).toEqual([0.4, 0.4, 0.2]);
    expect(itemFromDraw(0)).toBe('secondRoll');
    expect(itemFromDraw(0.3999)).toBe('secondRoll');
    expect(itemFromDraw(0.4)).toBe('ghostSwitch');
    expect(itemFromDraw(0.7999)).toBe('ghostSwitch');
    expect(itemFromDraw(0.8)).toBe('ghostlyStride');
    expect(itemFromDraw(0.99999)).toBe('ghostlyStride');
  });

  it('Versus spaces are fixed, trap-free and not start or Reaper spaces', () => {
    expect(VERSUS_SPACES).toEqual([5, 23]);
    for (const v of VERSUS_SPACES) expect(TRAP_ELIGIBLE).not.toContain(v);
    expect(VERSUS_SPACES).not.toContain(SUPER_REAPER);
  });
});

describe('starting a ghost battle', () => {
  it('ending a move on another ghost offers a battle; adjacency does not', () => {
    const s = move(trio(1, 3), 3);
    expect(s.phase).toBe('hunt');
    expect(s.options).toMatchObject({ living: false, sameSpace: [2], versus: [] });
    const adj = move(trio(1, 3), 2);
    expect(adj.phase).toBe('summary');
    expect(adj.options).toBeNull();
    // Passing through a ghost's space is harmless.
    const through = move(trio(1, 3), 4);
    expect(through.phase).toBe('summary');
  });

  it('a Versus space invites any ghost at any distance; a living piece gets nothing there', () => {
    const s = move(trio(3, 28), 5);
    expect(s.options).toMatchObject({ sameSpace: [], versus: [2] });
    const liv = move(setup(3, { living: 0, nodes: [3, 10, 28], acting: 0 }), 5);
    expect(liv.phase).toBe('summary');
    // With two pieces there is never another ghost: the tile explains itself.
    const two = move(setup(2, { living: 0, nodes: [16, 3], acting: 1 }), 5);
    expect(two.phase).toBe('summary');
    expect(two.log.some((e) => e.kind === 'versusInactive' && e.reason === 'noGhosts')).toBe(true);
  });

  it('a stay never starts a battle, even on a Versus space or a shared space', () => {
    let s = rolled(trio(5, 5), 4);
    s = act(act(s, { type: 'select', dest: 'stay' }), { type: 'confirmMove' });
    expect(s.phase).toBe('summary');
  });

  it('both stay ghosts: no points, no moves, no transfer; the winner gets one item', () => {
    let s = move(trio(1, 3), 3);
    const expected = nextReward(s);
    s = act(s, { type: 'battle', opponent: 2 });
    expect(s.challenge).toMatchObject({ host: 'ghostBattle', participants: [1, 2], contact: false, multipliers: [1, 1] });
    const before = s.pieces.map((p) => ({ ...p }));
    s = resolve(s, { 1: 10, 2: 0 });
    expect(living(s)).toBe(0);
    expect(s.pieces.map((p) => p.node)).toEqual(before.map((p) => p.node));
    expect(s.pieces.map((p) => p.score)).toEqual(before.map((p) => p.score));
    expect(s.pieces[1].item).toBe(expected);
    expect(s.pieces[2].item).toBeNull();
    expect(s.lastOutcome).toMatchObject({ winner: 1, transferred: false, reward: expected, moves: [] });
    expect(s.phase).toBe('summary');
  });

  it('a ghost battle can be won by the defender, who may use the item on its own later slot', () => {
    let s = move(trio(1, 3), 3);
    s = act(s, { type: 'battle', opponent: 2 });
    const battleAction = s.actionNumber;
    s = resolve(s, { 1: 0, 2: 10 });
    expect(s.pieces[2].item).not.toBeNull();
    expect(s.pieces[2].itemAwardedAt).toBe(battleAction);
    expect(s.pieces[1].item).toBeNull();
    // Nothing extra for the out-of-turn winner: the schedule simply moves on.
    const slot = s.slot;
    s = act(s, { type: 'nextTurn' });
    expect(s.slot === slot + 1 || s.round === 2).toBe(true);
  });

  it('each pair battles once per round; the cooldown clears next round', () => {
    let s = move(trio(1, 3), 3);
    s = resolve(act(s, { type: 'battle', opponent: 2 }), { 1: 10 });
    expect(s.battlesThisRound).toEqual(['1-2']);
    const again = {
      ...s,
      phase: 'turnStart' as const,
      minigameUsed: false,
      options: null,
      rollInfo: null,
    };
    expect(encounterOptions(again, 1, true).sameSpace).toEqual([]);
    // Versus with everyone on cooldown explains why.
    const vs = {
      ...again,
      pieces: again.pieces.map((p, i) => (i === 1 ? { ...p, node: 5 } : p)),
    };
    expect(encounterOptions(vs, 1, true)).toMatchObject({ versus: [], versusInactive: 'cooldown' });
    // A new round starts with no cooldowns.
    let t = s;
    for (let guard = 0; t.round === 1 && guard < 20; guard++) {
      if (t.phase === 'summary') t = act(t, { type: 'nextTurn' });
      else if (t.phase === 'turnStart') t = act(rolled(t, 3), { type: 'select', dest: 'stay' });
      else if (t.phase === 'choose') t = act(t, { type: 'confirmMove' });
      else if (t.phase === 'hunt') t = act(t, { type: 'declineHunt' });
      else break;
    }
    expect(t.round).toBe(2);
    expect(t.battlesThisRound).toEqual([]);
  });

  it('a trap takes priority: a minigame trap means no battle, a Poltergeist throw offers none', () => {
    // Ghost 2 waits on the hidden Reaper at 9; ghost 1 lands there.
    const s = move(trio(7, 9), 9);
    expect(s.phase).toBe('challenge');
    expect(s.challenge!.host).toBe('reaper');
    const p = move(trio(28, 30), 30);
    expect(p.log.some((e) => e.kind === 'poltergeist')).toBe(true);
    expect(p.options?.sameSpace ?? []).toEqual([]);
    expect(p.options?.versus ?? []).toEqual([]);
  });

  it('with both a living challenge and a battle available, the ghost picks one', () => {
    const s = move(setup(3, { living: 0, nodes: [4, 1, 3], acting: 1 }), 3);
    expect(s.options).toMatchObject({ living: true, sameSpace: [2] });
    const b = act(s, { type: 'battle', opponent: 2 });
    expect(dispatch(newSession(b), { type: 'hunt' }).error).toBeDefined();
    const h = act(s, { type: 'hunt' });
    expect(h.challenge!.host).toBe('contact');
  });

  it('previews list battle options from public facts without touching reward randomness', () => {
    const s = rolled(trio(1, 3), 4);
    const p = previewMove(s, 3)!;
    expect(p.battleTargets).toEqual([2]);
    expect(previewMove(s, 5)!.versus).toBe(true);
    expect(previewMove(s, 'stay')!.battleTargets).toEqual([]);
    expect(s.rewardRng).toBe(rolled(trio(1, 3), 4).rewardRng);
  });
});

describe('keep or replace', () => {
  it('a different item asks the winner; the choice is final and nothing else changes', () => {
    let s = move(trio(1, 3), 3);
    const offered = nextReward(s);
    const current: ItemId = offered === 'secondRoll' ? 'ghostlyStride' : 'secondRoll';
    s = withItem(s, 1, current, 0);
    s = resolve(act(s, { type: 'battle', opponent: 2 }), { 1: 10 });
    expect(s.phase).toBe('reward');
    expect(s.pendingReward).toEqual({ piece: 1, current, offered });
    expect(dispatch(newSession(s), { type: 'nextTurn' }).error).toBeDefined();
    const keep = act(s, { type: 'chooseReward', keep: 'current' });
    expect(keep.pieces[1].item).toBe(current);
    expect(keep.phase).toBe('summary');
    const swap = act(s, { type: 'chooseReward', keep: 'offered' });
    expect(swap.pieces[1].item).toBe(offered);
    expect(swap.pieces[1].itemAwardedAt).toBe(s.actionNumber);
    expect(swap.pendingReward).toBeNull();
  });

  it('winning the item already held keeps one, with no dialog', () => {
    let s = move(trio(1, 3), 3);
    const offered = nextReward(s);
    s = withItem(s, 1, offered, 0);
    s = resolve(act(s, { type: 'battle', opponent: 2 }), { 1: 10 });
    expect(s.phase).toBe('summary');
    expect(s.pieces[1].item).toBe(offered);
    expect(s.pieces[1].itemAwardedAt).toBe(0);
  });

  it('undo and replay draw the same reward; reward randomness is never public', () => {
    const play = (ses: ReturnType<typeof newSession>) => {
      ses = dispatch(ses, { type: 'roll' }).session;
      ses = dispatch(ses, { type: 'select', dest: 3 }).session;
      ses = dispatch(ses, { type: 'confirmMove' }).session;
      ses = dispatch(ses, { type: 'battle', opponent: 2 }).session;
      return dispatch(ses, { type: 'challengeResult', id: ses.game.challenge!.id, inputs: { 1: jumps(ses.game.challenge!, 10), 2: [] } }).session;
    };
    const start = newSession(trio(1, 3));
    const first = play(start);
    const reward = first.game.pieces[1].item;
    expect(reward).not.toBeNull();
    const back = undo(first);
    expect(back.game.phase).toBe('turnStart');
    expect(back.game.pieces[1].item).toBeNull();
    expect(play(back).game.pieces[1].item).toBe(reward);
    expect(publicView(first.game).rewardRng).toBe(0);
    expect(seatView(first.game, 1).state.rewardRng).toBe(0);
  });
});

describe('Second Roll', () => {
  it('replaces the die for good with one fresh roll; the allowance floor stays 3', () => {
    let lower = false;
    let floor = false;
    for (let seed = 1; seed < 60 && !(lower && floor); seed++) {
      let s = withItem(setup(3, { living: 0, nodes: [16, 1, 28], acting: 1, seed }), 1, 'secondRoll', 0);
      s = rolled(s, 6);
      s = act(s, { type: 'select', dest: 7 });
      const [expected] = rollDie(s.rng);
      const t = act(s, { type: 'useItem', item: 'secondRoll' });
      expect(t.die).toBe(expected);
      expect(t.allowance).toBe(Math.max(3, expected));
      expect(t.rollInfo).toEqual({ kind: 'die', rerolledFrom: 6 });
      expect(t.selection.dest).toBeNull();
      expect(t.pieces[1].item).toBeNull();
      expect(t.log.some((e) => e.kind === 'itemUsed' && e.item === 'secondRoll')).toBe(true);
      if (expected < 6) lower = true;
      if (expected < 3) floor = true;
    }
    expect(lower && floor).toBe(true);
  });

  it('only after rolling and before moving', () => {
    const s = withItem(trio(1, 28), 1, 'secondRoll', 0);
    expect(itemBlock(s, 'secondRoll')).toMatch(/after rolling/);
    const r = dispatch(newSession(s), { type: 'useItem', item: 'secondRoll' });
    expect(r.error).toBeDefined();
    expect(r.session.game.pieces[1].item).toBe('secondRoll');
  });
});

describe('Ghost Switch', () => {
  it('swaps two ghosts atomically; nothing lands or triggers; then the ghost rolls normally', () => {
    let s = withItem(trio(1, 21), 1, 'ghostSwitch', 0);
    s = act(s, { type: 'useItem', item: 'ghostSwitch', target: 2 });
    expect(s.pieces[1].node).toBe(21);
    expect(s.pieces[2].node).toBe(1);
    expect(s.traps.find((t) => t.node === 21)!.revealed).toBe(false);
    expect(s.phase).toBe('turnStart');
    expect(s.origin).toBe(21);
    expect(s.challenge).toBeNull();
    s = act(s, { type: 'roll' });
    expect(s.phase).toBe('choose');
    // A stay after the swap is not a landing.
    s = act(act(s, { type: 'select', dest: 'stay' }), { type: 'confirmMove' });
    expect(s.phase).toBe('summary');
  });

  it('never targets the living piece or a ghost on the same space; with no target it is not spent', () => {
    const s = withItem(trio(3, 3), 1, 'ghostSwitch', 0);
    expect(itemBlock(s, 'ghostSwitch', 0)).toBeTruthy();
    expect(itemBlock(s, 'ghostSwitch', 2)).toMatch(/No other ghost/);
    const r = dispatch(newSession(s), { type: 'useItem', item: 'ghostSwitch', target: 0 });
    expect(r.error).toBeDefined();
    expect(r.session.game.pieces[1].item).toBe('ghostSwitch');
  });
});

describe('Ghostly Stride', () => {
  it('moves up to 6 instead of rolling, with no randomness drawn', () => {
    let s = withItem(trio(1, 28), 1, 'ghostlyStride', 0);
    const rng = s.rng;
    s = act(s, { type: 'useItem', item: 'ghostlyStride' });
    expect(s.rng).toBe(rng);
    expect(s.die).toBeNull();
    expect(s.allowance).toBe(STRIDE_ALLOWANCE);
    expect(s.rollInfo).toEqual({ kind: 'stride' });
    const reach = [...legalRoutes(s).keys()];
    expect(reach).toContain(7);
    expect(reach).not.toContain(8);
    expect(reach).toContain(2); // may stop early
    expect(dispatch(newSession(s), { type: 'roll' }).error).toBeDefined();
  });
});

describe('who may use items, and when', () => {
  it('one item per action; not in the action that won it; not by the living piece', () => {
    const s = withItem(trio(1, 28), 1, 'ghostlyStride', 0);
    expect(itemBlock({ ...s, itemUsed: 'ghostSwitch' }, 'ghostlyStride')).toMatch(/one item/);
    expect(itemBlock(withItem(s, 1, 'ghostlyStride', s.actionNumber), 'ghostlyStride')).toMatch(/action that won/);
    const liv = withItem(setup(3, { living: 0, nodes: [16, 1, 28], acting: 0 }), 0, 'ghostlyStride', 0);
    expect(itemBlock(liv, 'ghostlyStride')).toMatch(/living/);
    expect(itemBlock(s, 'ghostSwitch')).toMatch(/don’t hold/);
  });

  it('becoming alive clears the item: contact, remote Reaper and Séance', () => {
    // Contact: ghost 1 lands beside the living piece and wins.
    let c = withItem(setup(3, { living: 0, nodes: [16, 10, 28], acting: 1 }), 1, 'ghostSwitch', 0);
    c = move(c, 15);
    c = resolve(act(c, { type: 'hunt' }), { 1: 10 });
    expect(living(c)).toBe(1);
    expect(c.pieces[1].item).toBeNull();
    // Remote Reaper (hidden at 9).
    let r = withItem(setup(3, { living: 0, nodes: [16, 7, 28], acting: 1 }), 1, 'secondRoll', 0);
    r = resolve(move(r, 9), { 1: 10 });
    expect(living(r)).toBe(1);
    expect(r.pieces[1].item).toBeNull();
    // Séance (hidden at 14).
    let se = withItem(setup(3, { living: 0, nodes: [2, 13, 28], acting: 1 }), 1, 'ghostlyStride', 0);
    se = resolve(move(se, 14), { 1: 10 });
    expect(living(se)).toBe(1);
    expect(se.pieces[1].item).toBeNull();
  });
});
