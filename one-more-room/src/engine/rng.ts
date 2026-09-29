// Seeded RNG (mulberry32). The whole generator state is one uint32 that lives
// inside the game snapshot, so saving, undo and replay reproduce every roll
// and every shuffle exactly.

export function seedFrom(input: number | string): number {
  if (typeof input === 'number') return input >>> 0;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Returns a float in [0, 1) and the next generator state. */
export function nextFloat(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

export function rollDie(state: number): [number, number] {
  const [v, s] = nextFloat(state);
  return [1 + Math.floor(v * 6), s];
}

/** Fisher–Yates shuffle; returns a new array and the next state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let v: number;
    [v, s] = nextFloat(s);
    const j = Math.floor(v * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
