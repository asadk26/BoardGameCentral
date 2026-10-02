// Board and balance data for One More Room: One Life.
// Everything a designer might want to rebalance lives here, not in the rules.

export type NodeKind = 'entrance' | 'room' | 'secret' | 'corridor';

export type RoomKey = 'kitchen' | 'dining' | 'conservatory' | 'attic' | 'crypt' | 'laboratory' | 'nursery' | 'library';

export const NODE_COUNT = 32;
/** The Entrance Hall: now an ordinary space, and where the first life appears. */
export const ENTRANCE = 0;
export const ROUNDS = 10;
/** Board pieces (a piece is one person, a pair of teammates, or a bot). */
export const MIN_PIECES = 2;
export const MAX_PIECES = 4;
/** Up to two people share a piece in Team Battle. */
export const MAX_CONTROLLERS_PER_PIECE = 2;

/** Ordinary undirected edges: the 32-node ring plus two cross corridors. */
export const ORDINARY_EDGES: ReadonlyArray<readonly [number, number]> = [
  ...Array.from({ length: NODE_COUNT }, (_, i) => [i, (i + 1) % NODE_COUNT] as const),
  [4, 12],
  [20, 28],
];

/** Secret passage edges (any piece; at most one per move). Pair A and pair B. */
export const SECRET_EDGES: ReadonlyArray<readonly [number, number]> = [
  [8, 24],
  [11, 27],
];
export const SECRET_ENDPOINTS: readonly number[] = [8, 11, 24, 27];

/** Ghost-only links through a wall, one step each: dining↔conservatory, laboratory↔nursery. */
export const GHOST_WALL_LINKS: ReadonlyArray<readonly [number, number]> = [
  [7, 10],
  [22, 25],
];
export const WALL_LINK_ENDPOINTS: readonly number[] = [7, 10, 22, 25];

// ── Starting positions ──────────────────────────────────────────────────

/** The first living piece starts here. */
export const LIVING_SPAWN = ENTRANCE;
/** Ghost start spaces, handed out to the ghosts in a seeded random order. */
export const GHOST_SPAWNS: readonly number[] = [8, 16, 24];

// ── Movement ────────────────────────────────────────────────────────────

// Every piece moves exactly the number it rolls, one space at a time,
// choosing a direction only where the corridor forks (see graph.exitsFrom).

// ── Turn order and protection policy (tuning knobs, not game modes) ─────

export const POLICY = {
  /**
   * Hunters after the round's first (living) piece follow the seat order,
   * starting from a seat that advances by one each round.
   */
  rotateHunters: true,
  /** A duel's loser is pushed exactly this many ordinary steps away. */
  loserRetreatSteps: 2,
  /** A Poltergeist throws a piece at least this many ordinary steps. */
  poltergeistMinSteps: 3,
  /** Ghost-versus-ghost battles for items (off only for baseline simulations). */
  ghostBattles: true,
};

// ── Ghost battles and items ─────────────────────────────────────────────

/**
 * Visible Versus spaces (two of the former Trick-or-Treat corridors, far
 * apart): a ghost ending a normal move here may battle any other ghost.
 */
export const VERSUS_SPACES: readonly number[] = [5, 23];

export type ItemId = 'secondRoll' | 'ghostSwitch' | 'ghostlyStride';

/** Reward odds, in draw order. These are the requested starting values. */
export const ITEM_WEIGHTS: ReadonlyArray<readonly [ItemId, number]> = [
  ['secondRoll', 0.4],
  ['ghostSwitch', 0.4],
  ['ghostlyStride', 0.2],
];

/** Presumed strength, weakest first (used by bots deciding keep or replace). */
export const ITEM_POWER: readonly ItemId[] = ['secondRoll', 'ghostSwitch', 'ghostlyStride'];

/** Ghostly Stride: this many movement spaces instead of a roll. */
export const STRIDE_ALLOWANCE = 6;

