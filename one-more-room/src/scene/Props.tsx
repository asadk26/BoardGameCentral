// Room furnishings and haunted-house set dressing. Everything here is
// decorative and kept clear of the playable spaces.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type Vec = [number, number, number];

function M({ c, rough = 0.75, metal = 0, e, ei = 0, t }: { c: string; rough?: number; metal?: number; e?: string; ei?: number; t?: number }) {
  return (
    <meshStandardMaterial
      color={c}
      roughness={rough}
      metalness={metal}
      emissive={e ?? '#000'}
      emissiveIntensity={ei}
      flatShading
      transparent={t !== undefined}
      opacity={t ?? 1}
    />
  );
}

export function BoxP({ p, s, c, r, rough, metal, e, ei, cast = true }: { p: Vec; s: Vec; c: string; r?: Vec; rough?: number; metal?: number; e?: string; ei?: number; cast?: boolean }) {
  return (
    <mesh position={p} rotation={r} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <M c={c} rough={rough} metal={metal} e={e} ei={ei} />
    </mesh>
  );
}

function CylP({ p, a, c, r, e, ei, rough, metal, seg = 12 }: { p: Vec; a: [number, number, number]; c: string; r?: Vec; e?: string; ei?: number; rough?: number; metal?: number; seg?: number }) {
  return (
    <mesh position={p} rotation={r} castShadow receiveShadow>
      <cylinderGeometry args={[a[0], a[1], a[2], seg]} />
      <M c={c} e={e} ei={ei} rough={rough} metal={metal} />
    </mesh>
  );
}

function SphP({ p, rad, c, s, e, ei, rough }: { p: Vec; rad: number; c: string; s?: Vec; e?: string; ei?: number; rough?: number }) {
  return (
    <mesh position={p} scale={s} castShadow>
      <sphereGeometry args={[rad, 12, 9]} />
      <M c={c} e={e} ei={ei} rough={rough} />
    </mesh>
  );
}

export function Pumpkin({ p, s = 1, lit = false }: { p: Vec; s?: number; lit?: boolean }) {
  return (
    <group position={p} scale={s}>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.06, 0.13, Math.cos(a) * 0.06]} scale={[0.75, 0.85, 0.75]} castShadow>
            <sphereGeometry args={[0.13, 10, 8]} />
            <M c="#e8761c" rough={0.6} e={lit ? '#ff7a1a' : undefined} ei={lit ? 0.25 : 0} />
          </mesh>
        );
      })}
      <CylP p={[0, 0.26, 0]} a={[0.02, 0.03, 0.08]} c="#4a6b24" seg={6} />
      {lit && (
        <>
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[sd * 0.06, 0.16, 0.15]} rotation={[0, 0, Math.PI]}>
              <coneGeometry args={[0.035, 0.05, 3]} />
              <meshBasicMaterial color="#ffd36b" />
            </mesh>
          ))}
          <mesh position={[0, 0.09, 0.155]}>
            <boxGeometry args={[0.12, 0.025, 0.01]} />
            <meshBasicMaterial color="#ffd36b" />
          </mesh>
        </>
      )}
    </group>
  );
}

