// App-level state: which screen is up, the live session, seats (humans,
// bots, phones), settings and personalisation, and the glue that sends
// actions to the engine (locally) or to the room service (phone rooms),
// starts the matching animation, and saves on this device.

import { useSyncExternalStore } from 'react';
import { CHARACTERS, DEFAULT_PLAYER_NAMES, TEXT_LIMITS, type CharacterId } from './engine/config';
import { createGame, dispatch, newSession, undo as undoSession, type Session } from './engine/engine';
import type { Action, GameState } from './engine/types';
import { botAction, defaultBotProfile, newBotMemory, reflexOf, type BotMemory, type BotProfile } from './engine/bots';
import { botChallengeInputs } from './engine/challenges';
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

export interface SetupPlayer extends SeatSetup {
  name: string;
  character: CharacterId;
}

/** Keyboard keys for up to two humans sharing one keyboard in a duel. */
export interface KeyMap {
  a: string;
  b: string;
}
export const KEY_SETS: Array<{ label: string; keys: KeyMap }> = [
  { label: 'F and J', keys: { a: 'f', b: 'j' } },
  { label: 'A and L', keys: { a: 'a', b: 'l' } },
  { label: 'Left Shift and Right Shift', keys: { a: 'ShiftLeft', b: 'ShiftRight' } },
];

export interface AppState {
  screen: Screen;
  session: Session | null;
  /** 'local': this device runs the engine. 'room': the room service does. */
  mode: 'local' | 'room';
  seats: SeatSetup[];
  personalization: Personalization;
  setupPlayers: SetupPlayer[];
  settings: Settings;
  keySet: number;
  cameraMode: 'follow' | 'overview';
  tipDismissed: boolean;
  modal: Modal;
  saveProblem: null | 'corrupt' | 'incompatible';
  hasSave: boolean;
  saveError: boolean;
  busy: boolean;
  banner: { id: number; text: string; sub?: string } | null;
  rollId: number;
  hoverNode: number | null;
  editingPlayer: number;
  /** Local secret placement: which seat is behind the curtain, and what they have tapped. */
  placement: { seat: number | null; draft: number | null; confirmed: boolean };
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

function defaultSetupPlayers(n = 4): SetupPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? DEFAULT_PLAYER_NAMES[0] : DEFAULT_PLAYER_NAMES[i],
    character: CHARACTERS[i].id,
    kind: i === 0 ? 'human' : 'bot',
    bot: i === 0 ? undefined : defaultBotProfile(i),
  }));
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

function sanitizeSeat(p: Partial<SetupPlayer>, i: number): SeatSetup {
  if (p.kind === 'bot') {
    const bot = p.bot && ['cautious', 'greedy', 'mischievous'].includes(p.bot.personality) && ['shaky', 'steady', 'sharp'].includes(p.bot.skill) ? p.bot : defaultBotProfile(i);
    return { kind: 'bot', bot };
  }
  return { kind: 'human' };
}

function loadPrefs(): { personalization: Personalization; setupPlayers: SetupPlayer[] } {
  try {
    const raw = safeGet(PREFS_KEY);
    if (!raw) return { personalization: defaultPersonalization(), setupPlayers: defaultSetupPlayers() };
    const o = JSON.parse(raw);
    const players: SetupPlayer[] = Array.isArray(o.setupPlayers) ? o.setupPlayers : [];
    const ids = new Set(CHARACTERS.map((c) => c.id));
    const ok = players.length >= 2 && players.length <= 6 && players.every((p) => ids.has(p.character)) && new Set(players.map((p) => p.character)).size === players.length;
    return {
      personalization: sanitizePersonalization(o.personalization),
      setupPlayers: ok
        ? players.map((p, i) => ({ name: cleanText(p.name, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[i]), character: p.character, ...sanitizeSeat(p, i) }))
        : defaultSetupPlayers(),
    };
  } catch {
    return { personalization: defaultPersonalization(), setupPlayers: defaultSetupPlayers() };
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
  setupPlayers: prefs.setupPlayers,
  settings: loadSettings(),
  keySet: 0,
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
  safeSet(PREFS_KEY, JSON.stringify({ personalization: state.personalization, setupPlayers: state.setupPlayers }));
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
export function applyRemote(game: GameState, events: import('./engine/types').LogEntry[]) {
  const before = state.session?.game ?? game;
  const known = Array.from(new Set([...(state.session?.known ?? []), ...game.traps.filter((t) => t.revealed).map((t) => t.node)]));
  setState({
    session: { game, turnStart: game, previousTurnStart: null, known },
    rollId: events.some((e) => e.kind === 'roll') ? state.rollId + 1 : state.rollId,
  });
  if (events.length) director.play(events, before, game);
  afterEvents(game, events);
}

function afterEvents(game: GameState, events: import('./engine/types').LogEntry[]) {
  audio.midnight = game.midnight;
  if (events.some((e) => e.kind === 'midnight')) {
    audio.play('bell');
    setState((st) => ({ banner: { id: (st.banner?.id ?? 0) + 1, text: 'Three rounds until midnight', sub: 'The house wants a soul. Duels now leave one survivor.' } }));
  }
}

// ── game flow ───────────────────────────────────────────────────────────

const botMemories = new Map<number, BotMemory>();
function memoryFor(seat: number): BotMemory {
  let m = botMemories.get(seat);
  if (!m) {
    m = newBotMemory(((state.session?.game.players.length ?? 1) * 7919 + seat * 104729 + Date.now()) >>> 0);
    botMemories.set(seat, m);
  }
  return m;
}

export function act(action: Action) {
  const s = state;
  if (!s.session || s.modal) return;
  if (s.busy && action.type !== 'select' && action.type !== 'challengeResult') return; // no stale actions mid-animation
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
  if (action.type === 'placeDecoy' || action.type === 'nominate') setState({});
  if (action.type !== 'select') persist();
  else persistSoon();
  pumpBots();
}

let persistTimer: number | null = null;
function persistSoon() {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persist();
  }, 250);
}

