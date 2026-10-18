// 実験: 公開情報から相手の手札を読めるか(自己対戦のデータで、統計的に調べる)。
//   npx tsx scripts/hand-infer-eval.ts [組あたりの試合数=300] [シード=1]
// 観測点 = 各ターンの最初(観測者 = そのターンのプレイヤー)。相手のデッキリストは既知とする。
// 1行 = (観測点, 相手の手札にあるかもしれないカード定義)。ラベル = 手札にある枚数 k / 未知の枚数 u。
// 基準 = 一様(未知のどの枠も手札になる確率は h/N)。モデル = 基準の対数オッズ + θ・特徴量(ロジスティック回帰)。
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { makeAgent } from '../src/ai';
import { FEATURE_NAMES, N_FEATURES, handFeatures, turnRecord, type TurnRecord } from '../src/ai/handInfer';
import { loadRegistry } from '../src/engine/registry';
import { FAIR, toPlayerView } from '../src/engine/view';
import { playGameSync } from '../src/sim/playGame';
import type { GameState, PlayerId } from '../src/engine/types';

const reg = loadRegistry(CARD_DB);
const perPair = Number(process.argv[2] ?? 300);
const seed0 = Number(process.argv[3] ?? 1);

interface Row {
  game: number;
  obs: number;
  x: number[];
  u: number;
  k: number;
  h: number;
  n: number;
  turn: number;
}

// ───────────────────────── データ生成 ─────────────────────────
const rows: Row[] = [];
let obsId = 0;
let gameId = 0;
const ids = DECK_PRESETS.map((d) => d.id);
const agents: [ReturnType<typeof makeAgent>, ReturnType<typeof makeAgent>] = [makeAgent({ kind: 'rule' }), makeAgent({ kind: 'rule' })];
for (const a of ids) {
  for (const b of ids) {
    for (let g = 0; g < perPair; g++) {
      const game = gameId++;
      const hist: [TurnRecord[], TurnRecord[]] = [[], []];
      let prev: GameState | null = null;
      playGameSync(reg, agents, {
        decks: [deckCards(a), deckCards(b)],
        seed: seed0 * 100000 + game,
        first: 'random',
        onStep: (s, act) => {
          if (act.type === 'END_TURN' && prev) hist[prev.active as PlayerId].push(turnRecord(prev, prev.active, reg));
          if (s.winner === null && prev && s.active !== prev.active && s.pending && s.turn >= 3) {
            const me = s.active as PlayerId;
            const opp = (1 - me) as PlayerId;
            const view = toPlayerView(s, me, FAIR, reg);
            const unknown = new Map<string, number>();
            for (const d of s.deckIds[opp]) unknown.set(d, (unknown.get(d) ?? 0) + 1);
            let n = 0;
            for (const c of view.cards) {
              if (c.owner !== opp) continue;
              if (c.defId === '?') n++;
              else unknown.set(c.defId, (unknown.get(c.defId) ?? 0) - 1);
            }
            const inHand = new Map<string, number>();
            for (const u of s.players[opp].hand) inHand.set(s.cards[u].defId, (inHand.get(s.cards[u].defId) ?? 0) + 1);
            const h = s.players[opp].hand.length;
            const now = turnRecord(s, opp, reg);
            const oid = obsId++;
            for (const [d, u] of unknown) {
              if (u <= 0) continue;
              rows.push({ game, obs: oid, x: handFeatures(reg, d, hist[opp], now), u, k: inHand.get(d) ?? 0, h, n, turn: s.turn });
            }
          }
          prev = s;
        },
      });
    }
  }
}
console.log(`試合 ${gameId} / 観測点 ${obsId} / 行 ${rows.length}`);

