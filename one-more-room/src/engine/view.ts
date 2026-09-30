// Hidden-information boundary. Everything a phone, the TV, a bot or a public
// log may see goes through these functions. The full GameState — trap
// locations and effects, nominations, RNG state — stays with the authority.

import type { GameState } from './types';

/**
 * What everybody at the table may know: revealed traps (with their effects),
 * the Super Reaper and the shared Séance count (both on the state), who has
 * finished choosing (not what), and no RNG state. The current challenge's
 * seed stays, because every screen needs it to draw the same rope; it comes
 * from its own stream and reveals nothing else.
 */
export function publicView(s: GameState): GameState {
  return {
    ...s,
    seed: 0,
    rng: 0,
    challengeRng: 0,
    // Future rewards stay unpredictable: the reward stream never leaves the authority.
    rewardRng: 0,
    nominations: s.nominations.map((n) => (n === null ? null : -1)),
    traps: s.traps.filter((t) => t.revealed).map((t) => ({ ...t })),
    pieces: s.pieces.map((p) => ({ ...p, controllers: p.controllers.slice() })),
    battlesThisRound: s.battlesThisRound.slice(),
    schedule: s.schedule.slice(),
    log: s.log.slice(),
  };
}

/** The public view plus the one private fact a piece may know: its own nomination. */
export interface SeatView {
  state: GameState;
  piece: number;
  ownNomination: number | null;
}

export function seatView(s: GameState, piece: number): SeatView {
  return { state: publicView(s), piece, ownNomination: s.nominations[piece] ?? null };
}

/** Who has finished the secret placement — the only placement fact that is public. */
export function placementProgress(s: GameState): boolean[] {
  return s.nominations.map((n) => n !== null);
}
