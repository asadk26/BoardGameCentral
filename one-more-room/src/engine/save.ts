// Versioned local persistence. Only this game's own keys are ever written or
// removed; nothing else in the browser's storage is touched.

import {
  CHARACTERS,
  DEFAULT_MANSION_NAME,
  MAX_PIECES,
  NODE_COUNT,
  ROOMS,
  ROUNDS,
  STRIDE_ALLOWANCE,
  TEXT_LIMITS,
  TRAP_COUNT,
  trapEligible,
  VERSUS_SPACES,
  type ItemId,
} from './config';
import { seedFrom } from './rng';
import type { GameState } from './types';
import type { Session } from './engine';
import type { BotProfile } from './bots';

export const SAVE_KEY = 'one-more-room/save';
export const PREFS_KEY = 'one-more-room/prefs';
export const SETTINGS_KEY = 'one-more-room/settings';
/**
 * v1 = original candy rules; v2 = candy with survival encounters;
 * v3 = One Life (one living piece, points per round held);
 * v4 = One Life with ghost battles and items. v3 saves migrate to v4 when
 * no trap sits on a new Versus space.
 * v5 = exact-roll movement, one step at a time (a move in progress is saved
 * with its remaining steps). v4 saves migrate: a piece that had rolled but not
 * yet moved keeps its roll and moves exactly that far.
 */
export const SAVE_SCHEMA = 5;

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
const PHASES = ['placement', 'lifeRoll', 'turnStart', 'choose', 'pick', 'hunt', 'challenge', 'reward', 'summary', 'gameOver'];
const ITEMS: readonly ItemId[] = ['secondRoll', 'ghostSwitch', 'ghostlyStride'];
const isItem = (v: unknown) => v === null || ITEMS.includes(v as ItemId);

export function validGame(g: unknown): g is GameState {
  if (!g || typeof g !== 'object') return false;
  const s = g as GameState;
  const chars = new Set(CHARACTERS.map((c) => c.id));
  if (s.schema !== 5 || !Array.isArray(s.pieces) || s.pieces.length < 2 || s.pieces.length > MAX_PIECES) return false;
  const started = s.phase !== 'placement' && s.phase !== 'lifeRoll';
  const living = s.pieces.filter((p) => p && p.alive).length;
  return (
    isInt(s.rng, 0, 0xffffffff) &&
    isInt(s.challengeRng, 0, 0xffffffff) &&
    isInt(s.rewardRng, 0, 0xffffffff) &&
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
        typeof p.alive === 'boolean' &&
        isItem(p.item) &&
        (p.itemAwardedAt === null || Number.isInteger(p.itemAwardedAt)) &&
        !(p.alive && p.item),
    ) &&
    isItem(s.itemUsed) &&
    Array.isArray(s.battlesThisRound) &&
    s.battlesThisRound.every((k) => typeof k === 'string') &&
    (s.phase !== 'reward' || (!!s.pendingReward && isItem(s.pendingReward.current) && isItem(s.pendingReward.offered))) &&
    (s.phase !== 'hunt' || !!s.options) &&
    (s.phase !== 'choose' ||
      (!!s.move && isInt(s.move.remaining, 1, 6) && Array.isArray(s.move.path) && s.move.path.length >= 1 && s.move.path.every((n) => isInt(n, 0, NODE_COUNT - 1)))) &&
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
  | { ok: false; reason: 'missing' | 'corrupt' | 'incompatible' | 'layout' };

/**
 * Bring a One Life schema-3 snapshot up to schema 4: empty inventories, no
 * battles yet, and a reward stream derived from the game's own seed. Refuses
 * (returns null) if a hidden trap or a nomination sits on a new Versus space.
 */
function migrate3(g: unknown): GameState | null {
  if (!g || typeof g !== 'object') return null;
  const s = g as Record<string, unknown> & { pieces?: Array<Record<string, unknown>>; traps?: Array<{ node: number }>; nominations?: Array<number | null> };
  if (s.schema !== 3) return null;
  if ((s.traps ?? []).some((t) => VERSUS_SPACES.includes(t.node))) return null;
  if ((s.nominations ?? []).some((n) => n !== null && VERSUS_SPACES.includes(n))) return null;
  const out = {
    ...s,
    schema: 4,
    rewardRng: seedFrom(`reward:${(s.seed as number) ?? 0}`),
    rollInfo: s.phase === 'choose' ? { kind: 'die' } : null,
    itemUsed: null,
    options: s.phase === 'hunt' ? { living: true, sameSpace: [], versus: [], versusInactive: null } : null,
    battlesThisRound: [],
    pendingReward: null,
    pieces: (s.pieces ?? []).map((p) => ({
      ...p,
      item: null,
      itemAwardedAt: null,
    })),
  };
  return out as unknown as GameState;
}

/** Schema 4 → 5: a rolled-but-unmoved piece now moves exactly its roll (or six for Ghostly Stride). */
function migrate4(g: unknown): GameState | null {
  if (!g || typeof g !== 'object') return null;
  const s = g as Record<string, unknown> & { pieces?: Array<{ node: number; alive: boolean }>; schedule?: number[]; slot?: number };
  if (s.schema !== 4) return null;
  const rest: Record<string, unknown> = { ...s };
  delete rest.selection;
  let move = null;
  let allowance = s.allowance;
  if (s.phase === 'choose') {
    const steps = (s.rollInfo as { kind?: string } | null)?.kind === 'stride' ? STRIDE_ALLOWANCE : ((s.die as number | null) ?? 1);
    const node = s.pieces?.[s.schedule?.[s.slot ?? 0] ?? 0]?.node ?? 0;
    move = { remaining: steps, prev: null, path: [node], usedSecret: false, usedWall: false };
    allowance = steps;
  }
  return { ...rest, schema: 5, move, allowance } as unknown as GameState;
}

export function deserialize(raw: string | null): LoadResult {
  if (raw === null) return { ok: false, reason: 'missing' };
  let parsed: SaveFile;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'corrupt' };
  if (parsed.schema === 3 && parsed.session) {
    // One Life before ghost battles: migrate every snapshot, or refuse clearly.
    const old = parsed.session;
    const game = migrate3(old.game);
    const turnStart = migrate3(old.turnStart);
    const prev = old.previousTurnStart === null ? null : migrate3(old.previousTurnStart);
    if (!game || !turnStart || (old.previousTurnStart !== null && !prev)) {
      const layoutClash = [old.game, old.turnStart].some(
        (x) =>
          x &&
          ((x as GameState).traps?.some((t) => VERSUS_SPACES.includes(t.node)) ||
            (x as GameState).nominations?.some((n) => n !== null && VERSUS_SPACES.includes(n))),
      );
      return { ok: false, reason: layoutClash ? 'layout' : 'corrupt' };
    }
    parsed.session = { ...old, game, turnStart, previousTurnStart: prev };
    parsed.schema = 4;
  }
  if (parsed.schema === 4 && parsed.session) {
    const old = parsed.session;
    const game = migrate4(old.game);
    const turnStart = migrate4(old.turnStart);
    const prev = old.previousTurnStart === null ? null : migrate4(old.previousTurnStart);
    if (!game || !turnStart || (old.previousTurnStart !== null && !prev)) return { ok: false, reason: 'corrupt' };
    parsed.session = { ...old, game, turnStart, previousTurnStart: prev };
    parsed.schema = SAVE_SCHEMA;
  }
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
