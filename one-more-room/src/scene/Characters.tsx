// The six costumed miniatures, modelled from stylised low-poly parts. Each
// model is about one unit tall, faces +z, and stands on a numbered base.

import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { CharacterId } from '../engine/config';
import { badgeTexture } from './labels';

type Vec = [number, number, number];

interface PartProps {
  p?: Vec;
  r?: Vec;
  s?: Vec | number;
  c: string;
  rough?: number;
  metal?: number;
  emissive?: string;
  ei?: number;
  flat?: boolean;
}

function mat({ c, rough = 0.7, metal = 0, emissive, ei = 0, flat = true }: PartProps) {
  return <meshStandardMaterial color={c} roughness={rough} metalness={metal} emissive={emissive ?? '#000'} emissiveIntensity={ei} flatShading={flat} />;
}

const Sphere = (props: PartProps & { rad?: number; seg?: number; args?: [number, number, number, number?, number?, number?, number?] }) => (
  <mesh position={props.p} rotation={props.r} scale={props.s} castShadow>
    <sphereGeometry args={props.args ?? [props.rad ?? 0.1, props.seg ?? 12, Math.max(6, Math.round((props.seg ?? 12) * 0.7))]} />
    {mat(props)}
  </mesh>
);
const Cyl = (props: PartProps & { args: [number, number, number, number?, number?, boolean?, number?, number?] }) => (
  <mesh position={props.p} rotation={props.r} scale={props.s} castShadow>
    <cylinderGeometry args={props.args} />
    {mat(props)}
  </mesh>
);
const Cone = (props: PartProps & { args: [number, number, number?, number?, boolean?, number?, number?] }) => (
  <mesh position={props.p} rotation={props.r} scale={props.s} castShadow>
    <coneGeometry args={props.args} />
    {mat(props)}
  </mesh>
);
const Box = (props: PartProps & { args: [number, number, number] }) => (
  <mesh position={props.p} rotation={props.r} scale={props.s} castShadow>
    <boxGeometry args={props.args} />
    {mat(props)}
  </mesh>
);
const Torus = (props: PartProps & { args: [number, number, number?, number?, number?] }) => (
  <mesh position={props.p} rotation={props.r} scale={props.s} castShadow>
    <torusGeometry args={props.args} />
    {mat(props)}
  </mesh>
);
const Capsule = (props: PartProps & { args: [number, number, number?, number?] }) => (
  <mesh position={props.p} rotation={props.r} scale={props.s} castShadow>
    <capsuleGeometry args={props.args} />
    {mat(props)}
  </mesh>
);

/** Cartoon eyes: white with a dark pupil and a glint. */
function Eyes({ y, z, spread = 0.065, size = 0.045, white = '#ffffff', pupil = '#1a1020', look = 0 }: { y: number; z: number; spread?: number; size?: number; white?: string; pupil?: string; look?: number }) {
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * spread, y, z]}>
          <Sphere rad={size} c={white} rough={0.3} flat={false} s={[1, 1.15, 0.6]} />
          <Sphere rad={size * 0.55} p={[look * size * 0.3, -size * 0.05, size * 0.45]} c={pupil} rough={0.2} flat={false} />
          <Sphere rad={size * 0.18} p={[size * 0.2, size * 0.25, size * 0.7]} c="#ffffff" emissive="#ffffff" ei={0.6} flat={false} />
        </group>
      ))}
    </group>
  );
}

function Smile({ y, z, w = 0.06, c = '#3a1420', tube = 0.012, frown = false }: { y: number; z: number; w?: number; c?: string; tube?: number; frown?: boolean }) {
  return <Torus args={[w, tube, 6, 14, Math.PI]} p={[0, y, z]} r={[0, 0, frown ? 0 : Math.PI]} c={c} />;
}

