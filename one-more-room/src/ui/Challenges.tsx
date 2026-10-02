// Haunted Jump Rope, played on the TV (or the one shared screen). The actual
// character miniatures stand in a small arena; a long spectral rope turns
// around them and passes under their feet. A press is one visible jump. The
// arena draws exactly what the judge scores: jumps, stumbles and the rope all
// come from engine/challenges.ts, so a jump that looks clear is clear.
//
// Phones only send presses (see PhoneApp); in a phone room the room service
// owns the timeline and this screen draws it from the server clock.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHALLENGE, CHARACTERS } from '../engine/config';
import { airTime, jumperTimeline, jumpHeight, practiceSchedule, ropeAngle, ropeSchedule, type ChallengeInput, type RopeSchedule } from '../engine/challenges';
import { judgeChallenge } from '../engine/engine';
import type { Challenge, ChallengeOutcome, GameState } from '../engine/types';
import { act, botInputsFor, getState, isBotSeat, JUMP_KEYS, markRopePracticed, useStore } from '../store';
import { hostSend, roomClient } from '../net/host';
import { audio } from '../audio/audio';
import { CharacterModel } from '../scene/Characters';
import { useSpectral } from '../scene/Reaper';
import { labelTexture } from '../scene/labels';
import { cursePhrase, outcomeHeadline } from '../text';

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;
const PEAK = 0.85; // world height of a full (uncursed) jump
const ROPE_FEET = CHALLENGE.rope.ropeHeightFrac * PEAK; // the rope skims this high as it passes the feet
const ROPE_R = 1.15;
const AXIS_Y = ROPE_FEET + ROPE_R;
const SPACING = 1.3;

export interface Jumper {
  piece: number;
  name: string;
  character: GameState['pieces'][number]['character'];
  multiplier: number;
  living: boolean;
  ghost: boolean;
}

/** Live data the arena reads every frame (no React re-render needed). */
export interface ArenaFeed {
  /** Timeline ms now (negative before the rope starts). */
  now: () => number;
  sched: RopeSchedule;
  presses: Record<number, number[]>;
}

export function jumpersOf(game: GameState, ch: Challenge): Jumper[] {
  return ch.participants.map((p, k) => ({
    piece: p,
    name: game.pieces[p].name,
    character: game.pieces[p].character,
    multiplier: ch.multipliers[k],
    living: p === ch.livingAtStart,
    ghost: !game.pieces[p].alive,
  }));
}

// ── the 3D arena ────────────────────────────────────────────────────────

