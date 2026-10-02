import { useState } from 'react';
import { CHARACTERS, DEFAULT_PLAYER_NAMES, MAX_PIECES, MIN_PIECES, ROOMS, TEXT_LIMITS } from '../engine/config';
import { cleanText, defaultPersonalization } from '../engine/save';
import { hostRoom } from '../net/host';
import { fillBot, fillWithBots, goToSetup, goToTitle, resumeGame, savePrefs, setPersonalization, setState, startGame, useStore, getState, type SetupPiece } from '../store';
import { PlayerBadge } from './Dialog';

export function Title() {
  const hasSave = useStore((s) => s.hasSave);
  const problem = useStore((s) => s.saveProblem);
  const mansion = useStore((s) => s.personalization.mansionName);
  return (
    <div className="title-screen">
      <div className="title-card">
        <p className="kicker">A Halloween board game · four pieces · {mansion}</p>
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
          Joining from a phone? <a href="#/join">Join on phone</a> (needs the room service on a computer on your Wi-Fi).
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
  const fewer = useStore((s) => s.fewerPieces);
  const pz = useStore((s) => s.personalization);
  const editing = useStore((s) => s.editingPlayer);
  const hasSave = useStore((s) => s.hasSave);
  const [advanced, setAdvanced] = useState(false);
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
    setState({ fewerPieces: n < MAX_PIECES, editingPlayer: Math.min(getState().editingPlayer, n - 1) });
    setPieces(fillWithBots(pieces, n));
  };
  const makeHuman = (i: number) => update(i, { kind: 'human', bot: undefined, names: [/bot\b/i.test(pieces[i].names[0]) ? fallbackName(i, 0) : pieces[i].names[0]] });
  const makeBot = (i: number) => setPieces(pieces.map((q, j) => (j === i ? fillBot(q.character, i) : q)));
  const pick = (i: number, id: (typeof CHARACTERS)[number]['id']) => {
    const next = pieces.map((p) => ({ ...p }));
    const other = next.findIndex((p) => p.character === id);
    if (other >= 0 && other !== i) {
      next[other].character = next[i].character;
      if (next[other].kind === 'bot') next[other] = fillBot(next[other].character, other);
    }
    next[i].character = id;
    if (next[i].kind === 'bot') next[i] = fillBot(id, i);
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
  const humans = pieces.filter((p) => p.kind === 'human').length;
  const bots = pieces.length - humans;

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
          <h2>Who’s playing?</h2>
        </div>
        <ol className="setup-players lineup">
          {pieces.map((p, i) => {
            const color = CHARACTERS.find((c) => c.id === p.character)!.color;
            const human = p.kind === 'human';
            return (
              <li key={i} className={`${editing === i ? 'editing' : ''} ${human ? 'is-human' : 'is-bot'}`} onFocus={() => setState({ editingPlayer: i })} onClick={() => setState({ editingPlayer: i })}>
                <PlayerBadge n={i + 1} color={color} />
                <div className="names">
                  {human ? (
                    p.names.map((n, k) => (
                      <input
                        key={k}
                        aria-label={`Piece ${i + 1} ${p.names.length > 1 ? (k === 0 ? 'odd-round person' : 'even-round person') : 'name'}`}
                        value={n}
                        maxLength={TEXT_LIMITS.playerName}
                        onChange={(e) => update(i, { names: p.names.map((x, j) => (j === k ? e.target.value : x)) })}
                        onBlur={(e) => update(i, { names: p.names.map((x, j) => (j === k ? cleanText(e.target.value, TEXT_LIMITS.playerName, fallbackName(i, k)) : x)) })}
                      />
                    ))
                  ) : (
                    <span className="bot-name">{p.names[0]}</span>
                  )}
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
                  <button type="button" className={`chip ${human ? 'on' : ''}`} aria-pressed={human} onClick={() => makeHuman(i)}>
                    HUMAN
                  </button>
                  <button type="button" className={`chip ${!human ? 'on' : ''}`} aria-pressed={!human} onClick={() => makeBot(i)}>
                    BOT
                  </button>
                </div>
                <div className="char-pick" role="radiogroup" aria-label={`Piece ${i + 1} character`}>
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
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
        {confirmReplace && (
          <p className="notice" role="alert">
            This replaces the saved game. Press Start again to confirm.
          </p>
        )}
        <div className="row-btns">
          <button type="submit" className="btn primary big">
            {confirmReplace ? 'Start — replace saved game' : `Start · ${humans} ${humans === 1 ? 'human' : 'humans'} + ${bots} ${bots === 1 ? 'bot' : 'bots'}`}
          </button>
          <button type="button" className="btn ghost" onClick={goToTitle}>
            Back
          </button>
        </div>
        <button type="button" className="link" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          {advanced ? '▾' : '▸'} Advanced
        </button>
        {advanced && (
          <div className="advanced">
            <div className="seat-kind" role="radiogroup" aria-label="Mode">
              <button type="button" role="radio" aria-checked={mode === 'ffa'} className={`chip ${mode === 'ffa' ? 'on' : ''}`} onClick={() => setMode('ffa')}>
                One person per piece
              </button>
              <button type="button" role="radio" aria-checked={mode === 'teams'} className={`chip ${mode === 'teams' ? 'on' : ''}`} onClick={() => setMode('teams')}>
                Teams of two
              </button>
            </div>
            <div className="stepper" role="group" aria-label="Number of pieces">
              <button type="button" className="icon-btn" onClick={() => setCount(Math.max(MIN_PIECES, pieces.length - 1))} disabled={pieces.length <= MIN_PIECES} aria-label="Fewer pieces">
                −
              </button>
              <span aria-live="polite">{pieces.length} pieces</span>
              <button type="button" className="icon-btn" onClick={() => setCount(Math.min(MAX_PIECES, pieces.length + 1))} disabled={pieces.length >= MAX_PIECES} aria-label="More pieces">
                +
              </button>
            </div>
            {fewer && pieces.length < MAX_PIECES && <p className="muted small">Fewer than four pieces: fewer chases and quieter rounds. Four is the intended game.</p>}
            {pieces.some((p) => p.kind === 'bot') && (
              <div className="bot-skills">
                {pieces.map((p, i) =>
                  p.kind === 'bot' ? (
                    <label key={i} className="field inline">
                      <span>{p.names[0]}</span>
                      <select aria-label={`Piece ${i + 1} bot reflexes`} value={p.bot?.skill ?? 'steady'} onChange={(e) => update(i, { bot: { personality: p.bot?.personality ?? 'greedy', skill: e.target.value as 'steady' } })}>
                        <option value="shaky">shaky reflexes</option>
                        <option value="steady">steady reflexes</option>
                        <option value="sharp">sharp reflexes</option>
                      </select>
                    </label>
                  ) : null,
                )}
              </div>
            )}
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
              {showCustom ? '▾' : '▸'} Rename the rooms
            </button>
            {showCustom && <Customize />}
          </div>
        )}
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