/** Map a uniform draw in [0, 1) to an item by the weights above. */
export function itemFromDraw(u: number): ItemId {
  let acc = 0;
  for (const [item, w] of ITEM_WEIGHTS) {
    acc += w;
    if (u < acc) return item;
  }
  return ITEM_WEIGHTS[ITEM_WEIGHTS.length - 1][0];
}

// ── The Reaper and the traps ────────────────────────────────────────────

/** The one permanently visible Super Reaper, beside the 4–12 passage. */
export const SUPER_REAPER = 12;
/** Exactly this many hidden traps, whatever the piece count. */
export const TRAP_COUNT = 6;
export type TrapEffect = 'reaper' | 'seance' | 'poltergeist';
/** The six hidden effects, shuffled privately over the six trap spaces. */
export const TRAP_EFFECTS: readonly TrapEffect[] = ['reaper', 'reaper', 'seance', 'seance', 'poltergeist', 'poltergeist'];
/** Séances (hidden tiles and the Super Reaper together) allowed per match. */
export const SEANCE_LIMIT = 2;

/** Former Trick-or-Treat spaces that keep their decorations (5 and 23 are now Versus spaces). */
export const DECORATED_CORRIDORS: readonly number[] = [5, 13, 23];

/** Mansion wings used to spread computer-filled traps around. */
export const TRAP_WINGS: Record<string, readonly number[]> = { west: [2, 4, 6, 9], north: [13, 14, 18, 19], east: [20, 21, 26, 28, 30] };

/** Timings for Haunted Jump Rope, in milliseconds. */
export const CHALLENGE = {
  readyMs: 3000,
  rope: {
    sweeps: 8,
    extraSweeps: 4,
    /**
     * The shared rope speeds up after every sweep: the gap before sweep k is
     * periodMs × accel^k, never below minPeriodMs. Everyone faces the same
     * acceleration; sudden death runs at top speed.
     */
    periodMs: 1300,
    accel: 0.935,
    minPeriodMs: 800,
    firstMs: 1100,
    /** Random wobble on each floor pass, scaled with the current period. */
    jitterMs: 110,
    /** A press this long before the rope reaches the floor is a perfect jump. */
    idealMs: 250,
    /** Normal clearance window: lead time within ±halfWindowMs of ideal. */
    halfWindowMs: 180,
    /**
     * Presses are matched to a sweep within this span before / after the
     * floor. Small enough that neighbouring sweeps never overlap at top speed.
     */
    windowMs: 560,
    lateMs: 60,
    /** Timing error charged for a missed sweep. */
    missErrorMs: 600,
  },
};

/**
 * The survival curse: the longer a piece has held life, the narrower its
 * jump window. Indexed by consecutive rounds scored alive (capped).
 */
export const CURSE_MULTIPLIERS: readonly number[] = [1, 1, 0.9, 0.8, 0.7];

export function curseMultiplier(streak: number): number {
  return CURSE_MULTIPLIERS[Math.min(Math.max(0, streak), CURSE_MULTIPLIERS.length - 1)];
}

export const ROOMS: Record<number, { key: RoomKey; defaultName: string }> = {
  3: { key: 'kitchen', defaultName: 'Kitchen' },
  7: { key: 'dining', defaultName: 'Dining Room' },
  10: { key: 'conservatory', defaultName: 'Conservatory' },
  15: { key: 'attic', defaultName: 'Attic' },
  17: { key: 'crypt', defaultName: 'Crypt' },
  22: { key: 'laboratory', defaultName: 'Laboratory' },
  25: { key: 'nursery', defaultName: 'Nursery' },
  29: { key: 'library', defaultName: 'Library' },
};

export function nodeKind(id: number): NodeKind {
  if (id === ENTRANCE) return 'entrance';
  if (ROOMS[id]) return 'room';
  if (SECRET_ENDPOINTS.includes(id)) return 'secret';
  return 'corridor';
}

/**
 * Where a trap may be hidden: corridor spaces, never a spawn, the entrance or
 * its neighbours, a shortcut end, a room, or the Super Reaper.
 */
