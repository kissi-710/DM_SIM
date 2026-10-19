// 再検討の実験(通常の時間で指した試合を、あとで時間・反復を大幅に増やして検討しなおし、取りこぼしを調べる)。
//   collect <名前> <試合数> <シード> [通常の探索の設定=mcts:ms=1200]   通常の時間で CPU 同士の試合を記録
//   deep    <名前> [深い探索=mcts:iter=30000,z=99] [通常の探索=mcts:ms=1200] [試合数の上限]   各判断を再検討し、食い違いを拾う
//   verify  <名前> [続きの回数=300] [判断数の上限=120] [続きのAI=mcts:iter=150] [シード=1]   食い違いを、続きを最後まで多数回プレイした勝率で検証
//   report  <名前>                                                集計
// 保存先: scratch/replay/<名前>/{games,deep,verify}.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DECK_PRESETS } from '../src/cards';
import type { PlayerId } from '../src/engine/types';
import type { GameRecord } from './replay/common';
import type { ChooseRow, ChooseTask, DeepRow, DeepTask, CollectTask, EvalRow, EvalTask, ReplayTask } from './replay/worker';

const [cmd = '', name = 'a', ...rest] = process.argv.slice(2);
const dir = `scratch/replay/${name}`;
const jobs = Math.max(1, Math.min(8, availableParallelism() - 1));
const load = <T>(f: string): T => JSON.parse(readFileSync(`${dir}/${f}.json`, 'utf8')) as T;
const save = (f: string, v: unknown) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${f}.json`, JSON.stringify(v));
};

async function runTasks<R>(tasks: ReplayTask[], label: string): Promise<R[][]> {
  const results: R[][] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      const w = new Worker(new URL('./replay/worker.ts', import.meta.url));
      let cur = -1;
      const feed = () => {
        if (next >= tasks.length) return void w.terminate();
        cur = next++;
        w.postMessage(tasks[cur]);
      };
      w.on('message', (m: { ok: boolean; result?: R[]; error?: string }) => {
        if (!m.ok) return reject(new Error(m.error));
        results[cur] = m.result!;
        done++;
        process.stderr.write(`\r  ${label} ${done}/${tasks.length} (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
        if (done === tasks.length) resolve();
        else feed();
      });
      w.on('error', reject);
      feed();
    };
    for (let i = 0; i < Math.min(jobs, tasks.length); i++) start();
  });
  process.stderr.write('\n');
  return results;
}

const pct = (x: number, d = 1) => (x * 100).toFixed(d) + '%';
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
const kindOf = (text: string): string =>
  text.startsWith('マナ') ? 'マナチャージ' : text.startsWith('出す') || text.startsWith('唱える') ? '召喚・詠唱' : text.startsWith('攻撃:') ? '攻撃' : text.startsWith('攻撃に進む') || text.startsWith('ターンを終える') ? '攻撃に進む・ターン終了' : '効果の選択';

