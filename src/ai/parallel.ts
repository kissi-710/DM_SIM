// MCTS の並列な意思決定。ラウンドの評価(別の Worker など)は dispatch が受け持ち、ここは計画と統合だけを行う。
// 結果は、並列数・分け方によらず逐次の decide と同じになる(mcts.ts の runSearchParallel)。
import { legalActions, registryOf } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, CardDB } from '../engine/types';
import { FAIR, toPlayerView } from '../engine/view';
import { mulberry } from '../sim/playGame';
import { decide, type DecideReq } from './decide';
import { planSearch, runSearchParallel, type RoundDispatch, type SearchEnv, type SearchInfo } from './mcts';
import { makeRuleBased } from './rulebased';

/** 並列に探索できる要求か(モンテカルロで、選択肢が2つ以上) */
export function canParallelize(db: CardDB | Registry, req: DecideReq): boolean {
  if (req.spec.kind !== 'mcts' || !req.state.pending) return false;
  return legalActions(req.state, registryOf(db)).length > 1;
}

/**
 * 並列に決める。begin は、探索の入力(env)を評価側に渡す(Worker に1度だけ送るため)。
 * 並列にできない要求は、そのまま decide で決める。
 */
export async function decideParallel(
  db: CardDB | Registry,
  req: DecideReq,
  io: { begin: (env: SearchEnv) => void; dispatch: RoundDispatch; parallelism: number; onSearch?: (i: SearchInfo) => void },
): Promise<Action> {
  const reg = registryOf(db);
  if (!canParallelize(reg, req)) return decide(reg, req);
  const s = req.state;
  const legal = legalActions(s, reg);
  const policy = req.spec.policy ?? FAIR;
  const view = toPlayerView(s, s.pending!.player, policy, reg);
  const l1 = makeRuleBased({ policy, candidateDecks: req.spec.candidateDecks });
  const plan = planSearch(
    view,
    legal,
    { rand: mulberry(req.seed), reg, budget: req.budget },
    { policy, iterations: req.spec.iterations, ms: req.spec.ms, candidateDecks: req.spec.candidateDecks, ...req.spec.tuning },
    l1,
  );
  io.begin(plan.env);
  return runSearchParallel(plan, io.dispatch, io.parallelism, io.onSearch);
}

/**
 * 複数の評価器(Worker など)に、ラウンドを小さな塊で渡して並列に評価する。空いた評価器から順に次の塊を取るので、
 * 重いラウンドに当たった評価器がいても、全体が待たされにくい。結果は元の順に並べて返す。
 */
export function poolDispatch(runners: RoundDispatch[], chunk = 2): RoundDispatch {
  return async (seeds, alive) => {
    const n = Math.ceil(seeds.length / chunk);
    const parts: number[][][] = new Array(n);
    let next = 0;
    await Promise.all(
      runners.map(async (run) => {
        while (next < n) {
          const c = next++;
          parts[c] = await run(seeds.slice(c * chunk, (c + 1) * chunk), alive);
        }
      }),
    );
    return parts.flat();
  };
}
