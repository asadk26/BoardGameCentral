import { CHALLENGE, EVENT_INFO, EVENT_TYPES, SCORING } from '../engine/config';
import { undoInfo } from '../engine/engine';
import { discardSave, doUndo, goToSetup, goToTitle, setState, updateSettings, useStore } from '../store';
import { audio } from '../audio/audio';
import { useState } from 'react';
import { hostSend, leaveRoom } from '../net/host';
import { Dialog } from './Dialog';

export function RulesContent() {
  const r = CHALLENGE.rope.pass;
  return (
    <div className="rules">
      <p className="lede">
        Sneak through a haunted mansion, grab candy, and get it home to the Entrance Hall before midnight. Survive what lurks
        in the dark — or come back as a ghost and haunt your friends. Can you risk one more room?
      </p>
      <h3>Before the first roll: curse the mansion</h3>
      <p>
        Each player secretly picks one ordinary corridor for a hidden Reaper. The house adds its own until there are exactly
        six. Nobody sees anyone else’s pick, and yours is never shown again — remember it. You have no immunity to your own.
      </p>
      <h3>A living player’s turn</h3>
      <ol>
        <li>
          <strong>Decoy (optional, once per game).</strong> Before rolling, if you are out in the house, leave a wrapped sweet
          on your space. This turn the resident ghost heads for it instead of anyone’s candy.
        </li>
        <li>
          <strong>Roll two dice.</strong> Choose one to <em>move you</em>; the other <em>moves the resident ghost</em>.
        </li>
        <li>
          <strong>Move</strong> 1 space up to your die along the glowing spaces, or <strong>Stay</strong>. You can pass other
          living players but never pass through or stop on a ghost. Only where you stop counts.
        </li>
        <li>
          <strong>Land.</strong> Rooms give up to 3 candy (they never refill); dropped candy is scooped up; a Trick or Treat
          space (?) draws a card. Entering the Entrance Hall banks everything you carry and ends your move.
        </li>
        <li>
          <strong>The resident ghost moves</strong>, then you pass on.
        </li>
      </ol>
      <h3>Carried vs banked candy</h3>
      <p>
        Carried candy is at risk: if you die you drop all of it where you fall. Banked candy is yours for good — even as a
        ghost. Nobody can take it.
      </p>
      <h3>Survival encounters</h3>
      <ul>
        <li>
          <strong>Caught by a ghost</strong> (the resident ghost or a player ghost): <em>Break the Curse</em> — press when the
          circling marker is in the glowing zone. Two tries, one hit escapes. You keep your candy and flee to the nearest empty
          corridor.
        </li>
        <li>
          <strong>Stopping on a Reaper trap</strong> reveals it for good. Death demands a performance: <em>Dance for Death</em>{' '}
          (repeat four moves; two tries) or <em>Graveyard Jump Rope</em> (clear {r} of 8 sweeps). Passing over a trap is always
          safe; staying never triggers one.
        </li>
        <li>
          <strong>The Super Reaper</strong> (always visible, space 12): stop there and pick any unprotected living opponent. You
          both jump the same rope; exactly one survives. They stay where they are on the board. No opponent? You perform alone.
        </li>
        <li>
          <strong>Stopping on another living player</strong> (outside the Entrance Hall) starts <em>Haunted Jump Rope</em>: eight
          sweeps, each of you needs {r} to live — both may survive, or neither. After the bell at the end of round 7, duels leave
          one survivor: the lower score dies; ties go to up to four sudden-death sweeps, then steadier timing, then a curse.
        </li>
      </ul>
      <p>One stop causes at most one encounter: Super Reaper first, then a duel, then a Reaper performance.</p>
      <h3>Protection</h3>
      <p>
        Survive any challenge and you are protected until the end of your next turn: ghosts pass you by, nobody can duel you,
        and you can’t start a duel. An unknown trap spares you (but is revealed). Choosing to stop on a <em>revealed</em> Reaper
        or the Super Reaper ignores your protection for that encounter — you’ll be warned first.
      </p>
      <h3>Becoming a ghost</h3>
      <p>
        Fail a challenge and you turn into a spectral version of your character, right there. You keep your seat and your
        banked candy. From your next turn you roll one die, drift through the mansion (including two ghost-only links through
        walls), never enter the Entrance Hall, and can’t collect candy or draw cards. End your move on an unprotected living
        player and they must break the curse. Each player you turn earns a {SCORING.bountyPerKill}-point bounty, up to {SCORING.bountyCap}.
      </p>
      <h3>How the resident ghost chooses</h3>
      <ul>
        <li>It hunts the unprotected living player <strong>carrying</strong> the most, outside the Entrance Hall.</li>
        <li>Ties: the nearest; then the active player; then the next player clockwise. It never hunts ghosts.</li>
        <li>It stops at the first unprotected living player on its path and they break the curse — one challenge per move.</li>
        <li>If nobody is exposed and there is no decoy, it waits.</li>
      </ul>
      <h3>Trick or Treat cards</h3>
      <ul className="cards-list">
        {EVENT_TYPES.map((t) => (
          <li key={t}>
            <strong>{EVENT_INFO[t].title}:</strong> {EVENT_INFO[t].effect}
          </li>
        ))}
      </ul>
      <p>Moving or swapping through a card never collects candy, banks, triggers a Reaper or starts a duel.</p>
      <h3>Midnight and scoring</h3>
      <p>
        Ten rounds, one turn each per round — or the night ends at once if nobody is left alive. Living players score{' '}
        <strong>banked + half their carried candy (rounded down)</strong>, plus a <strong>{SCORING.survivalBonus}-point survival bonus</strong> if
        they finish alive with at least {SCORING.survivalBonusMinBanked} banked. Ghosts score <strong>banked + bounty</strong>. Highest total wins;
        ties share the win.
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
          onPointerUp={() => audio.play('candy')}
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
        <span>Calm camera (no ghost chase shots, quicker cuts)</span>
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
  const seats = room?.view?.seats ?? [];
  return (
    <div className="stack host-controls">
      <p className="muted small">
        Room {room?.code} — host controls. Undo is off in phone rooms; a restart starts a fresh game for everyone.
      </p>
      {seats
        .filter((s) => s.kind === 'phone')
        .map((s) => (
          <div key={s.seat} className="row-btns">
            <span>
              {s.seat + 1}. {s.name} {s.connected ? '📱' : '📱 offline'}
            </span>
            <button className="btn tool" onClick={() => hostSend({ t: 'replaceWithBot', seat: s.seat })}>
              Hand to a bot
            </button>
            <button className="btn tool" aria-pressed={!!s.localControl} onClick={() => hostSend({ t: 'localControl', seat: s.seat, on: !s.localControl })}>
              {s.localControl ? 'Challenges on phone' : 'Challenges on TV keyboard'}
            </button>
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
            Go back to the start of <strong>{info.playerName}</strong>’s turn in round {info.round}? Everything since then
            is undone. The dice and cards will come out exactly the same.
          </p>
          <div className="row-btns">
            <button className="btn primary" onClick={doUndo}>
              Undo to {info.playerName}’s turn
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
              ? 'The saved game on this device is from a different version of One More Room and can’t be resumed.'
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