// ── Knight ───────────────────────────────────────────────────────────────
function Knight() {
  const steel = '#c7ccd6';
  const dark = '#6d7382';
  const red = '#d9463d';
  return (
    <group>
      {/* legs and boots */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cyl args={[0.055, 0.065, 0.24, 8]} p={[s * 0.08, 0.16, 0]} c={dark} metal={0.6} rough={0.4} />
          <Box args={[0.1, 0.07, 0.16]} p={[s * 0.08, 0.035, 0.025]} c="#4a4f5c" metal={0.5} rough={0.4} />
        </group>
      ))}
      {/* breastplate and tabard */}
      <Cyl args={[0.17, 0.15, 0.3, 10]} p={[0, 0.42, 0]} c={steel} metal={0.75} rough={0.3} />
      <Box args={[0.2, 0.28, 0.02]} p={[0, 0.39, 0.155]} c={red} />
      <Box args={[0.035, 0.18, 0.012]} p={[0, 0.41, 0.168]} c="#f2c14e" />
      <Box args={[0.12, 0.035, 0.012]} p={[0, 0.44, 0.168]} c="#f2c14e" />
      <Torus args={[0.162, 0.022, 6, 16]} p={[0, 0.29, 0]} r={[Math.PI / 2, 0, 0]} c="#5a3a22" />
      {/* pauldrons and arms */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Sphere rad={0.08} p={[s * 0.19, 0.55, 0]} c={steel} metal={0.75} rough={0.3} s={[1, 0.8, 1]} />
          <Capsule args={[0.045, 0.16, 4, 8]} p={[s * 0.21, 0.42, 0.02]} r={[0.2, 0, s * 0.15]} c={dark} metal={0.6} rough={0.4} />
        </group>
      ))}
      {/* shield on the left arm */}
      <group position={[-0.25, 0.4, 0.1]} rotation={[0, -0.5, 0]}>
        <Cyl args={[0.15, 0.15, 0.035, 16]} r={[Math.PI / 2, 0, 0]} c={red} rough={0.5} />
        <Torus args={[0.15, 0.018, 6, 20]} c="#e7e2d6" metal={0.8} rough={0.3} />
        <Box args={[0.03, 0.17, 0.02]} p={[0, 0, 0.022]} c="#f2c14e" />
        <Box args={[0.13, 0.03, 0.02]} p={[0, 0.02, 0.022]} c="#f2c14e" />
      </group>
      {/* sword in the right hand */}
      <group position={[0.24, 0.34, 0.1]} rotation={[0.5, 0, -0.15]}>
        <Box args={[0.03, 0.3, 0.012]} p={[0, 0.18, 0]} c="#eef1f6" metal={0.9} rough={0.2} />
        <Box args={[0.12, 0.025, 0.03]} p={[0, 0.03, 0]} c="#f2c14e" metal={0.6} />
        <Cyl args={[0.015, 0.015, 0.07, 6]} p={[0, -0.02, 0]} c="#5a3a22" />
      </group>
      {/* face and open-fronted helmet */}
      <Sphere rad={0.14} p={[0, 0.74, 0.02]} c="#f2c9a0" flat={false} />
      <Eyes y={0.75} z={0.14} spread={0.05} size={0.032} />
      <Smile y={0.69} z={0.145} w={0.035} />
      <mesh position={[0, 0.76, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 12, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.72]} />
        <meshStandardMaterial color={steel} metalness={0.8} roughness={0.28} side={THREE.DoubleSide} flatShading />
      </mesh>
      <mesh position={[0, 0.76, 0]} castShadow>
        <sphereGeometry args={[0.182, 16, 8, 0, Math.PI * 2, 0, 0.8]} />
        <meshStandardMaterial color={steel} metalness={0.8} roughness={0.28} flatShading />
      </mesh>
      <Box args={[0.03, 0.12, 0.03]} p={[0, 0.8, 0.17]} c={steel} metal={0.8} rough={0.3} />
      <Torus args={[0.18, 0.015, 6, 20]} p={[0, 0.84, 0]} r={[Math.PI / 2, 0, 0]} c="#f2c14e" metal={0.6} />
      {/* plume */}
      <Sphere rad={0.07} p={[0, 0.98, -0.02]} s={[0.7, 1, 1.2]} c={red} />
      <Sphere rad={0.07} p={[0, 1.0, -0.1]} s={[0.7, 0.9, 1.3]} c="#ef6a52" />
      <Sphere rad={0.06} p={[0, 0.95, -0.19]} s={[0.7, 0.9, 1.3]} c={red} />
      <Cyl args={[0.02, 0.03, 0.06, 6]} p={[0, 0.93, 0]} c="#f2c14e" />
    </group>
  );
}

