// App-level state: which screen is up, the live session, seats (humans,
// bots, phones), settings and personalisation, and the glue that sends
// actions to the engine (locally) or to the room service (phone rooms),
// starts the matching animation, and saves on this device.

import { useSyncExternalStore } from 'react';
import { CHARACTERS, DEFAULT_PLAYER_NAMES, MAX_PIECES, MIN_PIECES, ROUNDS, TEXT_LIMITS, type CharacterId } from './engine/config';
import { actingPiece, createGame, dispatch, newSession, undo as undoSession, type Session } from './engine/engine';
import type { Action, GameState, LogEntry } from './engine/types';
import { botAction, defaultBotProfile, newBotMemory, reflexOf, type BotMemory, type BotProfile } from './engine/bots';
import { botRopeInputs, type ChallengeInput } from './engine/challenges';
import { seatView } from './engine/view';
import {
  cleanText,
  defaultPersonalization,
  deserialize,
  PREFS_KEY,
  SAVE_KEY,
  sanitizePersonalization,
  serialize,
  SETTINGS_KEY,
  type Personalization,
  type SeatSetup,
} from './engine/save';
import { director } from './director';
import { audio } from './audio/audio';

export type Screen = 'title' | 'setup' | 'game' | 'roomLobby';
export type Modal = null | 'rules' | 'settings' | 'menu' | 'confirmNew' | 'confirmUndo' | 'saveProblem' | 'confirmDiscard' | 'keys';

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  calmCamera: boolean;
  /** No shadows and a 1× pixel ratio, for older laptops and tablets. */
  lowGraphics: boolean;
  /** Shorter pauses and animations when only bots are acting. */
  fastBots: boolean;
}

/** One board piece at local setup: one or two people sharing it, or a bot. */
export interface SetupPiece extends SeatSetup {
  /** One name per person (a second name makes a pair in Team Battle). */
  names: string[];
  character: CharacterId;
}

/**
 * Keys for people sharing one keyboard in a challenge: up to four pieces jump
 * at once, each with its own key. Space also works when only one person jumps.
 */
export const JUMP_KEYS: Array<{ code: string; label: string }> = [
  { code: 'KeyF', label: 'F' },
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyA', label: 'A' },
  { code: 'KeyL', label: 'L' },
];

