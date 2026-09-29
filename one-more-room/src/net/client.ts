// Browser side of the phone rooms: one WebSocket to the room service, clock
// offset estimation for synchronised challenges, and automatic reconnection
// with the seat token so a refreshed phone keeps its seat.

import type { ClientMsg, ServerMsg } from './protocol';
import { WS_PATH } from './protocol';

export interface ServiceInfo {
  /** WebSocket URL of the room service. */
  wsUrl: string;
  /** Page URL phones should open (never localhost). */
  joinBase: string | null;
  /** Why joinBase is null, for the host to read. */
  problem: string | null;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * Find the room service: a build-time VITE_ROOM_URL (a hosted service), or
 * the machine that served this page (the laptop running `npm run room`).
 * Returns null when there is none — e.g. on GitHub Pages without a service.
 */
export async function findService(): Promise<ServiceInfo | null> {
  const configured = (import.meta.env.VITE_ROOM_URL as string | undefined)?.trim();
  const here = new URL(location.href);
  here.hash = '';
  here.search = '';
  if (configured) {
    return { wsUrl: configured, joinBase: LOCAL.test(here.hostname) ? null : here.toString(), problem: LOCAL.test(here.hostname) ? 'Open the game from a network address, not localhost, so phones can reach it.' : null };
  }
  try {
    const res = await fetch(new URL('api/info', here).toString(), { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as { service?: string; lan?: string[]; port?: number; wsPath?: string };
    if (info.service !== 'one-more-room') return null;
    const wsUrl = `${here.protocol === 'https:' ? 'wss' : 'ws'}://${here.host}${info.wsPath ?? WS_PATH}`;
    if (!LOCAL.test(here.hostname)) return { wsUrl, joinBase: here.toString(), problem: null };
    const ip = info.lan?.[0];
    if (!ip) return { wsUrl, joinBase: null, problem: 'This computer has no network address phones can reach. Connect it to Wi-Fi.' };
    return { wsUrl, joinBase: `http://${ip}:${info.port ?? here.port}${here.pathname}`, problem: null };
  } catch {
    return null;
  }
}

export function joinUrl(base: string, code: string): string {
  return `${base}#/join?room=${encodeURIComponent(code)}`;
}

type Listener = (msg: ServerMsg) => void;

export class RoomClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMsg[] = [];
  private closed = false;
  private retry = 0;
  /** server time − local time, from the lowest-latency ping. */
  offset = 0;
  rtt = Infinity;
  status: 'connecting' | 'open' | 'reconnecting' | 'closed' = 'connecting';
  /** Called on every (re)connection to re-identify (create/hostJoin/join). */
  onOpen: (() => void) | null = null;
  onStatus: ((s: RoomClient['status']) => void) | null = null;

  constructor(private url: string) {
    this.connect();
  }

  private setStatus(s: RoomClient['status']) {
    this.status = s;
    this.onStatus?.(s);
  }

  private connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      this.onOpen?.();
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.calibrate();
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        const nowLocal = Date.now();
        const rtt = nowLocal - msg.c;
        if (rtt < this.rtt || !Number.isFinite(this.rtt)) {
          this.rtt = rtt;
          this.offset = msg.s - (msg.c + rtt / 2);
        }
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = () => {
      if (this.closed) return this.setStatus('closed');
      this.setStatus('reconnecting');
      const delay = Math.min(8000, 400 * 2 ** this.retry++);
      window.setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  /** A few pings; keep the fastest round trip's offset. */
  calibrate() {
    this.rtt = Infinity;
    for (let i = 0; i < 6; i++) window.setTimeout(() => this.send({ t: 'ping', c: Date.now() }), i * 150);
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping') this.queue.push(msg);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

let actionCounter = 0;
export function newActionId(): string {
  actionCounter += 1;
  return `${Date.now().toString(36)}-${actionCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** This phone's own reconnect token for a room (its own storage key only). */
export const tokenStore = {
  get(code: string): string | null {
    try {
      return localStorage.getItem(`one-more-room/room/${code}`);
    } catch {
      return null;
    }
  },
  set(code: string, token: string) {
    try {
      localStorage.setItem(`one-more-room/room/${code}`, token);
    } catch {
      /* private mode: rejoin needs the same tab */
    }
  },
};
