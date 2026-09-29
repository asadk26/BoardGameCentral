// Board and balance data for One More Room.
// Everything a designer might want to rebalance lives here, not in the rules.

export type NodeKind = 'entrance' | 'room' | 'event' | 'secret' | 'corridor';

export type RoomKey =
  | 'kitchen'
  | 'dining'
  | 'conservatory'
  | 'attic'
  | 'crypt'
  | 'laboratory'
  | 'nursery'
  | 'library';

export const NODE_COUNT = 32;
export const ENTRANCE = 0;
export const GHOST_START = 16;
export const ROUNDS = 10;
export const MIDNIGHT_WARNING_AFTER_ROUND = 7;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HARVEST_PER_LANDING = 3;

/** Ordinary undirected edges: the 32-node ring plus two cross corridors. */
export const ORDINARY_EDGES: ReadonlyArray<readonly [number, number]> = [
  ...Array.from({ length: NODE_COUNT }, (_, i) => [i, (i + 1) % NODE_COUNT] as const),
  [4, 12],
  [20, 28],
];

/** Player-only secret passage edges. Pair A and pair B. */
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

// ── The Reaper ──────────────────────────────────────────────────────────

/** The one permanently visible Super Reaper, beside the 4–12 passage. */
export const SUPER_REAPER = 12;
/** Exactly this many hidden regular Reaper traps, whatever the seat count. */
export const TRAP_COUNT = 6;
/** Corridor spaces that may never hold a hidden trap. */
export const TRAP_EXCLUDED: readonly number[] = [0, 1, 31, 16, SUPER_REAPER];
/** Mansion wings used to spread computer-filled traps around. */
export const TRAP_WINGS: Record<string, readonly number[]> = {
  west: [2, 4, 6, 9],
  north: [14, 18, 19],
  east: [20, 21, 26, 28, 30],
};

/** Scoring constants — a starting balance, meant to be tuned. */
export const SCORING = {
  survivalBonus: 5,
  survivalBonusMinBanked: 6,
  bountyPerKill: 3,
  bountyCap: 6,
};

/** From this round on, duels leave exactly one survivor. */
export const LETHAL_DUELS_FROM_ROUND = 8;

/** Timings for the survival games, in milliseconds. */
export const CHALLENGE = {
  readyMs: 3000,
  escape: { attempts: 2, periodMs: 2200, gapMs: 700, zoneDeg: 52 },
  dance: { length: 4, symbolMs: 650, gapMs: 180, answerMs: 8000, attempts: 2 },
  rope: { sweeps: 8, extraSweeps: 4, periodMs: 1250, firstMs: 1100, jitterMs: 110, pass: 5, airMinMs: 70, airMaxMs: 430, windowMs: 700, lateMs: 60, idealMs: 250, missErrorMs: 600 },
};

export const ROOMS: Record<number, { key: RoomKey; defaultName: string; stock: number }> = {
  3: { key: 'kitchen', defaultName: 'Kitchen', stock: 6 },
  7: { key: 'dining', defaultName: 'Dining Room', stock: 8 },
  10: { key: 'conservatory', defaultName: 'Conservatory', stock: 8 },
  15: { key: 'attic', defaultName: 'Attic', stock: 12 },
  17: { key: 'crypt', defaultName: 'Crypt', stock: 12 },
  22: { key: 'laboratory', defaultName: 'Laboratory', stock: 10 },
  25: { key: 'nursery', defaultName: 'Nursery', stock: 8 },
  29: { key: 'library', defaultName: 'Library', stock: 6 },
};

export const EVENT_NODES: readonly number[] = [5, 13, 23];

export function nodeKind(id: number): NodeKind {
  if (id === ENTRANCE) return 'entrance';
  if (ROOMS[id]) return 'room';
  if (EVENT_NODES.includes(id)) return 'event';
  if (SECRET_ENDPOINTS.includes(id)) return 'secret';
  return 'corridor';
}

export function trapEligible(id: number): boolean {
  return nodeKind(id) === 'corridor' && !TRAP_EXCLUDED.includes(id);
}
export const TRAP_ELIGIBLE: readonly number[] = Array.from({ length: NODE_COUNT }, (_, i) => i).filter(trapEligible);

export function secretPairLabel(id: number): 'A' | 'B' | null {
  if (id === 8 || id === 24) return 'A';
  if (id === 11 || id === 27) return 'B';
  return null;
}

/**
 * Board-space layout (x east, z south), in world units. The entrance sits at
 * the south of the central hall; the west and east wings are the two side
 * loops; the attic, crypt and the ghost's lair run along the north gallery.
 */
