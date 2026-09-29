// Ordinary rule-based bots. They decide from a SeatView — the public state
// plus their own trap nomination — never from the authority's full state or
// its RNG. Personality (what they value) is separate from reflex skill (how
// well they press buttons in survival games).

import { ENTRANCE, ROUNDS, SCORING, TRAP_COUNT, TRAP_ELIGIBLE } from './config';
import { ghostDistance } from './graph';
import { canPlaceDecoy, isExposed, isProtected, legalRoutes, previewMove, scoreOf } from './engine';
import { bfs } from './graph';
import { nextFloat } from './rng';
import type { Action, GameState, MovePreview } from './types';
import type { SeatView } from './view';
import { SKILLS, type ReflexSkill } from './challenges';

export type Personality = 'cautious' | 'greedy' | 'mischievous';
export type SkillLevel = keyof typeof SKILLS;

export interface BotProfile {
  personality: Personality;
  skill: SkillLevel;
}

export interface BotMemory {
  /** The bot's own stream: nothing to do with the game's RNG. */
  rng: number;
  /** The move decided for the current turn, so select → confirm never wavers. */
  plan?: { key: string; md: 0 | 1; dest: number | 'stay' };
}

export function newBotMemory(seed: number): BotMemory {
  return { rng: seed >>> 0 };
}

const WEIGHTS: Record<Personality, { gain: number; risk: number; bank: number; mischief: number; unknown: number }> = {
  cautious: { gain: 0.8, risk: 1.4, bank: 1.3, mischief: 0.1, unknown: 1.3 },
  greedy: { gain: 1.3, risk: 0.7, bank: 0.9, mischief: 0.3, unknown: 0.7 },
  mischievous: { gain: 1.0, risk: 0.9, bank: 1.0, mischief: 1.2, unknown: 0.9 },
};

export function reflexOf(profile: BotProfile): ReflexSkill {
  return SKILLS[profile.skill];
}

function rand(mem: BotMemory): number {
  let v: number;
  [v, mem.rng] = nextFloat(mem.rng);
  return v;
}

const homeDist = bfs(ENTRANCE).dist;

/** Rough chance an unrevealed, eligible corridor hides a trap, from public facts only. */
function unknownTrapOdds(s: GameState, ownNomination: number | null, node: number): number {
  if (!TRAP_ELIGIBLE.includes(node)) return 0;
  if (s.traps.some((t) => t.node === node)) return 0; // revealed: handled as a known Reaper
  if (node === ownNomination) return 1;
  const hidden = TRAP_COUNT - s.traps.length - (ownNomination !== null && !s.traps.some((t) => t.node === ownNomination) ? 1 : 0);
  const candidates = TRAP_ELIGIBLE.filter((n) => !s.traps.some((t) => t.node === n) && n !== ownNomination).length;
  return candidates > 0 ? Math.max(0, hidden) / candidates : 0;
}

function evaluateLiving(view: SeatView, pv: MovePreview, profile: BotProfile, mem: BotMemory): number {
  const s = view.state;
  const me = s.players[view.seat];
  const w = WEIGHTS[profile.personality];
  const roundsLeft = ROUNDS - s.round;
  let v = 0;
  const gain = pv.harvest + pv.pile;
  v += gain * w.gain;
  // Banking is worth more as midnight nears, and the survival bonus rewards a real bank.
  if (pv.bank > 0) {
    v += pv.bank * w.bank * (1 + (roundsLeft < 3 ? 0.8 : 0));
    if (me.banked < SCORING.survivalBonusMinBanked && me.banked + pv.bank >= SCORING.survivalBonusMinBanked) v += SCORING.survivalBonus * w.bank;
  }
  if (pv.dest === 'stay' && me.node === ENTRANCE) v -= 0.5; // camping earns nothing
  // Carrying far from home late is risky.
  const destNode = pv.dest === 'stay' ? me.node : pv.dest;
  v -= (pv.carriedAfter * homeDist[destNode] * (roundsLeft < 2 ? 0.25 : 0.06)) * w.risk;
  // Known encounters.
  const deathCost = 6 + pv.carriedAfter + (me.banked >= SCORING.survivalBonusMinBanked ? SCORING.survivalBonus : 0);
  const enc = pv.encounter;
  if (enc.kind === 'reaper') v -= 0.45 * deathCost * w.risk;
  if (enc.kind === 'duel') {
    const foe = Math.max(...enc.opponents.map((o) => s.players[o].carried));
    v -= (enc.lethal ? 0.5 : 0.3) * deathCost * w.risk;
    v += (enc.lethal ? 0.5 : 0.3) * foe * w.mischief;
  }
  if (enc.kind === 'superReaper') {
    const foes = enc.opponents.map((o) => scoreOf(s.players[o]).total);
    v -= 0.5 * deathCost * w.risk;
    if (foes.length) v += 0.5 * Math.max(...foes) * 0.4 * w.mischief;
  }
  // Hidden traps: a generic risk on unrevealed corridor spaces.
  if (pv.dest !== 'stay' && pv.dest !== ENTRANCE) v -= unknownTrapOdds(s, view.ownNomination, pv.dest) * 0.4 * deathCost * w.unknown;
  // The resident ghost's forecast.
  const g = pv.ghost;
  if (g?.encounter) {
    if (g.encounter.player === view.seat) v -= 0.4 * deathCost * w.risk;
    else v += 0.3 * s.players[g.encounter.player].carried * w.mischief;
  }
  return v + rand(mem) * 0.3; // a little noise so bots are not clockwork
}