// ───────────────────────── 回帰 ─────────────────────────
const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (z: number) => 1 / (1 + Math.exp(-z));
const clampP = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** feats: 使う特徴量の添字。先頭に定数項を足す */
function fit(train: Row[], feats: number[], lambda = 1e-3): number[] {
  const d = feats.length + 1;
  let th = new Array(d).fill(0);
  const xv = (r: Row) => [1, ...feats.map((i) => r.x[i])];
  for (let it = 0; it < 25; it++) {
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    const g = new Array(d).fill(0);
    for (const r of train) {
      const x = xv(r);
      const p = sigm(logit(clampP(r.h / r.n)) + x.reduce((s, v, i) => s + v * th[i], 0));
      const gr = r.k - r.u * p;
      const w = r.u * p * (1 - p);
      for (let i = 0; i < d; i++) {
        g[i] += gr * x[i];
        for (let j = 0; j < d; j++) H[i][j] += w * x[i] * x[j];
      }
    }
    for (let i = 0; i < d; i++) {
      H[i][i] += lambda;
      g[i] -= lambda * th[i];
    }
    const step = solve(H, g);
    th = th.map((v, i) => v + step[i]);
    if (step.every((s) => Math.abs(s) < 1e-7)) break;
  }
  return th;
}

/** 観測点ごとに、期待枚数 Σ u p = h になるよう切片をずらして予測を作る(サンプリングで使う形) */
function predict(rowsOfObs: Row[], feats: number[], th: number[]): number[] {
  const base = rowsOfObs.map((r) => logit(clampP(r.h / r.n)) + th[0] * 0 + feats.reduce((s, f, i) => s + th[i + 1] * r.x[f], 0));
  const h = rowsOfObs[0].h;
  let lo = -20;
  let hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const e = base.reduce((s, z, j) => s + rowsOfObs[j].u * sigm(z + mid), 0);
    if (e > h) hi = mid;
    else lo = mid;
  }
  const delta = (lo + hi) / 2;
  return base.map((z) => clampP(sigm(z + delta)));
}

const byObs = new Map<number, Row[]>();
for (const r of rows) {
  if (!byObs.has(r.obs)) byObs.set(r.obs, []);
  byObs.get(r.obs)!.push(r);
}
// 試合の偶奇で学習/検証に分ける(同じ試合の観測点は同じ側)
const isTest = (r: Row) => r.game % 10 >= 7;
const train = rows.filter((r) => !isTest(r));
const test = rows.filter(isTest);
console.log(`学習 ${train.length} 行 / 検証 ${test.length} 行(試合の 30%)`);

interface Eval {
  baseLoss: number;
  modelLoss: number;
  auc: number;
  perGame: Map<number, [number, number, number]>; // [基準損失, モデル損失, 枚数]
  calib: { lo: number; hi: number; n: number; pred: number; obs: number }[];
}
function evaluate(feats: number[], th: number[]): Eval {
  let bl = 0;
  let ml = 0;
  let copies = 0;
  const perGame = new Map<number, [number, number, number]>();
  const scored: { p: number; pos: number; neg: number }[] = [];
  for (const rs of byObs.values()) {
    if (!isTest(rs[0])) continue;
    const ps = predict(rs, feats, th);
    rs.forEach((r, i) => {
      const p0 = clampP(r.h / r.n);
      const b = -(r.k * Math.log(p0) + (r.u - r.k) * Math.log(1 - p0));
      const m = -(r.k * Math.log(ps[i]) + (r.u - r.k) * Math.log(1 - ps[i]));
      bl += b;
      ml += m;
      copies += r.u;
      const pg = perGame.get(r.game) ?? [0, 0, 0];
      pg[0] += b;
      pg[1] += m;
      pg[2] += r.u;
      perGame.set(r.game, pg);
      scored.push({ p: ps[i], pos: r.k, neg: r.u - r.k });
    });
  }
  // 重みつき AUC(同順位は半分)
  scored.sort((a, b) => a.p - b.p);
  let negBelow = 0;
  let num = 0;
  let totPos = 0;
  let totNeg = 0;
  for (let i = 0; i < scored.length; ) {
    let j = i;
    let pos = 0;
    let neg = 0;
    while (j < scored.length && scored[j].p === scored[i].p) {
      pos += scored[j].pos;
      neg += scored[j].neg;
      j++;
    }
    num += pos * (negBelow + neg / 2);
    negBelow += neg;
    totPos += pos;
    totNeg += neg;
    i = j;
  }
  // 較正(予測の十分位)
  const cuts = 10;
  const calib: Eval['calib'] = [];
  const total = scored.reduce((s, x) => s + x.pos + x.neg, 0);
  let acc = 0;
  let cur = { lo: 1, hi: 0, n: 0, pred: 0, obs: 0 };
  for (const x of scored) {
    const m = x.pos + x.neg;
    cur.lo = Math.min(cur.lo, x.p);
    cur.hi = Math.max(cur.hi, x.p);
    cur.n += m;
    cur.pred += x.p * m;
    cur.obs += x.pos;
    acc += m;
    if (acc >= (total * (calib.length + 1)) / cuts) {
      calib.push(cur);
      cur = { lo: 1, hi: 0, n: 0, pred: 0, obs: 0 };
    }
  }
  if (cur.n) calib.push(cur);
  return { baseLoss: bl / copies, modelLoss: ml / copies, auc: num / (totPos * totNeg), perGame, calib };
}

