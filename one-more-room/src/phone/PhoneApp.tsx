// The phone controller (…/#/join). No 3D here — the TV shows the mansion.
// The phone only ever receives its seat view: the public state plus its own
// piece's trap nomination. In a pair, only this round's controller can act;
// the other phone follows along.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, ROUNDS, TEXT_LIMITS, TRAP_ELIGIBLE, type CharacterId } from '../engine/config';
import { actingPiece, activeController, finalScores, legalRoutes, livingPiece, previewMove } from '../engine/engine';
import { challengeDurationMs, type ChallengeInput } from '../engine/challenges';
import type { Action, GameState } from '../engine/types';
import type { RoomView, ServerMsg } from '../net/protocol';
import { findService, newActionId, RoomClient, tokenStore } from '../net/client';
import { challengeHost, challengeHowTo, challengeTitle, controllerLine, curseLine, logLine, nodeName, outcomeLines, previewSummary, rollLine, superReaperLine } from '../text';
import { defaultPersonalization } from '../engine/save';
import { MiniMap } from '../ui/MiniMap';
import { RopeGame } from '../ui/Challenges';
import { EncounterChoices, ItemActions, ItemBadge, RewardChoice, RewardReveal, rewardDecider } from '../ui/Items';
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

  // Auto-rejoin a room this phone was already in (refresh keeps the piece).
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
        <p className="muted">To use phones at a party, run the room service on a computer on your Wi-Fi (see the game’s README), open the address it prints on the TV, and scan the QR code it shows.</p>
        <a className="pbtn primary big plink" href="./">
          Play on this screen
        </a>
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
      {view.paused && <p className="pstatus">The host paused the game.</p>}
      {view.notice && !view.paused && <p className="pnote">{view.notice}</p>}
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
  const my = view.you?.piece ?? null;
  const [name, setName] = useState(view.you?.name ?? defaultName);
  const claim = (character: CharacterId) =>
    my === null ? client.send({ t: 'claimPiece', character, name: name || 'Player' }) : client.send({ t: 'setCharacter', character });
  const openTeams = view.mode === 'teams' ? view.pieces.filter((p) => p.kind === 'phone' && p.members.length === 1 && p.piece !== my) : [];
  const myPiece = my !== null ? view.pieces[my] : null;
  return (
    <div className="pstack">
      <h1>Room {view.code}</h1>
      <p className="muted small">{view.mode === 'ffa' ? 'Free-for-all: one phone per piece.' : 'Team Battle: up to two phones per piece.'}</p>
      <label className="pf">
        Your name
        <input value={name} maxLength={TEXT_LIMITS.playerName} onChange={(e) => setName(e.target.value)} />
      </label>
      {myPiece && (
        <p className="pnote">
          You play <b>{CHARACTERS.find((c) => c.id === myPiece.character)!.name}</b>
          {myPiece.members.length > 1 ? ` with ${myPiece.members.filter((m) => m.participantId !== view.you!.participantId).map((m) => m.name).join('')} — ${view.you!.slots.includes(0) ? 'you play odd rounds and confirm the trap' : 'you play even rounds'}` : ''}.
        </p>
      )}
      <p>{my === null ? 'Pick a costume for a new piece:' : 'Your costume (tap another free one to switch):'}</p>
      <div className="pchars">
        {CHARACTERS.map((c) => {
          const owner = view.pieces.find((s) => s.character === c.id);
          const mine = !!owner && owner.piece === my;
          return (
            <button key={c.id} className={`pchar ${mine ? 'on' : ''}`} style={{ borderColor: c.color }} disabled={!!owner && !mine} onClick={() => claim(c.id)}>
              <b>{c.name}</b>
              <small>{owner ? (mine ? 'you' : owner.name) : 'free'}</small>
            </button>
          );
        })}
      </div>
      {openTeams.length > 0 && (
        <div className="pstack">
          <p>Or join a team:</p>
          {openTeams.map((t) => (
            <button key={t.piece} className="pbtn" onClick={() => client.send({ t: 'joinTeam', piece: t.piece, name: name || 'Player' })}>
              Join {t.name}’s {CHARACTERS.find((c) => c.id === t.character)!.name}
            </button>
          ))}
        </div>
      )}
      {my !== null && (
        <button className="pbtn ghost" onClick={() => client.send({ t: 'leaveSeat' })}>
          Leave my piece
        </button>
      )}
      <ul className="pseats">
        {view.pieces.map((s) => (
          <li key={s.piece}>
            <span className="pdot" style={{ background: colorOf(s.character) }}>
              {s.piece + 1}
            </span>{' '}
            {s.name} {s.kind === 'bot' ? '🤖' : s.members.some((m) => !m.connected) ? '(someone offline)' : ''}
          </li>
        ))}
      </ul>
      <p className="muted">Waiting for the host to start on the TV…</p>
    </div>
  );
}

