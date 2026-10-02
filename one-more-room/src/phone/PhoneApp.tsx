// The phone controller (…/#/join). No 3D here — the TV shows the mansion.
// The phone only ever receives its seat view: the public state plus its own
// piece's trap nomination. In a pair, only this round's controller can act;
// the other phone follows along.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHARACTERS, ROUNDS, TEXT_LIMITS, TRAP_ELIGIBLE, type CharacterId } from '../engine/config';
import { actingPiece, finalScores } from '../engine/engine';
import { forkChoices, stepFor } from '../forks';
import type { Action, GameState } from '../engine/types';
import type { RoomView, ServerMsg } from '../net/protocol';
import { findService, newActionId, RoomClient, tokenStore } from '../net/client';
import { controllerLine, logLine, outcomeLines, rollLine } from '../text';
import { defaultPersonalization } from '../engine/save';
import { MiniMap } from '../ui/MiniMap';
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
      <p className="muted small">{view.mode === 'ffa' ? 'One phone per piece.' : 'Up to two phones per piece.'}</p>
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
      <p>{my === null ? 'Pick your character:' : 'Your character (tap another to switch):'}</p>
      <div className="pchars">
        {CHARACTERS.map((c) => {
          const owner = view.pieces.find((s) => s.character === c.id);
          const mine = !!owner && owner.piece === my;
          return (
            <button key={c.id} className={`pchar ${mine ? 'on' : ''}`} style={{ borderColor: c.color }} disabled={!!owner && !owner.auto && !mine} onClick={() => claim(c.id)}>
              <b>{c.name}</b>
              <small>{owner ? (mine ? 'you' : owner.auto ? 'bot · take it' : owner.name) : 'free'}</small>
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
            {s.name} <span className={`tag ${s.kind === 'bot' ? 'bot' : 'human'}`}>{s.kind === 'bot' ? 'BOT' : 'HUMAN'}</span>
            {s.kind !== 'bot' && s.members.some((m) => !m.connected) ? ' (offline)' : ''}
          </li>
        ))}
      </ul>
      <p className="muted">Free pieces are bots. Waiting for the host to start…</p>
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
  if (piece === null) return <Watching g={g} note="You are watching." />;
  // The private confirmation stays up until hidden — even if the game has moved on.
  const needsAck = view.ownNomination !== null && !acked && g.round === 1 && (g.phase === 'placement' || g.phase === 'lifeRoll' || g.actionNumber <= g.pieces.length);
  const me = g.pieces[piece];
  const inControl = !!view.you?.inControl;
  // A ghost battle's winner chooses its reward even out of turn.
  const mine = rewardDecider(g) === piece;
  const started = g.phase !== 'placement' && g.phase !== 'lifeRoll';
  const jumping = g.phase === 'challenge' && !!g.challenge && g.challenge.participants.includes(piece);
  return (
    <div className="pstack">
      <header className={`phead ${started && me.alive ? 'living' : ''}`} style={{ borderColor: colorOf(me.character) }}>
        <span className="pdot" style={{ background: colorOf(me.character) }}>
          {piece + 1}
        </span>
        <div>
          <b>{me.name}</b> {started ? (me.alive ? '❤' : '👻') : ''}
          <div className="muted small">
            {me.score} pt{me.score === 1 ? '' : 's'} · Round {g.round}/{ROUNDS}
            {controllerLine(g, piece) ? ` · ${controllerLine(g, piece)}${inControl ? ' (you)' : ''}` : ''}
          </div>
        </div>
        {me.item && <ItemBadge item={me.item} />}
      </header>
      {needsAck ? (
        <NominationAck nomination={view.ownNomination!} onHide={ack} />
      ) : (
        g.phase === 'placement' && <Placement view={view} send={send} piece={piece} />
      )}
      {!needsAck && g.phase === 'lifeRoll' && <p className="pbig">Rolling for life… 🎲</p>}
      {!needsAck && g.phase === 'challenge' && (jumping && inControl ? <PhoneJump view={view} client={client} piece={piece} /> : <Watching g={g} note={jumping ? 'Your teammate jumps this round' : undefined} />)}
      {!needsAck && g.phase === 'gameOver' && <PhoneResults g={g} />}
      {!needsAck &&
        started &&
        !['challenge', 'gameOver'].includes(g.phase) &&
        (mine && inControl ? <MyAction g={g} send={send} /> : mine ? <Watching g={g} note="Your teammate’s turn" /> : <Watching g={g} />)}
    </div>
  );
}