// ── Goblin ───────────────────────────────────────────────────────────────
function Goblin() {
  const skin = '#6fbf4a';
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cyl args={[0.045, 0.05, 0.16, 6]} p={[s * 0.08, 0.1, 0]} c="#6b4a2b" />
          <Sphere rad={0.07} p={[s * 0.09, 0.03, 0.04]} s={[1, 0.5, 1.6]} c={skin} />
        </group>
      ))}
      {/* tunic with a jagged hem and rope belt */}
      <Sphere rad={0.18} p={[0, 0.33, 0]} s={[1, 1.1, 0.9]} c="#8a6a3a" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <Cone key={i} args={[0.05, 0.09, 4]} p={[Math.sin(a) * 0.15, 0.17, Math.cos(a) * 0.14]} r={[Math.PI, 0, 0]} c="#7a5a2e" />;
      })}
      <Torus args={[0.165, 0.018, 6, 16]} p={[0, 0.3, 0]} r={[Math.PI / 2, 0, 0]} c="#c9a15a" />
      {/* arms: one hauling the sack over the shoulder */}
      <Capsule args={[0.04, 0.14, 4, 8]} p={[0.2, 0.38, 0.03]} r={[0, 0, 0.5]} c={skin} />
      <Capsule args={[0.04, 0.16, 4, 8]} p={[-0.17, 0.5, -0.05]} r={[-0.3, 0, 2.6]} c={skin} />
      {/* head */}
      <Sphere rad={0.2} p={[0, 0.66, 0.02]} s={[1.1, 0.95, 1]} c={skin} seg={14} flat={false} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.2, 0.7, 0]} rotation={[0, 0, s * -1.25]}>
          <Cone args={[0.07, 0.26, 6]} p={[0, 0.12, 0]} c={skin} />
          <Cone args={[0.035, 0.17, 6]} p={[0, 0.1, 0.025]} c="#e79a8a" />
        </group>
      ))}
      <Eyes y={0.71} z={0.17} spread={0.075} size={0.05} white="#ffe46b" look={0.4} />
      <Cone args={[0.035, 0.12, 6]} p={[0, 0.64, 0.23]} r={[Math.PI / 2 - 0.2, 0, 0]} c="#5aa83a" />
      <Smile y={0.57} z={0.18} w={0.08} tube={0.014} />
      <Cone args={[0.015, 0.035, 4]} p={[0.04, 0.555, 0.19]} r={[Math.PI, 0, 0]} c="#fffbe6" />
      <Cone args={[0.015, 0.035, 4]} p={[-0.035, 0.555, 0.19]} r={[Math.PI, 0, 0]} c="#fffbe6" />
      {/* oversized candy sack with sweets poking out */}
      <group position={[-0.06, 0.5, -0.24]}>
        <Sphere rad={0.25} s={[1, 1.1, 0.9]} c="#c89b5c" rough={0.9} />
        <Cyl args={[0.06, 0.1, 0.1, 8]} p={[0, 0.27, 0]} c="#b8894a" />
        <Torus args={[0.07, 0.02, 6, 12]} p={[0, 0.25, 0]} r={[Math.PI / 2, 0, 0]} c="#7a4a20" />
        <Sphere rad={0.05} p={[0.04, 0.35, 0.02]} c="#ff4d6d" rough={0.3} />
        <Sphere rad={0.045} p={[-0.05, 0.34, -0.02]} c="#ffd23f" rough={0.3} />
        <Cyl args={[0.012, 0.012, 0.16, 6]} p={[0.02, 0.4, -0.04]} r={[0.3, 0, 0.3]} c="#ffffff" />
        <Sphere rad={0.05} p={[0.06, 0.48, -0.08]} c="#6a4cff" rough={0.3} />
        <Sphere rad={0.03} p={[0.12, 0.05, 0.19]} c="#7a4a20" s={[1, 1, 0.3]} />
      </group>
    </group>
  );
}

