// Plays back what the engine has already decided. The director never changes
// game state: by the time it runs, the outcome is committed and saved, so
// skipping (or reloading mid-animation) simply shows the final positions.

import { SUPER_REAPER } from './engine/config';
import type { GameState, LogEntry } from './engine/types';
import { nodePos, playerSlot, type V3 } from './scene/layout';
import { ITEM_INFO } from './text';

export type Actor = number;

interface Segment {
  actor: Actor;
  t0: number;
  t1: number;
  kind: 'walk' | 'arc' | 'fright' | 'glide';
  points: V3[];
}

export interface Popup {
  id: number;
  t0: number;
  pos: V3;
  text: string;
  color: string;
}

export interface Cue {
  t: number;
  sound: string;
  fired?: boolean;
}

export interface Pose {
  pos: V3;
  moving: boolean;
  fright: boolean;
  heading: number | null;
}

type Listener = () => void;

const now = () => performance.now() / 1000;

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const GHOST_HOVER = 0.55;

class Director {
  private segs: Segment[] = [];
  private cues: Cue[] = [];
  popups: Popup[] = [];
  private popupId = 1;
  private end = 0;
  private timer: number | null = null;
  private listeners = new Set<Listener>();
  /** Last rendered position of each actor, written by the scene each frame. */
  rendered = new Map<Actor, V3>();
  speed = 1;
  onCue: (sound: string) => void = () => {};
  busy = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setBusy(v: boolean) {
    if (this.busy !== v) {
      this.busy = v;
      this.emit();
    }
  }

  private start(actor: Actor, fallback: V3): V3 {
    return this.rendered.get(actor) ?? fallback;
  }

  popup(pos: V3, text: string, color: string, delay = 0) {
    this.popups.push({ id: this.popupId++, t0: now() + delay, pos, text, color });
    if (this.popups.length > 24) this.popups.splice(0, this.popups.length - 24);
  }

