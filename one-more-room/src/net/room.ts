// One phone room: the single authority for its game. Transport-agnostic —
// the WebSocket server (server/main.ts) and the tests drive it through
// `handle()` and read what it sends through the injected `send`.
//
// People and pieces are separate. A participant is a phone; a piece is a
// board piece with one or two people (or a bot). Authority is checked per
// piece and per round: in a pair the first person controls odd rounds and
// the second even rounds, for board actions and every challenge alike.
//
// Trust model (a casual party game, not esports anti-cheat): phones send
// intentions and timestamped button presses measured against the animation
// they showed. The room validates shape, ownership, revision, timing bounds
// and plausibility, and judges presses with the same pure judge the local
// game uses. A modified phone could still fake good timing for itself.

import { CHARACTERS, MAX_CONTROLLERS_PER_PIECE, MAX_PIECES, MIN_PIECES, TEXT_LIMITS, type CharacterId } from '../engine/config';
import { actingPiece, activeController, createGame, dispatch, newSession, type Session } from '../engine/engine';
import { botAction, newBotMemory, reflexOf, type BotMemory, type BotProfile } from '../engine/bots';
import { botRopeInputs, challengeDurationMs, sanitizeInputs, type ChallengeInput } from '../engine/challenges';
import { publicView, seatView } from '../engine/view';
import { cleanText } from '../engine/save';
import type { Action, LogEntry } from '../engine/types';
import type { ChallengeRunView, ClientMsg, PublicMember, PublicPiece, RoomMode, RoomView, ServerMsg, YouView } from './protocol';
import { MAX_PHONES } from './protocol';

export interface Participant {
  id: string;
  token: string;
  name: string;
  connected: boolean;
  recentIds: string[];
}

interface PieceSlot {
  character: CharacterId;
  kind: 'phone' | 'bot';
  /** Participant ids per controller slot (phones), in round-parity order. */
  members: string[];
  bot?: BotProfile;
  botName?: string;
  localControl?: boolean;
}

interface Run {
  id: string;
  attempt: number;
  ready: Set<number>;
  inputs: Map<number, ChallengeInput[]>;
  startAt: number | null;
  paused: string | null;
  note: string | null;
}

export interface RoomDeps {
  /** Deliver a message to the host ('host') or a participant id. */
  send: (to: string, msg: ServerMsg) => void;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  /** Bot pacing, ms; tests use a small value. */
  botDelayMs?: number;
}

const BOT_PROFILE_OK = (b: unknown): b is BotProfile =>
  !!b && typeof b === 'object' && ['cautious', 'greedy', 'mischievous'].includes((b as BotProfile).personality) && ['shaky', 'steady', 'sharp'].includes((b as BotProfile).skill);

function token(random: () => number, bytes = 16): string {
  let s = '';
  for (let i = 0; i < bytes; i++) s += Math.floor(random() * 256).toString(16).padStart(2, '0');
  return s;
}

const COUNTDOWN_MS = 3500;

export class Room {
  readonly code: string;
  readonly hostToken: string;
  hostConnected = true;
  lastActivity: number;
  mode: RoomMode = 'ffa';
  participants = new Map<string, Participant>();
  pieces: PieceSlot[] = [];
  session: Session | null = null;
  rev = 0;
  /** Revision at which the acting piece or phase last changed: older actions are stale. */
  phaseRev = 0;
  run: Run | null = null;
  paused = false;
  notice: string | null = null;
  private botMem = new Map<number, BotMemory>();
  private botTimer: unknown = null;
  private runTimer: unknown = null;
  private deps: RoomDeps;
  mansion: string;

  constructor(code: string, deps: RoomDeps, mansion = 'Blackthorn Manor') {
    this.code = code;
    this.deps = deps;
    this.hostToken = token(deps.random);
    this.lastActivity = deps.now();
    this.mansion = mansion;
  }

  // ── who is who ────────────────────────────────────────────────────────

  pieceOf(pid: string): number | null {
    const i = this.pieces.findIndex((p) => p.members.includes(pid));
    return i < 0 ? null : i;
  }

  private pieceName(i: number): string {
    const p = this.pieces[i];
    if (p.kind === 'bot') return p.botName ?? 'Bot';
    const names = [...new Set(p.members)].map((m) => this.participants.get(m)?.name ?? '?');
    return names.join(' & ');
  }