function Game({ view, client }: { view: RoomView; client: RoomClient }) {
  const g = view.game!;
  const piece = view.you?.piece ?? null;
  const send = useCallback((action: Action) => client.send({ t: 'action', id: newActionId(), rev: view.rev, action }), [client, view.rev]);
  const ackKey = `one-more-room/ack/${view.code}/${piece}/${view.ownNomination}`;
  const [acked, setAcked] = useState(() => {
    try {
      return localStorage.getItem(ackKey) === '1';
    } catch {
      return false;
    }
  });
  const ack = () => {
    setAcked(true);
    try {
      localStorage.setItem(ackKey, '1');
    } catch {
      /* ignore */
    }
  };
  if (piece === null) return <Watching g={g} note="You are watching. The host can hand you a piece if a controller drops out." />;
  // The private confirmation stays up until hidden — even if the game has moved on.
  const needsAck = view.ownNomination !== null && !acked && g.round === 1 && (g.phase === 'placement' || g.phase === 'lifeRoll' || g.actionNumber <= g.pieces.length);
  const me = g.pieces[piece];
  const inControl = !!view.you?.inControl;
  // A ghost battle's winner chooses its reward even out of turn.
  const acting = rewardDecider(g) === piece;
  const started = g.phase !== 'placement' && g.phase !== 'lifeRoll';
  const curse = me.alive ? curseLine(me.streak) : null;
  return (
    <div className="pstack">
      <header className={`phead ${started && me.alive ? 'living' : ''}`} style={{ borderColor: colorOf(me.character) }}>
        <span className="pdot" style={{ background: colorOf(me.character) }}>
          {piece + 1}
        </span>
        <div>
          <b>{me.name}</b> {started ? (me.alive ? '❤ alive' : '👻 ghost') : ''}
          <div className="muted small">
            Round {g.round}/{ROUNDS} • {me.score} point{me.score === 1 ? '' : 's'}
            {controllerLine(g, piece) ? ` • ${controllerLine(g, piece)}${inControl ? ' (you)' : ''}` : ''}
          </div>
          {curse && <div className="small pcurse">{curse}</div>}
        </div>
      </header>
      {started && <Scoreboard g={g} me={piece} />}
      {needsAck ? (
        <NominationAck nomination={view.ownNomination!} onHide={ack} />
      ) : (
        g.phase === 'placement' && <Placement view={view} send={send} piece={piece} />
      )}
      {!needsAck && g.phase === 'lifeRoll' && <p className="pnote">Everyone rolls for life… watch the TV.</p>}
      {!needsAck && g.phase === 'challenge' && <PhoneChallenge view={view} client={client} piece={piece} />}
      {!needsAck && g.phase === 'gameOver' && <PhoneResults g={g} />}
      {!needsAck && started && !['challenge', 'gameOver'].includes(g.phase) &&
        (acting && inControl ? (
          <MyAction g={g} send={send} />
        ) : acting ? (
          <Watching
            g={g}
            note={
              g.phase === 'reward'
                ? `Your piece won an item — ${me.controllers[activeController(g, piece)]} chooses this round.`
                : `Your piece’s action — ${me.controllers[activeController(g, piece)]} controls it this round.`
            }
          />
        ) : (
          <Watching g={g} />
        ))}
    </div>
  );
}

