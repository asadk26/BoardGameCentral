// The ways on at a fork, described the same way on the TV and on phones: a
// number, a colour and an arrow pointing where the corridor goes from the
// traveller's point of view (the follow camera sits behind the traveller, so
// "left" on the phone is left on the TV). Room names are only extra context.

import { moveExits, moveLandings, actingPiece } from './engine/engine';
import type { GameState } from './engine/types';
import { nodeXZ, playerHeading } from './scene/layout';
import type { EdgeKind } from './engine/graph';

export const FORK_COLORS = ['#ffd23f', '#5ff2e0', '#ff7ab6', '#a6ff6a'];

export interface ForkChoice {
  to: number;
  kind: EdgeKind;
  /** 1-based, left to right as the traveller faces. */
  num: number;
  color: string;
  /** Angle from straight ahead, radians (negative = to the left). */
  rel: number;
  /** World yaw of the corridor (for 3D arrows). */
  yaw: number;
  word: 'Left' | 'Ahead' | 'Right' | 'Back';
  /** Where the move can end if it goes this way. */
  landings: number[];
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function forkChoices(g: GameState): ForkChoice[] {
  const pi = actingPiece(g);
  if (pi < 0 || g.phase !== 'choose' || !g.move) return [];
  const here = g.pieces[pi].node;
  const heading = playerHeading(g, pi); // yaw the traveller faces
  const [hx, hz] = nodeXZ(here);
  const list = moveExits(g).map((e) => {
    const [x, z] = nodeXZ(e.to);
    const yaw = Math.atan2(x - hx, z - hz);
    // Model yaw: +x is to the traveller's left when facing +z... so positive yaw difference = turn left.
    const rel = -wrap(yaw - heading);
    return { to: e.to, kind: e.kind, yaw, rel };
  });
  list.sort((a, b) => a.rel - b.rel || a.to - b.to);
  return list.map((e, i) => ({
    ...e,
    num: i + 1,
    color: FORK_COLORS[i % FORK_COLORS.length],
    word: Math.abs(e.rel) < 0.6 ? 'Ahead' : Math.abs(e.rel) > 2.6 ? 'Back' : e.rel < 0 ? 'Left' : 'Right',
    landings: moveLandings(g, e.to),
  }));
}

/** The step action for a choice. */
export function stepFor(g: GameState, to: number) {
  return { type: 'step' as const, at: g.pieces[actingPiece(g)].node, left: g.move!.remaining, to };
}
