// Plain-language descriptions of game state for the HUD, phones and logs.
// All output is text rendered by React as text nodes — never as HTML. Nothing
// here may mention an unrevealed trap: callers pass public state.

import { CURSE_MULTIPLIERS, curseMultiplier, ENTRANCE, GHOST_MIN_MOVE, nodeKind, ROOMS, SEANCE_LIMIT, secretPairLabel, SUPER_REAPER } from './engine/config';
import { actingPiece, activeController, livingPiece } from './engine/engine';
import type { Challenge, ChallengeOutcome, GameState, LogEntry, MovePreview } from './engine/types';
import type { Personalization } from './engine/save';

export function nodeName(id: number, pz: Personalization): string {
  if (id === ENTRANCE) return 'Entrance Hall';
  if (ROOMS[id]) return pz.roomNames[id] ?? ROOMS[id].defaultName;
  if (id === SUPER_REAPER) return 'Super Reaper';
  if (nodeKind(id) === 'secret') return `Secret Passage ${secretPairLabel(id)}`;
  if (id === 16) return 'The Lair';
  return 'Hallway';
}

/** Name with a space number so identical names ("Hallway") stay distinguishable. */
export function placeName(id: number, pz: Personalization): string {
  return `${nodeName(id, pz)} · ${id}`;
}

export const EFFECT_NAMES = { reaper: 'Reaper’s Challenge', seance: 'Séance', poltergeist: 'Poltergeist' } as const;

/** "Alive for 3 rounds • Jump window 20% narrower" — or null when there is no curse yet. */
export function curseLine(streak: number): string | null {
  const m = curseMultiplier(streak);
  const rounds = `Alive for ${streak} round${streak === 1 ? '' : 's'}`;
  if (m >= 1) return streak > 0 ? `${rounds} • normal jump window` : null;
  return `${rounds} • Jump window ${Math.round((1 - m) * 100)}% narrower${streak >= CURSE_MULTIPLIERS.length - 1 ? ' (the most it gets)' : ''}`;
}

/** Who controls a piece this round, for pairs: "Maya’s round". */
export function controllerLine(state: GameState, piece: number): string | null {
  const p = state.pieces[piece];
  if (p.bot || p.controllers.length < 2) return null;
  return `${p.controllers[activeController(state, piece)]}’s round`;
}

export function rollLine(state: GameState): string | null {
  if (state.die === null) return null;
  const me = state.pieces[actingPiece(state)];
  if (!me.alive && state.die < GHOST_MIN_MOVE) return `Rolled ${state.die} • Ghost drift: ${state.allowance} spaces`;
  return `Rolled ${state.die} • Move up to ${state.allowance} space${state.allowance === 1 ? '' : 's'}`;
}

export function superReaperLine(state: GameState): string {
  const left = SEANCE_LIMIT - state.seancesUsed;
  return left > 0 ? `Super Reaper: a Séance for everyone (${left} of ${SEANCE_LIMIT} left)` : 'Super Reaper: a Reaper’s Challenge (no Séances left)';
}

export const CHALLENGE_TITLE = 'Haunted Jump Rope';

export function challengeTitle(ch: Challenge): string {
  if (ch.kind === 'seance') return `Séance · ${CHALLENGE_TITLE}`;
  if (ch.host === 'contact') return `Challenge! · ${CHALLENGE_TITLE}`;
  return `Reaper’s Challenge · ${CHALLENGE_TITLE}`;
}

export function challengeHowTo(ch: Challenge): string {
  const who = ch.kind === 'seance' ? `All ${ch.participants.length} of you jump` : 'You both jump';
  return `${who} the same spectral rope, eight sweeps — and it speeds up after every sweep. Press just before it reaches your feet — one press per sweep; holding or mashing never counts twice. The most clean jumps holds the life. Tied at the top? Only the tied jump up to four sudden-death sweeps, then the steadiest timing wins, and an exact tie gets the Reaper’s verdict.`;
}

export function challengeHost(ch: Challenge, state: GameState): string {
  const name = (i: number) => state.pieces[i]?.name ?? '?';
  const living = name(ch.livingAtStart);
  if (ch.kind === 'seance') return ch.host === 'superReaper' ? `The Super Reaper calls a Séance. Whoever jumps best holds the life — ${living} has it now.` : `A Séance! Whoever jumps best holds the life — ${living} has it now.`;
  const other = ch.participants.find((p) => p !== ch.livingAtStart)!;
  if (ch.host === 'contact') return `${name(other)} challenges ${living} for the life!`;
  return `The Reaper summons ${name(other)} and ${living}: winner holds the life.`;
}