export interface AppState {
  screen: Screen;
  session: Session | null;
  /** 'local': this device runs the engine. 'room': the room service does. */
  mode: 'local' | 'room';
  seats: SeatSetup[];
  personalization: Personalization;
  setupPieces: SetupPiece[];
  setupMode: 'ffa' | 'teams';
  /** Advanced: allow fewer than four pieces (off by default). */
  fewerPieces: boolean;
  settings: Settings;
  cameraMode: 'follow' | 'overview';
  tipDismissed: boolean;
  modal: Modal;
  saveProblem: null | 'corrupt' | 'incompatible' | 'layout';
  hasSave: boolean;
  saveError: boolean;
  busy: boolean;
  banner: { id: number; text: string; sub?: string } | null;
  rollId: number;
  hoverNode: number | null;
  editingPlayer: number;
  /** Local secret placement: which piece is behind the curtain, and what they have tapped. */
  placement: { seat: number | null; draft: number | null; confirmed: boolean };
  /** Phone-room hosting (TV side). */
  room: {
    code: string | null;
    joinUrl: string | null;
    problem: string | null;
    status: string;
    view: import('./net/protocol').RoomView | null;
    error: string | null;
  } | null;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** The normal game: four pieces. Seats nobody claims are bots (steady reflexes, not perfect). */
export const DEFAULT_PIECES = MAX_PIECES;

export function fillBot(character: CharacterId, i: number): SetupPiece {
  return { names: [`${CHARACTERS.find((c) => c.id === character)!.name} Bot`], character, kind: 'bot', bot: { ...defaultBotProfile(i), skill: 'steady' } };
}

/** Pad a lineup with bots up to `count` pieces, each in a costume nobody else wears. */
export function fillWithBots(pieces: SetupPiece[], count: number = DEFAULT_PIECES): SetupPiece[] {
  const next = pieces.slice(0, count);
  while (next.length < count) {
    const free = CHARACTERS.find((c) => !next.some((p) => p.character === c.id))!;
    next.push(fillBot(free.id, next.length));
  }
  return next;
}

function defaultSetupPieces(): SetupPiece[] {
  return fillWithBots([{ names: [DEFAULT_PLAYER_NAMES[0]], character: CHARACTERS[0].id, kind: 'human' }]);
}

function loadSettings(): Settings {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowParam = typeof location !== 'undefined' && new URLSearchParams(location.search).get('quality') === 'low';
  const d: Settings = { musicVolume: 0.35, sfxVolume: 0.8, muted: false, reducedMotion: reduce, calmCamera: reduce, lowGraphics: lowParam, fastBots: false };
  try {
    const raw = safeGet(SETTINGS_KEY);
    if (!raw) return d;
    const o = JSON.parse(raw);
    const b = (k: keyof Settings) => (typeof o[k] === 'boolean' ? o[k] : d[k]) as boolean;
    return {
      musicVolume: typeof o.musicVolume === 'number' ? Math.min(1, Math.max(0, o.musicVolume)) : d.musicVolume,
      sfxVolume: typeof o.sfxVolume === 'number' ? Math.min(1, Math.max(0, o.sfxVolume)) : d.sfxVolume,
      muted: !!o.muted,
      reducedMotion: b('reducedMotion'),
      calmCamera: b('calmCamera'),
      lowGraphics: lowParam || b('lowGraphics'),
      fastBots: b('fastBots'),
    };
  } catch {
    return d;
  }
}

function sanitizeSeat(p: Partial<SetupPiece>, i: number): SeatSetup {
  if (p.kind === 'bot') {
    const bot = p.bot && ['cautious', 'greedy', 'mischievous'].includes(p.bot.personality) && ['shaky', 'steady', 'sharp'].includes(p.bot.skill) ? p.bot : defaultBotProfile(i);
    return { kind: 'bot', bot };
  }
  return { kind: 'human' };
}

function loadPrefs(): { personalization: Personalization; setupPieces: SetupPiece[]; setupMode: 'ffa' | 'teams'; fewerPieces: boolean } {
  const d = { personalization: defaultPersonalization(), setupPieces: defaultSetupPieces(), setupMode: 'ffa' as const, fewerPieces: false };
  try {
    const raw = safeGet(PREFS_KEY);
    if (!raw) return d;
    const o = JSON.parse(raw);
    const pieces: SetupPiece[] = Array.isArray(o.setupPieces) ? o.setupPieces : [];
    const ids = new Set(CHARACTERS.map((c) => c.id));
    const ok =
      pieces.length >= MIN_PIECES &&
      pieces.length <= MAX_PIECES &&
      pieces.every((p) => ids.has(p.character) && Array.isArray(p.names) && p.names.length >= 1 && p.names.length <= 2) &&
      new Set(pieces.map((p) => p.character)).size === pieces.length;
    const mode = o.setupMode === 'teams' ? 'teams' : 'ffa';
    // Fewer than four pieces only when someone chose that under Advanced; older saved lineups are filled with bots.
    const fewerPieces = o.fewerPieces === true;
    const lineup: SetupPiece[] = ok
      ? pieces.map((p, i) => {
          const seat = sanitizeSeat(p, i);
          const names = (seat.kind === 'bot' || mode === 'ffa' ? p.names.slice(0, 1) : p.names).map((n, k) => cleanText(n, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[(i * 2 + k) % DEFAULT_PLAYER_NAMES.length]));
          return { names, character: p.character, ...seat };
        })
      : d.setupPieces;
    return {
      personalization: sanitizePersonalization(o.personalization),
      setupMode: mode,
      fewerPieces,
      setupPieces: fewerPieces ? lineup : fillWithBots(lineup),
    };
  } catch {
    return d;
  }
}

function probeSave(): { hasSave: boolean; saveProblem: AppState['saveProblem'] } {
  const r = deserialize(safeGet(SAVE_KEY));
  if (r.ok) return { hasSave: r.session.game.phase !== 'gameOver', saveProblem: null };
  if (r.reason === 'missing') return { hasSave: false, saveProblem: null };
  return { hasSave: false, saveProblem: r.reason };
}

const prefs = loadPrefs();
const probe = probeSave();

let state: AppState = {
  screen: 'title',
  session: null,
  mode: 'local',
  seats: [],
  personalization: prefs.personalization,
  setupPieces: prefs.setupPieces,
  setupMode: prefs.setupMode,
  fewerPieces: prefs.fewerPieces,
  settings: loadSettings(),
  cameraMode: 'follow',
  tipDismissed: false,
  modal: null,
  saveProblem: probe.saveProblem,
  hasSave: probe.hasSave,
  saveError: false,
  busy: false,
  banner: null,
  rollId: 0,
  hoverNode: null,
  editingPlayer: 0,
  placement: { seat: null, draft: null, confirmed: false },
  room: null,
};

const listeners = new Set<() => void>();
export function getState() {
  return state;
}
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

/** The game as this screen may show it. */
export function currentGame(): GameState | null {
  return state.session?.game ?? null;
}

director.subscribe(() => {
  setState({ busy: director.busy });
  if (!director.busy) pumpBots();
});

// Read-only handle for automated browser checks and debugging.
(globalThis as unknown as { __omr?: unknown }).__omr = { getState, director, act: (a: Action) => act(a) };
director.onCue = (s) => audio.play(s);

function applyAudioSettings(s: Settings) {
  audio.musicVolume = s.musicVolume;
  audio.sfxVolume = s.sfxVolume;
  audio.muted = s.muted;
  audio.applyVolumes();
  director.speed = s.reducedMotion ? 2.2 : 1;
}
applyAudioSettings(state.settings);

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  safeSet(SETTINGS_KEY, JSON.stringify(settings));
  applyAudioSettings(settings);
}

