// The phone controller (…/#/join). No 3D here — the TV shows the mansion.
// The phone only ever receives its seat view: the public state plus its own
// trap nomination.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, EVENT_INFO, SCORING, TEXT_LIMITS, TRAP_ELIGIBLE, cardType, type CharacterId } from '../engine/config';
import { canPlaceDecoy, currentGhostPlan, finalScores, ghostAllowance, isProtected, legalRoutes, previewMove } from '../engine/engine';
import { challengeDurationMs, type ChallengeInput } from '../engine/challenges';
import type { Action, GameState } from '../engine/types';
import type { RoomView, ServerMsg } from '../net/protocol';
import { findService, newActionId, RoomClient, tokenStore } from '../net/client';
import { cardFlavor, CHALLENGE_TITLES, challengeHowTo, encounterWarning, ghostSummary, logLine, nodeName, outcomeLines, placeName, previewSummary } from '../text';
import { defaultPersonalization } from '../engine/save';
import { MiniMap } from '../ui/MiniMap';
import { DanceGame, EscapeGame, RopeGame } from '../ui/Challenges';
import { audio } from '../audio/audio';
import './phone.css';

const pz = defaultPersonalization();
const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;

function params() {
  const q = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q);
}

export function PhoneApp() {
  const [service, setService] = useState<'finding' | 'none' | string>('finding');
  const [code, setCode] = useState((params().get('room') ?? '').toUpperCase());
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('one-more-room/phone-name') ?? '';
    } catch {
      return '';
    }
  });
  const [client, setClient] = useState<RoomClient | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    findService().then((s) => setService(s ? s.wsUrl : 'none'));
  }, []);

  const join = useCallback(() => {
    if (service === 'finding' || service === 'none') return;
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return setError('Room codes are four letters — check the TV.');
    try {
      localStorage.setItem('one-more-room/phone-name', name);
    } catch {
      /* ignore */
    }
    audio.unlock();
    const cl = new RoomClient(service);
    cl.onOpen = () => cl.send({ t: 'join', code: c, name: name || 'Player', token: tokenStore.get(c) ?? undefined });
    cl.onStatus = (st) => setStatus(st === 'open' ? '' : st === 'reconnecting' ? 'Reconnecting…' : st);
    cl.on((m: ServerMsg) => {
      if (m.t === 'joined') {
        tokenStore.set(m.code, m.token);
        setError(null);
      }
      if (m.t === 'view') setView(m.view);
      if (m.t === 'error') setError(m.reason);
      if (m.t === 'rejected' && m.reason !== 'stale' && m.reason !== 'stale challenge') setError(m.reason);
    });
    setClient(cl);
  }, [service, code, name]);

  // Auto-rejoin a room this phone was already in (refresh keeps the seat).
  useEffect(() => {
    if (!client && service !== 'finding' && service !== 'none' && code && tokenStore.get(code.toUpperCase())) join();
  }, [client, service, code, join]);

  if (service === 'finding') return <Shell><p>Looking for the room service…</p></Shell>;
  if (service === 'none')
    return (
      <Shell>
        <h1>Join on phone</h1>
        <p>
          Phone rooms need the One More Room room service, and this copy of the game is not connected to one. You can still
          play on one screen with the mouse, keyboard and bots.
        </p>
        <p className="muted">To use phones at a party, run the room service on the TV’s computer (see the game’s README) and scan the QR code it shows.</p>
      </Shell>
    );

  if (!client || !view)
    return (
      <Shell>
        <h1>Join One More Room</h1>
        <label className="pf">
          Room code
          <input value={code} maxLength={4} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD" inputMode="text" />
        </label>
        <label className="pf">
          Your name
          <input value={name} maxLength={TEXT_LIMITS.playerName} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>
        {error && <p className="perr">{error}</p>}
        <button className="pbtn primary" onClick={join} disabled={!!client}>
          {client ? 'Joining…' : 'Join'}
        </button>
      </Shell>
    );

  return (
    <Shell>
      {status && <p className="pstatus">{status}</p>}
      {!view.hostConnected && <p className="pstatus">The TV is disconnected — the room is paused.</p>}
      {error && (
        <p className="perr" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {view.phase === 'lobby' ? <Lobby view={view} client={client} defaultName={name} /> : <Game view={view} client={client} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="phone">{children}</div>;
}

function Lobby({ view, client, defaultName }: { view: RoomView; client: RoomClient; defaultName: string }) {
  const mySeat = view.you?.seat ?? null;
  const [name, setName] = useState(mySeat !== null ? view.seats[mySeat].name : defaultName);
  const claim = (character: CharacterId) => client.send({ t: 'claimSeat', character, name: name || 'Player' });
  return (
    <div className="pstack">
      <h1>Room {view.code}</h1>
      <label className="pf">
        Your name
        <input value={name} maxLength={TEXT_LIMITS.playerName} onChange={(e) => setName(e.target.value)} />
      </label>
      <p>{mySeat === null ? 'Pick your costume:' : 'Your costume (tap another to switch):'}</p>
      <div className="pchars">
        {CHARACTERS.map((c) => {
          const owner = view.seats.find((s) => s.character === c.id);
          const mine = mySeat !== null && view.seats[mySeat]?.character === c.id;
          return (
            <button key={c.id} className={`pchar ${mine ? 'on' : ''}`} style={{ borderColor: c.color }} disabled={!!owner && !mine} onClick={() => claim(c.id)}>
              <b>{c.name}</b>
              <small>{owner ? (mine ? 'you' : owner.name) : 'free'}</small>
            </button>
          );
        })}
      </div>
      <ul className="pseats">
        {view.seats.map((s) => (
          <li key={s.seat}>
            <span className="pdot" style={{ background: colorOf(s.character) }}>
              {s.seat + 1}
            </span>{' '}
            {s.name} {s.kind === 'bot' ? '🤖' : s.connected ? '' : '(offline)'}
          </li>
        ))}
      </ul>
      <p className="muted">Waiting for the host to start on the TV…</p>
    </div>
  );
}

function Game({ view, client }: { view: RoomView; client: RoomClient }) {
  const g = view.game!;
  const seat = view.you?.seat ?? null;
  const send = useCallback((action: Action) => client.send({ t: 'action', id: newActionId(), rev: view.rev, action }), [client, view.rev]);
  const ackKey = `one-more-room/ack/${view.code}/${seat}/${g.players.length}`;
  const [acked, setAcked] = useState(() => {
    try {
      return localStorage.getItem(ackKey) === '1';
    } catch {
      return false;
    }
  });
  const ack = (v: boolean) => {
    setAcked(v);
    try {
      localStorage.setItem(ackKey, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  if (seat === null) return <p>You are watching. Seats were fixed when the game started.</p>;
  // The private confirmation stays up until hidden — even if the game has moved on.
  const needsAck = view.ownNomination !== null && !acked && g.round === 1 && g.turnNumber <= g.players.length;
  const me = g.players[seat];
  const myTurn = g.turn === seat;
  return (
    <div className="pstack">
      <header className="phead" style={{ borderColor: colorOf(me.character) }}>
        <span className="pdot" style={{ background: colorOf(me.character) }}>
          {seat + 1}
        </span>
        <div>
          <b>{me.name}</b> {me.alive ? '' : '👻'}
          <div className="muted small">
            Round {g.round}/10 •{' '}
            {me.alive
              ? `banked ${me.banked} • carrying ${me.carried}${isProtected(g, seat) ? ' • 🛡 protected' : ''}${me.banked >= SCORING.survivalBonusMinBanked ? ` • +${SCORING.survivalBonus} if alive ✓` : ''}`
              : `ghost • banked ${me.banked} • bounty ${me.bounty}/${SCORING.bountyCap}`}
          </div>
        </div>
      </header>
      {needsAck ? (
        <NominationAck nomination={view.ownNomination!} onHide={() => ack(true)} />
      ) : (
        g.phase === 'placement' && <Placement view={view} send={send} seat={seat} />
      )}
      {!needsAck && g.phase === 'challenge' && <PhoneChallenge view={view} client={client} seat={seat} />}
      {!needsAck && g.phase === 'gameOver' && <PhoneResults g={g} />}
      {!needsAck && !['placement', 'challenge', 'gameOver'].includes(g.phase) && (myTurn ? <MyTurn g={g} send={send} /> : <Watching g={g} />)}
    </div>
  );
}

function Placement({ view, send, seat }: { view: RoomView; send: (a: Action) => void; seat: number }) {
  const g = view.game!;
  const [draft, setDraft] = useState<number | null>(null);
  const eligible = useMemo(() => new Set(TRAP_ELIGIBLE), []);
  if (view.ownNomination !== null) {
    const waiting = g.players.filter((_, i) => g.nominations[i] === null).map((p) => p.name);
    return <p>Waiting for {waiting.join(', ') || 'the house'} to curse a corridor…</p>;
  }
  return (
    <div className="pstack">
      <h2>Curse one corridor — secretly</h2>
      <p className="muted small">Only glowing spaces are allowed. Nobody else will see your pick.</p>
      <MiniMap pickable={eligible} selected={draft} onPick={setDraft} label="Choose a corridor to curse" />
      <button className="pbtn primary" disabled={draft === null} onClick={() => draft !== null && send({ type: 'nominate', seat, node: draft })}>
        {draft === null ? 'Tap a glowing space' : `Curse space ${draft}`}
      </button>
    </div>
  );
}

function NominationAck({ nomination, onHide }: { nomination: number; onHide: () => void }) {
  return (
    <div className="pcard">
      <h2>Your curse is set</h2>
      <p>
        A Reaper waits at <b>space {nomination}</b>. It will not be shown again — remember it. You are not immune.
      </p>
      <button className="pbtn primary" onClick={onHide}>
        Hide it
      </button>
    </div>
  );
}

function Watching({ g }: { g: GameState }) {
  const p = g.players[g.turn];
  const lines = g.log.map((e) => logLine(e, g, pz)).filter(Boolean).slice(-4) as string[];
  return (
    <div className="pstack">
      <p>
        <b>{p.name}</b>’s {p.alive ? 'turn' : 'ghost turn'}…
      </p>
      <ul className="plog">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <MiniMap game={g} revealed={g.traps.map((t) => t.node)} label="Mansion map" />
    </div>
  );
}

function MyTurn({ g, send }: { g: GameState; send: (a: Action) => void }) {
  const me = g.players[g.turn];
  const [decoyAsk, setDecoyAsk] = useState(false);
  const revealed = g.traps.map((t) => t.node);
  if (g.phase === 'turnStart')
    return (
      <div className="pstack">
        {!me.alive && <p className="pnote">Ghost turn: one die; end on an unprotected living player to haunt them ({SCORING.bountyPerKill} bounty each, max {SCORING.bountyCap}).</p>}
        <button className="pbtn primary big" onClick={() => send({ type: 'roll' })}>
          {me.alive ? 'Roll the dice 🎲' : 'Roll the ghost die 🎲'}
        </button>
        {canPlaceDecoy(g) &&
          (decoyAsk ? (
            <div className="pcard">
              <p>This turn the resident ghost heads for a sweet on your space instead of anyone’s candy. It still challenges the first unprotected player on its path. Once per game.</p>
              <button className="pbtn" onClick={() => send({ type: 'placeDecoy' })}>
                Place decoy
              </button>
              <button className="pbtn ghost" onClick={() => setDecoyAsk(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="pbtn" onClick={() => setDecoyAsk(true)}>
              Use decoy…
            </button>
          ))}
      </div>
    );
  if (g.phase === 'choose') return <PhoneChoose g={g} send={send} revealed={revealed} />;
  if (g.phase === 'pick') {
    const pk = g.pick!;
    return (
      <div className="pstack">
        <p>
          <b>{pk.kind === 'summon' ? 'The Super Reaper demands an opponent' : pk.kind === 'duel' ? 'Choose who to duel' : 'Choose who to haunt'}</b>
        </p>
        {pk.options.map((o) => (
          <button key={o} className="pbtn" onClick={() => send({ type: 'pickOpponent', option: o })}>
            {g.players[o].name} • carrying {g.players[o].carried}
          </button>
        ))}
      </div>
    );
  }
  if (g.phase === 'event') {
    const ev = g.event!;
    const info = EVENT_INFO[cardType(ev.cardId)];
    return (
      <div className="pstack">
        <div className="pcard ecard">
          <small>Trick or Treat</small>
          <h2>{info.title}</h2>
          <p className="muted">“{cardFlavor(ev.cardId, pz)}”</p>
          <p>
            <b>{info.effect}</b>
          </p>
        </div>
        {ev.options.map((o) => (
          <button key={o} className="pbtn" onClick={() => send({ type: 'eventChoose', option: o })}>
            {ev.type === 'secretPassage' ? `Go to ${placeName(o, pz)}` : ev.type === 'stickyFingers' ? `Steal from ${g.players[o].name}` : `Swap with ${g.players[o].name}`}
          </button>
        ))}
        {ev.canDecline && (
          <button className="pbtn ghost" onClick={() => send({ type: 'eventDecline' })}>
            No thanks
          </button>
        )}
      </div>
    );
  }
  if (g.phase === 'ghost') {
    const plan = currentGhostPlan(g);
    return (
      <div className="pstack">
        {plan && <p className="pnote">👻 {ghostSummary(plan, g, pz)}</p>}
        <button className="pbtn primary big" onClick={() => send({ type: 'moveGhost' })}>
          {plan?.target ? 'Move the ghost' : 'The ghost waits — continue'}
        </button>
      </div>
    );
  }
  if (g.phase === 'summary') {
    const lines = [...(g.log.map((e) => (e.kind === 'outcome' ? null : logLine(e, g, pz))).filter(Boolean) as string[]), ...(g.lastOutcome ? outcomeLines(g.lastOutcome, g, pz) : [])];
    return (
      <div className="pstack">
        <ul className="plog">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <button className="pbtn primary big" onClick={() => send({ type: 'nextTurn' })}>
          End my turn ▸
        </button>
      </div>
    );
  }
  return null;
}

function PhoneChoose({ g, send, revealed }: { g: GameState; send: (a: Action) => void; revealed: number[] }) {
  const me = g.players[g.turn];
  const routes = [...legalRoutes(g).values()].sort((a, b) => a.path.length - b.path.length || a.dest - b.dest);
  const sel = g.selection.dest;
  const pv = sel !== null ? previewMove(g, g.selection.moveDie, sel) : null;
  const warn = pv ? encounterWarning(pv.encounter, g, pv.waivesProtection) : null;
  const dice = g.dice!;
  return (
    <div className="pstack">
      {me.alive ? (
        <div className="pdice">
          {[0, 1].map((i) => (
            <button key={i} className={`pdie ${g.selection.moveDie === i ? 'move' : 'ghost'}`} disabled={dice[0] === dice[1]} onClick={() => send({ type: 'select', moveDie: i as 0 | 1 })}>
              <b>{dice[i]}</b>
              <small>{g.selection.moveDie === i ? 'you move' : 'ghost moves'}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="pnote">Your ghost may drift up to {dice[0]} spaces (no resident-ghost move on your turn).</p>
      )}
      {me.alive && <p className="muted small">☠ Unknown corridors may hide a Reaper. Only where you stop counts.</p>}
      <MiniMap game={g} revealed={revealed} pickable={new Set(routes.map((r) => r.dest))} selected={typeof sel === 'number' ? sel : null} onPick={(d) => send({ type: 'select', dest: d })} path={pv?.path} showWallLinks={!me.alive} label="Tap where to go" />
      <div className="pdests">
        <button className={`pdest ${sel === 'stay' ? 'on' : ''}`} onClick={() => send({ type: 'select', dest: 'stay' })}>
          Stay
        </button>
        {routes.map((r) => (
          <button key={r.dest} className={`pdest ${sel === r.dest ? 'on' : ''}`} onClick={() => send({ type: 'select', dest: r.dest })}>
            {nodeName(r.dest, pz)} <small>#{r.dest}</small>
          </button>
        ))}
      </div>
      {pv && (
        <div className="pcard">
          {warn && <p className="pwarn">⚠ {warn}.</p>}
          <p>➜ {previewSummary(pv, g, pz)}</p>
          {pv.ghost && <p className="muted small">👻 {ghostSummary(pv.ghost, g, pz)}{pv.provisional ? ' (forecast only)' : ''}</p>}
        </div>
      )}
      <button className={`pbtn primary big ${warn ? 'risky' : ''}`} disabled={sel === null} onClick={() => send({ type: 'confirmMove' })}>
        {sel === null ? 'Choose where to go' : warn ? 'Risk it' : 'Confirm move'}
      </button>
      {me.alive && <p className="muted small">The ghost will move up to {ghostAllowance(g)}.</p>}
    </div>
  );
}

function PhoneChallenge({ view, client, seat }: { view: RoomView; client: RoomClient; seat: number }) {
  const g = view.game!;
  const ch = g.challenge!;
  const run = view.run;
  const mine = ch.participants.includes(seat);
  const [phase, setPhase] = useState<'wait' | 'count' | 'play' | 'sent'>('wait');
  const [left, setLeft] = useState(3);
  const pressRef = useRef<((p: number, d?: number) => void) | null>(null);
  const sentKey = useRef('');
  const key = `${ch.id}:${run?.attempt ?? 0}`;
  const warned = useRef(false);

  useEffect(() => {
    setPhase('wait');
  }, [key]);

  useEffect(() => {
    if (!mine || !run?.startAt || run.paused) return;
    if (!warned.current && client.rtt > 500 && Number.isFinite(client.rtt)) {
      warned.current = true;
      client.send({ t: 'syncPoor', rttMs: client.rtt });
    }
    const localStart = run.startAt - client.offset;
    const tick = () => {
      const ms = localStart - Date.now();
      if (ms <= 0) {
        setPhase((p) => (p === 'sent' ? p : 'play'));
        return;
      }
      setPhase((p) => (p === 'wait' ? 'count' : p));
      setLeft(Math.ceil(ms / 1000));
      timer = window.setTimeout(tick, Math.min(200, ms));
    };
    let timer = window.setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [mine, run?.startAt, run?.paused, client, key]);

  const done = useCallback(
    (inputs: Record<number, ChallengeInput[]>) => {
      if (sentKey.current === key) return;
      sentKey.current = key;
      client.send({ t: 'challengeInput', challengeId: ch.id, attempt: run?.attempt ?? 0, inputs: inputs[seat] ?? [] });
      setPhase('sent');
    },
    [client, ch.id, run?.attempt, seat, key],
  );

  if (!mine)
    return (
      <div className="pcard">
        <h2>{CHALLENGE_TITLES[ch.kind]}</h2>
        <p>{ch.participants.map((p) => g.players[p].name).join(' vs ')} — watch the TV!</p>
      </div>
    );
  if (run?.paused) return <p className="pstatus">{run.paused}</p>;
  const ready = run?.ready.includes(seat);
  if (!ready)
    return (
      <div className="pcard">
        <small>{ch.oneSurvivor && ch.kind === 'duel' ? 'One survivor' : 'Survival challenge'}</small>
        <h2>{CHALLENGE_TITLES[ch.kind]}</h2>
        <p>{challengeHowTo(ch.kind, ch.oneSurvivor)}</p>
        {run?.note && <p className="pnote">{run.note}</p>}
        <button
          className="pbtn primary big"
          onClick={() => {
            audio.unlock();
            client.calibrate();
            client.send({ t: 'ready', challengeId: ch.id, attempt: run?.attempt ?? 0 });
          }}
        >
          I’m ready
        </button>
      </div>
    );
  if (phase === 'wait') return <p>Waiting for {ch.participants.filter((p) => !run?.ready.includes(p)).map((p) => g.players[p].name).join(' and ') || 'the start'}…</p>;
  if (phase === 'count') return <div className="pcount">{left}</div>;
  if (phase === 'sent') return <p>Sent! Waiting for the verdict on the TV…</p>;
  const props = { ch, bots: {}, pressRef, onDone: done };
  return (
    <div className="pchallenge" key={key}>
      <h2>{CHALLENGE_TITLES[ch.kind]}</h2>
      {ch.kind === 'escape' && <EscapeGame {...props} human={seat} />}
      {ch.kind === 'dance' && <DanceGame {...props} human={seat} />}
      {(ch.kind === 'rope' || ch.kind === 'duel') && <RopeGame {...props} game={g} humans={[seat]} />}
      <p className="muted small">Ends in about {Math.round(challengeDurationMs(ch.kind, ch.seed, ch.oneSurvivor) / 1000)} s.</p>
    </div>
  );
}

function PhoneResults({ g }: { g: GameState }) {
  const rows = finalScores(g);
  return (
    <div className="pstack">
      <h2>{g.endReason === 'noneAlive' ? 'Nobody survived the night' : 'Midnight!'}</h2>
      <ol className="presults">
        {rows.map((r) => (
          <li key={r.player} className={r.winner ? 'win' : ''}>
            <b>{g.players[r.player].name}</b> {r.total}{' '}
            <small className="muted">
              ({r.alive ? `${r.banked} + ${r.carriedHalf} + ${r.survivalBonus}` : `${r.banked} + bounty ${r.bounty}`})
            </small>
          </li>
        ))}
      </ol>
    </div>
  );
}

