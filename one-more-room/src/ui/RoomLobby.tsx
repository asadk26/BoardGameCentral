import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CHARACTERS, MAX_PIECES, MIN_PIECES, type CharacterId } from '../engine/config';
import { hostSend, leaveRoom } from '../net/host';
import { useStore } from '../store';
import { PlayerBadge } from './Dialog';
import type { Personality } from '../engine/bots';

export function RoomLobby() {
  const room = useStore((s) => s.room);
  const [qr, setQr] = useState<string | null>(null);
  const [botChar, setBotChar] = useState<CharacterId | ''>('');
  const [pers, setPers] = useState<Personality>('greedy');
  useEffect(() => {
    if (!room?.joinUrl) return setQr(null);
    QRCode.toDataURL(room.joinUrl, { margin: 1, width: 320, color: { dark: '#150d24', light: '#fff6e0' } }).then(setQr, () => setQr(null));
  }, [room?.joinUrl]);
  if (!room) return null;
  const view = room.view;
  const pieces = view?.pieces ?? [];
  const mode = view?.mode ?? 'ffa';
  const free = CHARACTERS.filter((c) => !pieces.some((s) => s.character === c.id));
  const people = pieces.reduce((a, p) => a + p.members.length, 0);
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
                <p className="muted">Scan with a phone on the same Wi-Fi, or open the address and type the code. Pick a costume on your phone.</p>
                <p className="room-code" aria-label="Room code">
                  {room.code}
                </p>
                {room.joinUrl && <p className="join-url">{room.joinUrl}</p>}
                {room.status !== 'open' && <p className="notice">Connection: {room.status}</p>}
              </div>
            </div>
            <div className="seat-kind" role="radiogroup" aria-label="Mode">
              <button role="radio" aria-checked={mode === 'ffa'} className={`chip ${mode === 'ffa' ? 'on' : ''}`} onClick={() => hostSend({ t: 'setMode', mode: 'ffa' })}>
                Free-for-all
              </button>
              <button role="radio" aria-checked={mode === 'teams'} className={`chip ${mode === 'teams' ? 'on' : ''}`} onClick={() => hostSend({ t: 'setMode', mode: 'teams' })}>
                Team Battle
              </button>
              <span className="muted small">
                {mode === 'ffa' ? 'One phone per piece.' : 'Up to two phones share a piece (join a team on the phone). First person: odd rounds; second: even rounds.'}
              </span>
            </div>
            <ol className="setup-players">
              {pieces.map((s) => (
                <li key={s.piece}>
                  <PlayerBadge n={s.piece + 1} color={CHARACTERS.find((c) => c.id === s.character)!.color} />
                  <span>
                    <b>{s.name}</b> — {CHARACTERS.find((c) => c.id === s.character)!.name}{' '}
                    {s.kind === 'bot' ? `🤖 ${s.bot?.personality}` : s.members.map((m) => `${m.name} ${m.connected ? '📱' : '📱 offline'}`).join(' · ')}
                  </span>
                  <button className="btn tool" onClick={() => hostSend({ t: 'removePiece', piece: s.piece })}>
                    Remove
                  </button>
                </li>
              ))}
            </ol>
            {(view?.spectators.length ?? 0) > 0 && <p className="muted small">Joined but not in a piece yet: {view!.spectators.map((m) => m.name).join(', ')}</p>}
            {pieces.length < MAX_PIECES && free.length > 0 && (
              <div className="row-btns">
                <select aria-label="Bot costume" value={botChar} onChange={(e) => setBotChar(e.target.value as CharacterId)}>
                  <option value="">Bot costume…</option>
                  {free.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select aria-label="Bot personality" value={pers} onChange={(e) => setPers(e.target.value as Personality)}>
                  <option value="greedy">greedy</option>
                  <option value="cautious">cautious</option>
                  <option value="mischievous">mischievous</option>
                </select>
                <button className="btn" disabled={!botChar} onClick={() => botChar && hostSend({ t: 'addBot', character: botChar, bot: { personality: pers, skill: 'steady' } })}>
                  Add bot
                </button>
              </div>
            )}
            {room.error && <p className="notice">{room.error}</p>}
            <button className="btn primary big" disabled={pieces.length < MIN_PIECES} onClick={() => hostSend({ t: 'start' })}>
              {pieces.length < MIN_PIECES ? `Waiting for ${MIN_PIECES - pieces.length} more piece${MIN_PIECES - pieces.length === 1 ? '' : 's'}` : `Start: ${pieces.length} pieces, ${people} ${people === 1 ? 'phone' : 'phones'}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
