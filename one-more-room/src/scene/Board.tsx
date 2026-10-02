import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { DECORATED_CORRIDORS, ENTRANCE, NODE_COUNT, ORDINARY_EDGES, ROOMS, SECRET_EDGES, VERSUS_SPACES, nodeKind, secretPairLabel } from '../engine/config';
import { MANSION_OUTLINE, NODE_TOP, ROOM_PLOTS, WALLS, nodePos, nodeXZ, type V2, type V3, type WallSeg } from './layout';
import { labelTexture, tileSymbolTexture } from './labels';
import { camInfo } from './shared';

export const PASSAGE_COLORS: Record<'A' | 'B', string> = { A: '#c77dff', B: '#7ee081' };

// ── ground, slab, floors ────────────────────────────────────────────────

export function Ground() {
  const slab = useMemo(() => {
    const shape = new THREE.Shape(MANSION_OUTLINE.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.56, 0);
    return g;
  }, []);
  return (
    <group>
      {/* the tabletop the miniature mansion sits on */}
      <mesh position={[0, -0.62, 1.5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[34, 48]} />
        <meshStandardMaterial color="#1c1226" roughness={0.9} />
      </mesh>
      <mesh geometry={slab} receiveShadow castShadow>
        <meshStandardMaterial color="#2d2338" roughness={0.85} />
      </mesh>
      {/* front porch and steps */}
      <mesh position={[0, -0.28, 11.6]} receiveShadow castShadow>
        <boxGeometry args={[9, 0.5, 2.4]} />
        <meshStandardMaterial color="#3b2f46" roughness={0.9} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, -0.36 - i * 0.1, 13.0 + i * 0.3]} receiveShadow>
          <boxGeometry args={[4 + i * 0.4, 0.3, 0.3]} />
          <meshStandardMaterial color="#3b2f46" roughness={0.9} />
        </mesh>
      ))}
      {/* stone flagging texture for the whole floor */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <shapeGeometry args={[new THREE.Shape(MANSION_OUTLINE.map(([x, z]) => new THREE.Vector2(x, -z)))]} />
        <meshStandardMaterial color="#332840" roughness={0.95} />
      </mesh>
      {ROOM_PLOTS.map((r) => (
        <mesh
          key={r.node}
          position={[(r.rect.x0 + r.rect.x1) / 2, 0.012, (r.rect.z0 + r.rect.z1) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[r.rect.x1 - r.rect.x0, r.rect.z1 - r.rect.z0]} />
          <meshStandardMaterial color={r.floor} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function Corridors() {
  return (
    <group>
      {ORDINARY_EDGES.map(([a, b]) => {
        const [ax, az] = nodeXZ(a);
        const [bx, bz] = nodeXZ(b);
        const len = Math.hypot(bx - ax, bz - az);
        const ang = Math.atan2(bx - ax, bz - az);
        return (
          <group key={`${a}-${b}`} position={[(ax + bx) / 2, 0.03, (az + bz) / 2]} rotation={[0, ang, 0]}>
            <mesh receiveShadow>
              <boxGeometry args={[0.86, 0.04, len]} />
              <meshStandardMaterial color="#b58a4a" roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.012, 0]} receiveShadow>
              <boxGeometry args={[0.66, 0.04, len]} />
              <meshStandardMaterial color="#7a2436" roughness={0.95} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ── walls that step aside for the camera ────────────────────────────────

function segDist2D(p1: V2, p2: V2, q1: V2, q2: V2): number {
  const d = (a: V2, b: V2, p: V2) => {
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const l2 = vx * vx + vz * vz || 1e-9;
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(a[0] + vx * t - p[0], a[1] + vz * t - p[1]);
  };
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const intersects =
    cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0;
  if (intersects) return 0;
  return Math.min(d(q1, q2, p1), d(q1, q2, p2), d(p1, p2, q1), d(p1, p2, q2));
}

function Wall({ w, index, register }: { w: WallSeg; index: number; register: (i: number, m: THREE.Material[]) => void }) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const ang = Math.atan2(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const cx = (w.a[0] + w.b[0]) / 2;
  const cz = (w.a[1] + w.b[1]) / 2;
  const mats = useMemo(() => {
    const body = new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.85, transparent: true, flatShading: true });
    const cap = new THREE.MeshStandardMaterial({ color: w.outer ? '#6a5580' : '#7d6a94', roughness: 0.7, transparent: true });
    const glass = new THREE.MeshBasicMaterial({ color: '#8fa2ff', transparent: true, opacity: 0.55, toneMapped: false });
    return [body, cap, glass];
  }, [w.color, w.outer]);
  useMemo(() => register(index, mats), [index, mats, register]);
  const windows = w.outer && len > 2.4 && w.height > 1 ? Math.floor(len / 3) : 0;
  return (
    <group position={[cx, 0, cz]} rotation={[0, ang, 0]}>
      <mesh position={[0, w.height / 2, 0]} material={mats[0]} castShadow receiveShadow>
        <boxGeometry args={[w.thickness, w.height, len + w.thickness * 0.6]} />
      </mesh>
      <mesh position={[0, w.height + 0.04, 0]} material={mats[1]} castShadow>
        <boxGeometry args={[w.thickness + 0.08, 0.08, len + w.thickness * 0.6 + 0.04]} />
      </mesh>
      {Array.from({ length: windows }, (_, i) => {
        const z = -len / 2 + (len / windows) * (i + 0.5);
        return (
          <group key={i}>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * (w.thickness / 2 + 0.005), w.height * 0.55, z]} rotation={[0, (s * Math.PI) / 2, 0]} material={mats[2]}>
                <planeGeometry args={[0.45, 0.6]} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

export function Walls({ fade }: { fade: boolean }) {
  const mats = useRef<THREE.Material[][]>([]);
  const register = useMemo(() => (i: number, m: THREE.Material[]) => (mats.current[i] = m), []);
  const levels = useRef<number[]>(WALLS.map(() => 1));
  useFrame((_, dt) => {
    const cam: V2 = [camInfo.position[0], camInfo.position[2]];
    const tgt: V2 = [camInfo.focus[0], camInfo.focus[2]];
    const k = 1 - Math.exp(-dt * 10);
    WALLS.forEach((w, i) => {
      let target = 1;
      if (fade) {
        const d = segDist2D(cam, tgt, w.a, w.b);
        // Walls between the camera and the piece (or right by the camera) fade away.
        if (d < 0.6) target = w.outer ? 0.08 : 0.12;
        else if (d < 1.4) target = 0.55;
      }
      const lv = (levels.current[i] += (target - levels.current[i]) * k);
      const ms = mats.current[i];
      if (!ms) return;
      ms[0].opacity = lv;
      ms[1].opacity = lv;
      ms[2].opacity = 0.55 * lv;
      ms[0].depthWrite = lv > 0.95;
      ms[1].depthWrite = lv > 0.95;
    });
  });
  return (
    <group>
      {WALLS.map((w, i) => (
        <Wall key={i} w={w} index={i} register={register} />
      ))}
    </group>
  );
}

// ── nodes, room plaques, passages ──────────────────────────────────────────────

function Tile({ id }: { id: number }) {
  const kind = nodeKind(id);
  const [x, , z] = nodePos(id, 0);
  const plot = ROOM_PLOTS.find((p) => p.node === id);
  const pair = secretPairLabel(id);
  const r = id === ENTRANCE ? 0.95 : 0.52;
  const versus = VERSUS_SPACES.includes(id);
  const color = versus
    ? '#d85cc8'
    : kind === 'entrance'
      ? '#e8b54a'
      : kind === 'room'
        ? plot!.accent
        : DECORATED_CORRIDORS.includes(id)
          ? '#b8703a'
          : kind === 'secret'
            ? PASSAGE_COLORS[pair!]
            : id === 16
              ? '#5ff2e0'
              : '#a595b8';
  const symbol = versus
    ? tileSymbolTexture('versus')
    : kind === 'secret'
      ? tileSymbolTexture(pair === 'A' ? 'secretA' : 'secretB')
      : kind === 'entrance'
        ? tileSymbolTexture('entrance')
        : null;
  const num = useMemo(() => labelTexture([String(id)], { bg: 'rgba(0,0,0,0)', fg: 'rgba(255,240,220,0.85)', height: 64 }).tex, [id]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.06, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r, r + 0.05, 0.12, 32]} />
        <meshStandardMaterial color="#2a2030" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.125, 0]} receiveShadow>
        <cylinderGeometry args={[r - 0.06, r - 0.06, 0.02, 32]} />
        <meshStandardMaterial color={color} roughness={0.55} emissive={color} emissiveIntensity={versus ? 0.3 : kind === 'corridor' ? 0.05 : 0.18} />
      </mesh>
      {symbol && (
        <mesh position={[0, 0.137, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[r * 1.5, r * 1.5]} />
          <meshBasicMaterial map={symbol} transparent depthWrite={false} />
        </mesh>
      )}
      {id !== ENTRANCE && (
        <mesh position={[0, 0.138, r - 0.17]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 0.15]} />
          <meshBasicMaterial map={num} transparent depthWrite={false} opacity={0.9} />
        </mesh>
      )}
    </group>
  );
}

export function Tiles() {
  return (
    <group>
      {Array.from({ length: NODE_COUNT }, (_, i) => (
        <Tile key={i} id={i} />
      ))}
    </group>
  );
}

/** "Versus" plaques over the two ghost-battle spaces, readable from either camera. */
export function VersusLabels() {
  return (
    <group>
      {VERSUS_SPACES.map((id) => {
        const [x, , z] = nodePos(id, 0);
        return <Label key={id} pos={[x, 0.95, z]} lines={['⚔ Versus']} scale={0.42} color="#f0a6e6" nearOnly />;
      })}
    </group>
  );
}

/** Room name plaques, beside each room's tile. */
export function RoomLabels({ roomNames }: { roomNames: Record<number, string> }) {
  return (
    <group>
      {Object.keys(ROOMS).map((idStr) => {
        const id = Number(idStr);
        // In the middle of the room, low down: away from the corridor and from pieces' heads.
        const plot = ROOM_PLOTS.find((p) => p.node === id);
        const [nx, , nz] = nodePos(id, 0);
        const x = plot ? (plot.rect.x0 + plot.rect.x1) / 2 : nx;
        const z = plot ? (plot.rect.z0 + plot.rect.z1) / 2 : nz + 0.6;
        const away = Math.hypot(x - nx, z - nz) < 0.9 ? 0.9 : 0; // rooms centred on their space: nudge the label off it
        return <Label key={id} pos={[x + away, 0.55, z + away]} lines={[roomNames[id] ?? ROOMS[id].defaultName]} scale={0.5} nearOnly />;
      })}
    </group>
  );
}

export function Label({ pos, lines, scale = 0.5, dim = false, color, nearOnly = false }: { pos: V3; lines: string[]; scale?: number; dim?: boolean; color?: string; nearOnly?: boolean }) {
  const { tex, aspect } = useMemo(
    () => labelTexture(lines, { fg: dim ? '#b8aec8' : color ?? '#fff3d6', border: color ? color : dim ? undefined : 'rgba(255,211,107,0.55)' }),
    [lines.join('\n'), dim, color], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ref = useRef<THREE.Sprite>(null);
  const h = scale * (lines.length > 1 ? 1.1 : 0.7);
  const base = dim ? 0.75 : 1;
  useFrame(({ camera }) => {
    const s = ref.current;
    if (!s) return;
    const d = camera.position.distanceTo(s.position);
    const f = Math.min(2.4, Math.max(0.55, d / 11));
    s.scale.set(h * aspect * f, h * f, 1);
    const near = Math.min(1, Math.max(0, (d - 4) / 3));
    // In the follow view only labels close to the moving piece show.
    const far = nearOnly && camInfo.follow ? Math.hypot(s.position.x - camInfo.focus[0], s.position.z - camInfo.focus[2]) : 0;
    const keep = far > 7 ? 0 : far > 5 ? 1 - (far - 5) / 2 : 1;
    (s.material as THREE.SpriteMaterial).opacity = base * near * keep;
    s.visible = keep > 0.01;
  });
  return (
    <sprite ref={ref} position={pos} scale={[h * aspect, h, 1]} renderOrder={5}>
      <spriteMaterial map={tex} transparent depthTest={false} depthWrite={false} opacity={base} />
    </sprite>
  );
}

/** Secret passage doors beside each endpoint, and arcs linking the pairs. */
export function Passages({ strong }: { strong: boolean }) {
  const arcs = useMemo(
    () =>
      SECRET_EDGES.map(([a, b]) => {
        const pa = new THREE.Vector3(...nodePos(a, 0.2));
        const pb = new THREE.Vector3(...nodePos(b, 0.2));
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        mid.y = 3.2;
        const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
        return { a, b, curve, color: PASSAGE_COLORS[secretPairLabel(a)!] };
      }),
    [],
  );
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  useFrame(({ clock }) => {
    mats.current.forEach((m, i) => {
      if (!m) return;
      m.opacity = (strong ? 0.75 : 0.28) + Math.sin(clock.elapsedTime * 2 + i) * 0.08;
    });
  });
  return (
    <group>
      {arcs.map((arc, i) => (
        <group key={i}>
          {Array.from({ length: 34 }, (_, k) => {
            const p = arc.curve.getPoint((k + 0.5) / 34);
            return (
              <mesh key={k} position={p}>
                <sphereGeometry args={[strong ? 0.07 : 0.05, 6, 4]} />
                <meshBasicMaterial
                  ref={(m) => {
                    if (m && k === 0) mats.current[i] = m;
                  }}
                  color={arc.color}
                  transparent
                  opacity={strong ? 0.75 : 0.28}
                  toneMapped={false}
                />
              </mesh>
            );
          })}
        </group>
      ))}
      {[8, 24, 11, 27].map((id) => (
        <PassageDoor key={id} id={id} />
      ))}
    </group>
  );
}

function PassageDoor({ id }: { id: number }) {
  // A little bookcase door standing just off the space, glowing with its pair colour.
  const [x, z] = nodeXZ(id);
  const pair = secretPairLabel(id)!;
  const color = PASSAGE_COLORS[pair];
  const offsets: Record<number, V2> = { 8: [-0.95, 0], 24: [0.95, 0], 11: [0, -0.95], 27: [0, 0.95] };
  const [ox, oz] = offsets[id];
  const rot = Math.atan2(-ox, -oz);
  return (
    <group position={[x + ox, 0, z + oz]} rotation={[0, rot, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.8, 1.0, 0.18]} />
        <meshStandardMaterial color="#3d2618" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.45, 0.1]}>
        <planeGeometry args={[0.5, 0.75]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <Label pos={[0, 1.25, 0]} lines={[`Passage ${pair}`]} scale={0.34} color={color} />
    </group>
  );
}

// ── interactive highlights ──────────────────────────────────────────────

export function NodeHitAreas({ onPick, onHover, pickable }: { onPick: (id: number) => void; onHover: (id: number | null) => void; pickable: Set<number> }) {
  return (
    <group>
      {Array.from({ length: NODE_COUNT }, (_, id) => {
        if (!pickable.has(id)) return null;
        const [x, , z] = nodePos(id, 0.3);
        return (
          <mesh
            key={id}
            position={[x, 0.3, z]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onPick(id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(id);
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              onHover(null);
              document.body.style.cursor = '';
            }}
          >
            <cylinderGeometry args={[id === ENTRANCE ? 1.0 : 0.62, id === ENTRANCE ? 1.0 : 0.62, 0.7, 16]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

export function Ring({ id, color, strength = 1, pulse = true, radius }: { id: number; color: string; strength?: number; pulse?: boolean; radius?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const r = radius ?? (id === ENTRANCE ? 1.02 : 0.6);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = pulse ? 1 + Math.sin(clock.elapsedTime * 4) * 0.05 : 1;
    ref.current.scale.set(s, s, 1);
  });
  const [x, , z] = nodePos(id, 0);
  return (
    <mesh ref={ref} position={[x, NODE_TOP + 0.02, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <ringGeometry args={[r - 0.08 * strength, r + 0.02, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

export function PathDots({
  path,
  color,
  size = 0.07,
  y = NODE_TOP + 0.05,
  dashed = false,
}: {
  path: number[];
  color: string;
  size?: number;
  y?: number;
  dashed?: boolean;
}) {
  const pts = useMemo(() => {
    const out: V3[] = [];
    for (let i = 1; i < path.length; i++) {
      const a = nodePos(path[i - 1], y);
      const b = nodePos(path[i], y);
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const n = Math.max(2, Math.round(len / 0.36));
      for (let k = 1; k < n; k++) {
        if (dashed && k % 2 === 0) continue;
        const t = k / n;
        out.push([a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  }, [path, y, dashed]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    pts.forEach((p, i) => {
      const s = 1 + Math.sin(clock.elapsedTime * 5 - i * 0.5) * 0.25;
      o.position.set(p[0], p[1], p[2]);
      o.scale.setScalar(s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.count = pts.length;
    m.instanceMatrix.needsUpdate = true;
  });
  if (!pts.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, pts.length)]} frustumCulled={false} renderOrder={4}>
      <sphereGeometry args={[size, 8, 6]} />
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} depthWrite={false} />
    </instancedMesh>
  );
}

export function Beacon({ id, color, children }: { id: number; color: string; children?: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 1.3 + Math.sin(clock.elapsedTime * 3) * 0.08;
  });
  const [x, , z] = nodePos(id, 0);
  return (
    <group position={[x, 0, z]}>
      <group ref={ref}>
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.16, 0.3, 4]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {children}
      </group>
    </group>
  );
}
