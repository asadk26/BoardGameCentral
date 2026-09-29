// Survival games on the shared screen. Every press is timestamped against the
// animation the player is watching (performance.now() from the same clock
// that draws it) and handed to the engine's pure judges; bots feed the same
// input format. Up to two people can share the keyboard in a duel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHALLENGE, CHARACTERS } from '../engine/config';
import {
  DIRECTIONS,
  danceSchedule,
  escapeSchedule,
  judgeEscape,
  judgeRopeSweeps,
  markerAngle,
  ropeSchedule,
  type ChallengeInput,
} from '../engine/challenges';
import { judgeChallenge } from '../engine/engine';
import type { Challenge, GameState } from '../engine/types';
import { act, botInputsFor, getState, isBotSeat, KEY_SETS, setState, useStore } from '../store';
import { hostSend, roomClient } from '../net/host';
import { audio } from '../audio/audio';
import { CHALLENGE_TITLES, challengeHowTo } from '../text';
import { PlayerBadge } from './Dialog';

type Inputs = Record<number, ChallengeInput[]>;
type Press = (participant: number, dir?: number) => void;

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;
const now = () => performance.now();

function hostLine(ch: Challenge, game: GameState): string {
  const names = ch.participants.map((p) => game.players[p].name);
  switch (ch.host) {
    case 'npc':
      return `The resident ghost has ${names[0]}! Break the curse to slip away.`;
    case 'playerGhost':
      return `${game.players[ch.attacker!].name}’s ghost has ${names[0]}! Break the curse or join the dead.`;
    case 'reaper':
      return ch.kind === 'duel' ? `A Reaper rises and hosts the duel: ${names.join(' vs ')}.` : `A Reaper rises. ${names[0]} must entertain Death.`;
    case 'superReaper':
      return ch.kind === 'duel' ? `The Super Reaper summons ${names.join(' and ')}. Only one walks away.` : `The Super Reaper finds nobody to summon. ${names[0]} performs alone.`;
    default:
      return `${names.join(' and ')} meet in the dark: Haunted Jump Rope!`;
  }
}

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
  return { t, t0: start };
}

export function ChallengeStage({ game }: { game: GameState }) {
  const ch = game.challenge!;
  const mode = useStore((s) => s.mode);
  if (mode === 'room') return <SpectatorStage game={game} />;
  return <LocalChallenge key={`${ch.id}:${ch.attempt}`} game={game} ch={ch} />;
}

