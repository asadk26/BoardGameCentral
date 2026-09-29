// One phone room: the single authority for its game. Transport-agnostic —
// the WebSocket server (server/main.ts) and the tests drive it through
// `handle()` and read what it sends through the injected `send`.
//
// Trust model (a casual party game, not esports anti-cheat): phones send
// intentions and timestamped button presses measured against the animation
// they showed. The room validates shape, ownership, revision, timing bounds
// and plausibility, and judges presses with the same pure judges the local
// game uses. A modified phone could still fake good timing for itself.

import { CHARACTERS, MAX_PLAYERS, MIN_PLAYERS, TEXT_LIMITS, type CharacterId } from '../engine/config';
import { createGame, dispatch, newSession, type Session } from '../engine/engine';
import { botAction, newBotMemory, reflexOf, type BotMemory, type BotProfile } from '../engine/bots';
import { botChallengeInputs, challengeDurationMs, sanitizeInputs, type ChallengeInput } from '../engine/challenges';
import { publicView, seatView } from '../engine/view';
import { cleanText } from '../engine/save';
import type { Action, LogEntry } from '../engine/types';
import type { ChallengeRunView, ClientMsg, PublicSeat, RoomView, ServerMsg } from './protocol';

export interface Participant {
  id: string;
  token: string;
  name: string;
  seat: number | null;
  connected: boolean;
  recentIds: string[];
}

interface SeatSlot {
  name: string;
  character: CharacterId;
  kind: 'phone' | 'bot';
  participantId?: string;
  bot?: BotProfile;
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
  /** Bot pacing, ms; tests use 0. */
  botDelayMs?: number;
}

const BOT_PROFILE_OK = (b: unknown): b is BotProfile =>
  !!b && typeof b === 'object' && ['cautious', 'greedy', 'mischievous'].includes((b as BotProfile).personality) && ['shaky', 'steady', 'sharp'].includes((b as BotProfile).skill);

function token(random: () => number, bytes = 16): string {
  let s = '';
  for (let i = 0; i < bytes; i++) s += Math.floor(random() * 256).toString(16).padStart(2, '0');
  return s;
}

export class Room {
  readonly code: string;
  readonly hostToken: string;
  hostConnected = true;
  lastActivity: number;
  participants = new Map<string, Participant>();
  seats: SeatSlot[] = [];
  session: Session | null = null;
  rev = 0;
  /** Revision at which the turn or phase last changed: older actions are stale. */
  phaseRev = 0;
  run: Run | null = null;
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

  // ── views ─────────────────────────────────────────────────────────────

  private publicSeats(): PublicSeat[] {
    return this.seats.map((s, seat) => ({
      seat,
      name: s.name,
      character: s.character,
      kind: s.kind,
      connected: s.kind === 'bot' || !!(s.participantId && this.participants.get(s.participantId)?.connected),
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
      paused: this.run.paused,
      note: this.run.note,
    };
  }

  viewFor(to: 'host' | Participant): RoomView {
    const g = this.session?.game ?? null;
    const base = { code: this.code, phase: g ? ('game' as const) : ('lobby' as const), seats: this.publicSeats(), hostConnected: this.hostConnected, rev: this.rev, run: this.runView() };
    if (to === 'host') return { ...base, game: g ? publicView(g) : null, ownNomination: null, you: null };
    const seat = to.seat;
    if (g && seat !== null) {
      const v = seatView(g, seat);
      return { ...base, game: v.state, ownNomination: v.ownNomination, you: { participantId: to.id, seat } };
    }
    return { ...base, game: g ? publicView(g) : null, ownNomination: null, you: { participantId: to.id, seat } };
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
        this.onReconnect(existing);
        return existing;
      }
    }
    const p: Participant = { id: token(this.deps.random, 8), token: token(this.deps.random), name: cleanText(name, TEXT_LIMITS.playerName, 'Player'), seat: null, connected: true, recentIds: [] };
    this.participants.set(p.id, p);
    return p;
  }

  disconnect(participantId: string) {
    const p = this.participants.get(participantId);
    if (!p) return;
    p.connected = false;
    const run = this.run;
    if (run && p.seat !== null && this.challengeSeats().includes(p.seat) && !run.inputs.has(p.seat)) {
      // Freeze the challenge; it restarts with the same schedule on return.
      this.restartRun(`${this.seats[p.seat].name} lost connection — the challenge will restart (same schedule) when they rejoin, or the host can hand the seat to a bot.`);
      run.paused = `Waiting for ${this.seats[p.seat].name} to reconnect`;
    }
    this.broadcast();
  }

