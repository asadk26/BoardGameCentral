import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CHARACTERS, NODE_COUNT, ROUNDS, type CharacterId } from '../engine/config';
import { actingPiece, finalScores, legalRoutes, livingPiece, previewMove } from '../engine/engine';
import { inAttackRange } from '../engine/graph';
import type { GameState } from '../engine/types';
import { LifeFlame, Reapers, TransformBurst, useSpectral, WallLinks, type KnownTrap } from './Reaper';
import { director, type Popup } from '../director';
import { getState, useStore, act, setState } from '../store';
import { Base, CharacterModel } from './Characters';
import { MansionProps } from './Props';
import { Beacon, Corridors, Ground, Label, NodeHitAreas, Passages, PathDots, Ring, RoomLabels, Tiles, VersusLabels, Walls } from './Board';
import { labelTexture, badgeTexture } from './labels';
import { lineupPos, nodePos, playerHeading, playerSlot, type V3 } from './layout';
import { camInfo, hudInsets } from './shared';

export const charColor = (id: CharacterId) => CHARACTERS.find((c) => c.id === id)!.color;

type SceneMode = 'showcase' | 'game' | 'results';

function dampAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// ── miniatures ──────────────────────────────────────────────────────────

function Piece({ index, mode, rank, winner }: { index: number; mode: SceneMode; rank: number; winner: boolean }) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const cur = useRef<THREE.Vector3 | null>(null);
  const yaw = useRef(Math.PI);
  const game = useStore((s) => s.session?.game);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const overview = useStore((s) => s.cameraMode === 'overview');
  const p = game?.pieces[index];
  const isActive = mode === 'game' && !!game && actingPiece(game) === index && game.phase !== 'gameOver';
  const { camera } = useThree();
  const started = !!game && game.phase !== 'placement' && game.phase !== 'lifeRoll';
  const spectral = started && !!p && !p.alive;
  useSpectral(inner, spectral, p ? charColor(p.character) : '#fff');

  useFrame(({ clock }, dt) => {
    const g = getState().session?.game;
    if (!g || !outer.current || !inner.current) return;
    const pose = mode === 'game' ? director.pose(index) : null;
    let front: number | null = null;
    if (mode === 'game' && getState().cameraMode === 'follow') {
      const [nx, , nz] = nodePos(g.pieces[index].node);
      front = Math.atan2(camera.position.x - nx, camera.position.z - nz);
    }
    const target: V3 = mode === 'results' ? lineupPos(rank, g.pieces.length) : playerSlot(g, index, front);
    if (!cur.current) cur.current = new THREE.Vector3(...target);
    if (pose) cur.current.set(...pose.pos);
    else cur.current.lerp(new THREE.Vector3(...target), 1 - Math.exp(-dt * 9));
    outer.current.position.copy(cur.current);
    director.rendered.set(index, [cur.current.x, cur.current.y, cur.current.z]);

    let desired: number;
    if (pose?.heading != null) desired = pose.heading;
    else if (mode === 'results') desired = 0;
    else if (isActive && getState().cameraMode === 'follow') desired = playerHeading(g, index);
    else desired = Math.atan2(camera.position.x - cur.current.x, camera.position.z - cur.current.z);
    yaw.current = dampAngle(yaw.current, desired, 1 - Math.exp(-dt * 8));
    outer.current.rotation.y = yaw.current;

    const t = clock.elapsedTime + index * 0.7;
    const i = inner.current;
    if (pose?.fright) {
      i.rotation.set(-0.35, 0, Math.sin(t * 40) * 0.12);
      i.scale.set(1.05, 0.9 + Math.abs(Math.sin(t * 20)) * 0.15, 1.05);
      i.position.y = 0;
    } else if (mode === 'results' && winner) {
      const j = Math.abs(Math.sin(t * 3.2));
      i.position.y = reduced ? 0.05 : j * 0.35;
      i.rotation.set(0, reduced ? 0 : Math.sin(t * 1.6) * 0.6, 0);
      i.scale.set(1, 1 + (1 - j) * 0.06, 1);
    } else if (g.phase !== 'placement' && g.phase !== 'lifeRoll' && !g.pieces[index].alive) {
      // Ghosts float and sway a little above their base.
      i.position.y = 0.32 + (reduced ? 0 : Math.sin(t * 1.6) * 0.07);
      i.rotation.set(0, 0, reduced ? 0 : Math.sin(t * 1.1) * 0.06);
      i.scale.set(1, 1, 1);
    } else {
      i.position.y = reduced ? 0 : Math.sin(t * 2.2) * 0.025 + 0.02;
      i.rotation.set(0, 0, pose?.moving ? Math.sin(t * 18) * 0.08 : 0);
      i.scale.set(1, 1, 1);
    }
  });

  if (!p) return null;
  const color = charColor(p.character);
  const scale = mode === 'results' ? 1.1 : 0.66;
  return (
    <group ref={outer}>
      <group scale={scale}>
        <Base color={color} number={index + 1} />
        <group ref={inner}>
          <CharacterModel id={p.character} />
        </group>
      </group>
      {isActive && <ActiveRing color={color} />}
      {p.alive && mode !== 'showcase' && <LifeFlame reduced={reduced} />}
      <NameTag index={index} name={p.name} color={color} big={isActive || overview || mode === 'results'} y={mode === 'results' ? 1.75 : 1.05} />
    </group>
  );
}

