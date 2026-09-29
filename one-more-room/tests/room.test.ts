// The room service's authority, driven without sockets: a fake clock, fake
// timers and a mailbox per recipient. Phones are simulated by feeding the
// views they receive to the same bot logic a human might follow.

import { describe, expect, it } from 'vitest';
import { Room } from '../src/net/room';
import type { RoomView, ServerMsg } from '../src/net/protocol';
import { botAction, newBotMemory } from '../src/engine/bots';
import { botChallengeInputs, challengeDurationMs, SKILLS } from '../src/engine/challenges';
import { TRAP_ELIGIBLE } from '../src/engine/config';

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
  const rejected = (to: string) => (box.get(to) ?? []).filter((m) => m.t === 'rejected');
  return { room, advance, lastView, rejected, box, now: () => t };
}

function lobby(seed = 1) {
  const h = harness(seed);
  const a = h.room.join('Ana');
  const b = h.room.join('Ben');
  h.room.handle(a.id, { t: 'claimSeat', character: 'witch', name: 'Ana' });
  h.room.handle(b.id, { t: 'claimSeat', character: 'knight', name: 'Ben' });
  h.room.handle('host', { t: 'addBot', character: 'goblin', bot: { personality: 'greedy', skill: 'steady' } });
  return { ...h, a, b };
}

describe('room lobby and seats', () => {
  it('seats phones and bots; only the host starts; characters are unique', () => {
    const h = lobby();
    const c = h.room.join('Cy');
    h.room.handle(c.id, { t: 'claimSeat', character: 'witch', name: 'Cy' });
    expect(h.rejected(c.id).length).toBe(1);
    h.room.handle(h.a.id, { t: 'start' });
    expect(h.room.session).toBe(null);
    h.room.handle('host', { t: 'start' });
    expect(h.room.session?.game.phase).toBe('placement');
    expect(h.room.seats.map((s) => s.kind)).toEqual(['phone', 'phone', 'bot']);
  });

  it('rejoining with the token keeps the same participant and seat; tokens never appear in views', () => {
    const h = lobby();
    h.room.disconnect(h.a.id);
    const again = h.room.join('Whoever', h.a.token);
    expect(again.id).toBe(h.a.id);
    expect(again.seat).toBe(0);
    const json = JSON.stringify([h.lastView(h.a.id), h.lastView(h.b.id), h.lastView('host')]);
    expect(json).not.toContain(h.a.token);
    expect(json).not.toContain(h.b.token);
    expect(json).not.toContain(h.room.hostToken);
  });
});

describe('private placement and public views', () => {
  it('each phone sees only its own pick; the TV sees neither picks nor the hidden map', () => {
    const h = lobby();
    h.room.handle('host', { t: 'start' });
    h.room.handle(h.a.id, { t: 'action', id: 'x1', rev: h.room.rev, action: { type: 'nominate', seat: 1, node: 2 } });
    expect(h.rejected(h.a.id).length).toBe(1);
    h.room.handle(h.a.id, { t: 'action', id: 'x2', rev: h.room.rev, action: { type: 'nominate', seat: 0, node: 26 } });
    expect(h.lastView(h.a.id)!.ownNomination).toBe(26);
    expect(h.lastView(h.b.id)!.ownNomination).toBe(null);
    expect(h.lastView('host')!.game!.nominations[0]).toBe(-1);
    h.room.handle(h.b.id, { t: 'action', id: 'y1', rev: h.room.rev, action: { type: 'nominate', seat: 1, node: 18 } });
    h.advance(100); // the bot nominates
    const g = h.room.session!.game;
    expect(g.phase).toBe('turnStart');
    const hidden = g.traps.map((x) => x.node);
    for (const who of ['host', h.a.id, h.b.id]) {
      const v = h.lastView(who)!;
      expect(v.game!.traps).toEqual([]);
      expect(v.game!.rng).toBe(0);
      expect(v.game!.seed).toBe(0);
      expect(v.game!.deck.every((c) => c === -1)).toBe(true);
    }
    expect(hidden.length).toBe(6);
  });
});

