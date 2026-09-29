// Hidden-information boundary. Everything a phone, the TV, a bot or a public
// log may see goes through these functions. The full GameState — trap map,
// nominations, RNG state, deck order — stays with the authority.

import type { GameState } from './types';

/**
 * What everybody at the table may know: revealed traps only, no nominations
 * (just who has finished choosing), no RNG state, no deck order (only its
 * size). The current challenge's seed stays, because every screen needs it
 * to draw the same rope and ring; it comes from its own stream.
 */
export function publicView(s: GameState): GameState {
  return {
    ...s,
    seed: 0,
    rng: 0,
    challengeRng: 0,
    deck: s.deck.map(() => -1),
    nominations: s.nominations.map((n) => (n === null ? null : -1)),
    traps: s.traps.filter((t) => t.revealed).map((t) => ({ ...t })),
    players: s.players.map((p) => ({ ...p })),
    log: s.log.slice(),
  };
}

/** The public view plus the one private fact a seat is allowed: its own nomination. */
export interface SeatView {
  state: GameState;
  seat: number;
  ownNomination: number | null;
}

export function seatView(s: GameState, seat: number): SeatView {
  return { state: publicView(s), seat, ownNomination: s.nominations[seat] ?? null };
}

/** Who has finished the secret placement — the only placement fact that is public. */
export function placementProgress(s: GameState): boolean[] {
  return s.nominations.map((n) => n !== null);
}
