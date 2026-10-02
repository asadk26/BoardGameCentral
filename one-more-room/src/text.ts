// Plain-language descriptions of game state for the HUD, phones and logs.
// All output is text rendered by React as text nodes — never as HTML. Nothing
// here may mention an unrevealed trap: callers pass public state.

import {
  CURSE_MULTIPLIERS,
  curseMultiplier,
  ENTRANCE,
  nodeKind,
  ROOMS,
  SEANCE_LIMIT,
  secretPairLabel,
  STRIDE_ALLOWANCE,
  SUPER_REAPER,
  VERSUS_SPACES,
  type ItemId,
} from './engine/config';
import { activeController, livingPiece } from './engine/engine';
import type { Challenge, ChallengeOutcome, GameState, LogEntry, MovePreview } from './engine/types';
import type { Personalization } from './engine/save';

export function nodeName(id: number, pz: Personalization): string {
  if (id === ENTRANCE) return 'Entrance Hall';
  if (ROOMS[id]) return pz.roomNames[id] ?? ROOMS[id].defaultName;
  if (id === SUPER_REAPER) return 'Super Reaper';
  if (nodeKind(id) === 'secret') return `Secret Passage ${secretPairLabel(id)}`;
  if (id === 16) return 'The Lair';
  if (VERSUS_SPACES.includes(id)) return 'Versus Space';
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

/** "6 spaces" (or Ghostly Stride / Second Roll), exactly how far this move goes. */
export function rollLine(state: GameState): string | null {
  if (state.rollInfo?.kind === 'stride') return `Ghostly Stride · ${STRIDE_ALLOWANCE} spaces`;
  if (state.die === null) return null;
  const n = `${state.allowance} space${state.allowance === 1 ? '' : 's'}`;
  if (state.rollInfo?.rerolledFrom !== undefined) return `Second Roll ${state.rollInfo.rerolledFrom} → ${state.die} · ${n}`;
  return n;
}

const ROMAN = ['', 'I', 'II', 'III'];
/** "Curse II: shorter jumps", from a jump multiplier (1 = no curse). */
export function cursePhrase(multiplier: number): string {
  const tier = Math.round((1 - multiplier) * 10);
  return tier <= 0 ? 'no curse' : `Curse ${ROMAN[Math.min(3, tier)]}: shorter jumps`;
}

/** "Maya steals life" / "Leo keeps life" / "Ana wins an item". */
export function outcomeHeadline(ch: Challenge, winner: number, state: GameState): string {
  const name = state.pieces[winner]?.name ?? '?';
  if (ch.host === 'ghostBattle' || ch.host === 'versus') return `${name} wins an item`;
  return winner === ch.livingAtStart ? `${name} keeps life` : `${name} steals life`;
}

export function superReaperLine(state: GameState): string {
  const left = SEANCE_LIMIT - state.seancesUsed;
  return left > 0 ? `Super Reaper: a Séance for everyone (${left} of ${SEANCE_LIMIT} left)` : 'Super Reaper: a Reaper’s Challenge (no Séances left)';
}

export const CHALLENGE_TITLE = 'Haunted Jump Rope';

// ── items ───────────────────────────────────────────────────────────────

export const ITEM_INFO: Record<ItemId, { name: string; icon: string; when: string; what: string }> = {
  secondRoll: {
    name: 'Second Roll',
    icon: '🎲',
    when: 'After you roll, before you move',
    what: 'Roll one new die before you move. The new number replaces the old one for good, even if it is lower.',
  },
  ghostSwitch: {
    name: 'Ghost Switch',
    icon: '🔄',
    when: 'Before you roll',
    what: 'Swap places with another ghost anywhere on the board. Nothing triggers where either of you appears; then roll and move as usual.',
  },
  ghostlyStride: {
    name: 'Ghostly Stride',
    icon: '👣',
    when: 'Before you roll, instead of rolling',
    what: `Move exactly ${STRIDE_ALLOWANCE} spaces without rolling.`,
  },
};

export function itemTooltip(item: ItemId): string {
  const i = ITEM_INFO[item];
  return `${i.name} — ${i.when}. ${i.what} One use; lost if you gain the life.`;
}

export const BATTLE_LABEL = 'Battle ghost • win an item';
export const CHALLENGE_LABEL = 'Challenge living • steal life';

export function challengeTitle(ch: Challenge): string {
  if (ch.kind === 'seance') return `Séance · ${CHALLENGE_TITLE}`;
  if (ch.host === 'ghostBattle' || ch.host === 'versus') return `Ghost Battle · ${CHALLENGE_TITLE}`;
  if (ch.host === 'contact') return `Challenge! · ${CHALLENGE_TITLE}`;
  return `Reaper’s Challenge · ${CHALLENGE_TITLE}`;
}

export function challengeHowTo(ch: Challenge): string {
  if (ch.host === 'ghostBattle' || ch.host === 'versus')
    return 'You both jump the same spectral rope, eight sweeps — and it speeds up after every sweep. Press just before it reaches your feet. No curse here: both of you get the normal window. The winner gets one random item; the loser loses nothing. Nobody moves, and the life stays where it is.';
  const who = ch.kind === 'seance' ? `All ${ch.participants.length} of you jump` : 'You both jump';
  return `${who} the same spectral rope, eight sweeps — and it speeds up after every sweep. Press just before it reaches your feet — one press per sweep; holding or mashing never counts twice. The most clean jumps holds the life. Tied at the top? Only the tied jump up to four sudden-death sweeps, then the steadiest timing wins, and an exact tie gets the Reaper’s verdict.`;
}

export function challengeHost(ch: Challenge, state: GameState): string {
  const name = (i: number) => state.pieces[i]?.name ?? '?';
  const living = name(ch.livingAtStart);
  if (ch.host === 'ghostBattle' || ch.host === 'versus') {
    const [a, b] = [ch.instigator, ch.participants.find((p) => p !== ch.instigator)!];
    return ch.host === 'versus'
      ? `${name(a)} calls ${name(b)} to battle from the Versus space — winner gets an item.`
      : `${name(a)} battles ${name(b)} — winner gets an item.`;
  }
  if (ch.kind === 'seance')
    return ch.host === 'superReaper'
      ? `The Super Reaper calls a Séance. Whoever jumps best holds the life — ${living} has it now.`
      : `A Séance! Whoever jumps best holds the life — ${living} has it now.`;
  const other = ch.participants.find((p) => p !== ch.livingAtStart)!;
  if (ch.host === 'contact') return `${name(other)} challenges ${living} for the life!`;
  return `The Reaper summons ${name(other)} and ${living}: winner holds the life.`;
}

/** A few words about a possible landing (public facts only). */
export function previewSummary(p: MovePreview, state: GameState, pz: Personalization): string {
  const bits: string[] = [nodeName(p.dest, pz)];
  if (p.superReaper) bits.push(p.superReaper === 'seance' ? 'Super Reaper: Séance' : 'Super Reaper: Reaper duel');
  else if (p.known === 'reaper') bits.push('Reaper duel');
  else if (p.known === 'seance') bits.push('Séance');
  else if (p.known === 'poltergeist') bits.push('Poltergeist');
  if (p.canChallenge) bits.push(`can challenge ${state.pieces[livingPiece(state)].name}`);
  if (p.battleTargets.length || p.versus) bits.push('can battle a ghost');
  if (p.threats.length) bits.push(`near ${p.threats.map((t) => state.pieces[t].name).join(', ')}`);
  return bits.join(' · ');
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
  if (o.reward) {
    lines.push(
      `${name(o.winner)} wins the ghost battle and an item: ${ITEM_INFO[o.reward].icon} ${ITEM_INFO[o.reward].name}. Nobody moves; the life stays where it was.`,
    );
    return lines;
  }
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
      return `${name(e.piece)} rolled ${e.die}.`;
    case 'move':
      return e.remaining > 0 ? null : `${name(e.piece)} landed on ${placeName(e.path[e.path.length - 1], pz)}.`;
    case 'trapRevealed':
      return `${EFFECT_NAMES[e.effect]} revealed at ${placeName(e.node, pz)}.`;
    case 'seanceDormant':
      return `The Séance at ${placeName(e.node, pz)} is cold: both Séances have been used.`;
    case 'superReaper':
      return e.effect === 'seance' ? 'The Super Reaper calls a Séance.' : 'The Super Reaper calls a Reaper’s Challenge.';
    case 'poltergeist':
      return `A Poltergeist threw ${name(e.piece)} to ${placeName(e.to, pz)}.`;
    case 'challenge':
      return `${e.challenge.kind === 'seance' ? 'Séance' : e.challenge.host === 'contact' ? 'Challenge' : e.challenge.host === 'ghostBattle' || e.challenge.host === 'versus' ? 'Ghost battle' : 'Reaper’s Challenge'}: ${e.challenge.participants.map(name).join(' vs ')}.`;
    case 'versusInactive':
      return e.reason === 'noGhosts'
        ? `The Versus space at ${placeName(e.node, pz)} stays quiet: there is no other ghost to battle.`
        : `The Versus space at ${placeName(e.node, pz)} stays quiet: ${name(e.piece)} has battled every ghost this round.`;
    case 'rewardPending':
      return `${name(e.piece)} must choose: keep ${ITEM_INFO[e.current].name} or take ${ITEM_INFO[e.offered].name}.`;
    case 'itemAwarded': {
      const it = (x: ItemId) => `${ITEM_INFO[x].icon} ${ITEM_INFO[x].name}`;
      if (e.duplicate) return `${name(e.piece)} already holds ${it(e.kept)}: one per piece, so nothing changes.`;
      if (e.replaced) return `${name(e.piece)} swaps ${ITEM_INFO[e.replaced].name} for ${it(e.kept)}.`;
      if (e.kept !== e.item) return `${name(e.piece)} keeps ${it(e.kept)} and leaves ${ITEM_INFO[e.item].name}.`;
      return `${name(e.piece)} now holds ${it(e.kept)}.`;
    }
    case 'itemUsed':
      if (e.item === 'secondRoll') return `${name(e.piece)} used Second Roll: ${e.detail?.oldDie} → ${e.detail?.newDie}.`;
      if (e.item === 'ghostSwitch') return `${name(e.piece)} used Ghost Switch and swapped places with ${name(e.detail?.target ?? -1)}.`;
      return `${name(e.piece)} used Ghostly Stride: up to ${STRIDE_ALLOWANCE} spaces, no roll.`;
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