describe('actions', () => {
  function started() {
    const h = lobby(3);
    h.room.handle('host', { t: 'start' });
    h.room.handle(h.a.id, { t: 'action', id: 'n', rev: h.room.rev, action: { type: 'nominate', seat: 0, node: TRAP_ELIGIBLE[0] } });
    h.room.handle(h.b.id, { t: 'action', id: 'n', rev: h.room.rev, action: { type: 'nominate', seat: 1, node: TRAP_ELIGIBLE[1] } });
    h.advance(100);
    return h;
  }
  it('rejects out-of-turn, stale, forged-result and duplicate actions', () => {
    const h = started();
    expect(h.room.session!.game.turn).toBe(0);
    h.room.handle(h.b.id, { t: 'action', id: 'b1', rev: h.room.rev, action: { type: 'roll' } });
    expect(h.rejected(h.b.id).at(-1)).toMatchObject({ reason: 'Not your turn.' });
    h.room.handle(h.a.id, { t: 'action', id: 'a0', rev: -5, action: { type: 'roll' } });
    expect(h.rejected(h.a.id).at(-1)).toMatchObject({ reason: 'stale' });
    h.room.handle(h.a.id, { t: 'action', id: 'a1', rev: h.room.rev, action: { type: 'roll' } });
    const dice = h.room.session!.game.dice;
    h.room.handle(h.a.id, { t: 'action', id: 'a1', rev: h.room.rev, action: { type: 'roll' } });
    expect(h.room.session!.game.dice).toEqual(dice);
    h.room.handle(h.a.id, { t: 'action', id: 'a2', rev: h.room.rev, action: { type: 'challengeResult', id: 'x', inputs: {} } });
    expect(h.rejected(h.a.id).at(-1)).toMatchObject({ reason: 'Challenge results come from judged inputs.' });
    h.room.handle(h.a.id, { t: 'action', id: 'a3', rev: h.room.rev, action: { type: 'select', dest: 31 } });
    h.room.handle(h.a.id, { t: 'action', id: 'a4', rev: h.room.rev, action: { type: 'select', dest: 999 } });
    expect(h.rejected(h.a.id).at(-1)).toMatchObject({ reason: 'That space is out of reach.' });
  });

  it('pauses while the host is away and resumes when the host rejoins', () => {
    const h = started();
    h.room.hostDisconnect();
    h.room.handle(h.a.id, { t: 'action', id: 'p1', rev: h.room.rev, action: { type: 'roll' } });
    expect(h.rejected(h.a.id).at(-1)!.reason).toMatch(/paused/);
    h.room.hostConnect();
    h.room.handle(h.a.id, { t: 'action', id: 'p2', rev: h.room.rev, action: { type: 'roll' } });
    expect(h.room.session!.game.phase).toBe('choose');
  });
});

/** Drive every phone with bot logic on the views it actually receives. */
function playOut(h: ReturnType<typeof lobby>, phones: Array<{ id: string; seat: number }>, opts: { dropDuringChallenge?: boolean } = {}) {
  const mems = new Map(phones.map((p) => [p.id, newBotMemory(p.seat + 7)]));
  let counter = 0;
  let dropped = false;
  for (let step = 0; step < 4000 && h.room.session!.game.phase !== 'gameOver'; step++) {
    const g = h.room.session!.game;
    if (g.phase === 'challenge') {
      const run = h.room.run!;
      for (const p of phones) {
        const v = h.lastView(p.id)!;
        if (!v.run || !g.challenge!.participants.includes(p.seat)) continue;
        if (opts.dropDuringChallenge && !dropped && !run.inputs.has(p.seat)) {
          dropped = true;
          h.room.disconnect(p.id);
          expect(h.room.run!.paused).toBeTruthy();
          const back = h.room.join('again', h.room.participants.get(p.id)!.token);
          h.room.broadcast(); // the server broadcasts after every join
          expect(back.seat).toBe(p.seat);
          expect(h.room.run!.paused).toBe(null);
          continue;
        }
        if (!v.run.ready.includes(p.seat)) h.room.handle(p.id, { t: 'ready', challengeId: v.run.id, attempt: v.run.attempt });
      }
      const r = h.room.run;
      if (r && r.startAt !== null) {
        const ch = g.challenge!;
        h.advance(Math.max(0, r.startAt - h.now()) + challengeDurationMs(ch.kind, ch.seed, ch.oneSurvivor));
        for (const p of phones) {
          if (!ch.participants.includes(p.seat) || h.room.run?.inputs.has(p.seat)) continue;
          h.room.handle(p.id, { t: 'challengeInput', challengeId: ch.id, attempt: h.room.run!.attempt, inputs: botChallengeInputs(ch.kind, ch.seed, p.seat, SKILLS.steady, ch.oneSurvivor) });
        }
      } else h.advance(50);
      continue;
    }
    const acting = g.phase === 'placement' ? phones.filter((p) => g.nominations[p.seat] === null) : phones.filter((p) => p.seat === g.turn);
    if (!acting.length) {
      h.advance(50);
      continue;
    }
    for (const p of acting) {
      const v = h.lastView(p.id)!;
      const a = botAction({ state: v.game!, seat: p.seat, ownNomination: v.ownNomination }, { personality: 'greedy', skill: 'steady' }, mems.get(p.id)!);
      if (a) h.room.handle(p.id, { t: 'action', id: `a${counter++}`, rev: v.rev, action: a });
    }
  }
}

