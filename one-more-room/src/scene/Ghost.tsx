import { useMemo } from 'react';
import * as THREE from 'three';

/** The shared enemy: a translucent bedsheet ghost with a wavy hem. */
export function GhostModel({ glow = 1 }: { glow?: number }) {
  const geom = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.sin(a) * 0.36, 1.05 + Math.cos(a) * 0.36));
    }
    pts.push(new THREE.Vector2(0.38, 0.8), new THREE.Vector2(0.42, 0.5), new THREE.Vector2(0.5, 0.18), new THREE.Vector2(0.56, 0.02));
    const g = new THREE.LatheGeometry(pts, 36);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.3) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const a = Math.atan2(x, z);
        const w = (0.3 - y) / 0.3;
        pos.setY(i, y + Math.sin(a * 7) * 0.07 * w);
      }
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={geom} castShadow>
        <meshStandardMaterial
          color="#dcfff9"
          emissive="#39d8c8"
          emissiveIntensity={0.45 * glow}
          roughness={0.35}
          transparent
          opacity={0.78}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* little arms */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.4, 0.7, 0.05]} rotation={[0, 0, s * -0.9]} scale={[0.6, 1, 0.5]}>
          <sphereGeometry args={[0.12, 12, 8]} />
          <meshStandardMaterial color="#dcfff9" emissive="#39d8c8" emissiveIntensity={0.45 * glow} transparent opacity={0.78} depthWrite={false} />
        </mesh>
      ))}
      {/* face */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.12, 1.08, 0.33]} scale={[0.8, 1.2, 0.4]}>
          <sphereGeometry args={[0.07, 14, 10]} />
          <meshStandardMaterial color="#10222a" roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.92, 0.34]} scale={[0.8, 1, 0.4]}>
        <sphereGeometry args={[0.06, 14, 10]} />
        <meshStandardMaterial color="#10222a" roughness={0.3} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[s * 0.22, 0.98, 0.29]} scale={[1, 0.6, 0.3]}>
          <sphereGeometry args={[0.04, 10, 8]} />
          <meshBasicMaterial color="#7ff5e6" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  );
}
