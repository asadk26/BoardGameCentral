// Ordinary rule-based bots. They decide from a SeatView — the public state
// plus their own piece's trap nomination — never from the authority's full
// state or its RNG. Personality (what they value) is separate from reflex
// skill (how well they jump in Haunted Jump Rope).

import { curseMultiplier, ITEM_POWER, STRIDE_ALLOWANCE, SUPER_REAPER, TRAP_COUNT, TRAP_ELIGIBLE, type ItemId } from './config';
import { exactReach, inAttackRange, ordinaryDistance } from './graph';
import { actingPiece, itemBlock, knownEffectAt, livingPiece, moveExits, moveLandings, previewMove, switchTargets } from './engine';
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
  /** The landing chosen for the current move, so every fork heads the same way. */
  plan?: { key: string; dest: number };
}

export function newBotMemory(seed: number): BotMemory {
  return { rng: seed >>> 0 };
}

/**
 * cautious: the living piece runs far; ghosts chase directly.
 * greedy: ghosts go for known Reaper tiles and any duel they can reach.
 * mischievous: happy to trigger Séances and gamble on unknown corridors.
 */
const WEIGHTS: Record<Personality, { danger: number; unknown: number; remote: number; chaos: number; loot: number }> = {
  cautious: { danger: 1.4, unknown: 1.2, remote: 0.8, chaos: 0.2, loot: 0.5 },
  greedy: { danger: 1.0, unknown: 0.8, remote: 1.3, chaos: 0.5, loot: 0.9 },
  mischievous: { danger: 0.8, unknown: 0.5, remote: 1.0, chaos: 1.2, loot: 1.1 },
};

/** How much a ghost battle is worth to this bot right now (small next to a shot at the life). */
function lootValue(s: GameState, piece: number, w: (typeof WEIGHTS)[Personality]): number {
  return 0.5 * 0.3 * w.loot * (s.pieces[piece].item ? 0.3 : 1);
}

export function reflexOf(profile: BotProfile): ReflexSkill {
  return SKILLS[profile.skill];
}

function rand(mem: BotMemory): number {
  let v: number;
  [v, mem.rng] = nextFloat(mem.rng);
  return v;
}

// Where a ghost standing on `node` can end its move, for each possible roll (exactly that many steps).
const reachCache = new Map<number, Array<Set<number>>>();
function ghostReach(node: number): Array<Set<number>> {
  let r = reachCache.get(node);
  if (!r) {
    r = [1, 2, 3, 4, 5, 6].map((die) => new Set<number>(exactReach(node, die, true)));
    reachCache.set(node, r);
  }
  return r;
}

/** Chance (0–1) that a ghost on `ghostNode` can end its next move within ordinary range of `target`. */
export function threatChance(ghostNode: number, target: number): number {
  const reach = ghostReach(ghostNode);
  let hits = 0;
  for (const set of reach) {
    for (const n of set) {
      if (inAttackRange(n, target)) {
        hits++;
        break;
      }
    }
  }
  return hits / 6;
}

/** Chance an unrevealed, eligible corridor hides a trap, from public facts only. */
function unknownTrapOdds(s: GameState, ownNomination: number | null, node: number): number {
  if (!TRAP_ELIGIBLE.includes(node) || s.traps.some((t) => t.node === node)) return 0;
  if (node === ownNomination) return 1;
  const ownHidden = ownNomination !== null && !s.traps.some((t) => t.node === ownNomination) ? 1 : 0;
  const hidden = TRAP_COUNT - s.traps.length - ownHidden;
  const candidates = TRAP_ELIGIBLE.filter((n) => !s.traps.some((t) => t.node === n) && n !== ownNomination).length;
  return candidates > 0 ? Math.max(0, hidden) / candidates : 0;
}

/** A ghost's rough chance of winning a duel against the living piece. */
function duelOdds(s: GameState): number {
  const living = livingPiece(s);
  return Math.min(0.8, 0.5 + (1 - curseMultiplier(s.pieces[living].streak)) * 0.8);
}

/** Ghosts who still have an action this round after the current one. */
function huntersStillToAct(s: GameState, except: number): number[] {
  return s.schedule.slice(s.slot + 1).filter((i) => i !== except && !s.pieces[i].alive);
}

