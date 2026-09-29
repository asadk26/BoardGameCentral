import type { CharacterId, EventType } from './config';

export type Phase = 'turnStart' | 'choose' | 'event' | 'ghost' | 'summary' | 'gameOver';

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
}

export interface EventState {
  cardId: number;
  type: EventType;
  status: 'choice' | 'resolved';
  /** Secret passage: node ids. Sticky fingers / costume mix-up: player indices. */
  options: number[];
  canDecline: boolean;
}

export type GhostTarget =
  | { kind: 'player'; player: number; node: number }
  | { kind: 'decoy'; node: number };

export interface Catch {
  player: number;
  node: number;
  carriedBefore: number;
  dropped: number;
  retained: number;
}

export interface GhostPlan {
  target: GhostTarget | null;
  allowance: number;
  /** Full shortest path from the ghost to its target (ghost node first). */
  fullPath: number[];
  /** The part actually walked this phase (ghost node first). */
  path: number[];
  reachesTarget: boolean;
  catches: Catch[];
}

export type LogEntry =
  | { kind: 'decoy'; player: number; node: number }
  | { kind: 'roll'; player: number; dice: [number, number] }
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
  | { kind: 'midnight' }
  | { kind: 'gameOver' };

export interface GameState {
  schema: 1;
  seed: number;
  rng: number;
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
  dice: [number, number] | null;
  selection: { moveDie: 0 | 1; dest: number | 'stay' | null };
  decoy: number | null;
  ghostBonus: number;
  event: EventState | null;
  /** Everything that has happened in the current turn. */
  log: LogEntry[];
  /** True once anything has changed since this turn began. */
  turnDirty: boolean;
  midnight: boolean;
}

export type Action =
  | { type: 'placeDecoy' }
  | { type: 'roll' }
  | { type: 'select'; moveDie?: 0 | 1; dest?: number | 'stay' | null }
  | { type: 'confirmMove' }
  | { type: 'eventChoose'; option: number }
  | { type: 'eventDecline' }
  | { type: 'moveGhost' }
  | { type: 'nextTurn' };

export interface ActionResult {
  state: GameState;
  events: LogEntry[];
  error?: string;
}

export interface MovePreview {
  dest: number | 'stay';
  path: number[];
  usesSecret: boolean;
  harvest: number;
  pile: number;
  bank: number;
  carriedAfter: number;
  triggersEvent: boolean;
  ghost: GhostPlan;
  /** True when an undrawn event card may change the ghost forecast. */
  provisional: boolean;
}