export function savePrefs() {
  safeSet(PREFS_KEY, JSON.stringify({ personalization: state.personalization, setupPieces: state.setupPieces, setupMode: state.setupMode, fewerPieces: state.fewerPieces }));
}

function persist() {
  if (!state.session || state.mode !== 'local') return;
  const ok = safeSet(SAVE_KEY, serialize(state.session, state.personalization, state.seats));
  setState({ saveError: !ok, hasSave: state.session.game.phase !== 'gameOver' });
}

// ── room transport (set by the phone-room client) ───────────────────────

export interface Transport {
  send(action: Action): void;
}
let transport: Transport | null = null;
export function setTransport(t: Transport | null) {
  transport = t;
}

/** A room update arrived: show it like a locally dispatched action. */
export function applyRemote(game: GameState, events: LogEntry[]) {
  const before = state.session?.game ?? game;
  const known = [...(state.session?.known ?? [])];
  for (const t of game.traps) if (t.revealed && !known.some((k) => k.node === t.node)) known.push({ node: t.node, effect: t.effect });
  setState({
    session: { game, turnStart: game, previousTurnStart: null, known },
    rollId: events.some((e) => e.kind === 'roll' || e.kind === 'lifeRoll') ? state.rollId + 1 : state.rollId,
  });
  if (events.length) director.play(events, before, game);
  afterEvents(game, events);
}