function evaluateLiving(view: SeatView, pv: MovePreview, profile: BotProfile, mem: BotMemory): number {
  const s = view.state;
  const me = s.pieces[view.piece];
  const w = WEIGHTS[profile.personality];
  const end = pv.dest;
  const n = s.pieces.length;
  const loseDuel = duelOdds(s);
  let risk = 0;
  // Everyone still to act this round can try to reach us.
  for (const g of huntersStillToAct(s, view.piece)) risk += threatChance(s.pieces[g].node, end) * loseDuel;
  // Next round's hunters too, a little.
  for (let g = 0; g < n; g++) if (g !== view.piece && !huntersStillToAct(s, view.piece).includes(g)) risk += 0.25 * threatChance(s.pieces[g].node, end) * loseDuel;
  let v = -risk * w.danger;
  if (pv.known === 'reaper') v -= loseDuel * 1.2;
  if (pv.known === 'seance') v -= ((n - 1) / n) * (1.2 - w.chaos * 0.3);
  const odds = unknownTrapOdds(s, view.ownNomination, end);
  // Two in six effects are Séances, two are Reaper duels; Poltergeists just move us.
  v -= odds * ((2 / 6) * ((n - 1) / n) + (2 / 6) * loseDuel) * w.unknown;
  if (end === me.node) v -= 0.02; // ending where we began rarely helps
  // Keep away from the old lair and dead ends where ghosts cluster.
  for (let g = 0; g < n; g++) if (g !== view.piece) v += Math.min(4, ordinaryDistance(s.pieces[g].node, end)) * 0.03;
  return v + rand(mem) * 0.05;
}

function evaluateGhost(view: SeatView, pv: MovePreview, profile: BotProfile, mem: BotMemory): number {
  const s = view.state;
  const w = WEIGHTS[profile.personality];
  const living = livingPiece(s);
  const end = pv.dest;
  const n = s.pieces.length;
  const win = duelOdds(s);
  let v = 0;
  if (pv.known === 'reaper') v = win * w.remote;
  else if (pv.known === 'seance') v = (1 / n) * (0.8 + w.chaos * 0.4);
  else if (pv.known === 'poltergeist') v = 0.05;
  else if (pv.canChallenge) v = win;
  else v = 0.15 / (1 + ordinaryDistance(end, s.pieces[living].node));
  // A ghost battle for an item: a side objective when the life is out of reach.
  if (!pv.canChallenge && !pv.known && (pv.battleTargets.length || pv.versus)) v = Math.max(v, lootValue(s, view.piece, w));
  // An unknown corridor might hide something; for a ghost that is mostly upside.
  if (!pv.canChallenge && !pv.known) v += unknownTrapOdds(s, view.ownNomination, end) * 0.2 * w.chaos;
  return v + rand(mem) * 0.04;
}

/** The landing this bot wants, among every space its exact move can end on. */
function planMove(view: SeatView, profile: BotProfile, mem: BotMemory): number {
  const s = view.state;
  const me = s.pieces[view.piece];
  let best: { dest: number; v: number } | null = null;
  for (const dest of moveLandings(s)) {
    const pv = previewMove(s, dest);
    if (!pv) continue;
    const v = me.alive ? evaluateLiving(view, pv, profile, mem) : evaluateGhost(view, pv, profile, mem);
    if (!best || v > best.v) best = { dest, v };
  }
  return best ? best.dest : me.node;
}