  /** The participant who controls a piece right now (null for bots or TV keyboard). */
  controllerOf(piece: number): string | null {
    const p = this.pieces[piece];
    if (!p || p.kind === 'bot' || p.localControl) return null;
    const g = this.session?.game;
    const slot = g ? activeController(g, piece) : 0;
    return p.members[Math.min(slot, p.members.length - 1)] ?? null;
  }

  private isConnected(pid: string | null) {
    return !!pid && !!this.participants.get(pid)?.connected;
  }

  // ── views ─────────────────────────────────────────────────────────────

  private member(pid: string): PublicMember {
    const p = this.participants.get(pid);
    return { participantId: pid, name: p?.name ?? '?', connected: !!p?.connected };
  }

  private publicPieces(): PublicPiece[] {
    return this.pieces.map((s, piece) => ({
      piece,
      name: this.pieceName(piece),
      character: s.character,
      kind: s.kind,
      members: s.members.map((m) => this.member(m)),
      bot: s.bot,
      localControl: s.localControl,
    }));
  }

  private runView(): ChallengeRunView | null {
    if (!this.run) return null;
    return {
      id: this.run.id,
      attempt: this.run.attempt,
      ready: [...this.run.ready],
      submitted: [...this.run.inputs.keys()],
      startAt: this.run.startAt,
      paused: this.run.paused ?? (this.paused ? 'The host paused the game' : null),
      note: this.run.note,
    };
  }

  private youView(p: Participant): YouView {
    const piece = this.pieceOf(p.id);
    const slots = piece === null ? [] : this.pieces[piece].members.flatMap((m, k) => (m === p.id ? [k] : []));
    return {
      participantId: p.id,
      name: p.name,
      piece,
      slots,
      inControl: piece !== null && this.controllerOf(piece) === p.id,
      selector: piece !== null && this.pieces[piece].members[0] === p.id,
    };
  }

  viewFor(to: 'host' | Participant): RoomView {
    const g = this.session?.game ?? null;
    const spectators = [...this.participants.values()].filter((p) => this.pieceOf(p.id) === null).map((p) => this.member(p.id));
    const base = {
      code: this.code,
      mode: this.mode,
      phase: g ? ('game' as const) : ('lobby' as const),
      pieces: this.publicPieces(),
      spectators,
      hostConnected: this.hostConnected,
      rev: this.rev,
      run: this.runView(),
      notice: this.notice,
      paused: this.paused,
    };
    if (to === 'host') return { ...base, game: g ? publicView(g) : null, ownNomination: null, you: null };
    const you = this.youView(to);
    if (g && you.piece !== null) {
      const v = seatView(g, you.piece);
      return { ...base, game: v.state, ownNomination: v.ownNomination, you };
    }
    return { ...base, game: g ? publicView(g) : null, ownNomination: null, you };
  }

  broadcast(events: LogEntry[] = []) {
    this.rev += 1;
    if (this.hostConnected) this.deps.send('host', { t: 'view', view: this.viewFor('host'), events });
    for (const p of this.participants.values()) if (p.connected) this.deps.send(p.id, { t: 'view', view: this.viewFor(p), events });
  }

  // ── connections ───────────────────────────────────────────────────────

  hostConnect() {
    this.hostConnected = true;
    this.broadcast();
    this.pump();
  }

  hostDisconnect() {
    // The room pauses; nothing advances until the host is back.
    this.hostConnected = false;
    if (this.botTimer) this.deps.clearTimer(this.botTimer);
    this.botTimer = null;
    this.broadcast();
  }

  join(name: string, tokenIn?: string): Participant {
    if (tokenIn) {
      const existing = [...this.participants.values()].find((p) => p.token === tokenIn);
      if (existing) {
        existing.connected = true;
        this.onReconnect();
        return existing;
      }
    }
    const p: Participant = { id: token(this.deps.random, 8), token: token(this.deps.random), name: cleanText(name, TEXT_LIMITS.playerName, 'Player'), connected: true, recentIds: [] };
    this.participants.set(p.id, p);
    return p;
  }

