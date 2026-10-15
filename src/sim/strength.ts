// カード単体の強さ(spec 7.2): デッキのカードを差し替えた時の勝率差で測る。2つの方式を並べて出す。
//  - 全枚数×無能力(推奨): そのカードの**全コピー**を、同じコスト・文明の能力なしクリーチャーに替える。
//    マナカーブと文明を保ったまま、カードの能力だけが消える。1〜2枚のパワーカードと、4枚積みの部品を、同じ物差しで比べられる。
//    `perCopy` は 1枚あたり(全枚数の差 ÷ 枚数)。
//  - 1枚×dummy(旧): 最初の1枚だけを、何もしない dummy(唱えられず、マナにしかならない)に替える。
//    枠1つの限界価値で、枚数が少ないカードほど大きく出る。代わりの効くカードも、死に札と比べるので大きく出る。
import { blankFor } from '../engine/blank';
import { registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { CardDB } from '../engine/types';
import type { AgentSpec } from '../ai';
import { runMatches } from './batch';
import { zFamily } from './stats';

/** 1つの方式での、あるカードの強さ */
export interface StrengthEstimate {
  /** そのカードを差し替えた時の勝率(基準デッキ側) */
  winRateWithout: number;
  /** 勝率差(基準 − 差し替えた時)。正ならそのカードは強い */
  delta: number;
  /** 勝率差の95%信頼区間(1つのカードだけを見る時)。基準と変種を独立な標本として扱う概算で、実際は同じシード列で対戦するので、やや保守的(広め) */
  ci95: [number, number];
  /**
   * 全カードを同時に比べるための区間(Bonferroni の補正。全体で95%)。
   * 16〜28種を比べると、1つの95%区間では一部が偶然に0を外れる。順位を読む時はこちらを見る。
   */
  ciFamily: [number, number];
}

export interface CardStrength {
  defId: string;
  name: string;
  copies: number;
  /** 基準デッキの勝率 */
  winRateBase: number;
  /** 全枚数を、同コスト・文明の無能力カードに替えた時(推奨) */
  all: StrengthEstimate & {
    /** 1枚あたりの勝率差(全枚数の差 ÷ 枚数) */
    perCopy: number;
    perCopyCi95: [number, number];
  };
  /** 1枚だけを dummy に替えた時(旧方式)。枚数の少ないカードが大きく出るので、並べて比べる用 */
  one: StrengthEstimate;
}

export interface StrengthOpts {
  deck: string[];
  opponent: string[];
  agent: AgentSpec;
  games: number;
  seed: number;
}

/**
 * 測る対象のカード(デッキ内の種類。出現順)と、それぞれの変種デッキ。
 * one: 最初の1枚を dummy に / all: 全コピーを同コスト・文明の無能力カードに(登録がなければ dummy)
 */
export function strengthVariants(deck: string[], defs: CardDB = {}): { ids: string[]; one: string[][]; all: string[][] } {
  const ids = [...new Set(deck)];
  const one = ids.map((id) => {
    const alt = deck.slice();
    alt[deck.indexOf(id)] = 'dummy';
    return alt;
  });
  const all = ids.map((id) => {
    const to = blankFor(defs, id);
    return deck.map((x) => (x === id ? to : x));
  });
  return { ids, one, all };
}

/** 対戦させるデッキの並び: 基準、one の各変種、all の各変種(ジョブの分割・統合・測定で共通) */
export function strengthDecks(deck: string[], defs: CardDB = {}): string[][] {
  const v = strengthVariants(deck, defs);
  return [deck, ...v.one, ...v.all];
}

function estimate(baseRate: number, r: number, n: number, zf: number): StrengthEstimate {
  const delta = baseRate - r;
  // 2つの独立な割合の差の概算区間
  const se = Math.sqrt((baseRate * (1 - baseRate)) / n + (r * (1 - r)) / n);
  return { winRateWithout: r, delta, ci95: [delta - 1.96 * se, delta + 1.96 * se], ciFamily: [delta - zf * se, delta + zf * se] };
}

/** 基準デッキと各変種の勝率(A側)から、カードごとの強さを組み立てる。rates は strengthDecks の並び(基準を除く: one → all) */
export function composeStrength(reg: Pick<Registry, 'defs'>, o: Pick<StrengthOpts, 'deck' | 'games'>, baseRate: number, rates: number[]): CardStrength[] {
  const { ids } = strengthVariants(o.deck);
  const k = ids.length;
  const n = o.games;
  const zf = zFamily(k);
  const out = ids.map((id, i): CardStrength => {
    const copies = o.deck.filter((x) => x === id).length;
    const all = estimate(baseRate, rates[k + i], n, zf);
    return {
      defId: id,
      name: reg.defs[id].name,
      copies,
      winRateBase: baseRate,
      all: { ...all, perCopy: all.delta / copies, perCopyCi95: [all.ci95[0] / copies, all.ci95[1] / copies] },
      one: estimate(baseRate, rates[i], n, zf),
    };
  });
  // 並びは、推奨の方式(全枚数×無能力)の勝率差の降順
  return out.sort((a, b) => b.all.delta - a.all.delta);
}

export function measureCardStrength(db: CardDB | Registry, o: StrengthOpts & { onProgress?: (done: number, total: number) => void }): CardStrength[] {
  const reg = registryOf(db);
  const run = (deckA: string[]) =>
    runMatches(reg, { deckA, deckB: o.opponent, agentA: o.agent, agentB: o.agent, games: o.games, seed: o.seed, first: 'alternate' }).winRateA;
  const [base, ...variants] = strengthDecks(o.deck, reg.defs);
  const baseRate = run(base);
  const rates: number[] = [];
  for (const d of variants) {
    rates.push(run(d));
    o.onProgress?.(rates.length, variants.length);
  }
  return composeStrength(reg, o, baseRate, rates);
}
