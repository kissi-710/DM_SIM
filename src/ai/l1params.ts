// L1 ルールベースAIの調整値(docs/ai-quality-plan.md §7)。
// 手書きの優先度・しきい値を1か所に集め、自己対戦(sim の複製対局)で調整できるようにする。
// 既定値は rust/src/ai.rs の L1Params::default と同じにする(プレイアウトの方針が TS と Rust でずれないように)。

export interface L1Params {
  // ── マナチャージ(小さいほど置きたい) ──
  /** マナがこの枚数以上で、手札を全部払えるなら、マナチャージをしない */
  skipManaFrom: number;
  /** コストが「マナ + 2」以内のカードの基礎点(それより重いカードの基礎点は keepFar) */
  keepNear: number;
  keepFar: number;
  /** コスト1あたりの減点 */
  keepCost: number;
  /** 今でも使えるカード(コスト ≤ マナ)の補正 */
  keepCastable: number;
  /** S・トリガーを持つカードの補正 */
  keepTrigger: number;
  /** 手札の他のカードが必要とする文明 / マナにまだ無い文明 の補正 */
  keepCivNeed: number;
  keepCivNew: number;
  /** 同じカードが複数ある時の補正 */
  keepDup: number;
  /** 呪文 / クリーチャー の補正 */
  keepSpell: number;
  keepCreature: number;

  // ── 召喚・詠唱(大きいほど先に出す) ──
  /** 払うマナ(文明数を考慮)の係数 */
  playNeed: number;
  /** コスト軽減(基本コスト − 実コスト)の係数 */
  playDiscount: number;
  /** 盤面に残るもの(呪文以外)の加点 */
  playBoard: number;
  /** タップして払う1体あたりの減点 */
  playTap: number;
  /** 墓地・マナから出す時の加点 */
  playFromOther: number;
  /** 相手の盤面が空の時の、対象を取る呪文の減点 */
  playNoTarget: number;

  // ── 攻撃 ──
  /** 自分のシールドがこの枚数以下なら、ブロッカーは攻撃に出さず残す */
  keepBlockerShield: number;
  /** プレイヤー攻撃: 相手にブロッカーが無い時の基礎点(+ ブレイク数) */
  atkOpen: number;
  /** プレイヤー攻撃: ブロッカーはいるが、全員よりパワーが大きい時の基礎点(+ ブレイク数) */
  atkOverBlock: number;
  /** プレイヤー攻撃: 相手のシールドが0で、ブロッカーを引きつける時の点 */
  atkBait: number;
  /** クリーチャー攻撃: 勝てる相手の基礎点(+ コスト + パワー/2000) */
  atkCreature: number;
  /** クリーチャー攻撃: 自分がブロッカーの時の減点 */
  atkCreatureBlockerPenalty: number;

  /** クリーチャー攻撃: 相打ち(パワー同値)でも、相手のコスト − 自分のコスト がこの値以上なら攻撃する(99 で相打ちは攻撃しない) */
  atkTrade: number;

  // ── 効果の選択(1手先読み) ──
  /** 1手先の評価で使うマナの重み(探索の既定 3.5 と、旧 L1 の 1.1 の間。docs/ai-quality-plan.md §10) */
  ansMana: number;

  // ── カードごとの補正(defId → 値。無いカードは 0。自己対戦・探索の手から学習する: cli/trainL1.ts) ──
  /** マナチャージの優先度への加算(正なら、マナに置かずに手札に残したい) */
  cardKeep: Record<string, number>;
  /** 召喚・詠唱の点への加算(正なら、先に出したい) */
  cardPlay: Record<string, number>;
}

export const L1_DEFAULT: L1Params = {
  skipManaFrom: 7,
  keepNear: 4.5,
  keepFar: 3,
  keepCost: 0.15,
  keepCastable: -0.5,
  keepTrigger: -2,
  keepCivNeed: -3,
  keepCivNew: -1,
  keepDup: -1,
  keepSpell: -1,
  keepCreature: 1,
  playNeed: 1,
  playDiscount: 0.4,
  playBoard: 1.5,
  playTap: -0.8,
  playFromOther: 0.5,
  playNoTarget: -3,
  keepBlockerShield: 3,
  atkOpen: 20,
  atkOverBlock: 12,
  atkBait: 8,
  atkCreature: 30,
  atkCreatureBlockerPenalty: 8,
  atkTrade: 0,
  ansMana: 2.5,
  cardKeep: {},
  cardPlay: {},
};

export const withL1 = (p?: Partial<L1Params>): L1Params => (p ? { ...L1_DEFAULT, ...p } : L1_DEFAULT);