function Placement({ view, send, piece }: { view: RoomView; send: (a: Action) => void; piece: number }) {
  const g = view.game!;
  const [draft, setDraft] = useState<number | null>(null);
  const eligible = useMemo(() => new Set(TRAP_ELIGIBLE), []);
  if (view.ownNomination !== null) {
    const waiting = g.pieces.filter((_, i) => g.nominations[i] === null).map((p) => p.name);
    return <p className="pbig">Waiting for {waiting.join(', ') || 'the house'}…</p>;
  }
  if (!view.you?.selector) {
    const selector = view.pieces[piece]?.members[0]?.name ?? 'your teammate';
    return <p className="pnote">{selector} sets your team’s trap.</p>;
  }
  return (
    <div className="pstack">
      <h2>Hide a trap</h2>
      <p className="muted small">Tap a glowing space. Only you (and a teammate) know.</p>
      <MiniMap pickable={eligible} selected={draft} onPick={setDraft} label="Choose a corridor for your trap" />
      <button className="pbtn primary big" disabled={draft === null} onClick={() => draft !== null && send({ type: 'nominate', piece, node: draft })}>
        {draft === null ? 'Tap a glowing space' : `Hide it on ${draft}`}
      </button>
    </div>
  );
}

function NominationAck({ nomination, onHide }: { nomination: number; onHide: () => void }) {
  return (
    <div className="pcard">
      <h2>Trap hidden on space {nomination}</h2>
      <p className="muted small">Remember it — it won’t be shown again, and it works on you too.</p>
      <button className="pbtn primary" onClick={onHide}>
        Got it
      </button>
    </div>
  );
}

/** Not your move: one line saying what is happening, the scores, and the map. */
function Watching({ g, note }: { g: GameState; note?: string }) {
  const acting = rewardDecider(g);
  const p = acting >= 0 ? g.pieces[acting] : null;
  let doing = p ? `${p.name} is playing` : '';
  if (p && g.phase === 'turnStart') doing = `${p.name} is rolling`;
  if (p && g.phase === 'choose') doing = `${p.name} is moving`;
  if (p && g.phase === 'hunt') doing = `${p.name} is choosing`;
  if (p && g.phase === 'reward') doing = `${p.name}: keep or replace?`;
  if (g.phase === 'challenge' && g.challenge) doing = `${g.challenge.participants.map((i) => g.pieces[i].name).join(' vs ')} — watch the TV`;
  return (
    <div className="pstack">
      {note && <p className="pnote">{note}</p>}
      <p className="pbig">{doing}</p>
      <Scoreboard g={g} />
      <MiniMap game={g} revealed={g.traps} label="Mansion map" />
    </div>
  );
}

