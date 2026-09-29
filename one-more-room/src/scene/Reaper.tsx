// Death's side of the mansion: revealed Reapers, the ever-visible Super
// Reaper, ghost-only wall links, spectral miniatures, protection shields and
// transformation bursts. Only public facts reach this file — hidden traps are
// never passed in, so nothing here can light, sound or load differently.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GHOST_WALL_LINKS, SUPER_REAPER } from '../engine/config';
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

function SuperReaper({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const [x, , z] = nodePos(SUPER_REAPER, 0);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = reduced ? 0 : Math.sin(clock.elapsedTime * 1.1) * 0.06;
    ref.current.rotation.y = Math.PI / 2 + (reduced ? 0 : Math.sin(clock.elapsedTime * 0.5) * 0.25);
  });
  return (
    <group position={[x - 0.75, 0, z]}>
      <group ref={ref}>
        <ReaperModel glow="#ff3d6e" scale={0.95} />
      </group>
      <mesh position={[0.75, 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.44, 0.6, 36]} />
        <meshBasicMaterial color="#ff3d6e" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <Label pos={[0, 1.75, 0]} lines={['Super Reaper']} scale={0.4} color="#ff7b98" />
    </group>
  );
}

export function Reapers({ revealed, reduced }: { revealed: readonly number[]; reduced: boolean }) {
  return (
    <group>
      <SuperReaper reduced={reduced} />
      {revealed.map((n) => (
        <RevealedReaper key={n} node={n} reduced={reduced} />
      ))}
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

/** A brief swirl of light where someone just became a ghost. */
export function TransformBurst({ at, onDone }: { at: V3; onDone: () => void }) {
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
        <meshBasicMaterial color="#7ff5e6" transparent toneMapped={false} />
      </mesh>
      <group ref={motes}>
        {Array.from({ length: 10 }, (_, k) => (
          <mesh key={k}>
            <sphereGeometry args={[0.05, 6, 4]} />
            <meshBasicMaterial color={k % 2 ? '#7ff5e6' : '#d8fff9'} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** A glowing dome over a player who survived a challenge. */
export function ProtectionShield() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(clock.elapsedTime * 3) * 0.05;
  });
  return (
    <mesh ref={ref} position={[0, 0.02, 0]}>
      <sphereGeometry args={[0.42, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshBasicMaterial color="#9fe8ff" transparent opacity={0.18} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
