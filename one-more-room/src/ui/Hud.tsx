import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, ENTRANCE, EVENT_INFO, ROUNDS, cardType } from '../engine/config';
import {
  canPlaceDecoy,
  currentGhostPlan,
  finalScores,
  ghostAllowance,
  ghostTarget,
  legalRoutes,
  movementAllowance,
  previewMove,
  undoInfo,
} from '../engine/engine';
import { ghostDistance } from '../engine/graph';
import type { GameState } from '../engine/types';
import { director } from '../director';
import { act, goToSetup, playAgain, setState, toggleCamera, useStore } from '../store';
import { cardFlavor, ghostSummary, logLine, nodeName, placeName, previewSummary } from '../text';
import { hudInsets, overlay } from '../scene/shared';
import { CandyIcon, PlayerBadge } from './Dialog';
import { Die } from './Dice';

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;
const charName = (id: string) => CHARACTERS.find((c) => c.id === id)!.name;

export function Hud() {
  const game = useStore((s) => s.session?.game);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!topRef.current) return; // the results screen measures itself
      const W = window.innerWidth;
      const Hh = window.innerHeight;
      const t = topRef.current?.getBoundingClientRect();
      const b = bottomRef.current?.getBoundingClientRect();
      const l = leftRef.current?.getBoundingClientRect();
      let top = t ? t.bottom + 8 : 72;
      let left = 0;
      let right = 0;
      let bottom = 0;
      if (l && l.width > 0) {
        if (l.width < W * 0.3) left = l.right + 8; // a side column
        else top = Math.max(top, l.bottom + 8); // a strip under the top bar
      }
      if (b && b.width > 0) {
        if (b.left > W * 0.4) right = W - b.left + 8; // docked on the right
        else bottom = Hh - b.top + 8;
      }
      Object.assign(hudInsets, { top, left, right, bottom });
      document.documentElement.style.setProperty('--topbar-h', `${t ? Math.round(t.bottom) : 62}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    [topRef, bottomRef, leftRef].forEach((r) => r.current && ro.observe(r.current));
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  if (!game) return null;
  if (game.phase === 'gameOver') return <Results game={game} />;
  return (
    <div className="hud">
      <TopBar game={game} innerRef={topRef} />
      <PlayersPanel game={game} innerRef={leftRef} />
      <GhostIndicator game={game} />
      <div className="bottom" ref={bottomRef}>
        <ActionPanel game={game} />
      </div>
      <FirstTurnTip game={game} />
      <MidnightBanner />
    </div>
  );
}

function TopBar({ game, innerRef }: { game: GameState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const mode = useStore((s) => s.cameraMode);
  const session = useStore((s) => s.session)!;
  const saveError = useStore((s) => s.saveError);
  const mansion = useStore((s) => s.personalization.mansionName);
  const undo = undoInfo(session);
  const me = game.players[game.turn];
  return (
    <div className="topbar" ref={innerRef}>
      <div className="where">
        <span className="mansion">{mansion}</span>
        <span className="round">
          Round {game.round} / {ROUNDS} • Player {game.turn + 1} / {game.players.length}
        </span>
        {game.midnight && <span className="midnight-tag">{ROUNDS - game.round + 1 === 1 ? 'Final round!' : `${ROUNDS - game.round + 1} rounds to midnight`}</span>}
        <span className="now">
          <PlayerBadge n={game.turn + 1} color={colorOf(me.character)} size={22} /> {me.name}’s turn
        </span>
      </div>
      <div className="tools">
        <button className="btn tool view-toggle" onClick={toggleCamera} aria-pressed={mode === 'overview'} title="Keyboard: V">
          {mode === 'overview' ? 'Follow player' : 'View board'} <kbd>V</kbd>
        </button>
        <button
          className="btn tool"
          disabled={!undo.available}
          onClick={() => setState({ modal: 'confirmUndo' })}
          title={undo.available ? `Restore the start of ${undo.playerName}’s turn (round ${undo.round})` : 'Nothing to undo yet'}
        >
          Undo{undo.available ? ` ${undo.playerName}’s turn` : ''}
        </button>
        <button className="btn tool" onClick={() => setState({ modal: 'rules' })}>
          Rules
        </button>
        <button className="btn tool" onClick={() => setState({ modal: 'settings' })} aria-label="Sound and motion settings">
          Sound
        </button>
        <button className="btn tool" onClick={() => setState({ modal: 'menu' })}>
          Menu
        </button>
        <span className={`saved ${saveError ? 'err' : ''}`} role="status">
          {saveError ? 'Could not save on this device' : 'Saved on this device'}
        </span>
      </div>
    </div>
  );
}

function PlayersPanel({ game, innerRef }: { game: GameState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const pz = useStore((s) => s.personalization);
  const target = useMemo(() => ghostTarget(game), [game]);
  return (
    <div className="players" ref={innerRef} aria-label="Players">
      {game.players.map((p, i) => {
        const hunted = target?.kind === 'player' && target.player === i;
        return (
          <div key={p.id} className={`pcard ${i === game.turn ? 'active' : ''}`} style={{ ['--pc' as string]: colorOf(p.character) }}>
            <div className="pline">
              <PlayerBadge n={i + 1} color={colorOf(p.character)} />
              <span className="pname">{p.name}</span>
              <span className="pchar">{charName(p.character)}</span>
            </div>
            <div className="pstats">
              <span title="Banked candy — safe">
                <b>{p.banked}</b> banked
              </span>
              <span title="Carried candy — at risk" className={p.carried ? 'carry' : ''}>
                <CandyIcon size={14} /> <b>{p.carried}</b> carried
              </span>
              <span className={`decoy ${p.decoyUsed ? 'used' : ''}`} title={p.decoyUsed ? 'Decoy spent' : 'Decoy available'}>
                {p.decoyUsed ? 'decoy spent' : 'decoy ready'}
              </span>
            </div>
            <div className="ploc">
              {p.node === ENTRANCE ? 'Safe in the Entrance Hall' : placeName(p.node, pz)}
              {hunted && <span className="hunted"> • ghost’s target</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GhostIndicator({ game }: { game: GameState }) {
  const pz = useStore((s) => s.personalization);
  const me = game.players[game.turn];
  const target = ghostTarget(game);
  const dist = me.node === ENTRANCE ? null : ghostDistance(game.ghost, me.node);
  const targetText = !target ? 'waiting' : target.kind === 'decoy' ? 'chasing the decoy' : `hunting ${game.players[target.player].name}`;
  return (
    <div
      className="ghost-indicator"
      ref={(el) => {
        overlay.ghostIndicator = el;
      }}
      aria-hidden="true"
    >
      <span className="arrow">➤</span>
      <span className="gi-text">
        <b>{pz.ghostName}</b>
        <br />
        {dist === null ? 'can’t reach the hall' : `${dist} ${dist === 1 ? 'space' : 'spaces'} from ${me.name}`}
        <br />
        {targetText}
      </span>
    </div>
  );
}

// ── the action panel, one layout per phase ──────────────────────────────

function ActionPanel({ game }: { game: GameState }) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const me = game.players[game.turn];
  const color = colorOf(me.character);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const phaseKey = `${game.turnNumber}:${game.phase}:${busy}`;
  useEffect(() => {
    // Hand keyboard focus to the main action whenever the phase changes.
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('.bottom')) primaryRef.current?.focus({ preventScroll: true });
  }, [phaseKey]);

  return (
    <section className="action" style={{ ['--pc' as string]: color }} aria-live="polite">
      <header className="action-head">
        <PlayerBadge n={game.turn + 1} color={color} size={30} />
        <div>
          <h2>
            {me.name} <span className="muted">the {charName(me.character)}</span>
          </h2>
          <p className="sub">
            {me.node === ENTRANCE ? 'In the Entrance Hall (safe)' : `At ${placeName(me.node, pz)}`} • carrying {me.carried} • banked {me.banked}
          </p>
        </div>
        {busy && (
          <button className="btn skip" onClick={() => director.skip()}>
            Skip animation ⏭
          </button>
        )}
      </header>
      {game.phase === 'turnStart' && <TurnStart game={game} primaryRef={primaryRef} />}
      {game.phase === 'choose' && <Choose game={game} primaryRef={primaryRef} />}
      {(game.phase === 'event' || game.phase === 'ghost') && <EventAndGhost game={game} primaryRef={primaryRef} />}
      {game.phase === 'summary' && <Summary game={game} primaryRef={primaryRef} />}
    </section>
  );
}

type PR = { game: GameState; primaryRef: React.RefObject<HTMLButtonElement | null> };

function TurnStart({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const me = game.players[game.turn];
  const [confirmDecoy, setConfirmDecoy] = useState(false);
  const canDecoy = canPlaceDecoy(game);
  useEffect(() => setConfirmDecoy(false), [game.turnNumber]);
  const decoyReason = me.decoyUsed ? 'Decoy already used this game.' : me.node === ENTRANCE ? 'You can’t leave a decoy in the Entrance Hall.' : game.decoy !== null ? 'Decoy placed.' : '';
  return (
    <div className="phase">
      <p className="prompt">
        Roll the dice. One die will move you, the other moves the ghost.
        {game.decoy !== null && ' Your decoy is out — the ghost will chase it this turn.'}
      </p>
      {confirmDecoy ? (
        <div className="decoy-confirm" role="group" aria-label="Confirm decoy">
          <p>
            <strong>Leave your decoy here?</strong> This turn the ghost chases the wrapped sweet on your space instead of
            anyone’s candy. It still catches anyone on its route, including you if you stay. One per game; it vanishes after
            the ghost moves.
          </p>
          <div className="row-btns">
            <button
              className="btn primary"
              onClick={() => {
                act({ type: 'placeDecoy' });
                setConfirmDecoy(false);
              }}
            >
              Place decoy
            </button>
            <button className="btn" onClick={() => setConfirmDecoy(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row-btns">
          <button ref={primaryRef} className="btn primary big" disabled={busy} onClick={() => act({ type: 'roll' })}>
            Roll dice 🎲
          </button>
          <button className="btn" disabled={!canDecoy || busy} onClick={() => setConfirmDecoy(true)} title={decoyReason || 'Spend your one decoy'}>
            Use decoy…
          </button>
          {decoyReason && <span className="muted small">{decoyReason}</span>}
        </div>
      )}
    </div>
  );
}

function DicePair({ game }: { game: GameState }) {
  const rollId = useStore((s) => s.rollId);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const pz = useStore((s) => s.personalization);
  const dice = game.dice!;
  const same = dice[0] === dice[1];
  const moveDie = game.selection.moveDie;
  const choosing = game.phase === 'choose';
  return (
    <div className="dice-pair" role="group" aria-label="Dice assignment">
      {[0, 1].map((i) => {
        const isMove = moveDie === i;
        const label = isMove ? 'You move' : `${pz.ghostName} moves`;
        const value = dice[i] + (!isMove ? game.ghostBonus : 0);
        return (
          <button
            key={i}
            className={`die-btn ${isMove ? 'move' : 'ghost'}`}
            disabled={!choosing || same || isMove}
            onClick={() => act({ type: 'select', moveDie: i as 0 | 1 })}
            aria-label={`Die ${i + 1} shows ${dice[i]}: ${label}${!isMove && choosing && !same ? '. Press to move with this die instead.' : ''}`}
          >
            <Die value={dice[i]} rollId={rollId} index={i} reduced={reduced} />
            <span className="die-label">
              {label}
              <b>
                {isMove ? dice[i] : value}
                {!isMove && game.ghostBonus ? ` (${dice[i]}+${game.ghostBonus})` : ''}
              </b>
            </span>
          </button>
        );
      })}
      {choosing && !same && (
        <button className="btn swap" onClick={() => act({ type: 'select', moveDie: moveDie === 0 ? 1 : 0 })}>
          ⇄ Swap dice
        </button>
      )}
      {choosing && same && <span className="muted small">Doubles: both dice are {dice[0]}.</span>}
    </div>
  );
}

function Choose({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const routes = useMemo(() => [...legalRoutes(game).values()].sort((a, b) => a.path.length - b.path.length || a.dest - b.dest), [game]);
  const sel = game.selection.dest;
  const preview = sel !== null ? previewMove(game, game.selection.moveDie, sel) : null;
  const allowance = movementAllowance(game);
  return (
    <div className="phase choose">
      <DicePair game={game} />
      <p className="prompt">
        Move up to {allowance} {allowance === 1 ? 'space' : 'spaces'}: pick a glowing space on the board or below — or stay put.
        {routes.length === 0 && ' No space is reachable, so you can only stay.'}
      </p>
      <div className="dest-list" role="listbox" aria-label="Destinations">
        <button role="option" aria-selected={sel === 'stay'} className={`dest ${sel === 'stay' ? 'on' : ''}`} onClick={() => act({ type: 'select', dest: 'stay' })}>
          Stay put
        </button>
        {routes.map((r) => {
          const pv = previewMove(game, game.selection.moveDie, r.dest)!;
          const gain = pv.harvest + pv.pile;
          return (
            <button
              key={r.dest}
              role="option"
              aria-selected={sel === r.dest}
              className={`dest ${sel === r.dest ? 'on' : ''}`}
              onClick={() => act({ type: 'select', dest: r.dest })}
              onMouseEnter={() => setState({ hoverNode: r.dest })}
              onMouseLeave={() => setState({ hoverNode: null })}
            >
              <span className="dname">{nodeName(r.dest, pz)}</span>
              <span className="dmeta">
                #{r.dest} · {r.path.length - 1} step{r.path.length === 2 ? '' : 's'}
                {r.usesSecret ? ' · passage' : ''}
                {gain ? ` · +${gain}` : ''}
                {pv.bank ? ` · bank ${pv.bank}` : ''}
                {pv.triggersEvent ? ' · card' : ''}
              </span>
            </button>
          );
        })}
      </div>
      {preview && (
        <div className="forecast">
          <p className="you">➜ {previewSummary(preview, game, pz)}</p>
          <p className="ghostline">
            👻 {ghostSummary(preview.ghost, game, pz)}
            {preview.provisional && <em className="prov"> — forecast only: the card may change this</em>}
          </p>
        </div>
      )}
      <div className="row-btns">
        <button ref={primaryRef} className="btn primary big" disabled={sel === null || busy} onClick={() => act({ type: 'confirmMove' })}>
          {sel === null ? 'Choose where to go' : sel === 'stay' ? 'Confirm: stay put' : `Confirm move to ${nodeName(sel, pz)}`}
        </button>
        <span className="muted small">Ghost moves up to {ghostAllowance(game)} after you.</span>
      </div>
    </div>
  );
}

function EventCardView({ game }: { game: GameState }) {
  const pz = useStore((s) => s.personalization);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const ev = game.event!;
  const info = EVENT_INFO[cardType(ev.cardId)];
  const outcome = game.log
    .slice(game.log.findIndex((e) => e.kind === 'card') + 1)
    .filter((e) => e.kind !== 'ghost' && e.kind !== 'ghostWaits')
    .map((e) => logLine(e, game, pz))
    .filter(Boolean);
  return (
    <div className={`event-card ${reduced ? '' : 'reveal'}`} key={ev.cardId}>
      <div className="ec-kind">Trick or Treat</div>
      <h3>{info.title}</h3>
      <p className="flavor">“{cardFlavor(ev.cardId, pz)}”</p>
      <p className="effect">{info.effect}</p>
      {ev.status === 'resolved' && outcome.length > 0 && <p className="outcome">{outcome.join(' ')}</p>}
    </div>
  );
}

function EventAndGhost({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const ev = game.event;
  const plan = game.phase === 'ghost' ? currentGhostPlan(game) : null;
  const last = [...game.log].reverse().find((e) => e.kind === 'move' || e.kind === 'stay');
  const landing = game.log
    .filter((e) => e.kind === 'harvest' || e.kind === 'pile' || e.kind === 'bank')
    .map((e) => logLine(e, game, pz))
    .filter(Boolean);
  return (
    <div className="phase">
      {game.dice && <DicePair game={game} />}
      {last && <p className="muted small">{logLine(last, game, pz)} {landing.join(' ')}</p>}
      {ev && <EventCardView game={game} />}
      {game.phase === 'event' && ev && ev.status === 'choice' && (
        <div className="choices" role="group" aria-label="Card choice">
          {ev.type === 'secretPassage' &&
            ev.options.map((n) => (
              <button key={n} ref={n === ev.options[0] ? primaryRef : undefined} className="btn" disabled={busy} onClick={() => act({ type: 'eventChoose', option: n })}>
                Go to {placeName(n, pz)}
              </button>
            ))}
          {(ev.type === 'stickyFingers' || ev.type === 'costumeMixup') &&
            ev.options.map((i) => {
              const o = game.players[i];
              return (
                <button key={i} ref={i === ev.options[0] ? primaryRef : undefined} className="btn" disabled={busy} onClick={() => act({ type: 'eventChoose', option: i })}>
                  <PlayerBadge n={i + 1} color={colorOf(o.character)} size={20} />{' '}
                  {ev.type === 'stickyFingers' ? `Steal ${Math.min(2, o.carried)} from ${o.name}` : `Swap with ${o.name} (${placeName(o.node, pz)})`}
                </button>
              );
            })}
          {ev.canDecline && (
            <button className="btn ghost" disabled={busy} onClick={() => act({ type: 'eventDecline' })}>
              No thanks — stay here
            </button>
          )}
        </div>
      )}
      {plan && (
        <>
          <p className="ghostline big">👻 {ghostSummary(plan, game, pz)}</p>
          <div className="row-btns">
            <button ref={primaryRef} className="btn primary big ghost-btn" disabled={busy} onClick={() => act({ type: 'moveGhost' })}>
              {plan.target ? `Move ${pz.ghostName}` : `${pz.ghostName} waits — continue`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const lines = game.log.map((e) => logLine(e, game, pz)).filter(Boolean) as string[];
  const n = game.players.length;
  const last = game.turn === n - 1 && game.round === ROUNDS;
  const next = game.players[(game.turn + 1) % n];
  return (
    <div className="phase">
      <ul className="summary">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <div className="row-btns">
        <button ref={primaryRef} className="btn primary big" disabled={busy} onClick={() => act({ type: 'nextTurn' })}>
          {last ? 'The clock strikes midnight — see results' : `Pass to ${next.name} ▸`}
        </button>
        {game.turn === n - 1 && !last && <span className="muted small">End of round {game.round}.</span>}
      </div>
    </div>
  );
}

function FirstTurnTip({ game }: { game: GameState }) {
  const dismissed = useStore((s) => s.tipDismissed);
  if (dismissed || game.turnNumber > 1 || game.round > 1) return null;
  return (
    <div className="tip" role="note">
      <h3>Welcome to the mansion</h3>
      <p>
        Roll two dice: <b>one moves you, the other moves the ghost</b>. Grab candy from rooms and bring it back here to the
        Entrance Hall to <b>bank</b> it. The ghost hunts whoever is <b>carrying</b> the most — a catch costs half your sack.
        Ten rounds, then midnight.
      </p>
      <button className="btn" onClick={() => setState({ tipDismissed: true })}>
        Got it
      </button>
    </div>
  );
}

function MidnightBanner() {
  const banner = useStore((s) => s.banner);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!banner) return;
    setVisible(banner.id);
    const t = window.setTimeout(() => setVisible(null), 5200);
    return () => clearTimeout(t);
  }, [banner]);
  if (!banner || visible !== banner.id) return null;
  return (
    <div className="banner" role="status" onClick={() => setVisible(null)}>
      <span className="bell">🔔</span> {banner.text}
      <small>Rounds 8, 9 and 10 remain.</small>
    </div>
  );
}

function Results({ game }: { game: GameState }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const r = panel.current?.getBoundingClientRect();
      if (!r) return;
      const docked = r.left > window.innerWidth * 0.35;
      Object.assign(hudInsets, docked ? { top: 0, left: 0, bottom: 0, right: window.innerWidth - r.left + 8 } : { top: 0, left: 0, right: 0, bottom: window.innerHeight - r.top + 8 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const scores = finalScores(game);
  const winners = scores.filter((s) => s.winner).map((s) => game.players[s.player].name);
  const mansion = useStore((s) => s.personalization.mansionName);
  return (
    <div className="results-wrap">
      <div className="results" role="dialog" aria-label="Final scores" ref={panel}>
        <p className="kicker">Midnight at {mansion}</p>
        <h1>{winners.length === 1 ? `${winners[0]} wins!` : `${winners.join(' & ')} share the victory!`}</h1>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Banked</th>
              <th>Carried ÷ 2</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => {
              const p = game.players[s.player];
              return (
                <tr key={p.id} className={s.winner ? 'win' : ''}>
                  <td>{s.rank}</td>
                  <td>
                    <PlayerBadge n={s.player + 1} color={colorOf(p.character)} size={22} /> {p.name} <span className="muted">({charName(p.character)})</span>
                  </td>
                  <td>{s.banked}</td>
                  <td>
                    ⌊{s.carried} ÷ 2⌋ = {s.carriedHalf}
                  </td>
                  <td>
                    <b>{s.total}</b>
                    <span className="calc">
                      {' '}
                      = {s.banked} + {s.carriedHalf}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row-btns">
          <button className="btn primary big" onClick={playAgain}>
            Play again (same players)
          </button>
          <button className="btn" onClick={goToSetup}>
            New game
          </button>
          <button className="btn ghost" onClick={() => setState({ modal: 'confirmUndo' })}>
            Undo last turn
          </button>
        </div>
      </div>
    </div>
  );
}
