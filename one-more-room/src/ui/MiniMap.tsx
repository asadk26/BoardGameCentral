// A flat, tappable top-down map of the mansion: used for secret placement and
// by the phone controller. It draws only what it is given — callers pass
// public facts (revealed traps), never the hidden map.

import { CHARACTERS, DECORATED_CORRIDORS, GHOST_WALL_LINKS, NODE_COUNT, NODE_POSITIONS, ORDINARY_EDGES, SECRET_EDGES, SUPER_REAPER, nodeKind, type TrapEffect } from '../engine/config';
import type { GameState } from '../engine/types';

const X0 = -13;
const Z0 = -8;
const S = 18;
const px = (id: number) => [(NODE_POSITIONS[id][0] - X0) * S, (NODE_POSITIONS[id][1] - Z0) * S] as const;

export interface MiniMapProps {
  /** Nodes that can be tapped. */
  pickable?: ReadonlySet<number>;
  selected?: number | null;
  onPick?: (id: number) => void;
  game?: GameState | null;
  /** Revealed (public) traps only, with their effects. */
  revealed?: ReadonlyArray<{ node: number; effect: TrapEffect; spent?: boolean }>;
  label?: string;
  /** Highlight a route. */
  path?: number[];
  showWallLinks?: boolean;
}

export function MiniMap({ pickable, selected, onPick, game, revealed = [], label = 'Mansion map', path, showWallLinks = false }: MiniMapProps) {
  const W = 26 * S;
  const H = 19 * S;
  return (
    <svg className="minimap" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
      <rect x={0} y={0} width={W} height={H} rx={14} fill="#1c1230" />
      {ORDINARY_EDGES.map(([a, b]) => {
        const [x1, y1] = px(a);
        const [x2, y2] = px(b);
        return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7a2436" strokeWidth={9} strokeLinecap="round" />;
      })}
      {SECRET_EDGES.map(([a, b], k) => {
        const [x1, y1] = px(a);
        const [x2, y2] = px(b);
        return <path key={`s${k}`} d={`M${x1},${y1} Q${(x1 + x2) / 2},${Math.min(y1, y2) - 60} ${x2},${y2}`} fill="none" stroke={k === 0 ? '#c77dff' : '#7ee081'} strokeWidth={2} strokeDasharray="4 6" opacity={0.6} />;
      })}
      {showWallLinks &&
        GHOST_WALL_LINKS.map(([a, b], k) => {
          const [x1, y1] = px(a);
          const [x2, y2] = px(b);
          return <line key={`w${k}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5ff2e0" strokeWidth={3} strokeDasharray="2 6" opacity={0.8} />;
        })}
      {path && path.length > 1 && (
        <polyline points={path.map((n) => px(n).join(',')).join(' ')} fill="none" stroke="#fff1b8" strokeWidth={4} strokeDasharray="6 6" />
      )}
      {Array.from({ length: NODE_COUNT }, (_, id) => {
        const [x, y] = px(id);
        const kind = nodeKind(id);
        const can = pickable?.has(id) ?? false;
        const fill = id === 0 ? '#e8b54a' : kind === 'room' ? '#c98a4b' : DECORATED_CORRIDORS.includes(id) ? '#b8703a' : kind === 'secret' ? '#9b6ce0' : id === SUPER_REAPER ? '#8a2be2' : '#5a4d66';
        const trap = revealed.find((t) => t.node === id);
        const mark = id === SUPER_REAPER ? '☠' : trap ? (trap.effect === 'reaper' ? '☠' : trap.effect === 'seance' ? (trap.spent ? '·' : '🕯') : '🌀') : String(id);
        const r = id === 0 ? 15 : 11;
        return (
          <g
            key={id}
            className={`mm-node ${can ? 'can' : ''} ${selected === id ? 'sel' : ''}`}
            onClick={can && onPick ? () => onPick(id) : undefined}
            role={can ? 'button' : undefined}
            aria-label={can ? `Space ${id}` : undefined}
            tabIndex={can ? 0 : undefined}
            onKeyDown={can && onPick ? (e) => (e.key === 'Enter' || e.key === ' ') && onPick(id) : undefined}
          >
            {can && <circle cx={x} cy={y} r={r + 7} fill={selected === id ? '#fff1b8' : '#f2a93b'} opacity={selected === id ? 0.9 : 0.35} />}
            <circle cx={x} cy={y} r={r} fill={fill} stroke="#150d24" strokeWidth={2} opacity={pickable && !can ? 0.45 : 1} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={10} fontWeight={800} fill="#150d24">
              {mark}
            </text>
          </g>
        );
      })}
      {game &&
        game.phase !== 'placement' &&
        game.phase !== 'lifeRoll' &&
        game.pieces.map((p, i) => {
          const [x, y] = px(p.node);
          const here = game.pieces.filter((q) => q.node === p.node);
          const k = here.indexOf(p);
          const ox = (k - (here.length - 1) / 2) * 12;
          const color = CHARACTERS.find((c) => c.id === p.character)!.color;
          return (
            <g key={p.id} transform={`translate(${x + ox},${y - 18})`} opacity={p.alive ? 1 : 0.65}>
              <circle r={p.alive ? 10 : 8} fill={color} stroke={p.alive ? '#ffd36b' : '#bff'} strokeWidth={p.alive ? 3 : 2} strokeDasharray={p.alive ? undefined : '2 2'} />
              <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={900} fill="#1a1024">
                {i + 1}
              </text>
              {p.alive && (
                <text y={-12} textAnchor="middle" fontSize={11}>
                  ❤
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}
