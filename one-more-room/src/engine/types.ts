import type { CharacterId, TrapEffect } from './config';
import type { ChallengeInput, DecidedBy } from './challenges';

export type Phase =
  | 'placement' // every piece secretly nominates one corridor
  | 'lifeRoll' // everyone rolls a die; the highest starts alive
  | 'turnStart' // the scheduled piece rolls its die
  | 'choose' // pick a destination (or stay)
  | 'pick' // the living piece on a Reaper's Challenge picks a ghost
  | 'hunt' // a ghost in range may challenge the living piece
  | 'challenge' // Haunted Jump Rope is being played
  | 'summary' // the action is done
  | 'gameOver';

export interface PieceState {
  /** Stable identifier, never reused within a game. */
  id: string;
  /** Display name: one person, a pair ("Maya & Leo"), or a bot. */
  name: string;
  character: CharacterId;
  /** One name per person sharing the piece (one or two); a bot has one. */
  controllers: string[];
  bot: boolean;
  node: number;
  /** Exactly one piece is alive at any time after the life roll. */
  alive: boolean;
  /** Points: one per round ended holding life. Never decreases. */
  score: number;
  /** Consecutive rounds ended alive; reset whenever life is lost. */
  streak: number;
  /** Node the piece last arrived from, used only for camera heading. */
  facingFrom: number | null;
}

export interface Trap {
  node: number;
  effect: TrapEffect;
  revealed: boolean;
  /** A Séance tile is single-use: afterwards it is an ordinary corridor. */
  spent: boolean;
}

export type ChallengeHost = 'contact' | 'reaper' | 'superReaper' | 'seance';

export interface Challenge {
  id: string;
  kind: 'duel' | 'seance';
  seed: number;
  /** Pieces taking part, in seat order. */
  participants: number[];
  host: ChallengeHost;
  /** Where it happens on the board (the defender's space for a contact duel). */
  node: number;
  /** Each participant's timing-window multiplier, frozen when the challenge began. */
  multipliers: number[];
  /** The living piece when the challenge began. */
  livingAtStart: number;
  /** The piece whose action started it. */
  instigator: number;
  /** Contact duels move pieces afterwards; remote challenges never do. */
  contact: boolean;
  /** Increments when the challenge is restarted after a disconnect. */
  attempt: number;
}

export interface ChallengeOutcome {
  challengeId: string;
  kind: 'duel' | 'seance';
  host: ChallengeHost;
  participants: number[];
  winner: number;
  previousLiving: number;
  transferred: boolean;
  scores: number[];
  multipliers: number[];
  decidedBy: DecidedBy;
  finalists: number[];
  extraSweepsUsed: number;
  moves: Array<{ piece: number; from: number; to: number; reason: 'claim' | 'retreat' }>;
}

export type LogEntry =
  | { kind: 'placementDone' }
  | { kind: 'lifeRoll'; rolls: Array<Array<number | null>>; winner: number }
  | { kind: 'spawn'; piece: number; node: number; alive: boolean }
  | { kind: 'roundStart'; round: number; schedule: number[] }
  | { kind: 'roll'; piece: number; die: number; allowance: number }
  | { kind: 'move'; piece: number; path: number[]; usesSecret: boolean; usesWall: boolean }
  | { kind: 'stay'; piece: number; node: number }
  | { kind: 'trapRevealed'; node: number; effect: 'reaper' | 'seance' | 'poltergeist'; piece: number }
  | { kind: 'seanceDormant'; node: number; piece: number; super: boolean }
  | { kind: 'superReaper'; piece: number; effect: 'seance' | 'reaper' }
  | { kind: 'poltergeist'; piece: number; from: number; to: number }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'outcome'; outcome: ChallengeOutcome }
  | { kind: 'lifeTransfer'; from: number; to: number }
  | { kind: 'huntDeclined'; piece: number }
  | { kind: 'roundEnd'; round: number; piece: number; score: number; streak: number }
  | { kind: 'gameOver' };

export interface GameState {
  schema: 3;
  seed: number;
  rng: number;
  /** A separate stream for challenge seeds, so seeds shown to phones reveal nothing else. */
  challengeRng: number;
  challengeCount: number;
  pieces: PieceState[];
  phase: Phase;
  round: number;
  /** Frozen action order for this round: the round-start living piece, then the hunters. */
  schedule: number[];
  /** Index into `schedule` of the piece acting now. */
  slot: number;
  /** Count of actions started so far this game (1-based). */
  actionNumber: number;
  /** The acting piece's roll, and its movement allowance. */
  die: number | null;
  allowance: number;
  selection: { dest: number | 'stay' | null };
  /** Where the acting piece stood when its action began. */
  origin: number | null;
  /** True once this action has used its one minigame. */
  minigameUsed: boolean;
  /** The living piece on a Reaper's Challenge picks one of these ghosts. */
  pick: { options: number[]; node: number } | null;
  challenge: Challenge | null;
  /** The last resolved challenge, for the summary screen. */
  lastOutcome: ChallengeOutcome | null;
  /** Secret nominations during placement (masked in public views). */
  nominations: Array<number | null>;
  /** All six traps. Public views contain only the revealed ones. */
  traps: Trap[];
  /** Séances played so far (hidden tiles and the Super Reaper share the limit). */
  seancesUsed: number;
  /** Everything that has happened in the current action. */
  log: LogEntry[];
  /** True once anything has changed since this action began. */
  turnDirty: boolean;
}

export type Action =
  | { type: 'nominate'; piece: number; node: number }
  | { type: 'rollForLife' }
  | { type: 'roll' }
  | { type: 'select'; dest: number | 'stay' | null }
  | { type: 'confirmMove' }
  | { type: 'pickOpponent'; option: number }
  | { type: 'hunt' }
  | { type: 'declineHunt' }
  | { type: 'challengeResult'; id: string; inputs: Record<number, ChallengeInput[]> }
  | { type: 'nextTurn' };

export interface ActionResult {
  state: GameState;
  events: LogEntry[];
  error?: string;
}

/** What a destination is publicly known to do (never from hidden traps). */
export type KnownEffect = 'seance' | 'reaper' | 'poltergeist' | 'dormant' | null;

export interface MovePreview {
  dest: number | 'stay';
  path: number[];
  usesSecret: boolean;
  usesWall: boolean;
  /** A publicly known effect at the destination. */
  known: KnownEffect;
  /** Super Reaper: which effect it has right now. */
  superReaper: 'seance' | 'reaper' | null;
  /** Ghost: would end within ordinary range of the living piece (if no minigame runs first). */
  canChallenge: boolean;
  /** Living: ghosts whose current space is within ordinary range of the destination. */
  threats: number[];
}