function bootstrap(e: Eval, reps = 400): [number, number] {
  const games = [...e.perGame.values()];
  const rel: number[] = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let r = 0; r < reps; r++) {
    let b = 0;
    let m = 0;
    for (let i = 0; i < games.length; i++) {
      const g = games[Math.floor(rnd() * games.length)];
      b += g[0];
      m += g[1];
    }
    rel.push((b - m) / b);
  }
  rel.sort((a, b) => a - b);
  return [rel[Math.floor(reps * 0.025)], rel[Math.floor(reps * 0.975)]];
}

const all = [...Array(N_FEATURES).keys()];
const groups: Record<string, number[]> = {
  '基本属性のみ(コスト・呪文・S・ブロッカー)': [0, 1, 2, 3],
  '+ 出せたターン数': [0, 1, 2, 3, 4],
  '+ 出せるのに残したマナ(全期間・直近・文明つき)': [0, 1, 2, 3, 4, 5, 6, 7],
  '全特徴量': all,
};
const rootBase = (() => {
  let b = 0;
  let c = 0;
  for (const r of test) {
    const p = clampP(r.h / r.n);
    b += -(r.k * Math.log(p) + (r.u - r.k) * Math.log(1 - p));
    c += r.u;
  }
  return b / c;
})();
console.log(`\n基準(一様)の 1 枚あたり対数損失: ${rootBase.toFixed(5)}`);
for (const [name, feats] of Object.entries(groups)) {
  const th = fit(train, feats);
  const e = evaluate(feats, th);
  const rel = (e.baseLoss - e.modelLoss) / e.baseLoss;
  const [lo, hi] = bootstrap(e);
  console.log(`\n■ ${name}`);
  console.log(`  検証の損失 基準 ${e.baseLoss.toFixed(5)} → モデル ${e.modelLoss.toFixed(5)}  改善 ${(rel * 100).toFixed(2)}%(95%区間 ${(lo * 100).toFixed(2)}〜${(hi * 100).toFixed(2)}%)  AUC ${e.auc.toFixed(4)}`);
  console.log('  係数: 定数 ' + th[0].toFixed(3) + ' / ' + feats.map((f, i) => `${FEATURE_NAMES[f]} ${th[i + 1].toFixed(3)}`).join(' / '));
  if (feats.length === all.length) {
    console.log('  較正(予測の十分位。予測 → 実測):');
    for (const c of e.calib) console.log(`    ${(c.pred / c.n).toFixed(3)} → ${(c.obs / c.n).toFixed(3)}  (${c.n} 枚)`);
  }
}
