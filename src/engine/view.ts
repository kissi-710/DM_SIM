// PlayerView: 自分から見える情報だけの状態(design 7.1 / 7.3)。
// 隠れたカードの defId は '?' に置き換える。開示の処理はこの関数だけに閉じ込める。
import type { Registry } from './registry';
import { cloneState } from './state';
import type { GameState, PlayerId } from './types';

export type InfoPreset = 'fair' | 'partial' | 'hypothesis' | 'full';

export interface Hypothesis {
  /** 「相手は◯◯を持っているはず」(カードID) */
  defId: string;
  /** 置く場所(既定は手札) */
  zone?: 'hand' | 'shield';
}

export interface InfoPolicy {
  preset: InfoPreset;
  /** 相手のデッキリストを既知にするか */
  knowOpponentDecklist: boolean;
  /** partial: 何を開示するか */
  reveal?: {
    /** 相手の手札のうち、N枚の中身を開示 */
    opponentHandCount?: number;
    /** 手札の「種類」だけ開示(例: 'shieldTrigger' 'blocker' 'creature' 'spell') */
    opponentHandKinds?: string[];
  };
  /** hypothesis: 決め打ち */
  hypotheses?: Hypothesis[];
  /** 仮説のカードを手札に置く確率(0〜1) */
  hypothesisWeight?: number;
}

export const FAIR: InfoPolicy = { preset: 'fair', knowOpponentDecklist: true };
export const FULL: InfoPolicy = { preset: 'full', knowOpponentDecklist: true };

export const INFO_PRESET_LABEL: Record<InfoPreset, string> = {
  fair: '公平(人間と同じ)',
  partial: '部分開示',
  hypothesis: '決め打ち(仮説)',
  full: '全開示',
};

/** カードの「種類」(部分開示用) */
export function kindsOf(reg: Registry, defId: string): string[] {
  const def = reg.defs[defId];
  if (!def) return [];
  const out = new Set<string>();
  def.faces.forEach((f, fi) => {
    out.add(f.type === 'spell' ? 'spell' : 'creature');
    const info = reg.getInfo(defId, fi);
    if (info.shieldTriggers.length > 0) out.add('shieldTrigger');
    if (info.blocker) out.add('blocker');
    if (info.speedAttacker) out.add('speedAttacker');
  });
  return [...out];
}

export function toPlayerView(state: GameState, player: PlayerId, policy: InfoPolicy, reg: Registry): GameState {
  const v = cloneState(state);
  if (policy.preset === 'full') {
    v.hints = { knowOppDeck: true };
    return v;
  }
  const opp = (1 - player) as PlayerId;
  const hide = (uid: number) => {
    v.cards[uid].defId = '?';
  };
  // 自分の隠れた領域(山札・シールドは本人にも見えない)
  for (const u of v.players[player].deck) hide(u);
  for (const u of v.players[player].shield) hide(u);
  // 相手の隠れた領域
  const oppHand = v.players[opp].hand.slice();
  let reveal = 0;
  if (policy.preset === 'partial' && policy.reveal?.opponentHandCount) reveal = policy.reveal.opponentHandCount;
  const hints: NonNullable<GameState['hints']> = { knowOppDeck: policy.knowOpponentDecklist };
  if (policy.preset === 'partial' && policy.reveal?.opponentHandKinds?.length) {
    const kinds: Record<string, number> = {};
    for (const k of policy.reveal.opponentHandKinds) kinds[k] = 0;
    for (const u of oppHand) {
      const ks = kindsOf(reg, state.cards[u].defId);
      for (const k of policy.reveal.opponentHandKinds) if (ks.includes(k)) kinds[k]++;
    }
    hints.oppHandKinds = kinds;
  }
  oppHand.forEach((u, i) => {
    if (i >= reveal) hide(u);
  });
  for (const u of v.players[opp].shield) hide(u);
  for (const u of v.players[opp].deck) hide(u);
  // 自分への質問で提示されたカードは見える(デドダムの上3枚など)
  const p = state.pending;
  if (p && p.player === player && p.input) {
    const inp = p.input;
    // order の candidates は能力のIDなので、カードを指す形式だけを対象にする
    const show: number[] =
      inp.shape === 'pick'
        ? inp.candidates
        : inp.shape === 'assign'
          ? inp.items
          : inp.shape === 'ack'
            ? inp.shown
            : inp.shape === 'option'
              ? (inp.seen ?? [])
              : [];
    for (const u of show) {
      // シールドは裏向きのまま選ぶ(ジャオウガの「3枚残す」など)。選択肢に出ても中身は見えない。
      // ブレイクされたシールド(S・トリガーの宣言)は、持ち主に開く
      if (state.cards[u].zone === 'shield' && !state.breaking.includes(u)) continue;
      v.cards[u].defId = state.cards[u].defId;
    }
  }
  // イベントに残る最後の情報(lki)から、隠れたカードが漏れないようにする
  v.turnLog = v.turnLog.map((e) => {
    if (!('lki' in e)) return e;
    const { lki: _lki, ...rest } = e;
    return rest as typeof e;
  });
  v.rng = 1;
  if (!policy.knowOpponentDecklist) {
    v.deckIds = player === 0 ? [v.deckIds[0], []] : [[], v.deckIds[1]];
  }
  v.hints = hints;
  return v;
}