/** Every piece's points, who holds the life, and the curse on the living piece. */
function Scoreboard({ g, me }: { g: GameState; me: number }) {
  return (
    <ul className="pscores" aria-label="Scores">
      {g.pieces.map((p, i) => (
        <li key={p.id} className={`${p.alive ? 'alive' : ''} ${i === me ? 'me' : ''}`}>
          <span className="pdot" style={{ background: colorOf(p.character) }}>
            {i + 1}
          </span>
          <span className="pn">{p.name}</span>
          <b>{p.score}</b>
          {p.alive ? ' ❤' : ''}
          {p.item && <ItemBadge item={p.item} compact />}
        </li>
      ))}
    </ul>
  );
}

function Placement({ view, send, piece }: { view: RoomView; send: (a: Action) => void; piece: number }) {
  const g = view.game!;
  const [draft, setDraft] = useState<number | null>(null);
  const eligible = useMemo(() => new Set(TRAP_ELIGIBLE), []);
  if (view.ownNomination !== null) {
    const waiting = g.pieces.filter((_, i) => g.nominations[i] === null).map((p) => p.name);
    return <p>Waiting for {waiting.join(', ') || 'the house'} to set a trap…</p>;
  }
  if (!view.you?.selector) {
    const selector = view.pieces[piece]?.members[0]?.name ?? 'your teammate';
    return <p className="pnote">{selector} confirms your team’s trap. You’ll both see it once it is set.</p>;
  }
  return (
    <div className="pstack">
      <h2>Set a trap — secretly</h2>
      <p className="muted small">
        Only glowing spaces are allowed. Nobody else sees your pick (a teammate does). The game deals the effects: you choose the place, not
        what it does, and it works on you too.
      </p>
      <MiniMap pickable={eligible} selected={draft} onPick={setDraft} label="Choose a corridor for your trap" />
      <button className="pbtn primary" disabled={draft === null} onClick={() => draft !== null && send({ type: 'nominate', piece, node: draft })}>
        {draft === null ? 'Tap a glowing space' : `Set the trap on space ${draft}`}
      </button>
    </div>
  );
}

function NominationAck({ nomination, onHide }: { nomination: number; onHide: () => void }) {
  return (
    <div className="pcard">
      <h2>Your trap is set</h2>
      <p>
        A hidden trap waits at <b>space {nomination}</b>. It will not be shown again — remember it. Nobody knows its effect, and you are not
        immune.
      </p>
      <button className="pbtn primary" onClick={onHide}>
        Hide it
      </button>
    </div>
  );
}

function Watching({ g, note }: { g: GameState; note?: string }) {
  const acting = actingPiece(g);
  const p = acting >= 0 ? g.pieces[acting] : null;
  const living = livingPiece(g);
  const lines = g.log.map((e) => logLine(e, g, pz)).filter(Boolean).slice(-4) as string[];
  return (
    <div className="pstack">
      {note && <p className="pnote">{note}</p>}
      {p && (
        <p>
          <b>{p.name}</b> {p.alive ? '(alive)' : '(ghost)'} is acting • {living >= 0 ? `${g.pieces[living].name} holds the life` : ''}
        </p>
      )}
      {g.schedule.length > 0 && (
        <p className="muted small">
          Order: {g.schedule.map((i, k) => `${k < g.slot ? '✓ ' : k === g.slot ? '▶ ' : ''}${g.pieces[i].name}`).join(' → ')}
        </p>
      )}
      {g.phase === 'reward' && <RewardChoice game={g} send={() => {}} btn="pbtn" canChoose={false} />}
      {g.phase === 'summary' && <RewardReveal game={g} />}
      <ul className="plog">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <MiniMap game={g} revealed={g.traps} label="Mansion map" />
    </div>
  );
}