function LocalChallenge({ game, ch }: { game: GameState; ch: Challenge }) {
  const keySet = useStore((s) => s.keySet);
  const fastBots = useStore((s) => s.settings.fastBots);
  const humans = ch.participants.filter((p) => !isBotSeat(p));
  const bots = useMemo(() => botInputsFor(ch), [ch]);
  const [stage, setStage] = useState<'intro' | 'countdown' | 'play' | 'verdict'>('intro');
  const [ready, setReady] = useState<Set<number>>(new Set());
  const [verdict, setVerdict] = useState<{ survivors: number[]; inputs: Inputs } | null>(null);
  const pressRef = useRef<Press | null>(null);
  const keys = KEY_SETS[keySet].keys;
  const twoHumans = humans.length === 2;

  const keyOwner = useCallback(
    (e: KeyboardEvent): number | null => {
      if (twoHumans) {
        const k = e.key.toLowerCase();
        if (k === keys.a.toLowerCase() || e.code === keys.a) return humans[0];
        if (k === keys.b.toLowerCase() || e.code === keys.b) return humans[1];
        return null;
      }
      if (humans.length === 1 && (e.code === 'Space' || e.key === 'Enter' || e.key.toLowerCase() === keys.a.toLowerCase())) return humans[0];
      return null;
    },
    [twoHumans, humans, keys],
  );

  const finish = useCallback(
    (inputs: Inputs) => {
      // Bots' official inputs are the precomputed ones (the on-screen replay is only for show).
      const all = { ...inputs, ...bots };
      for (const p of ch.participants) all[p] = all[p] ?? [];
      const v = judgeChallenge(ch, all);
      setVerdict({ survivors: v.survivors, inputs: all });
      setStage('verdict');
      audio.play(v.survivors.length === ch.participants.length ? 'hit' : 'transform');
    },
    [bots, ch],
  );

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
    const t = window.setTimeout(() => act({ type: 'challengeResult', id: ch.id, inputs: verdict.inputs }), fastBots && !humans.length ? 600 : 2200);
    return () => clearTimeout(t);
  }, [stage, verdict, ch.id, fastBots, humans.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return; // holding a key never counts twice
      if (getState().modal) return;
      if (stage === 'intro') {
        const owner = keyOwner(e);
        if (owner !== null) {
          e.preventDefault();
          setReady((r) => new Set(r).add(owner));
        }
        return;
      }
      if (stage !== 'play') return;
      if (ch.kind === 'dance') {
        const dir = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 }[e.key as 'ArrowUp'];
        if (dir !== undefined && humans.length) {
          e.preventDefault();
          pressRef.current?.(humans[0], dir);
        }
        return;
      }
      const owner = keyOwner(e);
      if (owner !== null) {
        e.preventDefault();
        pressRef.current?.(owner);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stage, keyOwner, ch.kind, humans]);

  const players = ch.participants.map((p) => game.players[p]);
  const keyLabel = (p: number) => {
    if (isBotSeat(p)) return 'bot';
    if (ch.kind === 'dance') return 'arrow keys or the buttons';
    if (twoHumans) return `key ${(p === humans[0] ? keys.a : keys.b).replace('Shift', ' Shift').toUpperCase()}`;
    return 'Space, or tap the button';
  };

  return (
    <div className="challenge-stage" role="dialog" aria-modal="true" aria-label={CHALLENGE_TITLES[ch.kind]}>
      <div className={`challenge-card kind-${ch.kind}`}>
        <div className="ch-head">
          <span className="ch-kicker">{ch.oneSurvivor && ch.kind === 'duel' ? 'One survivor' : 'Survival challenge'}</span>
          <h2>{CHALLENGE_TITLES[ch.kind]}</h2>
          <p className="ch-host">{hostLine(ch, game)}</p>
        </div>
        <div className="ch-participants">
          {players.map((p, k) => (
            <div key={p.id} className={`ch-player ${ready.has(ch.participants[k]) ? 'ready' : ''}`}>
              <PlayerBadge n={ch.participants[k] + 1} color={colorOf(p.character)} size={26} /> <b>{p.name}</b>
              <span className="muted small"> — {keyLabel(ch.participants[k])}</span>
              {stage === 'intro' && !isBotSeat(ch.participants[k]) && (
                <button className="btn tool" onClick={() => setReady((r) => new Set(r).add(ch.participants[k]))} disabled={ready.has(ch.participants[k])}>
                  {ready.has(ch.participants[k]) ? 'Ready ✓' : 'Ready'}
                </button>
              )}
            </div>
          ))}
        </div>
        {stage === 'intro' && (
          <div className="ch-intro">
            <p>{challengeHowTo(ch.kind, ch.oneSurvivor)}</p>
            {humans.length > 0 && <p className="muted small">Press your key (or Ready) when you are set. Holding a key never counts twice.</p>}
            {twoHumans && (
              <button className="btn tool" onClick={() => setState((s) => ({ keySet: (s.keySet + 1) % KEY_SETS.length }))}>
                Use other keys ({KEY_SETS[(keySet + 1) % KEY_SETS.length].label})
              </button>
            )}
          </div>
        )}
        {stage === 'countdown' && <Countdown />}
        {stage === 'play' && (
          <>
            {ch.kind === 'escape' && <EscapeGame ch={ch} bots={bots} pressRef={pressRef} onDone={finish} human={humans[0] ?? null} />}
            {ch.kind === 'dance' && <DanceGame ch={ch} bots={bots} pressRef={pressRef} onDone={finish} human={humans[0] ?? null} />}
            {(ch.kind === 'rope' || ch.kind === 'duel') && <RopeGame ch={ch} game={game} bots={bots} pressRef={pressRef} onDone={finish} humans={humans} />}
          </>
        )}
        {stage === 'verdict' && verdict && (
          <div className="ch-verdict">
            {ch.participants.map((p) => (
              <p key={p} className={verdict.survivors.includes(p) ? 'lives' : 'dies'}>
                {game.players[p].name}: {verdict.survivors.includes(p) ? 'survives!' : 'becomes a ghost…'}
              </p>
            ))}
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

interface GameProps {
  ch: Challenge;
  bots: Inputs;
  pressRef: React.MutableRefObject<Press | null>;
  onDone: (inputs: Inputs) => void;
}

// ── Break the Curse ─────────────────────────────────────────────────────

export function EscapeGame({ ch, bots, pressRef, onDone, human, spectator = false }: GameProps & { human: number | null; spectator?: boolean }) {
  const sched = useMemo(() => escapeSchedule(ch.seed), [ch.seed]);
  const p = ch.participants[0];
  const { t } = useClock(true);
  const inputs = useRef<ChallengeInput[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const done = useRef(false);
  const attemptAt = (time: number) => sched.starts.findIndex((s) => time >= s && time <= s + sched.periodMs);
  const tRef = useRef(0);
  tRef.current = t;

  const press = useCallback(
    (who: number) => {
      if (who !== p || done.current) return;
      const time = tRef.current;
      const a = attemptAt(time);
      if (a < 0 || inputs.current.some((i) => i.a === a)) return;
      inputs.current.push({ a, t: Math.round(time - sched.starts[a]) });
      const hit = judgeEscape(ch.seed, inputs.current).hits[a];
      setFlash(hit ? 'Curse broken!' : 'Missed!');
      audio.play(hit ? 'hit' : 'miss');
      if (hit) {
        done.current = true;
        window.setTimeout(() => onDone({ [p]: inputs.current }), 700);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, ch.seed, onDone, sched],
  );
  pressRef.current = press;

  // Bots press at their scheduled moments, through the same path.
  const botPresses = bots[p];
  useEffect(() => {
    if (!botPresses) return;
    const timers = botPresses.map((i) => window.setTimeout(() => press(p), sched.starts[i.a ?? 0] + i.t));
    return () => timers.forEach(clearTimeout);
  }, [botPresses, press, p, sched]);

  useEffect(() => {
    if (!done.current && t > sched.totalMs + 250) {
      done.current = true;
      if (!spectator) onDone({ [p]: inputs.current });
    }
  }, [t, sched.totalMs, onDone, p, spectator]);

  const a = attemptAt(t);
  const zone = sched.zones[Math.max(0, a < 0 ? sched.starts.findIndex((s) => s > t) : a)] ?? sched.zones[sched.zones.length - 1];
  const angle = a >= 0 ? markerAngle(sched, t - sched.starts[a]) : 0;
  const R = 90;
  const arc = (from: number, to: number) => {
    const pt = (deg: number) => [110 + R * Math.sin((deg * Math.PI) / 180), 110 - R * Math.cos((deg * Math.PI) / 180)];
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    return `M${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2}`;
  };
  return (
    <div className="escape-game">
      <svg viewBox="0 0 220 220" className="ring" aria-hidden="true">
        <circle cx={110} cy={110} r={R} fill="none" stroke="#3a2b4d" strokeWidth={16} />
        <path d={arc(zone - sched.zoneDeg / 2, zone + sched.zoneDeg / 2)} fill="none" stroke="#5ff2e0" strokeWidth={18} strokeLinecap="round" />
        {a >= 0 && <circle cx={110 + R * Math.sin((angle * Math.PI) / 180)} cy={110 - R * Math.cos((angle * Math.PI) / 180)} r={11} fill="#fff1b8" stroke="#2a1204" strokeWidth={3} />}
        <text x={110} y={116} textAnchor="middle" fill="#fff4e2" fontSize={18} fontWeight={800}>
          {a >= 0 ? `Try ${a + 1} of 2` : t < sched.starts[0] ? 'Get ready' : '…'}
        </text>
      </svg>
      {flash && <p className="ch-flash">{flash}</p>}
      {human !== null && !spectator && (
        <button className="btn primary big press-btn" onPointerDown={(e) => { e.preventDefault(); press(human); }}>
          Break the curse!
        </button>
      )}
    </div>
  );
}

// ── Dance for Death ─────────────────────────────────────────────────────

const ARROWS = ['⬆', '➡', '⬇', '⬅'];

export function DanceGame({ ch, bots, pressRef, onDone, human, spectator = false }: GameProps & { human: number | null; spectator?: boolean }) {
  const sched = useMemo(() => danceSchedule(ch.seed), [ch.seed]);
  const p = ch.participants[0];
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'show' | 'answer' | 'between'>('show');
  const [entered, setEntered] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const inputs = useRef<ChallengeInput[]>([]);
  const answerStart = useRef(0);
  const { t } = useClock(phase === 'show');
  const done = useRef(false);

  const endAttempt = useCallback(
    (ok: boolean) => {
      if (done.current) return;
      if (ok || attempt + 1 >= sched.sequences.length) {
        done.current = true;
        setMsg(ok ? 'Death applauds!' : 'Death is not amused…');
        if (!spectator) window.setTimeout(() => onDone({ [p]: inputs.current }), 700);
        return;
      }
      setMsg('Wrong! One more try — a new dance.');
      setPhase('between');
      window.setTimeout(() => {
        setAttempt((x) => x + 1);
        setEntered([]);
        setMsg(null);
        setPhase('show');
      }, 1100);
    },
    [attempt, sched.sequences.length, onDone, p, spectator],
  );

  useEffect(() => {
    if (phase === 'show' && t > sched.showMs) {
      answerStart.current = now();
      setPhase('answer');
    }
  }, [phase, t, sched.showMs]);

  useEffect(() => {
    if (phase !== 'answer') return;
    const timer = window.setTimeout(() => endAttempt(false), sched.answerMs);
    return () => clearTimeout(timer);
  }, [phase, attempt, endAttempt, sched.answerMs]);

  const press = useCallback(
    (who: number, dir?: number) => {
      if (who !== p || dir === undefined || phase !== 'answer' || done.current) return;
      const tt = Math.round(now() - answerStart.current);
      inputs.current.push({ a: attempt, t: tt, d: dir });
      const seq = sched.sequences[attempt];
      const k = entered.length;
      if (seq[k] !== dir) {
        audio.play('miss');
        endAttempt(false);
        return;
      }
      audio.play('jump');
      const next = [...entered, dir];
      setEntered(next);
      if (next.length === seq.length) endAttempt(true);
    },
    [p, phase, attempt, sched, entered, endAttempt],
  );
  pressRef.current = press;

  const botPresses = bots[p];
  useEffect(() => {
    if (!botPresses || phase !== 'answer') return;
    const timers = botPresses.filter((i) => i.a === attempt).map((i) => window.setTimeout(() => press(p, i.d), i.t));
    return () => timers.forEach(clearTimeout);
    // Re-arm only when a new answer window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botPresses, phase, attempt]);

  const slot = sched.symbolMs + sched.gapMs;
  const k = Math.floor(t / slot);
  const showing = phase === 'show' && k < 4 && t - k * slot < sched.symbolMs ? sched.sequences[attempt][k] : null;
  return (
    <div className="dance-game">
      <p className="muted">Sequence {attempt + 1} of {sched.sequences.length}</p>
      <div className="dance-show" aria-live="polite">
        {phase === 'show' ? (showing !== null ? <span className="big-arrow">{ARROWS[showing]}</span> : <span className="big-arrow dim">·</span>) : phase === 'answer' ? <span className="muted">Your turn — repeat the dance!</span> : null}
      </div>
      <div className="dance-entered">
        {sched.sequences[attempt].map((_, i) => (
          <span key={i} className={`slot ${entered[i] !== undefined ? 'on' : ''}`}>
            {entered[i] !== undefined ? ARROWS[entered[i]] : '?'}
          </span>
        ))}
      </div>
      {msg && <p className="ch-flash">{msg}</p>}
      {human !== null && !spectator && (
        <div className="dance-pad" role="group" aria-label="Dance moves">
          {DIRECTIONS.map((d, i) => (
            <button key={d} className={`btn pad pad-${d}`} disabled={phase !== 'answer'} onPointerDown={(e) => { e.preventDefault(); press(human, i); }} aria-label={d}>
              {ARROWS[i]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Jump Rope (solo and duel) ───────────────────────────────────────────

export function RopeGame({ ch, game, bots, pressRef, onDone, humans, spectator = false }: GameProps & { game: GameState; humans: number[]; spectator?: boolean }) {
  const extras = ch.kind === 'duel' && ch.oneSurvivor;
  const sched = useMemo(() => ropeSchedule(ch.seed, extras), [ch.seed, extras]);
  const { t } = useClock(true);
  const tRef = useRef(0);
  tRef.current = t;
  const inputs = useRef<Inputs>(Object.fromEntries(ch.participants.map((p) => [p, []])));
  const lastJump = useRef<Record<number, number>>({});
  const done = useRef(false);

  const press = useCallback((who: number) => {
    if (!(who in inputs.current) || done.current) return;
    const time = Math.round(tRef.current);
    const prev = lastJump.current[who];
    if (prev !== undefined && time - prev < CHALLENGE.rope.airMaxMs) return; // still in the air
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
    if (!done.current && t > sched.totalMs) {
      done.current = true;
      if (!spectator) onDone(inputs.current);
    }
  }, [t, sched.totalMs, onDone, spectator]);

  // Rope phase: 0 at a floor pass, π overhead.
  const b = sched.bottoms;
  let i = b.findIndex((x) => x > t);
  if (i < 0) i = b.length;
  const prev = i === 0 ? b[0] - CHALLENGE.rope.periodMs : b[i - 1];
  const next = i < b.length ? b[i] : b[b.length - 1] + CHALLENGE.rope.periodMs;
  const theta = ((t - prev) / (next - prev)) * Math.PI * 2;
  const height = (1 - Math.cos(theta)) / 2; // 0 floor, 1 top
  const W = 520;
  const ground = 200;
  const handleY = 110;
  const midY = ground - height * 170;
  const c = 2 * midY - handleY;
  const passed = b.filter((x) => x + CHALLENGE.rope.lateMs < t).length;
  const counts = ch.participants.map((p) => {
    const res = judgeRopeSweeps(sched, inputs.current[p]).slice(0, Math.min(passed, CHALLENGE.rope.sweeps));
    return res.filter((r) => r.cleared).length;
  });
  const sweepNo = Math.min(b.length, passed + 1);
  const lanes = ch.participants.length;
  return (
    <div className="rope-game">
      <p className="muted">
        Sweep {Math.min(sweepNo, b.length)} of {CHALLENGE.rope.sweeps}
        {extras && sweepNo > CHALLENGE.rope.sweeps ? ' — sudden death (counts only on a tie)' : ''}
      </p>
      <svg viewBox={`0 0 ${W} 240`} className="rope" aria-hidden="true">
        <rect x={0} y={ground} width={W} height={40} fill="#2a1d3d" />
        <circle cx={30} cy={handleY} r={10} fill="#6a5580" />
        <circle cx={W - 30} cy={handleY} r={10} fill="#6a5580" />
        {ch.participants.map((p, k) => {
          const pl = game.players[p];
          const x = lanes === 1 ? W / 2 : W / 2 + (k === 0 ? -80 : 80);
          const lj = lastJump.current[p];
          const air = lj !== undefined && t - lj < 450 ? Math.sin(((t - lj) / 450) * Math.PI) : 0;
          const y = ground - 26 - air * 70;
          return (
            <g key={p} transform={`translate(${x},${y})`}>
              <ellipse cx={0} cy={26 + air * 70} rx={18} ry={5} fill="#000" opacity={0.35} />
              <circle r={22} fill={colorOf(pl.character)} stroke="#fff6e0" strokeWidth={3} />
              <text y={6} textAnchor="middle" fontWeight={900} fontSize={18} fill="#1a1024">
                {p + 1}
              </text>
            </g>
          );
        })}
        <path d={`M30,${handleY} Q${W / 2},${c} ${W - 30},${handleY}`} fill="none" stroke="#7ff5e6" strokeWidth={6} opacity={height < 0.5 ? 1 : 0.55} />
      </svg>
      <div className="rope-scores">
        {ch.participants.map((p, k) => (
          <div key={p} className="rope-score">
            <b>{game.players[p].name}</b> {counts[k]} / {CHALLENGE.rope.sweeps}
            {!ch.oneSurvivor && <span className="muted small"> (needs {CHALLENGE.rope.pass})</span>}
            {humans.includes(p) && !spectator && (
              <button className="btn primary press-btn" onPointerDown={(e) => { e.preventDefault(); press(p); }}>
                Jump!
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Room mode on the TV: phones play; seats the host moved to the TV keyboard play here. */
function SpectatorStage({ game }: { game: GameState }) {
  const ch = game.challenge!;
  const room = useStore((s) => s.room);
  const run = room?.view?.run;
  const local = ch.participants.filter((p) => room?.view?.seats[p]?.localControl);
  const [playing, setPlaying] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const sent = useRef('');
  const key = `${ch.id}:${run?.attempt ?? 0}`;
  useEffect(() => setPlaying(false), [key]);
  useEffect(() => {
    if (!run?.startAt || !local.length) return;
    const c = roomClient();
    const ms = run.startAt - (c ? c.serverNow() : Date.now());
    const t = window.setTimeout(() => setPlaying(true), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [run?.startAt, local.length, key]);
  useEffect(() => {
    if (!playing || !local.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const who = local.length === 1 && (e.code === 'Space' || k === 'f') ? local[0] : k === 'f' ? local[0] : k === 'j' ? local[1] : undefined;
      const dir = { arrowup: 0, arrowright: 1, arrowdown: 2, arrowleft: 3 }[k as 'arrowup'];
      if (ch.kind === 'dance' && dir !== undefined) pressRef.current?.(local[0], dir);
      else if (who !== undefined) pressRef.current?.(who);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [playing, local, ch.kind]);
  const done = (inputs: Inputs) => {
    if (sent.current === key) return;
    sent.current = key;
    for (const p of local) hostSend({ t: 'challengeInput', challengeId: ch.id, attempt: run?.attempt ?? 0, seat: p, inputs: inputs[p] ?? [] });
    setPlaying(false);
  };
  const phones = ch.participants.filter((p) => !local.includes(p) && room?.view?.seats[p]?.kind === 'phone');
  return (
    <div className="challenge-stage spectator" role="status">
      <div className={`challenge-card kind-${ch.kind}`}>
        <span className="ch-kicker">{ch.oneSurvivor && ch.kind === 'duel' ? 'One survivor' : 'Survival challenge'}</span>
        <h2>{CHALLENGE_TITLES[ch.kind]}</h2>
        <p className="ch-host">{hostLine(ch, game)}</p>
        {!playing && <p>{challengeHowTo(ch.kind, ch.oneSurvivor)}</p>}
        {run?.paused && <p className="notice">{run.paused}</p>}
        {run?.note && <p className="muted small">{run.note}</p>}
        {phones.length > 0 && !playing && <p className="muted">Playing on {phones.map((p) => `${game.players[p].name}’s`).join(' and ')} {phones.length > 1 ? 'phones' : 'phone'}…</p>}
        {local.length > 0 && !playing && !run?.startAt && (
          <button className="btn primary big" onClick={() => hostSend({ t: 'ready', challengeId: ch.id, attempt: run?.attempt ?? 0 })} disabled={local.every((p) => run?.ready.includes(p))}>
            {local.every((p) => run?.ready.includes(p)) ? 'Ready ✓ — waiting for the others' : `Ready (TV keyboard: ${local.length > 1 ? 'F and J' : 'Space'})`}
          </button>
        )}
        {playing && ch.kind === 'escape' && <EscapeGame ch={ch} bots={{}} pressRef={pressRef} onDone={done} human={local[0]} />}
        {playing && ch.kind === 'dance' && <DanceGame ch={ch} bots={{}} pressRef={pressRef} onDone={done} human={local[0]} />}
        {playing && (ch.kind === 'rope' || ch.kind === 'duel') && <RopeGame ch={ch} game={game} bots={{}} pressRef={pressRef} onDone={done} humans={local} />}
      </div>
    </div>
  );
}
