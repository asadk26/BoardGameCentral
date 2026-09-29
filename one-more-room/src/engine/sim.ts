// Headless games: every seat a bot, every survival game played through the
// same judged inputs a human would produce. Used by tests and by the balance
// comparisons (tests/balance.test.ts).

import { CHARACTERS, ENTRANCE, SUPER_REAPER } from './config';
import { botChallengeInputs, type ChallengeInput } from './challenges';
import { botAction, newBotMemory, reflexOf, type BotMemory, type BotProfile } from './bots';
import { createGame, dispatch, finalScores, isExposed, legalRoutes, newSession, type ScoreLine, type Session } from './engine';
import { seatView, type SeatView } from './view';
import type { Action, LogEntry } from './types';

/** A strategy override: return an action to force a behaviour, or null to defer to the bot. */
export type Strategy = (view: SeatView) => Action | null;

/** Seeks death as early as possible (to test whether dying early pays). */
export const suicidal: Strategy = (view) => {
  const s = view.state;
  const me = s.players[view.seat];
  if (s.phase !== 'choose' || s.turn !== view.seat || !me.alive) return null;
  const routes = [...legalRoutes(s, s.selection.moveDie).keys()];
  const dangerous = routes.find((d) => d === SUPER_REAPER || s.traps.some((t) => t.node === d) || s.players.some((p, i) => i !== view.seat && p.node === d && isExposed(s, i)));
  const dest = dangerous ?? routes.sort((a, b) => Math.abs(a - s.ghost) - Math.abs(b - s.ghost))[0] ?? 'stay';
  if (s.selection.dest !== dest) return { type: 'select', dest };
  return { type: 'confirmMove' };
};

/** Never leaves the entrance hall. */
export const camper: Strategy = (view) => {
  const s = view.state;
  const me = s.players[view.seat];
  if (s.phase !== 'choose' || s.turn !== view.seat || !me.alive) return null;
  if (me.node === ENTRANCE) return s.selection.dest === 'stay' ? { type: 'confirmMove' } : { type: 'select', dest: 'stay' };
  return legalRoutes(s).has(ENTRANCE) ? (s.selection.dest === ENTRANCE ? { type: 'confirmMove' } : { type: 'select', dest: ENTRANCE }) : null;
};

export interface SimResult {
  session: Session;
  scores: ScoreLine[];
  challenges: Record<string, number>;
  deaths: number;
  turns: number;
  endedEarly: boolean;
  /** Simulated seconds of play, from a simple per-action time model. */
  estSeconds: number;
  log: LogEntry[];
}

export function simulateGame(opts: { seed: number; profiles: BotProfile[]; strategies?: Array<Strategy | null>; maxActions?: number }): SimResult {
  const n = opts.profiles.length;
  let session = newSession(
    createGame({ players: opts.profiles.map((_, i) => ({ name: `Bot ${i + 1}`, character: CHARACTERS[i].id })), seed: opts.seed }),
  );
  const mems: BotMemory[] = opts.profiles.map((_, i) => newBotMemory((opts.seed * 31 + i * 7919) >>> 0));
  const challenges: Record<string, number> = {};
  const log: LogEntry[] = [];
  let deaths = 0;
  let turns = 0;
  let est = 0;
  const max = opts.maxActions ?? 20000;
  for (let k = 0; k < max && session.game.phase !== 'gameOver'; k++) {
    const g = session.game;
    let action: Action | null = null;
    if (g.phase === 'challenge') {
      const ch = g.challenge!;
      const inputs: Record<number, ChallengeInput[]> = {};
      for (const p of ch.participants) inputs[p] = botChallengeInputs(ch.kind, ch.seed, p, reflexOf(opts.profiles[p]), ch.oneSurvivor);
      action = { type: 'challengeResult', id: ch.id, inputs };
      est += ch.kind === 'duel' ? 20 : ch.kind === 'dance' ? 16 : 11;
    } else {
      const seats = g.phase === 'placement' ? [...Array(n).keys()] : [g.turn];
      for (const seat of seats) {
        const view = seatView(g, seat);
        action = opts.strategies?.[seat]?.(view) ?? botAction(view, opts.profiles[seat], mems[seat]);
        if (action) break;
      }
    }
    if (!action) throw new Error(`No bot action in phase ${g.phase}`);
    if (action.type === 'roll') est += 4;
    if (action.type === 'confirmMove') est += 9;
    if (action.type === 'moveGhost') est += 4;
    if (action.type === 'nextTurn') {
      turns++;
      est += 3;
    }
    const r = dispatch(session, action);
    if (r.error) throw new Error(`Bot action ${action.type} rejected: ${r.error} (phase ${g.phase})`);
    for (const e of r.events) {
      log.push(e);
      if (e.kind === 'challenge') challenges[`${e.challenge.host}:${e.challenge.kind}`] = (challenges[`${e.challenge.host}:${e.challenge.kind}`] ?? 0) + 1;
      if (e.kind === 'outcome') deaths += e.outcome.deaths.length;
    }
    session = r.session;
  }
  if (session.game.phase !== 'gameOver') throw new Error('Simulation did not finish');
  return {
    session,
    scores: finalScores(session.game),
    challenges,
    deaths,
    turns,
    endedEarly: session.game.endReason === 'noneAlive',
    estSeconds: est,
    log,
  };
}
