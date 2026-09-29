import { useState } from 'react';
import { CHARACTERS, DEFAULT_PLAYER_NAMES, EVENT_INFO, EVENT_TYPES, MAX_PLAYERS, MIN_PLAYERS, ROOMS, TEXT_LIMITS } from '../engine/config';
import { cleanText, defaultPersonalization } from '../engine/save';
import { defaultBotProfile } from '../engine/bots';
import { hostRoom } from '../net/host';
import { goToSetup, goToTitle, resumeGame, savePrefs, setPersonalization, setState, startGame, useStore, getState } from '../store';
import { PlayerBadge } from './Dialog';

export function Title() {
  const hasSave = useStore((s) => s.hasSave);
  const problem = useStore((s) => s.saveProblem);
  const mansion = useStore((s) => s.personalization.mansionName);
  return (
    <div className="title-screen">
      <div className="title-card">
        <p className="kicker">A Halloween board game for 2–6 players · {mansion}</p>
        <h1>One More Room</h1>
        <p className="tag">Grab candy. Bank it. Outwit the ghost before midnight.</p>
        <div className="title-btns">
          {hasSave && (
            <button className="btn primary big" onClick={resumeGame}>
              Resume game
            </button>
          )}
          <button className={`btn big ${hasSave ? '' : 'primary'}`} onClick={goToSetup}>
            {hasSave ? 'New game' : 'Play'}
          </button>
          <button className="btn big" onClick={() => void hostRoom()}>
            Host a phone room
          </button>
          <button className="btn big ghost" onClick={() => setState({ modal: 'rules' })}>
            How to play
          </button>
        </div>
        <p className="muted small">
          Joining from a phone? Open <a href="#/join">Join on phone</a>.
        </p>
        {problem && (
          <p className="notice" role="status">
            A saved game couldn’t be loaded.{' '}
            <button className="link" onClick={() => setState({ modal: 'saveProblem' })}>
              Details
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

export function Setup() {
  const players = useStore((s) => s.setupPlayers);
  const pz = useStore((s) => s.personalization);
  const editing = useStore((s) => s.editingPlayer);
  const hasSave = useStore((s) => s.hasSave);
  const [showCustom, setShowCustom] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const setPlayers = (next: typeof players) => {
    setState({ setupPlayers: next });
    savePrefs();
  };
  const setCount = (n: number) => {
    const next = players.slice(0, n);
    while (next.length < n) {
      const used = new Set(next.map((p) => p.character));
      const free = CHARACTERS.find((c) => !used.has(c.id))!;
      next.push({ name: DEFAULT_PLAYER_NAMES[next.length], character: free.id, kind: 'bot', bot: defaultBotProfile(next.length) });
    }
    setState({ editingPlayer: Math.min(getState().editingPlayer, n - 1) });
    setPlayers(next);
  };
  const pick = (i: number, id: (typeof CHARACTERS)[number]['id']) => {
    const next = players.map((p) => ({ ...p }));
    const other = next.findIndex((p) => p.character === id);
    if (other >= 0 && other !== i) next[other].character = next[i].character;
    next[i].character = id;
    setState({ editingPlayer: i });
    setPlayers(next);
  };
  const begin = () => {
    if (hasSave && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    startGame(players.map((p, i) => ({ ...p, name: cleanText(p.name, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[i]) })));
  };

  return (
    <div className="setup-screen">
      <form
        className="setup-card"
        onSubmit={(e) => {
          e.preventDefault();
          begin();
        }}
      >
        <div className="setup-head">
          <h2>Who’s going in?</h2>
          <div className="stepper" role="group" aria-label="Number of players">
            <button type="button" className="icon-btn" onClick={() => setCount(Math.max(MIN_PLAYERS, players.length - 1))} disabled={players.length <= MIN_PLAYERS} aria-label="Fewer players">
              −
            </button>
            <span aria-live="polite">{players.length} players</span>
            <button type="button" className="icon-btn" onClick={() => setCount(Math.min(MAX_PLAYERS, players.length + 1))} disabled={players.length >= MAX_PLAYERS} aria-label="More players">
              +
            </button>
          </div>
        </div>
        <p className="hint">Pick a costume for each player or team — tap a figure on the steps, or use the buttons. Everyone has the same abilities. Any seat can be a person or a bot; one person plus bots works fine.</p>
        <ol className="setup-players">
          {players.map((p, i) => {
            const color = CHARACTERS.find((c) => c.id === p.character)!.color;
            return (
              <li key={i} className={editing === i ? 'editing' : ''} onFocus={() => setState({ editingPlayer: i })} onClick={() => setState({ editingPlayer: i })}>
                <PlayerBadge n={i + 1} color={color} />
                <input
                  aria-label={`Player ${i + 1} name`}
                  value={p.name}
                  maxLength={TEXT_LIMITS.playerName}
                  onChange={(e) => setPlayers(players.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)))}
                  onBlur={(e) => setPlayers(players.map((q, j) => (j === i ? { ...q, name: cleanText(e.target.value, TEXT_LIMITS.playerName, DEFAULT_PLAYER_NAMES[i]) } : q)))}
                />
                <div className="seat-kind" role="group" aria-label={`Player ${i + 1} is played by`}>
                  <button
                    type="button"
                    className={`chip ${p.kind === 'human' ? 'on' : ''}`}
                    aria-pressed={p.kind === 'human'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlayers(players.map((q, j) => (j === i ? { ...q, kind: 'human', bot: undefined } : q)));
                    }}
                  >
                    Person
                  </button>
                  {(['greedy', 'cautious', 'mischievous'] as const).map((pers) => (
                    <button
                      type="button"
                      key={pers}
                      className={`chip ${p.kind === 'bot' && p.bot?.personality === pers ? 'on' : ''}`}
                      aria-pressed={p.kind === 'bot' && p.bot?.personality === pers}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayers(players.map((q, j) => (j === i ? { ...q, kind: 'bot', bot: { personality: pers, skill: q.bot?.skill ?? 'steady' } } : q)));
                      }}
                    >
                      🤖 {pers}
                    </button>
                  ))}
                  {p.kind === 'bot' && (
                    <select
                      aria-label={`Player ${i + 1} bot reflexes`}
                      value={p.bot?.skill ?? 'steady'}
                      onChange={(e) => setPlayers(players.map((q, j) => (j === i ? { ...q, bot: { personality: q.bot?.personality ?? 'greedy', skill: e.target.value as 'steady' } } : q)))}
                    >
                      <option value="shaky">shaky reflexes</option>
                      <option value="steady">steady reflexes</option>
                      <option value="sharp">sharp reflexes</option>
                    </select>
                  )}
                </div>
                <div className="char-pick" role="radiogroup" aria-label={`Player ${i + 1} costume`}>
                  {CHARACTERS.map((c) => {
                    const owner = players.findIndex((q) => q.character === c.id);
                    const mine = owner === i;
                    return (
                      <button
                        type="button"
                        key={c.id}
                        role="radio"
                        aria-checked={mine}
                        className={`chip ${mine ? 'on' : ''} ${owner >= 0 && !mine ? 'taken' : ''}`}
                        style={mine ? { borderColor: c.color, background: `${c.color}33` } : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          pick(i, c.id);
                        }}
                        title={owner >= 0 && !mine ? `Swap with player ${owner + 1}` : c.blurb}
                      >
                        {c.name}
                        {owner >= 0 && !mine && <small> ({owner + 1})</small>}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
        <label className="field">
          <span>Mansion name</span>
          <input
            value={pz.mansionName}
            maxLength={TEXT_LIMITS.mansionName}
            onChange={(e) => setState({ personalization: { ...pz, mansionName: e.target.value } })}
            onBlur={(e) => setPersonalization({ ...pz, mansionName: cleanText(e.target.value, TEXT_LIMITS.mansionName, defaultPersonalization().mansionName) })}
          />
        </label>
        <button type="button" className="link" aria-expanded={showCustom} onClick={() => setShowCustom((v) => !v)}>
          {showCustom ? '▾' : '▸'} Personalize rooms, ghost and cards (optional)
        </button>
        {showCustom && <Customize />}
        {confirmReplace && (
          <p className="notice" role="alert">
            Starting will replace the saved game on this device. Press Start again to confirm.
          </p>
        )}
        <div className="row-btns">
          <button type="submit" className="btn primary big">
            {confirmReplace ? 'Start — replace saved game' : 'Start game'}
          </button>
          <button type="button" className="btn ghost" onClick={goToTitle}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}

function Customize() {
  const pz = useStore((s) => s.personalization);
  const d = defaultPersonalization();
  const setLocal = (next: typeof pz) => setState({ personalization: next });
  const commit = () => setPersonalization(cleanAll(getState().personalization));
  return (
    <div className="customize">
      <p className="hint">Names and flavour text only — the rules never change.</p>
      <div className="grid2">
        {Object.keys(ROOMS).map((idStr) => {
          const id = Number(idStr);
          return (
            <label className="field" key={id}>
              <span>
                {ROOMS[id].defaultName} (space {id})
              </span>
              <input
                value={pz.roomNames[id] ?? ''}
                maxLength={TEXT_LIMITS.roomName}
                onChange={(e) => setLocal({ ...pz, roomNames: { ...pz.roomNames, [id]: e.target.value } })}
                onBlur={commit}
              />
            </label>
          );
        })}
        <label className="field">
          <span>Ghost name</span>
          <input value={pz.ghostName} maxLength={TEXT_LIMITS.ghostName} onChange={(e) => setLocal({ ...pz, ghostName: e.target.value })} onBlur={commit} />
        </label>
      </div>
      {EVENT_TYPES.map((t) => (
        <label className="field" key={t}>
          <span>
            {EVENT_INFO[t].title} flavour <em>(effect: {EVENT_INFO[t].effect})</em>
          </span>
          <input
            value={pz.flavors[t] ?? ''}
            placeholder={EVENT_INFO[t].flavors[0]}
            maxLength={TEXT_LIMITS.flavor}
            onChange={(e) => setLocal({ ...pz, flavors: { ...pz.flavors, [t]: e.target.value } })}
            onBlur={commit}
          />
        </label>
      ))}
      <button type="button" className="btn ghost" onClick={() => setPersonalization({ ...d })}>
        Reset names & text to defaults
      </button>
    </div>
  );
}

function cleanAll(p: ReturnType<typeof defaultPersonalization>) {
  const d = defaultPersonalization();
  const roomNames: Record<number, string> = {};
  for (const id of Object.keys(ROOMS).map(Number)) roomNames[id] = cleanText(p.roomNames[id], TEXT_LIMITS.roomName, d.roomNames[id]);
  const flavors: typeof p.flavors = {};
  for (const t of EVENT_TYPES) {
    const f = cleanText(p.flavors[t], TEXT_LIMITS.flavor, '');
    if (f) flavors[t] = f;
  }
  return {
    mansionName: cleanText(p.mansionName, TEXT_LIMITS.mansionName, d.mansionName),
    ghostName: cleanText(p.ghostName, TEXT_LIMITS.ghostName, d.ghostName),
    roomNames,
    flavors,
  };
}
