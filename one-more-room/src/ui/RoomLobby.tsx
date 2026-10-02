import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CHARACTERS, MAX_PIECES, MIN_PIECES } from '../engine/config';
import { hostSend, leaveRoom } from '../net/host';
import { useStore } from '../store';
import { PlayerBadge } from './Dialog';

const charOf = (id: string) => CHARACTERS.find((c) => c.id === id)!;

/**
 * The TV lobby. Four pieces are always shown: bots hold every seat until a
 * phone claims it, so two people get a full four-piece game without touching
 * a setting. Fewer pieces is an explicit Advanced choice.
 */
export function RoomLobby() {
  const room = useStore((s) => s.room);
  const [qr, setQr] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!room?.joinUrl) return setQr(null);
    QRCode.toDataURL(room.joinUrl, { margin: 1, width: 320, color: { dark: '#150d24', light: '#fff6e0' } }).then(setQr, () => setQr(null));
  }, [room?.joinUrl]);
  if (!room) return null;
  const view = room.view;
  const pieces = view?.pieces ?? [];
  const mode = view?.mode ?? 'ffa';
  const people = pieces.reduce((a, p) => a + p.members.length, 0);
  const bots = pieces.filter((p) => p.kind === 'bot').length;
  const humans = pieces.length - bots;
  return (
    <div className="setup-screen room-lobby">
      <div className="setup-card">
        <div className="setup-head">
          <h2>Phone room</h2>
          <button className="btn ghost" onClick={leaveRoom}>
            Leave
          </button>
        </div>
        {room.status === 'none' || room.problem ? (
          <p className="notice">{room.problem}</p>
        ) : !room.code ? (
          <p>{room.status === 'reconnecting' ? 'Reconnecting to the room service…' : room.status}</p>
        ) : (
          <>
            <div className="room-join">
              {qr && room.joinUrl ? <img src={qr} alt={`QR code to join room ${room.code}`} className="qr" /> : null}
              <div>
                <p className="muted">Scan to join (same Wi-Fi)</p>
                <p className="room-code" aria-label="Room code">
                  {room.code}
                </p>
                {room.joinUrl && <p className="join-url">{room.joinUrl}</p>}
                {room.status !== 'open' && <p className="notice">Connection: {room.status}</p>}
              </div>
            </div>
            <ol className="setup-players lineup" aria-label="Pieces">
              {pieces.map((s) => (
                <li key={s.piece} className={s.kind === 'bot' ? 'is-bot' : 'is-human'}>
                  <PlayerBadge n={s.piece + 1} color={charOf(s.character).color} />
                  <span className="lineup-name">
                    <b>{s.kind === 'bot' ? charOf(s.character).name : s.name}</b>
                    {s.kind !== 'bot' && <small> {charOf(s.character).name}</small>}
                    {s.kind !== 'bot' && s.members.some((m) => !m.connected) && <small className="notice"> offline</small>}
                  </span>
                  <span className={`tag ${s.kind === 'bot' ? 'bot' : 'human'}`}>{s.kind === 'bot' ? 'BOT' : s.members.length > 1 ? 'HUMAN ×2' : 'HUMAN'}</span>
                </li>
              ))}
            </ol>
            <p className="muted small">{bots ? 'Bots fill free seats. Join on a phone to take one.' : 'Every piece has a person.'}</p>
            {(view?.spectators.length ?? 0) > 0 && <p className="muted small">Watching: {view!.spectators.map((m) => m.name).join(', ')}</p>}
            {room.error && <p className="notice">{room.error}</p>}
            <button className="btn primary big" disabled={pieces.length < MIN_PIECES} onClick={() => hostSend({ t: 'start' })}>
              Start · {humans} {humans === 1 ? 'human' : 'humans'} + {bots} {bots === 1 ? 'bot' : 'bots'}
            </button>
            <button type="button" className="link" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
              {advanced ? '▾' : '▸'} Advanced
            </button>
            {advanced && (
              <div className="advanced">
                <div className="seat-kind" role="radiogroup" aria-label="Mode">
                  <button role="radio" aria-checked={mode === 'ffa'} className={`chip ${mode === 'ffa' ? 'on' : ''}`} onClick={() => hostSend({ t: 'setMode', mode: 'ffa' })}>
                    One phone per piece
                  </button>
                  <button role="radio" aria-checked={mode === 'teams'} className={`chip ${mode === 'teams' ? 'on' : ''}`} onClick={() => hostSend({ t: 'setMode', mode: 'teams' })}>
                    Teams of two
                  </button>
                </div>
                <div className="stepper" role="group" aria-label="Number of pieces">
                  <button className="icon-btn" aria-label="Fewer pieces" disabled={pieces.length <= Math.max(MIN_PIECES, humans)} onClick={() => hostSend({ t: 'setPieceCount', count: pieces.length - 1 })}>
                    −
                  </button>
                  <span>{pieces.length} pieces</span>
                  <button className="icon-btn" aria-label="More pieces" disabled={pieces.length >= MAX_PIECES} onClick={() => hostSend({ t: 'setPieceCount', count: pieces.length + 1 })}>
                    +
                  </button>
                </div>
                {pieces.length < MAX_PIECES && <p className="muted small">Fewer than four pieces means fewer chases and quieter rounds. Four is the intended game.</p>}
                <p className="muted small">
                  {people} {people === 1 ? 'phone' : 'phones'} joined.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
