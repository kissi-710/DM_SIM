// 回帰の固定値(ゴールデン): シードを固定した対戦・調査の結果を記録しておき、
// 高速化などの「挙動を変えない変更」で結果が1つも変わっていないことを確かめる。
// ルール・AI・カードを意図して変えた時だけ、この値を更新する。
import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { makeAgent, type AgentSpec } from '../../src/ai';
import { loadRegistry } from '../../src/engine/registry';
import { runMatches } from '../../src/sim/batch';
import { playGameSync } from '../../src/sim/playGame';
import { runPatterns, runProbability } from '../../src/sim/solitaire';
import type { Goal } from '../../src/sim/goal';

const reg = loadRegistry(CARD_DB);
const A = deckCards('maruru');
const B = deckCards('zardy');

const hash = (s: string) => {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
};

const match = (a: AgentSpec, b: AgentSpec, games: number, seed: number) => {
  const r = runMatches(reg, { deckA: A, deckB: B, agentA: a, agentB: b, games, seed });
  return { winsA: r.winsA, winsB: r.winsB, draws: r.draws, avgTurns: r.avgTurns, reasons: r.reasons };
};

const goal: Goal = { op: 'pred', timing: { turn: 6, at: 'byTurn' }, pred: { kind: 'zoneHas', zone: 'battle', card: { names: ['ヨビニオン・マルル'] } } };

describe('ゴールデン(シード固定の結果が変わらない)', () => {
  it('バッチ対戦: ランダム同士 60試合', () => {
    expect(match({ kind: 'random' }, { kind: 'random' }, 60, 1)).toEqual({
      // ジャオウガの身代わりをバトルゾーンのカードだけにした(公式 Q&A 41461)ので、山札切れが 15 → 13 に
      // 手札で誘発する侵略・革命チェンジを、解決の前にまとめて使用宣言するようにした(総合ルール 506.3b)ので、1試合が変わった
      // 侵略が自分自身の攻撃では誘発しなくなった(空振りの質問が消え、ランダムの選択が変わった)
      // 任意効果(使っても何も起きない・「使うか + 対象」の1問・同名は聞かない)で質問が減り、ランダムの選択が変わった
      winsA: 40,
      winsB: 20,
      draws: 0,
      // ブロッカーを複数体同時に選べるようにした(507.1a)ので、ランダムの選択が変わった(1試合)
      // バッチのターン数を、エンジンの手番(片道)から往復(対戦画面の「N ターン目」)に改めた(旧 23.23)
      avgTurns: 11.883333333333333,
      // ブレイクするシールドを攻撃側が選べるようにした(EXライフ・表向きのシールドがある時に質問する)ので、ランダムの選択が変わった(山札切れの1試合が、ダイレクトアタックに)
      reasons: { ダイレクトアタック: 44, 山札切れ: 16 },
    });
  });
  it('バッチ対戦: ルールベース同士 60試合', () => {
    expect(match({ kind: 'rule' }, { kind: 'rule' }, 60, 1)).toEqual({
      // ワクムテラスのパワーを公式の 4000 に訂正・ジャオウガの身代わりをバトルゾーンのカードだけに・
      // 呪文の空振り判定を、説明文の正規表現からカードのデータに(各1〜2試合が変わった)・
      // シールドを選ぶ質問で候補の中身を見せない(ジャオウガの「3枚残す」で、AI が自分のシールドを見られなくなった。1試合が変わった)
      // ルールベースの相打ち攻撃・効果の選択のマナの重みを変えた時に更新した固定値(docs/ai-quality-plan.md §10)
      // 侵略・革命チェンジの使用宣言を解決の前にした(506.3b)・勝ち確定の判定を直した(最後の1体を残す・ブロックされない攻撃)ので、1試合が変わった
      // 侵略が自分自身の攻撃では誘発しなくなったので、1試合が変わった
      // ブロッカーを複数体同時に選べるようにした(507.1a。AI は1体を選ぶ)ので、1試合が変わった
      // 任意効果の質問を整理した(勝敗が1試合変わり、その1試合が山札切れに)
      // ヨビニオンで山札の下に戻した札を、決定化(推論)に使うようにした(山札切れの1試合が、ダイレクトアタックになった)
      winsA: 50,
      winsB: 10,
      draws: 0,
      avgTurns: 6, // 旧 11.47(片道)
      reasons: { ダイレクトアタック: 60 },
    });
  });
  // 探索の既定を、根はペア比較・2手目以降は木(ptree。docs/ai-quality-plan.md §6.4)にした時と、
  // 報酬を軌跡平均(traj=1。§8)にした時に更新した固定値
  it('バッチ対戦: MCTS(20反復) 対 ルールベース 6試合', () => {
    expect(match({ kind: 'mcts', iterations: 20, ms: 100000 }, { kind: 'rule' }, 6, 1)).toEqual({
      winsA: 6,
      winsB: 0,
      draws: 0,
      avgTurns: 7, // 数え方を往復に改めた(旧 13.5 は片道)。// ブレイクするシールドを選べるようにした(20反復の6試合なので、1試合が変わっただけ)
      reasons: { ダイレクトアタック: 6 },
    });
  });
  it('1試合の全手順・最終状態(ルールベース / ランダム)', () => {
    const play = (kind: 'rule' | 'random', seed: number) => {
      const r = playGameSync(reg, [makeAgent({ kind }), makeAgent({ kind })], { decks: [A, B], seed });
      return [r.actions.length, hash(JSON.stringify(r.actions)), r.winner, r.turns, r.state.seq, r.state.rng, hash(JSON.stringify(r.state.cards))];
    };
    // 山札の下の公開札の推論(ヨビニオン)で、ルールベースの選択が変わった
    expect(play('rule', 5)).toEqual([42, 2496869643, 0, 11, 250, -1527012423, 2283302843]);
    expect(play('random', 9)).toEqual([96, 1448277335, 0, 25, 467, 1504283537, 3871052353]);
  });
  it('確率調査: 方針プレイと探索(40試行)', () => {
    const r = runProbability(reg, { deck: A, first: 0, goal, trials: 40, seed: 1, maxNodes: 3000 });
    // 方針プレイの AI が山札の下の公開札(ヨビニオン)を推論に使うようになり、1試行が変わった(13 → 12)。探索(全探索)は変わらない
    expect(r.policy.achieved).toBe(12);
    expect(r.policy.byTurn).toEqual([0, 0, 0, 0.075, 0.25, 0.275, 0.3]);
    // 限定食い違い探索 + 目標までの距離の順序づけ(旧: 到達 16 / 不明 24 / 平均 2000 ノード)。
    // 予算の 2/3 を LDS に、残りを 1 回の全探索に使う(到達不可の確定を速くする。到達 32 / 不明 8 → 31 / 9)
    expect(r.search?.achieved).toBe(31);
    expect(r.search?.unknown).toBe(9);
    expect(r.search?.avgNodes).toBe(844.175); // 任意効果の質問を整理した(旧 855.15。到達・不明は同じ)
  });
  it('パターン調査(12試行)', () => {
    const r = runPatterns(reg, { deck: A, first: 0, goal, trials: 12, seed: 1, maxNodes: 3000 }, { granularity: 'set', maxHistoriesPerTrial: 2 });
    // 旧: パターン 6 / 達成 5 / 不明 7
    expect([r.patterns.length, r.achievedTrials, r.unknownTrials]).toEqual([16, 11, 1]); // 任意効果の質問を整理した(旧 17。達成・不明は同じ)
    expect(hash(JSON.stringify(r.patterns.map((x) => [x.key, x.count, x.sampleSeed])))).toBe(1739197345);
  });
});