function MyAction({ g, send }: { g: GameState; send: (a: Action) => void }) {
  const me = g.pieces[actingPiece(g)];
  if (g.phase === 'turnStart')
    return (
      <div className="pstack">
        <p className="pnote">
          {me.alive
            ? 'You hold the life. Move up to your roll, or stay — ghosts act after you.'
            : `You are a ghost: you drift at least 3 spaces. End on ${g.pieces[livingPiece(g)].name}’s space or next to it to challenge.`}
        </p>
        <ItemActions game={g} send={send} btn="pbtn" pz={pz} />
        <button className="pbtn primary big" onClick={() => send({ type: 'roll' })}>
          Roll the die 🎲
        </button>
      </div>
    );
  if (g.phase === 'choose') return <PhoneChoose g={g} send={send} />;
  if (g.phase === 'pick')
    return (
      <div className="pstack">
        <p>
          <b>Reaper’s Challenge:</b> pick a ghost to duel for the life.
        </p>
        {g.pick!.options.map((o) => (
          <button key={o} className="pbtn" onClick={() => send({ type: 'pickOpponent', option: o })}>
            {g.pieces[o].name} • {g.pieces[o].score} pts
          </button>
        ))}
      </div>
    );
  if (g.phase === 'hunt') return <EncounterChoices game={g} send={send} btn="pbtn" pz={pz} />;
  if (g.phase === 'reward') return <RewardChoice game={g} send={send} btn="pbtn" canChoose />;
  if (g.phase === 'summary') {
    const lines = [...(g.log.map((e) => (e.kind === 'outcome' ? null : logLine(e, g, pz))).filter(Boolean) as string[]), ...(g.lastOutcome ? outcomeLines(g.lastOutcome, g, pz) : [])];
    const last = g.slot === g.schedule.length - 1;
    return (
      <div className="pstack">
        <RewardReveal game={g} />
        <ul className="plog">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <button className="pbtn primary big" onClick={() => send({ type: 'nextTurn' })}>
          {last ? 'Ring the bell ▸' : 'Done ▸'}
        </button>
      </div>
    );
  }
  return null;
}

function PhoneChoose({ g, send }: { g: GameState; send: (a: Action) => void }) {
  const me = g.pieces[actingPiece(g)];
  const routes = [...legalRoutes(g).values()].sort((a, b) => a.path.length - b.path.length || a.dest - b.dest);
  const sel = g.selection.dest;
  const pv = sel !== null ? previewMove(g, sel) : null;
  const minigame = pv && (pv.known === 'reaper' || pv.known === 'seance');
  return (
    <div className="pstack">
      <p className="pnote">{rollLine(g)}</p>
      <ItemActions game={g} send={send} btn="pbtn" pz={pz} />
      <p className="muted small">☠ Six hidden traps: only where a move ends counts. {superReaperLine(g)}.</p>
      <MiniMap game={g} revealed={g.traps} pickable={new Set(routes.map((r) => r.dest))} selected={typeof sel === 'number' ? sel : null} onPick={(d) => send({ type: 'select', dest: d })} path={pv?.path} showWallLinks={!me.alive} label="Tap where to go" />
      <div className="pdests">
        <button className={`pdest ${sel === 'stay' ? 'on' : ''}`} onClick={() => send({ type: 'select', dest: 'stay' })}>
          Stay
        </button>
        {routes.map((r) => {
          const p = previewMove(g, r.dest)!;
          return (
            <button key={r.dest} className={`pdest ${sel === r.dest ? 'on' : ''}`} onClick={() => send({ type: 'select', dest: r.dest })}>
              {p.canChallenge ? '👻 ' : p.known === 'reaper' || p.known === 'seance' || p.superReaper ? '☠ ' : p.battleTargets.length || p.versus ? '⚔ ' : ''}
              {nodeName(r.dest, pz)} <small>#{r.dest}</small>
            </button>
          );
        })}
      </div>
      {pv && (
        <div className="pcard">
          {minigame && <p className="pwarn">☠ This ends your action with a Haunted Jump Rope.</p>}
          <p>➜ {previewSummary(pv, g, pz)}</p>
        </div>
      )}
      <button className={`pbtn primary big ${minigame ? 'risky' : ''}`} disabled={sel === null} onClick={() => send({ type: 'confirmMove' })}>
        {sel === null ? 'Choose where to go' : minigame ? 'Risk it' : 'Confirm'}
      </button>
    </div>
  );
}

