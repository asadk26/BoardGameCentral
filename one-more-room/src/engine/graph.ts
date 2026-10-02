// Graph queries shared by the rules, the previews and the renderer.

import { GHOST_WALL_LINKS, NODE_COUNT, ORDINARY_EDGES, SECRET_EDGES } from './config';

function buildAdjacency(edges: ReadonlyArray<readonly [number, number]>): number[][] {
  const adj: number[][] = Array.from({ length: NODE_COUNT }, () => []);
  for (const [a, b] of edges) {
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
  }
  for (const list of adj) list.sort((x, y) => x - y);
  return adj;
}

/** Ordinary neighbours, ascending by id. */
export const ORDINARY_ADJ: readonly (readonly number[])[] = buildAdjacency(ORDINARY_EDGES);
/** Secret-passage neighbours (every piece, at most one per move). */
export const SECRET_ADJ: readonly (readonly number[])[] = buildAdjacency(SECRET_EDGES);
/** Ghost-only links straight through a wall. */
export const WALL_ADJ: readonly (readonly number[])[] = buildAdjacency(GHOST_WALL_LINKS);

export function isSecretEdge(a: number, b: number): boolean {
  return SECRET_ADJ[a].includes(b);
}

export function isWallEdge(a: number, b: number): boolean {
  return WALL_ADJ[a].includes(b);
}

/**
 * Breadth-first search over ordinary edges. Neighbours are expanded in
 * ascending id order, so the first path found to a node is its shortest path
 * with the lower-next-node-id tie-break applied at every step.
 */
export function bfs(start: number): { dist: number[]; parent: number[] } {
  const dist = new Array<number>(NODE_COUNT).fill(Infinity);
  const parent = new Array<number>(NODE_COUNT).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    for (const m of ORDINARY_ADJ[n]) {
      if (dist[m] !== Infinity) continue;
      dist[m] = dist[n] + 1;
      parent[m] = n;
      queue.push(m);
    }
  }
  return { dist, parent };
}

const DIST: number[][] = Array.from({ length: NODE_COUNT }, (_, i) => bfs(i).dist);

/** Ordinary-edge distance: what attack range, retreats and Poltergeists measure. */
export function ordinaryDistance(a: number, b: number): number {
  return DIST[a][b];
}

/** A ghost may challenge from the living piece's space or one ordinary edge away. */
export function inAttackRange(a: number, b: number): boolean {
  return DIST[a][b] <= 1;
}

// ── exact-roll movement ─────────────────────────────────────────────────

/** o = ordinary corridor, s = secret passage (one per move), w = ghost-only wall link. */
export type EdgeKind = 'o' | 's' | 'w';

export interface Exit {
  to: number;
  kind: EdgeKind;
}

/**
 * Where a piece standing on `node` may step next. A move never turns straight
 * back along the edge it just used, unless that is the only way on (a dead
 * end), so movement can never lock up. Loops are allowed. Hidden traps are
 * never an input.
 */
export function exitsFrom(node: number, prev: number | null, usedSecret: boolean, ghost: boolean): Exit[] {
  const all: Exit[] = ORDINARY_ADJ[node].map((to) => ({ to, kind: 'o' as const }));
  if (ghost) for (const to of WALL_ADJ[node]) all.push({ to, kind: 'w' });
  if (!usedSecret) for (const to of SECRET_ADJ[node]) all.push({ to, kind: 's' });
  all.sort((a, b) => a.to - b.to);
  const onward = all.filter((e) => e.to !== prev);
  return onward.length ? onward : all;
}

const landCache = new Map<string, number[]>();

/** Every space a move can end on, from `node` with `remaining` steps still to take. */
export function landingsFrom(node: number, prev: number | null, remaining: number, usedSecret: boolean, ghost: boolean): number[] {
  if (remaining <= 0) return [node];
  const key = `${node}:${prev}:${remaining}:${usedSecret ? 1 : 0}:${ghost ? 1 : 0}`;
  let hit = landCache.get(key);
  if (!hit) {
    const out = new Set<number>();
    for (const e of exitsFrom(node, prev, usedSecret, ghost)) for (const n of landingsFrom(e.to, node, remaining - 1, usedSecret || e.kind === 's', ghost)) out.add(n);
    hit = [...out].sort((a, b) => a - b);
    landCache.set(key, hit);
  }
  return hit;
}

/** Spaces a fresh move of exactly `steps` can end on. */
export function exactReach(start: number, steps: number, ghost: boolean): number[] {
  return landingsFrom(start, null, steps, false, ghost);
}
