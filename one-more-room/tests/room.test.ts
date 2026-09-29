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
function lobby(layout: number[], seed = 1) {
  const h = harness(seed);
  if (layout.some((x) => x > 1)) h.room.handle('host', { t: 'setMode', mode: 'teams' });
  const people: Participant[][] = [];
  layout.forEach((count, i) => {
    const character = CHARACTERS[i].id as CharacterId;
    if (count === 0) {
      h.room.handle('host', { t: 'addBot', character, bot: { personality: 'greedy', skill: 'steady' } });
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
      const mayAct = v.game.phase === 'placement' ? v.you.selector : v.you.inControl && actingPiece(v.game) === piece;
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

describe('lobby: modes, pieces, teams and characters', () => {
  it('Free-for-all: one person per piece, distinct characters, no pairs', () => {
    const h = lobby([1, 1]);
    const c = h.room.join('Cy');
    h.room.handle(c.id, { t: 'claimPiece', character: CHARACTERS[0].id, name: 'Cy' });
    expect(h.rejected(c.id)[0]).toMatch(/already uses that character/);
    h.room.handle(c.id, { t: 'joinTeam', piece: 0, name: 'Cy' });
    expect(h.rejected(c.id)[1]).toMatch(/Team Battle/);
    h.room.handle(c.id, { t: 'claimPiece', character: 'vampire', name: 'Cy' });
    expect(h.room.pieces.map((p) => p.character)).toEqual([CHARACTERS[0].id, CHARACTERS[1].id, 'vampire']);
    // A person can switch character in the lobby, but not to a taken one.
    h.room.handle(c.id, { t: 'setCharacter', character: CHARACTERS[1].id });
    expect(h.room.pieces[2].character).toBe('vampire');
    h.room.handle(c.id, { t: 'setCharacter', character: 'skeleton' });
    expect(h.room.pieces[2].character).toBe('skeleton');
  });

  it('uneven teams start: five people as 2+1+1+1 and 2+2+1, six as 2+2+1+1, eight on four pieces', () => {
    for (const layout of [[2, 1, 1, 1], [2, 2, 1], [2, 2, 1, 1], [2, 2, 2, 2], [1, 0], [2, 0, 0]]) {
      const h = lobby(layout);
      h.room.handle('host', { t: 'start' });
      const g = h.room.session!.game;
      expect(g.pieces.length).toBe(layout.length);
      expect(g.pieces.map((p) => (p.bot ? 0 : p.controllers.length))).toEqual(layout);
      expect(new Set(g.pieces.map((p) => p.character)).size).toBe(layout.length);
    }
  });

  it('caps: four pieces, two people per piece, eight phones; a ninth phone can only watch', () => {
    const h = lobby([2, 2, 2, 2]);
    const extra = h.room.join('Nine');
    h.room.handle(extra.id, { t: 'claimPiece', character: 'skeleton', name: 'Nine' });
    h.room.handle(extra.id, { t: 'joinTeam', piece: 0, name: 'Nine' });
    expect(h.rejected(extra.id).length).toBe(2);
    expect(h.room.pieceOf(extra.id)).toBeNull();
    h.room.handle('host', { t: 'setMode', mode: 'ffa' });
    expect(h.rejected('host')[0]).toMatch(/Split the pairs/);
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
