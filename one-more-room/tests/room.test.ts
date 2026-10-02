// The room service's authority, driven without sockets: a fake clock, fake
// timers and a mailbox per recipient. Phones are simulated by feeding the
// views they receive to the same bot logic a person might follow.

import { describe, expect, it } from 'vitest';
import { Room, type Participant } from '../src/net/room';
import type { RoomView, ServerMsg } from '../src/net/protocol';
import { botAction, newBotMemory, type BotMemory } from '../src/engine/bots';
import { botRopeInputs, challengeDurationMs, SKILLS } from '../src/engine/challenges';
import { CHARACTERS, ROUNDS, TRAP_ELIGIBLE, type CharacterId } from '../src/engine/config';
import { actingPiece } from '../src/engine/engine';

function harness(seed = 1) {
  let t = 1_000_000;
  let r = seed;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let tid = 0;
  const box = new Map<string, ServerMsg[]>();
  const room = new Room(`R${seed}`, {
    send: (to, msg) => {
      if (!box.has(to)) box.set(to, []);
      box.get(to)!.push(msg);
    },
    now: () => t,
    random: () => {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      return r / 2 ** 32;
    },
    setTimer: (fn, ms) => {
      timers.push({ at: t + ms, fn, id: ++tid });
      return tid;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    botDelayMs: 10,
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  const lastView = (to: string): RoomView | null => {
    const m = [...(box.get(to) ?? [])].reverse().find((x) => x.t === 'view');
    return m && m.t === 'view' ? m.view : null;
  };
  const rejected = (to: string) => (box.get(to) ?? []).filter((m) => m.t === 'rejected').map((m) => (m.t === 'rejected' ? m.reason : ''));
  const clear = (to: string) => box.set(to, []);
  return { room, advance, lastView, rejected, clear, box, now: () => t };
}

type H = ReturnType<typeof harness>;

/** Build a lobby from a team layout such as [2, 1, 1, 1] (people per piece; 0 = a bot). */
/**
 * Build a lobby from a team layout such as [2, 1, 1, 1] (people per piece; 0 = a bot).
 * Rooms start with four bot seats; a shorter layout uses the Advanced piece count.
 */
function lobby(layout: number[], seed = 1) {
  const h = harness(seed);
  if (layout.some((x) => x > 1)) h.room.handle('host', { t: 'setMode', mode: 'teams' });
  if (layout.length !== 4) h.room.handle('host', { t: 'setPieceCount', count: layout.length });
  const people: Participant[][] = [];
  layout.forEach((count, i) => {
    const character = CHARACTERS[i].id as CharacterId;
    if (count === 0) {
      people.push([]);
      return;
    }
    const first = h.room.join(`P${i}a`);
    h.room.handle(first.id, { t: 'claimPiece', character, name: `P${i}a` });
    const team = [first];
    if (count === 2) {
      const second = h.room.join(`P${i}b`);
      h.room.handle(second.id, { t: 'joinTeam', piece: i, name: `P${i}b` });
      team.push(second);
    }
    people.push(team);
  });
  return { ...h, people };
}

/** Drive every phone like a person would, from the views it receives, until the game ends or `until` holds. */
function play(h: H, opts: { maxSteps?: number; until?: () => boolean; skill?: keyof typeof SKILLS } = {}) {
  const mems = new Map<string, BotMemory>();
  const submitted = new Set<string>();
  for (let step = 0; step < (opts.maxSteps ?? 6000); step++) {
    if (opts.until?.()) return;
    const g = h.room.session?.game;
    if (!g || g.phase === 'gameOver') return;
    let acted = false;
    for (const p of h.room.participants.values()) {
      if (!p.connected) continue;
      const v = h.lastView(p.id);
      if (!v?.game || !v.you || v.you.piece === null) continue;
      const piece = v.you.piece;
      if (v.run && v.game.challenge && v.run.id === v.game.challenge.id && v.game.challenge.participants.includes(piece) && v.you.inControl) {
        const key = `${v.run.id}:${v.run.attempt}:${piece}`;
        if (!v.run.ready.includes(piece)) {
          h.room.handle(p.id, { t: 'ready', challengeId: v.run.id, attempt: v.run.attempt });
          acted = true;
        } else if (v.run.startAt !== null && !submitted.has(key) && !v.run.submitted.includes(piece)) {
          const ch = v.game.challenge;
          if (h.now() < v.run.startAt + challengeDurationMs(ch.seed)) h.advance(v.run.startAt + challengeDurationMs(ch.seed) - h.now() + 10);
          h.room.handle(p.id, { t: 'challengeInput', challengeId: v.run.id, attempt: v.run.attempt, inputs: botRopeInputs(ch.seed, piece, SKILLS[opts.skill ?? 'steady']) });
          submitted.add(key);
          acted = true;
        }
        continue;
      }
      const decider = v.game.phase === 'reward' && v.game.pendingReward ? v.game.pendingReward.piece : actingPiece(v.game);
      const mayAct = v.game.phase === 'placement' ? v.you.selector : v.you.inControl && decider === piece;
      if (!mayAct) continue;
      if (!mems.has(p.id)) mems.set(p.id, newBotMemory(p.id.length * 97 + step));
      const a = botAction({ state: v.game, piece, ownNomination: v.ownNomination }, { personality: 'greedy', skill: 'steady' }, mems.get(p.id)!);
      if (a) {
        h.room.handle(p.id, { t: 'action', id: `${p.id}-${step}`, rev: v.rev, action: a });
        acted = true;
      }
    }
    if (!acted) h.advance(200);
  }
}

describe('lobby: four pieces by default, bots in every free seat', () => {
  it('a new room has four bot seats; each person who joins takes one over', () => {
    const h = harness(1);
    expect(h.room.pieces.map((p) => p.kind)).toEqual(['bot', 'bot', 'bot', 'bot']);
    const people = ['Ana', 'Ben', 'Cy', 'Dee'].map((n) => h.room.join(n));
    const kinds = () => h.room.pieces.map((p) => (p.kind === 'bot' ? 'B' : 'H')).join('');
    h.room.handle(people[0].id, { t: 'claimPiece', character: 'witch', name: 'Ana' });
    expect(h.room.pieces.length).toBe(4);
    expect(h.room.pieces.filter((p) => p.kind === 'phone').length).toBe(1);
    h.room.handle(people[1].id, { t: 'claimPiece', character: 'zombie', name: 'Ben' });
    expect(kinds().split('').filter((k) => k === 'B').length).toBe(2); // two people + two bots
    h.room.handle(people[2].id, { t: 'claimPiece', character: 'skeleton', name: 'Cy' });
    expect(kinds().split('').filter((k) => k === 'B').length).toBe(1);
    h.room.handle(people[3].id, { t: 'claimPiece', character: 'goblin', name: 'Dee' });
    expect(kinds()).toBe('HHHH');
    expect(new Set(h.room.pieces.map((p) => p.character)).size).toBe(4);
    // A fifth person can't add a piece; they can watch (or join a pair in Team Battle).
    const extra = h.room.join('Eve');
    h.room.handle(extra.id, { t: 'claimPiece', character: 'vampire', name: 'Eve' });
    expect(h.rejected(extra.id)[0]).toMatch(/All 4 pieces/);
  });

  it('two people start a four-piece game: the other two seats are bots, never a two-piece game', () => {
    for (const people of [1, 2, 3]) {
      const h = harness(people);
      for (let i = 0; i < people; i++) h.room.handle(h.room.join(`P${i}`).id, { t: 'claimPiece', character: CHARACTERS[i + 2].id, name: `P${i}` });
      h.room.handle('host', { t: 'start' });
      const g = h.room.session!.game;
      expect(g.pieces.length).toBe(4);
      expect(g.pieces.filter((p) => p.bot).length).toBe(4 - people);
      expect(new Set(g.pieces.map((p) => p.character)).size).toBe(4);
    }
  });

  it('a pair takes one piece; the other seats stay bots', () => {
    const h = lobby([2, 0, 0, 0]);
    h.room.handle('host', { t: 'start' });
    const g = h.room.session!.game;
    expect(g.pieces.map((p) => (p.bot ? 0 : p.controllers.length))).toEqual([2, 0, 0, 0]);
  });

  it('claiming a bot’s costume takes that bot’s seat; a person’s costume is refused; leaving hands the seat back to a bot', () => {
    const h = harness(2);
    const a = h.room.join('Ana');
    const botChar = h.room.pieces[2].character;
    h.room.handle(a.id, { t: 'claimPiece', character: botChar, name: 'Ana' });
    expect(h.room.pieceOf(a.id)).toBe(2);
    const b = h.room.join('Ben');
    h.room.handle(b.id, { t: 'claimPiece', character: botChar, name: 'Ben' });
    expect(h.rejected(b.id)[0]).toMatch(/already uses that character/);
    h.room.handle(a.id, { t: 'leaveSeat' });
    expect(h.room.pieces.length).toBe(4);
    expect(h.room.pieces[2]).toMatchObject({ kind: 'bot', auto: true, character: botChar });
  });

  it('Advanced: fewer pieces is an explicit host choice that only removes bot seats', () => {
    const h = lobby([1, 1, 0, 0]);
    h.room.handle('host', { t: 'setPieceCount', count: 1 });
    expect(h.rejected('host').pop()).toMatch(/2–4/);
    h.room.handle('host', { t: 'setPieceCount', count: 2 });
    expect(h.room.pieces.map((p) => p.kind)).toEqual(['phone', 'phone']);
    h.room.handle('host', { t: 'setPieceCount', count: 4 });
    expect(h.room.pieces.length).toBe(4);
    h.room.handle('host', { t: 'start' });
    expect(h.room.session!.game.pieces.length).toBe(4);
  });

  it('Free-for-all has no pairs; Team Battle allows mixed solo and paired pieces up to eight phones', () => {
    const h = lobby([1, 1, 0, 0]);
    const c = h.room.join('Cy');
    h.room.handle(c.id, { t: 'joinTeam', piece: 0, name: 'Cy' });
    expect(h.rejected(c.id)[0]).toMatch(/Team Battle/);
    for (const layout of [[2, 1, 1, 1], [2, 2, 1, 0], [2, 2, 1, 1], [2, 2, 2, 2]]) {
      const t = lobby(layout);
      t.room.handle('host', { t: 'start' });
      expect(t.room.session!.game.pieces.map((p) => (p.bot ? 0 : p.controllers.length))).toEqual(layout);
    }
    const full = lobby([2, 2, 2, 2]);
    const nine = full.room.join('Nine');
    full.room.handle(nine.id, { t: 'joinTeam', piece: 0, name: 'Nine' });
    expect(full.room.pieceOf(nine.id)).toBeNull();
    full.room.handle('host', { t: 'setMode', mode: 'ffa' });
    expect(full.rejected('host')[0]).toMatch(/Split the pairs/);
  });
});

describe('controllers: who may act for a piece', () => {
  it('in a pair, the first person controls odd rounds and the second even rounds; the other phone cannot act', () => {
    const h = lobby([2, 1]);
    h.room.handle('host', { t: 'start' });
    const [a, b] = h.people[0];
    // Placement: only the designated selector confirms; both teammates see the pick.
    h.room.handle(b.id, { t: 'action', id: 'n1', rev: h.room.rev, action: { type: 'nominate', piece: 0, node: TRAP_ELIGIBLE[0] } });
    expect(h.rejected(b.id).pop()).toMatch(/teammate confirms/);
    h.room.handle(a.id, { t: 'action', id: 'n2', rev: h.room.rev, action: { type: 'nominate', piece: 0, node: TRAP_ELIGIBLE[0] } });
    h.room.handle(h.people[1][0].id, { t: 'action', id: 'n3', rev: h.room.rev, action: { type: 'nominate', piece: 1, node: TRAP_ELIGIBLE[1] } });
    h.room.broadcast();
    expect(h.lastView(a.id)!.ownNomination).toBe(TRAP_ELIGIBLE[0]);
    expect(h.lastView(b.id)!.ownNomination).toBe(TRAP_ELIGIBLE[0]);
    expect(h.lastView(h.people[1][0].id)!.ownNomination).toBe(TRAP_ELIGIBLE[1]);
    h.advance(3000); // the room rolls for life
    const g = h.room.session!.game;
    expect(g.phase).toBe('turnStart');
    expect(h.lastView(a.id)!.you!.inControl).toBe(true);
    expect(h.lastView(b.id)!.you!.inControl).toBe(false);
    if (actingPiece(g) === 0) {
      h.room.handle(b.id, { t: 'action', id: 'r1', rev: h.room.rev, action: { type: 'roll' } });
      expect(h.rejected(b.id).pop()).toMatch(/teammate controls/);
    }
    // Play on to round 2: control flips.
    play(h, { until: () => h.room.session!.game.round === 2 });
    expect(h.lastView(a.id)!.you!.inControl).toBe(false);
    expect(h.lastView(b.id)!.you!.inControl).toBe(true);
    expect(h.room.controllerOf(0)).toBe(b.id);
    expect(h.room.controllerOf(1)).toBe(h.people[1][0].id);
  });

  it('eight phones on four pieces play a whole game; only each round’s controller ever acts', () => {
    const h = lobby([2, 2, 2, 2], 5);
    h.room.handle('host', { t: 'start' });
    play(h);
    const g = h.room.session!.game;
    expect(g.phase).toBe('gameOver');
    expect(g.pieces.reduce((a, p) => a + p.score, 0)).toBe(ROUNDS);
    expect(g.pieces.filter((p) => p.alive).length).toBe(1);
    for (const team of h.people) for (const p of team) expect(h.rejected(p.id).filter((r) => /teammate/.test(r))).toEqual([]);
  });

  it('one person plus bots, and a bot-only game, both finish', () => {
    for (const layout of [[1, 0, 0, 0], [0, 0]]) {
      const h = lobby(layout, 9);
      h.room.handle('host', { t: 'start' });
      play(h, { maxSteps: 20000 });
      expect(h.room.session!.game.phase).toBe('gameOver');
    }
  });
});

describe('hidden information and forged input', () => {
  it('the TV never receives hidden traps or the seed; a phone sees only its own piece’s pick', () => {
    const h = lobby([1, 1, 0]);
    h.room.handle('host', { t: 'start' });
    play(h, { until: () => h.room.session!.game.phase === 'turnStart' });
    const tv = h.lastView('host')!;
    expect(tv.game!.traps.every((t) => t.revealed)).toBe(true);
    expect(tv.game!.rng).toBe(0);
    expect(tv.game!.seed).toBe(0);
    expect(tv.game!.nominations.every((n) => n === -1)).toBe(true);
    const mine = h.lastView(h.people[0][0].id)!;
    expect(mine.ownNomination).toBe(h.room.session!.game.nominations[0]);
    expect(mine.game!.nominations[1]).toBe(-1);
  });

  it('stale, duplicate and out-of-turn actions are refused; challenge results come only from judged inputs', () => {
    const h = lobby([1, 1]);
    h.room.handle('host', { t: 'start' });
    play(h, { until: () => h.room.session!.game.phase === 'turnStart' });
    const g = h.room.session!.game;
    const acting = actingPiece(g);
    const other = h.people[1 - acting][0];
    const me = h.people[acting][0];
    h.room.handle(other.id, { t: 'action', id: 'x1', rev: h.room.rev, action: { type: 'roll' } });
    expect(h.rejected(other.id).pop()).toMatch(/Not your turn/);
    h.room.handle(me.id, { t: 'action', id: 'x2', rev: 0, action: { type: 'roll' } });
    expect(h.rejected(me.id).pop()).toBe('stale');
    h.room.handle(me.id, { t: 'action', id: 'x3', rev: h.room.rev, action: { type: 'challengeResult', id: 'c1', inputs: {} } });
    expect(h.rejected(me.id).pop()).toMatch(/decided by the room/);
    h.room.handle(me.id, { t: 'action', id: 'x4', rev: h.room.rev, action: { type: 'roll' } });
    const die = h.room.session!.game.die;
    h.room.handle(me.id, { t: 'action', id: 'x4', rev: h.room.rev, action: { type: 'roll' } });
    expect(h.room.session!.game.die).toBe(die); // the duplicate did nothing
  });
});

describe('ghost battle rewards and items over the room', () => {
  /** A mixed-team game at a turn start, with piece 0 a pair. Returns the acting piece and a ghost that is not acting. */
  function atTurn(layout: number[], seed: number) {
    const h = lobby(layout, seed);
    h.room.handle('host', { t: 'start' });
    play(h, { until: () => h.room.session!.game.phase === 'turnStart' });
    const g = h.room.session!.game;
    return { h, g, acting: actingPiece(g) };
  }

  it('an out-of-turn winner’s current controller chooses keep or replace; nobody else can act meanwhile', () => {
    // Find a table where the pair (piece 0) is a ghost and someone else is acting.
    let t = atTurn([2, 1, 1], 3);
    for (let seed = 4; t.acting === 0 || t.g.pieces[0].alive; seed++) t = atTurn([2, 1, 1], seed);
    const { h, g, acting } = t;
    const winner = 0;
    const game = {
      ...g,
      phase: 'reward' as const,
      minigameUsed: true,
      pendingReward: { piece: winner, current: 'secondRoll' as const, offered: 'ghostSwitch' as const },
      pieces: g.pieces.map((p, i) => (i === winner ? { ...p, item: 'secondRoll' as const, itemAwardedAt: 0 } : p)),
    };
    h.room.session = { ...h.room.session!, game };
    h.room.broadcast();
    const actor = h.people[acting][0];
    {
      h.room.handle(actor.id, { t: 'action', id: 'w1', rev: h.room.rev, action: { type: 'nextTurn' } });
      expect(h.rejected(actor.id).pop()).toMatch(/battle winner/);
    }
    const ctrl = h.room.controllerOf(winner)!;
    const team = h.people[winner];
    const other = team.find((p) => p.id !== ctrl);
    expect(other).toBeDefined();
    if (other) {
      h.room.handle(other.id, { t: 'action', id: 'w2', rev: h.room.rev, action: { type: 'chooseReward', keep: 'offered' } });
      expect(h.rejected(other.id).pop()).toMatch(/teammate controls/);
      expect(h.lastView(other.id)!.game!.pieces[winner].item).toBe('secondRoll');
    }
    // The TV sees the held item and the offer, never the reward stream.
    expect(h.lastView('host')!.game!.pendingReward).toEqual(game.pendingReward);
    expect(h.lastView('host')!.game!.rewardRng).toBe(0);
    h.room.handle(ctrl, { t: 'action', id: 'w3', rev: h.room.rev, action: { type: 'chooseReward', keep: 'offered' } });
    const after = h.room.session!.game;
    expect(after.pieces[winner].item).toBe('ghostSwitch');
    expect(after.phase).toBe('summary');
    // A replay of the same message id changes nothing.
    h.room.handle(ctrl, { t: 'action', id: 'w3', rev: h.room.rev, action: { type: 'chooseReward', keep: 'current' } });
    expect(h.room.session!.game.pieces[winner].item).toBe('ghostSwitch');
  });

  it('a bot winner chooses its reward on its own, even out of turn', () => {
    const { h, g, acting } = atTurn([1, 1, 0], 4);
    const bot = 2;
    if (g.pieces[bot].alive) return;
    const game = {
      ...g,
      phase: 'reward' as const,
      minigameUsed: true,
      pendingReward: { piece: bot, current: 'secondRoll' as const, offered: 'ghostlyStride' as const },
      pieces: g.pieces.map((p, i) => (i === bot ? { ...p, item: 'secondRoll' as const, itemAwardedAt: 0 } : p)),
    };
    expect(acting).toBeGreaterThanOrEqual(0);
    h.room.session = { ...h.room.session!, game };
    h.room.pump();
    h.advance(1000);
    expect(h.room.session!.game.phase).not.toBe('reward');
    expect(h.room.session!.game.pieces[bot].item).not.toBeNull();
  });

  it('only the acting ghost’s current controller can use its item; a refused use keeps the item', () => {
    const { h, g, acting } = atTurn([2, 2, 1], 6);
    if (g.pieces[acting].alive || !h.people[acting].length) {
      // Make the acting piece a ghost holding Ghostly Stride by moving life to someone else.
      const holder = g.pieces.findIndex((_, i) => i !== acting);
      h.room.session = {
        ...h.room.session!,
        game: {
          ...g,
          pieces: g.pieces.map((p, i) => ({
            ...p,
            alive: i === holder,
            item: i === acting ? 'ghostlyStride' : null,
            itemAwardedAt: i === acting ? -1 : null,
          })),
        },
      };
    } else {
      h.room.session = {
        ...h.room.session!,
        game: {
          ...g,
          pieces: g.pieces.map((p, i) => ({
            ...p,
            item: i === acting ? 'ghostlyStride' : p.item,
            itemAwardedAt: i === acting ? -1 : p.itemAwardedAt,
          })),
        },
      };
    }
    h.room.broadcast();
    const ctrl = h.room.controllerOf(acting)!;
    for (const p of h.people.flat().filter((x) => x.id !== ctrl)) {
      h.room.handle(p.id, { t: 'action', id: `u-${p.id}`, rev: h.room.rev, action: { type: 'useItem', item: 'ghostlyStride' } });
      expect(h.room.session!.game.pieces[acting].item).toBe('ghostlyStride');
    }
    h.room.handle(ctrl, { t: 'action', id: 'u-ok', rev: h.room.rev, action: { type: 'useItem', item: 'ghostlyStride' } });
    const after = h.room.session!.game;
    expect(after.pieces[acting].item).toBeNull();
    expect(after.rollInfo).toEqual({ kind: 'stride' });
    expect(after.allowance).toBe(6);
  });
});

describe('disconnects, handover and pause', () => {
  function toChallenge(seed: number) {
    for (let s = seed; s < seed + 60; s++) {
      const h = lobby([2, 1], s);
      h.room.handle('host', { t: 'start' });
      play(h, { until: () => !!h.room.run });
      if (h.room.run) return h;
    }
    throw new Error('no challenge reached');
  }

  it('a controller who drops mid-challenge freezes it; it restarts on return and resolves exactly once', () => {
    const h = toChallenge(20);
    const run = h.room.run!;
    const ch = h.room.session!.game.challenge!;
    const piece = ch.participants.find((p) => h.room.pieces[p].kind === 'phone')!;
    const who = h.room.controllerOf(piece)!;
    h.room.handle(who, { t: 'ready', challengeId: run.id, attempt: run.attempt });
    h.room.disconnect(who);
    expect(h.room.run!.paused).toMatch(/reconnect/);
    expect(h.room.run!.attempt).toBe(1);
    const scoresBefore = h.room.session!.game.pieces.map((p) => p.score);
    const token = h.room.participants.get(who)!.token;
    h.room.join('again', token);
    h.room.broadcast();
    expect(h.room.run!.paused).toBeNull();
    play(h, { until: () => !h.room.session!.game.challenge });
    const outcomes = [...(h.box.get('host') ?? [])].flatMap((m) => (m.t === 'view' ? m.events : [])).filter((e) => e.kind === 'outcome' && e.outcome.challengeId === ch.id);
    expect(outcomes.length).toBe(1);
    expect(h.room.session!.game.pieces.map((p) => p.score)).toEqual(scoresBefore);
  });

  it('the host hands a disconnected controller’s slot to another phone before a challenge starts; the old phone loses authority', () => {
    const h = lobby([2, 1], 3);
    h.room.handle('host', { t: 'start' });
    const [a, b] = h.people[0];
    const spare = h.room.join('Spare');
    h.room.disconnect(a.id);
    h.room.handle('host', { t: 'handover', piece: 0, slot: 0, to: spare.id });
    expect(h.room.pieces[0].members).toEqual([spare.id, b.id]);
    expect(h.room.notice).toMatch(/Spare now controls/);
    h.room.join('A back', h.room.participants.get(a.id)!.token);
    h.room.broadcast();
    expect(h.lastView(a.id)!.you!.piece).toBeNull();
    h.room.handle(a.id, { t: 'action', id: 'z', rev: h.room.rev, action: { type: 'nominate', piece: 0, node: TRAP_ELIGIBLE[0] } });
    expect(h.rejected(a.id).pop()).toMatch(/watching/);
    // Handover is refused while a challenge is being played.
    const g = toChallenge(40);
    const run = g.room.run!;
    for (const p of g.room.session!.game.challenge!.participants) {
      const c = g.room.controllerOf(p);
      if (c) g.room.handle(c, { t: 'ready', challengeId: run.id, attempt: run.attempt });
    }
    if (g.room.run!.startAt !== null) {
      g.room.handle('host', { t: 'handover', piece: 0, slot: 1, to: g.room.join('Late').id });
      expect(g.rejected('host').pop()).toMatch(/Wait until this challenge ends/);
    }
  });

  it('host pause stops bots and actions; resuming continues', () => {
    const h = lobby([1, 0], 4);
    h.room.handle('host', { t: 'start' });
    h.room.handle('host', { t: 'pause', on: true });
    const before = h.room.rev;
    h.advance(10_000);
    expect(h.room.session!.game.phase).toBe('placement');
    h.room.handle(h.people[0][0].id, { t: 'action', id: 'p1', rev: h.room.rev, action: { type: 'nominate', piece: 0, node: TRAP_ELIGIBLE[2] } });
    expect(h.rejected(h.people[0][0].id).pop()).toMatch(/paused/);
    expect(h.room.rev).toBe(before);
    h.room.handle('host', { t: 'pause', on: false });
    play(h, { until: () => h.room.session!.game.phase === 'turnStart' });
    expect(h.room.session!.game.phase).toBe('turnStart');
  });
});
