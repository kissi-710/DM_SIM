// AI の設定を文字列で書く(CLI の測定用): 「種類」または「種類:キー=値,キー=値」。
//   rule / random
//   mcts:iter=120,horizon=3,prior=0.005,w.mana=3.5
// キー: iter(反復回数) ms(最大思考時間) horizon(先読みターン数。99でゲーム終了まで) prior(L1の手への上乗せ) w.<重み名>
import type { AgentKind, AgentSpec, AiTuning } from './index';
import type { EvalWeights } from './eval';

const KINDS: AgentKind[] = ['random', 'rule', 'mcts', 'pass'];

export function parseSpec(text: string): AgentSpec {
  const [kindRaw, rest = ''] = text.trim().split(':', 2) as [string, string?];
  if (!(KINDS as string[]).includes(kindRaw)) throw new Error(`AI の種類が不正です: ${kindRaw}(${KINDS.join(' / ')})`);
  const spec: AgentSpec = { kind: kindRaw as AgentKind };
  const tuning: AiTuning = {};
  const weights: Record<string, number> = {};
  for (const kv of rest.split(',').filter((x) => x.trim() !== '')) {
    const [k, v] = kv.split('=');
    const n = Number(v);
    if (!k || v === undefined || v === '') throw new Error(`設定は キー=値 の形で書いてください: ${kv}`);
    if (k === 'iter' || k === 'ms' || k === 'horizon' || k === 'prior' || k.startsWith('w.')) {
      if (!Number.isFinite(n)) throw new Error(`${k} は数で指定してください(指定値: ${v})`);
    }
    if (k === 'iter') spec.iterations = n;
    else if (k === 'ms') spec.ms = n;
    else if (k === 'horizon') tuning.horizonTurns = n;
    else if (k === 'prior') tuning.priorBonus = n;
    else if (k.startsWith('w.')) weights[k.slice(2)] = n;
    else throw new Error(`未知の設定キー: ${k}`);
  }
  if (Object.keys(weights).length) tuning.weights = weights as Partial<EvalWeights>;
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
  for (const [k, v] of Object.entries(t?.weights ?? {})) parts.push(`w.${k}=${v}`);
  return parts.length ? `${spec.kind}:${parts.join(',')}` : spec.kind;
}
