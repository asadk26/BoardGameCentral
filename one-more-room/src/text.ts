// Plain-language descriptions of game state for the HUD. All output is text
// rendered by React as text nodes — never as HTML.

import { cardFlavorIndex, cardType, ENTRANCE, EVENT_INFO, nodeKind, ROOMS, secretPairLabel } from './engine/config';
import type { GameState, GhostPlan, LogEntry, MovePreview } from './engine/types';
import type { Personalization } from './engine/save';

export function nodeName(id: number, pz: Personalization): string {
  if (id === ENTRANCE) return 'Entrance Hall';
  if (ROOMS[id]) return pz.roomNames[id] ?? ROOMS[id].defaultName;
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

export function ghostSummary(plan: GhostPlan, state: GameState, pz: Personalization): string {
  const g = pz.ghostName;
  if (!plan.target) return `${g} waits — everyone is safe in the Entrance Hall`;
  const steps = plan.path.length - 1;
  const who =
    plan.target.kind === 'decoy'
      ? `${g} chases the decoy`
      : `${g} hunts ${state.players[plan.target.player].name}`;
  const parts = [who, `${steps} ${steps === 1 ? 'space' : 'spaces'}`];
  if (plan.catches.length) parts.push(`catches ${plan.catches.map((c) => state.players[c.player].name).join(' & ')}`);
  else if (!plan.reachesTarget) {
    const short = plan.fullPath.length - plan.path.length;
    parts.push(`${short} short`);
  } else parts.push('reaches it');
  return parts.join(' • ');
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
  if (p.pile) bits.push(`+${p.pile} from pile`);
  if (p.dest === ENTRANCE) bits.push(p.bank ? `bank ${p.bank}` : 'safe');
  if (p.triggersEvent) bits.push('draw a Trick or Treat card');
  return bits.join(' • ');
}

export function logLine(e: LogEntry, state: GameState, pz: Personalization): string | null {
  const name = (i: number) => state.players[i]?.name ?? '?';
  switch (e.kind) {
    case 'decoy':
      return `${name(e.player)} left a decoy sweet at ${nodeName(e.node, pz)}.`;
    case 'roll':
      return `${name(e.player)} rolled ${e.dice[0]} and ${e.dice[1]}.`;
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
    case 'ghost': {
      const plan = e.plan;
      const target = plan.target?.kind === 'decoy' ? 'the decoy' : plan.target ? name(plan.target.player) : 'nobody';
      const lines = [`${pz.ghostName} drifted ${plan.path.length - 1} toward ${target}.`];
      for (const c of plan.catches) {
        lines.push(
          `${name(c.player)} was caught: dropped ${c.dropped}, banked ${c.retained} on the way home.`,
        );
      }
      if (!plan.catches.length) lines.push('Nobody was caught.');
      return lines.join(' ');
    }
    case 'ghostWaits':
      return `${pz.ghostName} waited — nobody was out in the house.`;
    default:
      return null;
  }
}
