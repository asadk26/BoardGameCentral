import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, ENTRANCE, EVENT_INFO, ROUNDS, SCORING, cardType } from '../engine/config';
import {
  canPlaceDecoy,
  currentGhostPlan,
  finalScores,
  ghostAllowance,
  ghostTarget,
  isProtected,
  legalRoutes,
  movementAllowance,
  previewMove,
  survivalBonusQualifies,
  undoInfo,
} from '../engine/engine';
import { ghostDistance } from '../engine/graph';
import type { GameState } from '../engine/types';
import { director } from '../director';
import { act, goToSetup, isBotSeat, playAgain, setState, toggleCamera, useStore } from '../store';
import { cardFlavor, encounterWarning, ghostSummary, logLine, nodeName, outcomeLines, placeName, previewSummary } from '../text';
import { hudInsets, overlay } from '../scene/shared';
import { CandyIcon, PlayerBadge } from './Dialog';
import { Die } from './Dice';
import { PlacementScreen } from './Placement';
import { ChallengeStage } from './Challenges';

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
      {game.phase === 'challenge' && game.challenge && <ChallengeStage game={game} />}
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
  const me = game.players[game.turn];
  const canUndo = playMode === 'local' && undo.available;
  return (
    <div className="topbar" ref={innerRef}>
      <div className="where">
        <span className="mansion">{mansion}</span>
        <span className="round">
          Round {game.round} / {ROUNDS} • Player {game.turn + 1} / {game.players.length}
        </span>
        {game.midnight && <span className="midnight-tag">{ROUNDS - game.round + 1 === 1 ? 'Final round!' : `${ROUNDS - game.round + 1} rounds to midnight`} • duels: one survivor</span>}
        <span className="now">
          <PlayerBadge n={game.turn + 1} color={colorOf(me.character)} size={22} /> {me.name}’s {me.alive ? 'turn' : 'ghost turn'}
        </span>
      </div>
      <div className="tools">
        <button className="btn tool view-toggle" onClick={toggleCamera} aria-pressed={mode === 'overview'} title="Keyboard: V">
          {mode === 'overview' ? 'Follow player' : 'View board'} <kbd>V</kbd>
        </button>
        {playMode === 'local' && (
          <button
            className="btn tool"
            disabled={!canUndo}
            onClick={() => setState({ modal: 'confirmUndo' })}
            title={canUndo ? `Restore the start of ${undo.playerName}’s turn (round ${undo.round})` : 'Nothing to undo yet'}
          >
            Undo{canUndo ? ` ${undo.playerName}’s turn` : ''}
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

export function PlayerStatus({ game, i }: { game: GameState; i: number }) {
  const p = game.players[i];
  if (!p.alive)
    return (
      <span className="status ghosted" title="A ghost: hunts the living; keeps banked candy; earns bounties">
        👻 ghost • bounty {p.bounty}/{SCORING.bountyCap}
      </span>
    );
  return (
    <>
      {isProtected(game, i) && (
        <span className="status protected" title="Survived a challenge: safe from hostile encounters until the end of their next turn">
          🛡 protected
        </span>
      )}
      <span className={`status bonus ${survivalBonusQualifies(p) ? 'ok' : ''}`} title={`Finish alive with ${SCORING.survivalBonusMinBanked}+ banked for +${SCORING.survivalBonus}`}>
        {survivalBonusQualifies(p) ? `+${SCORING.survivalBonus} if alive ✓` : `+${SCORING.survivalBonus} at ${SCORING.survivalBonusMinBanked} banked`}
      </span>
    </>
  );
}

function PlayersPanel({ game, innerRef }: { game: GameState; innerRef: React.RefObject<HTMLDivElement | null> }) {
  const pz = useStore((s) => s.personalization);
  const seats = useStore((s) => s.seats);
  const target = useMemo(() => ghostTarget(game), [game]);
  return (
    <div className="players" ref={innerRef} aria-label="Players">
      {game.players.map((p, i) => {
        const hunted = target?.kind === 'player' && target.player === i;
        return (
          <div key={p.id} className={`pcard ${i === game.turn ? 'active' : ''} ${p.alive ? '' : 'dead'}`} style={{ ['--pc' as string]: colorOf(p.character) }}>
            <div className="pline">
              <PlayerBadge n={i + 1} color={colorOf(p.character)} />
              <span className="pname">{p.name}</span>
              <span className="pchar">
                {seats[i]?.kind === 'bot' ? '🤖 ' : ''}
                {p.alive ? charName(p.character) : `Spectral ${charName(p.character)}`}
              </span>
            </div>
            <div className="pstats">
              <span title="Banked candy — safe forever">
                <b>{p.banked}</b> banked
              </span>
              {p.alive && (
                <span title="Carried candy — dropped if you die" className={p.carried ? 'carry' : ''}>
                  <CandyIcon size={14} /> <b>{p.carried}</b> carried
                </span>
              )}
              {p.alive && (
                <span className={`decoy ${p.decoyUsed ? 'used' : ''}`} title={p.decoyUsed ? 'Decoy spent' : 'Decoy available'}>
                  {p.decoyUsed ? 'decoy spent' : 'decoy ready'}
                </span>
              )}
            </div>
            <div className="pstats">
              <PlayerStatus game={game} i={i} />
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
  const dist = me.node === ENTRANCE || !me.alive ? null : ghostDistance(game.ghost, me.node);
  const targetText = !target ? 'waiting' : target.kind === 'decoy' ? 'chasing the decoy' : `hunting ${game.players[target.player!].name}`;
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
        {dist === null ? (me.alive ? 'can’t reach the hall' : `${me.name} is a ghost`) : `${dist} ${dist === 1 ? 'space' : 'spaces'} from ${me.name}`}
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
  const mode = useStore((s) => s.mode);
  const me = game.players[game.turn];
  const color = colorOf(me.character);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const bot = isBotSeat(game.turn);
  const phaseKey = `${game.turnNumber}:${game.phase}:${busy}`;
  useEffect(() => {
    // Hand keyboard focus to the main action whenever the phase changes.
    const active = document.activeElement;
    if (!active || active === document.body || active.closest('.bottom')) primaryRef.current?.focus({ preventScroll: true });
  }, [phaseKey]);

  const watching = bot || mode === 'room';
  return (
    <section className="action" style={{ ['--pc' as string]: color }} aria-live="polite">
      <header className="action-head">
        <PlayerBadge n={game.turn + 1} color={color} size={30} />
        <div>
          <h2>
            {me.name} <span className="muted">the {me.alive ? '' : 'spectral '}{charName(me.character)}</span>
          </h2>
          <p className="sub">
            {me.alive
              ? `${me.node === ENTRANCE ? 'In the Entrance Hall (safe)' : `At ${placeName(me.node, pz)}`} • carrying ${me.carried} • banked ${me.banked}`
              : `A ghost at ${placeName(me.node, pz)} • banked ${me.banked} • bounty ${me.bounty}/${SCORING.bountyCap}`}
          </p>
        </div>
        {busy && (
          <button className="btn skip" onClick={() => director.skip()}>
            Skip animation ⏭
          </button>
        )}
      </header>
      {!me.alive && game.phase === 'turnStart' && <GhostObjective />}
      {watching && game.phase !== 'summary' && game.phase !== 'challenge' ? (
        <WatchPanel game={game} bot={bot} />
      ) : (
        <>
          {game.phase === 'turnStart' && <TurnStart game={game} primaryRef={primaryRef} />}
          {game.phase === 'choose' && (me.alive ? <Choose game={game} primaryRef={primaryRef} /> : <GhostChoose game={game} primaryRef={primaryRef} />)}
          {game.phase === 'pick' && <PickPanel game={game} primaryRef={primaryRef} />}
          {(game.phase === 'event' || game.phase === 'ghost') && <EventAndGhost game={game} primaryRef={primaryRef} />}
          {game.phase === 'challenge' && <p className="prompt">Survival challenge in progress…</p>}
          {game.phase === 'summary' && <Summary game={game} primaryRef={primaryRef} readOnly={watching} />}
        </>
      )}
    </section>
  );
}

function GhostObjective() {
  return (
    <div className="objective" role="note">
      <b>New objective — haunt the living.</b> Roll one die and move up to that many spaces (through walls on the two dotted
      ghost links, never into the Entrance Hall). End on a living player to make them break the curse. Each player you turn
      into a ghost earns {SCORING.bountyPerKill} bounty, up to {SCORING.bountyCap}. Your banked candy still counts.
    </div>
  );
}

/** What a bot or a phone is doing, for everyone watching the TV. */
function WatchPanel({ game, bot }: { game: GameState; bot: boolean }) {
  const pz = useStore((s) => s.personalization);
  const me = game.players[game.turn];
  const sel = game.selection.dest;
  const pv = game.phase === 'choose' && sel !== null ? previewMove(game, game.selection.moveDie, sel) : null;
  const plan = game.phase === 'ghost' ? currentGhostPlan(game) : null;
  const who = bot ? `🤖 ${me.name} is thinking…` : `Waiting for ${me.name}’s phone…`;
  return (
    <div className="phase">
      {game.dice && game.dice.length === 2 && <DicePair game={game} readOnly />}
      <p className="prompt">{who}</p>
      {pv && <p className="you">➜ {previewSummary(pv, game, pz)}</p>}
      {game.event && <EventCardView game={game} />}
      {plan && <p className="ghostline big">👻 {ghostSummary(plan, game, pz)}</p>}
    </div>
  );
}

type PR = { game: GameState; primaryRef: React.RefObject<HTMLButtonElement | null> };

function TurnStart({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const me = game.players[game.turn];
  const [confirmDecoy, setConfirmDecoy] = useState(false);
  const canDecoy = canPlaceDecoy(game);
  useEffect(() => setConfirmDecoy(false), [game.turnNumber]);
  if (!me.alive) {
    return (
      <div className="phase">
        <div className="row-btns">
          <button ref={primaryRef} className="btn primary big ghost-btn" disabled={busy} onClick={() => act({ type: 'roll' })}>
            Roll the ghost die 🎲
          </button>
        </div>
      </div>
    );
  }
  const decoyReason = me.decoyUsed ? 'Decoy already used this game.' : me.node === ENTRANCE ? 'You can’t leave a decoy in the Entrance Hall.' : game.decoy !== null ? 'Decoy placed.' : '';
  return (
    <div className="phase">
      <p className="prompt">
        Roll the dice. One die will move you, the other moves the resident ghost.
        {game.decoy !== null && ' Your decoy is out — the ghost will chase it this turn.'}
      </p>
      {confirmDecoy ? (
        <div className="decoy-confirm" role="group" aria-label="Confirm decoy">
          <p>
            <strong>Leave your decoy here?</strong> This turn the resident ghost heads for the wrapped sweet on your space
            instead of anyone’s candy. It still challenges the first unprotected living player on its route — including you if
            you stay. One per game; it vanishes after the ghost moves.
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

function DicePair({ game, readOnly = false }: { game: GameState; readOnly?: boolean }) {
  const rollId = useStore((s) => s.rollId);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const pz = useStore((s) => s.personalization);
  const dice = game.dice!;
  const same = dice[0] === dice[1];
  const moveDie = game.selection.moveDie;
  const choosing = game.phase === 'choose' && !readOnly;
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
  const warn = preview ? encounterWarning(preview.encounter, game, preview.waivesProtection) : null;
  return (
    <div className="phase choose">
      <DicePair game={game} />
      <p className="prompt">
        Move up to {allowance} {allowance === 1 ? 'space' : 'spaces'}: pick a glowing space on the board or below — or stay put.
        {routes.length === 0 && ' No space is reachable, so you can only stay.'}
      </p>
      <p className="muted small reminder">☠ Unknown corridors may hide a Reaper. Passing through is always safe; only where you stop counts.</p>
      <div className="dest-list" role="listbox" aria-label="Destinations">
        <button role="option" aria-selected={sel === 'stay'} className={`dest ${sel === 'stay' ? 'on' : ''}`} onClick={() => act({ type: 'select', dest: 'stay' })}>
          Stay put
        </button>
        {routes.map((r) => {
          const pv = previewMove(game, game.selection.moveDie, r.dest)!;
          const gain = pv.harvest + pv.pile;
          const danger = pv.encounter.kind !== 'none';
          return (
            <button
              key={r.dest}
              role="option"
              aria-selected={sel === r.dest}
              className={`dest ${sel === r.dest ? 'on' : ''} ${danger ? 'danger' : ''}`}
              onClick={() => act({ type: 'select', dest: r.dest })}
              onMouseEnter={() => setState({ hoverNode: r.dest })}
              onMouseLeave={() => setState({ hoverNode: null })}
            >
              <span className="dname">
                {danger ? '⚠ ' : ''}
                {nodeName(r.dest, pz)}
              </span>
              <span className="dmeta">
                #{r.dest} · {r.path.length - 1} step{r.path.length === 2 ? '' : 's'}
                {r.usesSecret ? ' · passage' : ''}
                {gain ? ` · +${gain}` : ''}
                {pv.bank ? ` · bank ${pv.bank}` : ''}
                {pv.triggersEvent ? ' · card' : ''}
                {pv.encounter.kind === 'duel' ? (pv.encounter.lethal ? ' · lethal duel' : ' · duel') : ''}
                {pv.encounter.kind === 'reaper' ? ' · Reaper' : ''}
                {pv.encounter.kind === 'superReaper' ? ' · Super Reaper' : ''}
              </span>
            </button>
          );
        })}
      </div>
      {preview && (
        <div className="forecast">
          {warn && <p className="warn">⚠ {warn}. You could become a ghost.</p>}
          <p className="you">➜ {previewSummary(preview, game, pz)}</p>
          {preview.ghost && (
            <p className="ghostline">
              👻 {ghostSummary(preview.ghost, game, pz)}
              {preview.provisional && <em className="prov"> — forecast only: {preview.triggersEvent ? 'the card' : 'your encounter'} may change this</em>}
            </p>
          )}
        </div>
      )}
      <div className="row-btns">
        <button ref={primaryRef} className={`btn primary big ${warn ? 'risky' : ''}`} disabled={sel === null || busy} onClick={() => act({ type: 'confirmMove' })}>
          {sel === null ? 'Choose where to go' : sel === 'stay' ? 'Confirm: stay put' : `${warn ? 'Risk it: ' : 'Confirm move to '}${nodeName(sel, pz)}`}
        </button>
        <span className="muted small">Ghost moves up to {ghostAllowance(game)} after you.</span>
      </div>
    </div>
  );
}

function GhostChoose({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const rollId = useStore((s) => s.rollId);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const routes = useMemo(() => [...legalRoutes(game).values()].sort((a, b) => a.path.length - b.path.length || a.dest - b.dest), [game]);
  const sel = game.selection.dest;
  const preview = sel !== null ? previewMove(game, 0, sel) : null;
  return (
    <div className="phase choose">
      <div className="dice-pair">
        <div className="die-btn ghost">
          <Die value={game.dice![0]} rollId={rollId} index={0} reduced={reduced} />
          <span className="die-label">
            Your ghost moves up to <b>{game.dice![0]}</b>
          </span>
        </div>
      </div>
      <p className="muted small">No resident-ghost move on a ghost turn — it only moves on living players’ turns.</p>
      <div className="dest-list" role="listbox" aria-label="Destinations">
        <button role="option" aria-selected={sel === 'stay'} className={`dest ${sel === 'stay' ? 'on' : ''}`} onClick={() => act({ type: 'select', dest: 'stay' })}>
          Stay put
        </button>
        {routes.map((r) => {
          const pv = previewMove(game, 0, r.dest)!;
          return (
            <button key={r.dest} role="option" aria-selected={sel === r.dest} className={`dest ${sel === r.dest ? 'on' : ''} ${pv.encounter.kind === 'haunt' ? 'haunt' : ''}`} onClick={() => act({ type: 'select', dest: r.dest })}>
              <span className="dname">
                {pv.encounter.kind === 'haunt' ? '👻 ' : ''}
                {nodeName(r.dest, pz)}
              </span>
              <span className="dmeta">
                #{r.dest} · {r.path.length - 1} step{r.path.length === 2 ? '' : 's'}
                {pv.encounter.kind === 'haunt' ? ` · haunt ${pv.encounter.targets.map((t) => game.players[t].name).join('/')}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      {preview && preview.encounter.kind === 'haunt' && <p className="warn">👻 {encounterWarning(preview.encounter, game, false)}.</p>}
      <div className="row-btns">
        <button ref={primaryRef} className="btn primary big ghost-btn" disabled={sel === null || busy} onClick={() => act({ type: 'confirmMove' })}>
          {sel === null ? 'Choose where to drift' : sel === 'stay' ? 'Confirm: stay put' : `Drift to ${nodeName(sel, pz)}`}
        </button>
      </div>
    </div>
  );
}

function PickPanel({ game, primaryRef }: PR) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const pk = game.pick!;
  const title = pk.kind === 'summon' ? 'The Super Reaper demands an opponent' : pk.kind === 'duel' ? 'Choose who to duel' : 'Choose who to haunt';
  const sub =
    pk.kind === 'summon'
      ? 'You and your pick jump the same rope — exactly one of you survives. They stay where they are on the board.'
      : pk.kind === 'duel'
        ? 'Haunted Jump Rope against one player on this space.'
        : 'They must break the curse or become a ghost.';
  return (
    <div className="phase">
      <p className="prompt">
        <b>{title}.</b> {sub}
      </p>
      <div className="choices">
        {pk.options.map((o, k) => {
          const p = game.players[o];
          return (
            <button key={o} ref={k === 0 ? primaryRef : undefined} className="btn" disabled={busy} onClick={() => act({ type: 'pickOpponent', option: o })}>
              <PlayerBadge n={o + 1} color={colorOf(p.character)} size={20} /> {p.name} • carrying {p.carried} • {placeName(p.node, pz)}
            </button>
          );
        })}
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
  const lines = game.log
    .filter((e) => ['move', 'stay', 'harvest', 'pile', 'bank', 'trapRevealed', 'spared', 'outcome'].includes(e.kind))
    .map((e) => logLine(e, game, pz))
    .filter(Boolean);
  const me = game.players[game.turn];
  return (
    <div className="phase">
      {game.dice && game.dice.length === 2 && <DicePair game={game} />}
      {lines.length > 0 && <p className="muted small">{lines.join(' ')}</p>}
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
          {!me.alive && <p className="muted small">{me.name} became a ghost this turn, but the ghost die they assigned still moves {pz.ghostName}.</p>}
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

function Summary({ game, primaryRef, readOnly }: PR & { readOnly: boolean }) {
  const busy = useStore((s) => s.busy);
  const pz = useStore((s) => s.personalization);
  const lines = game.log.filter((e) => e.kind !== 'outcome').map((e) => logLine(e, game, pz)).filter(Boolean) as string[];
  const outcome = game.lastOutcome ? outcomeLines(game.lastOutcome, game, pz) : [];
  const n = game.players.length;
  const last = game.turn === n - 1 && game.round === ROUNDS;
  const next = game.players[(game.turn + 1) % n];
  const newGhosts = game.lastOutcome?.deaths ?? [];
  return (
    <div className="phase">
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
      {newGhosts.length > 0 && (
        <div className="objective" role="note">
          <b>{newGhosts.map((d) => game.players[d.player].name).join(' & ')} now {newGhosts.length > 1 ? 'haunt' : 'haunts'} the mansion.</b> From their next turn: one
          die, move through walls, end on the living to challenge them. {SCORING.bountyPerKill} bounty per player they turn, up to{' '}
          {SCORING.bountyCap}. Banked candy is kept.
        </div>
      )}
      {!readOnly && (
        <div className="row-btns">
          <button ref={primaryRef} className="btn primary big" disabled={busy} onClick={() => act({ type: 'nextTurn' })}>
            {last ? 'The clock strikes midnight — see results' : `Pass to ${next.name} ▸`}
          </button>
          {game.turn === n - 1 && !last && <span className="muted small">End of round {game.round}.</span>}
        </div>
      )}
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
        Roll two dice: <b>one moves you, the other moves the ghost</b>. Grab candy and bring it back to the Entrance Hall to{' '}
        <b>bank</b> it. The ghost hunts whoever <b>carries</b> the most. Get caught and you must win a quick survival game —
        fail and you become a ghost who hunts the living. Six hidden Reapers lurk in the corridors.
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
    const t = window.setTimeout(() => setVisible(null), 6500);
    return () => clearTimeout(t);
  }, [banner]);
  if (!banner || visible !== banner.id) return null;
  return (
    <div className="banner" role="status" onClick={() => setVisible(null)}>
      <span className="bell">🔔</span> {banner.text}
      {banner.sub && <small className="banner-sub">{banner.sub}</small>}
      <small>Rounds 8, 9 and 10 remain.</small>
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
  const winners = scores.filter((s) => s.winner).map((s) => game.players[s.player].name);
  const mansion = useStore((s) => s.personalization.mansionName);
  return (
    <div className="results-wrap">
      <div className="results" role="dialog" aria-label="Final scores" ref={panel}>
        <p className="kicker">{game.endReason === 'noneAlive' ? `Nobody left alive in ${mansion}` : `Midnight at ${mansion}`}</p>
        <h1>{winners.length === 1 ? `${winners[0]} wins!` : `${winners.join(' & ')} share the victory!`}</h1>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Banked</th>
              <th>Carried ÷ 2</th>
              <th>Survival</th>
              <th>Bounty</th>
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
                    <PlayerBadge n={s.player + 1} color={colorOf(p.character)} size={22} /> {p.name} <span className="muted">{s.alive ? '(alive)' : '(ghost)'}</span>
                  </td>
                  <td>{s.banked}</td>
                  <td>{s.alive ? `⌊${s.carried} ÷ 2⌋ = ${s.carriedHalf}` : '—'}</td>
                  <td>{s.alive ? (s.survivalBonus ? `+${s.survivalBonus}` : `0 (under ${SCORING.survivalBonusMinBanked})`) : '—'}</td>
                  <td>{s.alive ? '—' : `+${s.bounty}`}</td>
                  <td>
                    <b>{s.total}</b>
                    <span className="calc">= {s.alive ? `${s.banked} + ${s.carriedHalf} + ${s.survivalBonus}` : `${s.banked} + ${s.bounty}`}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {mode === 'local' && (
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
        )}
      </div>
    </div>
  );
}