  private onReconnect(p: Participant) {
    const run = this.run;
    if (run && run.paused && p.seat !== null && this.challengeSeats().includes(p.seat)) {
      const stillMissing = this.challengeSeats().some((s) => this.seats[s].kind === 'phone' && !this.seats[s].localControl && !this.isConnected(s));
      if (!stillMissing) run.paused = null;
    }
  }

  private isConnected(seat: number) {
    const s = this.seats[seat];
    return s.kind === 'bot' || !!(s.participantId && this.participants.get(s.participantId)?.connected);
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

    switch (msg.t) {
      case 'claimSeat': {
        if (!me || !inLobby) return reply({ t: 'rejected', reason: 'Seats are fixed once the game starts.' });
        if (!CHARACTERS.some((c) => c.id === msg.character)) return reply({ t: 'rejected', reason: 'Unknown character.' });
        const taken = this.seats.findIndex((s) => s.character === msg.character);
        if (taken >= 0 && this.seats[taken].participantId !== me.id) return reply({ t: 'rejected', reason: 'That character is taken.' });
        const name = cleanText(msg.name, TEXT_LIMITS.playerName, me.name);
        me.name = name;
        if (me.seat !== null) {
          this.seats[me.seat] = { ...this.seats[me.seat], character: msg.character, name };
        } else {
          if (this.seats.length >= MAX_PLAYERS) return reply({ t: 'rejected', reason: 'The room is full.' });
          this.seats.push({ name, character: msg.character, kind: 'phone', participantId: me.id });
          me.seat = this.seats.length - 1;
        }
        return this.broadcast();
      }
      case 'leaveSeat': {
        if (!me || !inLobby || me.seat === null) return;
        this.removeSeat(me.seat);
        return this.broadcast();
      }
      case 'addBot': {
        if (!isHost || !inLobby) return reply({ t: 'rejected', reason: 'Only the host can add bots before the start.' });
        if (this.seats.length >= MAX_PLAYERS) return reply({ t: 'rejected', reason: 'The room is full.' });
        if (!CHARACTERS.some((c) => c.id === msg.character) || this.seats.some((s) => s.character === msg.character)) return reply({ t: 'rejected', reason: 'That character is taken.' });
        if (!BOT_PROFILE_OK(msg.bot)) return reply({ t: 'rejected', reason: 'Bad bot profile.' });
        this.seats.push({ name: `${CHARACTERS.find((c) => c.id === msg.character)!.name} Bot`, character: msg.character, kind: 'bot', bot: msg.bot });
        return this.broadcast();
      }
      case 'removeSeat': {
        if (!isHost || !inLobby || !Number.isInteger(msg.seat) || !this.seats[msg.seat]) return reply({ t: 'rejected', reason: 'Cannot remove that seat.' });
        this.removeSeat(msg.seat);
        return this.broadcast();
      }
      case 'start': {
        if (!isHost || !inLobby) return reply({ t: 'rejected', reason: 'Only the host can start.' });
        if (this.seats.length < MIN_PLAYERS) return reply({ t: 'rejected', reason: `Need at least ${MIN_PLAYERS} seats.` });
        this.startGame();
        return;
      }
      case 'restart': {
        if (!isHost || inLobby) return reply({ t: 'rejected', reason: 'Only the host can restart.' });
        this.startGame();
        return;
      }
      case 'replaceWithBot': {
        if (!isHost || !this.seats[msg.seat]) return reply({ t: 'rejected', reason: 'Only the host can replace a seat.' });
        const s = this.seats[msg.seat];
        if (s.participantId) {
          const p = this.participants.get(s.participantId);
          if (p) p.seat = null;
        }
        this.seats[msg.seat] = { name: s.name, character: s.character, kind: 'bot', bot: { personality: 'cautious', skill: 'steady' } };
        this.fillBotRun();
        if (this.run) this.run.paused = null;
        this.broadcast();
        this.maybeResolveRun();
        this.pump();
        return;
      }
      case 'localControl': {
        if (!isHost || !this.seats[msg.seat] || this.seats[msg.seat].kind !== 'phone') return reply({ t: 'rejected', reason: 'Cannot change that seat.' });
        this.seats[msg.seat].localControl = !!msg.on;
        if (this.run) {
          this.run.ready.delete(msg.seat);
          this.run.startAt = null;
          this.run.paused = null;
        }
        return this.broadcast();
      }
      case 'action': {
        if (!me || !this.session) return reply({ t: 'rejected', id: msg.id, reason: 'No game.' });
        if (!this.hostConnected) return reply({ t: 'rejected', id: msg.id, reason: 'The host is disconnected; the room is paused.' });
        if (typeof msg.id !== 'string' || msg.id.length > 40) return reply({ t: 'rejected', reason: 'Bad action id.' });
        if (me.recentIds.includes(msg.id)) return; // duplicate: already handled
        me.recentIds.push(msg.id);
        if (me.recentIds.length > 64) me.recentIds.shift();
        const a = msg.action as Action;
        if (!a || typeof a !== 'object' || typeof a.type !== 'string') return reply({ t: 'rejected', id: msg.id, reason: 'Bad action.' });
        if (a.type === 'challengeResult') return reply({ t: 'rejected', id: msg.id, reason: 'Challenge results come from judged inputs.' });
        const g = this.session.game;
        if (me.seat === null) return reply({ t: 'rejected', id: msg.id, reason: 'You have no seat.' });
        if (a.type === 'nominate') {
          if (a.seat !== me.seat) return reply({ t: 'rejected', id: msg.id, reason: 'You can only curse for yourself.' });
        } else {
          if (g.turn !== me.seat) return reply({ t: 'rejected', id: msg.id, reason: 'Not your turn.' });
          if (a.type !== 'select' && (typeof msg.rev !== 'number' || msg.rev < this.phaseRev)) return reply({ t: 'rejected', id: msg.id, reason: 'stale' });
        }
        this.apply(a, msg.id, from);
        return;
      }
      case 'ready': {
        const run = this.run;
        if (!run || msg.challengeId !== run.id || msg.attempt !== run.attempt) return reply({ t: 'rejected', reason: 'stale challenge' });
        const seats = isHost ? this.challengeSeats().filter((s) => this.seats[s].localControl) : me?.seat !== null && me?.seat !== undefined ? [me.seat] : [];
        for (const s of seats) if (this.challengeSeats().includes(s)) run.ready.add(s);
        this.maybeStartRun();
        return this.broadcast();
      }
      case 'challengeInput': {
        const run = this.run;
        if (!run || msg.challengeId !== run.id || msg.attempt !== run.attempt || run.startAt === null) return reply({ t: 'rejected', reason: 'stale challenge' });
        const seat = isHost ? msg.seat : me?.seat;
        if (seat === null || seat === undefined || !this.challengeSeats().includes(seat)) return reply({ t: 'rejected', reason: 'Not your challenge.' });
        if (isHost && !this.seats[seat].localControl) return reply({ t: 'rejected', reason: 'That seat plays on its phone.' });
        if (run.inputs.has(seat)) return; // duplicate submission
        const inputs = sanitizeInputs(msg.inputs);
        if (!inputs) return reply({ t: 'rejected', reason: 'Malformed inputs.' });
        const ch = this.session!.game.challenge!;
        const dur = challengeDurationMs(ch.kind, ch.seed, ch.oneSurvivor);
        const now = this.deps.now();
        // Plausibility: results cannot arrive before the game could have been played.
        const minArrival = run.startAt + Math.min(1500, dur * 0.2);
        if (now < minArrival) return reply({ t: 'rejected', reason: 'Too early.' });
        if (inputs.some((i) => i.t > dur + 1000)) return reply({ t: 'rejected', reason: 'Inputs outside the challenge.' });
        run.inputs.set(seat, inputs);
        this.broadcast();
        this.maybeResolveRun();
        return;
      }
      case 'syncPoor': {
        if (!me || me.seat === null) return;
        const run = this.run;
        if (run) run.note = `${this.seats[me.seat].name}’s connection is slow (${Math.round(msg.rttMs)} ms). The host can let them play this challenge on the TV keyboard.`;
        return this.broadcast();
      }
      default:
        return reply({ t: 'error', reason: 'Unknown message' });
    }
  }

