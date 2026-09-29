// Plays back what the engine has already decided. The director never changes
// game state: by the time it runs, the outcome is committed and saved, so
// skipping (or reloading mid-animation) simply shows the final positions.

import { ENTRANCE } from './engine/config';
import type { GameState, LogEntry } from './engine/types';
import { nodePos, playerSlot, type V3 } from './scene/layout';

export type Actor = number | 'ghost';

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
  private ghostUntil = 0;
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

  /** Is the camera meant to watch the ghost right now? */
  watchingGhost(): boolean {
    return now() < this.ghostUntil;
  }

  private start(actor: Actor, fallback: V3): V3 {
    return this.rendered.get(actor) ?? fallback;
  }

  popup(pos: V3, text: string, color: string, delay = 0) {
    this.popups.push({ id: this.popupId++, t0: now() + delay, pos, text, color });
    if (this.popups.length > 24) this.popups.splice(0, this.popups.length - 24);
  }

  play(events: LogEntry[], before: GameState, after: GameState) {
    const step = 0.26 / this.speed;
    let t = Math.max(now(), this.end);
    const cue = (sound: string, at: number) => this.cues.push({ t: at, sound });

    for (const e of events) {
      switch (e.kind) {
        case 'roll':
          cue('dice', t);
          t += 0.75 / this.speed;
          break;
        case 'decoy':
          cue('decoy', t);
          this.popup(nodePos(e.node, 1.1), 'Decoy placed', '#ff9ad5', t - now());
          break;
        case 'move': {
          const pts = e.path.map((n) => nodePos(n));
          pts[0] = this.start(e.player, playerSlot(before, e.player));
          pts[pts.length - 1] = playerSlot(after, e.player);
          const dur = step * (pts.length - 1);
          this.segs.push({ actor: e.player, t0: t, t1: t + dur, kind: 'walk', points: pts });
          for (let i = 1; i < pts.length; i++) cue('step', t + step * i - 0.05);
          t += dur;
          break;
        }
        case 'stay':
          break;
        case 'harvest':
          cue('candy', t);
          this.popup(nodePos(e.node, 1.2), e.amount > 0 ? `+${e.amount} candy` : 'Room is empty', '#ffd36b', t - now());
          break;
        case 'pile':
          cue('candy', t + 0.1);
          this.popup(nodePos(e.node, 1.5), `+${e.amount} dropped candy`, '#ffb36b', t - now() + 0.25);
          break;
        case 'bank':
          cue('bank', t);
          this.popup(nodePos(ENTRANCE, 1.4), e.amount > 0 ? `Banked ${e.amount}` : 'Safe', '#ffe08a', t - now());
          break;
        case 'card':
          cue('card', t);
          t += 0.3;
          break;
        case 'relocate':
        case 'swap': {
          const movers: number[] = e.kind === 'swap' ? [e.player, e.other] : [e.player];
          cue('whoosh', t);
          for (const pl of movers) {
            const from = this.start(pl, playerSlot(before, pl));
            const to = playerSlot(after, pl);
            this.segs.push({ actor: pl, t0: t, t1: t + 0.7 / this.speed, kind: 'arc', points: [from, to] });
          }
          t += 0.7 / this.speed;
          break;
        }
        case 'steal':
          cue('candy', t);
          this.popup(playerSlot(after, e.player).map((v, i) => (i === 1 ? v + 1.2 : v)) as V3, `Stole ${e.amount}`, '#ffd36b', t - now());
          break;
        case 'gain':
          cue('candy', t);
          this.popup(playerSlot(after, e.player).map((v, i) => (i === 1 ? v + 1.2 : v)) as V3, `+${e.amount} candy`, '#ffd36b', t - now());
          break;
        case 'drop':
          cue('drop', t);
          this.popup(nodePos(e.node, 1.2), `Dropped ${e.amount}`, '#ff8a6b', t - now());
          break;
        case 'ghostBonus':
          cue('creak', t);
          break;
        case 'ghost': {
          const plan = e.plan;
          const gstep = 0.34 / this.speed;
          const pts = plan.path.map((n) => nodePos(n, GHOST_HOVER));
          pts[0] = this.start('ghost', nodePos(before.ghost, GHOST_HOVER));
          const dur = gstep * (pts.length - 1);
          this.segs.push({ actor: 'ghost', t0: t, t1: t + dur, kind: 'glide', points: pts });
          cue('ghost', t);
          const caughtAt = new Map<number, number>();
          plan.catches.forEach((c) => caughtAt.set(c.player, plan.path.indexOf(c.node)));
          let latest = t + dur;
          for (const c of plan.catches) {
            const idx = caughtAt.get(c.player)!;
            const tc = t + gstep * idx;
            const from = this.start(c.player, playerSlot(before, c.player));
            this.segs.push({ actor: c.player, t0: tc - 0.05, t1: tc + 0.55, kind: 'fright', points: [from, from] });
            this.segs.push({ actor: c.player, t0: tc + 0.55, t1: tc + 1.35, kind: 'arc', points: [from, playerSlot(after, c.player)] });
            cue('catch', tc);
            cue('bank', tc + 1.35);
            this.popup(nodePos(c.node, 1.5), c.dropped > 0 ? `Caught! Dropped ${c.dropped}` : 'Caught!', '#7ff5e6', tc - now());
            latest = Math.max(latest, tc + 1.35);
          }
          t = latest;
          this.ghostUntil = t + 0.8;
          break;
        }
        case 'ghostWaits':
          this.popup(nodePos(before.ghost, 1.6), 'The ghost waits', '#7ff5e6', t - now());
          break;
        case 'midnight':
          cue('bell', t);
          break;
        case 'gameOver':
          cue('fanfare', t);
          break;
        default:
          break;
      }
    }
    this.end = t;
    if (this.segs.length || this.end > now() + 0.05) this.setBusy(true);
  }

  /** Complete every running animation instantly. */
  skip() {
    this.segs = [];
    this.cues = [];
    this.end = now();
    this.ghostUntil = 0;
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