function ActiveRing({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(clock.elapsedTime * 4) * 0.25;
  });
  return (
    <mesh ref={ref} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.27, 0.36, 32]} />
      <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function NameTag({ index, name, color, big, y }: { index: number; name: string; color: string; big: boolean; y: number }) {
  const badge = useMemo(() => badgeTexture(String(index + 1), color), [index, color]);
  const tag = useMemo(() => labelTexture([`${index + 1} · ${name}`], { border: color, height: 80 }), [index, name, color]);
  if (!big)
    return (
      <sprite position={[0, y - 0.1, 0]} scale={[0.2, 0.2, 1]} renderOrder={6}>
        <spriteMaterial map={badge} depthTest={false} transparent />
      </sprite>
    );
  const h = 0.22;
  return (
    <sprite position={[0, y, 0]} scale={[h * tag.aspect, h, 1]} renderOrder={6}>
      <spriteMaterial map={tag.tex} depthTest={false} transparent />
    </sprite>
  );
}

function ShowcaseLineup({ interactive }: { interactive: boolean }) {
  const setupPlayers = useStore((s) => s.setupPieces);
  const editing = useStore((s) => s.editingPlayer);
  return (
    <group>
      {CHARACTERS.map((c, i) => {
        const owner = setupPlayers.findIndex((p) => p.character === c.id);
        return (
          <ShowcaseFigure
            key={c.id}
            id={c.id}
            index={i}
            owner={interactive ? owner : -1}
            editingThis={interactive && owner === editing}
            onPick={
              interactive
                ? () => {
                    const s = getState();
                    const players = s.setupPieces.map((p) => ({ ...p }));
                    const me = players[s.editingPlayer];
                    if (!me) return;
                    const other = players.findIndex((p) => p.character === c.id);
                    if (other >= 0) players[other].character = me.character;
                    me.character = c.id;
                    setState({ setupPieces: players });
                  }
                : undefined
            }
          />
        );
      })}
    </group>
  );
}