export function Candle({ p, h = 0.2, s = 1 }: { p: Vec; h?: number; s?: number }) {
  const flame = useRef<THREE.Mesh>(null);
  const seed = p[0] * 13.1 + p[2] * 7.7;
  useFrame(({ clock }) => {
    if (!flame.current) return;
    const t = clock.elapsedTime + seed;
    flame.current.scale.set(1, 1 + Math.sin(t * 9) * 0.12 + Math.sin(t * 23) * 0.06, 1);
  });
  return (
    <group position={p} scale={s}>
      <CylP p={[0, h / 2, 0]} a={[0.035, 0.04, h]} c="#f5ecd6" seg={8} />
      <mesh ref={flame} position={[0, h + 0.05, 0]}>
        <sphereGeometry args={[0.03, 8, 6]} />
        <meshBasicMaterial color="#ffc85a" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Cobweb({ p, r = [0, 0, 0], s = 1 }: { p: Vec; r?: Vec; s?: number }) {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const R = 0.5;
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      pts.push(0, 0, 0, Math.cos(a) * R, Math.sin(a) * R, 0);
    }
    for (let ring = 1; ring <= 3; ring++) {
      const rr = (ring / 3) * R * 0.95;
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * (Math.PI / 2);
        const a1 = ((i + 1) / 4) * (Math.PI / 2);
        const sag = 0.8;
        pts.push(Math.cos(a0) * rr, Math.sin(a0) * rr, 0, Math.cos((a0 + a1) / 2) * rr * sag, Math.sin((a0 + a1) / 2) * rr * sag, 0);
        pts.push(Math.cos((a0 + a1) / 2) * rr * sag, Math.sin((a0 + a1) / 2) * rr * sag, 0, Math.cos(a1) * rr, Math.sin(a1) * rr, 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo} position={p} rotation={r} scale={s}>
      <lineBasicMaterial color="#d9d2ec" transparent opacity={0.45} />
    </lineSegments>
  );
}

function Bookshelf({ p, r = 0, w = 1.2, h = 1.1 }: { p: Vec; r?: number; w?: number; h?: number }) {
  const colors = ['#8c2f39', '#2e5e4e', '#c9a15a', '#3b4f8c', '#6d3f7a', '#b5652b'];
  const rows = 3;
  return (
    <group position={p} rotation={[0, r, 0]}>
      <BoxP p={[0, h / 2, 0]} s={[w, h, 0.3]} c="#3d2618" />
      {Array.from({ length: rows }, (_, row) => (
        <group key={row} position={[0, 0.15 + row * (h / rows), 0.06]}>
          {Array.from({ length: Math.floor(w / 0.08) }, (_, i) => (
            <mesh key={i} position={[-w / 2 + 0.07 + i * 0.08, 0.1 + ((i * 7 + row) % 3) * 0.01, 0.02]} castShadow>
              <boxGeometry args={[0.06, 0.2 + ((i * 5 + row * 3) % 4) * 0.02, 0.2]} />
              <M c={colors[(i * 3 + row) % colors.length]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Chair({ p, r = 0, c = '#4a2a1c' }: { p: Vec; r?: number; c?: string }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <BoxP p={[0, 0.22, 0]} s={[0.3, 0.05, 0.3]} c={c} />
      <BoxP p={[0, 0.45, -0.13]} s={[0.3, 0.45, 0.05]} c={c} />
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => <BoxP key={`${x}${z}`} p={[x * 0.12, 0.1, z * 0.12]} s={[0.04, 0.2, 0.04]} c={c} />))}
    </group>
  );
}

function Bottle({ p, c, h = 0.22 }: { p: Vec; c: string; h?: number }) {
  return (
    <group position={p}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, h, 10]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.9} transparent opacity={0.85} roughness={0.2} />
      </mesh>
      <CylP p={[0, h + 0.04, 0]} a={[0.02, 0.025, 0.08]} c="#d9e6ea" seg={6} />
      <CylP p={[0, h + 0.09, 0]} a={[0.025, 0.025, 0.03]} c="#7a4a20" seg={6} />
    </group>
  );
}

function Tombstone({ p, r = 0, s = 1 }: { p: Vec; r?: number; s?: number }) {
  return (
    <group position={p} rotation={[0, r, 0]} scale={s}>
      <BoxP p={[0, 0.25, 0]} s={[0.36, 0.5, 0.1]} c="#7c7f8f" />
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.1, 12, 1, false, 0, Math.PI]} />
        <M c="#7c7f8f" />
      </mesh>
      <BoxP p={[0, 0.34, 0.055]} s={[0.04, 0.2, 0.01]} c="#4e5160" cast={false} />
      <BoxP p={[0, 0.38, 0.055]} s={[0.14, 0.04, 0.01]} c="#4e5160" cast={false} />
    </group>
  );
}

function DeadTree({ p, s = 1 }: { p: Vec; s?: number }) {
  const branch = (pos: Vec, rot: Vec, len: number, w: number) => (
    <mesh position={pos} rotation={rot} castShadow>
      <cylinderGeometry args={[w * 0.6, w, len, 6]} />
      <M c="#3a2a22" />
    </mesh>
  );
  return (
    <group position={p} scale={s}>
      {branch([0, 0.6, 0], [0, 0, 0.05], 1.2, 0.12)}
      {branch([0.25, 1.2, 0], [0, 0, -0.9], 0.7, 0.06)}
      {branch([-0.22, 1.05, 0.05], [0.2, 0, 0.8], 0.6, 0.05)}
      {branch([0.05, 1.35, -0.2], [-0.7, 0, 0], 0.55, 0.04)}
      {branch([0.5, 1.45, 0], [0, 0, -0.2], 0.35, 0.025)}
    </group>
  );
}

function Plant({ p, s = 1, c = '#3f9b4f' }: { p: Vec; s?: number; c?: string }) {
  return (
    <group position={p} scale={s}>
      <CylP p={[0, 0.12, 0]} a={[0.16, 0.12, 0.24]} c="#9a5a3a" />
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.1, 0.4, Math.cos(a) * 0.1]} rotation={[Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6]} castShadow>
            <coneGeometry args={[0.07, 0.45, 4]} />
            <M c={i % 2 ? c : '#5bbf5f'} />
          </mesh>
        );
      })}
    </group>
  );
}

