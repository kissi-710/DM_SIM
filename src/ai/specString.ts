// AI の設定を文字列で書く(CLI の測定用): 「種類」または「種類:キー=値,キー=値」。
//   rule / random
//   mcts:iter=120,horizon=3,prior=0.005,w.mana=3.5
// キー: algo=flat|tree|ptree c(木の探索定数) depth(木の深さ) iter(反復回数) ms(最大思考時間) horizon(先読みターン数。99でゲーム終了まで) prior(L1の手への上乗せ) w.<重み名>
//       value=<パス>(学習した価値関数の JSON。trainValue の出力。Node の CLI 専用)
import { readFileSync } from 'node:fs';
import type { AgentKind, AgentSpec, AiTuning } from './index';
import type { RewardWeights } from './eval';

const KINDS: AgentKind[] = ['random', 'rule', 'mcts', 'pass'];

export function parseSpec(text: string): AgentSpec {
  const [kindRaw, rest = ''] = text.trim().split(':', 2) as [string, string?];
  if (!(KINDS as string[]).includes(kindRaw)) throw new Error(`AI の種類が不正です: ${kindRaw}(${KINDS.join(' / ')})`);
  const spec: AgentSpec = { kind: kindRaw as AgentKind };
  const tuning: AiTuning = {};
  const weights: Record<string, number> = {};
  let modelPath: string | undefined;
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
    if (k === 'algo') {
      if (v !== 'flat' && v !== 'tree' && v !== 'ptree') throw new Error('algo は flat / tree / ptree のどれかです');
      tuning.algo = v;
      continue;
    }
    if (k === 'iter' || k === 'ms' || k === 'horizon' || k === 'prior' || k === 'c' || k === 'depth' || k.startsWith('w.')) {
      if (!Number.isFinite(n)) throw new Error(`${k} は数で指定してください(指定値: ${v})`);
    }
    if (k === 'iter') spec.iterations = n;
    else if (k === 'ms') spec.ms = n;
    else if (k === 'horizon') tuning.horizonTurns = n;
    else if (k === 'prior') tuning.priorBonus = n;
    else if (k === 'c') tuning.treeC = n;
    else if (k === 'depth') tuning.treeDepth = n;
    else if (k.startsWith('w.')) weights[k.slice(2)] = n;
    else throw new Error(`未知の設定キー: ${k}`);
  }
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
  if (t?.priorBonus !== undefined) parts.push(`prior=${t.priorBonus}`);
  if (t?.algo !== undefined) parts.push(`algo=${t.algo}`);
  if (t?.treeC !== undefined) parts.push(`c=${t.treeC}`);
  if (t?.treeDepth !== undefined) parts.push(`depth=${t.treeDepth}`);
  for (const [k, v] of Object.entries(t?.weights ?? {})) {
    if (k === 'model') continue;
    if (k === 'lookahead') parts.push('lookahead=' + (v ? 1 : 0));
    else if (k === 'l1') for (const [kk, vv] of Object.entries(v as object)) parts.push('rl1.' + kk + '=' + vv);
    else parts.push(`w.${k}=${v}`);
  }
  if (t?.modelPath) parts.push(`value=${t.modelPath}`);
  for (const [k, v] of Object.entries(spec.l1 ?? {})) parts.push('l1.' + k + '=' + v);
  return parts.length ? `${spec.kind}:${parts.join(',')}` : spec.kind;
}