/** Choose the next action for `view.seat`, or null if it has nothing to do right now. */
export function botAction(view: SeatView, profile: BotProfile, mem: BotMemory): Action | null {
  const s = view.state;
  const seat = view.seat;
  if (s.phase === 'placement') {
    if (s.nominations[seat] !== null) return null;
    return { type: 'nominate', seat, node: TRAP_ELIGIBLE[Math.floor(rand(mem) * TRAP_ELIGIBLE.length)] };
  }
  if (s.turn !== seat || s.phase === 'gameOver' || s.phase === 'challenge') return null;
  const me = s.players[seat];
  const w = WEIGHTS[profile.personality];

  switch (s.phase) {
    case 'turnStart': {
      if (canPlaceDecoy(s)) {
        const threat = ghostDistance(s.ghost, me.node) <= 7 && me.carried >= (profile.personality === 'cautious' ? 3 : 5);
        if (threat && !isProtected(s, seat)) return { type: 'placeDecoy' };
      }
      return { type: 'roll' };
    }
    case 'choose': {
      const key = `${s.turnNumber}:${s.dice!.join(',')}`;
      if (mem.plan?.key !== key) mem.plan = { key, ...(me.alive ? planLiving(view, profile, mem) : planGhostMove(view, profile, mem)) };
      const plan = mem.plan;
      if (me.alive && s.selection.moveDie !== plan.md) return { type: 'select', moveDie: plan.md, dest: plan.dest };
      if (s.selection.dest !== plan.dest) return { type: 'select', dest: plan.dest };
      return { type: 'confirmMove' };
    }
    case 'pick': {
      const pk = s.pick!;
      const byCarried = pk.options.slice().sort((a, b) => s.players[b].carried - s.players[a].carried || scoreOf(s.players[b]).total - scoreOf(s.players[a]).total);
      return { type: 'pickOpponent', option: byCarried[0] };
    }
    case 'event': {
      const ev = s.event!;
      if (ev.type === 'secretPassage') {
        const best = ev.options.slice().sort((a, b) => homeDist[a] - homeDist[b])[0];
        if (me.carried >= 3 && homeDist[best] < homeDist[me.node]) return { type: 'eventChoose', option: best };
        return ev.canDecline ? { type: 'eventDecline' } : { type: 'eventChoose', option: ev.options[0] };
      }
      if (ev.type === 'stickyFingers') {
        const victim = ev.options.slice().sort((a, b) => s.players[b].carried - s.players[a].carried)[0];
        return { type: 'eventChoose', option: victim };
      }
      if (ev.type === 'costumeMixup') {
        const closer = ev.options.filter((o) => homeDist[s.players[o].node] + 1 < homeDist[me.node]);
        if (closer.length && (me.carried >= 3 || rand(mem) < w.mischief * 0.4)) return { type: 'eventChoose', option: closer[0] };
        return { type: 'eventDecline' };
      }
      return ev.canDecline ? { type: 'eventDecline' } : { type: 'eventChoose', option: ev.options[0] };
    }
    case 'ghost':
      return { type: 'moveGhost' };
    case 'summary':
      return { type: 'nextTurn' };
    default:
      return null;
  }
}

function planLiving(view: SeatView, profile: BotProfile, mem: BotMemory): { md: 0 | 1; dest: number | 'stay' } {
  const s = view.state;
  const dice = s.dice!;
  let best: { md: 0 | 1; dest: number | 'stay'; v: number } | null = null;
  for (const md of (dice[0] === dice[1] ? [0] : [0, 1]) as Array<0 | 1>) {
    for (const dest of [...legalRoutes(s, md).keys(), 'stay' as const]) {
      const pv = previewMove(s, md, dest);
      if (!pv) continue;
      const v = evaluateLiving(view, pv, profile, mem);
      if (!best || v > best.v) best = { md, dest, v };
    }
  }
  return best ? { md: best.md, dest: best.dest } : { md: 0, dest: 'stay' };
}

function planGhostMove(view: SeatView, profile: BotProfile, mem: BotMemory): { md: 0 | 1; dest: number | 'stay' } {
  const s = view.state;
  const me = s.players[view.seat];
  const routes = [...legalRoutes(s).values()];
  const living = s.players.map((_, i) => i).filter((i) => i !== view.seat && isExposed(s, i));
  let bestDest: number | 'stay' = 'stay';
  let bestV = -Infinity;
  for (const r of routes) {
    const here = living.filter((i) => s.players[i].node === r.dest);
    let v = 0;
    if (here.length) v = 10 + Math.max(...here.map((i) => s.players[i].carried)) + (me.bounty < SCORING.bountyCap ? 4 : 0);
    else if (living.length) {
      // Head for the richest reachable prey.
      const dist = bfs(r.dest, { blocked: (n) => n === ENTRANCE }).dist;
      v = Math.max(...living.map((i) => (s.players[i].carried + 1) / (1 + dist[s.players[i].node])));
    }
    v += rand(mem) * (profile.personality === 'mischievous' ? 0.6 : 0.3);
    if (v > bestV) {
      bestV = v;
      bestDest = r.dest;
    }
  }
  return { md: 0, dest: bestDest };
}

export function defaultBotProfile(i: number): BotProfile {
  const personalities: Personality[] = ['greedy', 'cautious', 'mischievous'];
  const skills: SkillLevel[] = ['steady', 'shaky', 'sharp'];
  return { personality: personalities[i % 3], skill: skills[(i + 1) % 3] };
}
