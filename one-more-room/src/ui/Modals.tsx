import { CHALLENGE, GHOST_MIN_MOVE, GHOST_SPAWNS, ITEM_WEIGHTS, ROUNDS, SEANCE_LIMIT, SUPER_REAPER, VERSUS_SPACES } from '../engine/config';
import { ITEM_INFO } from '../text';
import { undoInfo } from '../engine/engine';
import { discardSave, doUndo, goToSetup, goToTitle, setState, updateSettings, useStore } from '../store';
import { audio } from '../audio/audio';
import { useState } from 'react';
import { hostSend, leaveRoom } from '../net/host';
import { Dialog } from './Dialog';

export function RulesContent() {
  const c = CHALLENGE.rope;
  return (
    <div className="rules">
      <p className="lede">
        There is one life in the mansion. One piece holds it; everyone else is a ghost trying to steal it. Whoever holds the life when
        a round ends scores a point. Ten rounds — most points wins.
      </p>
      <h3>Pieces, teams and control</h3>
      <p>
        Two to four pieces play. In <strong>Free-for-all</strong> each piece is one person or a bot. In <strong>Team Battle</strong> one or two
        people share a piece (uneven teams are fine): the first person controls it in odd rounds, the second in even rounds — every
        move and every jump that round, even out of turn. A team shares one score, one position and one trap.
      </p>
      <h3>Before the first round</h3>
      <ol>
        <li>
          <strong>Hide the traps.</strong> Each piece secretly picks one corridor. The house tops them up to exactly six (matching picks merge)
          and secretly deals six effects over them: two <em>Reaper’s Challenges</em>, two <em>Séances</em>, two <em>Poltergeists</em>. You pick
          a place, never an effect, and your own trap works on you too.
        </li>
        <li>
          <strong>Roll for life.</strong> Every piece rolls a die. The highest starts alive in the Entrance Hall; tied leaders roll again. The
          others start as ghosts at spaces {GHOST_SPAWNS.join(', ')}.
        </li>
      </ol>
      <h3>A round</h3>
      <p>
        The piece holding the life acts first. Then each ghost acts once, in an order that shifts by one seat every round (shown at the top of
        the screen). The order is fixed when the round starts: if life changes hands, nobody gets an extra action and nobody loses theirs — a
        piece simply acts in its slot as whatever it is by then. When everyone has acted, the bell rings and the piece holding the life scores
        one point.
      </p>
      <h3>Moving</h3>
      <ul>
        <li>Roll one die. The living piece moves up to its roll. A ghost always drifts at least {GHOST_MIN_MOVE} (a 1 or 2 counts as {GHOST_MIN_MOVE}).</li>
        <li>Stop anywhere within reach, or stay. Pieces never block each other and may share spaces.</li>
        <li>Everyone may take one secret passage per move. Only ghosts may slip through the two dotted wall links (dining room ↔ conservatory, laboratory ↔ nursery).</li>
      </ul>
      <h3>Stealing the life</h3>
      <p>
        A ghost that ends its action on the living piece’s space, or one ordinary step away, may <strong>challenge</strong> (wall links and secret
        passages don’t count as “next to”). Both jump the same spectral rope. If the ghost wins, it takes the life and the living piece’s space,
        and the loser is thrown two spaces away. If the living piece wins, it keeps the life and the ghost is thrown back. The living piece
        can’t start a challenge itself.
      </p>
      <h3>Haunted Jump Rope</h3>
      <p>
        Eight shared sweeps that get faster every time the rope comes round (about 1.3 s apart at first, 0.8 s by the end), one press per sweep — holding or mashing never counts twice. The most clean jumps wins. Tied at the top? Only
        the tied jump up to {c.extraSweeps} sudden-death sweeps; then the steadier timing on the eight sweeps wins; an exact tie gets the
        Reaper’s seeded verdict. Exactly one piece always holds the life afterwards.
      </p>
      <p>
        <strong>The curse:</strong> the longer you hold the life, the narrower your jump window — normal after 0–1 rounds held, 10% narrower after 2,
        20% after 3, 30% after 4 or more. Losing the life resets it; winning a defence doesn’t change it. The rope is the same for everyone;
        only how precisely you must jump changes, and the screen shows your own window.
      </p>
      <h3>Traps and the Super Reaper</h3>
      <p>
        Traps trigger when a move ends on them (living or ghost) and stay revealed. Passing over, staying, or being thrown onto a space never
        triggers anything.
      </p>
      <ul>
        <li>
          <strong>Reaper’s Challenge:</strong> a ghost landing here duels the living piece from anywhere. The living piece landing here picks a
          ghost to duel. Nobody moves. It stays active for later landings.
        </li>
        <li>
          <strong>Séance:</strong> every piece jumps; the winner holds the life. One use per tile, and only {SEANCE_LIMIT} Séances per game in total
          (the Super Reaper shares them) — after that a Séance tile is revealed cold and does nothing.
        </li>
        <li>
          <strong>Poltergeist:</strong> throws whoever landed at least three spaces away (never to the Entrance Hall), keeping their role. A ghost
          may still challenge from where it lands.
        </li>
        <li>
          <strong>Super Reaper</strong> (space {SUPER_REAPER}, always visible): a Séance while any are left, then a Reaper’s Challenge for the rest of the
          game.
        </li>
      </ul>
      <p>One minigame per action at most: a trap that starts a challenge ends the action.</p>
      <h3>Ghost battles and items</h3>
      <p>
        Ghosts can also fight each other — not for the life, but for an item. After an ordinary move (not a stay, not a trap throw), a ghost may{' '}
        <strong>battle another ghost</strong> that is on the very same space (passing through or standing next to it isn’t enough), or — from one of
        the two <strong>⚔ Versus spaces</strong> ({VERSUS_SPACES.join(' and ')}) — battle <em>any</em> ghost, wherever it is. Nobody moves. The
        other ghost doesn’t need to agree or have a turn left; its current controller just gets the usual ready and countdown. The same two
        ghosts battle at most once per round. The living piece gets nothing from a Versus space, and with only two pieces a Versus space stays
        quiet.
      </p>
      <p>
        When a ghost lands where it could either challenge the living piece or battle a ghost, it picks one (or neither) — starting either ends
        the action. A trap that starts a minigame always comes first. A ghost battle is the same Haunted Jump Rope with the normal window for
        both (no curse). The life, the scores and the round order don’t change. The winner draws one random item —{' '}
        {ITEM_WEIGHTS.map(([id, w]) => `${ITEM_INFO[id].name} ${Math.round(w * 100)}%`).join(', ')} — and the loser loses nothing.
      </p>
      <ul>
        {ITEM_WEIGHTS.map(([id]) => (
          <li key={id}>
            <strong>
              {ITEM_INFO[id].icon} {ITEM_INFO[id].name}
            </strong>{' '}
            ({ITEM_INFO[id].when.toLowerCase()}): {ITEM_INFO[id].what}
          </li>
        ))}
      </ul>
      <p>
        Each piece holds at most one item, visible to everyone. Win a different one and you choose which to keep; win the one you already hold
        and nothing changes. Items can’t be traded, stacked or dropped. You can use one item per action, never in the action that won it (a
        ghost that wins while defending can use it on its own later turn). Gaining the life — by any challenge, Reaper or Séance — loses the
        item for good.
      </p>
      <h3>Winning</h3>
      <p>
        After round {ROUNDS}, the most points wins, whether you end alive or as a ghost. Tied top scores share the win. A game always hands out
        exactly {ROUNDS} points.
      </p>
    </div>
  );
}