function ArenaJumper({ j, x, feed, sounds }: { j: Jumper; x: number; feed: React.MutableRefObject<ArenaFeed>; sounds: boolean }) {
  const body = useRef<THREE.Group>(null);
  const miss = useRef<THREE.Sprite>(null);
  const ok = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  const seen = useRef({ jumps: 0, stumbles: 0 });
  useSpectral(body, j.ghost, colorOf(j.character));
  const name = useMemo(() => labelTexture([`${j.living ? '❤ ' : ''}${j.name}`], { border: colorOf(j.character), height: 84 }), [j.name, j.character, j.living]);
  const missTex = useMemo(() => labelTexture(['MISS'], { fg: '#fff', bg: '#e0405a', height: 84 }), []);
  const okTex = useMemo(() => labelTexture(['✓'], { fg: '#10240f', bg: '#7ee081', height: 84 }), []);
  useFrame(() => {
    const f = feed.current;
    const t = f.now();
    const tl = jumperTimeline(f.sched, (f.presses[j.piece] ?? []).map((v) => ({ t: v })), j.multiplier);
    const jump = tl.jumps.find((q) => q.start <= t && t < q.end);
    const y = jump ? jumpHeight(t - jump.start, j.multiplier) * PEAK : 0;
    const stumble = tl.stumbles.filter((s) => s <= t).pop();
    const sinceStumble = stumble === undefined ? Infinity : t - stumble;
    const passed = f.sched.bottoms.filter((b) => b <= t).length;
    // Sounds follow what is drawn.
    const nJumps = tl.jumps.filter((q) => q.start <= t).length;
    const nStumbles = tl.stumbles.filter((s) => s <= t).length;
    if (sounds) {
      if (nJumps > seen.current.jumps) audio.play('jump');
      if (nStumbles > seen.current.stumbles) audio.play('hit');
    }
    seen.current = { jumps: nJumps, stumbles: nStumbles };
    const g = body.current;
    if (g) {
      g.position.set(x, y + (j.ghost ? 0.06 : 0), 0);
      const st = sinceStumble < 450 ? 1 - sinceStumble / 450 : 0;
      g.rotation.set(-0.5 * st, 0, Math.sin(t / 30) * 0.15 * st);
    }
    const last = tl.results[passed - 1];
    const sincePass = passed > 0 ? t - f.sched.bottoms[passed - 1] : Infinity;
    if (miss.current) {
      miss.current.visible = sinceStumble < 650;
      miss.current.position.set(x, 1.55 + Math.min(0.3, sinceStumble / 2000), 0);
    }
    if (ok.current) {
      ok.current.visible = !!last?.cleared && sincePass < 420;
      ok.current.position.set(x, 1.5 + Math.min(0.25, sincePass / 1500), 0);
    }
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).color.set(sinceStumble < 450 ? '#e0405a' : last?.cleared && sincePass < 300 ? '#7ee081' : colorOf(j.character));
  });
  return (
    <group>
      <mesh ref={ring} position={[x, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.46, 32]} />
        <meshBasicMaterial color={colorOf(j.character)} toneMapped={false} />
      </mesh>
      <group ref={body}>
        <CharacterModel id={j.character} />
      </group>
      <sprite position={[x, -0.32, 0.55]} scale={[0.3 * name.aspect, 0.3, 1]} renderOrder={6}>
        <spriteMaterial map={name.tex} depthTest={false} transparent />
      </sprite>
      <sprite ref={miss} scale={[0.3 * missTex.aspect, 0.3, 1]} renderOrder={7} visible={false}>
        <spriteMaterial map={missTex.tex} depthTest={false} transparent />
      </sprite>
      <sprite ref={ok} scale={[0.26 * okTex.aspect, 0.26, 1]} renderOrder={7} visible={false}>
        <spriteMaterial map={okTex.tex} depthTest={false} transparent />
      </sprite>
    </group>
  );
}