// ── Witch ────────────────────────────────────────────────────────────────
function Witch() {
  const dress = '#5b2a86';
  return (
    <group>
      {[-1, 1].map((s) => (
        <Box key={s} args={[0.07, 0.05, 0.14]} p={[s * 0.07, 0.025, 0.05]} c="#1f1426" />
      ))}
      <Cone args={[0.26, 0.52, 12]} p={[0, 0.3, 0]} c={dress} />
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return <Cone key={i} args={[0.06, 0.08, 4]} p={[Math.sin(a) * 0.24, 0.05, Math.cos(a) * 0.24]} r={[Math.PI, 0, 0]} c="#48206b" />;
      })}
      <Torus args={[0.1, 0.02, 6, 14]} p={[0, 0.46, 0]} r={[Math.PI / 2, 0, 0]} c="#2dbf6a" />
      <Box args={[0.05, 0.04, 0.02]} p={[0, 0.46, 0.105]} c="#f2c14e" metal={0.6} />
      {/* sleeves and hands */}
      <Capsule args={[0.045, 0.16, 4, 8]} p={[-0.14, 0.44, 0.02]} r={[0, 0, 0.5]} c={dress} />
      <Capsule args={[0.045, 0.16, 4, 8]} p={[0.14, 0.44, 0.06]} r={[0.6, 0, -0.4]} c={dress} />
      <Sphere rad={0.04} p={[0.2, 0.37, 0.14]} c="#f2c9a0" />
      {/* head and orange hair */}
      <Sphere rad={0.14} p={[0, 0.66, 0.01]} c="#f2c9a0" flat={false} />
      {[-1, 1].map((s) => (
        <Box key={s} args={[0.06, 0.2, 0.1]} p={[s * 0.13, 0.6, -0.04]} r={[0, 0, s * 0.15]} c="#ff7b2e" />
      ))}
      <Box args={[0.24, 0.16, 0.08]} p={[0, 0.62, -0.1]} c="#ff7b2e" />
      <Eyes y={0.67} z={0.12} spread={0.05} size={0.033} pupil="#2dbf6a" />
      <Smile y={0.61} z={0.13} w={0.03} />
      <Sphere rad={0.018} p={[0.07, 0.63, 0.12]} c="#e7897a" />
      <Sphere rad={0.018} p={[-0.07, 0.63, 0.12]} c="#e7897a" />
      {/* pointed hat with a bent tip */}
      <Cyl args={[0.3, 0.3, 0.02, 20]} p={[0, 0.77, 0]} c="#2a1840" />
      <Cone args={[0.15, 0.3, 12]} p={[0, 0.93, -0.01]} r={[-0.08, 0, 0]} c="#2a1840" />
      <group position={[0, 1.07, -0.03]} rotation={[-0.9, 0, 0]}>
        <Cone args={[0.06, 0.16, 8]} p={[0, 0.06, 0]} c="#2a1840" />
      </group>
      <Torus args={[0.14, 0.025, 6, 16]} p={[0, 0.8, 0]} r={[Math.PI / 2, 0, 0]} c="#9b6ce0" />
      <Box args={[0.06, 0.05, 0.02]} p={[0, 0.8, 0.145]} c="#f2c14e" metal={0.6} />
      {/* broom */}
      <group position={[0.22, 0.45, 0.12]} rotation={[0.25, 0, -0.35]}>
        <Cyl args={[0.018, 0.018, 0.95, 6]} c="#8a5a2b" />
        <Cone args={[0.1, 0.26, 10]} p={[0, -0.55, 0]} c="#e0b25a" rough={1} />
        <Torus args={[0.04, 0.014, 6, 10]} p={[0, -0.43, 0]} r={[Math.PI / 2, 0, 0]} c="#7a2a2a" />
      </group>
    </group>
  );
}