function Scoreboard({ g }: { g: GameState }) {
  return (
    <ul className="pscores" aria-label="Scores">
      {g.pieces.map((p, i) => (
        <li key={p.id} className={p.alive ? 'alive' : ''}>
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

function MyAction({ g, send }: { g: GameState; send: (a: Action) => void }) {
  const me = g.pieces[actingPiece(g)];
  if (g.phase === 'turnStart')
    return (
      <div className="pstack">
        <p className="pbig">Your turn {me.alive ? '❤' : '👻'}</p>
        <ItemActions game={g} send={send} btn="pbtn" pz={pz} />
        <button className="pbtn primary huge" onClick={() => send({ type: 'roll' })}>
          Roll 🎲
        </button>
      </div>
    );
  if (g.phase === 'choose') return <PhoneChoose g={g} send={send} />;
  if (g.phase === 'pick')
    return (
      <div className="pstack">
        <p className="pbig">☠ Choose opponent</p>
        {g.pick!.options.map((o) => (
          <button key={o} className="pbtn big" onClick={() => send({ type: 'pickOpponent', option: o })}>
            {g.pieces[o].name} · {g.pieces[o].score} pts
          </button>
        ))}
      </div>
    );
  if (g.phase === 'hunt') return <EncounterChoices game={g} send={send} btn="pbtn" pz={pz} />;
  if (g.phase === 'reward') return <RewardChoice game={g} send={send} btn="pbtn" canChoose />;
  if (g.phase === 'summary') {
    const lines = [...(g.log.map((e) => (e.kind === 'outcome' || e.kind === 'roll' ? null : logLine(e, g, pz))).filter(Boolean) as string[]).slice(-2), ...(g.lastOutcome ? outcomeLines(g.lastOutcome, g, pz).slice(-1) : [])];
    return (
      <div className="pstack">
        <RewardReveal game={g} />
        <ul className="plog">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <button className="pbtn primary big" onClick={() => send({ type: 'nextTurn' })}>
          Done ▸
        </button>
      </div>
    );
  }
  return null;
}

/** At a fork: the same numbered, coloured arrows as on the TV. */
function PhoneChoose({ g, send }: { g: GameState; send: (a: Action) => void }) {
  const choices = forkChoices(g);
  const started = (g.move?.path.length ?? 1) > 1;
  return (
    <div className="pstack">
      {!started && <p className="pbig">🎲 {rollLine(g)}</p>}
      <ItemActions game={g} send={send} btn="pbtn" pz={pz} />
      <p className="pbig">{g.move?.remaining ?? 0} left · Choose a path</p>
      <div className="parrows">
        {choices.map((c) => (
          <button key={c.to} className="parrow" style={{ ['--fc' as string]: c.color }} onClick={() => send(stepFor(g, c.to))} aria-label={`Way ${c.num}: ${c.word}`}>
            <span className="parrow-num">{c.num}</span>
            <span className="parrow-glyph" style={{ transform: `rotate(${(c.rel * 180) / Math.PI}deg)` }} aria-hidden="true">
              ⬆
            </span>
            <span className="parrow-word">{c.kind === 's' ? '✦ passage' : c.kind === 'w' ? '👻 wall' : c.word}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Same numbers as the arrows on the TV.</p>
    </div>
  );
}

/** During a rope: just a name and one big Jump button. Watch the TV. */
function PhoneJump({ view, client, piece }: { view: RoomView; client: RoomClient; piece: number }) {
  const g = view.game!;
  const run = view.run;
  const me = g.pieces[piece];
  const [flash, setFlash] = useState(0);
  const runId = run ? `${run.id}:${run.attempt}` : '';
  useEffect(() => {
    if (!runId) return;
    client.calibrate(); // a fresh clock estimate for each rope
    const t = window.setTimeout(() => {
      if (client.rtt > 250) client.send({ t: 'syncPoor', rttMs: client.rtt });
    }, 1200);
    return () => clearTimeout(t);
  }, [runId, client]);
  if (!run) return <p className="pbig">Get ready…</p>;
  const ready = run.ready.includes(piece);
  const press = () => {
    client.send({ t: 'press', challengeId: run.id, attempt: run.attempt, at: client.serverNow() });
    try {
      navigator.vibrate?.(12);
    } catch {
      /* not supported */
    }
    setFlash((f) => f + 1);
  };
  const label = run.stage === 'ready' ? (ready ? 'Ready ✓' : 'JUMP — I’m ready') : run.stage === 'practice' ? 'JUMP (practice)' : 'JUMP';
  const status = run.paused ?? (run.stage === 'ready' ? (ready ? 'Watch the TV' : 'Press when ready') : 'Watch the TV');
  return (
    <div className="pjump-wrap" style={{ ['--pc' as string]: colorOf(me.character) }}>
      <p className="pjump-name">
        {me.name} {me.alive ? '❤' : '👻'}
      </p>
      <button
        key={flash}
        className={`pjump ${ready && run.stage === 'ready' ? 'is-ready' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          press();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>
      <p className="pjump-status">{status}</p>
      {client.rtt > 250 && Number.isFinite(client.rtt) && <p className="perr">Slow connection to the TV — tell the host</p>}
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
