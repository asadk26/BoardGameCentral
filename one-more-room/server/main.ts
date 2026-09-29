// The One More Room phone-room service: one Node process that serves the
// built game (so phones on the same Wi-Fi can open it) and runs rooms over
// WebSockets. Every room owns its engine; clients only send intentions.
//
//   npm run build && npm run room        # http://<this computer's LAN IP>:8787
//
// Environment: PORT (default 8787), HOST (default 0.0.0.0),
// STATIC_DIR (default ./dist), ALLOWED_ORIGINS (comma list; default: any).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room } from '../src/net/room';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, WS_PATH, type ClientMsg, type ServerMsg } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? 'dist');
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 200;
const MAX_MSG_BYTES = 16 * 1024;

const rooms = new Map<string, Room>();
/** Which socket is the host / which participant, per room. */
const sockets = new Map<string, Map<string, WebSocket>>();

function secureRandom(): number {
  return randomBytes(4).readUInt32BE(0) / 0x100000000;
}

function newCode(): string {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('No free room codes');
}

function send(ws: WebSocket | undefined, msg: ServerMsg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function makeRoom(): Room {
  const code = newCode();
  const conns = new Map<string, WebSocket>();
  sockets.set(code, conns);
  const room = new Room(code, {
    send: (to, msg) => send(conns.get(to), msg),
    now: () => Date.now(),
    random: secureRandom,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
  });
  rooms.set(code, room);
  return room;
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ── static files and info ───────────────────────────────────────────────

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ service: 'one-more-room', rooms: rooms.size, lan: lanAddresses(), port: PORT, wsPath: WS_PATH }));
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('ok');
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_DIR, '.' + rel);
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': rel.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(await readFile(file));
  } catch {
    // Hash routing means every page is index.html; unknown files are 404.
    if (!path.extname(rel)) {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      res.end(await readFile(path.join(STATIC_DIR, 'index.html')));
    } else res.writeHead(404).end('Not found');
  }
}

const server = createServer((req, res) => {
  serveStatic(req, res).catch(() => res.writeHead(500).end());
});

// ── WebSockets ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const origin = req.headers.origin ?? '';
  if (url.pathname !== WS_PATH || (ALLOWED.length && !ALLOWED.includes(origin))) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let who: string | null = null; // 'host' or participant id
  // Token bucket: 30 messages per second, burst 60.
  let tokens = 60;
  let last = Date.now();

  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(60, tokens + ((now - last) / 1000) * 30);
    last = now;
    if (tokens < 1) {
      send(ws, { t: 'error', reason: 'Slow down' });
      return;
    }
    tokens -= 1;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(ws, { t: 'error', reason: 'Bad JSON' });
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return send(ws, { t: 'error', reason: 'Bad message' });

    if (msg.t === 'ping') return send(ws, { t: 'pong', c: Number(msg.c) || 0, s: Date.now() });

    if (msg.t === 'create') {
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', reason: 'The service is full; try again later.' });
      room = makeRoom();
      who = 'host';
      sockets.get(room.code)!.set('host', ws);
      send(ws, { t: 'created', code: room.code, hostToken: room.hostToken });
      room.hostConnect();
      return;
    }
    if (msg.t === 'hostJoin') {
      const r = rooms.get(String(msg.code).toUpperCase());
      if (!r || r.hostToken !== msg.hostToken) return send(ws, { t: 'error', reason: 'No such room, or not your room.' });
      room = r;
      who = 'host';
      sockets.get(r.code)!.set('host', ws);
      send(ws, { t: 'created', code: r.code, hostToken: r.hostToken });
      r.hostConnect();
      return;
    }
    if (msg.t === 'join') {
      const r = rooms.get(String(msg.code ?? '').toUpperCase());
      if (!r) return send(ws, { t: 'error', reason: 'No room with that code. Check the TV.' });
      const p = r.join(String(msg.name ?? ''), typeof msg.token === 'string' ? msg.token : undefined);
      room = r;
      who = p.id;
      sockets.get(r.code)!.set(p.id, ws);
      send(ws, { t: 'joined', participantId: p.id, token: p.token, code: r.code });
      r.broadcast();
      return;
    }
    if (!room || !who) return send(ws, { t: 'error', reason: 'Join a room first.' });
    room.handle(who, msg);
  });

  ws.on('close', () => {
    if (!room || !who) return;
    const conns = sockets.get(room.code);
    if (conns?.get(who) === ws) conns.delete(who);
    if (who === 'host') room.hostDisconnect();
    else room.disconnect(who);
  });
});

// Expire idle rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const conns = sockets.get(code);
    if (now - r.lastActivity > ROOM_IDLE_MS || (!conns?.size && now - r.lastActivity > 20 * 60 * 1000)) {
      r.dispose();
      for (const ws of conns?.values() ?? []) ws.close(1001, 'Room expired');
      rooms.delete(code);
      sockets.delete(code);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  const lan = lanAddresses();
  console.log(`One More Room service on http://${HOST}:${PORT} (static: ${STATIC_DIR})`);
  for (const ip of lan) console.log(`  phones on this network: http://${ip}:${PORT}/#/join`);
});