/** Choose the next action for `view.piece`, or null if it has nothing to do right now. */
export function botAction(view: SeatView, profile: BotProfile, mem: BotMemory): Action | null {
  const s = view.state;
  const me = view.piece;
  if (s.phase === 'placement') {
    if (s.nominations[me] !== null) return null;
    return { type: 'nominate', piece: me, node: TRAP_ELIGIBLE[Math.floor(rand(mem) * TRAP_ELIGIBLE.length)] };
  }
  // A battle winner may be deciding out of turn.
  if (s.phase === 'reward') {
    const pr = s.pendingReward;
    if (!pr || pr.piece !== me) return null;
    return { type: 'chooseReward', keep: ITEM_POWER.indexOf(pr.offered) > ITEM_POWER.indexOf(pr.current) ? 'offered' : 'current' };
  }
  if (actingPiece(s) !== me) return null;
  switch (s.phase) {
    case 'turnStart':
      return planItemBeforeRoll(view) ?? { type: 'roll' };
    case 'choose': {
      const reroll = planSecondRoll(view);
      if (reroll) return reroll;
      const m = s.move!;
      const key = `${s.actionNumber}:${s.allowance}:${s.rollInfo?.kind}:${s.itemUsed}`;
      if (mem.plan?.key !== key || !moveLandings(s).includes(mem.plan.dest)) mem.plan = { key, dest: planMove(view, profile, mem) };
      const exits = moveExits(s);
      const dest = mem.plan.dest;
      const way = exits.find((e) => moveLandings(s, e.to).includes(dest)) ?? exits[0];
      return { type: 'step', at: s.pieces[me].node, left: m.remaining, to: way.to };
    }
    case 'pick': {
      // Pick the ghost whose win would hurt least: the one with the fewest points.
      const opts = s.pick!.options.slice().sort((a, b) => s.pieces[a].score - s.pieces[b].score || a - b);
      return { type: 'pickOpponent', option: opts[0] };
    }
    case 'hunt': {
      const o = s.options!;
      if (o.living) return { type: 'hunt' };
      const foes = [...o.sameSpace, ...o.versus.filter((v) => !o.sameSpace.includes(v))];
      const w = WEIGHTS[profile.personality];
      const keen = (s.pieces[me].item ? 0.35 : 1) * Math.min(1, w.loot + 0.1);
      if (foes.length && rand(mem) < keen) {
        // Battle whoever's win would matter least: the lowest scorer.
        const foe = foes.slice().sort((a, b) => s.pieces[a].score - s.pieces[b].score || a - b)[0];
        return { type: 'battle', opponent: foe };
      }
      return { type: 'declineHunt' };
    }
    case 'summary':
      return { type: 'nextTurn' };
    default:
      return null;
  }
}

/** Before rolling: Ghostly Stride when six would reach the living piece but three might not; Ghost Switch to jump the queue. */
function planItemBeforeRoll(view: SeatView): Action | null {
  const s = view.state;
  const me = s.pieces[view.piece];
  const item: ItemId | null = me.item;
  if (!item || me.alive || item === 'secondRoll') return null;
  const living = s.pieces[livingPiece(s)];
  const reach = (from: number, steps: number) => exactReach(from, steps, true).some((d) => inAttackRange(d, living.node));
  if (threatChance(me.node, living.node) >= 0.5) return null; // a roll is already likely to reach
  if (item === 'ghostlyStride' && !itemBlock(s, 'ghostlyStride') && reach(me.node, STRIDE_ALLOWANCE)) return { type: 'useItem', item: 'ghostlyStride' };
  if (item === 'ghostSwitch' && !itemBlock(s, 'ghostSwitch', switchTargets(s)[0])) {
    const mine = ordinaryDistance(me.node, living.node);
    const best = switchTargets(s)
      .map((t) => ({ t, d: ordinaryDistance(s.pieces[t].node, living.node) }))
      .sort((a, b) => a.d - b.d || a.t - b.t)[0];
    if (best && best.d <= 3 && mine >= best.d + 3) return { type: 'useItem', item: 'ghostSwitch', target: best.t };
  }
  return null;
}

/** After a low roll that reaches nothing useful: spend Second Roll (the new result stands, even if worse). */
function planSecondRoll(view: SeatView): Action | null {
  const s = view.state;
  const me = s.pieces[view.piece];
  if (me.item !== 'secondRoll' || itemBlock(s, 'secondRoll') || s.die === null || s.die > 3) return null;
  const useful = moveLandings(s).some((d) => {
    const pv = previewMove(s, d);
    return !!pv && (pv.canChallenge || pv.known === 'reaper' || pv.superReaper !== null);
  });
  return useful ? null : { type: 'useItem', item: 'secondRoll' };
}

export function defaultBotProfile(i: number): BotProfile {
  const personalities: Personality[] = ['greedy', 'cautious', 'mischievous'];
  const skills: SkillLevel[] = ['steady', 'shaky', 'sharp'];
  return { personality: personalities[i % 3], skill: skills[(i + 1) % 3] };
}

// Exposed for balance tooling: whether the Super Reaper or a known tile is reachable.
export function reachableKnownTiles(s: GameState): number[] {
  return moveLandings(s).filter((d) => d === SUPER_REAPER || knownEffectAt(s, d) !== null);
}
