// Curse the Mansion: each seat secretly nominates one corridor. On a shared
// screen this is pass-and-play behind a neutral curtain; nothing about
// anyone's pick is ever shown again after they hide it.

import { CHARACTERS, TRAP_ELIGIBLE } from '../engine/config';
import type { GameState } from '../engine/types';
import { act, isBotSeat, setState, useStore } from '../store';
import { PlayerBadge } from './Dialog';
import { MiniMap } from './MiniMap';

const ELIGIBLE = new Set(TRAP_ELIGIBLE);

export function PlacementScreen({ game }: { game: GameState }) {
  const placement = useStore((s) => s.placement);
  const mode = useStore((s) => s.mode);
  const done = game.nominations.map((n) => n !== null);
  const nextHuman = game.players.findIndex((_, i) => !done[i] && !isBotSeat(i));
  const seat = placement.seat;

  const progress = (
    <ul className="placement-progress" aria-label="Who has chosen">
      {game.players.map((p, i) => (
        <li key={p.id} className={done[i] ? 'done' : ''}>
          <PlayerBadge n={i + 1} color={CHARACTERS.find((c) => c.id === p.character)!.color} size={22} /> {p.name}
          {isBotSeat(i) ? ' 🤖' : ''} — {done[i] ? 'cursed a corridor ✓' : 'choosing…'}
        </li>
      ))}
    </ul>
  );

  if (mode === 'room') {
    return (
      <div className="curtain">
        <div className="curtain-card">
          <h2>Curse the Mansion</h2>
          <p>Everyone secretly picks one corridor on their phone. Six Reapers will hide in the mansion — nobody knows them all.</p>
          {progress}
        </div>
      </div>
    );
  }

  // A seat is behind the curtain, choosing or confirming.
  if (seat !== null) {
    const p = game.players[seat];
    if (placement.confirmed) {
      return (
        <div className="curtain">
          <div className="curtain-card" role="dialog" aria-label="Curse confirmed">
            <h2>Your curse is set, {p.name}.</h2>
            <p>
              A Reaper now waits at <b>space {placement.draft}</b>. It will not be shown to you again — remember it. You have no
              immunity: land there and you face it too.
            </p>
            <button className="btn primary big" onClick={() => setState({ placement: { seat: null, draft: null, confirmed: false } })}>
              Hide it and pass the device on
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="curtain">
        <div className="curtain-card wide" role="dialog" aria-label={`${p.name} chooses a corridor`}>
          <h2>{p.name}, curse one corridor</h2>
          <p className="muted">Glowing spaces are allowed: ordinary hallways away from rooms, events, passages, the entrance and the Super Reaper.</p>
          <MiniMap pickable={ELIGIBLE} selected={placement.draft} onPick={(id) => setState({ placement: { seat, draft: id, confirmed: false } })} label="Choose a corridor to curse" />
          <div className="row-btns">
            <button
              className="btn primary big"
              disabled={placement.draft === null}
              onClick={() => {
                act({ type: 'nominate', seat, node: placement.draft! });
                setState({ placement: { seat, draft: placement.draft, confirmed: true } });
              }}
            >
              {placement.draft === null ? 'Tap a glowing space' : `Curse space ${placement.draft}`}
            </button>
            <button className="btn ghost" onClick={() => setState({ placement: { seat: null, draft: null, confirmed: false } })}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="curtain">
      <div className="curtain-card">
        <h2>Curse the Mansion</h2>
        <p>
          Each player secretly picks one corridor for a hidden Reaper. With fewer than six picks (or matching picks), the house
          adds its own — six Reapers in all. Nobody learns anyone else’s pick.
        </p>
        {progress}
        {nextHuman >= 0 ? (
          <>
            <p className="handoff">
              Pass the device to <b>{game.players[nextHuman].name}</b>. Everyone else, please look away.
            </p>
            <button className="btn primary big" onClick={() => setState({ placement: { seat: nextHuman, draft: null, confirmed: false } })}>
              I’m {game.players[nextHuman].name} — show me the map
            </button>
          </>
        ) : (
          <p>The house is placing the rest…</p>
        )}
      </div>
    </div>
  );
}
