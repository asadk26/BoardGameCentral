import { useState } from 'react';
import { CHARACTERS, DEFAULT_PLAYER_NAMES, MAX_PIECES, MIN_PIECES, ROOMS, TEXT_LIMITS } from '../engine/config';
import { cleanText, defaultPersonalization } from '../engine/save';
import { defaultBotProfile } from '../engine/bots';
import { hostRoom } from '../net/host';
import { goToSetup, goToTitle, resumeGame, savePrefs, setPersonalization, setState, startGame, useStore, getState, type SetupPiece } from '../store';
import { PlayerBadge } from './Dialog';

export function Title() {
  const hasSave = useStore((s) => s.hasSave);
  const problem = useStore((s) => s.saveProblem);
  const mansion = useStore((s) => s.personalization.mansionName);
  return (
    <div className="title-screen">
      <div className="title-card">
        <p className="kicker">A Halloween board game for 2–4 pieces, up to 8 people · {mansion}</p>
        <h1>One More Room</h1>
        <p className="tag">One life in the mansion. Everyone else is a ghost trying to steal it. Hold it when the bell rings.</p>
        <div className="title-btns">
          {hasSave && (
            <button className="btn primary big" onClick={resumeGame}>
              Resume game
            </button>
          )}
          <button className={`btn big ${hasSave ? '' : 'primary'}`} onClick={goToSetup}>
            {hasSave ? 'New game' : 'Play on this screen'}
          </button>
          <button className="btn big" onClick={() => void hostRoom()}>
            Host a phone room
          </button>
          <button className="btn big ghost" onClick={() => setState({ modal: 'rules' })}>
            How to play
          </button>
        </div>
        <p className="muted small">
          Joining from a phone? Open <a href="#/join">Join on phone</a>. Phone rooms need the room service running on a computer on
          your Wi-Fi — see the README.
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

const fallbackName = (i: number, k: number) => DEFAULT_PLAYER_NAMES[(i * 2 + k) % DEFAULT_PLAYER_NAMES.length];

export function Setup() {
  const pieces = useStore((s) => s.setupPieces);
  const mode = useStore((s) => s.setupMode);
  const pz = useStore((s) => s.personalization);
  const editing = useStore((s) => s.editingPlayer);
  const hasSave = useStore((s) => s.hasSave);
  const [showCustom, setShowCustom] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const setPieces = (next: SetupPiece[]) => {
    setState({ setupPieces: next });
    savePrefs();
  };
  const update = (i: number, patch: Partial<SetupPiece>) => setPieces(pieces.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setMode = (m: 'ffa' | 'teams') => {
    setState({ setupMode: m });
    if (m === 'ffa') setPieces(pieces.map((p) => ({ ...p, names: p.names.slice(0, 1) })));
    else savePrefs();
  };
  const setCount = (n: number) => {
    const next = pieces.slice(0, n);
    while (next.length < n) {
      const used = new Set(next.map((p) => p.character));
      const free = CHARACTERS.find((c) => !used.has(c.id))!;
      next.push({ names: [fallbackName(next.length, 0)], character: free.id, kind: 'bot', bot: defaultBotProfile(next.length) });
    }
    setState({ editingPlayer: Math.min(getState().editingPlayer, n - 1) });
    setPieces(next);
  };
  const pick = (i: number, id: (typeof CHARACTERS)[number]['id']) => {
    const next = pieces.map((p) => ({ ...p }));
    const other = next.findIndex((p) => p.character === id);
    if (other >= 0 && other !== i) next[other].character = next[i].character;
    next[i].character = id;
    setState({ editingPlayer: i });
    setPieces(next);
  };
  const begin = () => {
    if (hasSave && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    startGame(pieces.map((p, i) => ({ ...p, names: p.names.map((n, k) => cleanText(n, TEXT_LIMITS.playerName, fallbackName(i, k))) })));
  };
  const people = pieces.reduce((a, p) => a + (p.kind === 'human' ? p.names.length : 0), 0);

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
          <div className="stepper" role="group" aria-label="Number of pieces">
            <button type="button" className="icon-btn" onClick={() => setCount(Math.max(MIN_PIECES, pieces.length - 1))} disabled={pieces.length <= MIN_PIECES} aria-label="Fewer pieces">
              −
            </button>
            <span aria-live="polite">{pieces.length} pieces</span>
            <button type="button" className="icon-btn" onClick={() => setCount(Math.min(MAX_PIECES, pieces.length + 1))} disabled={pieces.length >= MAX_PIECES} aria-label="More pieces">
              +
            </button>
          </div>
        </div>
        <div className="seat-kind" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={mode === 'ffa'} className={`chip ${mode === 'ffa' ? 'on' : ''}`} onClick={() => setMode('ffa')}>
            Free-for-all
          </button>
          <button type="button" role="radio" aria-checked={mode === 'teams'} className={`chip ${mode === 'teams' ? 'on' : ''}`} onClick={() => setMode('teams')}>
            Team Battle
          </button>
          <span className="muted small">
            {mode === 'ffa'
              ? 'One person (or a bot) per piece.'
              : 'Up to two people share a piece: the first plays odd rounds, the second even rounds. Uneven teams are fine.'}
          </span>
        </div>
        <p className="hint">
          Up to four pieces on the board; every costume plays the same. Any piece can be a bot. {people} {people === 1 ? 'person' : 'people'} playing.
        </p>
        <ol className="setup-players">
          {pieces.map((p, i) => {
            const color = CHARACTERS.find((c) => c.id === p.character)!.color;
            const human = p.kind === 'human';
            return (
              <li key={i} className={editing === i ? 'editing' : ''} onFocus={() => setState({ editingPlayer: i })} onClick={() => setState({ editingPlayer: i })}>
                <PlayerBadge n={i + 1} color={color} />
                <div className="names">
                  {(human ? p.names : p.names.slice(0, 1)).map((n, k) => (
                    <input
                      key={k}
                      aria-label={`Piece ${i + 1} ${human && p.names.length > 1 ? (k === 0 ? 'odd-round person' : 'even-round person') : 'name'}`}
                      value={n}
                      maxLength={TEXT_LIMITS.playerName}
                      onChange={(e) => update(i, { names: p.names.map((x, j) => (j === k ? e.target.value : x)) })}
                      onBlur={(e) => update(i, { names: p.names.map((x, j) => (j === k ? cleanText(e.target.value, TEXT_LIMITS.playerName, fallbackName(i, k)) : x)) })}
                    />
                  ))}
                  {mode === 'teams' && human && p.names.length === 1 && (
                    <button type="button" className="chip" onClick={() => update(i, { names: [...p.names, fallbackName(i, 1)] })}>
                      + teammate
                    </button>
                  )}
                  {mode === 'teams' && human && p.names.length === 2 && (
                    <button type="button" className="chip" onClick={() => update(i, { names: p.names.slice(0, 1) })} aria-label={`Remove the second person from piece ${i + 1}`}>
                      − teammate
                    </button>
                  )}
                </div>
                <div className="seat-kind" role="group" aria-label={`Piece ${i + 1} is played by`}>
                  <button
                    type="button"
                    className={`chip ${human ? 'on' : ''}`}
                    aria-pressed={human}
                    onClick={(e) => {
                      e.stopPropagation();
                      update(i, { kind: 'human', bot: undefined });
                    }}
                  >
                    {mode === 'teams' ? 'People' : 'Person'}
                  </button>
                  {(['greedy', 'cautious', 'mischievous'] as const).map((pers) => (
                    <button
                      type="button"
                      key={pers}
                      className={`chip ${p.kind === 'bot' && p.bot?.personality === pers ? 'on' : ''}`}
                      aria-pressed={p.kind === 'bot' && p.bot?.personality === pers}
                      onClick={(e) => {
                        e.stopPropagation();
                        update(i, { kind: 'bot', names: p.names.slice(0, 1), bot: { personality: pers, skill: p.bot?.skill ?? 'steady' } });
                      }}
                    >
                      🤖 {pers}
                    </button>
                  ))}
                  {p.kind === 'bot' && (
                    <select
                      aria-label={`Piece ${i + 1} bot reflexes`}
                      value={p.bot?.skill ?? 'steady'}
                      onChange={(e) => update(i, { bot: { personality: p.bot?.personality ?? 'greedy', skill: e.target.value as 'steady' } })}
                    >
                      <option value="shaky">shaky reflexes</option>
                      <option value="steady">steady reflexes</option>
                      <option value="sharp">sharp reflexes</option>
                    </select>
                  )}
                </div>
                <div className="char-pick" role="radiogroup" aria-label={`Piece ${i + 1} costume`}>
                  {CHARACTERS.map((c) => {
                    const owner = pieces.findIndex((q) => q.character === c.id);
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
                        title={owner >= 0 && !mine ? `Swap with piece ${owner + 1}` : c.blurb}
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
          {showCustom ? '▾' : '▸'} Rename the rooms (optional)
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
      <p className="hint">Names only — the rules never change.</p>
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
      </div>
      <button type="button" className="btn ghost" onClick={() => setPersonalization({ ...d })}>
        Reset room names
      </button>
    </div>
  );
}

function cleanAll(p: ReturnType<typeof defaultPersonalization>) {
  const d = defaultPersonalization();
  const roomNames: Record<number, string> = {};
  for (const id of Object.keys(ROOMS).map(Number)) roomNames[id] = cleanText(p.roomNames[id], TEXT_LIMITS.roomName, d.roomNames[id]);
  return { mansionName: cleanText(p.mansionName, TEXT_LIMITS.mansionName, d.mansionName), roomNames };
}
