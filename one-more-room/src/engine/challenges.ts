// Survival games as pure data. A challenge's seed fixes its whole schedule
// (escape zones, dance sequences, rope sweep times). Inputs are timestamps
// measured against the animation the player actually saw; these judges turn
// them into outcomes. Humans and bots go through exactly the same judges, so
// the authority never has to trust a client-reported "I won".

import { CHALLENGE } from './config';
import { nextFloat } from './rng';

export type ChallengeKind = 'escape' | 'dance' | 'rope' | 'duel';

/** One button press. `a` is the attempt (escape, dance); `d` a direction 0–3 (dance). */
export interface ChallengeInput {
  t: number;
  a?: number;
  d?: number;
}

function stream(seed: number) {
  let s = seed >>> 0;
  return () => {
    let v: number;
    [v, s] = nextFloat(s);
    return v;
  };
}

// ── Break the Curse: the timing ring ────────────────────────────────────

export interface EscapeSchedule {
  periodMs: number;
  gapMs: number;
  /** Zone centre per attempt, degrees clockwise from the top. */
  zones: number[];
  zoneDeg: number;
  /** Start of each attempt, ms after the ready countdown ends. */
  starts: number[];
  totalMs: number;
}

export function escapeSchedule(seed: number): EscapeSchedule {
  const r = stream(seed ^ 0x51ed27);
  const c = CHALLENGE.escape;
  const zones = Array.from({ length: c.attempts }, () => Math.round(80 + r() * 200));
  const starts = zones.map((_, i) => i * (c.periodMs + c.gapMs));
  return { periodMs: c.periodMs, gapMs: c.gapMs, zones, zoneDeg: c.zoneDeg, starts, totalMs: starts[starts.length - 1] + c.periodMs };
}

export function markerAngle(sched: EscapeSchedule, tInAttempt: number): number {
  return ((tInAttempt / sched.periodMs) * 360) % 360;
}

function angleDiff(a: number, b: number) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

/** Inputs carry the attempt index and ms since that attempt started. */
export function judgeEscape(seed: number, inputs: ChallengeInput[]): { survived: boolean; hits: boolean[] } {
  const sched = escapeSchedule(seed);
  const hits = sched.zones.map((zone, a) => {
    const press = inputs.filter((i) => (i.a ?? 0) === a && i.t >= 0 && i.t <= sched.periodMs).sort((x, y) => x.t - y.t)[0];
    if (!press) return false;
    return angleDiff(markerAngle(sched, press.t), zone) <= sched.zoneDeg / 2;
  });
  // One hit is enough; a hit on the first attempt ends the game early.
  const survived = hits.some(Boolean);
  return { survived, hits };
}

// ── Dance for Death ─────────────────────────────────────────────────────

export const DIRECTIONS = ['up', 'right', 'down', 'left'] as const;

export interface DanceSchedule {
  sequences: number[][];
  symbolMs: number;
  gapMs: number;
  answerMs: number;
  /** How long the sequence is shown before answers count. */
  showMs: number;
}

export function danceSchedule(seed: number): DanceSchedule {
  const r = stream(seed ^ 0xda7ce);
  const c = CHALLENGE.dance;
  const sequences = Array.from({ length: c.attempts }, () => {
    const seq: number[] = [];
    while (seq.length < c.length) {
      const d = Math.floor(r() * 4);
      // Never three of the same in a row: keeps it readable.
      if (seq.length >= 2 && seq[seq.length - 1] === d && seq[seq.length - 2] === d) continue;
      seq.push(d);
    }
    return seq;
  });
  return { sequences, symbolMs: c.symbolMs, gapMs: c.gapMs, answerMs: c.answerMs, showMs: c.length * (c.symbolMs + c.gapMs) };
}

/** Inputs: attempt index, ms since that attempt's answer window opened, and direction. */
export function judgeDance(seed: number, inputs: ChallengeInput[]): { survived: boolean; attempts: boolean[] } {
  const sched = danceSchedule(seed);
  const attempts = sched.sequences.map((seq, a) => {
    const presses = inputs
      .filter((i) => (i.a ?? 0) === a && i.t >= 0 && i.t <= sched.answerMs && i.d !== undefined)
      .sort((x, y) => x.t - y.t);
    if (presses.length < seq.length) return false;
    // A wrong input ends the attempt.
    return seq.every((d, k) => presses[k].d === d);
  });
  return { survived: attempts.some(Boolean), attempts };
}

