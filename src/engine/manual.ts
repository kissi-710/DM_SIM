// 手動操作(一人回し)用の下請け: ルール判定や効果処理を行わず、カードを自由に動かす。
// 原始操作(move)をそのまま使うので、対戦エンジンと同じ状態・イベントの形で扱える(reference_duel-hub 5-3)。
import { moveCards, setTapped } from './ops';
import { registryOf } from './engine';
import type { Registry } from './registry';
import { cloneState, mkCtx } from './state';
import type { CardDB, Ev, GameState, PlayerId, ZoneName } from './types';

export interface ManualMoveOpts {
  pos?: 'top' | 'bottom';
  tapped?: boolean;
  /** 進化先の山 */
  onto?: number;
}

function finish(s: GameState): GameState {
  // 待機中の能力や実行中のフレームは使わない(手動で処理する)
  s.pool = [];
  s.dirtySba = false;
  return s;
}

export function manualMove(db: CardDB | Registry, state: GameState, uid: number, to: ZoneName, opts: ManualMoveOpts = {}): { state: GameState; events: Ev[] } {
  const reg = registryOf(db);
  const s = cloneState(state);
  const c = mkCtx(s, reg);
  moveCards(c, [uid], { to, cause: 'manual', via: 'manual', pos: opts.pos, tapped: opts.tapped, onto: opts.onto, noReplace: true });
  return { state: finish(s), events: c.out };
}

export function manualToggleTap(db: CardDB | Registry, state: GameState, uid: number): { state: GameState; events: Ev[] } {
  const reg = registryOf(db);
  const s = cloneState(state);
  const c = mkCtx(s, reg);
  const card = s.cards[uid];
  const cur = card.zone === 'battle' ? (s.players[card.owner].battle.find((p) => p.pid === card.pid)?.tapped ?? false) : card.tapped;
  setTapped(c, uid, !cur);
  return { state: finish(s), events: c.out };
}

export function manualUntapAll(state: GameState, player: PlayerId, zone: 'mana' | 'battle' | 'all'): GameState {
  const s = cloneState(state);
  if (zone === 'mana' || zone === 'all') for (const u of s.players[player].mana) s.cards[u].tapped = false;
  if (zone === 'battle' || zone === 'all') for (const p of s.players[player].battle) p.tapped = false;
  return finish(s);
}

export function manualDraw(db: CardDB | Registry, state: GameState, player: PlayerId, n = 1): { state: GameState; events: Ev[] } {
  const reg = registryOf(db);
  const s = cloneState(state);
  const c = mkCtx(s, reg);
  for (let i = 0; i < n; i++) {
    const top = s.players[player].deck[0];
    if (top === undefined) break;
    moveCards(c, [top], { to: 'hand', cause: 'draw', noReplace: true });
  }
  return { state: finish(s), events: c.out };
}

/** 次のターン: アンタップ・召喚酔いの解除・1枚ドロー */
export function manualNextTurn(db: CardDB | Registry, state: GameState, player: PlayerId, draw = true): { state: GameState; events: Ev[] } {
  const s0 = manualUntapAll(state, player, 'all');
  for (const p of s0.players[player].battle) p.sick = false;
  s0.turn += 1;
  return draw ? manualDraw(db, s0, player, 1) : { state: s0, events: [] };
}

export function manualShuffle(state: GameState, player: PlayerId, seed: number): GameState {
  const s = cloneState(state);
  const deck = s.players[player].deck;
  let r = (seed | 0) || 1;
  for (let i = deck.length - 1; i > 0; i--) {
    r = (Math.imul(r, 1664525) + 1013904223) | 0;
    const j = Math.abs(r) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return finish(s);
}
