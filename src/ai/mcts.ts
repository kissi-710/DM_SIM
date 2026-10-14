// L2 モンテカルロ探索AI(design 7.2・7.3)。
// 決定化(隠れたカードの割り当て)+ プレイアウトを繰り返し、各合法手の平均報酬で選ぶ。
// プレイアウトの方針は L1(ルールベース)の手順を使い、L1 の手を事前の候補として扱う
// (方針改善型: L1 より悪い手に動かないようにする)。
// 計算量: ms は「最大の思考時間」。iterations を指定した時はそれも上限になる(再現性が必要なバッチ・テスト用)。
// ms だけを指定した時(CPU戦)は、時間いっぱいまで反復する。ただし、手の優劣がはっきりした時点で早めに打ち切る。
import { legalActions, step } from '../engine/engine';
import type { Registry } from '../engine/registry';
import type { Action, GameState, PlayerId } from '../engine/types';
import { FAIR, type InfoPolicy } from '../engine/view';
import { determinize } from './determinize';
import { reward } from './eval';
import { chooseTurnAction, makeRuleBased } from './rulebased';
import type { Agent, AgentCtx } from './types';

export interface MctsOpts {
  policy?: InfoPolicy;
  candidateDecks?: string[][];
  /** 反復回数の上限。指定しなければ時間(ms)だけで打ち切る */
  iterations?: number;
  /** 最大の思考時間(ms) */
  ms?: number;
  /** プレイアウトを何ターン先で打ち切るか */
  horizonTurns?: number;
  /** L1 の手に与える事前の上乗せ(報酬の単位) */
  priorBonus?: number;
  /** 1回の探索が終わるたびに呼ばれる(計測・表示用) */
  onSearch?: (info: { iterations: number; ms: number; timeDriven: boolean; decided: boolean; arms: number; rounds?: number; errors?: number }) => void;
}

/** プレイアウト用の素早い方針: ターン中の行動は L1 の手順、効果の選択は軽い規則 */
export function rolloutPick(s: GameState, legal: Action[], reg: Registry, rand: () => number): Action {
  const p = s.pending!;
  if (p.why === 'turnAction') return chooseTurnAction(s, legal, { reg, rand });
  const pick = (arr: Action[]) => arr[Math.floor(rand() * arr.length)];
  switch (p.why) {
    case 'triggerDeclare': {
      // S・トリガーは宣言できるだけ宣言する
      let best = legal[0];
      let bl = -1;
      for (const a of legal) {
        const n = a.type === 'ANSWER' && Array.isArray(a.value) ? a.value.length : 0;
        if (n > bl) {
          bl = n;
          best = a;
        }
      }
      return best;
    }
    case 'may': {
      const yes = legal.find((a) => a.type === 'ANSWER' && a.value === true);
      return yes && rand() < 0.75 ? yes : pick(legal);
    }
    case 'block': {
      // 半分はブロックする
      const blocks = legal.filter((a) => a.type === 'ANSWER' && Array.isArray(a.value) && a.value.length > 0);
      return blocks.length && rand() < 0.5 ? pick(blocks) : legal[0];
    }
    default:
      return pick(legal);
  }
}

/** 時間主導の探索で、反復(プレイアウト)の絶対上限(無限ループ防止) */
const HARD_MAX_ITERATIONS = 100000;
/** 手の比較に必要な最低ラウンド数(これ未満では判定しない) */
const MIN_ROUNDS = 8;

/**
 * 同じ世界で比べた報酬の差 d(先頭 − 相手)の統計から、勝負がついたかを判定する。
 * ahead: 差が誤差(約2.5σ)より大きい / precise: 差は判定できないが、これ以上反復しても精度は変わらない(2.5σ < 1.2pt) / open: まだ分からない。
 * 手ごとに別の世界を引くと、手の差より世界のばらつきが大きくなる。同じ世界・同じ乱数で比べる(ペア比較)と、その分が打ち消される。
 */
export function pairedVerdict(n: number, dsum: number, dsq: number, bonusGap: number): 'ahead' | 'precise' | 'open' {
  if (n < MIN_ROUNDS) return 'open';
  const mean = dsum / n;
  const se = Math.sqrt(Math.max(0.0025, dsq / n - mean * mean) / n);
  if (mean + bonusGap > 2.5 * se) return 'ahead';
  if (2.5 * se < 0.012) return 'precise';
  return 'open';
}

/** プレイアウトの乱数(1ラウンド内の全候補手で同じ列にするため、シードから作る) */
function seededRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollout(start: GameState, reg: Registry, me: PlayerId, rand: () => number, horizon: number): number {
  let s = start;
  const endTurn = s.turn + horizon;
  let guard = 0;
  while (s.winner === null && s.turn < endTurn && guard++ < 400) {
    const legal = legalActions(s, reg);
    if (legal.length === 0) break;
    const a = rolloutPick(s, legal, reg, rand);
    s = step(s, a, reg).state;
  }
  return reward(s, reg, me);
}

