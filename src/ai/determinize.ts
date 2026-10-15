// 決定化(design 7.3): PlayerView の隠れたカード('?')に、あり得る中身を割り当てて、
// 実際に進められる状態を作る。相手の未公開カード = 既知のデッキリスト − 公開済みカード。
import type { Registry } from '../engine/registry';
import { cloneState } from '../engine/state';
import type { GameState, PlayerId } from '../engine/types';
import { kindsOf, type InfoPolicy } from '../engine/view';

export interface DetermOpts {
  rand: () => number;
  reg: Registry;
  policy: InfoPolicy;
  /** 相手のデッキリストが未知の時の候補(環境で想定されるデッキ) */
  candidateDecks?: string[][];
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function subtractKnown(list: string[], known: string[]): string[] {
  // known の各カードにつき、list の先頭側の同じ定義を1枚ずつ取り除く(定義の同じカードは区別がないので、先頭の k 枚を飛ばせばよい)
  if (known.length === 0) return list.slice();
  const skip = new Map<string, number>();
  for (const k of known) skip.set(k, (skip.get(k) ?? 0) + 1);
  const rest: string[] = [];
  for (const d of list) {
    const n = skip.get(d);
    if (n) skip.set(d, n - 1);
    else rest.push(d);
  }
  return rest;
}

export function determinize(view: GameState, me: PlayerId, o: DetermOpts): GameState {
  const s = cloneState(view);
  const opp = (1 - me) as PlayerId;
  const knownOf = (p: PlayerId) => s.cards.filter((c) => c.owner === p && c.defId !== '?').map((c) => c.defId);
  const unknownOf = (p: PlayerId) => {
    const out: number[] = [];
    const z = s.players[p];
    for (const u of [...z.hand, ...z.shield, ...z.deck]) if (s.cards[u].defId === '?') out.push(u);
    return out;
  };

  const assign = (p: PlayerId, list: string[], hypo?: string[]) => {
    const slots = unknownOf(p);
    if (slots.length === 0) return;
    const pool = subtractKnown(list, knownOf(p));
    // 決め打ち: 仮説のカードを手札の枠に先に置く
    const handSlots = slots.filter((u) => s.cards[u].zone === 'hand');
    const rest = new Set(slots);
    if (hypo && hypo.length) {
      const w = o.policy.hypothesisWeight ?? 0.7;
      for (const h of hypo) {
        const idx = pool.indexOf(h);
        if (idx < 0 || handSlots.length === 0) continue;
        if (o.rand() > w) continue;
        const slot = handSlots.shift()!;
        s.cards[slot].defId = h;
        rest.delete(slot);
        pool.splice(idx, 1);
      }
    }
    const open = [...rest];
    // 手札の種類が部分開示されている場合は、満たす割り当てを試す(棄却サンプリング)
    const want = p === opp ? view.hints?.oppHandKinds : undefined;
    let best: string[] = [];
    for (let tries = 0; tries < (want ? 60 : 1); tries++) {
      let cand = shuffled(pool, o.rand);
      // 山札の枚数が合わない場合は、足りない分を全体から補う
      while (cand.length < open.length) cand = cand.concat(shuffled(list, o.rand));
      cand = cand.slice(0, open.length);
      best = cand;
      if (!want) break;
      const handIdx = open.map((u, i) => (s.cards[u].zone === 'hand' ? i : -1)).filter((i) => i >= 0);
      const cnt: Record<string, number> = {};
      for (const k of Object.keys(want)) cnt[k] = 0;
      for (const i of handIdx) for (const k of kindsOf(o.reg, cand[i])) if (k in cnt) cnt[k]++;
      for (const u of s.players[opp].hand) {
        if (!open.includes(u) && s.cards[u].defId !== '?') for (const k of kindsOf(o.reg, s.cards[u].defId)) if (k in cnt) cnt[k]++;
      }
      if (Object.keys(want).every((k) => cnt[k] === want[k])) break;
    }
    open.forEach((u, i) => (s.cards[u].defId = best[i]));
  };

  // 自分のデッキ・シールド
  const myList = s.deckIds[me].length ? s.deckIds[me] : knownOf(me);
  assign(me, myList);
  // 相手
  let oppList = s.deckIds[opp];
  if (oppList.length === 0) {
    const seen = knownOf(opp);
    const cands = (o.candidateDecks ?? []).filter((d) => subtractKnown(d, seen).length === d.length - seen.length);
    oppList = cands.length ? cands[Math.floor(o.rand() * cands.length)] : myList;
  }
  const hypo =
    o.policy.preset === 'hypothesis'
      ? (o.policy.hypotheses ?? []).filter((h) => (h.zone ?? 'hand') === 'hand').map((h) => h.defId)
      : undefined;
  assign(opp, oppList, hypo);
  s.rng = Math.floor(o.rand() * 0x7fffffff) | 1;
  s.hints = undefined;
  return s;
}
