import type { CharacterId, ItemId, TrapEffect } from './config';
import type { ChallengeInput, DecidedBy } from './challenges';

export type Phase =
  | 'placement' // every piece secretly nominates one corridor
  | 'lifeRoll' // everyone rolls a die; the highest starts alive
  | 'turnStart' // the scheduled piece rolls its die
  | 'choose' // moving: paused at a fork (or at the start) to pick a direction
  | 'pick' // the living piece on a Reaper's Challenge picks a ghost
  | 'hunt' // after landing: challenge the living piece, battle a ghost, or end the action
  | 'challenge' // Haunted Jump Rope is being played
  | 'reward' // a ghost-battle winner already holding an item keeps it or takes the new one
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
  /** The one item a piece may carry (ghosts only; cleared on becoming alive). */
  item: ItemId | null;
  /** Action number in which the item was won: it can't be used in that same action. */
  itemAwardedAt: number | null;
}

export interface Trap {
  node: number;
  effect: TrapEffect;
  revealed: boolean;
  /** A Séance tile is single-use: afterwards it is an ordinary corridor. */
  spent: boolean;
}

export type ChallengeHost = 'contact' | 'reaper' | 'superReaper' | 'seance' | 'ghostBattle' | 'versus';

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
  /** Ghost battles: the item the winner drew. */
  reward?: ItemId;
}

/** What a ghost may do after an ordinary landing (or a stay), before the action ends. */
export interface EncounterOptions {
  /** Challenge the living piece (same space or one ordinary edge). */
  living: boolean;
  /** Ghosts on this very space the mover may battle for an item. */
  sameSpace: number[];
  /** On a Versus space: any other ghost the mover may battle. */
  versus: number[];
  /** Landed on a Versus space but nobody is eligible (why, for the screen). */
  versusInactive: 'noGhosts' | 'cooldown' | null;
}

/** A ghost-battle winner who already holds an item chooses which to keep. */
export interface PendingReward {
  piece: number;
  current: ItemId;
  offered: ItemId;
}

/** A move in progress: exactly `remaining` more steps from the current space. */
export interface MoveProgress {
  remaining: number;
  /** The space the piece just came from (never stepped straight back to, unless a dead end). */
  prev: number | null;
  /** Every space visited so far this move, starting where it began. */
  path: number[];
  /** One secret passage per move. */
  usedSecret: boolean;
  usedWall: boolean;
}

/** How the acting piece got its movement this action. */
export interface RollInfo {
  kind: 'die' | 'stride';
  /** Second Roll: the discarded first result. */
  rerolledFrom?: number;
}

export type LogEntry =
  | { kind: 'placementDone' }
  | { kind: 'lifeRoll'; rolls: Array<Array<number | null>>; winner: number }
  | { kind: 'spawn'; piece: number; node: number; alive: boolean }
  | { kind: 'roundStart'; round: number; schedule: number[] }
  | { kind: 'roll'; piece: number; die: number; allowance: number }
  /** One stretch of movement: from the first node to the last, with `remaining` steps still to go after it. */
  | { kind: 'move'; piece: number; path: number[]; usesSecret: boolean; usesWall: boolean; remaining: number }
  | { kind: 'trapRevealed'; node: number; effect: 'reaper' | 'seance' | 'poltergeist'; piece: number }
  | { kind: 'seanceDormant'; node: number; piece: number; super: boolean }
  | { kind: 'superReaper'; piece: number; effect: 'seance' | 'reaper' }
  | { kind: 'poltergeist'; piece: number; from: number; to: number }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'outcome'; outcome: ChallengeOutcome }
  | { kind: 'lifeTransfer'; from: number; to: number }
  | { kind: 'huntDeclined'; piece: number }
  | { kind: 'versusInactive'; piece: number; node: number; reason: 'noGhosts' | 'cooldown' }
  | { kind: 'itemAwarded'; piece: number; item: ItemId; replaced: ItemId | null; kept: ItemId; duplicate?: boolean }
  | { kind: 'rewardPending'; piece: number; current: ItemId; offered: ItemId }
  | { kind: 'itemUsed'; piece: number; item: ItemId; detail?: { target?: number; from?: number; to?: number; oldDie?: number; newDie?: number } }
  | { kind: 'roundEnd'; round: number; piece: number; score: number; streak: number }
  | { kind: 'gameOver' };

export interface GameState {
  schema: 5;
  seed: number;
  rng: number;
  /** A separate stream for challenge seeds, so seeds shown to phones reveal nothing else. */
  challengeRng: number;
  /** A separate stream for ghost-battle rewards, drawn only once a winner is known. */
  rewardRng: number;
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
  /** The acting piece's roll, and how many spaces it moves in all this action. */
  die: number | null;
  allowance: number;
  /** Die or Ghostly Stride; Second Roll's discarded result. Null before moving is decided. */
  rollInfo: RollInfo | null;
  /** The one item used in this action, if any. */
  itemUsed: ItemId | null;
  /** The move in progress (phase 'choose'), or null. */
  move: MoveProgress | null;
  /** Where the acting piece stood when its action began. */
  origin: number | null;
  /** True once this action has used its one minigame. */
  minigameUsed: boolean;
  /** The living piece on a Reaper's Challenge picks one of these ghosts. */
  pick: { options: number[]; node: number } | null;
  /** After an ordinary landing: what the acting ghost may start (one at most). */
  options: EncounterOptions | null;
  /** Ghost pairs ("a-b", a < b) that already battled this round. */
  battlesThisRound: string[];
  /** A winner deciding between their old item and the new one. */
  pendingReward: PendingReward | null;
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
  /** Take the next step from `at` (with `left` steps remaining) to `to`; straight corridors then continue on their own. */
  | { type: 'step'; at: number; left: number; to: number }
  | { type: 'pickOpponent'; option: number }
  | { type: 'hunt' }
  | { type: 'battle'; opponent: number }
  | { type: 'declineHunt' }
  | { type: 'chooseReward'; keep: 'current' | 'offered' }
  | { type: 'useItem'; item: ItemId; target?: number }
  | { type: 'challengeResult'; id: string; inputs: Record<number, ChallengeInput[]> }
  | { type: 'nextTurn' };

export interface ActionResult {
  state: GameState;
  events: LogEntry[];
  error?: string;
}

/** What a destination is publicly known to do (never from hidden traps). */
export type KnownEffect = 'seance' | 'reaper' | 'poltergeist' | 'dormant' | null;

/** What a possible landing space is publicly known to mean for the acting piece. */
export interface MovePreview {
  dest: number;
  /** A publicly known effect at the destination. */
  known: KnownEffect;
  /** Super Reaper: which effect it has right now. */
  superReaper: 'seance' | 'reaper' | null;
  /** Ghost: would end within ordinary range of the living piece (if no minigame runs first). */
  canChallenge: boolean;
  /** Living: ghosts whose current space is within ordinary range of the destination. */
  threats: number[];
  /** Ghost: other ghosts on the destination it could battle for an item. */
  battleTargets: number[];
  /** Ghost: the destination is a Versus space with at least one eligible opponent. */
  versus: boolean;
}