  private removeSeat(seat: number) {
    const s = this.seats[seat];
    if (s.participantId) {
      const p = this.participants.get(s.participantId);
      if (p) p.seat = null;
    }
    this.seats.splice(seat, 1);
    for (const p of this.participants.values()) if (p.seat !== null && p.seat > seat) p.seat -= 1;
  }

  private startGame() {
    const seed = Math.floor(this.deps.random() * 0xffffffff) >>> 0;
    const game = createGame({ players: this.seats.map((s) => ({ name: s.name, character: s.character })), seed });
    this.session = newSession(game);
    this.run = null;
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
    const phaseChanged = before.phase !== g.phase || before.turnNumber !== g.turnNumber;
    this.syncRun();
    this.broadcast(r.events);
    if (phaseChanged) this.phaseRev = this.rev;
    this.pump();
  }

  // ── challenges ────────────────────────────────────────────────────────

  private challengeSeats(): number[] {
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
      const s = this.seats[p];
      if (s.kind === 'bot' && !run.inputs.has(p)) {
        run.ready.add(p);
        run.inputs.set(p, botChallengeInputs(ch.kind, ch.seed, p, reflexOf(s.bot!), ch.oneSurvivor));
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
    // Discard human inputs so everyone replays the same schedule together.
    for (const p of [...run.inputs.keys()]) if (this.seats[p].kind !== 'bot') run.inputs.delete(p);
    for (const p of [...run.ready]) if (this.seats[p].kind !== 'bot') run.ready.delete(p);
  }

  private maybeStartRun() {
    const run = this.run;
    if (!run || run.startAt !== null || run.paused) return;
    const seats = this.challengeSeats();
    if (!seats.every((s) => run.ready.has(s))) return;
    // Everyone ready: start together a little in the future (countdown).
    run.startAt = this.deps.now() + 3500;
    const ch = this.session!.game.challenge!;
    const dur = challengeDurationMs(ch.kind, ch.seed, ch.oneSurvivor);
    if (this.runTimer) this.deps.clearTimer(this.runTimer);
    if (seats.every((s) => this.seats[s].kind === 'bot')) {
      this.runTimer = this.deps.setTimer(() => this.maybeResolveRun(true), 3500 + dur);
    } else {
      // Never hang: if a result is missing well after the end, pause and tell the host.
      const id = run.id;
      const attempt = run.attempt;
      this.runTimer = this.deps.setTimer(() => {
        const r = this.run;
        if (!r || r.id !== id || r.attempt !== attempt) return;
        const missing = this.challengeSeats().filter((s) => !r.inputs.has(s));
        if (!missing.length) return;
        this.restartRun(`No result arrived from ${missing.map((s) => this.seats[s].name).join(' and ')}. The challenge restarts with the same schedule; the host can also hand the seat to a bot or the TV keyboard.`);
        this.broadcast();
      }, 3500 + dur + 20000);
    }
  }

  private maybeResolveRun(force = false) {
    const run = this.run;
    const ch = this.session?.game.challenge;
    if (!run || !ch || run.paused) return;
    if (!ch.participants.every((p) => run.inputs.has(p))) return;
    if (!force && ch.participants.every((p) => this.seats[p].kind === 'bot') && run.startAt !== null && this.deps.now() < run.startAt) return;
    const inputs: Record<number, ChallengeInput[]> = {};
    for (const p of ch.participants) inputs[p] = run.inputs.get(p)!;
    // All results are applied at once: no advantage from whose message arrived first.
    this.apply({ type: 'challengeResult', id: ch.id, inputs }, undefined, undefined);
  }

  // ── bots ──────────────────────────────────────────────────────────────

  private memory(seat: number): BotMemory {
    let m = this.botMem.get(seat);
    if (!m) {
      m = newBotMemory(Math.floor(this.deps.random() * 0xffffffff));
      this.botMem.set(seat, m);
    }
    return m;
  }

  private botDecision(): Action | null {
    const g = this.session?.game;
    if (!g || g.phase === 'gameOver' || g.phase === 'challenge') return null;
    if (g.phase === 'placement') {
      for (let seat = 0; seat < g.players.length; seat++) {
        if (this.seats[seat].kind !== 'bot' || g.nominations[seat] !== null) continue;
        const a = botAction(seatView(g, seat), this.seats[seat].bot!, this.memory(seat));
        if (a) return a;
      }
      return null;
    }
    if (this.seats[g.turn]?.kind !== 'bot') return null;
    return botAction(seatView(g, g.turn), this.seats[g.turn].bot!, this.memory(g.turn));
  }

  /** Let bots act when it is their move (never while the host is away). */
  pump() {
    if (!this.session || !this.hostConnected || this.botTimer) return;
    if (!this.botDecision()) return;
    this.botTimer = this.deps.setTimer(() => {
      this.botTimer = null;
      if (!this.hostConnected) return;
      // Decide on the state as it is now, not as it was when scheduled.
      const a = this.botDecision();
      if (a) this.apply(a, undefined, undefined);
    }, this.deps.botDelayMs ?? 700);
  }

  dispose() {
    if (this.botTimer) this.deps.clearTimer(this.botTimer);
    if (this.runTimer) this.deps.clearTimer(this.runTimer);
  }
}