/** Round banners are shown by the store, so skipping an animation never loses them. */
function afterEvents(game: GameState, events: LogEntry[]) {
  audio.midnight = game.round >= ROUNDS - 2;
  const end = events.find((e) => e.kind === 'roundEnd');
  const start = events.find((e) => e.kind === 'roundStart');
  if (!end && !start) return;
  const name = (i: number) => game.pieces[i]?.name ?? '';
  let text = '';
  let sub = '';
  if (end && end.kind === 'roundEnd') {
    text = `${name(end.piece)} scores round ${end.round}`;
    sub = end.round >= ROUNDS ? 'The last bell has rung.' : `Alive at the bell · ${end.score} point${end.score === 1 ? '' : 's'}`;
  }
  if (start && start.kind === 'roundStart') {
    const order = start.schedule.map(name).join(' → ');
    if (!text) text = start.round === ROUNDS ? 'Final round' : `Round ${start.round}`;
    else sub = `${sub} · Round ${start.round}${start.round === ROUNDS ? ' (final)' : ''}: ${order}`;
    if (!end) sub = `Order: ${order}`;
  }
  setState((st) => ({ banner: { id: (st.banner?.id ?? 0) + 1, text, sub } }));
}

// ── game flow ───────────────────────────────────────────────────────────

const botMemories = new Map<number, BotMemory>();
function memoryFor(seat: number): BotMemory {
  let m = botMemories.get(seat);
  if (!m) {
    m = newBotMemory(((state.session?.game.pieces.length ?? 1) * 7919 + seat * 104729 + Date.now()) >>> 0);
    botMemories.set(seat, m);
  }
  return m;
}

export function act(action: Action) {
  const s = state;
  if (!s.session || s.modal) return;
  if (s.busy && action.type !== 'challengeResult') return; // no stale actions mid-animation
  if (s.mode === 'room') {
    transport?.send(action);
    return;
  }
  const before = s.session.game;
  const r = dispatch(s.session, action);
  if (r.error) return;
  setState({ session: r.session, rollId: action.type === 'roll' ? s.rollId + 1 : s.rollId });
  director.play(r.events, before, r.session.game);
  afterEvents(r.session.game, r.events);
  if (action.type === 'nominate') setState({});
  persist();
  pumpBots();
}

export function isBotSeat(seat: number): boolean {
  return state.seats[seat]?.kind === 'bot';
}

let botTimer: number | null = null;
/**
 * Let bots act when it is their move. Bots only ever see a seat view — the
 * public state plus their own nomination — through the same function a
 * remote bot would use. With no people at all, the life roll happens by itself.
 */
export function pumpBots() {
  if (state.mode !== 'local' || !state.session || botTimer !== null) return;
  const g = state.session.game;
  if (g.phase === 'gameOver' || g.phase === 'challenge') return;
  if (g.phase === 'placement') {
    for (let seat = 0; seat < g.pieces.length; seat++) {
      if (!isBotSeat(seat) || g.nominations[seat] !== null) continue;
      const a = botAction(seatView(g, seat), state.seats[seat].bot!, memoryFor(seat));
      if (a) {
        act(a);
        return;
      }
    }
    return;
  }
  if (g.phase === 'lifeRoll') {
    if (state.seats.some((x) => x.kind === 'human') || state.busy || state.modal) return;
    botTimer = window.setTimeout(() => {
      botTimer = null;
      act({ type: 'rollForLife' });
    }, 600);
    return;
  }
  // A ghost battle's winner chooses its reward even when it is not its turn.
  const decider = (x: GameState) => (x.phase === 'reward' && x.pendingReward ? x.pendingReward.piece : actingPiece(x));
  const acting = decider(g);
  if (!isBotSeat(acting) || state.busy || state.modal) return;
  const fast = state.settings.fastBots;
  const delay = g.phase === 'choose' ? (fast ? 150 : 650) : fast ? 120 : 520;
  botTimer = window.setTimeout(() => {
    botTimer = null;
    const cur = state.session?.game;
    if (!cur || cur !== g || state.busy || state.modal) {
      pumpBots();
      return;
    }
    const me = decider(cur);
    const a = botAction(seatView(cur, me), state.seats[me].bot!, memoryFor(me));
    if (a) act(a);
    if (fast) director.skip();
  }, delay);
}

