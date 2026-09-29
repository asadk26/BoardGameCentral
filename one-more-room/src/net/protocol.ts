// Messages between the room service, the TV (host) and phones. Clients send
// intentions; the service owns the engine, randomness and scoring. Nothing
// here ever carries the full game state: the TV gets the public view, a phone
// gets the public view plus its own trap nomination.

import type { CharacterId } from '../engine/config';
import type { BotProfile } from '../engine/bots';
import type { ChallengeInput } from '../engine/challenges';
import type { Action, GameState, LogEntry } from '../engine/types';

export interface PublicSeat {
  seat: number;
  name: string;
  character: CharacterId;
  kind: 'phone' | 'bot';
  connected: boolean;
  bot?: BotProfile;
  /** The TV keyboard plays this seat's challenges (poor phone sync). */
  localControl?: boolean;
}

export interface ChallengeRunView {
  id: string;
  attempt: number;
  ready: number[];
  submitted: number[];
  /** Server time (ms) when play starts, once everyone is ready. */
  startAt: number | null;
  paused: string | null;
  note: string | null;
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'game';
  seats: PublicSeat[];
  hostConnected: boolean;
  rev: number;
  /** Public game view (TV) or seat view (phone). */
  game: GameState | null;
  ownNomination: number | null;
  you: { participantId: string; seat: number | null } | null;
  run: ChallengeRunView | null;
}

export type ClientMsg =
  | { t: 'create'; mansion?: string }
  | { t: 'hostJoin'; code: string; hostToken: string }
  | { t: 'join'; code: string; name: string; token?: string }
  | { t: 'claimSeat'; character: CharacterId; name: string }
  | { t: 'leaveSeat' }
  | { t: 'addBot'; character: CharacterId; bot: BotProfile }
  | { t: 'removeSeat'; seat: number }
  | { t: 'start' }
  | { t: 'replaceWithBot'; seat: number }
  | { t: 'localControl'; seat: number; on: boolean }
  | { t: 'restart' }
  | { t: 'action'; id: string; rev: number; action: Action }
  | { t: 'ready'; challengeId: string; attempt: number }
  | { t: 'challengeInput'; challengeId: string; attempt: number; seat?: number; inputs: ChallengeInput[] }
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
