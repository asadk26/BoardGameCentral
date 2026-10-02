// Death's side of the mansion: revealed traps (Reapers, Séance circles,
// Poltergeists), the ever-visible Super Reaper, ghost-only wall links,
// spectral miniatures, the living flame and transformation bursts. Only
// public facts reach this file — hidden traps are never passed in, so
// nothing here can light, sound or load differently.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GHOST_WALL_LINKS, SEANCE_LIMIT, SUPER_REAPER, type TrapEffect } from '../engine/config';
import { nodePos, nodeXZ, type V3 } from './layout';
import { Label } from './Board';

function ReaperModel({ glow = '#b36bff', scale = 1 }: { glow?: string; scale?: number }) {
  const blade = useMemo(() => new THREE.TorusGeometry(0.32, 0.035, 6, 20, Math.PI * 0.75), []);
  return (
    <group scale={scale}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <coneGeometry args={[0.36, 1.1, 14, 1, true]} />
        <meshStandardMaterial color="#17111f" roughness={0.9} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh position={[0, 1.08, -0.02]} castShadow>
        <sphereGeometry args={[0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshStandardMaterial color="#17111f" roughness={0.9} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh position={[0, 1.0, 0.05]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color="#e9e2cf" roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.05, 1.02, 0.17]}>
          <sphereGeometry args={[0.028, 8, 6]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`a${s}`} position={[s * 0.26, 0.72, 0.08]} rotation={[0.5, 0, s * 0.5]} castShadow>
          <capsuleGeometry args={[0.05, 0.3, 4, 8]} />
          <meshStandardMaterial color="#17111f" roughness={0.9} />
        </mesh>
      ))}
      <group position={[0.34, 0.8, 0.12]} rotation={[0.1, 0, -0.18]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.022, 0.022, 1.5, 6]} />
          <meshStandardMaterial color="#4a3526" />
        </mesh>
        <mesh geometry={blade} position={[-0.25, 0.68, 0]} rotation={[0, 0, Math.PI * 0.35]}>
          <meshStandardMaterial color="#cfd6e6" metalness={0.8} roughness={0.25} emissive={glow} emissiveIntensity={0.25} />
        </mesh>
      </group>
      <pointLight color={glow} intensity={1.6} distance={2.6} position={[0, 1.1, 0.4]} />
    </group>
  );
}

/** A Reaper beside a revealed trap: it rises when it first appears, then stays. */
function RevealedReaper({ node, reduced }: { node: number; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  const [x, , z] = nodePos(node, 0);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (born.current === null) born.current = clock.elapsedTime;
    const u = reduced ? 1 : Math.min(1, (clock.elapsedTime - born.current) / 1.3);
    const ease = 1 - Math.pow(1 - u, 3);
    ref.current.position.set(x + 0.52, -1.1 + ease * 1.1 + (reduced ? 0 : Math.sin(clock.elapsedTime * 1.4 + node) * 0.04), z - 0.35);
    ref.current.scale.setScalar(0.62 * (0.4 + 0.6 * ease));
  });
  return (
    <group>
      <group ref={ref}>
        <ReaperModel />
      </group>
      <mesh position={[x, 0.16, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.46, 0.56, 36]} />
        <meshBasicMaterial color="#b36bff" transparent opacity={0.85} toneMapped={false} />
      </mesh>
    </group>
  );
}

function SuperReaper({ reduced, effect, seancesLeft }: { reduced: boolean; effect: 'seance' | 'reaper'; seancesLeft: number }) {
  const ref = useRef<THREE.Group>(null);
  const [x, , z] = nodePos(SUPER_REAPER, 0);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = reduced ? 0 : Math.sin(clock.elapsedTime * 1.1) * 0.06;
    ref.current.rotation.y = Math.PI / 2 + (reduced ? 0 : Math.sin(clock.elapsedTime * 0.5) * 0.25);
  });
  const glow = effect === 'seance' ? '#ff3d6e' : '#b36bff';
  return (
    // Beside the space on its open east side (no corridor arrives from there), so it never stands between the camera and a piece.
    <group position={[x + 1.0, 0, z]}>
      <group ref={ref}>
        <ReaperModel glow={glow} scale={0.72} />
      </group>
      <mesh position={[-1.0, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.44, 0.6, 36]} />
        <meshBasicMaterial color={glow} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <Label
        pos={[0.2, 1.5, 0]}
        lines={['Super Reaper', effect === 'seance' ? `Séance · ${seancesLeft} left` : 'Reaper’s Challenge']}
        scale={0.4}
        color={effect === 'seance' ? '#ff7b98' : '#d6a6ff'}
      />
    </group>
  );
}