  disconnect(participantId: string) {
    const p = this.participants.get(participantId);
    if (!p) return;
    p.connected = false;
    const run = this.run;
    const missing = this.missingControllers();
    if (run && missing.length && missing.some((piece) => !run.inputs.has(piece))) {
      // Freeze the challenge; it restarts with the same schedule when they return.
      const names = missing.map((i) => this.participants.get(this.controllerOf(i)!)?.name ?? '?').join(' and ');
      this.restartRun(`${names} lost connection — the challenge restarts (same rope) when they rejoin, or the host can hand the piece over.`);
      run.paused = `Waiting for ${names} to reconnect`;
    }
    this.broadcast();
  }

  /** Challenge pieces whose current controller is a disconnected phone. */
  private missingControllers(): number[] {
    return this.challengePieces().filter((i) => {
      const s = this.pieces[i];
      return s.kind === 'phone' && !s.localControl && !this.isConnected(this.controllerOf(i));
    });
  }

  private onReconnect() {
    const run = this.run;
    if (run && run.paused && !this.missingControllers().length && !this.paused) run.paused = null;
  }

  // ── messages ──────────────────────────────────────────────────────────

  /** Handle one message from the host ('host') or a participant id. */
  handle(from: string, msg: ClientMsg) {
    this.lastActivity = this.deps.now();
    const reply = (m: ServerMsg) => this.deps.send(from, m);
    const isHost = from === 'host';
    const me = isHost ? null : this.participants.get(from);
    if (!isHost && !me) return reply({ t: 'error', reason: 'Unknown participant' });
    const inLobby = !this.session;
    const myPiece = me ? this.pieceOf(me.id) : null;

    switch (msg.t) {
      case 'setMode': {
        if (!isHost || !inLobby) return reply({ t: 'rejected', reason: 'Only the host chooses the mode, before the start.' });
        if (msg.mode !== 'ffa' && msg.mode !== 'teams') return reply({ t: 'rejected', reason: 'Unknown mode.' });
        if (msg.mode === 'ffa' && this.pieces.some((p) => p.members.length > 1)) return reply({ t: 'rejected', reason: 'Split the pairs first: Free-for-all has one person per piece.' });
        this.mode = msg.mode;
        return this.broadcast();
      }
      case 'claimPiece': {
        if (!me || !inLobby) return reply({ t: 'rejected', reason: 'Pieces are fixed once the game starts.' });
        if (!CHARACTERS.some((c) => c.id === msg.character)) return reply({ t: 'rejected', reason: 'Unknown character.' });
        const takenBy = this.pieces.findIndex((p) => p.character === msg.character);
        if (takenBy >= 0 && takenBy !== myPiece) return reply({ t: 'rejected', reason: 'Another piece already uses that character. In Team Battle, join that team instead.' });
        me.name = cleanText(msg.name, TEXT_LIMITS.playerName, me.name);
        if (myPiece !== null && this.pieces[myPiece].members.length === 1) {
          this.pieces[myPiece].character = msg.character;
          return this.broadcast();
        }
        if (this.pieces.length >= MAX_PIECES) return reply({ t: 'rejected', reason: `The board holds ${MAX_PIECES} pieces. Join a team, or wait for a free piece.` });
        if (myPiece !== null) this.leave(me.id);
        this.pieces.push({ character: msg.character, kind: 'phone', members: [me.id] });
        return this.broadcast();
      }
      case 'joinTeam': {
        if (!me || !inLobby) return reply({ t: 'rejected', reason: 'Teams are fixed once the game starts.' });
        if (this.mode !== 'teams') return reply({ t: 'rejected', reason: 'Pairs share a piece only in Team Battle.' });
        const target = this.pieces[msg.piece];
        if (!target || target.kind !== 'phone') return reply({ t: 'rejected', reason: 'No such team.' });
        if (target.members.includes(me.id)) return;
        if (target.members.length >= MAX_CONTROLLERS_PER_PIECE) return reply({ t: 'rejected', reason: 'That team already has two people.' });
        if (this.seatedPhones() >= MAX_PHONES) return reply({ t: 'rejected', reason: 'Eight phones is the most the board can take.' });
        me.name = cleanText(msg.name, TEXT_LIMITS.playerName, me.name);
        if (myPiece !== null) this.leave(me.id);
        const idx = this.pieces.indexOf(target);
        this.pieces[idx].members.push(me.id);
        return this.broadcast();
      }
      case 'setCharacter': {
        if (!me || !inLobby || myPiece === null) return reply({ t: 'rejected', reason: 'Choose a piece first.' });
        if (!CHARACTERS.some((c) => c.id === msg.character)) return reply({ t: 'rejected', reason: 'Unknown character.' });
        const takenBy = this.pieces.findIndex((p) => p.character === msg.character);
        if (takenBy >= 0 && takenBy !== myPiece) return reply({ t: 'rejected', reason: 'Another piece already uses that character.' });
        this.pieces[myPiece].character = msg.character;
        return this.broadcast();
      }
      case 'leaveSeat': {
        if (!me || !inLobby || myPiece === null) return;
        this.leave(me.id);
        return this.broadcast();
      }
      case 'addBot': {
        if (!isHost || !inLobby) return reply({ t: 'rejected', reason: 'Only the host can add bots before the start.' });
        if (this.pieces.length >= MAX_PIECES) return reply({ t: 'rejected', reason: `The board holds ${MAX_PIECES} pieces.` });
        if (!CHARACTERS.some((c) => c.id === msg.character) || this.pieces.some((s) => s.character === msg.character)) return reply({ t: 'rejected', reason: 'That character is taken.' });
        if (!BOT_PROFILE_OK(msg.bot)) return reply({ t: 'rejected', reason: 'Bad bot profile.' });
        this.pieces.push({ character: msg.character, kind: 'bot', members: [], bot: msg.bot, botName: `${CHARACTERS.find((c) => c.id === msg.character)!.name} Bot` });
        return this.broadcast();
      }
      case 'removePiece': {
        if (!isHost || !inLobby || !this.pieces[msg.piece]) return reply({ t: 'rejected', reason: 'Cannot remove that piece.' });
        this.pieces.splice(msg.piece, 1);
        return this.broadcast();
      }
      case 'start': {
        if (!isHost || !inLobby) return reply({ t: 'rejected', reason: 'Only the host can start.' });
        if (this.pieces.length < MIN_PIECES) return reply({ t: 'rejected', reason: `Need at least ${MIN_PIECES} pieces.` });
        this.startGame();
        return;
      }
      case 'restart': {
        if (!isHost || inLobby) return reply({ t: 'rejected', reason: 'Only the host can restart.' });
        this.notice = 'The host restarted the game.';
        this.startGame();
        return;
      }
      case 'pause': {
        if (!isHost || inLobby) return reply({ t: 'rejected', reason: 'Only the host can pause.' });
        this.paused = !!msg.on;
        if (this.run) {
          if (this.paused && this.run.startAt !== null && this.run.inputs.size < this.challengePieces().length) this.restartRun('The host paused the challenge. It restarts from the countdown (same rope).');
          if (!this.paused) this.onReconnect();
        }
        this.notice = this.paused ? 'Paused by the host.' : null;
        this.broadcast();
        this.pump();
        return;
      }
      case 'replaceWithBot': {
        if (!isHost || !this.pieces[msg.piece]) return reply({ t: 'rejected', reason: 'Only the host can replace a piece.' });
        if (this.run && this.run.startAt !== null) return reply({ t: 'rejected', reason: 'Wait until this challenge ends or is paused.' });
        const s = this.pieces[msg.piece];
        this.pieces[msg.piece] = { character: s.character, kind: 'bot', members: [], bot: { personality: 'cautious', skill: 'steady' }, botName: `${this.pieceName(msg.piece)} (bot)` };
        this.notice = `${this.pieces[msg.piece].botName} now plays that piece.`;
        this.fillBotRun();
        this.onReconnect();
        this.broadcast();
        this.maybeResolveRun();
        this.pump();
        return;
      }
      case 'handover': {
        // Give a controller slot to another phone at a safe moment (no challenge in play).
        if (!isHost) return reply({ t: 'rejected', reason: 'Only the host can hand a piece over.' });
        const s = this.pieces[msg.piece];
        if (!s || s.kind !== 'phone' || !Number.isInteger(msg.slot) || msg.slot < 0 || msg.slot >= s.members.length) return reply({ t: 'rejected', reason: 'No such controller.' });
        if (this.run && this.run.startAt !== null) return reply({ t: 'rejected', reason: 'Wait until this challenge ends or is paused.' });
        const to = this.participants.get(msg.to);
        if (!to) return reply({ t: 'rejected', reason: 'That phone is not in the room.' });
        const toPiece = this.pieceOf(to.id);
        if (toPiece !== null && toPiece !== msg.piece) return reply({ t: 'rejected', reason: 'That phone already plays another piece.' });
        const old = s.members[msg.slot];
        s.members[msg.slot] = to.id;
        const oldName = this.participants.get(old)?.name ?? 'the old phone';
        if (this.session) {
          // Names only: who controls a piece is the room's business, not the rules'.
          const rename = (g: typeof this.session.game) => ({
            ...g,
            pieces: g.pieces.map((p, i) => (i === msg.piece ? { ...p, controllers: p.controllers.map((c, k) => (k === msg.slot ? to.name : c)), name: this.pieceName(i) } : p)),
          });
          this.session = { ...this.session, game: rename(this.session.game), turnStart: rename(this.session.turnStart) };
        }
        this.notice = `${to.name} now controls ${CHARACTERS.find((c) => c.id === s.character)!.name}${s.members.length > 1 ? (msg.slot === 0 ? ' in odd rounds' : ' in even rounds') : ''} (was ${oldName}).`;
        if (this.run) {
          this.run.ready.delete(msg.piece);
          this.run.paused = null;
          this.onReconnect();
        }
        this.broadcast();
        return;
      }
      case 'localControl': {
        if (!isHost || !this.pieces[msg.piece] || this.pieces[msg.piece].kind !== 'phone') return reply({ t: 'rejected', reason: 'Cannot change that piece.' });
        this.pieces[msg.piece].localControl = !!msg.on;
        if (this.run) {
          this.run.ready.delete(msg.piece);
          this.run.startAt = null;
          this.run.paused = null;
          this.onReconnect();
        }
        return this.broadcast();
      }
      case 'action': {
        if (!me || !this.session) return reply({ t: 'rejected', id: msg.id, reason: 'No game.' });
        if (!this.hostConnected || this.paused) return reply({ t: 'rejected', id: msg.id, reason: 'The game is paused.' });
        if (typeof msg.id !== 'string' || msg.id.length > 40) return reply({ t: 'rejected', reason: 'Bad action id.' });
        if (me.recentIds.includes(msg.id)) return; // duplicate: already handled
        me.recentIds.push(msg.id);
        if (me.recentIds.length > 64) me.recentIds.shift();
        const a = msg.action as Action;
        if (!a || typeof a !== 'object' || typeof a.type !== 'string') return reply({ t: 'rejected', id: msg.id, reason: 'Bad action.' });
        if (a.type === 'challengeResult' || a.type === 'rollForLife') return reply({ t: 'rejected', id: msg.id, reason: 'That is decided by the room.' });
        const g = this.session.game;
        if (myPiece === null) return reply({ t: 'rejected', id: msg.id, reason: 'You are watching, not playing a piece.' });
        if (a.type === 'nominate') {
          if (a.piece !== myPiece) return reply({ t: 'rejected', id: msg.id, reason: 'You can only choose for your own piece.' });
          if (this.pieces[myPiece].members[0] !== me.id) return reply({ t: 'rejected', id: msg.id, reason: 'Your teammate confirms your team’s trap.' });
        } else {
          if (actingPiece(g) !== myPiece) return reply({ t: 'rejected', id: msg.id, reason: 'Not your turn.' });
          if (this.controllerOf(myPiece) !== me.id) return reply({ t: 'rejected', id: msg.id, reason: 'Your teammate controls your piece this round.' });
          if (a.type !== 'select' && (typeof msg.rev !== 'number' || msg.rev < this.phaseRev)) return reply({ t: 'rejected', id: msg.id, reason: 'stale' });
        }
        this.apply(a, msg.id, from);
        return;
      }
      case 'ready': {
        const run = this.run;
        if (!run || msg.challengeId !== run.id || msg.attempt !== run.attempt) return reply({ t: 'rejected', reason: 'stale challenge' });
        const pieces = isHost ? this.challengePieces().filter((i) => this.pieces[i].localControl) : this.challengePieces().filter((i) => this.controllerOf(i) === from);
        if (!pieces.length) return reply({ t: 'rejected', reason: 'You are not jumping in this challenge.' });
        for (const i of pieces) run.ready.add(i);
        this.maybeStartRun();
        return this.broadcast();
      }
      case 'challengeInput': {
        const run = this.run;
        if (!run || msg.challengeId !== run.id || msg.attempt !== run.attempt || run.startAt === null) return reply({ t: 'rejected', reason: 'stale challenge' });
        const piece = isHost ? msg.piece : this.challengePieces().find((i) => this.controllerOf(i) === from);
        if (piece === undefined || piece === null || !this.challengePieces().includes(piece)) return reply({ t: 'rejected', reason: 'Not your challenge.' });
        if (isHost && !this.pieces[piece].localControl) return reply({ t: 'rejected', reason: 'That piece plays on its phone.' });
        if (run.inputs.has(piece)) return; // duplicate submission
        const inputs = sanitizeInputs(msg.inputs);
        if (!inputs) return reply({ t: 'rejected', reason: 'Malformed inputs.' });
        const ch = this.session!.game.challenge!;
        const dur = challengeDurationMs(ch.seed);
        const now = this.deps.now();
        // Plausibility: results cannot arrive before the game could have been played.
        const minArrival = run.startAt + Math.min(1500, dur * 0.2);
        if (now < minArrival) return reply({ t: 'rejected', reason: 'Too early.' });
        if (inputs.some((i) => i.t > dur + 1000)) return reply({ t: 'rejected', reason: 'Inputs outside the challenge.' });
        run.inputs.set(piece, inputs);
        this.broadcast();
        this.maybeResolveRun();
        return;
      }
      case 'syncPoor': {
        if (!me || myPiece === null) return;
        const run = this.run;
        if (run) run.note = `${me.name}’s connection is slow (${Math.round(msg.rttMs)} ms). The host can let the TV keyboard jump for them.`;
        return this.broadcast();
      }
      default:
        return reply({ t: 'error', reason: 'Unknown message' });
    }
  }

