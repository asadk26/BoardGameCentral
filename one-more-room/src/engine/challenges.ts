// Haunted Jump Rope as pure data. A challenge's seed fixes the whole rope
// schedule, shared by every participant. A press makes the character jump —
// one whole, visible jump — and a sweep counts only if the character's feet
// are above the rope at the moment it passes under them. The renderer draws
// exactly the jumps and stumbles computed here, so what the screen shows is
// what the judge scores. Humans and bots go through the same judge, the
// authority never trusts a client-reported score, and nothing depends on the
// order in which presses arrived.

import { CHALLENGE } from './config';
import { nextFloat } from './rng';

/** One button press, in ms after the ready countdown ends. */
export interface ChallengeInput {
  t: number;
}

function stream(seed: number) {
  let s = seed >>> 0;
  return () => {
    let v: number;
    [v, s] = nextFloat(s);
    return v;
  };
}

export interface RopeSchedule {
  /** Time each sweep reaches the feet, ms after the ready countdown. */
  bottoms: number[];
  sweeps: number;
  extraSweeps: number;
  /** End of the eight scored sweeps. */
  mainMs: number;
  /** End of the sudden-death sweeps. */
  totalMs: number;
}

/** The gap before sweep k (k ≥ 1): the rope speeds up after every sweep. */
export function sweepPeriod(k: number): number {
  const c = CHALLENGE.rope;
  return Math.max(c.minPeriodMs, c.periodMs * Math.pow(c.accel, k - 1));
}

/** Eight scored sweeps plus four sudden-death sweeps, identical for everyone, getting faster. */
export function ropeSchedule(seed: number): RopeSchedule {
  const r = stream(seed ^ 0x40be);
  const c = CHALLENGE.rope;
  const n = c.sweeps + c.extraSweeps;
  const bottoms: number[] = [];
  let base = c.firstMs;
  for (let i = 0; i < n; i++) {
    if (i > 0) base += sweepPeriod(i);
    bottoms.push(Math.round(base + (r() * 2 - 1) * c.jitterMs));
  }
  return { bottoms, sweeps: c.sweeps, extraSweeps: c.extraSweeps, mainMs: bottoms[c.sweeps - 1] + 500, totalMs: bottoms[n - 1] + 500 };
}

/** The unscored practice rope: a few slow, perfectly regular sweeps. */
export function practiceSchedule(): RopeSchedule {
  const p = CHALLENGE.practice;
  const bottoms = Array.from({ length: p.sweeps }, (_, i) => p.firstMs + i * p.periodMs);
  return { bottoms, sweeps: p.sweeps, extraSweeps: 0, mainMs: bottoms[p.sweeps - 1] + 500, totalMs: bottoms[p.sweeps - 1] + 700 };
}

/** How long a jump lasts for a jumper with this curse multiplier (1 = no curse). */
export function airTime(multiplier = 1): number {
  return CHALLENGE.rope.airMs * multiplier;
}

/**
 * Height of a jump `since` ms after take-off, as a fraction of a full
 * (uncursed) jump's peak: a parabola over the jump's air time. A cursed jump
 * is shorter and lower.
 */
export function jumpHeight(since: number, multiplier = 1): number {
  const air = airTime(multiplier);
  if (since <= 0 || since >= air) return 0;
  const x = since / air;
  return 4 * x * (1 - x) * multiplier;
}

/**
 * The part of a jump during which the feet are above the rope, as ms after
 * take-off. Same parabola as jumpHeight; the rope skims at ropeHeightFrac.
 */
export function clearSpan(multiplier = 1): { from: number; to: number } {
  const air = airTime(multiplier);
  const need = Math.min(0.9, CHALLENGE.rope.ropeHeightFrac / multiplier); // as a share of this jump's own peak
  const x0 = (1 - Math.sqrt(1 - need)) / 2;
  return { from: x0 * air, to: (1 - x0) * air };
}

export interface Jump {
  /** Take-off, ms. */
  start: number;
  /** Landing, ms (earlier than start + air if the rope caught the feet mid-air). */
  end: number;
}

export interface SweepResult {
  cleared: boolean;
  /** Absolute timing error from a perfectly centred jump, ms (a miss scores the fixed maximum). */
  error: number;
  /** Take-off of the jump that met this sweep, if any. */
  press: number | null;
}

export interface JumperTimeline {
  jumps: Jump[];
  /** Times the rope caught this jumper. */
  stumbles: number[];
  results: SweepResult[];
}

