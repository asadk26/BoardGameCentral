// App-level state: which screen is up, the live session, settings and
// personalisation, and the glue that sends actions to the engine, starts the
// matching animation, and saves the result on this device.

import { useSyncExternalStore } from 'react';
import { CHARACTERS, DEFAULT_PLAYER_NAMES, TEXT_LIMITS, type CharacterId } from './engine/config';
import { createGame, dispatch, newSession, undo as undoSession, type Session } from './engine/engine';
import type { Action } from './engine/types';
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
} from './engine/save';
import { director } from './director';
import { audio } from './audio/audio';

export type Screen = 'title' | 'setup' | 'game';
export type Modal = null | 'rules' | 'settings' | 'menu' | 'confirmNew' | 'confirmUndo' | 'saveProblem' | 'confirmDiscard';

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  calmCamera: boolean;
  /** No shadows and a 1× pixel ratio, for older laptops and tablets. */
  lowGraphics: boolean;
}

export interface SetupPlayer {
  name: string;
  character: CharacterId;
}

export interface AppState {
  screen: Screen;
  session: Session | null;
  personalization: Personalization;
  setupPlayers: SetupPlayer[];
  settings: Settings;
  cameraMode: 'follow' | 'overview';
  tipDismissed: boolean;
  modal: Modal;
  saveProblem: null | 'corrupt' | 'incompatible';
  hasSave: boolean;
  saveError: boolean;
  busy: boolean;
  banner: { id: number; text: string } | null;
  rollId: number;
  hoverNode: number | null;
  editingPlayer: number;
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
  return Array.from({ length: n }, (_, i) => ({ name: DEFAULT_PLAYER_NAMES[i], character: CHARACTERS[i].id }));
}

function loadSettings(): Settings {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowParam = typeof location !== 'undefined' && new URLSearchParams(location.search).get('quality') === 'low';
  const d: Settings = { musicVolume: 0.35, sfxVolume: 0.8, muted: false, reducedMotion: reduce, calmCamera: reduce, lowGraphics: lowParam };
  try {
    const raw = safeGet(SETTINGS_KEY);
    if (!raw) return d;
    const o = JSON.parse(raw);
    return {
      musicVolume: typeof o.musicVolume === 'number' ? Math.min(1, Math.max(0, o.musicVolume)) : d.musicVolume,
      sfxVolume: typeof o.sfxVolume === 'number' ? Math.min(1, Math.max(0, o.sfxVolume)) : d.sfxVolume,
      muted: !!o.muted,
      reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : d.reducedMotion,
      calmCamera: typeof o.calmCamera === 'boolean' ? o.calmCamera : d.calmCamera,
      lowGraphics: lowParam || (typeof o.lowGraphics === 'boolean' ? o.lowGraphics : d.lowGraphics),
    };
  } catch {
    return d;
  }
}

function loadPrefs(): { personalization: Personalization; setupPlayers: SetupPlayer[] } {
  try {
    const raw = safeGet(PREFS_KEY);
    if (!raw) return { personalization: defaultPersonalization(), setupPlayers: defaultSetupPlayers() };
    const o = JSON.parse(raw);
    const players: SetupPlayer[] = Array.isArray(o.setupPlayers) ? o.setupPlayers : [];
    const ids = new Set(CHARACTERS.map((c) => c.id));
    const ok =
      players.length >= 2 &&
      players.length <= 6 &&
      players.every((p) => ids.has(p.character)) &&
      new Set(players.map((p) => p.character)).size === players.length;
    return {
      personalization: sanitizePersonalization(o.personalization),
      setupPlayers: ok
        ? players.map((p, i) => ({ name: cleanText(p.name, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[i]), character: p.character }))
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
  personalization: prefs.personalization,
  setupPlayers: prefs.setupPlayers,
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

director.subscribe(() => setState({ busy: director.busy }));

// Read-only handle for automated browser checks and debugging.
(globalThis as unknown as { __omr?: unknown }).__omr = { getState, director };
director.onCue = (s) => {
  audio.play(s);
  if (s === 'bell') setState((st) => ({ banner: { id: (st.banner?.id ?? 0) + 1, text: 'Three rounds until midnight' } }));
};

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
  if (!state.session) return;
  const ok = safeSet(SAVE_KEY, serialize(state.session, state.personalization));
  setState({ saveError: !ok, hasSave: state.session.game.phase !== 'gameOver' });
}

// ── game flow ───────────────────────────────────────────────────────────

export function act(action: Action) {
  const s = state;
  if (!s.session || s.modal) return;
  if (s.busy && action.type !== 'select') return; // no stale actions mid-animation
  const before = s.session.game;
  const r = dispatch(s.session, action);
  if (r.error) return;
  setState({ session: r.session, rollId: action.type === 'roll' ? s.rollId + 1 : s.rollId });
  director.play(r.events, before, r.session.game);
  audio.midnight = r.session.game.midnight;
  if (action.type !== 'select') persist();
  else persistSoon();
}

let persistTimer: number | null = null;
function persistSoon() {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persist();
  }, 250);
}

export function startGame(players: SetupPlayer[] = state.setupPlayers) {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const game = createGame({ players: players.map((p, i) => ({ name: cleanText(p.name, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[i]), character: p.character })), seed });
  director.reset();
  setState({ session: newSession(game), screen: 'game', modal: null, tipDismissed: false, banner: null });
  audio.midnight = false;
  savePrefs();
  persist();
}

export function resumeGame() {
  const r = deserialize(safeGet(SAVE_KEY));
  if (!r.ok) {
    setState({ saveProblem: r.reason === 'missing' ? null : r.reason, modal: r.reason === 'missing' ? null : 'saveProblem', hasSave: false });
    return;
  }
  director.reset();
  audio.midnight = r.session.game.midnight;
  setState({ session: r.session, personalization: r.personalization, screen: 'game', modal: null, tipDismissed: r.session.game.turnNumber > 1 });
}

/** Removes only this game's own save key, after the player confirmed. */
export function discardSave() {
  safeRemove(SAVE_KEY);
  setState({ hasSave: false, saveProblem: null, modal: null });
}

export function doUndo() {
  if (!state.session) return;
  director.reset();
  const session = undoSession(state.session);
  setState({ session, modal: null });
  audio.midnight = session.game.midnight;
  persist();
}

export function goToSetup() {
  director.reset();
  setState({ screen: 'setup', modal: null, session: null });
}

export function goToTitle() {
  director.reset();
  setState({ screen: 'title', modal: null, session: null, ...probeSave() });
}

export function playAgain() {
  if (!state.session) return;
  startGame(state.session.game.players.map((p) => ({ name: p.name, character: p.character })));
}

export function toggleCamera() {
  setState((s) => ({ cameraMode: s.cameraMode === 'follow' ? 'overview' : 'follow' }));
}

export function setPersonalization(p: Personalization) {
  setState({ personalization: p });
  savePrefs();
  persist();
}