  private seatedPhones(): number {
    return new Set(this.pieces.flatMap((p) => p.members)).size;
  }

  private leave(pid: string) {
    const i = this.pieceOf(pid);
    if (i === null) return;
    const p = this.pieces[i];
    p.members = p.members.filter((m) => m !== pid);
    if (p.kind === 'phone' && p.members.length === 0) this.pieces.splice(i, 1);
  }

  private startGame() {
    const seed = Math.floor(this.deps.random() * 0xffffffff) >>> 0;
    const game = createGame({
      pieces: this.pieces.map((s, i) => ({
        character: s.character,
        bot: s.kind === 'bot',
        controllers: s.kind === 'bot' ? [s.botName ?? 'Bot'] : s.members.map((m) => this.participants.get(m)?.name ?? 'Player'),
        name: this.pieceName(i),
      })),
      seed,
    });
    this.session = newSession(game);
    this.run = null;
    this.paused = false;
    this.botMem.clear();
    this.broadcast();
    this.pump();
  }

  private apply(action: Action, id: string | undefined, from: string | undefined) {
    if (!this.session) return;
    const r = dispatch(this.session, action);
    if (r.error) {
      if (from) this.deps.send(from, { t: 'rejected', id, reason: r.error });
      return;
    }
    const before = this.session.game;
    this.session = r.session;
    const g = r.session.game;
    const phaseChanged = before.phase !== g.phase || before.actionNumber !== g.actionNumber;
    if (action.type !== 'select') this.notice = null;
    this.syncRun();
    this.broadcast(r.events);
    if (phaseChanged) this.phaseRev = this.rev;
    this.pump();
  }