function Flytrap({ p }: { p: Vec }) {
  return (
    <group position={p}>
      <CylP p={[0, 0.1, 0]} a={[0.13, 0.1, 0.2]} c="#6b4a8a" />
      <CylP p={[0, 0.35, 0]} a={[0.02, 0.025, 0.35]} c="#3f9b4f" seg={6} />
      <mesh position={[0, 0.58, 0.03]} rotation={[0.5, 0, 0]} castShadow>
        <sphereGeometry args={[0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#5bbf5f" side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh position={[0, 0.56, 0.05]} rotation={[-2.3, 0, 0]} castShadow>
        <sphereGeometry args={[0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#d94b6a" side={THREE.DoubleSide} flatShading />
      </mesh>
    </group>
  );
}

function RockingHorse({ p, r = 0 }: { p: Vec; r?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.x = Math.sin(clock.elapsedTime * 1.4) * 0.12;
  });
  return (
    <group position={p} rotation={[0, r, 0]}>
      <group ref={ref}>
        <mesh position={[0, 0.06, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.45, 0.03, 6, 20, Math.PI * 0.5]} />
          <M c="#8a4a2a" />
        </mesh>
        <group position={[0, 0.02, 0]} rotation={[0, 0, 0]}>
          <BoxP p={[0, 0.42, 0]} s={[0.2, 0.2, 0.55]} c="#f0e2c8" />
          <BoxP p={[0, 0.6, 0.27]} s={[0.14, 0.3, 0.14]} c="#f0e2c8" r={[0.4, 0, 0]} />
          <BoxP p={[0, 0.72, 0.38]} s={[0.13, 0.13, 0.22]} c="#f0e2c8" />
          <BoxP p={[0, 0.7, 0.2]} s={[0.05, 0.25, 0.14]} c="#c2412f" r={[0.4, 0, 0]} />
          <BoxP p={[0, 0.53, -0.02]} s={[0.22, 0.04, 0.22]} c="#c2412f" />
          {[-1, 1].flatMap((x) => [-1, 1].map((z) => <BoxP key={`${x}${z}`} p={[x * 0.08, 0.2, z * 0.2]} s={[0.05, 0.28, 0.05]} c="#f0e2c8" />))}
        </group>
      </group>
    </group>
  );
}

function Trunk({ p, r = 0, c = '#6b3f22' }: { p: Vec; r?: number; c?: string }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <BoxP p={[0, 0.17, 0]} s={[0.6, 0.34, 0.36]} c={c} />
      <mesh position={[0, 0.34, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.6, 10, 1, false, 0, Math.PI]} />
        <M c={c} />
      </mesh>
      {[-0.2, 0.2].map((x) => (
        <BoxP key={x} p={[x, 0.26, 0]} s={[0.04, 0.54, 0.38]} c="#c9a15a" metal={0.5} />
      ))}
    </group>
  );
}

function Cauldron({ p, c = '#7dff6a', s = 1 }: { p: Vec; c?: string; s?: number }) {
  const bubbles = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!bubbles.current) return;
    bubbles.current.children.forEach((b, i) => {
      const t = (clock.elapsedTime * 0.6 + i * 0.33) % 1;
      b.position.y = 0.36 + t * 0.25;
      b.scale.setScalar(1 - t);
    });
  });
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <sphereGeometry args={[0.26, 14, 10, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.75]} />
        <meshStandardMaterial color="#1e1a22" roughness={0.5} metalness={0.4} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh position={[0, 0.37, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.18, 16]} />
        <meshBasicMaterial color={c} toneMapped={false} />
      </mesh>
      <group ref={bubbles}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.sin(i * 2) * 0.08, 0.4, Math.cos(i * 2) * 0.08]}>
            <sphereGeometry args={[0.04, 8, 6]} />
            <meshBasicMaterial color={c} transparent opacity={0.8} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Clock({ p, round }: { p: Vec; round: number }) {
  // A grandfather clock whose hands creep toward midnight as rounds pass.
  const minutes = ((round - 1) / 9) * 60;
  return (
    <group position={p}>
      <BoxP p={[0, 0.7, 0]} s={[0.42, 1.4, 0.26]} c="#3d2216" />
      <BoxP p={[0, 1.5, 0]} s={[0.5, 0.35, 0.3]} c="#4a2a1c" />
      <mesh position={[0, 1.2, 0.14]}>
        <circleGeometry args={[0.17, 20]} />
        <meshStandardMaterial color="#f3e7c6" emissive="#f3e7c6" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0, 1.2, 0.15]} rotation={[0, 0, -((11 + minutes / 60) / 12) * Math.PI * 2]}>
        <boxGeometry args={[0.02, 0.1, 0.01]} />
        <meshBasicMaterial color="#1a1020" />
      </mesh>
      <group position={[0, 1.2, 0.155]} rotation={[0, 0, -(minutes / 60) * Math.PI * 2 - Math.PI]}>
        <mesh position={[0, -0.07, 0]}>
          <boxGeometry args={[0.014, 0.14, 0.01]} />
          <meshBasicMaterial color="#1a1020" />
        </mesh>
      </group>
      <mesh position={[0, 0.65, 0.135]}>
        <circleGeometry args={[0.09, 16]} />
        <meshStandardMaterial color="#d8a657" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

