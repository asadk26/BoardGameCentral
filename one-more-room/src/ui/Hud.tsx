import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHARACTERS, ROUNDS } from '../engine/config';
import { actingPiece, finalScores, livingPiece, previewMove, undoInfo } from '../engine/engine';
import type { GameState } from '../engine/types';
import { director } from '../director';
import { act, goToSetup, isBotSeat, playAgain, setState, toggleCamera, useStore } from '../store';
import { controllerLine, cursePhrase, logLine, nodeName, outcomeLines, previewSummary, rollLine } from '../text';
import { curseMultiplier } from '../engine/config';
import { hudInsets } from '../scene/shared';
import { PlayerBadge } from './Dialog';
import { Die } from './Dice';
import { PlacementScreen } from './Placement';
import { ChallengeStage, ResultFlash } from './Challenges';
import { EncounterChoices, ItemActions, ItemBadge, RewardChoice, RewardReveal, rewardDecider } from './Items';
import { forkChoices, stepFor, type ForkChoice } from '../forks';

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;
const charName = (id: string) => CHARACTERS.find((c) => c.id === id)!.name;

export function Hud() {
  const game = useStore((s) => s.session?.game);
  const placement = useStore((s) => s.placement);
  const playMode = useStore((s) => s.mode);
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
  if (game.phase === 'placement' || (placement.seat !== null && placement.confirmed)) return <PlacementScreen game={game} />;
  if (game.phase === 'lifeRoll') return <LifeRoll game={game} />;
  return (
    <div className="hud">
      <TopBar game={game} innerRef={topRef} />
      <PiecesPanel game={game} innerRef={leftRef} />
      <div className="bottom" ref={bottomRef}>
        <ActionPanel game={game} />
      </div>
      <FirstTurnTip game={game} />
      <RoundBanner />
      {game.phase === 'challenge' && game.challenge && <ChallengeStage game={game} />}
      {playMode === 'room' && game.phase !== 'challenge' && game.lastOutcome && <ResultFlash key={game.lastOutcome.challengeId} outcome={game.lastOutcome} game={game} />}
    </div>
  );
}

function LifeRoll({ game }: { game: GameState }) {
  const mode = useStore((s) => s.mode);
  const seats = useStore((s) => s.seats);
  const busy = useStore((s) => s.busy);
  const humans = mode === 'local' && seats.some((x) => x.kind === 'human');
  return (
    <div className="hud">
      <div className="life-roll" role="dialog" aria-label="Roll for life">
        <h2>Who starts alive?</h2>
        <p>Highest roll starts alive ❤ · everyone else is a ghost 👻</p>
        <ul className="lr-pieces">
          {game.pieces.map((p, i) => (
            <li key={p.id}>
              <PlayerBadge n={i + 1} color={colorOf(p.character)} size={22} /> {p.name} {seats[i]?.kind === 'bot' && <span className="tag bot">BOT</span>}
            </li>
          ))}
        </ul>
        {humans ? (
          <button className="btn primary big" disabled={busy} onClick={() => act({ type: 'rollForLife' })} autoFocus>
            Roll for life 🎲
          </button>
        ) : (
          <p className="muted">Rolling…</p>
        )}
      </div>
    </div>
  );
}

