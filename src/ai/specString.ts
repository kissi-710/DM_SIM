// AI の設定を文字列で書く(CLI の測定用): 「種類」または「種類:キー=値,キー=値」。
//   rule / random
//   mcts:iter=120,horizon=3,prior=0.005,w.mana=3.5
// キー: algo=flat|tree|ptree c(木の探索定数) depth(木の深さ) iter(反復回数) ms(最大思考時間) horizon(先読みターン数。99でゲーム終了まで) prior(L1の手への上乗せ) w.<重み名>
//       lookahead=1(プレイアウトの効果の選択を1手先読みで決める) rl1.<調整値名>=<値>(プレイアウトの L1 の調整値)
//       l1.<調整値名>=<値>(rule: ai/l1params.ts の調整値)
//       strong=1(「強い」CPU の設定。手を外す判定をしない z=99 と、精度の基準 prec=0.003。明示した z・prec が優先。docs/ai-replay-analysis.md)
//       prec=<近い手の比較を打ち切る精度。既定 0.012> minit=<早期終了をしない反復数の下限。既定 0>
//       infer=0(公開されて山札の下に戻った札の推論を切る。既定は入。新旧の比較用)
//       z=<外す判定の厳しさ。既定 2.5> sh=1(Sequential Halving)
//       value=<パス>(学習した価値関数の JSON。trainValue の出力。Node の CLI 専用)
//       pm=<パス>(学習した召喚の方針。scripts/l1q-fit.ts の出力。プレイアウト(TS・Rust)と L1 に入れる。Node の CLI 専用)
import { readFileSync } from 'node:fs';
import { STRONG_TUNING, type AgentKind, type AgentSpec, type AiTuning } from './index';
import type { RewardWeights } from './eval';
import { FAIR, FULL } from '../engine/view';
import { L1_DEFAULT, type L1Params } from './l1params';

const KINDS: AgentKind[] = ['random', 'rule', 'mcts', 'pass'];

export function parseSpec(text: string): AgentSpec {
  const [kindRaw, rest = ''] = text.trim().split(':', 2) as [string, string?];
  if (!(KINDS as string[]).includes(kindRaw)) throw new Error(`AI の種類が不正です: ${kindRaw}(${KINDS.join(' / ')})`);
  const spec: AgentSpec = { kind: kindRaw as AgentKind };
  const tuning: AiTuning = {};
  const weights: Record<string, number> = {};
  let modelPath: string | undefined;
  let strong = false;
  for (const kv of rest.split(',').filter((x) => x.trim() !== '')) {
    const [k, v] = kv.split('=');
    const n = Number(v);
    if (k === 'value') {
      if (!v) throw new Error('value= にはモデルの JSON のパスを指定してください');
      const { meta: _meta, ...model } = JSON.parse(readFileSync(v, 'utf8'));
      (tuning.weights ??= {}).model = model;
      modelPath = v;
      continue;
    }
    if (!k || v === undefined || v === '') throw new Error(`設定は キー=値 の形で書いてください: ${kv}`);
    if (k === 'l1file') {
      if (!v) throw new Error('l1file= には JSON のパスを指定してください');
      Object.assign((spec.l1 ??= {}), JSON.parse(readFileSync(v, 'utf8')));
      continue;
    }
    if (k.startsWith('l1.')) {
      const name = k.slice(3) as keyof L1Params;
      if (!(name in L1_DEFAULT)) throw new Error('未知の L1 の調整値: ' + name);
      if (!Number.isFinite(n)) throw new Error(k + ' は数で指定してください(指定値: ' + v + ')');
      (spec.l1 as Record<string, number>) ??= {};
      (spec.l1 as Record<string, number>)[name] = n;
      continue;
    }
    if (k === 'strong') {
      strong = n !== 0;
      continue;
    }
    if (k === 'infer') {
      // 公開されて山札の下に戻った札(ヨビニオン)の推論。infer=0 で切る(新旧の比較用)
      spec.policy = { ...(spec.policy ?? FAIR), inferRevealed: n !== 0 };
      continue;
    }
    if (k === 'info') {
      // 情報の価値を測る実験: info=full / info=oh+os+od+ms+md(相手の手札・シールド・山札、自分のシールド・山札を開示)
      if (v === 'full') spec.policy = { ...FULL, ...(spec.policy?.inferRevealed === false ? { inferRevealed: false } : {}) };
      else {
        const f = v.split('+');
        const bad = f.filter((x) => !['oh', 'os', 'od', 'ms', 'md'].includes(x));
        if (bad.length) throw new Error('info= は full か oh/os/od/ms/md の組み合わせです: ' + bad.join(','));
        spec.policy = {
          ...FAIR,
          ...(spec.policy ?? {}),
          preset: 'partial',
          reveal: {
            ...(f.includes('oh') ? { opponentHandCount: 99 } : {}),
            opponentShield: f.includes('os'),
            opponentDeck: f.includes('od'),
            ownShield: f.includes('ms'),
            ownDeck: f.includes('md'),
          },
        };
      }
      continue;
    }
    if (k === 'pm') {
      // 学習した召喚の方針(l1q-fit の出力 JSON。docs/ai-quality-plan.md §12)。L1(事前の候補)とプレイアウトの両方に入れる
      if (!v) throw new Error('pm= にはモデルの JSON のパスを指定してください');
      const w = (JSON.parse(readFileSync(v, 'utf8')) as { w: number[] }).w;
      (spec.l1 ??= {}).playModel = w;
      (tuning.weights ??= {}).playModel = w;
      continue;
    }
    if (k === 'lookahead') {
      (tuning.weights ??= {}).lookahead = n !== 0;
      continue;
    }
    if (k.startsWith('rl1.')) {
      const name = k.slice(4) as keyof L1Params;
      if (!(name in L1_DEFAULT)) throw new Error('未知の L1 の調整値: ' + name);
      (((tuning.weights ??= {}).l1 ??= {}) as Record<string, number>)[name] = n;
      continue;
    }
    if (k === 'z' || k === 'sh' || k === 'prec' || k === 'minit') {
      if (!Number.isFinite(n)) throw new Error(`${k} は数で指定してください(指定値: ${v})`);
      if (k === 'z') tuning.elimZ = n;
      else if (k === 'prec') tuning.precision = n;
      else if (k === 'minit') tuning.minIterations = n;
      else tuning.halving = n !== 0;
      continue;
    }
    if (k === 'algo') {
      if (v !== 'flat' && v !== 'tree' && v !== 'ptree') throw new Error('algo は flat / tree / ptree のどれかです');
      tuning.algo = v;
      continue;
    }
    if (k === 'iter' || k === 'ms' || k === 'horizon' || k === 'chh' || k === 'prior' || k === 'c' || k === 'depth' || k.startsWith('w.')) {
      if (!Number.isFinite(n)) throw new Error(`${k} は数で指定してください(指定値: ${v})`);
    }
    if (k === 'iter') spec.iterations = n;
    else if (k === 'ms') spec.ms = n;
    else if (k === 'horizon') tuning.horizonTurns = n;
    else if (k === 'chh') tuning.chargeHorizon = n;
    else if (k === 'prior') tuning.priorBonus = n;
    else if (k === 'c') tuning.treeC = n;
    else if (k === 'depth') tuning.treeDepth = n;
    else if (k.startsWith('w.')) weights[k.slice(2)] = n;
    else throw new Error(`未知の設定キー: ${k}`);
  }
  // 「強い」CPU の設定は、明示した z・prec より下(明示が優先)
  if (strong) Object.assign(tuning, { ...STRONG_TUNING, ...tuning });
  if (Object.keys(weights).length) tuning.weights = { ...tuning.weights, ...(weights as Partial<RewardWeights>) };
  if (modelPath) tuning.modelPath = modelPath;
  if (Object.keys(tuning).length) spec.tuning = tuning;
  return spec;
}