  // ── challenges ────────────────────────────────────────────────────────

  private challengePieces(): number[] {
    return this.session?.game.challenge?.participants ?? [];
  }

  private syncRun() {
    const ch = this.session?.game.challenge;
    if (!ch) {
      this.run = null;
      return;
    }
    if (this.run?.id === ch.id) return;
    this.run = { id: ch.id, attempt: 0, ready: new Set(), inputs: new Map(), startAt: null, paused: null, note: null };
    this.fillBotRun();
  }

  private fillBotRun() {
    const ch = this.session?.game.challenge;
    const run = this.run;
    if (!ch || !run) return;
    for (const p of ch.participants) {
      const s = this.pieces[p];
      if (s.kind === 'bot' && !run.inputs.has(p)) {
        run.ready.add(p);
        run.inputs.set(p, botRopeInputs(ch.seed, p, reflexOf(s.bot!)));
      }
    }
    this.maybeStartRun();
  }

  private restartRun(note: string) {
    const run = this.run;
    if (!run) return;
    run.attempt += 1;
    run.startAt = null;
    run.note = note;
    // Discard human inputs so everyone replays the same rope together.
    for (const p of [...run.inputs.keys()]) if (this.pieces[p].kind !== 'bot') run.inputs.delete(p);
    for (const p of [...run.ready]) if (this.pieces[p].kind !== 'bot') run.ready.delete(p);
  }

