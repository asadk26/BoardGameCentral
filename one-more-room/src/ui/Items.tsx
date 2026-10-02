// Ghost-battle items and encounter choices, shared by the TV/laptop HUD and
// the phone controller. Everything shown here is public: items are visible to
// the whole table; the reward stream and pending draws never reach a view.

import type { RefObject } from 'react';
import { CHARACTERS, curseMultiplier, type ItemId } from '../engine/config';
import { actingPiece, itemBlock, livingPiece, switchTargets } from '../engine/engine';
import type { Action, GameState } from '../engine/types';
import type { Personalization } from '../engine/save';
import { BATTLE_LABEL, CHALLENGE_LABEL, cursePhrase, ITEM_INFO, itemTooltip, placeName } from '../text';
import './items.css';

type Btn = 'btn' | 'pbtn';
const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)!.color;

export function ItemBadge({ item, compact = false }: { item: ItemId; compact?: boolean }) {
  const i = ITEM_INFO[item];
  return (
    <span className={`item-badge item-${item}`} title={itemTooltip(item)} aria-label={`Item: ${i.name}. ${i.when}. ${i.what}`}>
      <span aria-hidden="true">{i.icon}</span>
      {!compact && <span className="item-name">{i.name}</span>}
    </span>
  );
}

/** A face-up card for a reward reveal or a keep/replace choice. */
export function ItemCard({ item, label, fresh = false }: { item: ItemId; label?: string; fresh?: boolean }) {
  const i = ITEM_INFO[item];
  return (
    <div className={`item-card item-${item} ${fresh ? 'fresh' : ''}`} title={itemTooltip(item)}>
      {label && <div className="item-card-label">{label}</div>}
      <div className="item-card-icon" aria-hidden="true">
        {i.icon}
      </div>
      <div className="item-card-name">{i.name}</div>
      <div className="item-card-when">{i.when}</div>
      <p className="item-card-what">{i.what}</p>
    </div>
  );
}

/**
 * The acting ghost's item: a use button when it can be used now, otherwise
 * a note saying when it can. Stale or invalid uses are refused by the rules
 * and never spend the item.
 */
export function ItemActions({
  game,
  send,
  btn,
  disabled = false,
  pz,
}: {
  game: GameState;
  send: (a: Action) => void;
  btn: Btn;
  disabled?: boolean;
  pz: Personalization;
}) {
  const pi = actingPiece(game);
  if (pi < 0) return null;
  const me = game.pieces[pi];
  if (me.alive || !me.item) return null;
  const item = me.item;
  const info = ITEM_INFO[item];
  const now = item === 'secondRoll' ? game.phase === 'choose' && game.rollInfo?.kind === 'die' : game.phase === 'turnStart';
  if (!now) {
    if (game.phase !== 'turnStart' && game.phase !== 'choose') return null;
    return (
      <p className="item-hint muted small">
        <ItemBadge item={item} /> {game.itemUsed ? 'One item per action.' : `${info.when}.`}
      </p>
    );
  }
  if (item === 'ghostSwitch') {
    const targets = switchTargets(game);
    const base = itemBlock(game, 'ghostSwitch', targets[0]);
    return (
      <div className="item-actions" role="group" aria-label={`Use ${info.name}`}>
        <p className="item-hint small">
          <ItemBadge item={item} /> {base ?? 'Swap places with a ghost'}
        </p>
        {!base &&
          targets.map((t) => (
            <button
              key={t}
              className={`${btn} item-use`}
              disabled={disabled}
              title={itemTooltip(item)}
              onClick={() => send({ type: 'useItem', item, target: t })}
            >
              🔄 Switch with {game.pieces[t].name} · {placeName(game.pieces[t].node, pz)}
            </button>
          ))}
        {base && targets.length === 0 && (
          <button className={`${btn} item-use`} disabled title="No other ghost stands on a different space — the item is kept">
            🔄 Ghost Switch (no target — kept)
          </button>
        )}
      </div>
    );
  }
  const block = itemBlock(game, item);
  const label = item === 'secondRoll' ? `🎲 Use Second Roll (replace your ${game.die})` : '👣 Use Ghostly Stride (6 spaces, no roll)';
  return (
    <div className="item-actions">
      <button className={`${btn} item-use`} disabled={disabled || !!block} title={block ?? itemTooltip(item)} onClick={() => send({ type: 'useItem', item })}>
        {label}
      </button>
      {block && <p className="muted small">{block}</p>}
    </div>
  );
}

