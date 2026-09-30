// Balance measurements over many simulated games. Skipped in normal runs;
// `npm run balance` prints the tables. All bots jump at the same reflex skill
// unless a line says otherwise, so the numbers show the rules' structure, not
// who happens to be the best jumper. Simulations flag biases and exploits —
// they say nothing about whether people enjoy the game or how long it takes
// at a real table.

import { expect, it } from 'vitest';
import type { BotProfile, Personality, SkillLevel } from '../src/engine/bots';
import { camper, farmer, remoteSeeker, simulateGame, type SimResult, type Strategy } from '../src/engine/sim';
import { POLICY, ROUNDS, VERSUS_SPACES } from '../src/engine/config';
import { actingPiece, legalRoutes } from '../src/engine/engine';

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

/** Always battles when it can (over challenging the living piece too). */
const looter: Strategy = (view) => {
  const s = view.state;
  if (actingPiece(s) !== view.piece || s.phase !== 'hunt' || !s.options) return null;
  const opp = s.options.sameSpace[0] ?? s.options.versus[0];
  return opp === undefined ? null : { type: 'battle', opponent: opp };
};

/** Heads for a Versus space whenever one is in reach, then battles from it. */
const versusCamper: Strategy = (view) => {
  const s = view.state;
  if (actingPiece(s) !== view.piece) return null;
  if (s.phase === 'hunt') return looter(view);
  if (s.phase !== 'choose' || s.pieces[view.piece].alive) return null;
  const v = [...legalRoutes(s).keys()].find((d) => VERSUS_SPACES.includes(d));
  if (v === undefined) return null;
  return s.selection.dest === v ? { type: 'confirmMove' } : { type: 'select', dest: v };
};

function battleLine(b: Batch) {
  const r = b.results;
  const total = (k: 'battles' | 'versusBattles' | 'defenderWins' | 'rewardChoices') => r.reduce((a, x) => a + x.stats[k], 0);
  const sum = (k: 'rewards' | 'itemUses') => {
    const o: Record<string, number> = {};
    for (const x of r) for (const [i, v] of Object.entries(x.stats[k])) o[i] = (o[i] ?? 0) + v;
    return o;
  };
  const rewards = sum('rewards');
  const nRewards = Object.values(rewards).reduce((a, v) => a + v, 0);
  const uses = sum('itemUses');
  const life = r.map((x) =>
    Object.entries(x.stats.challenges)
      .filter(([k]) => !k.startsWith('ghostBattle') && !k.startsWith('versus'))
      .reduce((a, [, v]) => a + v, 0),
  );
  return {
    battles: total('battles') / r.length,
    versusShare: total('versusBattles') / Math.max(1, total('battles')),
    defenderWin: total('defenderWins') / Math.max(1, total('battles')),
    rewardMix: Object.fromEntries(Object.entries(rewards).map(([k, v]) => [k, v / Math.max(1, nRewards)])),
    usesPerGame: Object.fromEntries(Object.entries(uses).map(([k, v]) => [k, v / r.length])),
    choicesPerGame: total('rewardChoices') / r.length,
    lifeChallenges: mean(life),
    transfers: mean(r.map((x) => x.stats.transfersByRound.reduce((a, v) => a + v, 0))),
  };
}

run(
  'ghost battles: baseline versus with battles and items',
  () => {
    const was = POLICY.ghostBattles;
    try {
      for (const n of [2, 3, 4]) {
        POLICY.ghostBattles = false;
        const base = batch(n, { seed: 9000 });
        const baseSeats = batch(n, { same: 'greedy', seed: 5000 });
        const baseSharp = piece0(batch(n, { skills: { 0: 'sharp' }, seed: 7000 }));
        POLICY.ghostBattles = true;
        const add = batch(n, { seed: 9000 });
        const addSeats = batch(n, { same: 'greedy', seed: 5000 });
        const addSharp = piece0(batch(n, { skills: { 0: 'sharp' }, seed: 7000 }));
        const b0 = battleLine(base);
        const b1 = battleLine(add);
        const s0 = summary(base);
        const s1 = summary(add);
        const seat = (b: Batch) => Array.from({ length: n }, (_, i) => f(mean(b.results.map((r) => r.session.game.pieces[i].score)))).join(' · ');
        console.log(`\n── ghost battles, ${n} pieces, ${GAMES} games (baseline → with battles) ──`);
        console.log(
          `ghost battles/game ${f(b0.battles)} → ${f(b1.battles)} · from Versus ${f(b1.versusShare * 100, 0)}% · won by defender ${f(b1.defenderWin * 100, 0)}%`,
        );
        console.log(
          `reward mix ${Object.entries(b1.rewardMix)
            .map(([k, v]) => `${k} ${f(v * 100, 1)}%`)
            .join(' · ')} · keep/replace choices/game ${f(b1.choicesPerGame, 2)}`,
        );
        console.log(
          `items used/game ${
            Object.entries(b1.usesPerGame)
              .map(([k, v]) => `${k} ${f(v, 2)}`)
              .join(' · ') || 'none'
          }`,
        );
        console.log(
          `life challenges/game ${f(b0.lifeChallenges, 2)} → ${f(b1.lifeChallenges, 2)} · life transfers/game ${f(b0.transfers, 2)} → ${f(b1.transfers, 2)}`,
        );
        console.log(
          `minigames/round ${f(s0.encountersPerRound)} → ${f(s1.encountersPerRound)} · rounds with none ${f(s0.roundsNoEncounter * 100, 0)}% → ${f(s1.roundsNoEncounter * 100, 0)}% · est. minutes ${f(s0.minutes, 1)} → ${f(s1.minutes, 1)}`,
        );
        console.log(`first holder wins ${f(s0.firstWin * 100, 0)}% → ${f(s1.firstWin * 100, 0)}% (fair ${f(100 / n, 0)}%)`);
        console.log(`identical bots, points by seat: ${seat(baseSeats)} → ${seat(addSeats)}`);
        console.log(
          `sharp jumper (piece 1) vs steady: ${f(baseSharp.points)} pts / ${f(baseSharp.win * 100, 0)}% → ${f(addSharp.points)} / ${f(addSharp.win * 100, 0)}%`,
        );
        expect(s1.maxMinigamesInAction).toBeLessThanOrEqual(1);
        if (n >= 3) {
          const norm = piece0(add);
          const loot = piece0(batch(n, { strategies: [looter], seed: 9000 }));
          const camp = piece0(batch(n, { strategies: [versusCamper], seed: 9000 }));
          const weak = piece0(batch(n, { skills: { 1: 'shaky' }, seed: 9000 }));
          const farm = piece0(batch(n, { strategies: [looter], skills: { 1: 'shaky' }, seed: 9000 }));
          console.log(
            `piece 1 strategies: normal ${f(norm.points)} / ${f(norm.win * 100, 0)}% · always battles ${f(loot.points)} / ${f(loot.win * 100, 0)}% · camps Versus ${f(camp.points)} / ${f(camp.win * 100, 0)}% · piece 2 shaky: normal ${f(weak.points)} / ${f(weak.win * 100, 0)}% vs always battles ${f(farm.points)} / ${f(farm.win * 100, 0)}%`,
          );
        }
      }
    } finally {
      POLICY.ghostBattles = was;
    }
  },
  900_000,
);