function SheetFurniture({ p, s = [0.6, 0.5, 0.5] }: { p: Vec; s?: Vec }) {
  return (
    <mesh position={[p[0], p[1] + s[1] / 2, p[2]]} scale={s} castShadow>
      <sphereGeometry args={[0.6, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
      <M c="#d9d4e6" rough={0.95} />
    </mesh>
  );
}

function Crib({ p, r = 0 }: { p: Vec; r?: number }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <BoxP p={[0, 0.25, 0]} s={[0.9, 0.06, 0.5]} c="#e8d6f0" />
      <BoxP p={[0, 0.3, 0]} s={[0.8, 0.06, 0.42]} c="#f7c6e0" />
      {Array.from({ length: 9 }, (_, i) => (
        <BoxP key={i} p={[-0.4 + i * 0.1, 0.4, 0.24]} s={[0.025, 0.35, 0.025]} c="#e8d6f0" />
      ))}
      <BoxP p={[0, 0.58, 0.24]} s={[0.9, 0.04, 0.04]} c="#e8d6f0" />
      <BoxP p={[-0.45, 0.4, 0]} s={[0.04, 0.8, 0.5]} c="#e8d6f0" />
      <BoxP p={[0.45, 0.35, 0]} s={[0.04, 0.7, 0.5]} c="#e8d6f0" />
    </group>
  );
}

function Blocks({ p }: { p: Vec }) {
  const cs = ['#e0564a', '#f2c14e', '#4f8fe0', '#62b54a'];
  return (
    <group position={p}>
      {[[0, 0.08, 0], [0.18, 0.08, 0.03], [0.08, 0.24, 0.01], [-0.12, 0.08, 0.14]].map((q, i) => (
        <BoxP key={i} p={q as Vec} s={[0.15, 0.15, 0.15]} c={cs[i]} r={[0, i * 0.4, 0]} />
      ))}
    </group>
  );
}

function Stove({ p, r = 0 }: { p: Vec; r?: number }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <BoxP p={[0, 0.3, 0]} s={[0.8, 0.6, 0.5]} c="#24212b" metal={0.5} rough={0.4} />
      <BoxP p={[0, 0.25, 0.26]} s={[0.5, 0.3, 0.02]} c="#ff7a2a" e="#ff5a1a" ei={0.8} />
      {[-0.2, 0.2].map((x) => (
        <CylP key={x} p={[x, 0.62, -0.05]} a={[0.1, 0.1, 0.03]} c="#141218" />
      ))}
      <CylP p={[-0.2, 0.75, -0.05]} a={[0.13, 0.11, 0.22]} c="#6c6f7a" metal={0.6} rough={0.3} />
      <mesh position={[-0.2, 0.86, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 14]} />
        <meshBasicMaterial color="#9bff6a" toneMapped={false} />
      </mesh>
      <BoxP p={[0.3, 1.0, -0.15]} s={[0.12, 0.8, 0.12]} c="#3a3440" />
    </group>
  );
}

