// Versioned local persistence. Only this game's own keys are ever written or
// removed; nothing else in the browser's storage is touched.

import {
  CHARACTERS,
  DEFAULT_GHOST_NAME,
  DEFAULT_MANSION_NAME,
  EVENT_TYPES,
  NODE_COUNT,
  ROOMS,
  TEXT_LIMITS,
  type EventType,
} from './config';
import type { GameState } from './types';
import type { Session } from './engine';

export const SAVE_KEY = 'one-more-room/save';
export const PREFS_KEY = 'one-more-room/prefs';
export const SETTINGS_KEY = 'one-more-room/settings';
export const SAVE_SCHEMA = 1;

export interface Personalization {
  mansionName: string;
  ghostName: string;
  roomNames: Record<number, string>;
  /** Optional flavour text per event type; never changes the effect. */
  flavors: Partial<Record<EventType, string>>;
}

export function defaultPersonalization(): Personalization {
  const roomNames: Record<number, string> = {};
  for (const [id, r] of Object.entries(ROOMS)) roomNames[Number(id)] = r.defaultName;
  return { mansionName: DEFAULT_MANSION_NAME, ghostName: DEFAULT_GHOST_NAME, roomNames, flavors: {} };
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
  const flavorsIn = (o.flavors && typeof o.flavors === 'object' ? o.flavors : {}) as Record<string, unknown>;
  const flavors: Partial<Record<EventType, string>> = {};
  for (const t of EVENT_TYPES) {
    const f = cleanText(flavorsIn[t], TEXT_LIMITS.flavor, '');
    if (f) flavors[t] = f;
  }
  const roomNames: Record<number, string> = {};
  for (const id of Object.keys(ROOMS).map(Number)) roomNames[id] = cleanText(rooms[id], TEXT_LIMITS.roomName, d.roomNames[id]);
  return {
    mansionName: cleanText(o.mansionName, TEXT_LIMITS.mansionName, d.mansionName),
    ghostName: cleanText(o.ghostName, TEXT_LIMITS.ghostName, d.ghostName),
    roomNames,
    flavors,
  };
}

export interface SaveFile {
  schema: number;
  savedAt: string;
  session: Session;
  personalization: Personalization;
}

const isInt = (v: unknown, min = -Infinity, max = Infinity) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function validGame(g: unknown): g is GameState {
  if (!g || typeof g !== 'object') return false;
  const s = g as GameState;
  const chars = new Set(CHARACTERS.map((c) => c.id));
  return (
    s.schema === 1 &&
    isInt(s.rng, 0, 0xffffffff) &&
    Array.isArray(s.players) &&
    s.players.length >= 2 &&
    s.players.length <= 6 &&
    s.players.every(
      (p) =>
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        chars.has(p.character) &&
        isInt(p.node, 0, NODE_COUNT - 1) &&
        isInt(p.carried, 0) &&
        isInt(p.banked, 0) &&
        typeof p.decoyUsed === 'boolean',
    ) &&
    isInt(s.ghost, 1, NODE_COUNT - 1) &&
    Array.isArray(s.stocks) && s.stocks.length === NODE_COUNT && s.stocks.every((v) => isInt(v, 0)) &&
    Array.isArray(s.piles) && s.piles.length === NODE_COUNT && s.piles.every((v) => isInt(v, 0)) &&
    Array.isArray(s.deck) && Array.isArray(s.discard) && s.deck.length + s.discard.length === 18 &&
    isInt(s.round, 1, 10) &&
    isInt(s.turn, 0, s.players.length - 1) &&
    ['turnStart', 'choose', 'event', 'ghost', 'summary', 'gameOver'].includes(s.phase) &&
    (s.dice === null || (Array.isArray(s.dice) && s.dice.length === 2 && s.dice.every((d) => isInt(d, 1, 6)))) &&
    (s.phase === 'turnStart' || s.phase === 'gameOver' || s.dice !== null) &&
    Array.isArray(s.log)
  );
}

export function serialize(session: Session, personalization: Personalization): string {
  const file: SaveFile = { schema: SAVE_SCHEMA, savedAt: new Date().toISOString(), session, personalization };
  return JSON.stringify(file);
}

export type LoadResult =
  | { ok: true; session: Session; personalization: Personalization }
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
  return { ok: true, session: ses, personalization: sanitizePersonalization(parsed.personalization) };
}
