// カード単体の強さ(spec 7.2): デッキから1枚を何もしないカードに入れ替えた時の勝率差で測る。
import { registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { CardDB } from '../engine/types';
import type { AgentSpec } from '../ai';
import { runMatches } from './batch';

export interface CardStrength {
  defId: string;
  name: string;
  copies: number;
  /** そのカードを1枚抜いた時の勝率(基準デッキ側) */
  winRateWithout: number;
  /** 基準デッキの勝率 */
  winRateBase: number;
  /** 勝率差(基準 − 抜いた時)。正ならそのカードは強い */
  delta: number;
  ci95: [number, number];
}

export interface StrengthOpts {
  deck: string[];
  opponent: string[];
  agent: AgentSpec;
  games: number;
  seed: number;
}

/** 測る対象のカード(デッキ内の種類。出現順)と、それぞれを1枚 dummy に替えたデッキ */
export function strengthVariants(deck: string[]): { ids: string[]; decks: string[][] } {
  const ids = [...new Set(deck)];
  const decks = ids.map((id) => {
    const alt = deck.slice();
    alt[deck.indexOf(id)] = 'dummy';
    return alt;
  });
  return { ids, decks };
}

/** 基準デッキと各変種の勝率(A側)から、カードごとの強さを組み立てる */
export function composeStrength(reg: Pick<Registry, 'defs'>, o: Pick<StrengthOpts, 'deck' | 'games'>, baseRate: number, rates: number[]): CardStrength[] {
  const { ids } = strengthVariants(o.deck);
  const n = o.games;
  const out = ids.map((id, k): CardStrength => {
    const r = rates[k];
    const delta = baseRate - r;
    // 2つの独立な割合の差の概算区間
    const se = Math.sqrt((baseRate * (1 - baseRate)) / n + (r * (1 - r)) / n);
    return {
      defId: id,
      name: reg.defs[id].name,
      copies: o.deck.filter((x) => x === id).length,
      winRateWithout: r,
      winRateBase: baseRate,
      delta,
      ci95: [delta - 1.96 * se, delta + 1.96 * se],
    };
  });
  return out.sort((a, b) => b.delta - a.delta);
}

export function measureCardStrength(db: CardDB | Registry, o: StrengthOpts & { onProgress?: (done: number, total: number) => void }): CardStrength[] {
  const reg = registryOf(db);
  const run = (deckA: string[]) =>
    runMatches(reg, { deckA, deckB: o.opponent, agentA: o.agent, agentB: o.agent, games: o.games, seed: o.seed, first: 'alternate' }).winRateA;
  const base = run(o.deck);
  const { decks } = strengthVariants(o.deck);
  const rates: number[] = [];
  for (const d of decks) {
    rates.push(run(d));
    o.onProgress?.(rates.length, decks.length);
  }
  return composeStrength(reg, o, base, rates);
}