  private maybeStartRun() {
    const run = this.run;
    if (!run || run.startAt !== null || run.paused || this.paused) return;
    const pieces = this.challengePieces();
    if (!pieces.every((s) => run.ready.has(s))) return;
    // Everyone ready: start together a little in the future (countdown).
    run.startAt = this.deps.now() + COUNTDOWN_MS;
    const ch = this.session!.game.challenge!;
    const dur = challengeDurationMs(ch.seed);
    if (this.runTimer) this.deps.clearTimer(this.runTimer);
    if (pieces.every((s) => this.pieces[s].kind === 'bot')) {
      this.runTimer = this.deps.setTimer(() => this.maybeResolveRun(true), COUNTDOWN_MS + dur);
    } else {
      // Never hang: if a result is missing well after the end, restart and tell the host.
      const id = run.id;
      const attempt = run.attempt;
      this.runTimer = this.deps.setTimer(() => {
        const r = this.run;
        if (!r || r.id !== id || r.attempt !== attempt) return;
        const missing = this.challengePieces().filter((s) => !r.inputs.has(s));
        if (!missing.length) return;
        this.restartRun(`No result arrived for ${missing.map((s) => this.pieceName(s)).join(' and ')}. The challenge restarts with the same rope; the host can also hand the piece over.`);
        this.broadcast();
      }, COUNTDOWN_MS + dur + 20000);
    }
  }