function Table({ p, s, c = '#5a3320' }: { p: Vec; s: [number, number]; c?: string }) {
  return (
    <group position={p}>
      <BoxP p={[0, 0.42, 0]} s={[s[0], 0.06, s[1]]} c={c} />
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => <BoxP key={`${x}${z}`} p={[x * (s[0] / 2 - 0.08), 0.2, z * (s[1] / 2 - 0.08)]} s={[0.07, 0.4, 0.07]} c={c} />))}
    </group>
  );
}

function Candelabra({ p, s = 1 }: { p: Vec; s?: number }) {
  return (
    <group position={p} scale={s}>
      <CylP p={[0, 0.2, 0]} a={[0.03, 0.08, 0.4]} c="#d8a657" metal={0.8} rough={0.3} />
      <BoxP p={[0, 0.4, 0]} s={[0.4, 0.03, 0.03]} c="#d8a657" metal={0.8} rough={0.3} />
      {[-0.18, 0, 0.18].map((x) => (
        <Candle key={x} p={[x, 0.41, 0]} h={0.14} />
      ))}
    </group>
  );
}

function Armor({ p, r = 0 }: { p: Vec; r?: number }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <BoxP p={[0, 0.05, 0]} s={[0.4, 0.1, 0.4]} c="#3a3440" />
      <CylP p={[0, 0.45, 0]} a={[0.13, 0.1, 0.5]} c="#9aa1ad" metal={0.8} rough={0.3} />
      <SphP p={[0, 0.82, 0]} rad={0.13} c="#9aa1ad" />
      <BoxP p={[0, 0.82, 0.11]} s={[0.14, 0.03, 0.04]} c="#1a1020" cast={false} />
      <BoxP p={[0.2, 0.55, 0.05]} s={[0.03, 0.9, 0.03]} c="#6b4a2b" />
      <mesh position={[0.2, 1.05, 0.05]} castShadow>
        <coneGeometry args={[0.06, 0.16, 4]} />
        <M c="#c7ccd6" metal={0.8} rough={0.3} />
      </mesh>
    </group>
  );
}

function Rug({ p, s, c, border }: { p: Vec; s: [number, number]; c: string; border: string }) {
  return (
    <group position={p}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[s[0], s[1]]} />
        <meshStandardMaterial color={border} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <planeGeometry args={[s[0] - 0.2, s[1] - 0.2]} />
        <meshStandardMaterial color={c} roughness={1} />
      </mesh>
    </group>
  );
}