/** A ring of candles round a revealed Séance tile; guttered once it has been used. */
function SeanceCircle({ node, spent, reduced }: { node: number; spent: boolean; reduced: boolean }) {
  const flames = useRef<THREE.Group>(null);
  const [x, , z] = nodePos(node, 0);
  useFrame(({ clock }) => {
    flames.current?.children.forEach((c, k) => {
      c.scale.setScalar(spent ? 0.001 : 0.8 + (reduced ? 0.1 : Math.abs(Math.sin(clock.elapsedTime * 7 + k * 1.7)) * 0.35));
    });
  });
  const n = 6;
  return (
    <group position={[x, 0.14, z]}>
      {Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2;
        return (
          <mesh key={k} position={[Math.cos(a) * 0.5, 0.09, Math.sin(a) * 0.5]}>
            <cylinderGeometry args={[0.045, 0.05, 0.18, 8]} />
            <meshStandardMaterial color={spent ? '#6b6272' : '#f3e6c8'} roughness={0.6} />
          </mesh>
        );
      })}
      <group ref={flames}>
        {Array.from({ length: n }, (_, k) => {
          const a = (k / n) * Math.PI * 2;
          return (
            <mesh key={k} position={[Math.cos(a) * 0.5, 0.24, Math.sin(a) * 0.5]}>
              <coneGeometry args={[0.035, 0.1, 6]} />
              <meshBasicMaterial color="#ffb347" toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.38, 0.44, 36]} />
        <meshBasicMaterial color={spent ? '#4d4458' : '#ff7b98'} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      {!spent && <pointLight color="#ffb347" intensity={1.2} distance={2.2} position={[0, 0.6, 0]} />}
      <Label pos={[0, 1.0, 0]} lines={[spent ? 'Séance (used)' : 'Séance']} scale={0.34} color={spent ? '#a79db3' : '#ff9fb4'} />
    </group>
  );
}

/** A little storm of floating furniture over a revealed Poltergeist. */
function PoltergeistSwirl({ node, reduced }: { node: number; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const [x, , z] = nodePos(node, 0);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = reduced ? 0 : clock.elapsedTime;
    ref.current.rotation.y = t * 0.9;
    ref.current.children.forEach((c, k) => {
      c.position.y = 0.55 + k * 0.12 + Math.sin(t * 2 + k) * 0.08;
      c.rotation.set(t * (0.7 + k * 0.2), t * 0.5, t * 0.3 * k);
    });
  });
  return (
    <group position={[x, 0.1, z]}>
      <group ref={ref}>
        <mesh position={[0.34, 0.55, 0]}>
          <boxGeometry args={[0.16, 0.2, 0.05]} />
          <meshStandardMaterial color="#7a4a2e" roughness={0.8} />
        </mesh>
        <mesh position={[-0.3, 0.7, 0.15]}>
          <boxGeometry args={[0.14, 0.04, 0.2]} />
          <meshStandardMaterial color="#3f6fb3" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.8, -0.32]}>
          <cylinderGeometry args={[0.05, 0.07, 0.14, 8]} />
          <meshStandardMaterial color="#d9d2c0" roughness={0.4} />
        </mesh>
      </group>
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.44, 0.52, 36]} />
        <meshBasicMaterial color="#8fd0ff" transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <Label pos={[0, 1.35, 0]} lines={['Poltergeist']} scale={0.34} color="#a9dcff" />
    </group>
  );
}

export interface KnownTrap {
  node: number;
  effect: TrapEffect;
  spent: boolean;
}

export function Reapers({ revealed, reduced, seancesUsed }: { revealed: readonly KnownTrap[]; reduced: boolean; seancesUsed: number }) {
  const left = Math.max(0, SEANCE_LIMIT - seancesUsed);
  return (
    <group>
      <SuperReaper reduced={reduced} effect={left > 0 ? 'seance' : 'reaper'} seancesLeft={left} />
      {revealed.map((t) =>
        t.effect === 'reaper' ? (
          <RevealedReaper key={t.node} node={t.node} reduced={reduced} />
        ) : t.effect === 'seance' ? (
          <SeanceCircle key={t.node} node={t.node} spent={t.spent} reduced={reduced} />
        ) : (
          <PoltergeistSwirl key={t.node} node={t.node} reduced={reduced} />
        ),
      )}
    </group>
  );
}