export function previewSummary(p: MovePreview, state: GameState, pz: Personalization): string {
  const bits: string[] = [];
  if (p.dest === 'stay') bits.push('Stay here');
  else bits.push(`${nodeName(p.dest, pz)} (${p.path.length - 1} ${p.path.length === 2 ? 'step' : 'steps'}${p.usesSecret ? ', secret passage' : ''}${p.usesWall ? ', through the wall' : ''})`);
  if (p.superReaper) bits.push(p.superReaper === 'seance' ? 'Super Reaper: Séance for everyone' : 'Super Reaper: Reaper’s Challenge');
  else if (p.known === 'reaper') bits.push(state.pieces[actingPiece(state)].alive ? 'Reaper’s Challenge: pick a ghost to duel' : 'Reaper’s Challenge: duel the living piece from here');
  else if (p.known === 'seance') bits.push('Séance for everyone');
  else if (p.known === 'poltergeist') bits.push('Poltergeist: thrown elsewhere');
  if (p.canChallenge) bits.push(`${state.pieces[livingPiece(state)].name} in range — you may challenge`);
  if (p.threats.length) bits.push(`in range of ${p.threats.map((t) => state.pieces[t].name).join(', ')} now`);
  return bits.join(' • ');
}

export function outcomeLines(o: ChallengeOutcome, state: GameState, pz: Personalization): string[] {
  const name = (i: number) => state.pieces[i]?.name ?? '?';
  const lines: string[] = [];
  const how =
    o.decidedBy === 'suddenDeath'
      ? ` — sudden death (${o.extraSweepsUsed} sweep${o.extraSweepsUsed === 1 ? '' : 's'}) among ${o.finalists.map(name).join(', ')}`
      : o.decidedBy === 'timing'
        ? ` — tied, then the steadier timing decided`
        : o.decidedBy === 'verdict'
          ? ` — a perfect tie: the Reaper’s seeded verdict chose`
          : '';
  lines.push(`${o.participants.map((p, k) => `${name(p)} ${o.scores[k]}/8${o.multipliers[k] < 1 ? ' (cursed)' : ''}`).join(' · ')}${how}.`);
  lines.push(o.transferred ? `${name(o.winner)} steals the life from ${name(o.previousLiving)}!` : `${name(o.winner)} keeps the life.`);
  for (const m of o.moves) {
    if (m.reason === 'claim') lines.push(`${name(m.piece)} takes the space at ${placeName(m.to, pz)}.`);
    else lines.push(`${name(m.piece)} is thrown back to ${placeName(m.to, pz)}.`);
  }
  return lines;
}

export function logLine(e: LogEntry, state: GameState, pz: Personalization): string | null {
  const name = (i: number) => state.pieces[i]?.name ?? '?';
  switch (e.kind) {
    case 'lifeRoll':
      return `${name(e.winner)} rolled highest and starts alive.`;
    case 'spawn':
      return e.alive ? null : `${name(e.piece)} haunts ${placeName(e.node, pz)}.`;
    case 'roundStart':
      return `Round ${e.round}: ${e.schedule.map(name).join(' → ')}.`;
    case 'roll':
      return `${name(e.piece)} rolled ${e.die}${e.allowance !== e.die ? ` (ghost drift ${e.allowance})` : ''}.`;
    case 'move':
      return `${name(e.piece)} moved ${e.path.length - 1} to ${placeName(e.path[e.path.length - 1], pz)}${e.usesSecret ? ' through a secret passage' : ''}${e.usesWall ? ' through the wall' : ''}.`;
    case 'stay':
      return `${name(e.piece)} stayed.`;
    case 'trapRevealed':
      return `${EFFECT_NAMES[e.effect]} revealed at ${placeName(e.node, pz)}.`;
    case 'seanceDormant':
      return `The Séance at ${placeName(e.node, pz)} is cold: both Séances have been used.`;
    case 'superReaper':
      return e.effect === 'seance' ? 'The Super Reaper calls a Séance.' : 'The Super Reaper calls a Reaper’s Challenge.';
    case 'poltergeist':
      return `A Poltergeist threw ${name(e.piece)} to ${placeName(e.to, pz)}.`;
    case 'challenge':
      return `${e.challenge.kind === 'seance' ? 'Séance' : e.challenge.host === 'contact' ? 'Challenge' : 'Reaper’s Challenge'}: ${e.challenge.participants.map(name).join(' vs ')}.`;
    case 'outcome':
      return outcomeLines(e.outcome, state, pz).join(' ');
    case 'lifeTransfer':
      return `${name(e.to)} now holds the life.`;
    case 'huntDeclined':
      return `${name(e.piece)} let the chance pass.`;
    case 'roundEnd':
      return `${name(e.piece)} held the life at the bell: +1 (total ${e.score}).`;
    case 'gameOver':
      return 'The last bell has rung.';
    default:
      return null;
  }
}