export function MansionProps({ round }: { round: number }) {
  return (
    <group>
      {/* Kitchen (node 3 at -4,6) */}
      <Stove p={[-6.4, 0, 5.45]} />
      <Table p={[-5.4, 0, 6.2]} s={[0.9, 0.6]} c="#7a5230" />
      <Pumpkin p={[-5.5, 0.45, 6.2]} s={0.8} />
      <Pumpkin p={[-6.7, 0, 6.5]} s={1.1} />
      <BoxP p={[-3.25, 0.3, 5.5]} s={[0.4, 0.6, 0.6]} c="#6b3f22" />

      {/* Dining room (node 7 at -10,4) */}
      <Rug p={[-10.7, 0.02, 5.6]} s={[2.6, 1.5]} c="#6b1f2e" border="#d8a657" />
      <Table p={[-10.7, 0, 5.6]} s={[2.2, 0.8]} c="#4a2616" />
      <Candelabra p={[-10.7, 0.45, 5.6]} s={0.9} />
      {[-11.5, -10.7, -9.9].flatMap((x) => [
        <Chair key={`a${x}`} p={[x, 0, 5.0]} r={0} />,
        <Chair key={`b${x}`} p={[x, 0, 6.2]} r={Math.PI} />,
      ])}
      <Pumpkin p={[-11.2, 0.45, 5.6]} s={0.5} lit />

      {/* Conservatory (node 10 at -8,0) */}
      <Plant p={[-8.7, 0, -2.2]} s={1.3} />
      <Plant p={[-7.4, 0, -2.3]} s={1.1} c="#2f7f3f" />
      <Flytrap p={[-8.0, 0, -1.3]} />
      <Plant p={[-9.0, 0, 0.8]} s={0.8} />
      <Plant p={[-7.1, 0, 0.8]} s={0.7} c="#6fbf4a" />
      <Pumpkin p={[-7.6, 0, -1.3]} s={0.9} />
      {[-8.95, -7.1].map((x) => (
        <BoxP key={x} p={[x, 0.9, -1]} s={[0.06, 0.06, 3.8]} c="#2a1d14" />
      ))}

      {/* Attic (node 15 at -2,-4) */}
      <Trunk p={[-2.5, 0, -6.3]} r={0.2} />
      <Trunk p={[-1.5, 0, -5.4]} r={-0.4} c="#4a3a5c" />
      <SheetFurniture p={[-1.6, 0, -6.5]} />
      <Candle p={[-2.8, 0, -5.2]} />

      {/* Ghost's lair (node 16 at 0,-4) */}
      <Rug p={[0, 0.02, -5.4]} s={[1.5, 2.6]} c="#1f3b52" border="#5ff2e0" />
      <Candle p={[-0.55, 0, -6.3]} h={0.3} />
      <Candle p={[0.55, 0, -6.3]} h={0.26} />

      {/* Crypt (node 17 at 2,-4) */}
      <BoxP p={[2.0, 0.22, -6.1]} s={[1.4, 0.44, 0.7]} c="#6c6f80" />
      <BoxP p={[2.0, 0.48, -6.1]} s={[1.5, 0.08, 0.8]} c="#8a8d9e" />
      <Tombstone p={[1.3, 0, -5.1]} r={0.2} s={0.8} />
      <Tombstone p={[2.7, 0, -5.0]} r={-0.3} s={0.9} />
      <Candle p={[2.8, 0, -6.6]} h={0.3} />
      <Candle p={[1.2, 0, -6.6]} h={0.22} />

      {/* Laboratory (node 22 at 8,0) */}
      <Table p={[8.0, 0, -2.2]} s={[1.8, 0.6]} c="#3a3440" />
      <Bottle p={[7.5, 0.45, -2.2]} c="#6ef0a8" />
      <Bottle p={[7.8, 0.45, -2.1]} c="#ff5ad1" h={0.3} />
      <Bottle p={[8.2, 0.45, -2.3]} c="#5ab8ff" h={0.18} />
      <Bottle p={[8.55, 0.45, -2.15]} c="#ffd23f" h={0.26} />
      <group position={[7.3, 0, -1.2]}>
        <CylP p={[0, 0.4, 0]} a={[0.04, 0.12, 0.8]} c="#6c6f7a" metal={0.7} rough={0.3} />
        {[0.3, 0.45, 0.6].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.1, 0.02, 6, 16]} />
            <M c="#c98a4b" metal={0.8} />
          </mesh>
        ))}
        <SphP p={[0, 0.88, 0]} rad={0.1} c="#bff" e="#7ff5e6" ei={1.5} />
      </group>
      <Cauldron p={[8.7, 0, -1.1]} c="#7dff6a" s={0.9} />

      {/* Nursery (node 25 at 10,4) */}
      <RockingHorse p={[11.3, 0, 5.6]} r={-0.6} />
      <Crib p={[10.2, 0, 6.1]} />
      <Blocks p={[11.6, 0, 4.0]} />
      <Rug p={[10.8, 0.02, 5.4]} s={[2.4, 1.6]} c="#6b4a7a" border="#f29ad6" />

      {/* Library (node 29 at 4,6) */}
      <Bookshelf p={[5.9, 0, 5.2]} w={2.2} />
      <Bookshelf p={[6.9, 0, 6.2]} r={-Math.PI / 2} w={1.4} />
      <Chair p={[5.3, 0, 6.3]} r={Math.PI * 0.8} c="#7a2a3a" />
      <Candle p={[4.8, 0, 6.6]} h={0.3} />

      {/* Entrance hall */}
      <Rug p={[0, 0.02, 8.3]} s={[5.2, 2.4]} c="#6b1f2e" border="#d8a657" />
      <Pumpkin p={[-1.3, 0, 9.8]} s={1.3} lit />
      <Pumpkin p={[1.3, 0, 9.8]} s={1.3} lit />
      <Candelabra p={[-2.6, 0, 7.4]} s={1.2} />
      <Candelabra p={[2.6, 0, 7.4]} s={1.2} />

      {/* Grand hall between the wings */}
      {/* (The old grand staircase stood here; it hid pieces in the Lair and the north corridors.) */}
      <Rug p={[0, 0.02, 3.2]} s={[4.4, 4.6]} c="#3a1f4a" border="#d8a657" />
      <Clock p={[-2.3, 0, 0.3]} round={round} />
      <Armor p={[2.3, 0, 0.4]} r={-0.3} />
      <Armor p={[-2.3, 0, 5.2]} r={0.3} />
      <Pumpkin p={[2.2, 0, 5.3]} s={1.4} lit />
      <Pumpkin p={[2.6, 0, 4.7]} s={0.9} />
      <Pumpkin p={[1.8, 0, 5.8]} s={0.8} />
      <Candelabra p={[0, 0, 5.6]} s={1.1} />

      {/* West atrium */}
      <DeadTree p={[-7.2, 0, 2.2]} s={1.1} />
      <Tombstone p={[-8.6, 0, 1.6]} r={0.3} s={0.8} />
      <Tombstone p={[-5.6, 0, 2.6]} r={-0.2} s={0.7} />
      <Pumpkin p={[-6.2, 0, 1.4]} s={1.0} lit />
      <Pumpkin p={[-8.3, 0, 2.9]} s={0.8} />

      {/* East atrium */}
      <Cauldron p={[7.0, 0, 2.2]} c="#b86bff" s={1.6} />
      <Tombstone p={[8.6, 0, 1.6]} r={-0.3} s={0.8} />
      <Tombstone p={[5.6, 0, 2.8]} r={0.2} s={0.7} />
      <Pumpkin p={[8.3, 0, 2.9]} s={1.0} lit />
      <DeadTree p={[5.5, 0, 1.4]} s={0.8} />

      {/* Far west and east galleries */}
      <Armor p={[-12.3, 0, -2.8]} r={0.8} />
      <Bookshelf p={[-12.55, 0, -0.9]} r={Math.PI / 2} w={1.6} />
      <Armor p={[12.3, 0, -2.8]} r={-0.8} />
      <Bookshelf p={[12.55, 0, -0.9]} r={-Math.PI / 2} w={1.6} />
      <Candelabra p={[-11.8, 0, 1.6]} />
      <Candelabra p={[11.8, 0, 1.6]} />

      {/* Corners of the north gallery */}
      <Pumpkin p={[-4.3, 0, -7.0]} s={1.1} lit />
      <Pumpkin p={[4.3, 0, -7.0]} s={1.1} lit />
    </group>
  );
}