/** The rope: a flat stretch under everyone's feet, tapering to the two turners' hands; it turns about the line between them. */
function Rope({ half, feed, sounds }: { half: number; feed: React.MutableRefObject<ArenaFeed>; sounds: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const lastPass = useRef(0);
  const reach = half + 1.05;
  const geom = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -reach + (2 * reach * i) / 40;
      const ax = Math.abs(x);
      const flat = half + 0.35;
      const r = ax <= flat ? ROPE_R : ROPE_R * Math.max(0, Math.cos(((ax - flat) / (reach - flat)) * (Math.PI / 2)));
      pts.push(new THREE.Vector3(x, -r, 0));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.035, 6, false);
  }, [half, reach]);
  useFrame(() => {
    const f = feed.current;
    const t = f.now();
    if (ref.current) ref.current.rotation.x = ropeAngle(f.sched, t);
    const passes = f.sched.bottoms.filter((b) => b <= t).length;
    if (sounds && passes > lastPass.current) audio.play('whoosh');
    lastPass.current = passes;
  });
  return (
    <group position={[0, AXIS_Y, 0]}>
      <mesh ref={ref} geometry={geom}>
        <meshBasicMaterial color="#d9c8ff" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A hooded spectre turning one end of the rope. */
function Turner({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.75, 0]}>
        <coneGeometry args={[0.38, 1.5, 10]} />
        <meshStandardMaterial color="#2a1f3d" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.22, 14, 10]} />
        <meshStandardMaterial color="#1a1226" roughness={0.9} />
      </mesh>
      {[-0.08, 0.08].map((dx) => (
        <mesh key={dx} position={[dx, 1.57, 0.19]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshBasicMaterial color="#9fe8ff" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function RopeArena({ jumpers, feed, sounds = true }: { jumpers: Jumper[]; feed: React.MutableRefObject<ArenaFeed>; sounds?: boolean }) {
  const half = ((jumpers.length - 1) * SPACING) / 2;
  const width = half * 2 + 3.6;
  const camZ = Math.max(3.9, width * 0.86);
  return (
    <Canvas className="rope-arena" camera={{ fov: 40, position: [0, 1.55, camZ], near: 0.1, far: 60 }} onCreated={({ camera }) => camera.lookAt(0, 0.75, 0)} dpr={[1, 1.75]}>
      <color attach="background" args={['#120a1f']} />
      <hemisphereLight args={['#b8a6ff', '#1a1028', 1.1]} />
      <directionalLight position={[2, 6, 5]} intensity={1.1} />
      <pointLight position={[0, 2.6, 1.5]} color="#ffb45a" intensity={6} distance={9} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[Math.max(4, half + 3), 48]} />
        <meshStandardMaterial color="#2d2140" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <planeGeometry args={[half * 2 + 1.6, 0.18]} />
        <meshBasicMaterial color="#4b3a66" />
      </mesh>
      <Turner x={-(half + 1.05)} />
      <Turner x={half + 1.05} />
      <Rope half={half} feed={feed} sounds={sounds} />
      {jumpers.map((j, k) => (
        <ArenaJumper key={j.piece} j={j} x={-half + k * SPACING} feed={feed} sounds={sounds} />
      ))}
    </Canvas>
  );
}

// ── the panel around the arena ──────────────────────────────────────────

/** Successful jumps so far, per jumper, as the screen shows them. */
function useScores(jumpers: Jumper[], feed: React.MutableRefObject<ArenaFeed>) {
  const [view, setView] = useState({ scores: jumpers.map(() => 0), sweep: 0, count: 0 });
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const f = feed.current;
      const t = f.now();
      const passed = f.sched.bottoms.filter((b) => b <= t).length;
      const scores = jumpers.map((j) => {
        const tl = jumperTimeline(f.sched, (f.presses[j.piece] ?? []).map((v) => ({ t: v })), j.multiplier);
        return tl.results.slice(0, Math.min(passed, f.sched.sweeps)).filter((r) => r.cleared).length;
      });
      const count = t < 0 && t > -CHALLENGE.readyMs - 50 ? Math.ceil(-t / 1000) : 0;
      setView((v) => (v.sweep === passed && v.count === count && v.scores.every((s, i) => s === scores[i]) ? v : { scores, sweep: passed, count }));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [jumpers, feed]);
  return view;
}

function Scoreline({ jumpers, feed, label, keys }: { jumpers: Jumper[]; feed: React.MutableRefObject<ArenaFeed>; label: string; keys?: Record<number, string> }) {
  const v = useScores(jumpers, feed);
  const sched = feed.current.sched;
  const total = sched.sweeps;
  return (
    <>
      <div className="arena-top">
        <span className="arena-label">{label}</span>
        <span className="arena-sweep">{v.sweep >= total ? (sched.extraSweeps ? 'Sudden death!' : '') : `Sweep ${Math.min(total, v.sweep + 1)} / ${total}`}</span>
      </div>
      {v.count > 0 && v.count <= 3 && (
        <div className="arena-countdown" aria-live="assertive">
          {v.count}
        </div>
      )}
      <div className="arena-scores">
        {jumpers.map((j, k) => (
          <span key={j.piece} className="arena-score" style={{ borderColor: colorOf(j.character) }}>
            <b>{j.name}</b> ✓ {v.scores[k]}
            {keys?.[j.piece] && <kbd>{keys[j.piece]}</kbd>}
          </span>
        ))}
      </div>
    </>
  );
}

function CurseLine({ jumpers }: { jumpers: Jumper[] }) {
  const cursed = jumpers.filter((j) => j.multiplier < 1);
  if (!cursed.length) return null;
  return (
    <p className="arena-curse">
      {cursed.map((j) => (
        <span key={j.piece}>
          ❤ {j.name} · {cursePhrase(j.multiplier)}
        </span>
      ))}
    </p>
  );
}

function titleOf(ch: Challenge) {
  if (ch.host === 'ghostBattle' || ch.host === 'versus') return 'Ghost battle · winner gets an item';
  if (ch.kind === 'seance') return 'Séance · everyone jumps';
  return 'Jump for the life';
}

/** A short demonstration: the contestants themselves, jumping a slow rope perfectly. */
function useDemoFeed(jumpers: Jumper[]) {
  const t0 = useRef(performance.now());
  const sched = useMemo<RopeSchedule>(() => {
    const bottoms = Array.from({ length: 4 }, (_, i) => 900 + i * 1500);
    return { bottoms, sweeps: 4, extraSweeps: 0, mainMs: 0, totalMs: 6000 };
  }, []);
  return useRef<ArenaFeed>({
    now: () => (performance.now() - t0.current) % 6000,
    sched,
    presses: Object.fromEntries(jumpers.map((j) => [j.piece, sched.bottoms.map((b) => b - airTime(j.multiplier) / 2)])),
  });
}

export function ChallengeStage({ game }: { game: GameState }) {
  const ch = game.challenge!;
  const mode = useStore((s) => s.mode);
  if (mode === 'room') return <RoomStage key={ch.id} game={game} ch={ch} />;
  return <LocalStage key={`${ch.id}:${ch.attempt}`} game={game} ch={ch} />;
}

// ── one shared screen ───────────────────────────────────────────────────

type LocalStageName = 'ready' | 'practice' | 'countdown' | 'verdict';

function LocalStage({ game, ch }: { game: GameState; ch: Challenge }) {
  const fastBots = useStore((s) => s.settings.fastBots);
  const practiced = useStore((s) => s.ropePracticed);
  const jumpers = useMemo(() => jumpersOf(game, ch), [game, ch]);
  const humans = useMemo(() => ch.participants.filter((p) => !isBotSeat(p)), [ch.participants]);
  const bots = useMemo(() => botInputsFor(ch), [ch]);
  const [stage, setStage] = useState<LocalStageName>('ready');
  const [ready, setReady] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ winner: number; inputs: Record<number, ChallengeInput[]> } | null>(null);
  const [firstTime] = useState(!practiced && humans.length > 0);
  const keys = useMemo(() => {
    const out: Record<number, string> = {};
    humans.forEach((p, k) => (out[p] = humans.length === 1 ? 'Space' : JUMP_KEYS[k].label));
    return out;
  }, [humans]);
  const demo = useDemoFeed(jumpers);
  const feed = useRef<ArenaFeed>({ now: () => -1e9, sched: ropeSchedule(ch.seed), presses: {} });
  const zero = useRef(0);

  const beginPractice = useCallback(() => {
    zero.current = performance.now() + 900;
    const sched = practiceSchedule();
    feed.current = {
      now: () => performance.now() - zero.current,
      sched,
      presses: Object.fromEntries(ch.participants.map((p, k) => [p, isBotSeat(p) ? sched.bottoms.map((b) => b - airTime(ch.multipliers[k]) / 2) : []])),
    };
    setStage('practice');
  }, [ch]);

  const beginCountdown = useCallback(() => {
    markRopePracticed();
    zero.current = performance.now() + CHALLENGE.readyMs;
    feed.current = {
      now: () => performance.now() - zero.current,
      sched: ropeSchedule(ch.seed),
      presses: Object.fromEntries(ch.participants.map((p) => [p, (bots[p] ?? []).map((i) => i.t)])),
    };
    audio.play('tick');
    setStage('countdown');
  }, [ch.seed, ch.participants, bots]);

  // Everyone ready → practice (first rope of the match) or straight to the countdown.
  useEffect(() => {
    if (stage !== 'ready') return;
    if (!humans.length) {
      const t = window.setTimeout(beginCountdown, fastBots ? 10 : 900);
      return () => clearTimeout(t);
    }
    if (ready.size === humans.length) {
      if (firstTime) beginPractice();
      else beginCountdown();
    }
  }, [stage, ready, humans.length, firstTime, beginPractice, beginCountdown, fastBots]);

  // Practice ends on its own.
  useEffect(() => {
    if (stage !== 'practice') return;
    const t = window.setTimeout(beginCountdown, 900 + practiceSchedule().totalMs);
    return () => clearTimeout(t);
  }, [stage, beginCountdown]);

  // The scored rope: decide as soon as the eight sweeps settle it (or after sudden death).
  useEffect(() => {
    if (stage !== 'countdown') return;
    const sched = feed.current.sched;
    const inputsNow = () => Object.fromEntries(ch.participants.map((p) => [p, (feed.current.presses[p] ?? []).map((t) => ({ t }))]));
    const finish = () => {
      const inputs = inputsNow();
      const v = judgeChallenge(ch, inputs);
      setResult({ winner: v.winner, inputs });
      audio.play(v.winner === ch.livingAtStart ? 'hit' : 'fanfare');
      setStage('verdict');
    };
    if (!humans.length && fastBots) {
      finish();
      return;
    }
    const at = (ms: number) => Math.max(0, zero.current + ms - performance.now());
    const early = window.setTimeout(() => {
      if (judgeChallenge(ch, inputsNow()).decidedBy === 'score') finish();
    }, at(sched.mainMs));
    const late = window.setTimeout(finish, at(sched.totalMs));
    const go = window.setTimeout(() => audio.play('go'), at(0));
    return () => [early, late, go].forEach(clearTimeout);
  }, [stage, ch, humans.length, fastBots]);

  useEffect(() => {
    if (stage !== 'verdict' || !result) return;
    const t = window.setTimeout(() => act({ type: 'challengeResult', id: ch.id, inputs: result.inputs }), fastBots && !humans.length ? 500 : 2400);
    return () => clearTimeout(t);
  }, [stage, result, ch.id, fastBots, humans.length]);

  const press = useCallback(
    (p: number) => {
      if (stage === 'ready') setReady((r) => new Set(r).add(p));
      else if (stage === 'practice' || stage === 'countdown') {
        const t = Math.round(performance.now() - zero.current);
        if (stage === 'countdown' && t < -300) return; // still counting down
        (feed.current.presses[p] ??= []).push(t);
      }
    },
    [stage],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || getState().modal) return; // holding a key is one press
      const k = humans.length === 1 && (e.code === 'Space' || e.code === 'Enter') ? 0 : JUMP_KEYS.findIndex((x) => x.code === e.code);
      if (k < 0 || k >= humans.length) return;
      e.preventDefault();
      press(humans[k]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [humans, press]);

  const showDemo = stage === 'ready' && firstTime;
  return (
    <div className="challenge-stage" role="dialog" aria-modal="true" aria-label={titleOf(ch)}>
      <div className={`arena-card kind-${ch.kind}`}>
        <h2 className="arena-title">{titleOf(ch)}</h2>
        <CurseLine jumpers={jumpers} />
        <div className="arena-view">
          <RopeArena jumpers={jumpers} feed={showDemo ? demo : feed} sounds={stage !== 'ready'} />
          {stage === 'ready' && humans.length > 0 && (
            <div className="arena-overlay">
              {firstTime && <p className="arena-teach">Jump as the rope reaches your feet</p>}
              <p className="arena-prompt">Press {humans.length === 1 ? 'Space' : 'your key'} when ready</p>
            </div>
          )}
          {stage === 'practice' && <div className="arena-banner">Practice</div>}
          {stage === 'verdict' && result && <div className="arena-banner result">{outcomeHeadline(ch, result.winner, game)}</div>}
          {(stage === 'practice' || stage === 'countdown') && <Scoreline jumpers={jumpers} feed={feed} label={stage === 'practice' ? 'Practice · not scored' : 'Jump!'} keys={keys} />}
        </div>
        <div className="arena-controls">
          {stage !== 'verdict' &&
            humans.map((p) => (
              <button
                key={p}
                className={`btn big jump-btn ${ready.has(p) && stage === 'ready' ? 'ready' : ''}`}
                style={{ borderColor: colorOf(game.pieces[p].character) }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  press(p);
                }}
              >
                {stage === 'ready' ? (ready.has(p) ? `${game.pieces[p].name} ✓` : `${game.pieces[p].name}: Ready`) : `Jump · ${game.pieces[p].name}`} <kbd>{keys[p]}</kbd>
              </button>
            ))}
          {stage === 'practice' && (
            <button className="btn ghost" onClick={beginCountdown}>
              Skip practice
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── phone rooms: the TV draws the room's timeline ───────────────────────

function RoomStage({ game, ch }: { game: GameState; ch: Challenge }) {
  const run = useStore((s) => s.room?.view?.run ?? null);
  const pieces = useStore((s) => s.room?.view?.pieces ?? []);
  const jumpers = useMemo(() => jumpersOf(game, ch), [game, ch]);
  const local = ch.participants.filter((p) => pieces[p]?.localControl);
  const demo = useDemoFeed(jumpers);
  const feed = useRef<ArenaFeed>({ now: () => -1e9, sched: ropeSchedule(ch.seed), presses: {} });
  const stage = run?.stage ?? 'ready';
  const serverNow = () => roomClient()?.serverNow() ?? Date.now();
  // Point the feed at the room's timeline; presses update as views arrive.
  if (run && stage === 'practice' && run.practiceAt !== null) {
    const at = run.practiceAt;
    feed.current = { now: () => serverNow() - at, sched: practiceSchedule(), presses: run.practicePresses };
  } else if (run && stage === 'countdown' && run.startAt !== null) {
    const at = run.startAt;
    feed.current = { now: () => serverNow() - at, sched: ropeSchedule(ch.seed), presses: run.presses };
  }
  useEffect(() => {
    if (stage === 'countdown') audio.play('tick');
  }, [stage]);
  // Pieces the host moved to the TV keyboard press here.
  useEffect(() => {
    if (!local.length || !run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = local.length === 1 && e.code === 'Space' ? 0 : JUMP_KEYS.findIndex((x) => x.code === e.code);
      if (k < 0 || k >= local.length) return;
      e.preventDefault();
      hostSend({ t: 'press', challengeId: run.id, attempt: run.attempt, at: roomClient()?.serverNow() ?? Date.now(), piece: local[k] });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const showDemo = stage === 'ready' && !!run?.practice;
  return (
    <div className="challenge-stage" role="status" aria-label={titleOf(ch)}>
      <div className={`arena-card kind-${ch.kind}`}>
        <h2 className="arena-title">{titleOf(ch)}</h2>
        <CurseLine jumpers={jumpers} />
        <div className="arena-view">
          <RopeArena jumpers={jumpers} feed={showDemo ? demo : feed} sounds={stage !== 'ready'} />
          {stage === 'ready' && (
            <div className="arena-overlay">
              {run?.practice && <p className="arena-teach">Jump as the rope reaches your feet</p>}
              <p className="arena-prompt">Press JUMP on your phone</p>
              <p className="arena-ready">
                {ch.participants.map((p) => (
                  <span key={p} className={run?.ready.includes(p) ? 'on' : ''}>
                    {game.pieces[p].name} {run?.ready.includes(p) ? '✓' : '…'}
                  </span>
                ))}
              </p>
              {run?.paused && <p className="notice">{run.paused}</p>}
              {run?.note && <p className="muted small">{run.note}</p>}
              {local.length > 0 && <p className="muted small">TV keyboard: {local.map((p, k) => `${game.pieces[p].name} = ${local.length === 1 ? 'Space' : JUMP_KEYS[k].label}`).join(' · ')}</p>}
            </div>
          )}
          {stage === 'practice' && <div className="arena-banner">Practice</div>}
          {stage !== 'ready' && <Scoreline jumpers={jumpers} feed={feed} label={stage === 'practice' ? 'Practice · not scored' : 'Jump!'} />}
          {run && run.lagging.length > 0 && <p className="arena-lag">{run.lagging.map((p) => game.pieces[p].name).join(', ')}: phone is lagging — host Menu → TV keyboard</p>}
        </div>
        {stage === 'practice' && (
          <div className="arena-controls">
            <button className="btn ghost" onClick={() => hostSend({ t: 'skipPractice' })}>
              Skip practice
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** After a phone-room rope ends, a short result on the TV before play moves on. */
export function ResultFlash({ outcome, game }: { outcome: ChallengeOutcome; game: GameState }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 2600);
    return () => clearTimeout(t);
  }, [outcome.challengeId]);
  if (!show) return null;
  const winner = game.pieces[outcome.winner];
  const text = outcome.reward ? `${winner.name} wins an item` : outcome.transferred ? `${winner.name} steals life` : `${winner.name} keeps life`;
  return (
    <div className="result-flash" role="status" onClick={() => setShow(false)}>
      <span style={{ borderColor: colorOf(winner.character) }}>{text}</span>
    </div>
  );
}