/**
 * Play one jumper's presses against a rope, in time order. A press starts a
 * jump only when the character is standing (landed, recovered, not
 * stumbling); presses in mid-air or mid-stumble do nothing, so holding,
 * mashing, key-repeat or a duplicate message can never add or heighten jumps.
 * At each sweep the feet either clear the rope (the middle of a jump) or are
 * caught: a stumble, and no new jump for a moment.
 */
export function jumperTimeline(sched: RopeSchedule, inputs: ChallengeInput[], multiplier = 1): JumperTimeline {
  const c = CHALLENGE.rope;
  const air = airTime(multiplier);
  const span = clearSpan(multiplier);
  const presses = inputs.map((i) => i.t).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const jumps: Jump[] = [];
  const stumbles: number[] = [];
  const results: SweepResult[] = [];
  let ready = -Infinity;
  let k = 0;
  const takeOffs = (until: number) => {
    for (; k < presses.length && presses[k] <= until; k++) {
      const p = presses[k];
      if (p < ready) continue;
      jumps.push({ start: p, end: p + air });
      ready = p + air + c.groundMs;
    }
  };
  for (const b of sched.bottoms) {
    takeOffs(b);
    const j = jumps.length ? jumps[jumps.length - 1] : null;
    const since = j && b < j.end ? b - j.start : null;
    if (since !== null && since >= span.from && since <= span.to) {
      results.push({ cleared: true, error: Math.round(Math.abs(since - air / 2)), press: j!.start });
      continue;
    }
    results.push({ cleared: false, error: c.missErrorMs, press: since !== null ? j!.start : null });
    stumbles.push(b);
    if (since !== null) {
      j!.end = b; // caught mid-air: down at once, and up again once the stumble passes
      ready = b + c.stumbleMs;
    } else ready = Math.max(ready, b + c.stumbleMs);
  }
  takeOffs(Infinity);
  return { jumps, stumbles, results };
}

/** The scored results for one jumper (see jumperTimeline). */
export function judgeRopeSweeps(sched: RopeSchedule, inputs: ChallengeInput[], multiplier = 1): SweepResult[] {
  return jumperTimeline(sched, inputs, multiplier).results;
}

/**
 * Where the rope is at time t: 0 when it is at the jumpers' feet, ±π at the
 * top. It waits at the top, makes one turn down to each floor pass, and
 * rests at the top again after the last one.
 */
export function ropeAngle(sched: RopeSchedule, t: number): number {
  const b = sched.bottoms;
  const first = b.length > 1 ? b[1] - b[0] : CHALLENGE.rope.periodMs;
  if (t <= b[0] - first / 2) return -Math.PI;
  if (t <= b[0]) return (2 * Math.PI * (t - b[0])) / first;
  for (let i = 0; i < b.length - 1; i++) if (t <= b[i + 1]) return (2 * Math.PI * (t - b[i])) / (b[i + 1] - b[i]) - (t - b[i] > (b[i + 1] - b[i]) / 2 ? 2 * Math.PI : 0);
  const last = b.length > 1 ? b[b.length - 1] - b[b.length - 2] : first;
  return Math.min(Math.PI, (2 * Math.PI * (t - b[b.length - 1])) / last);
}

export function countCleared(results: SweepResult[], from = 0, to = results.length) {
  return results.slice(from, to).filter((r) => r.cleared).length;
}

export type DecidedBy = 'score' | 'suddenDeath' | 'timing' | 'verdict';

export interface RopeVerdict {
  /** Piece that holds life afterwards. */
  winner: number;
  /** Cleared jumps out of the eight scored sweeps, per participant. */
  scores: number[];
  decidedBy: DecidedBy;
  /** Pieces that entered the tiebreak (empty when the score decided it). */
  finalists: number[];
  extraSweepsUsed: number;
  /** Mean absolute timing error over the eight scored sweeps, per participant. */
  meanError: number[];
}

/**
 * Everyone jumps the same rope. The most cleared jumps wins. Tied leaders
 * (and only they) go to up to four sudden-death sweeps; after each sweep only
 * those with the best sudden-death tally stay in. Still tied: the lowest mean
 * timing error on the eight scored sweeps. Still exactly tied: the Reaper's
 * seeded verdict, announced as such. Exactly one winner always comes out.
 */