// ── Zombie ───────────────────────────────────────────────────────────────
function Zombie() {
  const skin = '#8fd07a';
  return (
    <group rotation={[0.1, 0, 0.08]}>
      <Cyl args={[0.05, 0.055, 0.22, 6]} p={[-0.08, 0.14, 0]} c="#6b4a2b" />
      <Cyl args={[0.05, 0.055, 0.2, 6]} p={[0.08, 0.12, 0.02]} r={[0.2, 0, 0]} c="#6b4a2b" />
      <Box args={[0.09, 0.06, 0.15]} p={[-0.08, 0.03, 0.03]} c="#3d2a1c" />
      <Box args={[0.09, 0.06, 0.15]} p={[0.08, 0.03, 0.06]} c="#3d2a1c" r={[0, 0.3, 0]} />
      {/* torn shirt */}
      <Cyl args={[0.15, 0.17, 0.3, 8]} p={[0, 0.4, 0]} c="#5f86a8" />
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return <Cone key={i} args={[0.05, 0.08 + (i % 3) * 0.03, 4]} p={[Math.sin(a) * 0.16, 0.22, Math.cos(a) * 0.16]} r={[Math.PI, 0, 0]} c="#4f7394" />;
      })}
      <Box args={[0.07, 0.06, 0.02]} p={[0.05, 0.45, 0.16]} c="#3d5a75" r={[0, 0, 0.4]} />
      <Box args={[0.05, 0.05, 0.02]} p={[-0.07, 0.36, 0.165]} c={skin} r={[0, 0, -0.3]} />
      {/* arms reaching forward */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.17, 0.5, 0.02]} rotation={[-1.35 + s * 0.12, 0, 0]}>
          <Capsule args={[0.045, 0.2, 4, 8]} p={[0, 0.13, 0]} c="#5f86a8" />
          <Capsule args={[0.04, 0.08, 4, 8]} p={[0, 0.3, 0]} c={skin} />
        </group>
      ))}
      {/* head with stitches and messy hair */}
      <Sphere rad={0.16} p={[0.02, 0.72, 0.03]} r={[0, 0, 0.18]} s={[1, 1.05, 1]} c={skin} flat={false} />
      <group position={[0.02, 0, 0]}>
        <group position={[-0.06, 0.74, 0.16]}>
          <Sphere rad={0.05} c="#fffbe6" s={[1, 1, 0.6]} flat={false} />
          <Sphere rad={0.022} p={[0.01, 0, 0.03]} c="#1a1020" flat={false} />
        </group>
        <group position={[0.06, 0.76, 0.15]}>
          <Sphere rad={0.03} c="#fffbe6" s={[1, 1, 0.6]} flat={false} />
          <Sphere rad={0.014} p={[0, 0, 0.02]} c="#1a1020" flat={false} />
        </group>
        <Box args={[0.1, 0.015, 0.015]} p={[0, 0.65, 0.17]} r={[0, 0, -0.2]} c="#3a1420" />
        <Box args={[0.1, 0.012, 0.012]} p={[0.07, 0.83, 0.13]} r={[0.3, 0, 0.5]} c="#2f5a2a" />
        {[-0.03, 0, 0.03].map((x) => (
          <Box key={x} args={[0.01, 0.04, 0.012]} p={[0.07 + x, 0.83, 0.135]} r={[0.3, 0, 0.5]} c="#2f5a2a" />
        ))}
        {[-0.08, -0.02, 0.05, 0.1].map((x, i) => (
          <Cone key={x} args={[0.04, 0.1, 4]} p={[x, 0.87, -0.02 + i * 0.01]} r={[-0.3, 0, x * 3]} c="#3b2a3f" />
        ))}
      </group>
    </group>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────
