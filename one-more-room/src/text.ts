// Plain-language descriptions of game state for the HUD, phones and logs.
// All output is text rendered by React as text nodes — never as HTML. Nothing
// here may mention an unrevealed trap: callers pass public state.

import { cardFlavorIndex, cardType, CHALLENGE, ENTRANCE, EVENT_INFO, nodeKind, ROOMS, SCORING, secretPairLabel, SUPER_REAPER } from './engine/config';
import type { ChallengeOutcome, Encounter, GameState, GhostPlan, LogEntry, MovePreview } from './engine/types';
import type { Personalization } from './engine/save';
import type { ChallengeKind } from './engine/challenges';

export function nodeName(id: number, pz: Personalization): string {
  if (id === ENTRANCE) return 'Entrance Hall';
  if (ROOMS[id]) return pz.roomNames[id] ?? ROOMS[id].defaultName;
  if (id === SUPER_REAPER) return 'Super Reaper';
  const kind = nodeKind(id);
  if (kind === 'event') return 'Trick or Treat';
  if (kind === 'secret') return `Secret Passage ${secretPairLabel(id)}`;
  if (id === 16) return `${pz.ghostName}'s Lair`;
  return 'Hallway';
}

/** Name with a space number so identical names ("Hallway") stay distinguishable. */
export function placeName(id: number, pz: Personalization): string {
  return `${nodeName(id, pz)} · ${id}`;
}

export function cardFlavor(cardId: number, pz: Personalization): string {
  const type = cardType(cardId);
  return pz.flavors[type] || EVENT_INFO[type].flavors[cardFlavorIndex(cardId)];
}

export const CHALLENGE_TITLES: Record<ChallengeKind, string> = {
  escape: 'Break the Curse',
  dance: 'Dance for Death',
  rope: 'Graveyard Jump Rope',
  duel: 'Haunted Jump Rope',
};

export function challengeHowTo(kind: ChallengeKind, oneSurvivor: boolean): string {
  const pass = CHALLENGE.rope.pass;
  switch (kind) {
    case 'escape':
      return 'A marker circles the ring. Press when it is inside the glowing zone. Two tries — one hit breaks the curse.';
    case 'dance':
      return 'Death shows four moves, one at a time. Then repeat them in order. Two sequences — get one right to live. A wrong move ends that try.';
    case 'rope':
      return `The spectral rope sweeps eight times. Jump just before it reaches your feet. Clear at least ${pass} of 8 to live.`;
    case 'duel':
      return oneSurvivor
        ? 'Both of you jump the same rope, eight sweeps. The lower score becomes a ghost. Tied? Up to four sudden-death sweeps, then the steadier timing, then the curse decides.'
        : `Both of you jump the same rope, eight sweeps. Each needs ${pass} of 8 to live — both may survive, or neither.`;
  }
}

export function ghostSummary(plan: GhostPlan, state: GameState, pz: Personalization): string {
  const g = pz.ghostName;
  if (!plan.target) return `${g} waits — nobody is out and unprotected`;
  const steps = plan.path.length - 1;
  const who = plan.target.kind === 'decoy' ? `${g} chases the decoy` : `${g} hunts ${state.players[plan.target.player!].name}`;
  const parts = [who, `${steps} ${steps === 1 ? 'space' : 'spaces'}`];
  if (plan.encounter) parts.push(`catches ${state.players[plan.encounter.player].name} → escape challenge`);
  else if (!plan.reachesTarget) parts.push(`${plan.fullPath.length - plan.path.length} short`);
  else parts.push('reaches it');
  return parts.join(' • ');
}

export function encounterWarning(enc: Encounter, state: GameState, waives: boolean): string | null {
  const names = (ids: number[]) => ids.map((i) => state.players[i].name).join(' or ');
  switch (enc.kind) {
    case 'duel':
      return enc.lethal
        ? `Duel with ${names(enc.opponents)} — after the bell, only one of you survives`
        : `Duel with ${names(enc.opponents)} — Haunted Jump Rope, each needs ${CHALLENGE.rope.pass} of 8`;
    case 'superReaper':
      return enc.opponents.length
        ? `Super Reaper: you and an opponent you choose jump for your lives — one survivor${waives ? ' (your protection does not apply here)' : ''}`
        : `Super Reaper: nobody to summon, so you perform for Death alone${waives ? ' (protection does not apply)' : ''}`;
    case 'reaper':
      return `A revealed Reaper waits here — you must survive its game${waives ? ' (your protection does not apply here)' : ''}`;
    case 'haunt':
      return `Haunt ${names(enc.targets)}: they must break the curse or join the dead`;
    default:
      return null;
  }
}

export function previewSummary(p: MovePreview, state: GameState, pz: Personalization): string {
  const bits: string[] = [];
  if (p.dest === 'stay') bits.push('Stay put');
  else bits.push(`${nodeName(p.dest, pz)} (${p.path.length - 1} ${p.path.length === 2 ? 'step' : 'steps'}${p.usesSecret ? ', secret passage' : ''})`);
  if (p.harvest) bits.push(`+${p.harvest} candy`);
  if (p.dest !== 'stay' && ROOMS[p.dest]) {
    const left = state.stocks[p.dest] - p.harvest;
    bits.push(p.harvest ? `${left} left` : 'room is empty');
  }
  if (p.pile) bits.push(`+${p.pile} from the floor`);
  if (p.dest === ENTRANCE) bits.push(p.bank ? `bank ${p.bank}` : 'safe');
  if (p.triggersEvent) bits.push('draw a Trick or Treat card');
  if (p.encounter.kind !== 'none' && p.encounter.kind !== 'haunt' && (p.harvest || p.pile)) bits.push('(only if you survive)');
  return bits.join(' • ');
}