// ── Haunted / Graveyard Jump Rope ───────────────────────────────────────

export interface RopeSchedule {
  /** Time each sweep reaches the floor, ms after the ready countdown. */
  bottoms: number[];
  sweeps: number;
  extraSweeps: number;
  totalMs: number;
}

export function ropeSchedule(seed: number, withExtras: boolean): RopeSchedule {
  const r = stream(seed ^ 0x40be);
  const c = CHALLENGE.rope;
  const n = c.sweeps + (withExtras ? c.extraSweeps : 0);
  const bottoms = Array.from({ length: n }, (_, i) => Math.round(c.firstMs + i * c.periodMs + (r() * 2 - 1) * c.jitterMs));
  return { bottoms, sweeps: c.sweeps, extraSweeps: withExtras ? c.extraSweeps : 0, totalMs: bottoms[n - 1] + 500 };
}

export interface SweepResult {
  cleared: boolean;
  /** Absolute timing error in ms (a miss scores the fixed maximum). */
  error: number;
}

/**
 * Judge one jumper. Each sweep has one window; only the first press inside it
 * counts, so holding or mashing never helps. A press clears the rope when the
 * jumper is in the air as the rope passes underneath.
 */
export function judgeRopeSweeps(sched: RopeSchedule, inputs: ChallengeInput[]): SweepResult[] {
  const c = CHALLENGE.rope;
  const presses = inputs.map((i) => i.t).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  return sched.bottoms.map((b) => {
    const p = presses.find((t) => t >= b - c.windowMs && t <= b + c.lateMs);
    if (p === undefined) return { cleared: false, error: c.missErrorMs };
    const lead = b - p;
    const cleared = lead >= c.airMinMs && lead <= c.airMaxMs;
    return { cleared, error: Math.min(c.missErrorMs, Math.abs(lead - c.idealMs)) };
  });
}

export function countCleared(results: SweepResult[], from = 0, to = results.length) {
  return results.slice(from, to).filter((r) => r.cleared).length;
}

export interface DuelVerdict {
  survivors: number[];
  scores: number[];
  /** How a one-survivor duel was decided. */
  decidedBy: 'threshold' | 'score' | 'suddenDeath' | 'timing' | 'curse';
  extraSweepsUsed: number;
}

/**
 * Two jumpers on the same rope. Without `oneSurvivor` each needs `pass` of 8.
 * With it, the higher score lives; ties go to up to four sudden-death sweeps,
 * then total timing error, then a seeded coin the game announces.
 */
export function judgeDuel(seed: number, seats: [number, number], inputs: [ChallengeInput[], ChallengeInput[]], oneSurvivor: boolean): DuelVerdict {
  const c = CHALLENGE.rope;
  const sched = ropeSchedule(seed, oneSurvivor);
  const res = inputs.map((inp) => judgeRopeSweeps(sched, inp));
  const scores = res.map((r) => countCleared(r, 0, c.sweeps));
  if (!oneSurvivor) {
    return { survivors: seats.filter((_, k) => scores[k] >= c.pass), scores, decidedBy: 'threshold', extraSweepsUsed: 0 };
  }
  if (scores[0] !== scores[1]) return { survivors: [seats[scores[0] > scores[1] ? 0 : 1]], scores, decidedBy: 'score', extraSweepsUsed: 0 };
  for (let i = c.sweeps; i < c.sweeps + c.extraSweeps; i++) {
    if (res[0][i].cleared !== res[1][i].cleared) {
      return { survivors: [seats[res[0][i].cleared ? 0 : 1]], scores, decidedBy: 'suddenDeath', extraSweepsUsed: i - c.sweeps + 1 };
    }
  }
  const err = res.map((r) => r.reduce((sum, x) => sum + x.error, 0));
  if (err[0] !== err[1]) return { survivors: [seats[err[0] < err[1] ? 0 : 1]], scores, decidedBy: 'timing', extraSweepsUsed: c.extraSweeps };
  const coin = stream(seed ^ 0xc0115e)() < 0.5 ? 0 : 1;
  return { survivors: [seats[coin]], scores, decidedBy: 'curse', extraSweepsUsed: c.extraSweeps };
}