export function judgeRope(seed: number, participants: number[], inputs: ChallengeInput[][], multipliers: number[]): RopeVerdict {
  const c = CHALLENGE.rope;
  const sched = ropeSchedule(seed);
  const res = participants.map((_, k) => judgeRopeSweeps(sched, inputs[k] ?? [], multipliers[k] ?? 1));
  const scores = res.map((r) => countCleared(r, 0, c.sweeps));
  const meanError = res.map((r) => r.slice(0, c.sweeps).reduce((s, x) => s + x.error, 0) / c.sweeps);
  const top = Math.max(...scores);
  let alive = participants.map((_, k) => k).filter((k) => scores[k] === top);
  const base = { scores, meanError };
  if (alive.length === 1) return { ...base, winner: participants[alive[0]], decidedBy: 'score', finalists: [], extraSweepsUsed: 0 };
  const finalists = alive.map((k) => participants[k]);
  const tally = new Map<number, number>(alive.map((k) => [k, 0]));
  for (let i = 0; i < c.extraSweeps; i++) {
    for (const k of alive) if (res[k][c.sweeps + i].cleared) tally.set(k, tally.get(k)! + 1);
    const best = Math.max(...alive.map((k) => tally.get(k)!));
    alive = alive.filter((k) => tally.get(k) === best);
    if (alive.length === 1) return { ...base, winner: participants[alive[0]], decidedBy: 'suddenDeath', finalists, extraSweepsUsed: i + 1 };
  }
  const bestErr = Math.min(...alive.map((k) => meanError[k]));
  alive = alive.filter((k) => meanError[k] === bestErr);
  if (alive.length === 1) return { ...base, winner: participants[alive[0]], decidedBy: 'timing', finalists, extraSweepsUsed: c.extraSweeps };
  const pick = Math.floor(stream(seed ^ 0xc0115e)() * alive.length);
  return { ...base, winner: participants[alive[pick]], decidedBy: 'verdict', finalists, extraSweepsUsed: c.extraSweeps };
}

/** On-screen length of a challenge including sudden death, for timeouts. */
export function challengeDurationMs(seed: number): number {
  return CHALLENGE.readyMs + ropeSchedule(seed).totalMs;
}

// ── Seeded bot inputs ───────────────────────────────────────────────────

export interface ReflexSkill {
  /** Standard deviation of timing error, ms. */
  jitterMs: number;
  /** Chance of simply not pressing on a given sweep. */
  lapse: number;
}

export const SKILLS: Record<'shaky' | 'steady' | 'sharp', ReflexSkill> = {
  shaky: { jitterMs: 150, lapse: 0.1 },
  steady: { jitterMs: 105, lapse: 0.06 },
  sharp: { jitterMs: 75, lapse: 0.03 },
};

/**
 * Presses a bot makes, in the same format humans produce. Each piece has its
 * own stream (seed mixed with the piece), so two bots with the same skill do
 * not mirror each other. Bots know their own (possibly cursed) jump length,
 * just as a person sees their own character's shorter hop.
 */
export function botRopeInputs(seed: number, piece: number, skill: ReflexSkill, multiplier = 1): ChallengeInput[] {
  const r = stream((seed ^ Math.imul(piece + 1, 0x9e3779b1)) >>> 0);
  const gauss = () => {
    const u = Math.max(1e-9, r());
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out: ChallengeInput[] = [];
  const c = CHALLENGE.rope;
  // A bot jumps so the middle of its own jump meets the rope, as a person learns to.
  const half = airTime(multiplier) / 2;
  ropeSchedule(seed).bottoms.forEach((b, i) => {
    if (r() < skill.lapse) return;
    // A faster rope is harder to time: error grows with the square root of the speed-up.
    const speedUp = i === 0 ? 1 : c.periodMs / sweepPeriod(i);
    out.push({ t: Math.round(b - half + gauss() * skill.jitterMs * Math.sqrt(speedUp)) });
  });
  return out;
}

/** Keep only well-formed, bounded input lists (for anything coming off the network). */
export function sanitizeInputs(raw: unknown, maxLen = 64): ChallengeInput[] | null {
  if (!Array.isArray(raw) || raw.length > maxLen) return null;
  const out: ChallengeInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    if (typeof o.t !== 'number' || !Number.isFinite(o.t) || o.t < -5000 || o.t > 60000) return null;
    out.push({ t: Math.round(o.t) });
  }
  return out;
}
