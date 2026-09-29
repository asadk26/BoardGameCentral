// Haunted Jump Rope on the shared screen. Every press is timestamped against
// the animation the player is watching (performance.now() from the same clock
// that draws it) and handed to the engine's pure judge; bots feed the same
// input format. Up to four pieces can share the keyboard, one key each.
//
// Each lane shows its own jump window — narrower for a cursed living piece —
// and a lane's tick or cross comes from the same judge that decides the game,
// so the screen never shows a clearance the judge would call a miss.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHALLENGE, CHARACTERS } from '../engine/config';
import { clearanceWindow, judgeRopeSweeps, ropeSchedule, type ChallengeInput, type SweepResult } from '../engine/challenges';
import { judgeChallenge } from '../engine/engine';
import type { Challenge, GameState } from '../engine/types';
import { act, botInputsFor, getState, isBotSeat, JUMP_KEYS, useStore } from '../store';
import { hostSend, roomClient } from '../net/host';
import { audio } from '../audio/audio';
import { challengeHost, challengeHowTo, challengeTitle, curseLine } from '../text';
import { PlayerBadge } from './Dialog';

type Inputs = Record<number, ChallengeInput[]>;
type Press = (participant: number) => void;

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;
const now = () => performance.now();

function useClock(running: boolean) {
  const [t, setT] = useState(0);
  const start = useRef(0);
  useEffect(() => {
    if (!running) return;
    start.current = now();
    let raf = 0;
    const loop = () => {
      setT(now() - start.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return t;
}

export function ChallengeStage({ game }: { game: GameState }) {
  const ch = game.challenge!;
  const mode = useStore((s) => s.mode);
  if (mode === 'room') return <SpectatorStage game={game} />;
  return <LocalChallenge key={`${ch.id}:${ch.attempt}`} game={game} ch={ch} />;
}

/** Key for each human piece: Space works when only one person is jumping. */
function keyFor(humans: number[], piece: number): { code: string; label: string } | null {
  const k = humans.indexOf(piece);
  if (k < 0) return null;
  return JUMP_KEYS[k];
}

function LocalChallenge({ game, ch }: { game: GameState; ch: Challenge }) {
  const fastBots = useStore((s) => s.settings.fastBots);
  const humans = ch.participants.filter((p) => !isBotSeat(p));
  const bots = useMemo(() => botInputsFor(ch), [ch]);
  const [stage, setStage] = useState<'intro' | 'countdown' | 'play' | 'verdict'>('intro');
  const [ready, setReady] = useState<Set<number>>(new Set());
  const [verdict, setVerdict] = useState<{ winner: number; inputs: Inputs; decidedBy: string; finalists: number[] } | null>(null);
  const pressRef = useRef<Press | null>(null);

  const keyOwner = useCallback(
    (e: KeyboardEvent): number | null => {
      if (humans.length === 1 && (e.code === 'Space' || e.key === 'Enter')) return humans[0];
      const k = JUMP_KEYS.findIndex((x) => x.code === e.code);
      return k >= 0 && k < humans.length ? humans[k] : null;
    },
    [humans],
  );

  const judge = useCallback(
    (inputs: Inputs) => {
      // Bots' official inputs are the precomputed ones (the on-screen replay is only for show).
      const all: Inputs = { ...inputs, ...bots };
      for (const p of ch.participants) all[p] = all[p] ?? [];
      return { all, v: judgeChallenge(ch, all) };
    },
    [bots, ch],
  );

  const finish = useCallback(
    (inputs: Inputs) => {
      const { all, v } = judge(inputs);
      setVerdict({ winner: v.winner, inputs: all, decidedBy: v.decidedBy, finalists: v.finalists });
      setStage('verdict');
      audio.play(v.winner === ch.livingAtStart ? 'hit' : 'transform');
    },
    [judge, ch.livingAtStart],
  );

  /** After the eight scored sweeps: stop now unless the top is tied. */
  const needsSuddenDeath = useCallback((inputs: Inputs) => judge(inputs).v.decidedBy !== 'score', [judge]);

  // Bot-only challenges with fast bots resolve straight away.
  useEffect(() => {
    if (!humans.length && fastBots && stage === 'intro') finish({});
  }, [humans.length, fastBots, stage, finish]);
  useEffect(() => {
    if (stage === 'intro' && humans.length > 0 && ready.size === humans.length) setStage('countdown');
    if (stage === 'intro' && !humans.length && !fastBots) {
      const t = window.setTimeout(() => setStage('countdown'), 1400);
      return () => clearTimeout(t);
    }
  }, [ready, stage, humans.length, fastBots]);
  useEffect(() => {
    if (stage !== 'countdown') return;
    audio.play('tick');
    const t = window.setTimeout(() => {
      audio.play('go');
      setStage('play');
    }, CHALLENGE.readyMs);
    return () => clearTimeout(t);
  }, [stage]);
  useEffect(() => {
    if (stage !== 'verdict' || !verdict) return;
    const t = window.setTimeout(() => act({ type: 'challengeResult', id: ch.id, inputs: verdict.inputs }), fastBots && !humans.length ? 600 : 2600);
    return () => clearTimeout(t);
  }, [stage, verdict, ch.id, fastBots, humans.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // holding a key never counts twice
      if (getState().modal) return;
      const owner = keyOwner(e);
      if (owner === null) return;
      e.preventDefault();
      if (stage === 'intro') setReady((r) => new Set(r).add(owner));
      else if (stage === 'play') pressRef.current?.(owner);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stage, keyOwner]);

  const keyLabel = (p: number) => {
    if (isBotSeat(p)) return 'bot';
    if (humans.length === 1) return 'Space, or tap Jump';
    return `key ${keyFor(humans, p)!.label}`;
  };

  return (
    <div className="challenge-stage" role="dialog" aria-modal="true" aria-label={challengeTitle(ch)}>
      <div className={`challenge-card kind-${ch.kind}`}>
        <div className="ch-head">
          <span className="ch-kicker">{ch.kind === 'seance' ? `Séance · ${ch.participants.length} jumpers` : 'For the life'}</span>
          <h2>{challengeTitle(ch)}</h2>
          <p className="ch-host">{challengeHost(ch, game)}</p>
        </div>
        <div className="ch-participants">
          {ch.participants.map((p, k) => {
            const pc = game.pieces[p];
            const curse = ch.multipliers[k] < 1 ? curseLine(pc.streak) : null;
            return (
              <div key={pc.id} className={`ch-player ${ready.has(p) ? 'ready' : ''}`}>
                <PlayerBadge n={p + 1} color={colorOf(pc.character)} size={26} /> <b>{pc.name}</b>
                {p === ch.livingAtStart && <span className="status alive"> ❤</span>}
                <span className="muted small"> — {keyLabel(p)}</span>
                {curse && <span className="status curse">{curse}</span>}
                {stage === 'intro' && !isBotSeat(p) && (
                  <button className="btn tool" onClick={() => setReady((r) => new Set(r).add(p))} disabled={ready.has(p)}>
                    {ready.has(p) ? 'Ready ✓' : 'Ready'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {stage === 'intro' && (
          <div className="ch-intro">
            <p>{challengeHowTo(ch)}</p>
            {humans.length > 0 && <p className="muted small">Press your key (or Ready) when you are set.</p>}
          </div>
        )}
        {stage === 'countdown' && <Countdown />}
        {stage === 'play' && <RopeGame ch={ch} game={game} bots={bots} pressRef={pressRef} onDone={finish} humans={humans} needsSuddenDeath={needsSuddenDeath} keyLabel={keyLabel} />}
        {stage === 'verdict' && verdict && (
          <div className="ch-verdict">
            <p className="lives">
              {game.pieces[verdict.winner].name} {verdict.winner === ch.livingAtStart ? 'keeps the life!' : 'steals the life!'}
            </p>
            {verdict.decidedBy === 'suddenDeath' && <p className="muted">Decided in sudden death between {verdict.finalists.map((f) => game.pieces[f].name).join(' and ')}.</p>}
            {verdict.decidedBy === 'timing' && <p className="muted">Tied after sudden death — the steadier timing wins.</p>}
            {verdict.decidedBy === 'verdict' && <p className="muted">A perfect tie. The Reaper’s verdict (a seeded draw) decides.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Countdown() {
  const [n, setN] = useState(3);
  useEffect(() => {
    const step = CHALLENGE.readyMs / 3;
    const a = window.setTimeout(() => setN(2), step);
    const b = window.setTimeout(() => setN(1), step * 2);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return (
    <div className="ch-countdown" aria-live="assertive">
      {n}
    </div>
  );
}

// ── Haunted Jump Rope ───────────────────────────────────────────────────

export interface RopeGameProps {
  ch: Challenge;
  game: GameState;
  bots: Inputs;
  pressRef: React.MutableRefObject<Press | null>;
  onDone: (inputs: Inputs) => void;
  /** Pieces pressing on this screen (they get a Jump button). */
  humans: number[];
  spectator?: boolean;
  /** Local play: after eight sweeps, keep going only if the top is tied. Phones always play all twelve. */
  needsSuddenDeath?: (inputs: Inputs) => boolean;
  keyLabel?: (p: number) => string;
  /** Lanes whose presses this screen actually knows (others show no score). Defaults to all. */
  knownLanes?: number[];
}

export function RopeGame({ ch, game, bots, pressRef, onDone, humans, spectator = false, needsSuddenDeath, keyLabel, knownLanes }: RopeGameProps) {
  const sched = useMemo(() => ropeSchedule(ch.seed), [ch.seed]);
  const t = useClock(true);
  const tRef = useRef(0);
  tRef.current = t;
  const inputs = useRef<Inputs>(Object.fromEntries(ch.participants.map((p) => [p, []])));
  const lastJump = useRef<Record<number, number>>({});
  const done = useRef(false);
  const [suddenDeath, setSuddenDeath] = useState<boolean | null>(needsSuddenDeath ? null : true);
  const c = CHALLENGE.rope;

  const press = useCallback((who: number) => {
    if (!(who in inputs.current) || done.current) return;
    const time = Math.round(tRef.current);
    inputs.current[who].push({ t: time });
    lastJump.current[who] = time;
    audio.play('jump');
  }, []);
  pressRef.current = press;

  useEffect(() => {
    const timers: number[] = [];
    for (const p of ch.participants) for (const i of bots[p] ?? []) timers.push(window.setTimeout(() => press(p), i.t));
    return () => timers.forEach(clearTimeout);
  }, [bots, ch.participants, press]);

  useEffect(() => {
    if (done.current) return;
    if (suddenDeath === null && t > sched.mainMs) setSuddenDeath(needsSuddenDeath!(inputs.current));
    if (suddenDeath === false || t > sched.totalMs) {
      done.current = true;
      if (!spectator) onDone(inputs.current);
    }
  }, [t, sched, onDone, spectator, suddenDeath, needsSuddenDeath]);

  // Rope phase: 0 at a floor pass, π overhead.
  const b = sched.bottoms;
  let i = b.findIndex((x) => x > t);
  if (i < 0) i = b.length;
  const prev = i === 0 ? b[0] - c.periodMs : b[i - 1];
  const next = i < b.length ? b[i] : b[b.length - 1] + c.periodMs;
  const theta = ((t - prev) / (next - prev)) * Math.PI * 2;
  const height = (1 - Math.cos(theta)) / 2; // 0 floor, 1 top
  const passed = b.filter((x) => x + c.lateMs < t).length;
  const sweepNo = Math.min(b.length, passed + 1);
  const inSuddenDeath = sweepNo > c.sweeps;
  const lanes = ch.participants.length;
  const W = 140 + lanes * 110;
  const ground = 200;
  const handleY = 110;
  const midY = ground - height * 170;
  const ctrl = 2 * midY - handleY;
  // Per-lane results from the very judge that decides the game.
  const results: SweepResult[][] = ch.participants.map((p, k) => judgeRopeSweeps(sched, inputs.current[p], ch.multipliers[k]));
  const upcoming = i < b.length ? b[i] : null;

  return (
    <div className="rope-game">
      <p className="muted">
        {inSuddenDeath ? `Sudden death ${sweepNo - c.sweeps} of ${c.extraSweeps}${needsSuddenDeath ? '' : ' — counts only for jumpers tied at the top'}` : `Sweep ${sweepNo} of ${c.sweeps}`}
      </p>
      <svg viewBox={`0 0 ${W} 240`} className="rope" aria-hidden="true">
        <rect x={0} y={ground} width={W} height={40} fill="#2a1d3d" />
        <circle cx={30} cy={handleY} r={10} fill="#6a5580" />
        <circle cx={W - 30} cy={handleY} r={10} fill="#6a5580" />
        {ch.participants.map((p, k) => {
          const pc = game.pieces[p];
          const x = 70 + (k + 0.5) * ((W - 140) / lanes);
          const lj = lastJump.current[p];
          const air = lj !== undefined && t - lj < 450 ? Math.sin(((t - lj) / 450) * Math.PI) : 0;
          const y = ground - 26 - air * 70;
          return (
            <g key={p} transform={`translate(${x},${y})`}>
              <ellipse cx={0} cy={26 + air * 70} rx={18} ry={5} fill="#000" opacity={0.35} />
              <circle r={22} fill={colorOf(pc.character)} stroke={p === ch.livingAtStart ? '#ffd36b' : '#fff6e0'} strokeWidth={p === ch.livingAtStart ? 5 : 3} opacity={p === ch.livingAtStart ? 1 : 0.8} />
              <text y={6} textAnchor="middle" fontWeight={900} fontSize={18} fill="#1a1024">
                {p + 1}
              </text>
            </g>
          );
        })}
        <path d={`M30,${handleY} Q${W / 2},${ctrl} ${W - 30},${handleY}`} fill="none" stroke="#7ff5e6" strokeWidth={6} opacity={height < 0.5 ? 1 : 0.55} />
      </svg>
      <div className="rope-lanes">
        {ch.participants.map((p, k) => {
          const res = results[k];
          const main = res.slice(0, Math.min(passed, c.sweeps)).filter((r) => r.cleared).length;
          const extra = res.slice(c.sweeps, Math.max(c.sweeps, passed)).filter((r) => r.cleared).length;
          const known = !knownLanes || knownLanes.includes(p);
          const last = known && passed > 0 ? res[passed - 1] : null;
          const w = clearanceWindow(ch.multipliers[k]);
          // Timing meter for the next sweep: left = 700 ms before the floor, right = the floor.
          const span = c.windowMs;
          const zoneL = ((span - w.maxLead) / span) * 100;
          const zoneW = ((w.maxLead - w.minLead) / span) * 100;
          const marker = upcoming === null ? null : Math.max(0, Math.min(100, ((t - (upcoming - span)) / span) * 100));
          return (
            <div key={p} className={`rope-lane ${p === ch.livingAtStart ? 'living' : ''}`}>
              <div className="rl-head">
                <PlayerBadge n={p + 1} color={colorOf(game.pieces[p].character)} size={20} /> <b>{game.pieces[p].name}</b>
                {known ? (
                  <span className="rl-score">
                    {main}/{c.sweeps}
                    {inSuddenDeath ? ` · SD ${extra}` : ''}
                  </span>
                ) : (
                  <span className="rl-score muted">jumping on their phone</span>
                )}
                {last && <span className={`rl-last ${last.cleared ? 'ok' : 'miss'}`}>{last.cleared ? '✓' : '✗'}</span>}
              </div>
              <div className="meter" title={ch.multipliers[k] < 1 ? `Cursed: window ${Math.round((1 - ch.multipliers[k]) * 100)}% narrower` : 'Normal window'}>
                <span className="zone" style={{ left: `${zoneL}%`, width: `${zoneW}%` }} />
                {marker !== null && <span className="marker" style={{ left: `${marker}%` }} />}
              </div>
              {humans.includes(p) && !spectator && (
                <button
                  className="btn primary press-btn"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    press(p);
                  }}
                >
                  Jump!{keyLabel ? ` (${keyLabel(p)})` : ''}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">Press when the marker is inside your green zone — that is when the rope passes under your feet.</p>
    </div>
  );
}

/** Room mode on the TV: phones play; pieces the host moved to the TV keyboard play here. */
function SpectatorStage({ game }: { game: GameState }) {
  const ch = game.challenge!;
  const room = useStore((s) => s.room);
  const run = room?.view?.run;
  const local = ch.participants.filter((p) => room?.view?.pieces[p]?.localControl);
  const [playing, setPlaying] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const sent = useRef('');
  const key = `${ch.id}:${run?.attempt ?? 0}`;
  useEffect(() => setPlaying(false), [key]);
  useEffect(() => {
    if (!run?.startAt) return;
    const c = roomClient();
    const ms = run.startAt - (c ? c.serverNow() : Date.now());
    const t = window.setTimeout(() => setPlaying(true), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [run?.startAt, key]);
  useEffect(() => {
    if (!playing || !local.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = local.length === 1 && e.code === 'Space' ? 0 : JUMP_KEYS.findIndex((x) => x.code === e.code);
      if (k >= 0 && k < local.length) pressRef.current?.(local[k]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [playing, local]);
  const done = (inputs: Inputs) => {
    if (sent.current === key) return;
    sent.current = key;
    for (const p of local) hostSend({ t: 'challengeInput', challengeId: ch.id, attempt: run?.attempt ?? 0, piece: p, inputs: inputs[p] ?? [] });
    setPlaying(false);
  };
  const phones = ch.participants.filter((p) => !local.includes(p) && room?.view?.pieces[p]?.kind === 'phone');
  return (
    <div className="challenge-stage spectator" role="status">
      <div className={`challenge-card kind-${ch.kind}`}>
        <span className="ch-kicker">{ch.kind === 'seance' ? `Séance · ${ch.participants.length} jumpers` : 'For the life'}</span>
        <h2>{challengeTitle(ch)}</h2>
        <p className="ch-host">{challengeHost(ch, game)}</p>
        {!playing && <p>{challengeHowTo(ch)}</p>}
        {ch.participants.map((p, k) =>
          ch.multipliers[k] < 1 ? (
            <p key={p} className="status curse">
              {game.pieces[p].name}: {curseLine(game.pieces[p].streak)}
            </p>
          ) : null,
        )}
        {run?.paused && <p className="notice">{run.paused}</p>}
        {run?.note && <p className="muted small">{run.note}</p>}
        {phones.length > 0 && !playing && <p className="muted">Jumping on {phones.map((p) => `${game.pieces[p].name}’s`).join(', ')} {phones.length > 1 ? 'phones' : 'phone'}…</p>}
        {local.length > 0 && !playing && !run?.startAt && (
          <button className="btn primary big" onClick={() => hostSend({ t: 'ready', challengeId: ch.id, attempt: run?.attempt ?? 0 })} disabled={local.every((p) => run?.ready.includes(p))}>
            {local.every((p) => run?.ready.includes(p)) ? 'Ready ✓ — waiting for the others' : `Ready (TV keyboard: ${local.length > 1 ? local.map((_, k) => JUMP_KEYS[k].label).join(', ') : 'Space'})`}
          </button>
        )}
        {playing && <RopeGame ch={ch} game={game} bots={{}} pressRef={pressRef} onDone={done} humans={local} spectator={!local.length} knownLanes={local} />}
      </div>
    </div>
  );
}
