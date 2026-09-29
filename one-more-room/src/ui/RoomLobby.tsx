import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CHARACTERS, MAX_PLAYERS, MIN_PLAYERS, type CharacterId } from '../engine/config';
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
  const seats = view?.seats ?? [];
  const free = CHARACTERS.filter((c) => !seats.some((s) => s.character === c.id));
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
                <p className="muted">Scan with a phone, or open the address and type the code.</p>
                <p className="room-code" aria-label="Room code">
                  {room.code}
                </p>
                {room.joinUrl && <p className="join-url">{room.joinUrl}</p>}
                {room.status !== 'open' && <p className="notice">Connection: {room.status}</p>}
              </div>
            </div>
            <ol className="setup-players">
              {seats.map((s) => (
                <li key={s.seat}>
                  <PlayerBadge n={s.seat + 1} color={CHARACTERS.find((c) => c.id === s.character)!.color} />
                  <span>
                    <b>{s.name}</b> — {CHARACTERS.find((c) => c.id === s.character)!.name} {s.kind === 'bot' ? `🤖 ${s.bot?.personality}` : s.connected ? '📱' : '📱 offline'}
                  </span>
                  <button className="btn tool" onClick={() => hostSend({ t: 'removeSeat', seat: s.seat })}>
                    Remove
                  </button>
                </li>
              ))}
            </ol>
            {seats.length < MAX_PLAYERS && free.length > 0 && (
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
            <button className="btn primary big" disabled={seats.length < MIN_PLAYERS} onClick={() => hostSend({ t: 'start' })}>
              {seats.length < MIN_PLAYERS ? `Waiting for ${MIN_PLAYERS - seats.length} more` : `Start with ${seats.length} players`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