export function isBotSeat(seat: number): boolean {
  return state.seats[seat]?.kind === 'bot';
}

let botTimer: number | null = null;
/**
 * Let bots act when it is their move. Bots only ever see a seat view — the
 * public state plus their own nomination — through the same function a
 * remote bot would use.
 */
export function pumpBots() {
  if (state.mode !== 'local' || !state.session || botTimer !== null) return;
  const g = state.session.game;
  if (g.phase === 'gameOver' || g.phase === 'challenge') return;
  if (g.phase === 'placement') {
    for (let seat = 0; seat < g.players.length; seat++) {
      if (!isBotSeat(seat) || g.nominations[seat] !== null) continue;
      const a = botAction(seatView(g, seat), state.seats[seat].bot!, memoryFor(seat));
      if (a) {
        act(a);
        return;
      }
    }
    return;
  }
  if (!isBotSeat(g.turn) || state.busy || state.modal) return;
  const fast = state.settings.fastBots;
  const delay = g.phase === 'choose' ? (fast ? 150 : 650) : fast ? 120 : 520;
  botTimer = window.setTimeout(() => {
    botTimer = null;
    const cur = state.session?.game;
    if (!cur || cur !== g || state.busy || state.modal) {
      pumpBots();
      return;
    }
    const a = botAction(seatView(cur, cur.turn), state.seats[cur.turn].bot!, memoryFor(cur.turn));
    if (a) act(a);
    if (fast) director.skip();
  }, delay);
}

/** Inputs for the bot participants of the current challenge, via the same judged format. */
export function botInputsFor(ch: NonNullable<GameState['challenge']>): Record<number, import('./engine/challenges').ChallengeInput[]> {
  const out: Record<number, import('./engine/challenges').ChallengeInput[]> = {};
  for (const p of ch.participants) {
    const seat = state.seats[p];
    if (seat?.kind === 'bot') out[p] = botChallengeInputs(ch.kind, ch.seed, p, reflexOf(seat.bot!), ch.oneSurvivor);
  }
  return out;
}

export function startGame(players: SetupPlayer[] = state.setupPlayers) {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const game = createGame({ players: players.map((p, i) => ({ name: cleanText(p.name, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[i]), character: p.character })), seed });
  director.reset();
  botMemories.clear();
  setState({
    session: newSession(game),
    mode: 'local',
    seats: players.map((p, i) => sanitizeSeat(p, i)),
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
  audio.midnight = r.session.game.midnight;
  setState({
    session: r.session,
    mode: 'local',
    seats: r.seats ?? r.session.game.players.map(() => ({ kind: 'human' as const })),
    personalization: r.personalization,
    screen: 'game',
    modal: null,
    tipDismissed: r.session.game.turnNumber > 1,
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
  audio.midnight = session.game.midnight;
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
  startGame(state.session.game.players.map((p, i) => ({ name: p.name, character: p.character, ...(state.seats[i] ?? { kind: 'human' }) })));
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
