import type { CharacterId, EventType } from './config';
import type { ChallengeInput, ChallengeKind } from './challenges';

export type Phase =
  | 'placement' // everyone secretly curses one corridor
  | 'turnStart' // optional decoy, then roll
  | 'choose' // pick dice and destination
  | 'pick' // choose a duel / Super Reaper / haunt opponent
  | 'event' // a Trick or Treat card needs a choice
  | 'challenge' // a survival game is being played
  | 'ghost' // the resident ghost is about to move
  | 'summary' // the turn is done; pass to the next seat
  | 'gameOver';

export interface PlayerState {
  /** Stable identifier, never reused within a game. */
  id: string;
  name: string;
  character: CharacterId;
  node: number;
  carried: number;
  banked: number;
  decoyUsed: boolean;
  /** Node the player last arrived from, used only for camera heading. */
  facingFrom: number | null;
  /** Living, or a ghost (irreversible). */
  alive: boolean;
  /** Haunting bounty earned as a player ghost (capped). */
  bounty: number;
  /** Protected from hostile encounters while turnNumber <= this. */
  protectedUntil: number | null;
  /** Round in which the player died, for the results screen. */
  diedInRound: number | null;
}

export interface Trap {
  node: number;
  revealed: boolean;
}

export interface EventState {
  cardId: number;
  type: EventType;
  status: 'choice' | 'resolved';
  /** Secret passage: node ids. Sticky fingers / costume mix-up: player indices. */
  options: number[];
  canDecline: boolean;
}

export type ChallengeHost = 'npc' | 'playerGhost' | 'reaper' | 'superReaper' | 'duel';

/** What happens once a challenge resolves. */
export type Continuation =
  | { kind: 'landing'; arriving: number; dest: number }
  | { kind: 'npc' }
  | { kind: 'playerGhost' };

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  seed: number;
  participants: number[];
  host: ChallengeHost;
  /** Where the encounter happens on the board. */
  node: number;
  /** Each participant's own board space (where they would die). */
  origins: number[];
  /** Late duels and every Super Reaper duel leave exactly one survivor. */
  oneSurvivor: boolean;
  /** A player ghost who initiated this (for bounties). */
  attacker: number | null;
  /** Increments when the challenge is restarted after a disconnect. */
  attempt: number;
  cont: Continuation;
}

export interface Pick {
  kind: 'duel' | 'summon' | 'haunt';
  options: number[];
  cont: Continuation;
}

export interface GhostTarget {
  kind: 'player' | 'decoy';
  player?: number;
  node: number;
}

export interface GhostPlan {
  target: GhostTarget | null;
  allowance: number;
  /** Full shortest path to the target (ghost node first). */
  fullPath: number[];
  /** The part it would walk this phase, stopping at its first encounter. */
  path: number[];
  reachesTarget: boolean;
  /** The one living player it would challenge, if any. */
  encounter: { player: number; node: number } | null;
}

export interface ChallengeOutcome {
  challengeId: string;
  kind: ChallengeKind;
  host: ChallengeHost;
  participants: number[];
  survivors: number[];
  deaths: Array<{ player: number; node: number; dropped: number }>;
  relocations: Array<{ player: number; from: number; to: number }>;
  scores: number[];
  decidedBy?: string;
  bounty?: { player: number; amount: number };
}

export type LogEntry =
  | { kind: 'decoy'; player: number; node: number }
  | { kind: 'roll'; player: number; dice: number[] }
  | { kind: 'move'; player: number; path: number[]; usesSecret: boolean }
  | { kind: 'stay'; player: number; node: number }
  | { kind: 'harvest'; player: number; node: number; amount: number; remaining: number }
  | { kind: 'pile'; player: number; node: number; amount: number }
  | { kind: 'bank'; player: number; amount: number; total: number }
  | { kind: 'card'; player: number; cardId: number }
  | { kind: 'relocate'; player: number; from: number; to: number }
  | { kind: 'steal'; player: number; victim: number; amount: number }
  | { kind: 'gain'; player: number; amount: number }
  | { kind: 'ghostBonus'; amount: number }
  | { kind: 'swap'; player: number; other: number; playerTo: number; otherTo: number }
  | { kind: 'drop'; player: number; node: number; amount: number }
  | { kind: 'noEffect'; player: number; reason: string }
  | { kind: 'declined'; player: number }
  | { kind: 'ghost'; plan: GhostPlan }
  | { kind: 'ghostWaits' }
  | { kind: 'trapRevealed'; node: number; player: number }
  | { kind: 'spared'; node: number; player: number }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'outcome'; outcome: ChallengeOutcome }
  | { kind: 'placementDone' }
  | { kind: 'midnight' }
  | { kind: 'gameOver'; reason: 'midnight' | 'noneAlive' };

export interface GameState {
  schema: 2;
  seed: number;
  rng: number;
  /** A separate stream for challenge seeds, so seeds shown to phones reveal nothing else. */
  challengeRng: number;
  challengeCount: number;
  players: PlayerState[];
  ghost: number;
  stocks: number[];
  piles: number[];
  deck: number[];
  discard: number[];
  round: number;
  /** Index of the active player in turn order. */
  turn: number;
  /** Count of turns started so far this game (1-based). */
  turnNumber: number;
  phase: Phase;
  /** Two dice for the living (move + ghost), one for a player ghost. */
  dice: number[] | null;
  selection: { moveDie: 0 | 1; dest: number | 'stay' | null };
  decoy: number | null;
  ghostBonus: number;
  event: EventState | null;
  pick: Pick | null;
  challenge: Challenge | null;
  /** The last resolved challenge, for the summary screen. */
  lastOutcome: ChallengeOutcome | null;
  /** Secret nominations during placement (masked in public views). */
  nominations: Array<number | null>;
  /** All six regular traps. Public views contain only the revealed ones. */
  traps: Trap[];
  /** Everything that has happened in the current turn. */
  log: LogEntry[];
  /** True once anything has changed since this turn began. */
  turnDirty: boolean;
  midnight: boolean;
  endReason: 'midnight' | 'noneAlive' | null;
}

export type Action =
  | { type: 'nominate'; seat: number; node: number }
  | { type: 'placeDecoy' }
  | { type: 'roll' }
  | { type: 'select'; moveDie?: 0 | 1; dest?: number | 'stay' | null }
  | { type: 'confirmMove' }
  | { type: 'pickOpponent'; option: number }
  | { type: 'eventChoose'; option: number }
  | { type: 'eventDecline' }
  | { type: 'challengeResult'; id: string; inputs: Record<number, ChallengeInput[]> }
  | { type: 'moveGhost' }
  | { type: 'nextTurn' };

export interface ActionResult {
  state: GameState;
  events: LogEntry[];
  error?: string;
}

export type Encounter =
  | { kind: 'none' }
  | { kind: 'duel'; lethal: boolean; opponents: number[] }
  | { kind: 'superReaper'; opponents: number[] }
  | { kind: 'reaper' }
  | { kind: 'haunt'; targets: number[] };

export interface MovePreview {
  dest: number | 'stay';
  path: number[];
  usesSecret: boolean;
  harvest: number;
  pile: number;
  bank: number;
  carriedAfter: number;
  triggersEvent: boolean;
  /** A known survival encounter at the destination (never from hidden traps). */
  encounter: Encounter;
  /** True when a revealed trap or the Super Reaper would strip protection. */
  waivesProtection: boolean;
  /** The resident ghost's forecast after this move (living turns only). */
  ghost: GhostPlan | null;
  /** True when an undrawn card or an encounter may change the forecast. */
  provisional: boolean;
}
