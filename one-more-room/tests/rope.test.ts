// Haunted Jump Rope as physics: a press is one visible jump, and a sweep
// counts only if the feet are above the rope as it passes. The renderer draws
// jumperTimeline's jumps, so these tests pin what the screen shows to what
// the judge scores.

import { describe, expect, it } from 'vitest';
import { CHALLENGE, CURSE_MULTIPLIERS } from '../src/engine/config';
import { airTime, botRopeInputs, clearSpan, judgeRope, judgeRopeSweeps, jumperTimeline, jumpHeight, practiceSchedule, ropeAngle, ropeSchedule, SKILLS } from '../src/engine/challenges';

const c = CHALLENGE.rope;
const centred = (bottoms: number[], m = 1) => bottoms.map((b) => ({ t: b - airTime(m) / 2 }));

describe('a press is one jump', () => {
  it('takes off at the press and lands one air time later', () => {
    const sch = ropeSchedule(7);
    const tl = jumperTimeline(sch, [{ t: 1000 }], 1);
    expect(tl.jumps[0]).toEqual({ start: 1000, end: 1000 + c.airMs });
  });

  it('holding, key-repeat, mashing and duplicate messages never add or heighten jumps', () => {
    const sch = ropeSchedule(11);
    const one = jumperTimeline(sch, [{ t: 1300 }], 1);
    // The same press repeated, and presses every 30 ms while airborne: still one jump.
    const spam = jumperTimeline(sch, [1300, 1300, 1330, 1360, 1400, 1500, 1600, 1700, 1800].map((t) => ({ t })), 1);
    expect(spam.jumps[0]).toEqual(one.jumps[0]);
    expect(spam.jumps.filter((j) => j.start < 1300 + c.airMs + c.groundMs).length).toBe(1);
    // Jump heights never exceed a single jump's peak.
    for (let t = 0; t < 1000; t += 10) expect(jumpHeight(t)).toBeLessThanOrEqual(1);
  });

  it('a character must land (and steady itself) before jumping again', () => {
    const sch = { bottoms: [9000], sweeps: 1, extraSweeps: 0, mainMs: 9500, totalMs: 9500 };
    const tl = jumperTimeline(sch, [{ t: 1000 }, { t: 1000 + c.airMs + c.groundMs - 1 }, { t: 1000 + c.airMs + c.groundMs + 5 }], 1);
    expect(tl.jumps.map((j) => j.start)).toEqual([1000, 1000 + c.airMs + c.groundMs + 5]);
  });

  it('mashing scores far less than timed jumping', () => {
    let mashed = 0;
    let timed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const sch = ropeSchedule(seed);
      const mash = Array.from({ length: 300 }, (_, i) => ({ t: i * 40 }));
      mashed += judgeRope(seed, [0], [mash], [1]).scores[0];
      timed += judgeRope(seed, [0], [centred(sch.bottoms)], [1]).scores[0];
    }
    expect(timed / 200).toBe(8);
    expect(mashed / 200).toBeLessThan(6);
  });
});

describe('what the screen shows is what the judge scores', () => {
  it('a sweep is cleared exactly when the drawn feet are above the rope as it passes', () => {
    for (const m of [...new Set(CURSE_MULTIPLIERS)]) {
      for (let lead = -50; lead <= 700; lead += 7) {
        const sch = { bottoms: [3000], sweeps: 1, extraSweeps: 0, mainMs: 3500, totalMs: 3500 };
        const [r] = judgeRopeSweeps(sch, [{ t: 3000 - lead }], m);
        const feet = jumpHeight(lead, m);
        // Allow a hair at the exact boundary (same formula, floating point).
        if (Math.abs(feet - c.ropeHeightFrac) > 1e-6) expect(r.cleared).toBe(feet > c.ropeHeightFrac);
      }
    }
  });

  it('caught by the rope: a stumble, the jump cut short, and no take-off until it passes', () => {
    const sch = { bottoms: [2000, 4000], sweeps: 2, extraSweeps: 0, mainMs: 4500, totalMs: 4500 };
    const tl = jumperTimeline(sch, [{ t: 1990 }, { t: 2100 }, { t: 2000 + c.stumbleMs + 10 }], 1);
    expect(tl.results[0].cleared).toBe(false); // jumped 10 ms too late: feet still low
    expect(tl.stumbles).toContain(2000);
    expect(tl.jumps[0].end).toBe(2000);
    expect(tl.jumps.map((j) => j.start)).toEqual([1990, 2000 + c.stumbleMs + 10]);
  });

  it('the rope is at the feet at every floor pass and at the top before and after', () => {
    const sch = ropeSchedule(5);
    for (const b of sch.bottoms) expect(Math.abs(ropeAngle(sch, b))).toBeLessThan(1e-9);
    expect(Math.abs(ropeAngle(sch, 0))).toBeCloseTo(Math.PI);
    expect(Math.abs(ropeAngle(sch, sch.totalMs + 2000))).toBeCloseTo(Math.PI);
    // Between two passes it goes over the top exactly once.
    const b0 = sch.bottoms[3];
    const b1 = sch.bottoms[4];
    expect(Math.abs(ropeAngle(sch, (b0 + b1) / 2))).toBeCloseTo(Math.PI, 1);
  });
});

describe('the acceleration and the curse stay jumpable', () => {
  it('a well-timed jumper clears every sweep, sudden death included, at every curse level', () => {
    for (let seed = 1; seed < 300; seed++) {
      const sch = ropeSchedule(seed);
      for (const m of [...new Set(CURSE_MULTIPLIERS)]) {
        const tl = jumperTimeline(sch, centred(sch.bottoms, m), m);
        expect(tl.results.every((r) => r.cleared)).toBe(true);
      }
    }
  });

  it('the curse shortens the clear span but always leaves a real one', () => {
    let prev = Infinity;
    for (const m of [1, 0.9, 0.8, 0.7]) {
      const span = clearSpan(m);
      expect(span.to - span.from).toBeLessThan(prev);
      expect(span.to - span.from).toBeGreaterThan(250);
      prev = span.to - span.from;
    }
  });

  it('bots are good, not perfect: steady bots clear most sweeps and sometimes miss', () => {
    let total = 0;
    let perfect = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const v = judgeRope(seed, [0], [botRopeInputs(seed, 0, SKILLS.steady)], [1]);
      total += v.scores[0];
      if (v.scores[0] === 8) perfect++;
    }
    expect(total / 300).toBeGreaterThan(6.2);
    expect(total / 300).toBeLessThan(7.8);
    expect(perfect).toBeLessThan(250);
  });

  it('practice is three slow, even sweeps', () => {
    const p = practiceSchedule();
    expect(p.bottoms.length).toBe(3);
    expect(p.bottoms[1] - p.bottoms[0]).toBe(p.bottoms[2] - p.bottoms[1]);
  });
});
