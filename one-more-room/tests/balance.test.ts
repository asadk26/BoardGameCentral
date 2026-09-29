// Strategy comparisons over many simulated games. Skipped in normal runs;
// `BALANCE=1 npx vitest run tests/balance.test.ts` prints the tables.
// Simulations flag exploits — they do not prove a game is fun.

import { expect, it } from 'vitest';
import { defaultBotProfile } from '../src/engine/bots';
import { camper, simulateGame, suicidal, type Strategy } from '../src/engine/sim';

const run = process.env.BALANCE ? it : it.skip;
const GAMES = Number(process.env.GAMES ?? 300);

function batch(n: number, strategies: Array<Strategy | null> = [], label = '') {
  let seat0 = 0;
  let others = 0;
  let deaths = 0;
  let early = 0;
  let secs = 0;
  let seat0Wins = 0;
  const ch: Record<string, number> = {};
  let bountyMax = 0;
  for (let g = 0; g < GAMES; g++) {
    const r = simulateGame({ seed: 1000 + g * 17, profiles: Array.from({ length: n }, (_, i) => defaultBotProfile(i + g)), strategies });
    const s0 = r.scores.find((l) => l.player === 0)!;
    seat0 += s0.total;
    if (s0.winner) seat0Wins++;
    others += r.scores.filter((l) => l.player !== 0).reduce((a, l) => a + l.total, 0) / (n - 1);
    deaths += r.deaths;
    if (r.endedEarly) early++;
    secs += r.estSeconds;
    for (const [k, v] of Object.entries(r.challenges)) ch[k] = (ch[k] ?? 0) + v;
    bountyMax = Math.max(bountyMax, ...r.session.game.players.map((p) => p.bounty));
  }
  const row = {
    label,
    seats: n,
    seat0Avg: +(seat0 / GAMES).toFixed(2),
    othersAvg: +(others / GAMES).toFixed(2),
    seat0WinRate: +(seat0Wins / GAMES).toFixed(2),
    deathsPerGame: +(deaths / GAMES).toFixed(2),
    challengesPerGame: +(Object.values(ch).reduce((a, b) => a + b, 0) / GAMES).toFixed(2),
    earlyEndRate: +(early / GAMES).toFixed(3),
    estMinutes: +(secs / GAMES / 60).toFixed(1),
    bountyMax,
    byType: Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, +(v / GAMES).toFixed(2)])),
  };
  console.log(JSON.stringify(row));
  return row;
}

run('strategy comparisons', () => {
  for (const n of [2, 4, 6]) {
    const base = batch(n, [], 'all bots');
    const die = batch(n, [suicidal], 'seat 0 seeks death');
    const camp = batch(n, [camper], 'seat 0 camps at the entrance');
    // Exploit flags: a strategy should not beat ordinary play.
    expect(die.seat0Avg).toBeLessThan(base.seat0Avg);
    expect(camp.seat0Avg).toBeLessThan(base.seat0Avg);
  }
}, 600000);