export function judgeSoloRope(seed: number, inputs: ChallengeInput[]): { survived: boolean; score: number } {
  const sched = ropeSchedule(seed, false);
  const score = countCleared(judgeRopeSweeps(sched, inputs));
  return { survived: score >= CHALLENGE.rope.pass, score };
}

/** Rough on-screen length of a challenge, for timeouts and fast-forward. */
export function challengeDurationMs(kind: ChallengeKind, seed: number, oneSurvivor: boolean): number {
  const ready = CHALLENGE.readyMs;
  if (kind === 'escape') return ready + escapeSchedule(seed).totalMs;
  if (kind === 'dance') {
    const d = danceSchedule(seed);
    return ready + d.sequences.length * (d.showMs + d.answerMs);
  }
  return ready + ropeSchedule(seed, kind === 'duel' && oneSurvivor).totalMs;
}

// ── Seeded bot inputs ───────────────────────────────────────────────────

export interface ReflexSkill {
  /** Standard deviation of timing error, ms. */
  jitterMs: number;
  /** Chance of simply not pressing on a given attempt/sweep. */
  lapse: number;
  /** Chance of misremembering one dance symbol. */
  memoryError: number;
}

export const SKILLS: Record<'shaky' | 'steady' | 'sharp', ReflexSkill> = {
  shaky: { jitterMs: 150, lapse: 0.12, memoryError: 0.14 },
  steady: { jitterMs: 105, lapse: 0.07, memoryError: 0.08 },
  sharp: { jitterMs: 70, lapse: 0.04, memoryError: 0.04 },
};

/**
 * Presses a bot makes, through the same input format humans produce. Each
 * seat has its own stream (seed mixed with the seat), so two bots with the
 * same skill do not mirror each other.
 */
export function botChallengeInputs(kind: ChallengeKind, seed: number, seat: number, skill: ReflexSkill, oneSurvivor: boolean): ChallengeInput[] {
  const r = stream((seed ^ Math.imul(seat + 1, 0x9e3779b1)) >>> 0);
  const gauss = () => {
    const u = Math.max(1e-9, r());
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  if (kind === 'escape') {
    const sched = escapeSchedule(seed);
    const out: ChallengeInput[] = [];
    for (let a = 0; a < sched.zones.length; a++) {
      if (r() < skill.lapse) continue;
      const ideal = (sched.zones[a] / 360) * sched.periodMs;
      out.push({ a, t: Math.max(0, Math.round(ideal + gauss() * skill.jitterMs * 1.3)) });
      if (judgeEscape(seed, out).hits[a]) break;
    }
    return out;
  }
  if (kind === 'dance') {
    const sched = danceSchedule(seed);
    const out: ChallengeInput[] = [];
    sched.sequences.forEach((seq, a) => {
      let t = 700 + r() * 500;
      for (const d of seq) {
        const slip = r() < skill.memoryError;
        out.push({ a, t: Math.round(t), d: slip ? (d + 1 + Math.floor(r() * 3)) % 4 : d });
        t += 350 + r() * 400;
      }
    });
    return out;
  }
  const sched = ropeSchedule(seed, kind === 'duel' && oneSurvivor);
  const out: ChallengeInput[] = [];
  for (const b of sched.bottoms) {
    if (r() < skill.lapse) continue;
    out.push({ t: Math.round(b - CHALLENGE.rope.idealMs + gauss() * skill.jitterMs) });
  }
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
    const item: ChallengeInput = { t: Math.round(o.t) };
    if (o.a !== undefined) {
      if (!Number.isInteger(o.a) || (o.a as number) < 0 || (o.a as number) > 3) return null;
      item.a = o.a as number;
    }
    if (o.d !== undefined) {
      if (!Number.isInteger(o.d) || (o.d as number) < 0 || (o.d as number) > 3) return null;
      item.d = o.d as number;
    }
    out.push(item);
  }
  return out;
}
