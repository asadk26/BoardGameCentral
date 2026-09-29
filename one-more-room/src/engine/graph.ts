// Graph queries shared by the rules, the previews and the renderer.

import { ENTRANCE, NODE_COUNT, ORDINARY_EDGES, SECRET_EDGES } from './config';

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
/** Secret-passage neighbours (players only). */
export const SECRET_ADJ: readonly (readonly number[])[] = buildAdjacency(SECRET_EDGES);

export function isSecretEdge(a: number, b: number): boolean {
  return SECRET_ADJ[a].includes(b);
}

/**
 * Breadth-first search over ordinary edges, optionally skipping blocked nodes.
 * Neighbours are expanded in ascending id order, so the first path found to a
 * node is its shortest path with the lower-next-node-id tie-break applied at
 * every step (lexicographically smallest among the shortest).
 */
export function bfs(
  start: number,
  opts: { blocked?: (n: number) => boolean } = {},
): { dist: number[]; parent: number[] } {
  const dist = new Array<number>(NODE_COUNT).fill(Infinity);
  const parent = new Array<number>(NODE_COUNT).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const n = queue[qi];
    for (const m of ORDINARY_ADJ[n]) {
      if (dist[m] !== Infinity) continue;
      if (opts.blocked?.(m)) continue;
      dist[m] = dist[n] + 1;
      parent[m] = n;
      queue.push(m);
    }
  }
  return { dist, parent };
}

export function pathFromParents(parent: number[], start: number, target: number): number[] | null {
  if (start === target) return [start];
  if (parent[target] === -1) return null;
  const path = [target];
  let n = target;
  while (n !== start) {
    n = parent[n];
    if (n === -1) return null;
    path.push(n);
  }
  return path.reverse();
}

/** The ghost never enters the entrance hall and ignores secret passages. */
export function ghostBfs(start: number) {
  return bfs(start, { blocked: (n) => n === ENTRANCE });
}

export function ghostPath(start: number, target: number): number[] | null {
  const { parent } = ghostBfs(start);
  return pathFromParents(parent, start, target);
}

export function ghostDistance(a: number, b: number): number {
  return ghostBfs(a).dist[b];
}

export interface PlayerRoute {
  dest: number;
  /** Full node sequence including the start node. */
  path: number[];
  usesSecret: boolean;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

/**
 * Every legal destination for a player move of 1..allowance steps, each with
 * its deterministic route: the shortest legal route, lower next-node id first
 * on ties. Legal routes are simple paths that never enter the ghost's node,
 * use at most one secret-passage edge, and stop on entering the entrance hall.
 * Routes are enumerated exhaustively (the graph is tiny), which makes both the
 * shortest-route and the tie-break rule easy to trust.
 */
export function playerRoutes(start: number, allowance: number, ghostNode: number): Map<number, PlayerRoute> {
  const best = new Map<number, PlayerRoute>();
  const path = [start];
  const onPath = new Set([start]);

  const visit = (usedSecret: boolean) => {
    const here = path[path.length - 1];
    if (path.length > 1) {
      const current = best.get(here);
      const candidate = path.slice();
      if (
        !current ||
        candidate.length < current.path.length ||
        (candidate.length === current.path.length && lexLess(candidate, current.path))
      ) {
        best.set(here, { dest: here, path: candidate, usesSecret: usedSecret });
      }
      if (here === ENTRANCE) return; // arriving at the entrance ends movement
    }
    if (path.length - 1 >= allowance) return;
    const steps: Array<[number, boolean]> = [];
    for (const m of ORDINARY_ADJ[here]) steps.push([m, false]);
    if (!usedSecret) for (const m of SECRET_ADJ[here]) steps.push([m, true]);
    steps.sort((a, b) => a[0] - b[0]);
    for (const [m, secret] of steps) {
      if (m === ghostNode || onPath.has(m)) continue;
      path.push(m);
      onPath.add(m);
      visit(usedSecret || secret);
      path.pop();
      onPath.delete(m);
    }
  };
  visit(false);
  return best;
}
