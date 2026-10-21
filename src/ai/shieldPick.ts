// ブレイクするシールドの選び方(docs/effects.md 10.1)。
// 攻撃側は、見分けのつくシールド(EXライフ・表向きのシールド=G城)があれば、どれを割るかを選べる。
// 裏向きのシールドは中身が見えず、どれを割っても同じ扱い(得点 0 を基準にする)。
import { costBase } from '../engine/derive';
import { mkCtx } from '../engine/state';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';

/**
 * 割るシールド1枚の得点の重み(攻撃側から見た得。裏向きのシールド = 0。単位は「相手の手札1枚分」)。
 *
 * - 表向きのシールド(G城): 離れる時は手札に加わらず墓地に置かれる(相手の手札が増えない・S・トリガーも出ない)ので、
 *   裏向きのシールドより必ず得。さらに、その常在型能力(召喚以外で出るクリーチャーをマナにする、など)を止められる。
 *   離れる時に誘発する能力(墓地からの蘇生など)があれば、割ることで相手が得をするので引く。
 * - EXライフのシールド: 割れば、紐づくクリーチャーの身代わりを失わせられる(その後の破壊が通る)。
 *   残せば、そのシールドは相手の除去を受けた時に墓地に置かれ、手札には加わらない。
 */
export interface ShieldPickWeights {
  /** 表向きのシールド: 手札に加わらない分の基礎点 */
  up: number;
  /** 表向きのシールドが常在型能力を1つ持つごとの加点(相手の場の仕掛けを止める) */
  upStatic: number;
  /** 表向きのシールドが離れる時に誘発する能力を持つ時の減点 */
  upLeave: number;
  /** EXライフのシールド: 基礎点 */
  ex: number;
  /** EXライフのシールド: 紐づくクリーチャーのコスト(最大 10)1あたりの加点 */
  exCost: number;
}

/**
 * 既定値。表向きのシールドを先に割る効果は、自己対戦(ルールベース同士、革命5cザーディ・ザーディの全組合せ 12000 局)で
 * 「割らない」より勝率が +2.5 pt(95%区間 +1.6〜+3.4)。EXライフは、割る・残すで勝率の差が誤差の範囲(±1 pt)だったので、
 * 身代わりを奪う側(除去が通るようになる)に、弱く寄せている。
 */
export const SHIELD_W: ShieldPickWeights = { up: 1, upStatic: 0.5, upLeave: 1, ex: 0.5, exCost: 0.05 };

/** 表向きのシールドの能力に、離れる時(シールドゾーンから出る時)に誘発するものがあるか */
function leaveTrigger(reg: Registry, defId: string): boolean {
  const info = reg.getInfo(defId, 0);
  return info.triggers.some((t) => {
    const on = t.ability.spec.on as { type?: string; from?: string; to?: string };
    return on.type === 'moved' && on.to !== 'shield' && (on.from === undefined || on.from === 'shield');
  });
}

/** 割るシールド1枚の得点(`owner` = シールドの持ち主。見分けのつかない裏向きのシールドは 0) */
export function shieldBreakScore(view: GameState, reg: Registry, owner: PlayerId, uid: number, w: ShieldPickWeights = SHIELD_W): number {
  const card = view.cards[uid];
  if (card.up) {
    let v = w.up + w.upStatic * reg.getInfo(card.defId, 0).statics.length;
    if (leaveTrigger(reg, card.defId)) v -= w.upLeave;
    return v;
  }
  if (card.ex) {
    const tied = view.players[owner].battle.find((p) => p.pid === card.exPid);
    const cost = tied ? Math.min(costBase(mkCtx(view, reg), tied.cards[0]), 10) : 0;
    return w.ex + w.exCost * cost;
  }
  return 0;
}

/**
 * ルールベースの、割るシールドの選択。候補(見分けのつく違いごとに1つの合法手)のうち、得点の合計が最も高いもの。
 * 同点なら並びの先頭(裏向きのシールドだけの選び方)。
 */
export function chooseShieldPick(view: GameState, legal: Action[], reg: Registry, w: ShieldPickWeights = SHIELD_W): Action {
  const attacker = view.pending!.player;
  const owner = (1 - attacker) as PlayerId;
  const total = (a: Action) =>
    a.type === 'ANSWER' && Array.isArray(a.value) ? (a.value as number[]).reduce((n, u) => n + shieldBreakScore(view, reg, owner, u, w), 0) : 0;
  let best = legal[0];
  let bs = total(best);
  for (const a of legal) {
    const s = total(a);
    if (s > bs) {
      bs = s;
      best = a;
    }
  }
  return best;
}
