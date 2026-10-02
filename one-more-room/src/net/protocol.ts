// Messages between the room service, the TV (host) and phones. Clients send
// intentions; the service owns the engine, randomness and judging. Nothing
// here ever carries the full game state: the TV gets the public view, a phone
// gets the public view plus its own piece's trap nomination.
//
// People and pieces are separate: a phone is a participant; a board piece has
// one person (Free-for-all), one or two people (Team Battle), or a bot. In a
// pair, the first person controls odd rounds and the second even rounds.

import type { CharacterId } from '../engine/config';
import type { BotProfile } from '../engine/bots';
import type { Action, GameState, LogEntry } from '../engine/types';

export type RoomMode = 'ffa' | 'teams';

export interface PublicMember {
  participantId: string;
  name: string;
  connected: boolean;
}

export interface PublicPiece {
  piece: number;
  name: string;
  character: CharacterId;
  kind: 'phone' | 'bot';
  /** Controller slots in order: [odd rounds, even rounds] for a pair. */
  members: PublicMember[];
  bot?: BotProfile;
  /** A bot holding a free seat until someone joins. */
  auto?: boolean;
  /** The TV keyboard plays this piece's challenges (poor phone sync). */
  localControl?: boolean;
}

export interface ChallengeRunView {
  id: string;
  attempt: number;
  /** ready: press Jump to be ready · practice: unscored sweeps · countdown: 3–2–1 then the scored rope. */
  stage: 'ready' | 'practice' | 'countdown';
  /** This match has not practised yet (the host can skip it). */
  practice: boolean;
  ready: number[];
  /** Server time (ms) the practice rope's timeline starts. */
  practiceAt: number | null;
  /** Server time (ms) the scored rope's timeline starts. */
  startAt: number | null;
  /** Presses per piece, ms on the scored timeline: the TV draws these jumps; the judge scores them. */
  presses: Record<number, number[]>;
  practicePresses: Record<number, number[]>;
  /** Pieces whose phones are clearly lagging. */
  lagging: number[];
  paused: string | null;
  note: string | null;
}

export interface YouView {
  participantId: string;
  name: string;
  piece: number | null;
  /** Controller slots this person holds on the piece. */
  slots: number[];
  /** True when this phone may act for its piece right now (this round's controller). */
  inControl: boolean;
  /** True when this phone confirms the piece's secret trap. */
  selector: boolean;
}

export interface RoomView {
  code: string;
  mode: RoomMode;
  phase: 'lobby' | 'game';
  pieces: PublicPiece[];
  /** Joined phones without a piece (can take over a disconnected controller). */
  spectators: PublicMember[];
  hostConnected: boolean;
  rev: number;
  /** Public game view (TV) or seat view (phone). */
  game: GameState | null;
  ownNomination: number | null;
  you: YouView | null;
  run: ChallengeRunView | null;
  /** A short public notice (handovers, restarts). */
  notice: string | null;
  /** The host has paused the game. */
  paused: boolean;
}

export type ClientMsg =
  | { t: 'create'; mansion?: string }
  | { t: 'hostJoin'; code: string; hostToken: string }
  | { t: 'join'; code: string; name: string; token?: string }
  | { t: 'setMode'; mode: RoomMode }
  | { t: 'claimPiece'; character: CharacterId; name: string }
  | { t: 'joinTeam'; piece: number; name: string }
  | { t: 'setCharacter'; character: CharacterId }
  | { t: 'leaveSeat' }
  /** Advanced: play with fewer than four pieces (bot seats only are removed). */
  | { t: 'setPieceCount'; count: number }
  | { t: 'setBot'; piece: number; bot: BotProfile }
  | { t: 'start' }
  | { t: 'replaceWithBot'; piece: number }
  | { t: 'handover'; piece: number; slot: number; to: string }
  | { t: 'localControl'; piece: number; on: boolean }
  | { t: 'pause'; on: boolean }
  | { t: 'restart' }
  | { t: 'action'; id: string; rev: number; action: Action }
  /** The Jump button. Before the rope it means ready; `at` is server time when pressed (phones: estimated). */
  | { t: 'press'; challengeId: string; attempt: number; at: number; piece?: number }
  | { t: 'skipPractice' }
  | { t: 'syncPoor'; rttMs: number }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'created'; code: string; hostToken: string }
  | { t: 'joined'; participantId: string; token: string; code: string }
  | { t: 'view'; view: RoomView; events: LogEntry[] }
  | { t: 'rejected'; id?: string; reason: string }
  | { t: 'error'; reason: string }
  | { t: 'pong'; c: number; s: number };

export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;
export const WS_PATH = '/ws';
/** Phones that can hold a piece (four pieces of up to two people). */
export const MAX_PHONES = 8;