export function trapEligible(id: number): boolean {
  if (nodeKind(id) !== 'corridor') return false;
  if (id === SUPER_REAPER || id === LIVING_SPAWN || GHOST_SPAWNS.includes(id)) return false;
  if (id === 1 || id === NODE_COUNT - 1) return false; // the entrance's neighbours
  if (SECRET_ENDPOINTS.includes(id) || WALL_LINK_ENDPOINTS.includes(id)) return false;
  if (VERSUS_SPACES.includes(id)) return false;
  return true;
}
export const TRAP_ELIGIBLE: readonly number[] = Array.from({ length: NODE_COUNT }, (_, i) => i).filter(trapEligible);
if (TRAP_ELIGIBLE.length < TRAP_COUNT) throw new Error('Fewer eligible trap spaces than traps');
if (VERSUS_SPACES.some((n) => n === SUPER_REAPER || GHOST_SPAWNS.includes(n) || n === LIVING_SPAWN))
  throw new Error('A Versus space collides with a fixed space');

export function secretPairLabel(id: number): 'A' | 'B' | null {
  if (id === 8 || id === 24) return 'A';
  if (id === 11 || id === 27) return 'B';
  return null;
}

/**
 * Board-space layout (x east, z south), in world units. The entrance sits at
 * the south of the central hall; the west and east wings are the two side
 * loops; the attic, crypt and the old ghost's lair run along the north gallery.
 */
export const NODE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 8], // 0 entrance hall
  [-2, 8], // 1
  [-4, 8], // 2
  [-4, 6], // 3 kitchen
  [-4, 4], // 4 junction to west wing
  [-6, 4], // 5 Versus space
  [-8, 4], // 6
  [-10, 4], // 7 dining room
  [-10, 2], // 8 secret A
  [-10, 0], // 9
  [-8, 0], // 10 conservatory
  [-6, 0], // 11 secret B
  [-4, 0], // 12 Super Reaper
  [-4, -2], // 13 decorated corridor
  [-4, -4], // 14
  [-2, -4], // 15 attic
  [0, -4], // 16 the lair (a ghost start)
  [2, -4], // 17 crypt
  [4, -4], // 18
  [4, -2], // 19
  [4, 0], // 20 junction to east wing
  [6, 0], // 21
  [8, 0], // 22 laboratory
  [10, 0], // 23 Versus space
  [10, 2], // 24 secret A
  [10, 4], // 25 nursery
  [8, 4], // 26
  [6, 4], // 27 secret B
  [4, 4], // 28 junction
  [4, 6], // 29 library
  [4, 8], // 30
  [2, 8], // 31
];

export type CharacterId = 'knight' | 'goblin' | 'witch' | 'zombie' | 'skeleton' | 'vampire';

export const CHARACTERS: ReadonlyArray<{ id: CharacterId; name: string; color: string; blurb: string }> = [
  { id: 'knight', name: 'Knight', color: '#e0564a', blurb: 'Tin-foil courage, feathered plume.' },
  { id: 'goblin', name: 'Goblin', color: '#62b54a', blurb: 'Big ears, quick feet.' },
  { id: 'witch', name: 'Witch', color: '#9b6ce0', blurb: 'Pointy hat, trusty broom.' },
  { id: 'zombie', name: 'Zombie', color: '#4fb3a4', blurb: 'Has been dead before. Did not enjoy it.' },
  { id: 'skeleton', name: 'Skeleton', color: '#e8d9a8', blurb: 'All bones, great at jumping.' },
  { id: 'vampire', name: 'Vampire', color: '#d8456f', blurb: 'Knows a thing or two about living forever.' },
];

export const DEFAULT_PLAYER_NAMES = ['Maya', 'Leo', 'Priya', 'Sam', 'Noor', 'Theo', 'Ana', 'Kofi'];
export const DEFAULT_MANSION_NAME = 'Blackthorn Manor';

export const TEXT_LIMITS = {
  playerName: 16,
  mansionName: 28,
  roomName: 18,
};