function ShowcaseFigure({
  id,
  index,
  owner,
  editingThis,
  onPick,
}: {
  id: CharacterId;
  index: number;
  owner: number;
  editingThis: boolean;
  onPick?: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const reduced = useStore((s) => s.settings.reducedMotion);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime + index;
    ref.current.position.y = reduced ? 0 : editingThis ? Math.abs(Math.sin(t * 4)) * 0.18 : Math.sin(t * 2) * 0.03;
    ref.current.rotation.y = reduced ? 0 : Math.sin(t * 0.8) * 0.25;
  });
  const pos = lineupPos(index, 6);
  const color = charColor(id);
  const label = useMemo(() => labelTexture([CHARACTERS[index].name], { border: owner >= 0 ? color : 'rgba(255,255,255,0.25)', height: 72 }), [index, owner, color]);
  return (
    <group
      position={pos}
      onClick={(e) => {
        e.stopPropagation();
        onPick?.();
      }}
      onPointerOver={() => {
        if (!onPick) return;
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = '';
      }}
    >
      <group scale={hover ? 1.18 : 1.1}>
        <Base color={owner >= 0 ? color : '#5a4d66'} number={owner >= 0 ? owner + 1 : index + 1} />
        <group ref={ref}>
          <CharacterModel id={id} />
        </group>
      </group>
      <sprite position={[0, 1.55, 0]} scale={[0.32 * label.aspect, 0.32, 1]}>
        <spriteMaterial map={label.tex} transparent depthTest={false} />
      </sprite>
      {owner >= 0 && (
        <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.44, 0.52, 32]} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={editingThis ? 1 : 0.5} />
        </mesh>
      )}
    </group>
  );
}

// ── popups (Life stolen!, +1 point) ──────────────────────────────────────

function Popups() {
  const [list, setList] = useState<Popup[]>([]);
  const key = useRef('');
  useFrame(() => {
    const k = director.popups.map((p) => p.id).join(',');
    if (k !== key.current) {
      key.current = k;
      setList(director.popups.slice());
    }
  });
  return (
    <group>
      {list.map((p) => (
        <PopupSprite key={p.id} p={p} />
      ))}
    </group>
  );
}

function PopupSprite({ p }: { p: Popup }) {
  const ref = useRef<THREE.Sprite>(null);
  const { tex, aspect } = useMemo(() => labelTexture([p.text], { fg: '#1a1024', bg: p.color, height: 84 }), [p.text, p.color]);
  useFrame(() => {
    const s = ref.current;
    if (!s) return;
    const age = performance.now() / 1000 - p.t0;
    s.visible = age >= 0;
    const u = Math.max(0, age) / 1.8;
    s.position.set(p.pos[0], p.pos[1] + u * 0.8, p.pos[2]);
    (s.material as THREE.SpriteMaterial).opacity = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
  });
  const h = 0.42;
  return (
    <sprite ref={ref} scale={[h * aspect, h, 1]} renderOrder={10} visible={false}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  );
}

// ── highlights driven by the current phase ──────────────────────────────

