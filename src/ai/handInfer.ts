// 実験: 公開情報(相手の過去のターンの行動)から、相手の手札にあるカードを読む。
// 相手のデッキリストが既知なら、シールド・山札の中身は一様(事後分布は数え上げで決まる)。
// 読めるのは「相手が選んで持っている手札」だけ: 出せるのに出していない札は、手札にない見込みが高い。
import type { Registry } from '../engine/registry';
import type { Civ, GameState, PlayerId } from '../engine/types';

/** 相手の1ターン分の公開記録(ターンの終わりに取る) */
export interface TurnRecord {
  /** そのターンの終わりのマナの総数 */
  mana: number;
  /** そのうち、アンタップのまま残したマナの数 */
  untapped: number;
  /** マナにある文明(ビット: 光1 水2 闇4 火8 自然16) */
  allCivs: number;
  /** アンタップのマナにある文明 */
  untappedCivs: number;
}

const CIV_BIT: Record<string, number> = { light: 1, water: 2, darkness: 4, fire: 8, nature: 16 };
export const civMask = (civs: Civ[]): number => civs.reduce((m, c) => m | (CIV_BIT[c] ?? 0), 0);

/** ターンの終わりの直前の状態から、そのターンの記録を作る */
export function turnRecord(s: GameState, who: PlayerId, reg: Registry): TurnRecord {
  let allCivs = 0;
  let untappedCivs = 0;
  let untapped = 0;
  for (const u of s.players[who].mana) {
    const c = s.cards[u];
    const m = civMask(reg.defs[c.defId].faces.flatMap((f) => f.civs));
    allCivs |= m;
    if (!c.tapped) {
      untapped++;
      untappedCivs |= m;
    }
  }
  return { mana: s.players[who].mana.length, untapped, allCivs, untappedCivs };
}

export const FEATURE_NAMES = [
  'cost',
  'spell',
  'shieldTrigger',
  'blocker',
  'turnsAfforded',
  'turnsUnusedAfforded',
  'lastUnusedAfforded',
  'turnsUnusedAffordedCivOk',
  'nowAfford',
  'untappedAfforded',
] as const;
export const N_FEATURES = FEATURE_NAMES.length;

interface DefStat {
  cost: number;
  civs: number;
  spell: number;
  st: number;
  blocker: number;
}
const statCache = new WeakMap<Registry, Map<string, DefStat>>();
export function defStat(reg: Registry, defId: string): DefStat {
  let m = statCache.get(reg);
  if (!m) statCache.set(reg, (m = new Map()));
  let r = m.get(defId);
  if (!r) {
    const d = reg.defs[defId];
    let cost = Infinity;
    let civs = 0;
    let spell = 1;
    let st = 0;
    let blocker = 0;
    d.faces.forEach((f, i) => {
      cost = Math.min(cost, f.cost);
      civs |= civMask(f.civs);
      if (f.type !== 'spell') spell = 0;
      const info = reg.getInfo(defId, i);
      if (info.shieldTriggers.length > 0) st = 1;
      if (info.blocker) blocker = 1;
    });
    r = { cost: cost === Infinity ? 0 : cost, civs, spell, st, blocker };
    m.set(defId, r);
  }
  return r;
}

/** カード defId が、相手の手札にある見込みの特徴量(相手の記録 hist と、今の相手のマナの数 manaNow・アンタップ数) */
export function handFeatures(reg: Registry, defId: string, hist: TurnRecord[], now: TurnRecord): number[] {
  const st = defStat(reg, defId);
  let afforded = 0;
  let unused = 0;
  let unusedCiv = 0;
  for (const r of hist) {
    const colorsOk = (r.allCivs & st.civs) !== 0;
    if (r.mana >= st.cost && colorsOk) afforded++;
    if (r.untapped >= st.cost) {
      unused++;
      if ((r.untappedCivs & st.civs) !== 0) unusedCiv++;
    }
  }
  const last = hist.length ? hist[hist.length - 1] : null;
  const lastUnused = last && last.untapped >= st.cost && (last.untappedCivs & st.civs) !== 0 ? 1 : 0;
  return [
    st.cost / 10,
    st.spell,
    st.st,
    st.blocker,
    afforded / 5,
    unused / 5,
    lastUnused,
    unusedCiv / 5,
    now.mana >= st.cost && (now.allCivs & st.civs) !== 0 ? 1 : 0,
    now.untapped >= st.cost && (now.untappedCivs & st.civs) !== 0 ? 1 : 0,
  ];
}