export function makeMcts(o: MctsOpts = {}): Agent {
  const policy = o.policy ?? FAIR;
  const l1 = makeRuleBased({ policy, candidateDecks: o.candidateDecks });
  return {
    name: 'モンテカルロ',
    policy,
    chooseAction(view, legal, ctx: AgentCtx) {
      if (legal.length === 1) return legal[0];
      const reg = ctx.reg;
      const me = view.pending!.player;
      let iterations = ctx.budget?.iterations ?? o.iterations;
      let ms = ctx.budget?.ms ?? o.ms;
      // どちらも未指定なら、再現できる既定(120反復)。ms だけなら時間主導(反復の上限なし)
      if (iterations === undefined && ms === undefined) iterations = 120;
      const timeDriven = iterations === undefined;
      // 反復回数だけを指定した時は、時間では打ち切らない(マシンの速さ・負荷に結果が左右されない)
      if (ms === undefined) ms = timeDriven ? 1500 : Infinity;
      const horizon = o.horizonTurns ?? 3;
      const prior = o.priorBonus ?? 0.08;
      const t0 = Date.now();
      const n = legal.length;

      // L1 が選ぶ手(事前の候補)
      const baseAct = l1.chooseAction(view, legal, ctx) as Action;
      let baseIdx = legal.findIndex((a) => JSON.stringify(a) === JSON.stringify(baseAct));
      if (baseIdx < 0) baseIdx = 0;
      const bonus = new Array(n).fill(0);
      bonus[baseIdx] = prior;

      // ペア比較: 1ラウンドで1つの世界(決定化)を作り、残っている全候補手を同じ世界・同じ乱数で評価する。
      // 手の差が世界のばらつきに埋もれず、同じ反復数でも手の優劣が分かりやすい。
      // 明らかに劣る手は途中で外し、残りの反復を有力な手に回す。残った手は全ラウンドで評価されているので、平均を公平に比べられる。
      const sum = new Array(n).fill(0);
      const sq = new Array(n).fill(0);
      const cross = Array.from({ length: n }, () => new Array(n).fill(0)); // cross[i][j] = Σ r_i * r_j
      let alive: number[] = Array.from({ length: n }, (_, i) => i);
      const maxIt = timeDriven ? HARD_MAX_ITERATIONS : Math.max(iterations!, n);
      let it = 0; // プレイアウトの回数
      let rounds = 0;
      let errors = 0;
      let decided = false;
      const mean = (k: number) => sum[k] / rounds + bonus[k];
      // 先頭 a が b に勝っているか(同じ世界での差で判定)
      const verdict = (a: number, b: number) => {
        const dsum = sum[a] - sum[b];
        const dsq = sq[a] + sq[b] - 2 * cross[a][b];
        return pairedVerdict(rounds, dsum, dsq, bonus[a] - bonus[b]);
      };

      while (alive.length > 1 && (rounds === 0 || (it + alive.length <= maxIt && Date.now() - t0 < ms))) {
        const det = determinize(view, me, { rand: ctx.rand, reg, policy, candidateDecks: o.candidateDecks });
        const seed = Math.floor(ctx.rand() * 0x7fffffff);
        const r = new Array<number>(n).fill(NaN);
        for (const k of alive) {
          it++;
          try {
            r[k] = rollout(step(det, legal[k], reg).state, reg, me, seededRand(seed), horizon);
          } catch {
            errors++; // エンジンの例外は「負け」にせず、その手を候補から外す
          }
        }
        const ok = alive.filter((k) => !Number.isNaN(r[k]));
        if (ok.length < alive.length) {
          // 例外を出した手を外す。このラウンドの結果は、残った手だけで集計する
          alive = ok;
        }
        if (alive.length === 0) break;
        rounds++;
        for (const i of alive) {
          sum[i] += r[i];
          sq[i] += r[i] * r[i];
          for (const j of alive) cross[i][j] += r[i] * r[j];
        }
        if (alive.length < 2) break;
        // 先頭の手と比べて、明らかに劣る手を外す
        let lead = alive[0];
        for (const k of alive) if (mean(k) > mean(lead)) lead = k;
        alive = alive.filter((k) => k === lead || verdict(lead, k) !== 'ahead');
        if (alive.length === 1) {
          decided = true;
          break;
        }
        // 時間主導の時は、1位と2位が判定できる精度に達していれば打ち切る
        if (timeDriven && rounds % 4 === 0) {
          let second = -1;
          for (const k of alive) if (k !== lead && (second < 0 || mean(k) > mean(second))) second = k;
          if (second >= 0 && verdict(lead, second) !== 'open') {
            decided = true;
            break;
          }
        }
      }
      o.onSearch?.({ iterations: it, ms: Date.now() - t0, timeDriven, decided, arms: n, rounds, errors });
      if (alive.length === 0 || rounds === 0) return legal[baseIdx];
      let best = alive[0];
      for (const k of alive) if (mean(k) > mean(best)) best = k;
      return legal[best];
    },
  };
}