function PhoneChallenge({ view, client, piece }: { view: RoomView; client: RoomClient; piece: number }) {
  const g = view.game!;
  const ch = g.challenge!;
  const run = view.run;
  const mine = ch.participants.includes(piece);
  const inControl = !!view.you?.inControl;
  const [phase, setPhase] = useState<'wait' | 'count' | 'play' | 'sent'>('wait');
  const [left, setLeft] = useState(3);
  const pressRef = useRef<((p: number) => void) | null>(null);
  const sentKey = useRef('');
  const key = `${ch.id}:${run?.attempt ?? 0}`;
  const warned = useRef(false);

  useEffect(() => {
    setPhase('wait');
  }, [key]);

  useEffect(() => {
    if (!mine || !inControl || !run?.startAt || run.paused) return;
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
  }, [mine, inControl, run?.startAt, run?.paused, client, key]);

  const done = useCallback(
    (inputs: Record<number, ChallengeInput[]>) => {
      if (sentKey.current === key) return;
      sentKey.current = key;
      client.send({ t: 'challengeInput', challengeId: ch.id, attempt: run?.attempt ?? 0, inputs: inputs[piece] ?? [] });
      setPhase('sent');
    },
    [client, ch.id, run?.attempt, piece, key],
  );

  if (!mine)
    return (
      <div className="pcard">
        <h2>{challengeTitle(ch)}</h2>
        <p>{challengeHost(ch, g)} Watch the TV!</p>
      </div>
    );
  if (!inControl)
    return (
      <div className="pcard">
        <h2>{challengeTitle(ch)}</h2>
        <p>Your piece is jumping — {g.pieces[piece].controllers[activeController(g, piece)]} controls it this round. Cheer them on!</p>
      </div>
    );
  if (run?.paused) return <p className="pstatus">{run.paused}</p>;
  const ready = run?.ready.includes(piece);
  const k = ch.participants.indexOf(piece);
  if (!ready)
    return (
      <div className="pcard">
        <small>{ch.kind === 'seance' ? `Séance · ${ch.participants.length} jumpers` : 'For the life'}</small>
        <h2>{challengeTitle(ch)}</h2>
        <p>{challengeHost(ch, g)}</p>
        <p>{challengeHowTo(ch)}</p>
        {ch.multipliers[k] < 1 && <p className="pwarn">{curseLine(g.pieces[piece].streak)}</p>}
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
  if (phase === 'wait') return <p>Waiting for {ch.participants.filter((p) => !run?.ready.includes(p)).map((p) => g.pieces[p].name).join(' and ') || 'the start'}…</p>;
  if (phase === 'count') return <div className="pcount">{left}</div>;
  if (phase === 'sent') return <p>Sent! Waiting for the verdict on the TV…</p>;
  return (
    <div className="pchallenge" key={key}>
      <h2>{challengeTitle(ch)}</h2>
      <RopeGame ch={ch} game={g} bots={{}} pressRef={pressRef} onDone={done} humans={[piece]} knownLanes={[piece]} />
      <p className="muted small">Ends in about {Math.round(challengeDurationMs(ch.seed) / 1000)} s (the last four sweeps count only on a tie).</p>
    </div>
  );
}

function PhoneResults({ g }: { g: GameState }) {
  const rows = finalScores(g);
  const winners = rows.filter((r) => r.winner).map((r) => g.pieces[r.piece].name);
  return (
    <div className="pstack">
      <h2>{winners.length === 1 ? `${winners[0]} wins!` : `${winners.join(' & ')} share the win!`}</h2>
      <ol className="presults">
        {rows.map((r) => (
          <li key={r.piece} className={r.winner ? 'win' : ''}>
            <b>{g.pieces[r.piece].name}</b> {r.score} point{r.score === 1 ? '' : 's'} <small className="muted">{r.alive ? '❤ alive at the end' : '👻'}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
