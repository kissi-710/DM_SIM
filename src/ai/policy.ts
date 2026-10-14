// 情報条件(InfoPolicy)の作成と、決め打ち(仮説)のカード名の解決。画面・CLI で共通に使う。
import type { CardDB } from '../engine/types';
import type { InfoPolicy, InfoPreset } from '../engine/view';

/** 部分開示の既定: 相手の手札のうち 2 枚の中身と、S・トリガー/ブロッカーの枚数を知る */
export const PARTIAL_REVEAL = { opponentHandCount: 2, opponentHandKinds: ['shieldTrigger', 'blocker'] } as const;

/** 仮説のカードを手札に置く確率の既定 */
export const DEFAULT_HYPOTHESIS_WEIGHT = 0.6;

export interface PolicyOpts {
  /** 決め打ち(hypothesis)の仮説: 「相手はこのカードを手札に持っている」(カードID) */
  hypotheses?: string[];
  /** 仮説のカードを手札に置く確率(0〜1) */
  weight?: number;
  /** 相手のデッキリストを知っているか(既定 true) */
  knowOpponentDecklist?: boolean;
}

/** プリセットから情報条件を作る。決め打ちの仮説は hypotheses で渡す(空なら公平と同じ挙動になる) */
export function makePolicy(preset: InfoPreset, o: PolicyOpts = {}): InfoPolicy {
  return {
    preset,
    knowOpponentDecklist: o.knowOpponentDecklist ?? true,
    reveal: preset === 'partial' ? { opponentHandCount: PARTIAL_REVEAL.opponentHandCount, opponentHandKinds: [...PARTIAL_REVEAL.opponentHandKinds] } : undefined,
    hypotheses: preset === 'hypothesis' ? (o.hypotheses ?? []).map((defId) => ({ defId })) : undefined,
    hypothesisWeight: preset === 'hypothesis' ? (o.weight ?? DEFAULT_HYPOTHESIS_WEIGHT) : undefined,
  };
}

/** カードID・カード名・面の名前・名前の一部から、カードIDを引く(見つからなければ undefined) */
export function resolveCardId(db: CardDB, name: string): string | undefined {
  const n = name.trim();
  if (!n) return undefined;
  if (db[n]) return n;
  const defs = Object.values(db).filter((d) => d.id !== '?' && d.id !== 'dummy');
  return (
    defs.find((d) => d.name === n || d.faces.some((f) => f.name === n))?.id ??
    defs.find((d) => d.name.includes(n) || d.faces.some((f) => f.name.includes(n)))?.id
  );
}

export interface HypothesisCheck {
  ids: string[];
  /** 該当するカードがなかった名前 */
  unknown: string[];
  /** 相手のデッキに入っていないカード(決定化で無視される) */
  notInDeck: string[];
}

/**
 * 決め打ちの仮説(カード名の並び)を、カードIDに解決して検査する。
 * 相手のデッキ(カードID列)を渡すと、デッキにないカードも報告する。
 */
export function checkHypotheses(db: CardDB, names: string[], opponentDeck?: string[]): HypothesisCheck {
  const ids: string[] = [];
  const unknown: string[] = [];
  const notInDeck: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const id = resolveCardId(db, name);
    if (!id) unknown.push(name);
    else {
      if (!ids.includes(id)) ids.push(id);
      if (opponentDeck && !opponentDeck.includes(id)) notInDeck.push(name);
    }
  }
  return { ids, unknown, notInDeck };
}

/** 画面・CLI に出す、仮説の問題点(なければ空)。決め打ちを選んでいる時だけ検査する */
export function hypothesisProblems(c: HypothesisCheck, label = '決め打ち'): string[] {
  const out: string[] = [];
  if (c.unknown.length) out.push(`${label}: 該当するカードがありません: ${c.unknown.join('、')}`);
  if (c.ids.length === 0 && c.unknown.length === 0) out.push(`${label}: 相手が持っていそうなカードを1枚以上入れてください(空だと、公平と同じになります)`);
  if (c.notInDeck.length) out.push(`${label}: 相手のデッキに入っていないカードです(無視されます): ${c.notInDeck.join('、')}`);
  return out;
}