function Skeleton() {
  const bone = '#f1ead2';
  const joint = (p: Vec) => <Sphere rad={0.03} p={p} c={bone} />;
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cyl args={[0.022, 0.022, 0.13, 6]} p={[s * 0.07, 0.1, 0]} c={bone} />
          <Cyl args={[0.025, 0.025, 0.13, 6]} p={[s * 0.07, 0.24, 0]} c={bone} />
          {joint([s * 0.07, 0.17, 0])}
          <Box args={[0.07, 0.03, 0.12]} p={[s * 0.07, 0.02, 0.03]} c={bone} />
        </group>
      ))}
      {/* pelvis, spine and ribs */}
      <Torus args={[0.08, 0.025, 6, 12, Math.PI * 1.2]} p={[0, 0.31, 0]} r={[Math.PI / 2, 0, -Math.PI * 0.1 + Math.PI]} c={bone} />
      <Cyl args={[0.022, 0.022, 0.34, 6]} p={[0, 0.48, -0.03]} c={bone} />
      {[0.4, 0.46, 0.52, 0.58].map((y, i) => (
        <Torus key={y} args={[0.13 - i * 0.012 + (i === 0 ? -0.02 : 0), 0.018, 5, 14, Math.PI * 1.55]} p={[0, y, -0.02]} r={[Math.PI / 2, 0, Math.PI * 0.72]} s={[1, 0.85, 1]} c={bone} />
      ))}
      <Box args={[0.03, 0.18, 0.02]} p={[0, 0.5, 0.1]} c={bone} />
      <Torus args={[0.13, 0.02, 5, 14, Math.PI]} p={[0, 0.64, -0.02]} r={[Math.PI / 2, 0, Math.PI]} c={bone} />
      {/* arms */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.15, 0.62, 0]} rotation={[0.1, 0, s * 0.25]}>
          {joint([0, 0, 0])}
          <Cyl args={[0.02, 0.02, 0.15, 6]} p={[0, -0.09, 0]} c={bone} />
          {joint([0, -0.17, 0])}
          <group position={[0, -0.17, 0]} rotation={[-0.6, 0, 0]}>
            <Cyl args={[0.018, 0.018, 0.14, 6]} p={[0, -0.07, 0]} c={bone} />
            <Sphere rad={0.035} p={[0, -0.16, 0]} s={[1, 1.2, 0.6]} c={bone} />
          </group>
        </group>
      ))}
      {/* skull and jaw */}
      <Sphere rad={0.16} p={[0, 0.8, 0]} s={[1, 0.95, 1]} c={bone} seg={14} flat={false} />
      <Box args={[0.16, 0.06, 0.12]} p={[0, 0.68, 0.05]} c={bone} />
      {[-1, 1].map((s) => (
        <Sphere key={s} rad={0.045} p={[s * 0.058, 0.8, 0.13]} s={[1, 1.15, 0.6]} c="#1a1020" flat={false} />
      ))}
      {[-1, 1].map((s) => (
        <Sphere key={`g${s}`} rad={0.012} p={[s * 0.058, 0.81, 0.16]} c="#7ff5e6" emissive="#7ff5e6" ei={1.4} />
      ))}
      <Cone args={[0.022, 0.04, 3]} p={[0, 0.74, 0.155]} r={[Math.PI, 0, 0]} c="#1a1020" />
      {[-0.045, -0.015, 0.015, 0.045].map((x) => (
        <Box key={x} args={[0.022, 0.03, 0.01]} p={[x, 0.69, 0.113]} c="#fffdf2" />
      ))}
    </group>
  );
}

