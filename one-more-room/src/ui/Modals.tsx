import { EVENT_INFO, EVENT_TYPES } from '../engine/config';
import { undoInfo } from '../engine/engine';
import { discardSave, doUndo, goToSetup, goToTitle, setState, updateSettings, useStore } from '../store';
import { audio } from '../audio/audio';
import { Dialog } from './Dialog';

export function RulesContent() {
  return (
    <div className="rules">
      <p className="lede">
        Sneak through a haunted mansion, grab candy, and get it home to the Entrance Hall before midnight. The ghost hunts
        whoever is carrying the most. Can you risk one more room?
      </p>
      <h3>Your turn</h3>
      <ol>
        <li>
          <strong>Decoy (optional, once per game).</strong> Before rolling, if you are out in the house, you may leave a
          wrapped sweet on your space. This turn the ghost chases the decoy instead of anyone — though it still catches
          anybody standing on its route. The decoy vanishes after this ghost move.
        </li>
        <li>
          <strong>Roll two dice.</strong> Choose one die to <em>move you</em>; the other die <em>moves the ghost</em>. You
          can switch the dice and your destination freely until you confirm.
        </li>
        <li>
          <strong>Move</strong> 1 space up to your die, along the glowing spaces — or <strong>Stay</strong>. You follow
          the shortest route. You cannot pass through or stop on the ghost. Passing through a room does nothing; only
          where you stop counts.
        </li>
        <li>
          <strong>Land.</strong> In a candy room, take up to 3 candy (rooms never refill). On dropped candy, scoop up the
          whole pile. On a Trick or Treat space (?), draw a card.
        </li>
        <li>
          <strong>The ghost moves</strong>, then you pass to the next player.
        </li>
      </ol>
      <h3>Carried vs banked candy</h3>
      <p>
        Candy you pick up is <strong>carried</strong> — it is at risk. Reaching the Entrance Hall <strong>banks</strong>{' '}
        it automatically: banked candy is safe for good. Entering the Entrance Hall ends your move, so you cannot run
        through it to the other wing. The ghost can never go in there.
      </p>
      <h3>Secret passages</h3>
      <p>
        Spaces marked A connect to each other, and so do the B spaces. Crossing one costs 1 step, and you may use at most
        one passage per move. The ghost cannot use them.
      </p>
      <h3>How the ghost chooses</h3>
      <ul>
        <li>It ignores anyone in the Entrance Hall and never looks at banked candy.</li>
        <li>It hunts the player <strong>carrying</strong> the most candy (even if that is zero).</li>
        <li>Ties: the one nearest the ghost; then the active player; then the next player clockwise.</li>
        <li>If everyone is in the Entrance Hall and there is no decoy, it waits.</li>
      </ul>
      <p>
        Its die is how far it moves; the target decides where. It takes the shortest route, stops when it reaches its
        target, and catches everyone it passes on the way. Before you confirm a move, the forecast shows who it will
        hunt, how far it goes and who it will catch.
      </p>
      <h3>Getting caught</h3>
      <p>
        Drop half your carried candy (rounded up) on that space, then fly home: the rest is banked for you straight
        away. You keep your banked candy, your decoy and your next turn. Dropped candy stays on the floor for anyone who
        later ends a move there.
      </p>
      <h3>Trick or Treat cards</h3>
      <ul className="cards-list">
        {EVENT_TYPES.map((t) => (
          <li key={t}>
            <strong>{EVENT_INFO[t].title}:</strong> {EVENT_INFO[t].effect}
          </li>
        ))}
      </ul>
      <p>Moving or swapping through a card never collects candy, banks or draws another card.</p>
      <h3>Midnight</h3>
      <p>
        The game lasts 10 rounds; everyone gets one turn per round. After round 7 the bell tolls: three rounds until
        midnight. At the end, your score is <strong>banked candy + half your carried candy (rounded down)</strong>. The
        highest score wins; tied leaders share the victory.
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
    </div>
  );
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const session = useStore((s) => s.session);
  const saveProblem = useStore((s) => s.saveProblem);
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
            <button className="btn" onClick={() => setState({ modal: 'confirmNew' })}>
              New game…
            </button>
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