function GameHighlights() {
  const game = useStore((s) => s.session?.game);
  const hover = useStore((s) => s.hoverNode);
  const overview = useStore((s) => s.cameraMode === 'overview');
  const busy = useStore((s) => s.busy);
  if (!game || game.phase === 'placement' || game.phase === 'lifeRoll' || game.phase === 'gameOver') return null;
  const actingIdx = actingPiece(game);
  const me = game.pieces[actingIdx];
  const living = livingPiece(game);
  const livingNode = game.pieces[living].node;

  let reachable: number[] = [];
  let preview = null as ReturnType<typeof previewMove>;
  if (game.phase === 'choose') {
    reachable = [...legalRoutes(game).keys()];
    const sel = game.selection.dest;
    if (sel !== null) preview = previewMove(game, sel);
  }
  const pickable = new Set<number>(busy ? [] : reachable);
  const hoverPreview = game.phase === 'choose' && hover !== null && hover !== game.selection.dest && reachable.includes(hover) ? previewMove(game, hover) : null;
  // A ghost's attack range: the living piece's space and its ordinary neighbours.
  const showRange = !me.alive && (game.phase === 'choose' || game.phase === 'hunt');
  const range = showRange ? Array.from({ length: NODE_COUNT }, (_, n) => n).filter((n) => inAttackRange(n, livingNode)) : [];

  return (
    <group>
      {reachable.map((id) => (
        <Ring key={`r${id}`} id={id} color={id === game.selection.dest ? '#fff1b8' : hover === id ? '#ffd36b' : '#f2a93b'} strength={id === game.selection.dest ? 2 : 1} pulse={id !== game.selection.dest} />
      ))}
      {range.map((id) => (
        <Ring key={`a${id}`} id={id} color="#ff5a6a" radius={0.66} strength={0.7} pulse={false} />
      ))}
      {hoverPreview && <PathDots path={hoverPreview.path} color="#ffd36b" size={0.05} />}
      {preview && preview.dest !== 'stay' && (
        <>
          <PathDots path={preview.path} color="#fff1b8" />
          <Beacon id={preview.dest} color={preview.canChallenge ? '#ff5a6a' : '#fff1b8'} />
        </>
      )}
      {game.phase === 'hunt' && !busy && <Beacon id={livingNode} color="#ff5a6a" />}
      {me.alive && game.phase === 'choose' && preview && preview.threats.map((t) => <Ring key={`t${t}`} id={game.pieces[t].node} color="#7ff5e6" radius={0.6} strength={1.4} />)}
      {overview && game.phase === 'turnStart' && <Ring id={me.node} color={charColor(me.character)} radius={0.62} />}
      <NodeHitAreas
        pickable={pickable}
        onHover={(id) => setState({ hoverNode: id })}
        onPick={(id) => {
          const g = getState().session?.game;
          if (g?.phase === 'choose') act({ type: 'select', dest: id });
        }}
      />
    </group>
  );
}

// ── lights and atmosphere ───────────────────────────────────────────────

const WARM_LIGHTS: Array<{ p: V3; c: string; i: number }> = [
  { p: [0, 1.8, 8.6], c: '#ffb45a', i: 6 },
  { p: [-5.6, 1.4, 5.9], c: '#ff9a4a', i: 4 },
  { p: [-10.7, 1.5, 5.6], c: '#ffb45a', i: 4 },
  { p: [5.6, 1.4, 5.9], c: '#ffb45a', i: 4 },
  { p: [0, 2.2, 3.2], c: '#ffc070', i: 6 },
  { p: [0, 1.6, -5.6], c: '#9fb4ff', i: 5 },
  { p: [8.0, 1.4, -1.4], c: '#7dffb0', i: 4 },
  { p: [10.8, 1.4, 5.4], c: '#ff9ad5', i: 4 },
];

function Atmosphere({ midnight }: { midnight: boolean }) {
  const { scene } = useThree();
  const hemi = useRef<THREE.HemisphereLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const warm = useRef<(THREE.PointLight | null)[]>([]);
  const level = useRef(midnight ? 1 : 0);
  useEffect(() => {
    scene.background = new THREE.Color('#150d24');
    scene.fog = new THREE.Fog('#150d24', 38, 80);
  }, [scene]);
  useFrame(({ clock }, dt) => {
    level.current += ((midnight ? 1 : 0) - level.current) * (1 - Math.exp(-dt * 0.8));
    const m = level.current;
    if (hemi.current) hemi.current.intensity = 1.0 - m * 0.4;
    if (moon.current) {
      moon.current.intensity = 1.25 - m * 0.45;
      moon.current.color.set('#c5ccff').lerp(new THREE.Color('#7f8cff'), m);
    }
    const t = clock.elapsedTime;
    warm.current.forEach((l, i) => {
      if (!l) return;
      const flicker = 1 + Math.sin(t * (7 + i) + i) * 0.06 * (1 + m * 2) + Math.sin(t * 17 + i * 3) * 0.03;
      l.intensity = WARM_LIGHTS[i].i * flicker * (1 - m * 0.3);
    });
    (scene.background as THREE.Color).set('#150d24').lerp(new THREE.Color('#0b0716'), m);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#8a78c8', '#231634', 1]} />
      <ambientLight intensity={0.12} />
      <directionalLight
        ref={moon}
        position={[-9, 18, 7]}
        intensity={1.25}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-17}
        shadow-camera-right={17}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
      {WARM_LIGHTS.map((l, i) => (
        <pointLight key={i} ref={(r) => (warm.current[i] = r)} position={l.p} color={l.c} intensity={l.i} distance={7} decay={1.6} />
      ))}
    </>
  );
}

