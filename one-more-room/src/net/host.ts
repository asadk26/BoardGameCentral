// TV side of a phone room. The TV never runs the engine here: it mirrors the
// public view the room service sends and plays its animations.

import { applyRemote, getState, setState, setTransport } from '../store';
import { director } from '../director';
import { findService, joinUrl, RoomClient } from './client';
import type { ClientMsg, RoomView, ServerMsg } from './protocol';
import type { SeatSetup } from '../engine/save';

let client: RoomClient | null = null;
const HOST_KEY = 'one-more-room/host';

export function roomClient() {
  return client;
}

export function hostSend(msg: ClientMsg) {
  client?.send(msg);
}

function seatsOf(view: RoomView): SeatSetup[] {
  return view.pieces.map((s) => (s.kind === 'bot' ? { kind: 'bot', bot: s.bot } : { kind: 'human' }));
}

export async function hostRoom() {
  setState({ screen: 'roomLobby', room: { code: null, joinUrl: null, problem: null, status: 'Looking for the room service…', view: null, error: null } });
  const info = await findService();
  if (!info) {
    setState((s) => ({
      room: {
        ...(s.room ?? { code: null, joinUrl: null, view: null, error: null, problem: null }),
        status: 'none',
        problem:
          'This copy of the game has no room service, so phones cannot join from here. Run the room service on this computer (npm run room — see the README) and open the address it prints. One-screen play with mouse, keyboard and bots works without it.',
      },
    }));
    return;
  }
  client?.close();
  const cl = new RoomClient(info.wsUrl);
  client = cl;
  let saved: { code: string; hostToken: string } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(HOST_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  cl.onOpen = () => cl.send(saved ? { t: 'hostJoin', code: saved.code, hostToken: saved.hostToken } : { t: 'create' });
  cl.onStatus = (st) => setState((s) => (s.room ? { room: { ...s.room, status: st } } : {}));
  cl.on((m: ServerMsg) => {
    const room = getState().room;
    if (m.t === 'created') {
      saved = { code: m.code, hostToken: m.hostToken };
      try {
        sessionStorage.setItem(HOST_KEY, JSON.stringify(saved));
      } catch {
        /* ignore */
      }
      setState({ room: { ...(room ?? { view: null, error: null, status: 'open' }), code: m.code, joinUrl: info.joinBase ? joinUrl(info.joinBase, m.code) : null, problem: info.problem, status: 'open', view: room?.view ?? null, error: null } });
    }
    if (m.t === 'error') {
      if (saved && /not your room|No such room/.test(m.reason)) {
        // The old room is gone: make a fresh one.
        saved = null;
        try {
          sessionStorage.removeItem(HOST_KEY);
        } catch {
          /* ignore */
        }
        cl.send({ t: 'create' });
        return;
      }
      setState((s) => (s.room ? { room: { ...s.room, error: m.reason } } : {}));
    }
    if (m.t === 'rejected') setState((s) => (s.room ? { room: { ...s.room, error: m.reason } } : {}));
    if (m.t === 'view') {
      const v = m.view;
      setState((s) => ({ room: s.room ? { ...s.room, view: v } : s.room, seats: seatsOf(v) }));
      if (v.game) {
        if (getState().screen !== 'game' || getState().mode !== 'room') {
          director.reset();
          setState({ screen: 'game', mode: 'room', modal: null, tipDismissed: false });
        }
        applyRemote(v.game, m.events);
      } else if (getState().screen === 'game') setState({ screen: 'roomLobby', session: null });
    }
  });
  setTransport({ send: () => {} });
}

export function leaveRoom() {
  client?.close();
  client = null;
  try {
    sessionStorage.removeItem(HOST_KEY);
  } catch {
    /* ignore */
  }
  setTransport(null);
  setState({ room: null, mode: 'local', screen: 'title', session: null });
}