function Settings() {
  const s = useStore((st) => st.settings);
  return (
    <div className="settings">
      <label className="row">
        <span>Music</span>
        <input type="range" min={0} max={1} step={0.05} value={s.musicVolume} onChange={(e) => updateSettings({ musicVolume: Number(e.target.value) })} />
      </label>
      <label className="row">
        <span>Sound effects</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={s.sfxVolume}
          onChange={(e) => updateSettings({ sfxVolume: Number(e.target.value) })}
          onPointerUp={() => audio.play('click')}
        />
      </label>
      <label className="row check">
        <input type="checkbox" checked={s.muted} onChange={(e) => updateSettings({ muted: e.target.checked })} />
        <span>Mute all sound</span>
      </label>
      <label className="row check">
        <input type="checkbox" checked={s.reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
        <span>Reduce motion (shorter animations, no bobbing)</span>
      </label>
      <label className="row check">
        <input type="checkbox" checked={s.calmCamera} onChange={(e) => updateSettings({ calmCamera: e.target.checked })} />
        <span>Calm camera (no challenge close-ups, quicker cuts)</span>
      </label>
      <label className="row check">
        <input type="checkbox" checked={s.lowGraphics} onChange={(e) => updateSettings({ lowGraphics: e.target.checked })} />
        <span>Low graphics (no shadows — smoother on older devices)</span>
      </label>
      <label className="row check">
        <input type="checkbox" checked={s.fastBots} onChange={(e) => updateSettings({ fastBots: e.target.checked })} />
        <span>Fast-forward bots (short pauses; their challenges resolve quickly)</span>
      </label>
    </div>
  );
}

function HostControls() {
  const room = useStore((s) => s.room);
  const [confirm, setConfirm] = useState(false);
  const view = room?.view;
  const pieces = view?.pieces ?? [];
  const spectators = view?.spectators ?? [];
  const running = !!view?.run?.startAt;
  const paused = !!view?.paused;
  return (
    <div className="stack host-controls">
      <p className="muted small">
        Room {room?.code} — host controls. Undo is off in phone rooms. Handovers wait until no challenge is being jumped.
      </p>
      {view?.notice && <p className="notice">{view.notice}</p>}
      <button className="btn" onClick={() => hostSend({ t: 'pause', on: !paused })}>
        {paused ? 'Resume the game' : 'Pause the game'}
      </button>
      {pieces
        .filter((p) => p.kind === 'phone')
        .map((p) => (
          <div key={p.piece} className="host-piece">
            <b>
              {p.piece + 1}. {p.name}
            </b>
            {p.members.map((m, slot) => (
              <div key={slot} className="row-btns">
                <span>
                  {p.members.length > 1 ? (slot === 0 ? 'Odd rounds: ' : 'Even rounds: ') : ''}
                  {m.name} {m.connected ? '📱' : '📱 offline'}
                </span>
                {!m.connected &&
                  [...spectators, ...p.members.filter((o) => o.participantId !== m.participantId && o.connected)].map((to) => (
                    <button key={to.participantId} className="btn tool" disabled={running} onClick={() => hostSend({ t: 'handover', piece: p.piece, slot, to: to.participantId })}>
                      Hand to {to.name}
                    </button>
                  ))}
              </div>
            ))}
            <div className="row-btns">
              <button className="btn tool" disabled={running} onClick={() => hostSend({ t: 'replaceWithBot', piece: p.piece })}>
                Hand the piece to a bot
              </button>
              <button className="btn tool" aria-pressed={!!p.localControl} onClick={() => hostSend({ t: 'localControl', piece: p.piece, on: !p.localControl })}>
                {p.localControl ? 'Jumps on phone' : 'Jumps on TV keyboard'}
              </button>
            </div>
          </div>
        ))}
      {confirm ? (
        <div className="row-btns">
          <button className="btn danger" onClick={() => { hostSend({ t: 'restart' }); setState({ modal: null }); }}>
            Yes, restart for everyone
          </button>
          <button className="btn" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setConfirm(true)}>
          Restart the game…
        </button>
      )}
      <button className="btn ghost" onClick={leaveRoom}>
        Close the room
      </button>
    </div>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const session = useStore((s) => s.session);
  const saveProblem = useStore((s) => s.saveProblem);
  const mode = useStore((s) => s.mode);
  const close = () => setState({ modal: null });
  switch (modal) {
    case 'rules':
      return (
        <Dialog title="How to play" onClose={close} wide>
          <RulesContent />
        </Dialog>
      );
    case 'settings':
      return (
        <Dialog title="Sound, motion & graphics" onClose={close}>
          <Settings />
        </Dialog>
      );
    case 'menu':
      return (
        <Dialog title="Paused" onClose={close}>
          <div className="stack">
            <button className="btn primary" onClick={close}>
              Resume
            </button>
            <button className="btn" onClick={() => setState({ modal: 'rules' })}>
              How to play
            </button>
            <button className="btn" onClick={() => setState({ modal: 'settings' })}>
              Sound & motion
            </button>
            {mode === 'room' ? <HostControls /> : (
              <button className="btn" onClick={() => setState({ modal: 'confirmNew' })}>
                New game…
              </button>
            )}
            <button className="btn ghost" onClick={goToTitle}>
              Back to title (game stays saved)
            </button>
          </div>
        </Dialog>
      );
    case 'confirmNew':
      return (
        <Dialog title="Start a new game?" onClose={close}>
          <p>This replaces the game in progress. It cannot be undone.</p>
          <div className="row-btns">
            <button className="btn danger" onClick={goToSetup}>
              Start a new game
            </button>
            <button className="btn" onClick={close}>
              Keep playing
            </button>
          </div>
        </Dialog>
      );
    case 'confirmUndo': {
      if (!session) return null;
      const info = undoInfo(session);
      return (
        <Dialog title="Undo" onClose={close}>
          <p>
            Go back to the start of <strong>{info.pieceName}</strong>’s action in round {info.round}? Everything since then is
            undone and the die will roll exactly the same. Traps the table has already seen stay marked.
          </p>
          <div className="row-btns">
            <button className="btn primary" onClick={doUndo}>
              Undo to {info.pieceName}’s action
            </button>
            <button className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </Dialog>
      );
    }
    case 'saveProblem':
    case 'confirmDiscard':
      return (
        <Dialog title="Saved game problem" onClose={close}>
          <p>
            {saveProblem === 'incompatible'
              ? 'The saved game on this device uses the old candy rules. One Life is a different game, so that save can’t be resumed — clear it to start fresh.'
              : saveProblem === 'layout'
                ? 'The saved game on this device has a hidden trap on a space that is now a Versus space for ghost battles, so it can’t continue on the new board. Clear it to start a fresh game.'
                : 'The saved game on this device looks damaged and can’t be resumed.'}
          </p>
          <p>You can clear it and start fresh. Nothing else stored in your browser is touched.</p>
          <div className="row-btns">
            <button className="btn danger" onClick={discardSave}>
              Clear saved game
            </button>
            <button className="btn" onClick={close}>
              Not now
            </button>
          </div>
        </Dialog>
      );
    default:
      return null;
  }
}
