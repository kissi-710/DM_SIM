// 呪文が「相手のクリーチャーがいなければ空振りになる」かを、カードのデータ(AST)から判定する。
// L1(ルールベース)が、相手の盤面が空の時に、空振りしやすい呪文を避けるために使う。
// (旧: カードの説明文を正規表現 /戻|破壊|選び/ で判定していた。文面・カードが変わると効かず、
//  G・ストライクの文言や、対象を取らない効果の「選び」にも反応していた)
import type { Registry } from '../engine/registry';

interface Step {
  op: string;
  from?: { zone?: unknown; owner?: string };
  min?: number;
  act?: Record<string, { sel?: unknown } | unknown>;
  options?: { steps?: Step[] }[];
  allIf?: unknown;
}

const isOppBattle = (sel: unknown): boolean => {
  if (!sel || typeof sel !== 'object') return false;
  const s = sel as { zone?: unknown; owner?: string };
  return (s.zone === 'battle' || (Array.isArray(s.zone) && s.zone.length === 1 && s.zone[0] === 'battle')) && s.owner === 'opponent';
};

/** 手順の先頭から見て、相手のクリーチャーがいなければ、何も起こらない(最初の効果が、その対象を要する)か */
function dependsOnOppCreature(steps: Step[] | undefined): boolean {
  for (const st of steps ?? []) {
    if (st.op === 'select') {
      if (isOppBattle(st.from) && (st.min ?? 1) >= 1) return true;
      continue; // 選ぶだけでは何も起こらない。後の効果を見る
    }
    if (st.op === 'act') {
      const body = Object.values(st.act ?? {})[0] as { sel?: unknown } | undefined;
      // 「相手のクリーチャーすべて」のように、セレクタで直接指定する効果
      return !!body && typeof body === 'object' && isOppBattle(body.sel);
    }
    if (st.op === 'modes') {
      // すべての選択肢が対象を要するときだけ。1つでも対象なしで使えるものがあれば、空振りにならない
      const opts = st.options ?? [];
      return !st.allIf && opts.length > 0 && opts.every((o) => dependsOnOppCreature(o.steps));
    }
    return false; // may / if / each など。単純に効果があるものとして扱う
  }
  return false;
}

const cache = new WeakMap<Registry, Map<string, boolean>>();

/** 呪文面(faceIdx)が、相手のクリーチャーがいなければ空振りになるか */
export function spellNeedsOpponentCreature(reg: Registry, defId: string, faceIdx: number): boolean {
  let m = cache.get(reg);
  if (!m) cache.set(reg, (m = new Map()));
  const key = defId + ':' + faceIdx;
  let r = m.get(key);
  if (r === undefined) {
    const face = reg.defs[defId]?.faces[faceIdx];
    r = !!face && face.abilities.some((a) => a.kind === 'spell' && dependsOnOppCreature(a.steps as unknown as Step[]));
    m.set(key, r);
  }
  return r;
}
