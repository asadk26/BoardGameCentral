// Headless games: every piece a bot, every Haunted Jump Rope played through
// the same judged inputs a human would produce. Used by tests and by the
// balance runs (tests/balance.test.ts). Estimates of play time come from a
// simple per-action model, not from real people.

import { CHARACTERS, SUPER_REAPER } from './config';
import { botRopeInputs, type ChallengeInput } from './challenges';
import { botAction, newBotMemory, reflexOf, type BotMemory, type BotProfile } from './bots';
import { actingPiece, createGame, dispatch, finalScores, knownEffectAt, livingPiece, moveExits, moveLandings, newSession, type ScoreLine, type Session } from './engine';
import { seatView, type SeatView } from './view';
import type { Action, GameState, LogEntry } from './types';

/** A strategy override: return an action to force a behaviour, or null to defer to the bot. */
export type Strategy = (view: SeatView) => Action | null;

/** The next step toward a landing the current move can reach. */
export function headTo(s: GameState, dest: number): Action {
  const exits = moveExits(s);
  const way = exits.find((e) => moveLandings(s, e.to).includes(dest)) ?? exits[0];
  return { type: 'step', at: s.pieces[actingPiece(s)].node, left: s.move!.remaining, to: way.to };
}

/** Wanders without aim (always the lowest-numbered way on) and never challenges. */
export const camper: Strategy = (view) => {
  const s = view.state;
  if (actingPiece(s) !== view.piece) return null;
  if (s.phase === 'choose') return { type: 'step', at: s.pieces[view.piece].node, left: s.move!.remaining, to: moveExits(s)[0].to };
  if (s.phase === 'hunt') return { type: 'declineHunt' };
  return null;
};

/** Heads for the Super Reaper or a known Reaper tile whenever one is in reach. */
export const remoteSeeker: Strategy = (view) => {
  const s = view.state;
  if (actingPiece(s) !== view.piece || s.phase !== 'choose') return null;
  const reach = moveLandings(s);
  const target = reach.find((d) => d === SUPER_REAPER) ?? reach.find((d) => knownEffectAt(s, d) === 'reaper');
  return target === undefined ? null : headTo(s, target);
};

/** On a Reaper's Challenge the living piece always picks this one (the known weak ghost). */
export function farmer(weakest: number): Strategy {
  return (view) => {
    const s = view.state;
    if (actingPiece(s) !== view.piece || s.phase !== 'pick') return null;
    return s.pick!.options.includes(weakest) ? { type: 'pickOpponent', option: weakest } : null;
  };
}

export interface SimStats {
  firstLiving: number;
  /** Frozen schedule of each round. */
  schedules: number[][];
  /** Who scored each round. */
  roundScorers: number[];
  challenges: Record<string, number>;
  /** Life transfers in each round. */
  transfersByRound: number[];
  /** Challenges in each round. */
  challengesByRound: number[];
  longestStreak: number;
  wallMoves: number;
  /** Hunts made right after a move that used a ghost wall link. */
  wallHunts: number;
  hunts: number;
  maxMinigamesInAction: number;
  /** Ghost battles started (same space or from a Versus space). */
  battles: number;
  versusBattles: number;
  /** Ghost battles won by the ghost who was challenged. */
  defenderWins: number;
  /** Items drawn as rewards, by kind. */
  rewards: Record<string, number>;
  /** Items used, by kind. */
  itemUses: Record<string, number>;
  /** Rewards that asked the winner to keep or replace. */
  rewardChoices: number;
  /** Battles each piece won. */
  battleWinsBy: number[];
}

export interface SimResult {
  session: Session;
  scores: ScoreLine[];
  stats: SimStats;
  /** Simulated seconds of play, from a simple per-action time model. */
  estSeconds: number;
  log: LogEntry[];
}