/** Inputs for the bot participants of the current challenge, via the same judged format. */
export function botInputsFor(ch: NonNullable<GameState['challenge']>): Record<number, ChallengeInput[]> {
  const out: Record<number, ChallengeInput[]> = {};
  for (const p of ch.participants) {
    const seat = state.seats[p];
    if (seat?.kind === 'bot') out[p] = botRopeInputs(ch.seed, p, reflexOf(seat.bot!));
  }
  return out;
}

export function startGame(lineup: SetupPiece[] = state.setupPieces) {
  // Four pieces unless fewer were chosen under Advanced: empty seats never silently disappear.
  const pieces = state.fewerPieces ? lineup : fillWithBots(lineup);
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const game = createGame({
    pieces: pieces.map((p, i) => {
      const bot = p.kind === 'bot';
      const names = (bot ? p.names.slice(0, 1) : p.names).map((n, k) => cleanText(n, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[(i * 2 + k) % DEFAULT_PLAYER_NAMES.length]));
      return { character: p.character, controllers: bot ? [/bot\b/i.test(names[0]) ? names[0] : `${names[0]} Bot`] : names, bot };
    }),
    seed,
  });
  director.reset();
  botMemories.clear();
  setState({
    session: newSession(game),
    mode: 'local',
    seats: pieces.map((p, i) => sanitizeSeat(p, i)),
    screen: 'game',
    modal: null,
    tipDismissed: false,
    banner: null,
    placement: { seat: null, draft: null, confirmed: false },
  });
  audio.midnight = false;
  savePrefs();
  persist();
  pumpBots();
}

export function resumeGame() {
  const r = deserialize(safeGet(SAVE_KEY));
  if (!r.ok) {
    setState({ saveProblem: r.reason === 'missing' ? null : r.reason, modal: r.reason === 'missing' ? null : 'saveProblem', hasSave: false });
    return;
  }
  director.reset();
  botMemories.clear();
  audio.midnight = r.session.game.round >= ROUNDS - 2;
  setState({
    session: r.session,
    mode: 'local',
    seats: r.seats ?? r.session.game.pieces.map((p) => (p.bot ? { kind: 'bot' as const, bot: defaultBotProfile(0) } : { kind: 'human' as const })),
    personalization: r.personalization,
    screen: 'game',
    modal: null,
    tipDismissed: r.session.game.actionNumber > 1,
    placement: { seat: null, draft: null, confirmed: false },
  });
  pumpBots();
}

/** Removes only this game's own save key, after the player confirmed. */
export function discardSave() {
  safeRemove(SAVE_KEY);
  setState({ hasSave: false, saveProblem: null, modal: null });
}

export function doUndo() {
  if (!state.session || state.mode !== 'local') return;
  director.reset();
  const session = undoSession(state.session);
  setState({ session, modal: null });
  audio.midnight = session.game.round >= ROUNDS - 2;
  persist();
  pumpBots();
}

export function goToSetup() {
  director.reset();
  setTransport(null);
  setState({ screen: 'setup', modal: null, session: null, mode: 'local' });
}

export function goToTitle() {
  director.reset();
  setTransport(null);
  setState({ screen: 'title', modal: null, session: null, mode: 'local', ...probeSave() });
}

export function playAgain() {
  if (!state.session) return;
  startGame(
    state.session.game.pieces.map((p, i) => {
      const seat = state.seats[i] ?? { kind: 'human' as const };
      return { names: seat.kind === 'bot' ? [p.controllers[0].replace(/ \(bot\)$/, '')] : p.controllers.slice(), character: p.character, ...seat };
    }),
  );
}

export function toggleCamera() {
  setState((s) => ({ cameraMode: s.cameraMode === 'follow' ? 'overview' : 'follow' }));
}

export function setPersonalization(p: Personalization) {
  setState({ personalization: p });
  savePrefs();
  persist();
}

export type { BotProfile };
