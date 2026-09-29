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

export interface PlayerRoute {
  dest: number;
  /** Full node sequence including the start node. */
  path: number[];
  usesSecret: boolean;
  usesWall: boolean;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

/**
 * Every destination reachable in 1..allowance steps, each with its
 * deterministic route: the shortest legal route, lower next-node id first on
 * ties. Routes are simple paths using at most one secret-passage edge; ghosts
 * may also cross the wall links (one step each). Pieces never block one
 * another and the entrance is an ordinary space. Routes are enumerated
 * exhaustively (the graph is tiny).
 *
 * Hidden traps are deliberately not an input: route output can never depend
 * on where they are.
 */
export function pieceRoutes(start: number, allowance: number, ghost: boolean): Map<number, PlayerRoute> {
  const best = new Map<number, PlayerRoute>();
  const path = [start];
  const onPath = new Set([start]);

  const visit = (usedSecret: boolean, usedWall: boolean) => {
    const here = path[path.length - 1];
    if (path.length > 1) {
      const current = best.get(here);
      const candidate = path.slice();
      if (!current || candidate.length < current.path.length || (candidate.length === current.path.length && lexLess(candidate, current.path))) {
        best.set(here, { dest: here, path: candidate, usesSecret: usedSecret, usesWall: usedWall });
      }
    }
    if (path.length - 1 >= allowance) return;
    const steps: Array<[number, 'o' | 's' | 'w']> = [];
    for (const m of ORDINARY_ADJ[here]) steps.push([m, 'o']);
    if (ghost) for (const m of WALL_ADJ[here]) steps.push([m, 'w']);
    if (!usedSecret) for (const m of SECRET_ADJ[here]) steps.push([m, 's']);
    steps.sort((a, b) => a[0] - b[0]);
    for (const [m, kind] of steps) {
      if (onPath.has(m)) continue;
      path.push(m);
      onPath.add(m);
      visit(usedSecret || kind === 's', usedWall || kind === 'w');
      path.pop();
      onPath.delete(m);
    }
  };
  visit(false, false);
  return best;
}
