// Balance measurements over many simulated games. Skipped in normal runs;
// `npm run balance` prints the tables. All bots jump at the same reflex skill
// unless a line says otherwise, so the numbers show the rules' structure, not
// who happens to be the best jumper. Simulations flag biases and exploits —
// they say nothing about whether people enjoy the game or how long it takes
// at a real table.

import { expect, it } from 'vitest';
import type { BotProfile, Personality, SkillLevel } from '../src/engine/bots';
import { camper, farmer, remoteSeeker, simulateGame, type SimResult, type Strategy } from '../src/engine/sim';
import { ROUNDS } from '../src/engine/config';

const run = process.env.BALANCE ? it : it.skip;
const GAMES = Number(process.env.GAMES ?? 400);
const PERS: Personality[] = ['greedy', 'cautious', 'mischievous', 'greedy'];

function profiles(n: number, skill: SkillLevel = 'steady', override: Record<number, SkillLevel> = {}, same?: Personality): BotProfile[] {
  return Array.from({ length: n }, (_, i) => ({ personality: same ?? PERS[i], skill: override[i] ?? skill }));
}

interface Batch {
  results: SimResult[];
  n: number;
}

function batch(n: number, opts: { strategies?: Array<Strategy | null>; skills?: Record<number, SkillLevel>; seed?: number; same?: Personality } = {}): Batch {
  const results: SimResult[] = [];
  for (let g = 0; g < GAMES; g++) {
    results.push(simulateGame({ seed: (opts.seed ?? 1000) + g * 7919 + n, profiles: profiles(n, 'steady', opts.skills, opts.same), strategies: opts.strategies }));
  }
  return { results, n };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f = (x: number, d = 2) => x.toFixed(d);

/** Share of wins, splitting shared wins. */
function winShare(r: SimResult, piece: number): number {
  const w = r.scores.filter((s) => s.winner);
  return w.some((s) => s.piece === piece) ? 1 / w.length : 0;
}

function summary(b: Batch) {
  const { results, n } = b;
  const first = results.map((r) => r.session.game.pieces[r.stats.firstLiving].score);
  const firstWin = results.map((r) => winShare(r, r.stats.firstLiving));
  // Which scheduled slot held life at each bell (0 = the round's first, living piece).
  const slotCounts = new Array(n).fill(0);
  let rounds = 0;
  for (const r of results)
    r.stats.roundScorers.forEach((p, k) => {
      slotCounts[r.stats.schedules[k].indexOf(p)]++;
      rounds++;
    });
  const transfers = results.flatMap((r) => r.stats.transfersByRound);
  const challenges = results.flatMap((r) => r.stats.challengesByRound);
  const hosts: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.stats.challenges)) hosts[k] = (hosts[k] ?? 0) + v / results.length;
  return {
    firstPoints: mean(first),
    fairPoints: ROUNDS / n,
    firstWin: mean(firstWin),
    fairWin: 1 / n,
    slotShare: slotCounts.map((c) => c / rounds),
    roundsNoEncounter: mean(challenges.map((c) => (c === 0 ? 1 : 0))),
    encountersPerRound: mean(challenges),
    swapsPerRound: mean(transfers),
    multiSwapRounds: mean(transfers.map((t) => (t >= 2 ? 1 : 0))),
    longestStreak: mean(results.map((r) => r.stats.longestStreak)),
    huntsPerGame: mean(results.map((r) => r.stats.hunts)),
    wallMovesPerGame: mean(results.map((r) => r.stats.wallMoves)),
    wallHuntShare: results.reduce((a, r) => a + r.stats.wallHunts, 0) / Math.max(1, results.reduce((a, r) => a + r.stats.hunts, 0)),
    minutes: mean(results.map((r) => r.estSeconds)) / 60,
    maxMinigamesInAction: Math.max(...results.map((r) => r.stats.maxMinigamesInAction)),
    round1Encounter: mean(results.map((r) => (r.stats.challengesByRound[0] > 0 ? 1 : 0))),
    round1Kept: mean(results.map((r) => (r.stats.roundScorers[0] === r.stats.firstLiving ? 1 : 0))),
    hosts,
  };
}

function piece0(b: Batch) {
  return { points: mean(b.results.map((r) => r.session.game.pieces[0].score)), win: mean(b.results.map((r) => winShare(r, 0))) };
}

run('structure at 2, 3 and 4 pieces', () => {
  for (const n of [2, 3, 4]) {
    const s = summary(batch(n));
    console.log(`\n── ${n} pieces, ${GAMES} games, equal skill ──`);
    console.log(`first holder: ${f(s.firstPoints)} pts (fair ${f(s.fairPoints)}), wins ${f(s.firstWin * 100, 0)}% (fair ${f(s.fairWin * 100, 0)}%)`);
    console.log(`holder at the bell by slot: ${s.slotShare.map((x, k) => `${k === 0 ? 'first(living)' : `hunter${k}`} ${f(x * 100, 0)}%`).join(' · ')}`);
    console.log(`rounds without an encounter ${f(s.roundsNoEncounter * 100, 0)}% · encounters/round ${f(s.encountersPerRound)} · swaps/round ${f(s.swapsPerRound)} · rounds with 2+ swaps ${f(s.multiSwapRounds * 100, 0)}%`);
    console.log(`average longest streak ${f(s.longestStreak, 1)} · contact hunts/game ${f(s.huntsPerGame, 1)} · wall-link moves/game ${f(s.wallMovesPerGame, 1)} · hunts right after a wall move ${f(s.wallHuntShare * 100, 0)}%`);
    console.log(`challenges/game by kind: ${Object.entries(s.hosts).map(([k, v]) => `${k} ${f(v, 1)}`).join(' · ')}`);
    console.log(`round 1: an encounter in ${f(s.round1Encounter * 100, 0)}% of games; the first holder still holds life at the first bell in ${f(s.round1Kept * 100, 0)}%`);
    console.log(`estimated minutes (bot pace model): ${f(s.minutes, 1)} · max minigames in one action: ${s.maxMinigamesInAction}`);
    expect(s.maxMinigamesInAction).toBeLessThanOrEqual(1);
    const seats = batch(n, { same: 'greedy', seed: 5000 });
    console.log(`identical bots, points by seat: ${Array.from({ length: n }, (_, i) => f(mean(seats.results.map((r) => r.session.game.pieces[i].score)))).join(' · ')} (fair ${f(ROUNDS / n)})`);
  }
}, 600_000);

run('strategies: camping, remote tiles, farming a weak ghost', () => {
  for (const n of [2, 4]) {
    const base = piece0(batch(n));
    const camp = piece0(batch(n, { strategies: [camper] }));
    const remote = piece0(batch(n, { strategies: [remoteSeeker] }));
    const weak = piece0(batch(n, { skills: { 1: 'shaky' } }));
    const farm = piece0(batch(n, { strategies: [farmer(1)], skills: { 1: 'shaky' } }));
    console.log(`\n── strategies, ${n} pieces (piece 1 score / win share) ──`);
    console.log(`normal bot       ${f(base.points)} / ${f(base.win * 100, 0)}%`);
    console.log(`never moves      ${f(camp.points)} / ${f(camp.win * 100, 0)}%`);
    console.log(`seeks remote     ${f(remote.points)} / ${f(remote.win * 100, 0)}%`);
    console.log(`(piece 2 shaky)  ${f(weak.points)} / ${f(weak.win * 100, 0)}%`);
    console.log(`farms piece 2    ${f(farm.points)} / ${f(farm.win * 100, 0)}%`);
  }
}, 600_000);