/** After an ordinary landing: battle a ghost, challenge the living piece, or end the action. */
export function EncounterChoices({
  game,
  send,
  btn,
  disabled = false,
  primaryRef,
  pz,
}: {
  game: GameState;
  send: (a: Action) => void;
  btn: Btn;
  disabled?: boolean;
  primaryRef?: RefObject<HTMLButtonElement | null>;
  pz: Personalization;
}) {
  const o = game.options;
  if (!o) return null;
  const living = game.pieces[livingPiece(game)];
  const m = curseMultiplier(living.streak);
  const curse = m < 1 ? `${living.name}: ${cursePhrase(m)}` : null;
  const battle = [...o.sameSpace.map((i) => ({ i, versus: false })), ...o.versus.map((i) => ({ i, versus: true }))];
  let first = true;
  const ref = () => {
    if (!first) return undefined;
    first = false;
    return primaryRef;
  };
  return (
    <div className="encounter">
      <p className="prompt big-prompt">Choose one</p>
      {o.living && (
        <div className="enc-group enc-life">
          <div className="enc-kind">❤ {CHALLENGE_LABEL}</div>
          <button ref={ref()} className={`${btn} primary big risky`} disabled={disabled} onClick={() => send({ type: 'hunt' })}>
            Challenge {living.name} 👻
          </button>
          {curse && <p className="muted small">{curse}</p>}
        </div>
      )}
      {battle.length > 0 && (
        <div className="enc-group enc-battle">
          <div className="enc-kind">⚔ {BATTLE_LABEL}</div>
          {battle.map(({ i, versus }) => {
            const p = game.pieces[i];
            return (
              <button
                key={i}
                ref={ref()}
                className={`${btn} battle`}
                disabled={disabled}
                onClick={() => send({ type: 'battle', opponent: i })}
                style={{ ['--pc' as string]: colorOf(p.character) }}
                title={versus ? `From the Versus space: battle any ghost (${placeName(p.node, pz)})` : 'On this space'}
              >
                ⚔ Battle {p.name}
                {p.item && <small> · has {ITEM_INFO[p.item].name}</small>}
              </button>
            );
          })}
        </div>
      )}
      <button ref={ref()} className={btn} disabled={disabled} onClick={() => send({ type: 'declineHunt' })}>
        End turn
      </button>
    </div>
  );
}

/** Keep or replace: the winner already holds a different item. */
export function RewardChoice({
  game,
  send,
  btn,
  canChoose,
  disabled = false,
  primaryRef,
}: {
  game: GameState;
  send: (a: Action) => void;
  btn: Btn;
  canChoose: boolean;
  disabled?: boolean;
  primaryRef?: RefObject<HTMLButtonElement | null>;
}) {
  const pr = game.pendingReward;
  if (!pr) return null;
  const who = game.pieces[pr.piece];
  return (
    <div className="reward">
      <p className="prompt big-prompt">{canChoose ? 'Keep or replace?' : `${who.name}: keep or replace?`}</p>
      <div className="reward-cards">
        <ItemCard item={pr.current} label="Held now" />
        <ItemCard item={pr.offered} label="Just won" fresh />
      </div>
      {canChoose && (
        <div className="row-btns">
          <button ref={primaryRef} className={`${btn} primary`} disabled={disabled} onClick={() => send({ type: 'chooseReward', keep: 'offered' })}>
            Take {ITEM_INFO[pr.offered].name}
          </button>
          <button className={btn} disabled={disabled} onClick={() => send({ type: 'chooseReward', keep: 'current' })}>
            Keep {ITEM_INFO[pr.current].name}
          </button>
        </div>
      )}
    </div>
  );
}

/** The reveal after a ghost battle (shown on the summary). */
export function RewardReveal({ game }: { game: GameState }) {
  const o = game.lastOutcome;
  if (!o?.reward) return null;
  const who = game.pieces[o.winner];
  const held = who.item;
  return (
    <div className="reward-reveal" role="status">
      <ItemCard item={o.reward} label={`${who.name} wins`} fresh />
      {held && held !== o.reward && (
        <p className="small muted">
          {who.name} kept {ITEM_INFO[held].name}.
        </p>
      )}
    </div>
  );
}

/** Who is choosing, when a reward is pending: the winner, maybe out of turn. */
export function rewardDecider(game: GameState): number {
  return game.phase === 'reward' && game.pendingReward ? game.pendingReward.piece : actingPiece(game);
}