describe('whole games through the room', () => {
  it('two phones and a bot play to the end, with duels and escapes judged on the server', () => {
    const h = lobby(11);
    h.room.handle('host', { t: 'start' });
    playOut(h, [{ id: h.a.id, seat: 0 }, { id: h.b.id, seat: 1 }]);
    const g = h.room.session!.game;
    expect(g.phase).toBe('gameOver');
    expect(h.lastView('host')!.game!.phase).toBe('gameOver');
  });

  it('a disconnect mid-challenge freezes it; the rejoined seat replays the same challenge', () => {
    let saw = false;
    for (let seed = 20; seed < 40 && !saw; seed++) {
      const h = lobby(seed);
      h.room.handle('host', { t: 'start' });
      playOut(h, [{ id: h.a.id, seat: 0 }, { id: h.b.id, seat: 1 }], { dropDuringChallenge: true });
      expect(h.room.session!.game.phase).toBe('gameOver');
      saw = [...h.box.get('host')!].some((m) => m.t === 'view' && !!m.view.run?.note?.includes('lost connection'));
    }
    expect(saw).toBe(true);
  });

  it('keeps rooms separate', () => {
    const h1 = lobby(5);
    const h2 = lobby(6);
    h1.room.handle('host', { t: 'start' });
    expect(h2.room.session).toBe(null);
    expect(h2.lastView(h2.a.id)!.phase).toBe('lobby');
    expect(h1.room.participants.has(h2.a.id)).toBe(false);
  });

  it('refuses results that arrive before the challenge could have been played', () => {
    const h = lobby(8);
    h.room.handle('host', { t: 'start' });
    for (let i = 0; i < 4000 && h.room.session!.game.phase !== 'challenge' && h.room.session!.game.phase !== 'gameOver'; i++) {
      playStep(h);
    }
    const g = h.room.session!.game;
    if (g.phase !== 'challenge') return;
    const seat = g.challenge!.participants.find((p) => p < 2);
    if (seat === undefined) return;
    const pid = seat === 0 ? h.a.id : h.b.id;
    for (const p of g.challenge!.participants) if (p < 2) h.room.handle(p === 0 ? h.a.id : h.b.id, { t: 'ready', challengeId: g.challenge!.id, attempt: 0 });
    h.room.handle(pid, { t: 'challengeInput', challengeId: g.challenge!.id, attempt: 0, inputs: [] });
    expect(h.rejected(pid).at(-1)?.reason).toBe('Too early.');
  });
});

function playStep(h: ReturnType<typeof lobby>) {
  const g = h.room.session!.game;
  const phones = [{ id: h.a.id, seat: 0 }, { id: h.b.id, seat: 1 }];
  const acting = g.phase === 'placement' ? phones.filter((p) => g.nominations[p.seat] === null) : phones.filter((p) => p.seat === g.turn);
  if (!acting.length) return h.advance(50);
  for (const p of acting) {
    const v = h.lastView(p.id)!;
    const a = botAction({ state: v.game!, seat: p.seat, ownNomination: v.ownNomination }, { personality: 'mischievous', skill: 'steady' }, newBotMemory(p.seat));
    if (a) h.room.handle(p.id, { t: 'action', id: `s${Math.random()}`, rev: v.rev, action: a });
  }
}
