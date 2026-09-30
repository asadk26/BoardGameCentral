import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, ROUNDS } from '../engine/config';
import { actingPiece, finalScores, legalRoutes, livingPiece, previewMove, undoInfo } from '../engine/engine';
import type { GameState } from '../engine/types';
import { director } from '../director';
import { act, goToSetup, isBotSeat, playAgain, setState, toggleCamera, useStore } from '../store';
import { controllerLine, curseLine, logLine, nodeName, outcomeLines, placeName, previewSummary, rollLine, superReaperLine } from '../text';
import { hudInsets } from '../scene/shared';
import { PlayerBadge } from './Dialog';
import { Die } from './Dice';
import { PlacementScreen } from './Placement';
import { ChallengeStage } from './Challenges';
import { EncounterChoices, ItemActions, ItemBadge, RewardChoice, RewardReveal, rewardDecider } from './Items';

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;
const charName = (id: string) => CHARACTERS.find((c) => c.id === id)!.name;

export function Hud() {
  const game = useStore((s) => s.session?.game);
  const placement = useStore((s) => s.placement);
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
        <p>
          The traps are set. Now every piece rolls one die: the <b>highest roll starts alive</b> in the Entrance Hall, and everyone else
          starts as a ghost on the far side of the mansion. Tied leaders roll again.
        </p>
        <ul className="lr-pieces">
          {game.pieces.map((p, i) => (
            <li key={p.id}>
              <PlayerBadge n={i + 1} color={colorOf(p.character)} size={22} /> {p.name} <span className="muted">· {charName(p.character)}</span>
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
  const mansion = useStore((s) => s.personalization.mansionName);
  const undo = undoInfo(session);
  const actingIdx = actingPiece(game);
  const me = game.pieces[actingIdx];
  const canUndo = playMode === 'local' && undo.available;
  return (
    <div className="topbar" ref={innerRef}>
      <div className="where">
        <span className="mansion">{mansion}</span>
        <span className="round">
          Round {game.round} / {ROUNDS}
          {game.round === ROUNDS ? ' • final round' : ''}
        </span>
        <span className="now">
          <PlayerBadge n={actingIdx + 1} color={colorOf(me.character)} size={22} /> {me.name} {me.alive ? '(alive)' : '(ghost)'}
          {controllerLine(game, actingIdx) ? ` • ${controllerLine(game, actingIdx)}` : ''}
        </span>
        <span className="order" aria-label="Action order this round">
          {game.schedule.map((p, k) => (
            <span key={p} className={`ord ${k < game.slot ? 'done' : k === game.slot ? 'now' : ''}`} title={k < game.slot ? 'Has acted' : k === game.slot ? 'Acting now' : 'Still to act'}>
              <PlayerBadge n={p + 1} color={colorOf(game.pieces[p].character)} size={18} />
              {k < game.schedule.length - 1 && <span className="arrow">›</span>}
            </span>
          ))}
        </span>
      </div>
      <div className="tools">
        <button className="btn tool view-toggle" onClick={toggleCamera} aria-pressed={mode === 'overview'} title="Keyboard: V">
          {mode === 'overview' ? 'Follow piece' : 'View board'} <kbd>V</kbd>
        </button>
        {playMode === 'local' && (
          <button
            className="btn tool"
            disabled={!canUndo}
            onClick={() => setState({ modal: 'confirmUndo' })}
            title={canUndo ? `Restore the start of ${undo.pieceName}’s action (round ${undo.round})` : 'Nothing to undo yet'}
          >
            Undo{canUndo ? ` ${undo.pieceName}’s action` : ''}
          </button>
        )}
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
          {playMode === 'room' ? 'Phone room' : saveError ? 'Could not save on this device' : 'Saved on this device'}
        </span>
      </div>
    </div>
  );
}

export function PieceStatus({ game, i }: { game: GameState; i: number }) {
  const p = game.pieces[i];
  if (!p.alive) return <span className="status ghosted">👻 ghost — steal the life</span>;
  const curse = curseLine(p.streak);
  return (
    <>
      <span className="status alive">❤ holds the life</span>
      {curse && <span className="status curse">{curse}</span>}
    </>
  );
}

function PiecesPanel({ game, innerRef }: { game: GameState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const pz = useStore((s) => s.personalization);
  const seats = useStore((s) => s.seats);
  const acting = actingPiece(game);
  return (
    <div className="players" ref={innerRef} aria-label="Pieces">
      {game.pieces.map((p, i) => {
        const pos = game.schedule.indexOf(i);
        return (
          <div key={p.id} className={`pcard ${i === acting ? 'active' : ''} ${p.alive ? 'living' : 'dead'}`} style={{ ['--pc' as string]: colorOf(p.character) }}>
            <div className="pline">
              <PlayerBadge n={i + 1} color={colorOf(p.character)} />
              <span className="pname">{p.name}</span>
              <span className="pchar">
                {seats[i]?.kind === 'bot' ? '🤖 ' : ''}
                {p.alive ? charName(p.character) : `Spectral ${charName(p.character)}`}
              </span>
            </div>
            <div className="pstats">
              <span title="One point for each round ended holding the life">
                <b>{p.score}</b> point{p.score === 1 ? '' : 's'}
              </span>
              <span className="muted">{pos < game.slot ? 'acted' : pos === game.slot ? 'acting' : `acts ${pos + 1}${['st', 'nd', 'rd'][pos] ?? 'th'}`}</span>
            </div>
            <div className="pstats">
              <PieceStatus game={game} i={i} />
            </div>
            {p.item && (
              <div className="ploc">
                <ItemBadge item={p.item} />
              </div>
            )}
            {controllerLine(game, i) && <div className="ploc">{controllerLine(game, i)}</div>}
            <div className="ploc">{placeName(p.node, pz)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── the action panel, one layout per phase ──────────────────────────────

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
  const phaseKey = `${game.actionNumber}:${game.phase}:${busy}`;
  useEffect(() => {
    // Hand keyboard focus to the main action whenever the phase changes.
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('.bottom')) primaryRef.current?.focus({ preventScroll: true });
  }, [phaseKey]);

  const watching = bot || mode === 'room';
  const living = game.pieces[livingPiece(game)];
  return (
    <section className={`action ${me.alive ? 'is-living' : 'is-ghost'}`} style={{ ['--pc' as string]: color }} aria-live="polite">
      <header className="action-head">
        <PlayerBadge n={actingIdx + 1} color={color} size={30} />
        <div>
          <h2>
            {me.name} <span className="muted">the {me.alive ? '' : 'spectral '}{charName(me.character)}</span>
          </h2>
          <p className="sub">
            {me.alive ? `Holds the life at ${placeName(me.node, pz)}` : `A ghost at ${placeName(me.node, pz)} • ${living.name} holds the life at ${placeName(living.node, pz)}`}
            {controllerLine(game, actingIdx) ? ` • ${controllerLine(game, actingIdx)}` : ''}
          </p>
        </div>
        {busy && (
          <button className="btn skip" onClick={() => director.skip()}>
            Skip animation ⏭
          </button>
        )}
      </header>
      {watching && game.phase !== 'summary' && game.phase !== 'challenge' ? (
        <WatchPanel game={game} bot={bot} />
      ) : (
        <>
          {game.phase === 'turnStart' && <TurnStart game={game} primaryRef={primaryRef} />}
          {game.phase === 'choose' && <Choose game={game} primaryRef={primaryRef} />}
          {game.phase === 'pick' && <PickPanel game={game} primaryRef={primaryRef} />}
          {game.phase === 'hunt' && <EncounterChoices game={game} send={act} btn="btn" disabled={busy} primaryRef={primaryRef} pz={pz} />}
          {game.phase === 'reward' && <RewardChoice game={game} send={act} btn="btn" canChoose disabled={busy} primaryRef={primaryRef} />}
          {game.phase === 'challenge' && <p className="prompt">Haunted Jump Rope in progress…</p>}
          {game.phase === 'summary' && <Summary game={game} primaryRef={primaryRef} readOnly={watching} />}
        </>
      )}
    </section>
  );
}

/** What a bot or a phone is doing, for everyone watching the TV. */
function WatchPanel({ game, bot }: { game: GameState; bot: boolean }) {
  const pz = useStore((s) => s.personalization);
  const d = rewardDecider(game);
  const me = game.pieces[d];
  const sel = game.selection.dest;
  const pv = game.phase === 'choose' && sel !== null ? previewMove(game, sel) : null;
  const who = bot ? `🤖 ${me.name} is thinking…` : `Waiting for ${me.name}’s phone${controllerLine(game, d) ? ` (${controllerLine(game, d)})` : ''}…`;
  const o = game.options;
  return (
    <div className="phase">
      {(game.die !== null || game.rollInfo?.kind === 'stride') && <DieBox game={game} />}
      <p className="prompt">{who}</p>
      {me.item && game.phase !== 'reward' && (
        <p className="muted small">
          Holding <ItemBadge item={me.item} />
        </p>
      )}
      {game.phase === 'hunt' && o && (
        <p className="warn">
          {[
            o.living ? `❤ may challenge ${game.pieces[livingPiece(game)].name} for the life` : null,
            o.sameSpace.length || o.versus.length ? '⚔ may battle a ghost for an item' : null,
          ]
            .filter(Boolean)
            .join(' • ')}{' '}
          — or end the action.
        </p>
      )}
      {game.phase === 'reward' && <RewardChoice game={game} send={() => {}} btn="btn" canChoose={false} />}
      {game.phase === 'pick' && <p className="warn">☠ Reaper’s Challenge: choosing a ghost to duel…</p>}
      {pv && <p className="you">➜ {previewSummary(pv, game, pz)}</p>}
    </div>
  );
}

type PR = { game: GameState; primaryRef: React.RefObject<HTMLButtonElement | null> };

function LifeRollResult({ game }: { game: GameState }) {
  const e = game.log.find((x) => x.kind === 'lifeRoll');
  if (!e || e.kind !== 'lifeRoll') return null;
  return (
    <div className="objective" role="note">
      <b>Life roll:</b>{' '}
      {e.rolls.map((row, k) => (
        <span key={k}>
          {k > 0 ? ' · reroll: ' : ''}
          {row
            .map((v, i) => (v === null ? null : `${game.pieces[i].name} ${v}`))
            .filter(Boolean)
            .join(', ')}
        </span>
      ))}
      . <b>{game.pieces[e.winner].name}</b> starts alive.
    </div>
  );
}

function TurnStart({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const me = game.pieces[actingPiece(game)];
  const curse = me.alive ? curseLine(me.streak) : null;
  return (
    <div className="phase">
      {game.round === 1 && game.slot === 0 && <LifeRollResult game={game} />}
      <p className="prompt">
        {me.alive
          ? 'You hold the life. Roll one die and move up to that many spaces — or stay. Ghosts act after you this round; end somewhere they will struggle to reach.'
          : 'Roll one die: a ghost always drifts at least 3 spaces, and may pass through the two dotted wall links. End on the living piece’s space or right next to it to challenge for the life.'}
      </p>
      {curse && <p className="muted small">{curse}</p>}
      <ItemActions game={game} send={act} btn="btn" disabled={busy} pz={pz} />
      <div className="row-btns">
        <button ref={primaryRef} className={`btn primary big ${me.alive ? '' : 'ghost-btn'}`} disabled={busy} onClick={() => act({ type: 'roll' })}>
          Roll the die 🎲
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

function Choose({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const routes = useMemo(() => [...legalRoutes(game).values()].sort((a, b) => a.path.length - b.path.length || a.dest - b.dest), [game]);
  const sel = game.selection.dest;
  const preview = sel !== null ? previewMove(game, sel) : null;
  const me = game.pieces[actingPiece(game)];
  const minigame = preview && (preview.known === 'reaper' || preview.known === 'seance');
  return (
    <div className="phase choose">
      <DieBox game={game} />
      <ItemActions game={game} send={act} btn="btn" disabled={busy} pz={pz} />
      <p className="prompt">
        Pick a glowing space on the board or below — or stay.
        {routes.length === 0 && ' No space is reachable, so you can only stay.'}
      </p>
      <p className="muted small reminder">
        ☠ Six hidden traps lie in the corridors. Passing through is safe; only where a move ends counts. {superReaperLine(game)}.
      </p>
      <div className="dest-list" role="listbox" aria-label="Destinations">
        <button role="option" aria-selected={sel === 'stay'} className={`dest ${sel === 'stay' ? 'on' : ''}`} onClick={() => act({ type: 'select', dest: 'stay' })}>
          Stay here
        </button>
        {routes.map((r) => {
          const pv = previewMove(game, r.dest)!;
          const hot = pv.known === 'reaper' || pv.known === 'seance' || !!pv.superReaper;
          return (
            <button
              key={r.dest}
              role="option"
              aria-selected={sel === r.dest}
              className={`dest ${sel === r.dest ? 'on' : ''} ${hot ? 'danger' : ''} ${pv.canChallenge ? 'haunt' : ''}`}
              onClick={() => act({ type: 'select', dest: r.dest })}
              onMouseEnter={() => setState({ hoverNode: r.dest })}
              onMouseLeave={() => setState({ hoverNode: null })}
            >
              <span className="dname">
                {pv.canChallenge ? '👻 ' : hot ? '☠ ' : ''}
                {nodeName(r.dest, pz)}
              </span>
              <span className="dmeta">
                #{r.dest} · {r.path.length - 1} step{r.path.length === 2 ? '' : 's'}
                {r.usesSecret ? ' · passage' : ''}
                {r.usesWall ? ' · wall' : ''}
                {pv.superReaper ? (pv.superReaper === 'seance' ? ' · Séance' : ' · Reaper') : pv.known === 'reaper' ? ' · Reaper' : pv.known === 'seance' ? ' · Séance' : pv.known === 'poltergeist' ? ' · Poltergeist' : ''}
                {pv.canChallenge ? ' · in range' : ''}
                {pv.battleTargets.length ? ' · ⚔ ghost here' : ''}
                {pv.versus ? ' · ⚔ Versus' : ''}
                {me.alive && pv.threats.length ? ` · near ${pv.threats.length} ghost${pv.threats.length > 1 ? 's' : ''}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      {preview && (
        <div className="forecast">
          {minigame && <p className="warn">☠ This ends your action with a Haunted Jump Rope{preview.known === 'seance' ? ' for every piece' : ''}. Whoever wins holds the life.</p>}
          <p className="you">➜ {previewSummary(preview, game, pz)}</p>
        </div>
      )}
      <div className="row-btns">
        <button ref={primaryRef} className={`btn primary big ${minigame ? 'risky' : ''} ${me.alive ? '' : 'ghost-btn'}`} disabled={sel === null || busy} onClick={() => act({ type: 'confirmMove' })}>
          {sel === null ? 'Choose where to go' : sel === 'stay' ? 'Confirm: stay here' : `${minigame ? 'Risk it: ' : 'Confirm move to '}${nodeName(sel, pz)}`}
        </button>
      </div>
    </div>
  );
}

function PickPanel({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const pk = game.pick!;
  return (
    <div className="phase">
      <p className="prompt">
        <b>Reaper’s Challenge.</b> Choose one ghost to duel for the life. Win and you keep it; lose and they take it. Nobody moves on the
        board.
      </p>
      <div className="choices">
        {pk.options.map((o, k) => {
          const p = game.pieces[o];
          return (
            <button key={o} ref={k === 0 ? primaryRef : undefined} className="btn" disabled={busy} onClick={() => act({ type: 'pickOpponent', option: o })}>
              <PlayerBadge n={o + 1} color={colorOf(p.character)} size={20} /> {p.name} • {p.score} pt{p.score === 1 ? '' : 's'} • {placeName(p.node, pz)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ game, primaryRef, readOnly }: PR & { readOnly: boolean }) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const lines = game.log.filter((e) => e.kind !== 'outcome' && e.kind !== 'lifeRoll' && e.kind !== 'spawn' && e.kind !== 'roundStart').map((e) => logLine(e, game, pz)).filter(Boolean) as string[];
  const outcome = game.lastOutcome ? outcomeLines(game.lastOutcome, game, pz) : [];
  const lastSlot = game.slot === game.schedule.length - 1;
  const next = lastSlot ? null : game.pieces[game.schedule[game.slot + 1]];
  const living = game.pieces[livingPiece(game)];
  return (
    <div className="phase">
      <RewardReveal game={game} />
      <ul className="summary">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
        {outcome.map((l, i) => (
          <li key={`o${i}`} className="outcome-line">
            {l}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="row-btns">
          <button ref={primaryRef} className="btn primary big" disabled={busy} onClick={() => act({ type: 'nextTurn' })}>
            {next ? `Next: ${next.name} ▸` : game.round === ROUNDS ? `Ring the last bell — ${living.name} scores` : `Ring the bell — ${living.name} scores round ${game.round}`}
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
      <h3>One life in the mansion</h3>
      <p>
        <b>Only one piece is alive.</b> Everyone else is a ghost trying to steal that life. Whoever holds it when a round ends scores a
        point; ten rounds, most points wins. Ghosts challenge the living piece to <b>Haunted Jump Rope</b> from its space or the next one. Six
        hidden traps and the Super Reaper can start challenges from anywhere.
      </p>
      <p>
        Ghosts may also <b>battle each other for an item</b> — by ending a move on another ghost’s space, or on a ⚔ Versus space to call out any
        ghost. Items: Second Roll, Ghost Switch, Ghostly Stride.
      </p>
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