function TopBar({ game, innerRef }: { game: GameState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const mode = useStore((s) => s.cameraMode);
  const session = useStore((s) => s.session)!;
  const saveError = useStore((s) => s.saveError);
  const playMode = useStore((s) => s.mode);
  const undo = undoInfo(session);
  const actingIdx = actingPiece(game);
  const me = game.pieces[actingIdx];
  const canUndo = playMode === 'local' && undo.available;
  return (
    <div className="topbar" ref={innerRef}>
      <div className="where">
        <span className="round">
          Round {game.round}/{ROUNDS}
        </span>
        <span className="now turn-banner" style={{ borderColor: colorOf(me.character) }}>
          <span aria-hidden="true">{me.alive ? '❤' : '👻'}</span> {me.name}’s turn
        </span>
        <span className="order" aria-label="Turn order this round">
          {game.schedule.map((p, k) => (
            <span key={p} className={`ord ${k < game.slot ? 'done' : k === game.slot ? 'now' : ''}`} title={game.pieces[p].name}>
              <PlayerBadge n={p + 1} color={colorOf(game.pieces[p].character)} size={18} />
            </span>
          ))}
        </span>
      </div>
      <div className="tools">
        <button className="btn tool view-toggle" onClick={toggleCamera} aria-pressed={mode === 'overview'} title="Keyboard: V">
          {mode === 'overview' ? 'Follow' : 'Whole board'} <kbd>V</kbd>
        </button>
        {canUndo && (
          <button className="btn tool" onClick={() => setState({ modal: 'confirmUndo' })} title={`Back to the start of ${undo.pieceName}’s turn`}>
            Undo
          </button>
        )}
        <button className="btn tool" onClick={() => setState({ modal: 'rules' })}>
          Help
        </button>
        <button className="btn tool" onClick={() => setState({ modal: 'menu' })}>
          Menu
        </button>
        {saveError && playMode === 'local' && (
          <span className="saved err" role="status">
            Not saved
          </span>
        )}
      </div>
    </div>
  );
}

function PiecesPanel({ game, innerRef }: { game: GameState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const seats = useStore((s) => s.seats);
  const acting = actingPiece(game);
  return (
    <div className="players" ref={innerRef} aria-label="Scores">
      {game.pieces.map((p, i) => {
        const curse = p.alive && curseMultiplier(p.streak) < 1 ? cursePhrase(curseMultiplier(p.streak)) : null;
        return (
          <div key={p.id} className={`pcard ${i === acting ? 'active' : ''} ${p.alive ? 'living' : 'dead'}`} style={{ ['--pc' as string]: colorOf(p.character) }}>
            <div className="pline">
              <PlayerBadge n={i + 1} color={colorOf(p.character)} />
              <span className="pname">{p.name}</span>
              <span className="prole" title={p.alive ? 'Holds the life' : 'Ghost'}>
                {p.alive ? '❤' : '👻'}
              </span>
              <b className="pscore" title="Points">
                {p.score}
              </b>
            </div>
            {(seats[i]?.kind === 'bot' || p.item || curse || controllerLine(game, i)) && (
              <div className="pmeta">
                {seats[i]?.kind === 'bot' && <span className="tag bot">BOT</span>}
                {p.item && <ItemBadge item={p.item} />}
                {curse && <span className="status curse">{curse}</span>}
                {controllerLine(game, i) && <span className="muted small">{controllerLine(game, i)}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── the action panel: one main action at a time ─────────────────────────

function ActionPanel({ game }: { game: GameState }) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const mode = useStore((s) => s.mode);
  const actingIdx = actingPiece(game);
  const me = game.pieces[actingIdx];
  const color = colorOf(me.character);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const decider = rewardDecider(game);
  const bot = isBotSeat(decider);
  const phaseKey = `${game.actionNumber}:${game.phase}:${busy}:${game.move?.remaining ?? ''}`;
  useEffect(() => {
    // Hand keyboard focus to the main action whenever the phase changes.
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('.bottom')) primaryRef.current?.focus({ preventScroll: true });
  }, [phaseKey]);
  const watching = bot || mode === 'room';
  return (
    <section className={`action ${me.alive ? 'is-living' : 'is-ghost'}`} style={{ ['--pc' as string]: color }} aria-live="polite">
      {busy && (
        <button className="btn skip" onClick={() => director.skip()}>
          Skip ⏭
        </button>
      )}
      {watching && game.phase !== 'summary' && game.phase !== 'challenge' ? (
        <WatchPanel game={game} bot={bot} />
      ) : (
        <>
          {game.phase === 'turnStart' && <TurnStart game={game} primaryRef={primaryRef} />}
          {game.phase === 'choose' && <Choose game={game} primaryRef={primaryRef} />}
          {game.phase === 'pick' && <PickPanel game={game} primaryRef={primaryRef} />}
          {game.phase === 'hunt' && <EncounterChoices game={game} send={act} btn="btn" disabled={busy} primaryRef={primaryRef} pz={pz} />}
          {game.phase === 'reward' && <RewardChoice game={game} send={act} btn="btn" canChoose disabled={busy} primaryRef={primaryRef} />}
          {game.phase === 'challenge' && <p className="prompt">Jump rope!</p>}
          {game.phase === 'summary' && <Summary game={game} primaryRef={primaryRef} readOnly={watching} />}
        </>
      )}
    </section>
  );
}

/** What a bot or a phone is doing, for everyone watching the TV. */
function WatchPanel({ game, bot }: { game: GameState; bot: boolean }) {
  const busy = useStore((s) => s.busy);
  const d = rewardDecider(game);
  const me = game.pieces[d];
  const who = `${bot ? '🤖 ' : ''}${me.name}`;
  let doing = `${who} is choosing…`;
  if (game.phase === 'turnStart') doing = `${who} is rolling…`;
  if (game.phase === 'choose') doing = busy ? `${who} is moving` : `${who} · choose a path`;
  if (game.phase === 'hunt') doing = `${who} · challenge?`;
  if (game.phase === 'pick') doing = `${who} · choose opponent`;
  if (game.phase === 'reward') doing = `${who} · keep or replace?`;
  return (
    <div className="phase">
      {(game.die !== null || game.rollInfo?.kind === 'stride') && game.phase === 'choose' && <DieBox game={game} />}
      <p className="prompt">{doing}</p>
      {game.phase === 'choose' && !busy && <ForkList game={game} readOnly />}
      {game.phase === 'reward' && <RewardChoice game={game} send={() => {}} btn="btn" canChoose={false} />}
    </div>
  );
}

type PR = { game: GameState; primaryRef: React.RefObject<HTMLButtonElement | null> };

function TurnStart({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const me = game.pieces[actingPiece(game)];
  return (
    <div className="phase">
      <p className="hint">{me.alive ? '❤ Stay away from the ghosts' : '👻 Land on or next to ❤ to challenge'}</p>
      <ItemActions game={game} send={act} btn="btn" disabled={busy} pz={pz} />
      <div className="row-btns">
        <button ref={primaryRef} className={`btn primary big ${me.alive ? '' : 'ghost-btn'}`} disabled={busy} onClick={() => act({ type: 'roll' })}>
          Roll 🎲
        </button>
      </div>
    </div>
  );
}

function DieBox({ game }: { game: GameState }) {
  const rollId = useStore((s) => s.rollId);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const me = game.pieces[actingPiece(game)];
  if (game.rollInfo?.kind === 'stride')
    return (
      <div className="dice-pair" role="group" aria-label="Your move">
        <div className="die-btn ghost stride">
          <span className="stride-icon" aria-hidden="true">
            👣
          </span>
          <span className="die-label">{rollLine(game)}</span>
        </div>
      </div>
    );
  return (
    <div className="dice-pair" role="group" aria-label="Your roll">
      <div className={`die-btn ${me.alive ? 'move' : 'ghost'}`}>
        <Die value={game.die!} rollId={rollId} index={0} reduced={reduced} />
        <span className="die-label">{rollLine(game)}</span>
      </div>
    </div>
  );
}

/** The ways on, as large numbered buttons (the same numbers and colours as the arrows on the board and on phones). */
function ForkList({ game, readOnly = false, primaryRef }: { game: GameState; readOnly?: boolean; primaryRef?: React.RefObject<HTMLButtonElement | null> }) {
  const pz = useStore((s) => s.personalization);
  const choices = forkChoices(game);
  const hover = (to: number | null) => setState({ hoverNode: to });
  return (
    <div className="fork-list" role="group" aria-label="Ways on">
      {choices.map((c, i) => {
        const pv = c.landings.length === 1 ? previewMove(game, c.landings[0]) : null;
        return (
          <button
            key={c.to}
            ref={i === 0 ? primaryRef : undefined}
            className="btn fork-btn"
            style={{ ['--fc' as string]: c.color }}
            disabled={readOnly}
            aria-label={`Way ${c.num}: ${c.word}${c.kind === 's' ? ', secret passage' : c.kind === 'w' ? ', through the wall' : ''}, toward ${nodeName(c.to, pz)}`}
            onClick={() => act(stepFor(game, c.to))}
            onMouseEnter={() => hover(c.to)}
            onMouseLeave={() => hover(null)}
            title={pv ? previewSummary(pv, game, pz) : `Can end on: ${c.landings.map((n) => nodeName(n, pz)).join(', ')}`}
          >
            <span className="fork-num">{c.num}</span>
            <span className="fork-arrow" style={{ transform: `rotate(${(c.rel * 180) / Math.PI}deg)` }} aria-hidden="true">
              ⬆
            </span>
            <span className="fork-word">
              {c.kind === 's' ? '✦ passage' : c.kind === 'w' ? '👻 wall' : c.word}
              <small>{nodeName(c.to, pz)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Choose({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const choices = forkChoices(game);
  // Number keys (and arrow keys) pick a way, matching the numbers on the board.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      let c: ForkChoice | undefined;
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) c = choices[n - 1];
      else if (e.key === 'ArrowLeft') c = choices.find((x) => x.word === 'Left');
      else if (e.key === 'ArrowRight') c = choices.find((x) => x.word === 'Right');
      else if (e.key === 'ArrowUp') c = choices.find((x) => x.word === 'Ahead');
      if (!c) return;
      e.preventDefault();
      act(stepFor(game, c.to));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const left = game.move?.remaining ?? 0;
  const started = (game.move?.path.length ?? 1) > 1;
  return (
    <div className="phase choose">
      {!started && <DieBox game={game} />}
      <ItemActions game={game} send={act} btn="btn" disabled={busy} pz={pz} />
      <p className="prompt big-prompt">{busy ? 'Moving…' : `${left} left · Choose a path`}</p>
      {!busy && <ForkList game={game} primaryRef={primaryRef} />}
    </div>
  );
}

function PickPanel({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pk = game.pick!;
  return (
    <div className="phase">
      <p className="prompt big-prompt">☠ Choose opponent</p>
      <div className="choices">
        {pk.options.map((o, k) => {
          const p = game.pieces[o];
          return (
            <button key={o} ref={k === 0 ? primaryRef : undefined} className="btn" disabled={busy} onClick={() => act({ type: 'pickOpponent', option: o })}>
              <PlayerBadge n={o + 1} color={colorOf(p.character)} size={20} /> {p.name} · {p.score} pt{p.score === 1 ? '' : 's'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Plain moves pass quickly; anything that happened stays up a little longer. Always skippable. */
function Summary({ game, primaryRef, readOnly }: PR & { readOnly: boolean }) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const lines = game.log.filter((e) => !['outcome', 'lifeRoll', 'spawn', 'roundStart', 'roll'].includes(e.kind)).map((e) => logLine(e, game, pz)).filter(Boolean) as string[];
  const outcome = game.lastOutcome ? outcomeLines(game.lastOutcome, game, pz).slice(-1) : [];
  const eventful = !!game.lastOutcome || game.log.some((e) => ['trapRevealed', 'poltergeist', 'itemAwarded', 'itemUsed', 'superReaper', 'seanceDormant', 'versusInactive'].includes(e.kind));
  const lastSlot = game.slot === game.schedule.length - 1;
  const next = lastSlot ? null : game.pieces[game.schedule[game.slot + 1]];
  const living = game.pieces[livingPiece(game)];
  useEffect(() => {
    if (readOnly || busy) return;
    const t = window.setTimeout(() => act({ type: 'nextTurn' }), eventful ? 3200 : 1300);
    return () => clearTimeout(t);
  }, [readOnly, busy, eventful, game.actionNumber]);
  return (
    <div className="phase">
      <RewardReveal game={game} />
      {(lines.length > 0 || outcome.length > 0) && (
        <ul className="summary">
          {lines.slice(-3).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
          {outcome.map((l, i) => (
            <li key={`o${i}`} className="outcome-line">
              {l}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="row-btns">
          <button ref={primaryRef} className="btn primary" disabled={busy} onClick={() => act({ type: 'nextTurn' })}>
            {next ? `Next: ${next.name} ▸` : `🔔 ${living.name} scores`}
          </button>
        </div>
      )}
    </div>
  );
}

function FirstTurnTip({ game }: { game: GameState }) {
  const dismissed = useStore((s) => s.tipDismissed);
  if (dismissed || game.actionNumber > 1 || game.round > 1) return null;
  return (
    <div className="tip" role="note">
      <ul className="tip-list">
        <li>❤ One piece is alive. Holding it when the bell rings = 1 point.</li>
        <li>👻 Ghosts land on or next to ❤ to challenge.</li>
        <li>🎲 Roll, then pick a path at the arrows.</li>
      </ul>
      <button className="btn" onClick={() => setState({ tipDismissed: true })}>
        Got it
      </button>
    </div>
  );
}

function RoundBanner() {
  const banner = useStore((s) => s.banner);
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!banner) return;
    setVisible(banner.id);
    const t = window.setTimeout(() => setVisible(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);
  if (!banner || visible !== banner.id) return null;
  return (
    <div className="banner" role="status" onClick={() => setVisible(null)}>
      <span className="bell">🔔</span> {banner.text}
      {banner.sub && <small className="banner-sub">{banner.sub}</small>}
    </div>
  );
}

function Results({ game }: { game: GameState }) {
  const panel = useRef<HTMLDivElement>(null);
  const mode = useStore((s) => s.mode);
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
  const winners = scores.filter((s) => s.winner).map((s) => game.pieces[s.piece].name);
  const mansion = useStore((s) => s.personalization.mansionName);
  const total = game.pieces.reduce((a, p) => a + p.score, 0);
  return (
    <div className="results-wrap">
      <div className="results" role="dialog" aria-label="Final scores" ref={panel}>
        <p className="kicker">The last bell at {mansion}</p>
        <h1>{winners.length === 1 ? `${winners[0]} wins!` : `${winners.join(' & ')} share the win!`}</h1>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Piece</th>
              <th>Rounds held</th>
              <th>At the end</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => {
              const p = game.pieces[s.piece];
              return (
                <tr key={p.id} className={s.winner ? 'win' : ''}>
                  <td>{s.rank}</td>
                  <td>
                    <PlayerBadge n={s.piece + 1} color={colorOf(p.character)} size={22} /> {p.name} <span className="muted">{charName(p.character)}</span>
                  </td>
                  <td>
                    <b>{s.score}</b>
                  </td>
                  <td>{s.alive ? '❤ alive' : '👻 ghost'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">
          {total} points for {ROUNDS} rounds: one point each time a round ended, to whoever held the life.
        </p>
        {mode === 'local' && (
          <div className="row-btns">
            <button className="btn primary big" onClick={playAgain}>
              Play again (same pieces)
            </button>
            <button className="btn" onClick={goToSetup}>
              New game
            </button>
            <button className="btn ghost" onClick={() => setState({ modal: 'confirmUndo' })}>
              Undo last action
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