export function simulateGame(opts: { seed: number; profiles: BotProfile[]; strategies?: Array<Strategy | null>; maxActions?: number }): SimResult {
  const n = opts.profiles.length;
  let session = newSession(
    createGame({ pieces: opts.profiles.map((_, i) => ({ character: CHARACTERS[i].id, controllers: [`Bot ${i + 1}`], bot: true })), seed: opts.seed }),
  );
  const mems: BotMemory[] = opts.profiles.map((_, i) => newBotMemory((opts.seed * 31 + i * 7919) >>> 0));
  const stats: SimStats = {
    firstLiving: -1,
    schedules: [],
    roundScorers: [],
    challenges: {},
    transfersByRound: [],
    challengesByRound: [],
    longestStreak: 0,
    wallMoves: 0,
    wallHunts: 0,
    hunts: 0,
    maxMinigamesInAction: 0,
    battles: 0,
    versusBattles: 0,
    defenderWins: 0,
    rewards: {},
    itemUses: {},
    rewardChoices: 0,
    battleWinsBy: Array(n).fill(0),
  };
  const log: LogEntry[] = [];
  const instigators = new Map<string, number>();
  let est = 0;
  let lastMoveUsedWall = false;
  let minigamesThisAction = 0;
  const max = opts.maxActions ?? 20000;
  for (let k = 0; k < max && session.game.phase !== 'gameOver'; k++) {
    const g = session.game;
    let action: Action | null = null;
    if (g.phase === 'challenge') {
      const ch = g.challenge!;
      const inputs: Record<number, ChallengeInput[]> = {};
      for (const p of ch.participants) inputs[p] = botRopeInputs(ch.seed, p, reflexOf(opts.profiles[p]));
      action = { type: 'challengeResult', id: ch.id, inputs };
      est += 22;
    } else if (g.phase === 'lifeRoll') {
      action = { type: 'rollForLife' };
      est += 10;
    } else {
      const seats = g.phase === 'placement' ? [...Array(n).keys()] : g.phase === 'reward' ? [g.pendingReward!.piece] : [actingPiece(g)];
      for (const seat of seats) {
        const view = seatView(g, seat);
        action = opts.strategies?.[seat]?.(view) ?? botAction(view, opts.profiles[seat], mems[seat]);
        if (action) break;
      }
    }
    if (!action) throw new Error(`No bot action in phase ${g.phase}`);
    if (action.type === 'roll') est += 4;
    if (action.type === 'step') est += 2.5; // a fork decision
    if (action.type === 'nextTurn') {
      est += 2;
      stats.maxMinigamesInAction = Math.max(stats.maxMinigamesInAction, minigamesThisAction);
      minigamesThisAction = 0;
    }
    if (action.type === 'hunt') {
      stats.hunts++;
      if (lastMoveUsedWall) stats.wallHunts++;
    }
    const r = dispatch(session, action);
    if (r.error) throw new Error(`Bot action ${action.type} rejected: ${r.error} (phase ${g.phase})`);
    for (const e of r.events) {
      log.push(e);
      if (e.kind === 'lifeRoll') stats.firstLiving = e.winner;
      if (e.kind === 'roundStart') {
        stats.schedules.push(e.schedule);
        stats.transfersByRound.push(0);
        stats.challengesByRound.push(0);
      }
      if (e.kind === 'move') {
        lastMoveUsedWall ||= e.usesWall;
        est += 0.4 * (e.path.length - 1); // walking the steps
        if (e.usesWall) stats.wallMoves++;
      }
      if (e.kind === 'roll' || (e.kind === 'itemUsed' && e.item === 'ghostlyStride')) lastMoveUsedWall = false;
      if (e.kind === 'challenge') {
        const key = `${e.challenge.host}:${e.challenge.participants.length}`;
        stats.challenges[key] = (stats.challenges[key] ?? 0) + 1;
        stats.challengesByRound[stats.challengesByRound.length - 1]++;
        minigamesThisAction++;
        if (e.challenge.host === 'ghostBattle' || e.challenge.host === 'versus') {
          instigators.set(e.challenge.id, e.challenge.instigator);
          stats.battles++;
          if (e.challenge.host === 'versus') stats.versusBattles++;
        }
      }
      if (e.kind === 'outcome' && e.outcome.reward) {
        stats.rewards[e.outcome.reward] = (stats.rewards[e.outcome.reward] ?? 0) + 1;
        stats.battleWinsBy[e.outcome.winner]++;
        if (e.outcome.winner !== instigators.get(e.outcome.challengeId)) stats.defenderWins++;
      }
      if (e.kind === 'rewardPending') stats.rewardChoices++;
      if (e.kind === 'itemUsed') stats.itemUses[e.item] = (stats.itemUses[e.item] ?? 0) + 1;
      if (e.kind === 'lifeTransfer') stats.transfersByRound[stats.transfersByRound.length - 1]++;
      if (e.kind === 'roundEnd') {
        stats.roundScorers.push(e.piece);
        stats.longestStreak = Math.max(stats.longestStreak, e.streak);
      }
    }
    session = r.session;
  }
  if (session.game.phase !== 'gameOver') throw new Error('Simulation did not finish');
  if (livingPiece(session.game) < 0) throw new Error('Nobody alive');
  return { session, scores: finalScores(session.game), stats, estSeconds: est, log };
}