/** Ghost-only links straight through a wall: dotted spectral arcs. */
export function WallLinks({ strong }: { strong: boolean }) {
  const pts = useMemo(
    () =>
      GHOST_WALL_LINKS.map(([a, b]) => {
        const [ax, az] = nodeXZ(a);
        const [bx, bz] = nodeXZ(b);
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(ax, 0.3, az), new THREE.Vector3((ax + bx) / 2, 1.5, (az + bz) / 2), new THREE.Vector3(bx, 0.3, bz));
        return Array.from({ length: 18 }, (_, k) => curve.getPoint((k + 0.5) / 18));
      }),
    [],
  );
  return (
    <group>
      {pts.map((line, i) => (
        <group key={i}>
          {line.map((p, k) => (
            <mesh key={k} position={p}>
              <sphereGeometry args={[strong ? 0.06 : 0.045, 6, 4]} />
              <meshBasicMaterial color="#5ff2e0" transparent opacity={strong ? 0.8 : 0.4} toneMapped={false} />
            </mesh>
          ))}
          {strong && <Label pos={[line[9].x, line[9].y + 0.35, line[9].z]} lines={['ghosts only']} scale={0.3} color="#5ff2e0" />}
        </group>
      ))}
    </group>
  );
}

/** Turn every material in a model spectral (or back), keeping its shapes and props. */
export function useSpectral(group: React.RefObject<THREE.Group | null>, spectral: boolean, tint: string) {
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const ud = mesh.userData as { original?: THREE.Material | THREE.Material[] };
      if (spectral) {
        if (!ud.original) ud.original = mesh.material;
        const src = Array.isArray(ud.original) ? ud.original[0] : ud.original;
        const m = (src as THREE.MeshStandardMaterial).clone();
        m.transparent = true;
        m.opacity = 0.55;
        m.depthWrite = false;
        if ('color' in m) m.color = new THREE.Color(m.color).lerp(new THREE.Color('#d8fff9'), 0.55);
        if ('emissive' in m) {
          m.emissive = new THREE.Color(tint).lerp(new THREE.Color('#5ff2e0'), 0.6);
          m.emissiveIntensity = 0.55;
        }
        mesh.material = m;
        mesh.castShadow = false;
      } else if (ud.original) {
        mesh.material = ud.original;
        ud.original = undefined;
        mesh.castShadow = true;
      }
    });
  }, [group, spectral, tint]);
}

/** A brief swirl of light where life changes hands: teal for a new ghost, gold for new life. */
export function TransformBurst({ at, onDone, living = false }: { at: V3; onDone: () => void; living?: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const motes = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (t0.current === null) t0.current = clock.elapsedTime;
    const u = (clock.elapsedTime - t0.current) / 1.6;
    if (u >= 1) {
      onDone();
      return;
    }
    if (ring.current) {
      ring.current.scale.setScalar(0.3 + u * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 1 - u;
    }
    motes.current?.children.forEach((c, k) => {
      const a = k * 1.3 + u * 4;
      c.position.set(Math.cos(a) * (0.3 + u * 0.4), u * 1.8 + (k % 3) * 0.15, Math.sin(a) * (0.3 + u * 0.4));
      c.scale.setScalar(1 - u);
    });
  });
  return (
    <group position={at}>
      <mesh ref={ring} position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.55, 32]} />
        <meshBasicMaterial color={living ? '#ffd36b' : '#7ff5e6'} transparent toneMapped={false} />
      </mesh>
      <group ref={motes}>
        {Array.from({ length: 10 }, (_, k) => (
          <mesh key={k}>
            <sphereGeometry args={[0.05, 6, 4]} />
            <meshBasicMaterial color={living ? (k % 2 ? '#ffd36b' : '#fff4d1') : k % 2 ? '#7ff5e6' : '#d8fff9'} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** The one life: a warm flame floating over the living piece. */
export function LifeFlame({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = 1.45 + (reduced ? 0 : Math.sin(t * 2.4) * 0.05);
    ref.current.scale.set(1, 1 + (reduced ? 0 : Math.sin(t * 9) * 0.08), 1);
  });
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[0.11, 14, 10]} />
        <meshBasicMaterial color="#ffd36b" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <coneGeometry args={[0.085, 0.22, 12]} />
        <meshBasicMaterial color="#ff9a3c" toneMapped={false} />
      </mesh>
      <pointLight color="#ffc060" intensity={2.2} distance={3} />
    </group>
  );
}
