// Haunted Jump Rope as pure data. A challenge's seed fixes the whole rope
// schedule, shared by every participant. Inputs are timestamps measured
// against the animation the player actually saw; the judge turns them into
// one winner. Humans and bots go through exactly the same judge, so the
// authority never trusts a client-reported score, and nothing depends on the
// order in which results arrived.

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
  /** Time each sweep reaches the floor, ms after the ready countdown. */
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
    const wobble = c.jitterMs * (i > 0 ? sweepPeriod(i) / c.periodMs : 1);
    bottoms.push(Math.round(base + (r() * 2 - 1) * wobble));
  }
  return { bottoms, sweeps: c.sweeps, extraSweeps: c.extraSweeps, mainMs: bottoms[c.sweeps - 1] + 500, totalMs: bottoms[n - 1] + 500 };
}

/**
 * A jumper's personal clearance window, as lead times before the rope hits
 * the floor. The curse multiplier narrows it around the ideal moment; the
 * rope itself is the same for everyone.
 */
export function clearanceWindow(multiplier: number): { minLead: number; maxLead: number } {
  const c = CHALLENGE.rope;
  const half = c.halfWindowMs * multiplier;
  return { minLead: c.idealMs - half, maxLead: c.idealMs + half };
}

export interface SweepResult {
  cleared: boolean;
  /** Absolute timing error in ms (a miss scores the fixed maximum). */
  error: number;
  /** Time of the press that counted, if any. */
  press: number | null;
}

/**
 * Judge one jumper. Each sweep has one window; only the first press inside
 * it counts, so holding or mashing never creates extra jumps.
 */
export function judgeRopeSweeps(sched: RopeSchedule, inputs: ChallengeInput[], multiplier = 1): SweepResult[] {
  const c = CHALLENGE.rope;
  const { minLead, maxLead } = clearanceWindow(multiplier);
  const presses = inputs.map((i) => i.t).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  return sched.bottoms.map((b) => {
    const p = presses.find((t) => t >= b - c.windowMs && t <= b + c.lateMs);
    if (p === undefined) return { cleared: false, error: c.missErrorMs, press: null };
    const lead = b - p;
    return { cleared: lead >= minLead && lead <= maxLead, error: Math.min(c.missErrorMs, Math.abs(lead - c.idealMs)), press: p };
  });
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
 * not mirror each other. Bots aim at the ideal moment whatever their curse:
 * the curse only narrows how the judge scores them, exactly as for humans.
 */
export function botRopeInputs(seed: number, piece: number, skill: ReflexSkill): ChallengeInput[] {
  const r = stream((seed ^ Math.imul(piece + 1, 0x9e3779b1)) >>> 0);
  const gauss = () => {
    const u = Math.max(1e-9, r());
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out: ChallengeInput[] = [];
  const c = CHALLENGE.rope;
  ropeSchedule(seed).bottoms.forEach((b, i) => {
    if (r() < skill.lapse) return;
    // A faster rope is harder to time: error grows with the square root of the speed-up.
    const speedUp = i === 0 ? 1 : c.periodMs / sweepPeriod(i);
    out.push({ t: Math.round(b - c.idealMs + gauss() * skill.jitterMs * Math.sqrt(speedUp)) });
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
