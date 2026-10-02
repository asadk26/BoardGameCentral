// World-space layout for the mansion: where nodes sit, where rooms and walls
// go, and how several miniatures share a space. Pure geometry — no rules.

import { ENTRANCE, NODE_POSITIONS, ORDINARY_EDGES, type RoomKey } from '../engine/config';
import type { GameState } from '../engine/types';

export type V2 = [number, number];
export type V3 = [number, number, number];

export const FLOOR_Y = 0;
export const NODE_TOP = 0.14;

export function nodeXZ(id: number): V2 {
  const [x, z] = NODE_POSITIONS[id];
  return [x, z];
}

export function nodePos(id: number, y = NODE_TOP): V3 {
  const [x, z] = NODE_POSITIONS[id];
  return [x, y, z];
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface RoomPlot {
  node: number;
  key: RoomKey | 'entrance' | 'lair';
  rect: Rect;
  floor: string;
  accent: string;
  wallHeight: number;
}

/**
 * Room plots. Corridors run through them; walls get doorways where they do.
 * Room walls are knee-high rails: rooms read by their floors and rails, and
 * never hide a piece.
 */
export const ROOM_PLOTS: RoomPlot[] = [
  { node: 3, key: 'kitchen', rect: { x0: -7.1, z0: 5.0, x1: -2.9, z1: 6.9 }, floor: '#6b4a33', accent: '#e8913a', wallHeight: 0.34 },
  { node: 7, key: 'dining', rect: { x0: -12.3, z0: 2.9, x1: -8.9, z1: 6.7 }, floor: '#5a2230', accent: '#e05262', wallHeight: 0.34 },
  { node: 10, key: 'conservatory', rect: { x0: -9.2, z0: -2.9, x1: -6.9, z1: 1.1 }, floor: '#2f4a33', accent: '#7fd36b', wallHeight: 0.34 },
  { node: 15, key: 'attic', rect: { x0: -3.1, z0: -7.0, x1: -0.95, z1: -3.0 }, floor: '#5b4632', accent: '#d8a657', wallHeight: 0.34 },
  { node: 16, key: 'lair', rect: { x0: -0.95, z0: -7.0, x1: 0.95, z1: -3.0 }, floor: '#23324a', accent: '#5ff2e0', wallHeight: 0.34 },
  { node: 17, key: 'crypt', rect: { x0: 0.95, z0: -7.0, x1: 3.1, z1: -3.0 }, floor: '#3d3d48', accent: '#a7b4d8', wallHeight: 0.34 },
  { node: 22, key: 'laboratory', rect: { x0: 6.9, z0: -2.9, x1: 9.2, z1: 1.1 }, floor: '#233d44', accent: '#6ef0a8', wallHeight: 0.34 },
  { node: 25, key: 'nursery', rect: { x0: 8.9, z0: 2.9, x1: 12.3, z1: 6.7 }, floor: '#4a3552', accent: '#f29ad6', wallHeight: 0.34 },
  { node: 29, key: 'library', rect: { x0: 2.9, z0: 5.0, x1: 7.1, z1: 6.9 }, floor: '#3f2a1f', accent: '#c98a4b', wallHeight: 0.34 },
  { node: ENTRANCE, key: 'entrance', rect: { x0: -3.0, z0: 7.0, x1: 3.0, z1: 10.4 }, floor: '#5a3b24', accent: '#f2b84b', wallHeight: 0.34 },
];

/**
 * The mansion's outer footprint, clockwise: a north gallery, two wings, the
 * central grand hall, and the entrance block with the front doors at z=10.4.
 */
export const MANSION_OUTLINE: V2[] = [
  [-4.9, -7.6],
  [4.9, -7.6],
  [4.9, -3.5],
  [12.9, -3.5],
  [12.9, 7.4],
  [5.0, 7.4],
  [5.0, 9.0],
  [3.0, 9.0],
  [3.0, 10.4],
  [-3.0, 10.4],
  [-3.0, 9.0],
  [-5.0, 9.0],
  [-5.0, 7.4],
  [-12.9, 7.4],
  [-12.9, -3.5],
  [-4.9, -3.5],
];
export const FRONT_DOOR: V2 = [0, 10.4];

export interface WallSeg {
  a: V2;
  b: V2;
  height: number;
  thickness: number;
  color: string;
  outer: boolean;
}

function segIntersect(p: V2, p2: V2, q: V2, q2: V2): V2 | null {
  const r: V2 = [p2[0] - p[0], p2[1] - p[1]];
  const s: V2 = [q2[0] - q[0], q2[1] - q[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-9) return null;
  const qp: V2 = [q[0] - p[0], q[1] - p[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p[0] + t * r[0], p[1] + t * r[1]];
}

const DOOR = 1.25;

/** Split a wall line wherever a corridor crosses it, leaving a doorway. */
function wallWithDoors(a: V2, b: V2, height: number, color: string, outer: boolean, extraDoors: V2[] = []): WallSeg[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const cuts: number[] = [];
  for (const [u, v] of ORDINARY_EDGES) {
    const hit = segIntersect(a, b, NODE_POSITIONS[u] as V2, NODE_POSITIONS[v] as V2);
    if (hit) cuts.push((hit[0] - a[0]) * dir[0] + (hit[1] - a[1]) * dir[1]);
  }
  for (const d of extraDoors) cuts.push((d[0] - a[0]) * dir[0] + (d[1] - a[1]) * dir[1]);
  cuts.sort((x, y) => x - y);
  const segs: WallSeg[] = [];
  let start = 0;
  for (const c of cuts) {
    const end = c - DOOR / 2;
    if (end - start > 0.15) segs.push(mk(start, end));
    start = c + DOOR / 2;
  }
  if (len - start > 0.15) segs.push(mk(start, len));
  return segs;

  function mk(t0: number, t1: number): WallSeg {
    return {
      a: [a[0] + dir[0] * t0, a[1] + dir[1] * t0],
      b: [a[0] + dir[0] * t1, a[1] + dir[1] * t1],
      height,
      thickness: outer ? 0.35 : 0.18,
      color,
      outer,
    };
  }
}

function rectWalls(r: Rect, height: number, color: string): WallSeg[] {
  return [
    ...wallWithDoors([r.x0, r.z0], [r.x1, r.z0], height, color, false),
    ...wallWithDoors([r.x1, r.z0], [r.x1, r.z1], height, color, false),
    ...wallWithDoors([r.x1, r.z1], [r.x0, r.z1], height, color, false),
    ...wallWithDoors([r.x0, r.z1], [r.x0, r.z0], height, color, false),
  ];
}

function dedupeShared(walls: WallSeg[]): WallSeg[] {
  // Rooms that touch (attic | lair | crypt) share a wall line; keep one copy.
  const key = (w: WallSeg) => {
    const pts = [w.a, w.b].map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).sort();
    return pts.join('|');
  };
  const seen = new Set<string>();
  return walls.filter((w) => {
    const k = key(w);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const WALLS: WallSeg[] = (() => {
  const inner = ROOM_PLOTS.filter((p) => p.key !== 'entrance').flatMap((p) => rectWalls(p.rect, p.wallHeight, '#4a3a5c'));
  // The foyer is open to the grand hall on its north side.
  const e = ROOM_PLOTS.find((p) => p.key === 'entrance')!.rect;
  // Its side walls stop where the outer wall takes over.
  const foyer = [
    ...wallWithDoors([e.x1, e.z0], [e.x1, 9.0], 0.34, '#4a3a5c', false),
    ...wallWithDoors([e.x0, 9.0], [e.x0, e.z0], 0.34, '#4a3a5c', false),
  ];
  const outerColor = '#3a2b4d';
  const outer = MANSION_OUTLINE.flatMap((a, i) => {
    const b = MANSION_OUTLINE[(i + 1) % MANSION_OUTLINE.length];
    const isFront = a[1] === FRONT_DOOR[1] && b[1] === FRONT_DOOR[1];
    // Low outer walls: a cut-away dolls' house, so no wall ever stands between the camera and a piece for long.
    return wallWithDoors(a, b, 0.7, outerColor, true, isFront ? [FRONT_DOOR] : []);
  });
  return dedupeShared([...inner, ...foyer, ...outer]);
})();

/** Offsets that arrange several miniatures around one space. */
export function slotOffset(index: number, count: number, isEntrance: boolean): V2 {
  if (count <= 1) return [0, 0];
  const r = isEntrance ? 0.62 : count === 2 ? 0.24 : 0.3;
  const a = -Math.PI / 2 + (index / count) * Math.PI * 2 + (count === 2 ? Math.PI / 2 : 0);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/**
 * Where a player's miniature stands, given everyone who shares its space.
 * With `frontYaw` (the direction from the space toward the follow camera),
 * the active player takes the spot nearest the camera so it is never hidden
 * behind the others. This is presentation only; the logical space is the same.
 */
export function playerSlot(state: GameState, player: number, frontYaw: number | null = null): V3 {
  const node = state.pieces[player].node;
  let here = state.pieces.map((p, i) => ({ p, i })).filter(({ p }) => p.node === node).map(({ i }) => i);
  const [x, y, z] = nodePos(node);
  const entrance = node === ENTRANCE;
  const acting = state.schedule[state.slot] ?? -1;
  if (frontYaw === null || here.length < 2 || !here.includes(acting)) {
    const [ox, oz] = slotOffset(here.indexOf(player), here.length, entrance);
    return [x + ox, y, z + oz];
  }
  here = [acting, ...here.filter((i) => i !== acting)];
  const k = here.indexOf(player);
  const r = entrance ? 0.62 : here.length === 2 ? 0.26 : 0.32;
  let yaw = frontYaw;
  if (here.length === 2) yaw = k === 0 ? frontYaw + 0.5 : frontYaw - 2.0; // side by side, active nearer
  else if (k > 0) {
    // The others share the arc behind, leaving the camera side clear.
    const gap = here.length === 2 ? 2.4 : 1.9;
    const others = here.length - 1;
    yaw = frontYaw + gap / 2 + ((k - 0.5) * (Math.PI * 2 - gap)) / others;
  }
  return [x + Math.sin(yaw) * r, y, z + Math.cos(yaw) * r];
}

export function headingBetween(from: V2, to: V2): number {
  // Yaw such that the model's +z (its front) points along from→to.
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

/** Heading of travel for a player (defaults to facing into the mansion). */
export function playerHeading(state: GameState, player: number): number {
  const p = state.pieces[player];
  if (p.facingFrom === null || p.facingFrom === p.node) return Math.PI; // facing north (−z)
  return headingBetween(nodeXZ(p.facingFrom), nodeXZ(p.node));
}

export const LINEUP_Z = 11.6;
export function lineupPos(i: number, count: number): V3 {
  const spacing = 1.35;
  return [(i - (count - 1) / 2) * spacing, 0.36, LINEUP_Z];
}