export function specLabel(spec: AgentSpec): string {
  const parts: string[] = [];
  if (spec.iterations !== undefined) parts.push(`iter=${spec.iterations}`);
  if (spec.ms !== undefined) parts.push(`ms=${spec.ms}`);
  const t = spec.tuning;
  if (t?.horizonTurns !== undefined) parts.push(`horizon=${t.horizonTurns}`);
  if (t?.chargeHorizon !== undefined) parts.push(`chh=${t.chargeHorizon}`);
  if (t?.priorBonus !== undefined) parts.push(`prior=${t.priorBonus}`);
  if (t?.algo !== undefined) parts.push(`algo=${t.algo}`);
  if (t?.treeC !== undefined) parts.push(`c=${t.treeC}`);
  if (t?.treeDepth !== undefined) parts.push(`depth=${t.treeDepth}`);
  if (t?.elimZ !== undefined) parts.push(`z=${t.elimZ}`);
  if (t?.precision !== undefined) parts.push(`prec=${t.precision}`);
  if (t?.minIterations !== undefined) parts.push(`minit=${t.minIterations}`);
  if (t?.halving !== undefined) parts.push(`sh=${t.halving ? 1 : 0}`);
  for (const [k, v] of Object.entries(t?.weights ?? {})) {
    if (k === 'model') continue;
    if (k === 'playModel') {
      parts.push('pm=on');
      continue;
    }
    if (k === 'lookahead') parts.push('lookahead=' + (v ? 1 : 0));
    else if (k === 'l1') for (const [kk, vv] of Object.entries(v as object)) parts.push('rl1.' + kk + '=' + vv);
    else parts.push(`w.${k}=${v}`);
  }
  if (spec.policy?.inferRevealed === false) parts.push('infer=0');
  if (spec.policy?.preset === 'full') parts.push('info=full');
  else if (spec.policy?.preset === 'partial' && spec.policy.reveal) {
    const r = spec.policy.reveal;
    const f = [r.opponentHandCount ? 'oh' : '', r.opponentShield ? 'os' : '', r.opponentDeck ? 'od' : '', r.ownShield ? 'ms' : '', r.ownDeck ? 'md' : ''].filter(Boolean);
    if (f.length) parts.push('info=' + f.join('+'));
  }
  if (t?.modelPath) parts.push(`value=${t.modelPath}`);
  for (const [k, v] of Object.entries(spec.l1 ?? {})) if (k !== 'playModel') parts.push('l1.' + k + '=' + v);
  return parts.length ? `${spec.kind}:${parts.join(',')}` : spec.kind;
}