// ── Vampire ──────────────────────────────────────────────────────────────
function Vampire() {
  const pale = '#e9e1f0';
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Cyl args={[0.05, 0.05, 0.22, 6]} p={[s * 0.07, 0.13, 0]} c="#1b1622" />
          <Box args={[0.08, 0.05, 0.15]} p={[s * 0.07, 0.025, 0.03]} c="#0d0a12" rough={0.3} />
        </group>
      ))}
      <Cyl args={[0.15, 0.13, 0.32, 10]} p={[0, 0.4, 0]} c="#1b1622" />
      <Box args={[0.14, 0.24, 0.02]} p={[0, 0.41, 0.135]} c="#a3203c" />
      <Box args={[0.06, 0.1, 0.02]} p={[0, 0.5, 0.148]} c="#f7f2ff" />
      <Cone args={[0.03, 0.05, 3]} p={[0, 0.5, 0.16]} r={[Math.PI / 2, 0, 0]} c="#1b1622" />
      <Sphere rad={0.025} p={[0, 0.4, 0.15]} c="#f2c14e" metal={0.8} rough={0.3} />
      {/* cape: black outside, red lining */}
      <mesh position={[0, 0.36, -0.02]} castShadow>
        <coneGeometry args={[0.3, 0.62, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76]} />
        <meshStandardMaterial color="#120c18" roughness={0.6} side={THREE.FrontSide} flatShading />
      </mesh>
      <mesh position={[0, 0.36, -0.02]}>
        <coneGeometry args={[0.295, 0.62, 16, 1, true, Math.PI * 0.62, Math.PI * 0.76]} />
        <meshStandardMaterial color="#b5213f" roughness={0.5} side={THREE.BackSide} flatShading />
      </mesh>
      {/* high collar */}
      <mesh position={[0, 0.66, -0.02]} rotation={[0, 0, 0]} castShadow>
        <coneGeometry args={[0.19, 0.26, 12, 1, true, Math.PI * 0.55, Math.PI * 0.9]} />
        <meshStandardMaterial color="#b5213f" roughness={0.5} side={THREE.DoubleSide} flatShading />
      </mesh>
      <group rotation={[Math.PI, 0, 0]} position={[0, 0.7, -0.02]}>
        <mesh castShadow>
          <coneGeometry args={[0.2, 0.26, 12, 1, true, Math.PI * 0.45, Math.PI * 1.1]} />
          <meshStandardMaterial color="#120c18" roughness={0.6} side={THREE.DoubleSide} flatShading />
        </mesh>
      </group>
      {/* arms */}
      {[-1, 1].map((s) => (
        <Capsule key={s} args={[0.045, 0.17, 4, 8]} p={[s * 0.18, 0.42, 0.02]} r={[0, 0, s * 0.2]} c="#1b1622" />
      ))}
      {/* head, slick hair, fangs */}
      <Sphere rad={0.14} p={[0, 0.72, 0.01]} s={[1, 1.08, 1]} c={pale} flat={false} />
      <mesh position={[0, 0.75, -0.005]} castShadow>
        <sphereGeometry args={[0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45]} />
        <meshStandardMaterial color="#141018" roughness={0.25} metalness={0.2} />
      </mesh>
      <Cone args={[0.04, 0.07, 3]} p={[0, 0.82, 0.13]} r={[Math.PI + 0.35, 0, 0]} c="#141018" />
      <Eyes y={0.73} z={0.12} spread={0.05} size={0.03} pupil="#b5213f" />
      {[-1, 1].map((s) => (
        <Box key={s} args={[0.05, 0.012, 0.01]} p={[s * 0.05, 0.775, 0.13]} r={[0, 0, s * -0.3]} c="#141018" />
      ))}
      <Box args={[0.06, 0.01, 0.01]} p={[0, 0.66, 0.135]} c="#6a1a2a" />
      {[-1, 1].map((s) => (
        <Cone key={s} args={[0.008, 0.028, 4]} p={[s * 0.018, 0.645, 0.133]} r={[Math.PI, 0, 0]} c="#ffffff" />
      ))}
    </group>
  );
}

const MODELS: Record<CharacterId, () => ReactNode> = {
  knight: Knight,
  goblin: Goblin,
  witch: Witch,
  zombie: Zombie,
  skeleton: Skeleton,
  vampire: Vampire,
};

export function CharacterModel({ id }: { id: CharacterId }) {
  const M = MODELS[id];
  return <M />;
}

/** A turned wooden base with a coloured rim and the player's number. */
export function Base({ color, number }: { color: string; number: number }) {
  const tex = useMemo(() => badgeTexture(String(number), color), [color, number]);
  return (
    <group>
      <mesh position={[0, -0.03, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[0.34, 0.37, 0.07, 24]} />
        <meshStandardMaterial color="#2a1d14" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.005, 0]}>
        <torusGeometry args={[0.335, 0.025, 8, 32]} />
        <meshStandardMaterial color={color} roughness={0.4} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0.008, 0.24]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 20]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