// ── camera ──────────────────────────────────────────────────────────────

function CameraRig({ mode }: { mode: SceneMode }) {
  const { camera, size, gl } = useThree();
  const pos = useRef(new THREE.Vector3(0, 9, 24));
  const look = useRef(new THREE.Vector3(0, 0.5, 9));
  const yaw = useRef(Math.PI);
  const zoom = useRef(1);
  const lastTurn = useRef(-1);
  const viewKey = useRef('');
  const overviewMode = useStore((s) => s.cameraMode === 'overview');

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      if (getState().cameraMode !== 'overview' || mode !== 'game') return;
      e.preventDefault();
      zoom.current = Math.min(1, Math.max(0.45, zoom.current * (e.deltaY > 0 ? 1.08 : 0.92)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, mode]);

  useEffect(() => {
    if (!overviewMode) zoom.current = 1;
  }, [overviewMode]);

  const get = useThree((s) => s.get);
  useEffect(() => {
    // Lets automated checks click a real board space: node id → canvas pixel.
    const handle = (globalThis as unknown as { __omr?: Record<string, unknown> }).__omr;
    if (!handle) return;
    handle.project = (id: number) => {
      const { camera: c, size: sz } = get();
      const v = new THREE.Vector3(...nodePos(id, 0.2)).project(c);
      return { x: ((v.x + 1) / 2) * sz.width, y: ((1 - v.y) / 2) * sz.height, visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
    };
  }, [get]);

  useFrame(({ clock }, dt) => {
    director.tick();
    const st = getState();
    const g = st.session?.game;
    const calm = st.settings.calmCamera || st.settings.reducedMotion;
    const cam = camera as THREE.PerspectiveCamera;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    let focus = new THREE.Vector3();
    let rate = 3.2;

    if (mode === 'showcase') {
      const t = calm ? 0 : clock.elapsedTime * 0.12;
      desiredPos.set(Math.sin(t) * 3.5, 4.4, 19.8);
      desiredLook.set(0, 1.1, 9.5);
      focus.set(0, 0, 11);
      rate = 1.5;
    } else if (mode === 'results' || !g) {
      // Back off far enough that the whole podium fits beside the score panel.
      const n = g?.pieces.length ?? 6;
      const tanH = Math.tan((cam.fov * Math.PI) / 360) * (size.width / size.height);
      const fracH = Math.max(0.4, (size.width - hudInsets.left - hudInsets.right) / size.width);
      const d = Math.max(6.2, (n * 1.35 + 1.6) / (2 * tanH * fracH));
      desiredPos.set(0, 1.4 + d * 0.36, 11.6 + d);
      desiredLook.set(0, 0.8, 11.6);
      focus.set(0, 0, 11);
      rate = 2;
    } else if (g.phase === 'challenge' && g.challenge && g.challenge.kind === 'duel' && !calm) {
      // Frame the encounter; the chosen camera mode resumes afterwards.
      const [cx, , cz] = nodePos(g.challenge.node, 0);
      focus.set(cx, 0, cz);
      const fwd = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
      desiredPos.copy(focus).addScaledVector(fwd, -4.2).add(new THREE.Vector3(0, 3.4, 0));
      desiredLook.copy(focus).add(new THREE.Vector3(0, 0.6, 0));
      rate = 2.4;
    } else if (st.cameraMode === 'overview') {
      const fov = (cam.fov * Math.PI) / 180;
      const tanV = Math.tan(fov / 2);
      const tanH = tanV * (size.width / size.height);
      const fracV = Math.max(0.35, (size.height - hudInsets.top - hudInsets.bottom) / size.height);
      const fracH = Math.max(0.4, (size.width - hudInsets.left - hudInsets.right) / size.width);
      const H = Math.max(21.0 / (2 * tanV * fracV), 27.2 / (2 * tanH * fracH)) * 1.02 * zoom.current;
      const center = new THREE.Vector3(0, 0, 2.0);
      const active = director.rendered.get(actingPiece(g));
      if (active && zoom.current < 1) {
        const f = (1 - zoom.current) / 0.55;
        center.lerp(new THREE.Vector3(active[0], 0, active[2]), f);
      }
      desiredPos.set(center.x, H, center.z + H * 0.14);
      desiredLook.copy(center);
      focus = center.clone();
      rate = 4;
    } else {
      const who = actingPiece(g);
      const active = director.rendered.get(who) ?? playerSlot(g, who);
      const pose = director.pose(who);
      const desiredYaw = pose?.heading ?? playerHeading(g, who);
      if (lastTurn.current !== g.actionNumber) {
        lastTurn.current = g.actionNumber;
        if (calm) yaw.current = desiredYaw;
      }
      yaw.current = dampAngle(yaw.current, desiredYaw, 1 - Math.exp(-dt * (calm ? 6 : 1.8)));
      const fwd = new THREE.Vector3(Math.sin(yaw.current), 0, Math.cos(yaw.current));
      focus.set(active[0], 0, active[2]);
      desiredPos.copy(focus).addScaledVector(fwd, -5.0).add(new THREE.Vector3(0, 4.6, 0));
      desiredLook.copy(focus).addScaledVector(fwd, 2.4).add(new THREE.Vector3(0, 0, 0));
      rate = calm ? 8 : 3.2;
    }

    // Centre the picture in the part of the screen the HUD leaves free.
    const inGame = mode === 'game' || mode === 'results';
    const ox = inGame ? Math.round((hudInsets.right - hudInsets.left) / 2) : 0;
    const oy = inGame ? Math.round((hudInsets.bottom - hudInsets.top) / 2) : 0;
    const key = `${size.width}x${size.height}:${ox},${oy}`;
    if (key !== viewKey.current) {
      viewKey.current = key;
      if (ox || oy) cam.setViewOffset(size.width, size.height, ox, oy, size.width, size.height);
      else cam.clearViewOffset();
    }

    const k = 1 - Math.exp(-dt * rate);
    pos.current.lerp(desiredPos, k);
    look.current.lerp(desiredLook, k);
    // Never dip below the wall tops.
    if (pos.current.y < 2.2) pos.current.y = 2.2;
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    camInfo.position = [pos.current.x, pos.current.y, pos.current.z];
    camInfo.focus = [focus.x, 0, focus.z];

  });
  return null;
}

// ── composition ─────────────────────────────────────────────────────────

function World() {
  const screen = useStore((s) => s.screen);
  const game = useStore((s) => s.session?.game ?? null);
  const pz = useStore((s) => s.personalization);
  const overview = useStore((s) => s.cameraMode === 'overview');
  const reduced = useStore((s) => s.settings.reducedMotion);
  const knownLedger = useStore((s) => s.session?.known);
  const known = useMemo<KnownTrap[]>(() => {
    const list: KnownTrap[] = (game?.traps ?? []).filter((t) => t.revealed).map((t) => ({ node: t.node, effect: t.effect, spent: t.spent }));
    for (const k of knownLedger ?? []) if (!list.some((t) => t.node === k.node)) list.push({ node: k.node, effect: k.effect, spent: false });
    return list;
  }, [knownLedger, game]);
  const mode: SceneMode = screen !== 'game' || !game || game.phase === 'placement' ? 'showcase' : game.phase === 'gameOver' || game.phase === 'lifeRoll' ? 'results' : 'game';
  const results = useMemo(() => (game && game.phase === 'gameOver' ? finalScores(game) : null), [game]);
  const ch = game?.challenge;
  const phantom = ch && ch.kind === 'duel' && !ch.contact ? ch.participants.find((p) => game!.pieces[p].node !== ch.node) : undefined;
  return (
    <>
      <Atmosphere midnight={!!game && game.round >= ROUNDS - 2 && mode !== 'showcase'} />
      <CameraRig mode={mode} />
      <Ground />
      <Corridors />
      <Walls fade={mode === 'game' && !overview} />
      <Tiles />
      <Passages strong={overview || mode !== 'game'} />
      <MansionProps round={game?.round ?? 1} />
      {mode !== 'results' && <RoomLabels roomNames={pz.roomNames} />}
      {mode !== 'results' && <VersusLabels />}
      {mode !== 'game' && <Label pos={[0, 2.6, 10.6]} lines={[pz.mansionName]} scale={0.8} color="#f2b84b" />}
      <Reapers revealed={game && mode !== 'showcase' ? known : []} reduced={reduced} seancesUsed={game?.seancesUsed ?? 0} />
      <WallLinks strong={overview && mode === 'game'} />
      {game && mode === 'game' && <Bursts game={game} />}
      {phantom !== undefined && ch && <SummonedPhantom character={game!.pieces[phantom].character} node={ch.node} />}
      {mode === 'showcase' && <ShowcaseLineup interactive={screen === 'setup'} />}
      {game && mode !== 'showcase' && (
        <>
          {game.pieces.map((p, i) => (
            <Piece
              key={p.id}
              index={i}
              mode={mode}
              rank={results ? results.findIndex((l) => l.piece === i) : i}
              winner={!!results?.find((l) => l.piece === i)?.winner}
            />
          ))}
          {mode === 'game' && <GameHighlights />}
          <Popups />
        </>
      )}
    </>
  );
}

/** A burst of light whenever life changes hands: gold where it arrives, teal where it leaves. */
function Bursts({ game }: { game: GameState }) {
  const prev = useRef<boolean[]>(game.pieces.map((p) => p.alive));
  const [bursts, setBursts] = useState<Array<{ id: number; at: V3; living: boolean }>>([]);
  useEffect(() => {
    const changed = game.pieces.map((p, i) => (prev.current[i] !== p.alive ? i : -1)).filter((i) => i >= 0);
    prev.current = game.pieces.map((p) => p.alive);
    if (changed.length) setBursts((b) => [...b, ...changed.map((i) => ({ id: Date.now() + i, at: nodePos(game.pieces[i].node, 0), living: game.pieces[i].alive }))]);
  }, [game]);
  return (
    <>
      {bursts.map((b) => (
        <TransformBurst key={b.id} at={b.at} living={b.living} onDone={() => setBursts((x) => x.filter((y) => y.id !== b.id))} />
      ))}
    </>
  );
}

/** A remote Reaper's Challenge summons the far opponent's likeness; their piece stays put. */
function SummonedPhantom({ character, node }: { character: CharacterId; node: number }) {
  const ref = useRef<THREE.Group>(null);
  useSpectral(ref, true, '#ff3d6e');
  const [x, , z] = nodePos(node, 0);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 0.2 + Math.sin(clock.elapsedTime * 2) * 0.05;
  });
  return (
    <group position={[x + 0.35, 0.14, z + 0.35]} scale={0.66}>
      <group ref={ref}>
        <CharacterModel id={character} />
      </group>
    </group>
  );
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function GameCanvas() {
  const low = useStore((s) => s.settings.lowGraphics);
  return (
    <Canvas
      key={low ? 'low' : 'high'}
      className="board-canvas"
      shadows={!low}
      dpr={low ? 1 : [1, 1.75]}
      camera={{ fov: 45, near: 0.1, far: 140, position: [0, 9, 24] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => setState({ hoverNode: null })}
    >
      <Suspense fallback={null}>
        <World />
      </Suspense>
    </Canvas>
  );
}
