// Versioned local persistence. Only this game's own keys are ever written or
// removed; nothing else in the browser's storage is touched.

import { CHARACTERS, DEFAULT_MANSION_NAME, MAX_PIECES, NODE_COUNT, ROOMS, ROUNDS, TEXT_LIMITS, TRAP_COUNT, trapEligible } from './config';
import type { GameState } from './types';
import type { Session } from './engine';
import type { BotProfile } from './bots';

export const SAVE_KEY = 'one-more-room/save';
export const PREFS_KEY = 'one-more-room/prefs';
export const SETTINGS_KEY = 'one-more-room/settings';
/**
 * v1 = original candy rules; v2 = candy with survival encounters;
 * v3 = One Life (one living piece, points per round held).
 */
export const SAVE_SCHEMA = 3;

export interface Personalization {
  mansionName: string;
  roomNames: Record<number, string>;
}

export function defaultPersonalization(): Personalization {
  const roomNames: Record<number, string> = {};
  for (const [id, r] of Object.entries(ROOMS)) roomNames[Number(id)] = r.defaultName;
  return { mansionName: DEFAULT_MANSION_NAME, roomNames };
}

/** Trim, collapse control characters, clamp length, and fall back to a default. */
export function cleanText(value: unknown, limit: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const t = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit).trim();
  return t || fallback;
}

export function sanitizePersonalization(input: unknown): Personalization {
  const d = defaultPersonalization();
  if (!input || typeof input !== 'object') return d;
  const o = input as Record<string, unknown>;
  const rooms = (o.roomNames && typeof o.roomNames === 'object' ? o.roomNames : {}) as Record<string, unknown>;
  const roomNames: Record<number, string> = {};
  for (const id of Object.keys(ROOMS).map(Number)) roomNames[id] = cleanText(rooms[id], TEXT_LIMITS.roomName, d.roomNames[id]);
  return { mansionName: cleanText(o.mansionName, TEXT_LIMITS.mansionName, d.mansionName), roomNames };
}

/** Who plays a piece on this device: people, or a bot with a profile. */
export interface SeatSetup {
  kind: 'human' | 'bot';
  bot?: BotProfile;
}

export interface SaveFile {
  schema: number;
  savedAt: string;
  session: Session;
  personalization: Personalization;
  seats?: SeatSetup[];
}

const isInt = (v: unknown, min = -Infinity, max = Infinity) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const PHASES = ['placement', 'lifeRoll', 'turnStart', 'choose', 'pick', 'hunt', 'challenge', 'summary', 'gameOver'];

export function validGame(g: unknown): g is GameState {
  if (!g || typeof g !== 'object') return false;
  const s = g as GameState;
  const chars = new Set(CHARACTERS.map((c) => c.id));
  if (s.schema !== 3 || !Array.isArray(s.pieces) || s.pieces.length < 2 || s.pieces.length > MAX_PIECES) return false;
  const started = s.phase !== 'placement' && s.phase !== 'lifeRoll';
  const living = s.pieces.filter((p) => p && p.alive).length;
  return (
    isInt(s.rng, 0, 0xffffffff) &&
    isInt(s.challengeRng, 0, 0xffffffff) &&
    s.pieces.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        chars.has(p.character) &&
        Array.isArray(p.controllers) &&
        p.controllers.length >= 1 &&
        p.controllers.length <= 2 &&
        p.controllers.every((c) => typeof c === 'string') &&
        isInt(p.node, 0, NODE_COUNT - 1) &&
        isInt(p.score, 0, ROUNDS) &&
        isInt(p.streak, 0, ROUNDS) &&
        typeof p.alive === 'boolean',
    ) &&
    new Set(s.pieces.map((p) => p.character)).size === s.pieces.length &&
    (started ? living === 1 : living === 0) &&
    s.pieces.reduce((sum, p) => sum + p.score, 0) <= ROUNDS &&
    isInt(s.round, 1, ROUNDS) &&
    PHASES.includes(s.phase) &&
    Array.isArray(s.schedule) &&
    (!started || (s.schedule.length === s.pieces.length && new Set(s.schedule).size === s.pieces.length && isInt(s.slot, 0, s.pieces.length - 1))) &&
    (s.die === null || isInt(s.die, 1, 6)) &&
    isInt(s.seancesUsed, 0, 2) &&
    Array.isArray(s.nominations) &&
    s.nominations.length === s.pieces.length &&
    Array.isArray(s.traps) &&
    (s.phase === 'placement' ? s.traps.length === 0 : s.traps.length === TRAP_COUNT) &&
    s.traps.every((t) => trapEligible(t.node) && ['reaper', 'seance', 'poltergeist'].includes(t.effect) && typeof t.revealed === 'boolean' && typeof t.spent === 'boolean') &&
    (s.phase !== 'challenge' || (!!s.challenge && typeof s.challenge.id === 'string')) &&
    Array.isArray(s.log)
  );
}

export function serialize(session: Session, personalization: Personalization, seats?: SeatSetup[]): string {
  const file: SaveFile = { schema: SAVE_SCHEMA, savedAt: new Date().toISOString(), session, personalization, seats };
  return JSON.stringify(file);
}

export type LoadResult =
  | { ok: true; session: Session; personalization: Personalization; seats: SeatSetup[] | null }
  | { ok: false; reason: 'missing' | 'corrupt' | 'incompatible' };

export function deserialize(raw: string | null): LoadResult {
  if (raw === null) return { ok: false, reason: 'missing' };
  let parsed: SaveFile;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'corrupt' };
  if (parsed.schema !== SAVE_SCHEMA) return { ok: false, reason: 'incompatible' };
  const ses = parsed.session;
  if (!ses || !validGame(ses.game) || !validGame(ses.turnStart) || (ses.previousTurnStart !== null && !validGame(ses.previousTurnStart))) {
    return { ok: false, reason: 'corrupt' };
  }
  if (!Array.isArray(ses.known)) ses.known = [];
  const seats =
    Array.isArray(parsed.seats) && parsed.seats.length === ses.game.pieces.length
      ? parsed.seats.map((x) => (x && x.kind === 'bot' && x.bot ? { kind: 'bot' as const, bot: x.bot } : { kind: 'human' as const }))
      : null;
  return { ok: true, session: ses, personalization: sanitizePersonalization(parsed.personalization), seats };
}