  play(events: LogEntry[], before: GameState, after: GameState) {
    const step = 0.34 / this.speed; // one space at a time, slow enough to count along
    let t = Math.max(now(), this.end);
    const cue = (sound: string, at: number) => this.cues.push({ t: at, sound });
    const above = (piece: number, h = 1.5): V3 => {
      const p = playerSlot(after, piece);
      return [p[0], p[1] + h, p[2]];
    };
    const arc = (piece: number, dur: number) => {
      const from = this.start(piece, playerSlot(before, piece));
      this.segs.push({ actor: piece, t0: t, t1: t + dur, kind: 'arc', points: [from, playerSlot(after, piece)] });
    };

    for (const e of events) {
      switch (e.kind) {
        case 'lifeRoll':
          cue('dice', t);
          t += (0.6 + 0.4 * e.rolls.length) / this.speed;
          break;
        case 'spawn':
          arc(e.piece, 0.7 / this.speed);
          if (e.alive) {
            this.popup(above(e.piece, 1.8), `${after.pieces[e.piece].name} holds the life!`, '#ffd36b', t - now() + 0.4);
            cue('transform', t + 0.4);
          }
          break;
        case 'roundStart':
          t += 0.2 / this.speed;
          break;
        case 'roll':
          cue('dice', t);
          t += 0.75 / this.speed;
          break;
        case 'move': {
          const ghost = !before.pieces[e.piece].alive;
          const pts = e.path.map((n) => nodePos(n, ghost ? GHOST_HOVER * 0.5 : undefined));
          pts[0] = this.start(e.piece, playerSlot(before, e.piece));
          pts[pts.length - 1] = playerSlot({ ...after, pieces: after.pieces.map((p, i) => (i === e.piece ? { ...p, node: e.path[e.path.length - 1] } : p)) }, e.piece);
          const dur = (ghost ? step * 1.1 : step) * (pts.length - 1);
          this.segs.push({ actor: e.piece, t0: t, t1: t + dur, kind: ghost ? 'glide' : 'walk', points: pts });
          for (let i = 1; i < pts.length; i++) cue(ghost ? 'ghost' : 'step', t + (dur / (pts.length - 1)) * i - 0.05);
          if (e.usesWall) this.popup(nodePos(e.path[e.path.length - 1], 1.4), 'Through the wall!', '#7ff5e6', t + dur - now());
          t += dur;
          break;
        }
        case 'trapRevealed': {
          const label = e.effect === 'reaper' ? 'A Reaper rises!' : e.effect === 'seance' ? 'Séance!' : 'Poltergeist!';
          cue(e.effect === 'poltergeist' ? 'whoosh' : 'reaper', t);
          this.popup(nodePos(e.node, 1.9), label, e.effect === 'reaper' ? '#d6a6ff' : e.effect === 'seance' ? '#ff9fb4' : '#a9dcff', t - now());
          t += 0.9 / this.speed;
          break;
        }
        case 'seanceDormant':
          this.popup(nodePos(e.node, 1.6), 'The candles are cold — no Séances left', '#c9bdd6', t - now());
          t += 0.6 / this.speed;
          break;
        case 'superReaper':
          cue('reaper', t);
          this.popup(nodePos(SUPER_REAPER, 2.0), e.effect === 'seance' ? 'Super Reaper: Séance!' : 'Super Reaper: Reaper’s Challenge!', '#ff7b98', t - now());
          t += 0.9 / this.speed;
          break;
        case 'poltergeist':
          cue('whoosh', t);
          arc(e.piece, 0.9 / this.speed);
          t += 0.9 / this.speed;
          break;
        case 'challenge': {
          const c = e.challenge;
          if (c.host === 'contact') {
            cue('catch', t);
            const def = c.livingAtStart;
            const from = this.start(def, playerSlot(before, def));
            this.segs.push({ actor: def, t0: t, t1: t + 0.6, kind: 'fright', points: [from, from] });
            this.popup(nodePos(c.node, 1.7), 'Challenge!', '#ff8a9a', t - now());
            t += 0.6;
          } else if (c.host === 'ghostBattle' || c.host === 'versus') {
            cue('catch', t);
            const other = c.participants.find((p) => p !== c.instigator)!;
            this.popup(nodePos(c.node, 1.8), c.host === 'versus' ? 'Versus! Ghost battle' : 'Ghost battle!', '#7ff5e6', t - now());
            if (c.host === 'versus') this.popup(above(other, 1.8), 'Called to battle!', '#7ff5e6', t - now() + 0.2);
            t += 0.5;
          } else if (c.kind === 'seance') {
            this.popup(nodePos(c.node, 2.2), 'Everyone to the Séance!', '#ff9fb4', t - now());
            t += 0.4;
          }
          break;
        }
        case 'outcome': {
          const o = e.outcome;
          for (const m of o.moves) {
            const from = this.start(m.piece, playerSlot(before, m.piece));
            this.segs.push({ actor: m.piece, t0: t, t1: t + 0.8 / this.speed, kind: m.reason === 'claim' ? 'glide' : 'arc', points: [from, playerSlot(after, m.piece)] });
          }
          if (o.reward) this.popup(above(o.winner, 1.9), 'Wins an item!', '#7ff5e6', t - now());
          else if (!o.transferred) this.popup(above(o.winner, 1.9), 'Defended!', '#b8ffb0', t - now());
          t += 0.8 / this.speed;
          break;
        }
        case 'lifeTransfer':
          cue('transform', t);
          this.popup(above(e.to, 2.0), `${after.pieces[e.to].name} steals the life!`, '#ffd36b', t - now());
          t += 0.9 / this.speed;
          break;
        case 'itemAwarded':
          if (!e.duplicate) {
            cue('transform', t);
            this.popup(above(e.piece, 2.2), `${ITEM_INFO[e.kept].icon} ${ITEM_INFO[e.kept].name}`, '#ffe08a', t - now());
            t += 0.6 / this.speed;
          }
          break;
        case 'itemUsed':
          if (e.item === 'ghostSwitch' && e.detail?.target !== undefined) {
            cue('whoosh', t);
            arc(e.piece, 0.8 / this.speed);
            arc(e.detail.target, 0.8 / this.speed);
            this.popup(above(e.piece, 1.9), '🔄 Ghost Switch!', '#7ff5e6', t - now());
            t += 0.8 / this.speed;
          } else if (e.item === 'secondRoll') {
            this.popup(above(e.piece, 1.9), `🎲 Second Roll: ${e.detail?.oldDie} → ${e.detail?.newDie}`, '#ffe08a', t - now());
          } else {
            this.popup(above(e.piece, 1.9), '👣 Ghostly Stride • 6 spaces', '#d6a6ff', t - now());
            t += 0.4 / this.speed;
          }
          break;
        case 'versusInactive':
          this.popup(
            nodePos(e.node, 1.6),
            e.reason === 'noGhosts' ? 'Versus: no other ghost to battle' : 'Versus: every ghost already battled',
            '#c9bdd6',
            t - now(),
          );
          break;
        case 'huntDeclined':
          this.popup(above(e.piece, 1.6), 'Lets it pass', '#7ff5e6', t - now());
          break;
        case 'roundEnd':
          cue('bell', t);
          this.popup(above(e.piece, 2.1), `+1 point · round ${e.round}`, '#ffe08a', t - now());
          t += 1.1 / this.speed;
          break;
        case 'gameOver':
          cue('fanfare', t);
          break;
        default:
          break;
      }
    }
    this.end = t;
    if (this.segs.length || this.end > now() + 0.05) {
      this.setBusy(true);
      // Don't rely on frames to unlock the controls: a slow device may render rarely.
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.tick();
      }, Math.max(0, (this.end - now()) * 1000) + 30);
    }
  }

  /** Complete every running animation instantly. */
  skip() {
    this.segs = [];
    this.cues = [];
    this.end = now();
    this.popups = this.popups.filter((p) => p.t0 <= now());
    this.setBusy(false);
  }

  reset() {
    this.skip();
    this.popups = [];
    this.rendered.clear();
  }

  /** Called once per frame by the scene. */
  tick() {
    const t = now();
    for (const c of this.cues) {
      if (!c.fired && c.t <= t) {
        c.fired = true;
        this.onCue(c.sound);
      }
    }
    this.cues = this.cues.filter((c) => !c.fired);
    this.popups = this.popups.filter((p) => t - p.t0 < 1.8);
    if (this.busy && t >= this.end) {
      this.segs = [];
      this.setBusy(false);
    }
  }

  /** The animated pose of an actor, or null when it should rest at its logical spot. */
  pose(actor: Actor): Pose | null {
    const t = now();
    const mine = this.segs.filter((s) => s.actor === actor);
    if (!mine.length) return null;
    const active = mine.find((s) => t >= s.t0 && t < s.t1);
    if (!active) {
      const upcoming = mine.filter((s) => s.t0 > t).sort((a, b) => a.t0 - b.t0)[0];
      if (upcoming) return { pos: upcoming.points[0], moving: false, fright: false, heading: null };
      const last = mine.sort((a, b) => b.t1 - a.t1)[0];
      return { pos: last.points[last.points.length - 1], moving: false, fright: false, heading: null };
    }
    const u = (t - active.t0) / (active.t1 - active.t0);
    if (active.kind === 'fright') {
      const p = active.points[0];
      return { pos: [p[0] + Math.sin(t * 60) * 0.04, p[1] + Math.abs(Math.sin(u * Math.PI)) * 0.35, p[2]], moving: false, fright: true, heading: null };
    }
    if (active.kind === 'arc') {
      const [a, b] = active.points;
      const p = lerp3(a, b, u);
      const lift = Math.sin(u * Math.PI) * Math.min(3, 0.8 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.25);
      return { pos: [p[0], p[1] + lift, p[2]], moving: true, fright: true, heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
    }
    const n = active.points.length - 1;
    const f = Math.min(n - 1e-6, u * n);
    const i = Math.floor(f);
    const local = f - i;
    const a = active.points[i];
    const b = active.points[i + 1];
    const p = lerp3(a, b, active.kind === 'glide' ? local : easeInOut(local));
    const hop = active.kind === 'walk' ? Math.sin(local * Math.PI) * 0.22 : Math.sin(t * 4) * 0.05;
    return { pos: [p[0], p[1] + hop, p[2]], moving: true, fright: false, heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
  }
}

function easeInOut(x: number) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export const director = new Director();
