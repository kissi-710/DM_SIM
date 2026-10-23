// PlayerView: 自分から見える情報だけの状態(design 7.1 / 7.3)。
// 隠れたカードの defId は '?' に置き換える。開示の処理はこの関数だけに閉じ込める。
import type { Registry } from './registry';
import { activeStatics } from './derive';
import { cloneState, mkCtx } from './state';
import type { DeckGroupHint, Ev, GameState, PlayerId } from './types';

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
    /** 情報の価値を測る実験用: 相手のシールド/山札、自分のシールド/山札を開示する */
    opponentShield?: boolean;
    opponentDeck?: boolean;
    ownShield?: boolean;
    ownDeck?: boolean;
  };
  /** hypothesis: 決め打ち */
  hypotheses?: Hypothesis[];
  /** 仮説のカードを手札に置く確率(0〜1) */
  hypothesisWeight?: number;
  /** 公開されて山札の下に戻った札(ヨビニオンなど)の位置を推論に使うか。既定は true。false なら昔と同じ(測定の比較用) */
  inferRevealed?: boolean;
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
    out.add(f.type === 'spell' ? 'spell' : f.type === 'castle' ? 'castle' : 'creature');
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
  const rv = policy.preset === 'partial' ? policy.reveal : undefined;
  if (!rv?.ownDeck) for (const u of v.players[player].deck) hide(u);
  // 自分のターン中、山札の上から1枚をいつでも見てもよい(オロチリュウセイ)
  const top = state.players[player].deck[0];
  if (top !== undefined && v.cards[top].defId === '?' && state.active === player && activeStatics(mkCtx(state, reg), 'peekDeckTop').some((st) => st.controller === player)) {
    v.cards[top].defId = state.cards[top].defId;
  }
  // 表向きのシールドは、見える(重なって置かれたシールドの下のカードは、裏向きなので隠す)
  const underShield = Object.values(v.piles ?? {}).flat();
  if (!rv?.ownShield) for (const u of v.players[player].shield) if (!v.cards[u].up) hide(u);
  if (!rv?.ownShield) for (const u of underShield) if (v.cards[u].owner === player && !v.cards[u].up) hide(u);
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
  if (!rv?.opponentShield) for (const u of v.players[opp].shield) if (!v.cards[u].up) hide(u);
  if (!rv?.opponentShield) for (const u of underShield) if (v.cards[u].owner === opp && !v.cards[u].up) hide(u);
  if (!rv?.opponentDeck) for (const u of v.players[opp].deck) hide(u);
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
  // イベントに残る最後の情報(lki)・誘発した能力の持ち主(ability.defId)から、隠れたカードが漏れないようにする。
  // 入れ子のイベント(abilityTriggered の cause)にも lki があるので、再帰的に洗う。イベントは共有されるので、書き換えずに作り直す
  const hidden = (uid: unknown) => typeof uid === 'number' && v.cards[uid]?.defId === '?';
  const scrub = (e: Ev): Ev => {
    const { lki: _lki, ...rest } = e;
    const out: Ev = rest;
    if (out.cause && typeof out.cause === 'object') out.cause = scrub(out.cause as Ev);
    if (out.ability && typeof out.ability === 'object' && hidden(out.source)) out.ability = { ...(out.ability as object), defId: '?' };
    return out;
  };
  v.turnLog = v.turnLog.map(scrub);
  // 待機プール: 見えない持ち主(手札など)の、使用を宣言していない「してもよい」の能力は、相手には伏せる(手札に何があるかが漏れる)。
  // 宣言済みのもの・S・トリガー・G・ストライクは、公開されている情報なので残す
  v.pool = v.pool
    .filter((e) => !(e.kind === 'ability' && !e.declared && hidden(e.source.uid)))
    .map((e) => (e.event ? { ...e, event: scrub(e.event) } : e));
  v.rng = 1;
  if (!policy.knowOpponentDecklist) {
    v.deckIds = player === 0 ? [v.deckIds[0], []] : [[], v.deckIds[1]];
  }
  if (policy.inferRevealed !== false) {
    const dk = deckKnownHints(state, player);
    if (dk) hints.deckKnown = dk;
  }
  // 視点側に knownDeck そのものは渡さない(中身は hints.deckKnown に、並びを伏せて入れる)
  delete v.knownDeck;
  v.hints = hints;
  return v;
}

/**
 * 山札の中で中身が公開されたまとまりを、視点に渡す形にする。
 * - 並び順は渡さない(uid は昇順、中身は defId 順)。シャッフル済みなので、実際にも誰も知らない
 * - まとまりの一部が山札を離れた場合、持ち主には残りが分かる(離れた札も本人は見ている)。
 *   相手には「どれが離れたか」が分からないので、崩れたまとまりは渡さない
 */
function deckKnownHints(state: GameState, viewer: PlayerId): [DeckGroupHint[], DeckGroupHint[]] | undefined {
  const kd = state.knownDeck;
  if (!kd) return undefined;
  const out: [DeckGroupHint[], DeckGroupHint[]] = [[], []];
  for (const p of [0, 1] as PlayerId[]) {
    for (const g of kd[p]) {
      const live = g.filter((e) => {
        const c = state.cards[e.uid];
        return c.zone === 'deck' && c.owner === p && c.ep === e.ep;
      });
      if (live.length === 0 || (viewer !== p && live.length !== g.length)) continue;
      const uids = live.map((e) => e.uid).sort((a, b) => a - b);
      const defIds = live.map((e) => state.cards[e.uid].defId).sort();
      out[p].push({ uids, defIds });
    }
  }
  return out[0].length || out[1].length ? out : undefined;
}