  private maybeResolveRun(force = false) {
    const run = this.run;
    const ch = this.session?.game.challenge;
    if (!run || !ch || run.paused || this.paused) return;
    if (!ch.participants.every((p) => run.inputs.has(p))) return;
    if (!force && ch.participants.every((p) => this.pieces[p].kind === 'bot') && run.startAt !== null && this.deps.now() < run.startAt) return;
    const inputs: Record<number, ChallengeInput[]> = {};
    for (const p of ch.participants) inputs[p] = run.inputs.get(p)!;
    // All results are applied at once: no advantage from whose message arrived first.
    this.apply({ type: 'challengeResult', id: ch.id, inputs }, undefined, undefined);
  }

  // ── bots and automatic steps ──────────────────────────────────────────

  private memory(piece: number): BotMemory {
    let m = this.botMem.get(piece);
    if (!m) {
      m = newBotMemory(Math.floor(this.deps.random() * 0xffffffff));
      this.botMem.set(piece, m);
    }
    return m;
  }

  private autoDecision(): Action | null {
    const g = this.session?.game;
    if (!g || g.phase === 'gameOver' || g.phase === 'challenge') return null;
    if (g.phase === 'lifeRoll') return { type: 'rollForLife' };
    if (g.phase === 'placement') {
      for (let i = 0; i < g.pieces.length; i++) {
        if (this.pieces[i].kind !== 'bot' || g.nominations[i] !== null) continue;
        const a = botAction(seatView(g, i), this.pieces[i].bot!, this.memory(i));
        if (a) return a;
      }
      return null;
    }
    const i = actingPiece(g);
    if (this.pieces[i]?.kind !== 'bot') return null;
    return botAction(seatView(g, i), this.pieces[i].bot!, this.memory(i));
  }

  /** Let bots (and the life roll) happen on their own, never while paused or the host is away. */
  pump() {
    if (!this.session || !this.hostConnected || this.paused || this.botTimer) return;
    const first = this.autoDecision();
    if (!first) return;
    const delay = first.type === 'rollForLife' ? Math.max(1500, this.deps.botDelayMs ?? 700) : (this.deps.botDelayMs ?? 700);
    this.botTimer = this.deps.setTimer(() => {
      this.botTimer = null;
      if (!this.hostConnected || this.paused) return;
      // Decide on the state as it is now, not as it was when scheduled.
      const a = this.autoDecision();
      if (a) this.apply(a, undefined, undefined);
    }, delay);
  }

  dispose() {
    if (this.botTimer) this.deps.clearTimer(this.botTimer);
    if (this.runTimer) this.deps.clearTimer(this.runTimer);
  }
}
