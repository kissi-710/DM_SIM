// カード単体の強さ(spec 7.2): デッキから1枚を何もしないカードに入れ替えた時の勝率差で測る。
import { registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { CardDB } from '../engine/types';
import type { AgentSpec } from '../ai';
import { runMatches } from './batch';
import { wilson } from './stats';

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

export function measureCardStrength(
  db: CardDB | Registry,
  o: {
    deck: string[];
    opponent: string[];
    agent: AgentSpec;
    games: number;
    seed: number;
    onProgress?: (done: number, total: number) => void;
  },
): CardStrength[] {
  const reg = registryOf(db);
  const base = runMatches(reg, { deckA: o.deck, deckB: o.opponent, agentA: o.agent, agentB: o.agent, games: o.games, seed: o.seed, first: 'alternate' });
  const ids = [...new Set(o.deck)];
  const out: CardStrength[] = [];
  let k = 0;
  for (const id of ids) {
    const i = o.deck.indexOf(id);
    const alt = o.deck.slice();
    alt[i] = 'dummy';
    const r = runMatches(reg, { deckA: alt, deckB: o.opponent, agentA: o.agent, agentB: o.agent, games: o.games, seed: o.seed, first: 'alternate' });
    const delta = base.winRateA - r.winRateA;
    // 2つの独立な割合の差の概算区間
    const n = o.games;
    const se = Math.sqrt((base.winRateA * (1 - base.winRateA)) / n + (r.winRateA * (1 - r.winRateA)) / n);
    out.push({
      defId: id,
      name: reg.defs[id].name,
      copies: o.deck.filter((x) => x === id).length,
      winRateWithout: r.winRateA,
      winRateBase: base.winRateA,
      delta,
      ci95: [delta - 1.96 * se, delta + 1.96 * se],
    });
    o.onProgress?.(++k, ids.length);
  }
  void wilson;
  return out.sort((a, b) => b.delta - a.delta);
}