if (cmd === 'collect') {
  const [gamesArg = '60', seedArg = '1', spec = 'mcts:ms=1200'] = rest;
  const ids = DECK_PRESETS.map((d) => d.id);
  const games: CollectTask['games'] = [];
  for (let g = 0; g < Number(gamesArg); g++) {
    games.push({ id: g, deckA: ids[g % ids.length], deckB: ids[Math.floor(g / ids.length) % ids.length], seed: Number(seedArg) * 10007 + g, first: (g % 2) as PlayerId });
  }
  const per = 2;
  const tasks: CollectTask[] = [];
  for (let i = 0; i < games.length; i += per) tasks.push({ kind: 'collect', games: games.slice(i, i + per), spec });
  const res = await runTasks<GameRecord>(tasks, '試合');
  const recs = res.flat().sort((a, b) => a.id - b.id);
  save('games', { spec, recs });
  const dec = recs.flatMap((r) => r.decisions);
  const lost = recs.filter((r) => r.winner !== null && r.winner !== 'draw').length;
  console.log(`試合 ${recs.length}(決着 ${lost})/ 判断 ${dec.length} / 1 判断の時間 平均 ${mean(dec.map((d) => d.ms)).toFixed(0)}ms 中央値 ${median(dec.map((d) => d.ms)).toFixed(0)}ms / 反復 中央値 ${median(dec.flatMap((d) => (d.iters == null ? [] : [d.iters])))}`);
} else if (cmd === 'deep') {
  const [deepSpec = 'mcts:iter=30000,z=99', normalSpec = 'mcts:ms=1200', limit = '100000'] = rest;
  const { recs } = load<{ recs: GameRecord[] }>('games');
  const tasks: DeepTask[] = recs.slice(0, Number(limit)).map((game) => ({ kind: 'deep', game, deepSpec, normalSpec }));
  const res = await runTasks<DeepRow>(tasks, '再検討');
  const rows = res.flat();
  save('deep', { deepSpec, normalSpec, rows });
  console.log(`判断 ${rows.length}(深い探索 平均 ${mean(rows.map((r) => r.deepMs)).toFixed(0)}ms)`);
} else if (cmd === 'verify') {
  const [nArg = '300', maxArg = '120', contSpec = 'mcts:iter=150', seedArg = '1'] = rest;
  const { recs } = load<{ recs: GameRecord[] }>('games');
  const { rows } = load<{ rows: DeepRow[] }>('deep');
  const diff = rows.filter((r) => r.chosen !== r.deep);
  // 固定の乱数で、上限まで無作為に選ぶ
  let sd = 12345;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pool = diff.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Number(maxArg));
  const byGame = new Map<number, DeepRow[]>();
  for (const r of picked) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
  const tasks: EvalTask[] = [...byGame].map(([gid, rs]) => ({
    kind: 'eval',
    game: recs.find((g) => g.id === gid)!,
    items: rs.map((r) => ({ k: r.k, texts: [r.chosen, r.deep] })),
    contSpec,
    n: Number(nArg),
    seed: Number(seedArg),
  }));
  console.log(`食い違い ${diff.length} / ${rows.length} のうち ${picked.length} 判断を検証(各候補 ${nArg} 回の続き)`);
  const res = await runTasks<EvalRow>(tasks, '検証');
  save('verify', { contSpec, n: Number(nArg), rows: res.flat() });
} else if (cmd === 'trace') {
  // 負けた試合で、形勢が傾いたタイミングを探す: 各判断の直後の勝率(続きを多数回プレイ)の推移を出し、勝率が大きく落ちた負け側の判断で、全候補の勝率を測る
  const [gamesArg = '6', n1Arg = '40', n2Arg = '150', contSpec = 'mcts:iter=80', seedArg = '3', minTurnsArg = '12', maxTurnsArg = '99'] = rest;
  const { recs } = load<{ recs: GameRecord[] }>('games');
  let sd = Number(seedArg) * 7919;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cand = recs.filter((g) => (g.winner === 0 || g.winner === 1) && g.turns >= Number(minTurnsArg) && g.turns <= Number(maxTurnsArg));
  const pool = cand.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const games = pool.slice(0, Number(gamesArg));
  // 段階 1: 実際に指した手の勝率(その手を指した人から見て)を、全判断で測る
  const t1: EvalTask[] = games.map((g) => ({ kind: 'eval', game: g, items: g.decisions.map((d) => ({ k: d.k, texts: 'chosen' as const })), contSpec, n: Number(n1Arg), seed: 5 }));
  const r1 = await runTasks<EvalRow>(t1, '推移');
  const traj = new Map<number, { k: number; who: PlayerId; turn: number; v: number; chosen: string }[]>();
  games.forEach((g, i) => {
    const loser = (1 - (g.winner as PlayerId)) as PlayerId;
    traj.set(g.id, r1[i].filter((r) => r.options.length === 1).map((r) => ({ k: r.k, who: r.who, turn: r.turn, v: r.who === loser ? r.options[0].rate : 1 - r.options[0].rate, chosen: r.chosen })));
  });
  // 段階 2: 負け側の判断のうち、勝率が大きく落ちた上位 3 つで、全候補を測る
  const flagged = new Map<number, number[]>();
  for (const g of games) {
    const loser = (1 - (g.winner as PlayerId)) as PlayerId;
    const tr = traj.get(g.id)!;
    const drops = tr.map((p, i) => ({ k: p.k, who: p.who, drop: i > 0 ? tr[i - 1].v - p.v : 0 })).filter((x) => x.who === loser && x.drop > 0);
    flagged.set(g.id, drops.sort((a, b) => b.drop - a.drop).slice(0, 3).map((x) => x.k));
  }
  const t2: EvalTask[] = games.map((g) => ({ kind: 'eval', game: g, items: flagged.get(g.id)!.map((k) => ({ k, texts: 'all' as const })), contSpec, n: Number(n2Arg), seed: 9 }));
  const r2 = await runTasks<EvalRow>(t2, '全候補');
  const out = games.map((g, i) => ({ game: g.id, deckA: g.deckA, deckB: g.deckB, first: g.first, winner: g.winner, turns: g.turns, traj: traj.get(g.id)!, flagged: r2[i] }));
  save('trace', { contSpec, n1: Number(n1Arg), n2: Number(n2Arg), games: out });
  console.log(`試合 ${out.length} 件を保存(${dir}/trace.json)。表示は: report ${name} trace`);
} else if (cmd === 'strongtrace') {
  // 追跡で見つけた取りこぼし(最善と実際の差が大きい判断)で、別の設定の探索が、最善の手を選べるかを数える
  const [spec = 'mcts:iter=3000,z=99', repsArg = '5', minDiffArg = '0.12'] = rest;
  const reps = Number(repsArg);
  const { recs } = load<{ recs: GameRecord[] }>('games');
  const tr = load<{ games: { game: number; flagged: EvalRow[] }[] }>('trace');
  const items: { gid: number; k: number; chosen: string; best: string; diff: number }[] = [];
  for (const g of tr.games) {
    for (const f of g.flagged) {
      const best = [...f.options].sort((a, b) => b.rate - a.rate)[0];
      const cho = f.options.find((o) => o.text === f.chosen);
      if (cho && best.rate - cho.rate >= Number(minDiffArg)) items.push({ gid: g.game, k: f.k, chosen: f.chosen, best: best.text, diff: best.rate - cho.rate });
    }
  }
  const byGame = new Map<number, number[]>();
  for (const it of items) byGame.set(it.gid, [...(byGame.get(it.gid) ?? []), it.k]);
  const tasks: ChooseTask[] = [...byGame].map(([gid, ks]) => ({ kind: 'choose', game: recs.find((g) => g.id === gid)!, ks, spec, reps }));
  const res = (await runTasks<ChooseRow>(tasks, '選択')).flat();
  console.log(`■ ${spec}: 取りこぼし ${items.length} 件(最善 − 実際 ≥ ${(Number(minDiffArg) * 100).toFixed(0)}pt)。各 ${reps} 回`);
  let hit = 0;
  let same = 0;
  for (const it of items) {
    const ch = res.find((r) => r.gameId === it.gid && r.k === it.k)!.choices;
    const b = ch.filter((c) => c === it.best).length;
    const a = ch.filter((c) => c === it.chosen).length;
    hit += b;
    same += a;
    console.log(`  試合${it.gid} ${kindOf(it.chosen)} 差 ${(it.diff * 100).toFixed(0)}pt: 最善を選ぶ ${b}/${reps}、実際と同じ ${a}/${reps}  [最善: ${it.best.slice(0, 40)}]`);
  }
  console.log(`  合計: 最善を選ぶ ${pct(hit / (items.length * reps))}、実際と同じ手 ${pct(same / (items.length * reps))}`);
} else if (cmd === 'strong') {
  // 別の設定(strong)の探索が、再検討で取りこぼしを拾えるか: 検証済みの判断で、深い探索の手・実際の手を選ぶ割合を数える
  const [spec = 'mcts:iter=3000,z=99', repsArg = '3', allArg = 'all'] = rest;
  const reps = Number(repsArg);
  const { recs } = load<{ recs: GameRecord[] }>('games');
  const { rows } = load<{ rows: DeepRow[] }>('deep');
  const ver = load<{ rows: EvalRow[] }>('verify');
  const want = allArg === 'all' ? rows : rows.filter((r) => ver.rows.some((v) => v.gameId === r.gameId && v.k === r.k));
  const byGame = new Map<number, number[]>();
  for (const r of want) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r.k]);
  const tasks: ChooseTask[] = [...byGame].map(([gid, ks]) => ({ kind: 'choose', game: recs.find((g) => g.id === gid)!, ks, spec, reps: allArg === 'all' ? 1 : reps }));
  const res = (await runTasks<ChooseRow>(tasks, '選択')).flat();
  const key = (g: number, k: number) => `${g}:${k}`;
  const picks = new Map(res.map((c) => [key(c.gameId, c.k), c.choices]));
  save(`strong-${spec.replace(/[^a-z0-9=,.]/gi, '_')}`, { spec, rows: res });
  const all = rows.filter((r) => picks.has(key(r.gameId, r.k)));
  const rate = (xs: boolean[]) => xs.filter(Boolean).length / Math.max(1, xs.length);
  console.log(`■ ${spec}(${allArg === 'all' ? '全判断' : '検証済みの判断'} ${all.length} 件、各 ${allArg === 'all' ? 1 : reps} 回)`);
  console.log(`  深い探索の手と食い違う割合: ${pct(rate(all.flatMap((r) => picks.get(key(r.gameId, r.k))!.map((c) => c !== r.deep))))}(通常の探索を実際に指した手: ${pct(rate(all.map((r) => r.chosen !== r.deep)))}、通常の再実行: ${pct(rate(all.map((r) => r.recheck !== r.deep)))})`);
  if (allArg !== 'all') {
    const items = ver.rows.map((r) => {
      const dr = rows.find((d) => d.gameId === r.gameId && d.k === r.k)!;
      const c = r.options.find((o) => o.text === dr.chosen);
      const d = r.options.find((o) => o.text === dr.deep);
      return c && d ? { dr, diff: d.rate - c.rate, se: Math.sqrt((c.rate * (1 - c.rate)) / c.n + (d.rate * (1 - d.rate)) / d.n), ch: picks.get(key(r.gameId, r.k))! } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    for (const [label, sel] of [['深い探索の手が有意に良かった判断(取りこぼし)', items.filter((x) => x.diff / x.se >= 2)], ['実際の手が有意に良かった判断', items.filter((x) => x.diff / x.se <= -2)], ['差なし', items.filter((x) => Math.abs(x.diff / x.se) < 2)]] as const) {
      const n = sel.length * reps;
      const toDeep = sel.flatMap((x) => x.ch.map((c) => c === x.dr.deep)).filter(Boolean).length;
      const toChosen = sel.flatMap((x) => x.ch.map((c) => c === x.dr.chosen)).filter(Boolean).length;
      console.log(`  ${label}(${sel.length} 件): この設定が 深い探索の手を選ぶ ${pct(toDeep / Math.max(1, n))} / 実際の手を選ぶ ${pct(toChosen / Math.max(1, n))} / その他 ${pct(1 - (toDeep + toChosen) / Math.max(1, n))}`);
    }
  }
} else if (cmd === 'report' && rest[0] === 'trace') {
  const t = load<{ contSpec: string; n1: number; n2: number; games: { game: number; deckA: string; deckB: string; first: number; winner: PlayerId; turns: number; traj: { k: number; who: PlayerId; turn: number; v: number; chosen: string }[]; flagged: EvalRow[] }[] }>('trace');
  console.log(`■ 形勢の推移(負けた側から見た勝率。各判断の直後、続きを最後まで ${t.n1} 回プレイ(${t.contSpec}))`);
  for (const g of t.games) {
    const loser = 1 - g.winner;
    console.log(`
— 試合${g.game}: ${g.deckA} 対 ${g.deckB}(席${g.first === 0 ? '0' : '1'} が先攻)、席${g.winner} の勝ち、${g.turns} ターン。負けた側 = 席${loser}`);
    const byTurn = new Map<number, number[]>();
    for (const p of g.traj) byTurn.set(p.turn, [...(byTurn.get(p.turn) ?? []), p.v]);
    console.log('  ターンごとの勝率(平均): ' + [...byTurn].map(([tn, vs]) => `${tn}:${(mean(vs) * 100).toFixed(0)}%`).join(' '));
    const drops = g.traj.map((p, i) => ({ p, drop: i > 0 ? g.traj[i - 1].v - p.v : 0 })).sort((a, b) => b.drop - a.drop).slice(0, 3);
    console.log('  勝率が最も落ちた 3 つの判断(直前の判断の直後からの変化。どちらの側の判断かも):');
    for (const d of drops) console.log(`      ${d.p.turn}ターン目 ${d.p.who === loser ? '【負けた側】' : '【勝った側】'} ${(d.drop * 100).toFixed(0)}pt 低下(→ ${(d.p.v * 100).toFixed(0)}%): ${d.p.chosen}`);
    for (const f of g.flagged) {
      const best = [...f.options].sort((a, b) => b.rate - a.rate)[0];
      const cho = f.options.find((o) => o.text === f.chosen);
      console.log(`  ▼ ${f.turn}ターン目 [${kindOf(f.chosen)}] 実際: ${f.chosen}(${cho ? pct(cho.rate, 0) : '?'}) / 最善: ${best.text}(${pct(best.rate, 0)}) 差 ${cho ? ((best.rate - cho.rate) * 100).toFixed(0) : '?'}pt`);
      for (const o of [...f.options].sort((a, b) => b.rate - a.rate).slice(0, 5)) console.log(`      ${pct(o.rate, 0).padStart(4)} ${o.text}${o.text === f.chosen ? '  ←実際' : ''}`);
    }
  }
} else if (cmd === 'report') {
  const { recs } = load<{ recs: GameRecord[] }>('games');
  const dec = recs.flatMap((r) => r.decisions);
  console.log(`■ 通常の探索(${load<{ spec: string }>('games').spec})`);
  console.log(`  試合 ${recs.length} / 判断 ${dec.length}(1 試合あたり ${(dec.length / recs.length).toFixed(1)})`);
  const withIt = dec.filter((d) => d.iters != null);
  const its = withIt.map((d) => d.iters as number);
  console.log(`  1 判断の時間 平均 ${mean(dec.map((d) => d.ms)).toFixed(0)}ms / 中央値 ${median(dec.map((d) => d.ms)).toFixed(0)}ms / 最大 ${Math.max(...dec.map((d) => d.ms)).toFixed(0)}ms`);
  console.log(`  反復回数 平均 ${mean(its).toFixed(0)} / 中央値 ${median(its)} / 上位 10% ${[...its].sort((a, b) => a - b)[Math.floor(its.length * 0.9)]} / 早期終了(優劣が明確) ${pct(withIt.filter((d) => d.decided).length / Math.max(1, withIt.length))}`);
  if (existsSync(`${dir}/deep.json`)) {
    const { rows, deepSpec } = load<{ rows: DeepRow[]; deepSpec: string }>('deep');
    console.log(`\n■ 再検討(${deepSpec})。判断 ${rows.length}、深い探索の平均 ${mean(rows.map((r) => r.deepMs)).toFixed(0)}ms`);
    const rate = (f: (r: DeepRow) => boolean, rs = rows) => (rs.length ? rs.filter(f).length / rs.length : NaN);
    console.log(`  実際の手 ≠ 深い探索の手: ${pct(rate((r) => r.chosen !== r.deep))}`);
    console.log(`  実際の手 ≠ 通常の探索の再実行の手(自分自身との食い違い。基準): ${pct(rate((r) => r.chosen !== r.recheck))}`);
    console.log(`  深い探索の手 ≠ 通常の探索の再実行の手: ${pct(rate((r) => r.deep !== r.recheck))}`);
    const kinds = [...new Set(rows.map((r) => kindOf(r.chosen)))];
    console.log('  種類別(判断数 / 深い探索と食い違い / 通常の再実行と食い違い):');
    for (const k of kinds) {
      const rs = rows.filter((r) => kindOf(r.chosen) === k);
      console.log(`    ${k.padEnd(22)} ${String(rs.length).padStart(5)}  ${pct(rate((r) => r.chosen !== r.deep, rs)).padStart(6)}  ${pct(rate((r) => r.chosen !== r.recheck, rs)).padStart(6)}`);
    }
    const bands: [string, number, number][] = [['1-3', 1, 3], ['4-6', 4, 6], ['7-9', 7, 9], ['10+', 10, 99]];
    console.log('  ターン帯別(自分のターン数。判断数 / 深い探索と食い違い / 通常の再実行と食い違い):');
    for (const [l, lo, hi] of bands) {
      const rs = rows.filter((r) => r.turn >= lo && r.turn <= hi);
      console.log(`    ${l.padEnd(6)} ${String(rs.length).padStart(5)}  ${pct(rate((r) => r.chosen !== r.deep, rs)).padStart(6)}  ${pct(rate((r) => r.chosen !== r.recheck, rs)).padStart(6)}`);
    }
    // 通常の探索が早期終了した判断と、使い切った判断で、食い違いが違うか
    const early = rows.filter((r) => r.decided === true);
    const full = rows.filter((r) => r.decided === false);
    console.log(`  通常の探索が早期終了した判断(${early.length}): 深い探索と食い違い ${pct(rate((r) => r.chosen !== r.deep, early))} / 時間を使い切った判断(${full.length}): ${pct(rate((r) => r.chosen !== r.deep, full))}`);
  }
  if (existsSync(`${dir}/verify.json`)) {
    const v = load<{ rows: EvalRow[]; n: number; contSpec: string }>('verify');
    const { rows: deepRows } = load<{ rows: DeepRow[] }>('deep');
    const items = v.rows.map((r) => {
      const dr = deepRows.find((d) => d.gameId === r.gameId && d.k === r.k)!;
      const c = r.options.find((o) => o.text === dr.chosen);
      const d = r.options.find((o) => o.text === dr.deep);
      return c && d ? { r, dr, c, d, diff: d.rate - c.rate, se: Math.sqrt((c.rate * (1 - c.rate)) / c.n + (d.rate * (1 - d.rate)) / d.n) } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    const allOpts = v.rows.flatMap((r) => r.options);
    const cappedRate = allOpts.reduce((s, o) => s + o.capped, 0) / Math.max(1, allOpts.reduce((s, o) => s + o.n, 0));
    console.log(`\n■ 検証(食い違った判断 ${items.length} 件。各候補を、続きを最後まで ${v.n} 回プレイ(${v.contSpec})。手数の上限(300 手)で打ち切って引分扱いにした続き: ${pct(cappedRate)})`);
    const better = items.filter((x) => x.diff / x.se >= 2);
    const worse = items.filter((x) => x.diff / x.se <= -2);
    console.log(`  深い探索の手が有意に良い(z ≥ 2): ${better.length}(${pct(better.length / items.length)})`);
    console.log(`  実際の手が有意に良い(z ≤ -2): ${worse.length}(${pct(worse.length / items.length)})`);
    console.log(`  差なし: ${items.length - better.length - worse.length}`);
    console.log(`  深い探索の手 − 実際の手 の勝率差: 平均 ${(mean(items.map((x) => x.diff)) * 100).toFixed(2)}pt(標準誤差 ${((Math.sqrt(items.reduce((s, x) => s + (x.diff - mean(items.map((y) => y.diff))) ** 2, 0) / Math.max(1, items.length - 1)) / Math.sqrt(items.length)) * 100).toFixed(2)})`);
    const pickedAll = deepRows.filter((r) => r.chosen !== r.deep).length;
    const meanBetter = mean(better.map((x) => x.diff));
    console.log(`  食い違いは全 ${deepRows.length} 判断中 ${pickedAll} 件(${pct(pickedAll / deepRows.length)})。有意に良い取りこぼしは、検証した食い違いの ${pct(better.length / items.length)} → 全体で推定 ${pct((pickedAll / deepRows.length) * (better.length / items.length), 2)} の判断、1 試合あたり約 ${(((pickedAll / deepRows.length) * (better.length / items.length) * deepRows.length) / recs.length).toFixed(2)} 回(その時の勝率の差 平均 ${(meanBetter * 100).toFixed(1)}pt)`);
    console.log('\n  有意に深い探索の手が良かった例(差の大きい順):');
    for (const x of [...better].sort((a, b) => b.diff - a.diff).slice(0, 8)) {
      console.log(`    試合${x.r.gameId} ${x.r.turn}ターン目 [${kindOf(x.dr.chosen)}] 実際: ${x.dr.chosen}(${pct(x.c.rate, 0)}) → 深い探索: ${x.dr.deep}(${pct(x.d.rate, 0)}) 差 ${(x.diff * 100).toFixed(0)}pt / 通常の探索 ${x.dr.ms.toFixed(0)}ms・${x.dr.iters ?? '?'}反復${x.dr.decided ? '・早期終了' : ''}`);
    }
  }
} else {
  console.log('使い方: collect | deep | verify | report(ファイル先頭のコメントを参照)');
}
process.exit(0);