export const NODE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 8], // 0 entrance hall
  [-2, 8], // 1
  [-4, 8], // 2
  [-4, 6], // 3 kitchen
  [-4, 4], // 4 junction to west wing
  [-6, 4], // 5 trick or treat
  [-8, 4], // 6
  [-10, 4], // 7 dining room
  [-10, 2], // 8 secret A
  [-10, 0], // 9
  [-8, 0], // 10 conservatory
  [-6, 0], // 11 secret B
  [-4, 0], // 12 junction
  [-4, -2], // 13 trick or treat
  [-4, -4], // 14
  [-2, -4], // 15 attic
  [0, -4], // 16 ghost's lair
  [2, -4], // 17 crypt
  [4, -4], // 18
  [4, -2], // 19
  [4, 0], // 20 junction to east wing
  [6, 0], // 21
  [8, 0], // 22 laboratory
  [10, 0], // 23 trick or treat
  [10, 2], // 24 secret A
  [10, 4], // 25 nursery
  [8, 4], // 26
  [6, 4], // 27 secret B
  [4, 4], // 28 junction
  [4, 6], // 29 library
  [4, 8], // 30
  [2, 8], // 31
];

export type EventType =
  | 'secretPassage'
  | 'stickyFingers'
  | 'sweetDiscovery'
  | 'creakyFloorboards'
  | 'costumeMixup'
  | 'flyingCandy';

export const EVENT_TYPES: readonly EventType[] = [
  'secretPassage',
  'stickyFingers',
  'sweetDiscovery',
  'creakyFloorboards',
  'costumeMixup',
  'flyingCandy',
];

export const EVENT_INFO: Record<EventType, { title: string; effect: string; flavors: [string, string, string] }> = {
  secretPassage: {
    title: 'Secret Passage',
    effect: 'You may move to any secret-passage space the ghost is not on. Or stay put.',
    flavors: [
      'A bookcase swings open with a polite little creak.',
      'You lean on a candlestick. The wall leans back.',
      'A portrait winks and points behind itself.',
    ],
  },
  stickyFingers: {
    title: 'Sticky Fingers',
    effect: 'Steal up to 2 carried candy from an opponent on your space or an adjacent space.',
    flavors: [
      'Nobody saw a thing. Nobody.',
      'Oops, was that your caramel? It is now mine.',
      'A quick hand in a dark hallway.',
    ],
  },
  sweetDiscovery: {
    title: 'Sweet Discovery',
    effect: 'Gain 2 carried candy.',
    flavors: [
      'Behind the loose skirting board: a stash of toffees.',
      'A forgotten trick-or-treat bag, still full.',
      'The chandelier drips… chocolate?',
    ],
  },
  creakyFloorboards: {
    title: 'Creaky Floorboards',
    effect: 'The ghost moves 2 extra spaces this turn.',
    flavors: [
      'CREEEAAAK. Something upstairs heard that.',
      'You step on the one board everyone warned you about.',
      'The floor groans louder than you do.',
    ],
  },
  costumeMixup: {
    title: 'Costume Mix-up',
    effect: 'You may swap places with any opponent outside the entrance hall.',
    flavors: [
      'In this light, everyone looks like everyone.',
      'A mirror that is not a mirror.',
      'Wait — whose cape is this?',
    ],
  },
  flyingCandy: {
    title: 'Flying Candy',
    effect: 'Drop up to 2 carried candy on this space.',
    flavors: [
      'A bat swoops through your sack.',
      'Your bag has a hole. Of course it does.',
      'The poltergeist wanted a snack.',
    ],
  },
};

/** 18 cards: three copies of each of the six types. Card id → type. */
export const DECK_SIZE = 18;
export function cardType(cardId: number): EventType {
  return EVENT_TYPES[Math.floor(cardId / 3)];
}
export function cardFlavorIndex(cardId: number): number {
  return cardId % 3;
}

export type CharacterId = 'knight' | 'goblin' | 'witch' | 'zombie' | 'skeleton' | 'vampire';

export const CHARACTERS: ReadonlyArray<{ id: CharacterId; name: string; color: string; blurb: string }> = [
  { id: 'knight', name: 'Knight', color: '#e0564a', blurb: 'Tin-foil courage, feathered plume.' },
  { id: 'goblin', name: 'Goblin', color: '#62b54a', blurb: 'Big ears, bigger candy sack.' },
  { id: 'witch', name: 'Witch', color: '#9b6ce0', blurb: 'Pointy hat, trusty broom.' },
  { id: 'zombie', name: 'Zombie', color: '#4fb3a4', blurb: 'Shuffles for sugar.' },
  { id: 'skeleton', name: 'Skeleton', color: '#e8d9a8', blurb: 'All bones, no sweet tooth… yet.' },
  { id: 'vampire', name: 'Vampire', color: '#d8456f', blurb: 'Would rather have candy, honestly.' },
];

export const DEFAULT_PLAYER_NAMES = ['Maya', 'Leo', 'Priya', 'Sam', 'Noor', 'Theo'];
export const DEFAULT_MANSION_NAME = 'Blackthorn Manor';
export const DEFAULT_GHOST_NAME = 'The Ghost';

export const TEXT_LIMITS = {
  playerName: 16,
  mansionName: 28,
  roomName: 18,
  ghostName: 16,
  flavor: 90,
};