export function outcomeLines(o: ChallengeOutcome, state: GameState, pz: Personalization): string[] {
  const name = (i: number) => state.players[i]?.name ?? '?';
  const lines: string[] = [];
  const title = CHALLENGE_TITLES[o.kind];
  const how = o.decidedBy === 'suddenDeath' ? 'sudden-death sweeps' : o.decidedBy === 'timing' ? 'steadier timing' : o.decidedBy === 'curse' ? 'the curse (an exact tie)' : null;
  if (o.kind === 'duel') lines.push(`${title}: ${o.participants.map((p, k) => `${name(p)} ${o.scores[k]}/8`).join(' vs ')}${how ? ` — decided by ${how}` : ''}.`);
  else lines.push(`${title}: ${name(o.participants[0])} ${o.survivors.length ? 'survived' : 'failed'}.`);
  for (const d of o.deaths) lines.push(`${name(d.player)} became a ghost${d.dropped ? `, dropping ${d.dropped} candy` : ''}. Their banked candy stays theirs.`);
  for (const r of o.relocations) lines.push(`${name(r.player)} fled to ${placeName(r.to, pz)}.`);
  for (const s of o.survivors) lines.push(`${name(s)} is protected until the end of their next turn.`);
  if (o.bounty) lines.push(o.bounty.amount ? `${name(o.bounty.player)} earns a ${o.bounty.amount}-point haunting bounty (${state.players[o.bounty.player].bounty}/${SCORING.bountyCap}).` : `${name(o.bounty.player)} is already at the ${SCORING.bountyCap}-point bounty cap.`);
  return lines;
}

export function logLine(e: LogEntry, state: GameState, pz: Personalization): string | null {
  const name = (i: number) => state.players[i]?.name ?? '?';
  switch (e.kind) {
    case 'decoy':
      return `${name(e.player)} left a decoy sweet at ${nodeName(e.node, pz)}.`;
    case 'roll':
      return e.dice.length === 1 ? `${name(e.player)} rolled a ${e.dice[0]} (ghost turn).` : `${name(e.player)} rolled ${e.dice[0]} and ${e.dice[1]}.`;
    case 'move':
      return `${name(e.player)} moved ${e.path.length - 1} to ${nodeName(e.path[e.path.length - 1], pz)}${e.usesSecret ? ' through a secret passage' : ''}.`;
    case 'stay':
      return `${name(e.player)} stayed put.`;
    case 'harvest':
      return e.amount ? `Took ${e.amount} candy (${e.remaining} left in the ${nodeName(e.node, pz)}).` : `The ${nodeName(e.node, pz)} is empty.`;
    case 'pile':
      return `Scooped up ${e.amount} dropped candy.`;
    case 'bank':
      return e.amount ? `Banked ${e.amount} candy (bank: ${e.total}).` : 'Safe in the Entrance Hall.';
    case 'card':
      return `Drew “${EVENT_INFO[cardType(e.cardId)].title}”.`;
    case 'relocate':
      return `${name(e.player)} slipped through to ${placeName(e.to, pz)}.`;
    case 'steal':
      return `${name(e.player)} stole ${e.amount} from ${name(e.victim)}.`;
    case 'gain':
      return `${name(e.player)} found ${e.amount} candy.`;
    case 'ghostBonus':
      return `${pz.ghostName} moves ${e.amount} extra this turn.`;
    case 'swap':
      return `${name(e.player)} and ${name(e.other)} swapped places.`;
    case 'drop':
      return `${e.amount} candy flew out onto the floor.`;
    case 'noEffect':
      return e.reason;
    case 'declined':
      return `${name(e.player)} declined the card.`;
    case 'trapRevealed':
      return `A Reaper rose from ${placeName(e.node, pz)}! It stays there for good.`;
    case 'spared':
      return `${name(e.player)} was protected, so the Reaper let them pass — this time.`;
    case 'challenge':
      return `${CHALLENGE_TITLES[e.challenge.kind]}: ${e.challenge.participants.map(name).join(' vs ')}.`;
    case 'outcome':
      return outcomeLines(e.outcome, state, pz).join(' ');
    case 'ghost': {
      const plan = e.plan;
      const target = plan.target?.kind === 'decoy' ? 'the decoy' : plan.target ? name(plan.target.player!) : 'nobody';
      return `${pz.ghostName} drifted ${plan.path.length - 1} toward ${target}${plan.encounter ? ` and caught ${name(plan.encounter.player)}` : ''}.`;
    }
    case 'ghostWaits':
      return `${pz.ghostName} waited — nobody was out and unprotected.`;
    case 'gameOver':
      return e.reason === 'noneAlive' ? 'Nobody is left alive. The house wins the night.' : 'Midnight!';
    default:
      return null;
  }
}
