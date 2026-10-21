// カード定義を短く書くためのビルダー(25の王道 全デッキ。docs/decks-25oudou.md)。
// 出力は engine/ast.ts のASTそのもの(データ)。cards.json と同じ形の CardDef を作る。
import type { Ability, ActDef, Cond, Expr, KeywordName, Selector, StepDef, TriggerSpec } from '../engine/ast';
import type { CardDef, Civ, Face, FaceType } from '../engine/types';

// ───────────────────────── 文明・面 ─────────────────────────

const CIV: Record<string, Civ> = { L: 'light', W: 'water', D: 'darkness', F: 'fire', N: 'nature' };

/** 'WDN' → ['water','darkness','nature'] */
export function civsOf(s: string): Civ[] {
  return [...s].map((ch) => {
    const c = CIV[ch];
    if (!c) throw new Error('未知の文明記号: ' + ch);
    return c;
  });
}

export interface FaceOpts {
  evolveFrom?: Cond;
}

/** クリーチャー面。civs は 'WDN' のような文字列(無色は '')。power はパワー。 */
export function creature(name: string, cost: number, civs: string, power: number, races: string[], abilities: Ability[], o: FaceOpts = {}): Face {
  return { name, type: 'creature', cost, civs: civsOf(civs), power, races, abilities, ...o };
}

/** 進化クリーチャー面(evolveFrom は進化元の条件。$it = 重ねる対象) */
export function evolution(name: string, cost: number, civs: string, power: number, races: string[], evolveFrom: Cond, abilities: Ability[], type: FaceType = 'evolution'): Face {
  return { name, type, cost, civs: civsOf(civs), power, races, abilities, evolveFrom };
}

/** 呪文面。steps は呪文の効果。abilities は S・トリガーなどのキーワード */
export function spell(name: string, cost: number, civs: string, abilities: Ability[], steps: StepDef[], races?: string[]): Face {
  return { name, type: 'spell', cost, civs: civsOf(civs), ...(races ? { races } : {}), abilities: [...abilities, { kind: 'spell', steps }] };
}

/** フィールド面 */
export function field(name: string, cost: number, civs: string, abilities: Ability[], races?: string[]): Face {
  return { name, type: 'field', cost, civs: civsOf(civs), ...(races ? { races } : {}), abilities };
}

/** タマシード面(power はクリーチャーとして扱う時のパワー。通常は 0) */
export function tamaseed(name: string, cost: number, civs: string, races: string[], abilities: Ability[], power = 0): Face {
  return { name, type: 'tamaseed', cost, civs: civsOf(civs), power, races, abilities };
}

/** カード定義。名前は面の名前を ' / ' でつなぐ(ツインパクト) */
export function card(id: string, ...faces: Face[]): CardDef {
  return { id, name: faces.map((f) => f.name).join(' / '), faces };
}

// ───────────────────────── キーワード ─────────────────────────

const kw = (name: KeywordName, extra: Partial<Extract<Ability, { kind: 'keyword' }>> = {}): Ability => ({ kind: 'keyword', name, ...extra });
export const blocker = (): Ability => kw('blocker');
export const breaker = (n: number, whileCond?: Cond): Ability => kw('breaker', { n, ...(whileCond ? { while: whileCond } : {}) });
export const wBreaker = (): Ability => breaker(2);
export const tBreaker = (): Ability => breaker(3);
export const sTrigger = (whileCond?: Cond): Ability => kw('shieldTrigger', whileCond ? { while: whileCond } : {});
export const gStrike = (): Ability => kw('gStrike');
export const speedAttacker = (): Ability => kw('speedAttacker');
export const machFighter = (): Ability => kw('machFighter');
export const slayer = (): Ability => kw('slayer');
export const justDiver = (): Ability => kw('justDiver');
export const exLife = (): Ability => kw('exLife');
export const yobinion = (): Ability => kw('yobinion');
export const hyperEnergy = (): Ability => kw('hyperEnergy');
export const sympathy = (): Ability => kw('sympathy');

/** 革命チェンジ[attacker の条件を満たす攻撃クリーチャーと入れ替える] */
export const revolutionChange = (label: string, attacker: Cond): Ability => kw('revolutionChange', { label, attacker });
/** 侵略[attacker] */
export const invasion = (label: string, attacker: Cond): Ability => kw('invasion', { label, attacker });

// ───────────────────────── 誘発型・常在型能力 ─────────────────────────

export interface TrigOpts {
  optional?: boolean;
  label?: string;
}

export const trig = (spec: TriggerSpec, steps: StepDef[], o: TrigOpts = {}): Ability => ({ kind: 'trigger', spec, steps, ...o });

/** このクリーチャーが出た時 */
export const cip = (steps: StepDef[], o: TrigOpts & { if?: Cond; ifAtResolve?: Cond; via?: string; turn?: 'own' | 'opponent' } = {}): Ability => {
  const { if: cnd, ifAtResolve, via, turn, ...rest } = o;
  return trig(
    { on: { type: 'entered', ...(via ? { via } : {}) }, subject: 'self', ...(turn ? { turn } : {}), ...(cnd ? { if: cnd } : {}), ...(ifAtResolve ? { ifAtResolve } : {}) },
    steps,
    rest,
  );
};

/** このクリーチャーが攻撃する時 */
export const onAttack = (steps: StepDef[], o: TrigOpts & { if?: Cond } = {}): Ability => {
  const { if: cnd, ...rest } = o;
  return trig({ on: { type: 'attackDeclared' }, subject: 'self', ...(cnd ? { if: cnd } : {}) }, steps, rest);
};

export const staticAb = (mod: Extract<Ability, { kind: 'static' }>['mod'], whileCond?: Cond): Ability => ({ kind: 'static', mod, ...(whileCond ? { while: whileCond } : {}) });

// ───────────────────────── ステップ ─────────────────────────

export const act = (a: ActDef): StepDef => ({ op: 'act', act: a });
export const draw = (n: Expr = 1): StepDef => act({ draw: n });
export const maybe = (then: StepDef[], prompt?: string, els?: StepDef[]): StepDef => ({ op: 'may', then, ...(els ? { else: els } : {}), ...(prompt ? { prompt } : {}) });
export const ifc = (cond: Cond, then: StepDef[], els?: StepDef[]): StepDef => ({ op: 'if', cond, then, ...(els ? { else: els } : {}) });
export const log = (marker: string): StepDef => act({ log: marker });

export interface SelOpts {
  min?: Expr;
  max?: Expr;
  who?: 'controller' | 'opponent' | 'iter';
  random?: boolean;
  prompt?: string;
}
/** 対象を選ぶ。既定は1枚(min=max=1) */
export const select = (as: string, from: Selector | { var: string }, o: SelOpts = {}): StepDef => ({ op: 'select', as, from, min: o.min ?? 1, max: o.max ?? 1, ...(o.who ? { who: o.who } : {}), ...(o.random ? { random: true } : {}), ...(o.prompt ? { prompt: o.prompt } : {}) });
/** 0枚〜max 枚を選ぶ(選ばなくてもよい) */
export const selectUpTo = (as: string, from: Selector | { var: string }, max: Expr = 1, o: SelOpts = {}): StepDef => select(as, from, { ...o, min: 0, max });

/** 場の相手のクリーチャー(選べるもの) */
export const oppCreature = (where?: Cond): Selector => ({ zone: 'battle', owner: 'opponent', type: 'creature', chooseable: true, ...(where ? { where } : {}) });
export const myCreature = (where?: Cond): Selector => ({ zone: 'battle', owner: 'self', type: 'creature', ...(where ? { where } : {}) });

/** 山札の上 n 枚をマナゾーンへ(タップして置く場合は tapped) */
export const toMana = (n: Expr = 1, tapped = false): StepDef => act({ moveTop: { n, to: 'mana', cause: 'effect', ...(tapped ? { tapped: true } : {}) } });
export const bounce = (sel: string | Selector): StepDef => act({ move: { sel, to: 'hand', cause: 'bounce' } });
export const destroy = (sel: string | Selector): StepDef => act({ move: { sel, to: 'grave', cause: 'destroy' } });

// ───────────────────────── 条件の短縮形 ─────────────────────────

export const civ = (c: string): Cond => ({ civ: civsOf(c)[0] });
export const anyCiv = (cs: string): Cond => ({ any: civsOf(cs).map((c) => ({ civ: c })) });
export const race = (r: string): Cond => ({ race: r });
export const costLte = (n: Expr): Cond => ({ cost: { lte: n } });
export const costGte = (n: Expr): Cond => ({ cost: { gte: n } });
export const and = (...cs: Cond[]): Cond => ({ all: cs });
export const or = (...cs: Cond[]): Cond => ({ any: cs });
export const not = (c: Cond): Cond => ({ not: c });
export const isCreature: Cond = { type: 'creature' };
export const notEvolution: Cond = { evolution: false };

// ───────────────────────── よく使う手順 ─────────────────────────

/** 数字を1つ選び、変数 as に入れる(lo〜hi) */
export const chooseNumber = (as: string, lo: number, hi: number): StepDef => ({
  op: 'modes',
  pick: 1,
  options: Array.from({ length: hi - lo + 1 }, (_, i) => ({ label: String(lo + i), steps: [act({ setVar: { as, value: lo + i } })] })),
});

/** ファイナル革命: 革命チェンジで出た時、そのターンに他のファイナル革命を使っていなければ */
export const finalRevolution = (steps: StepDef[]): Ability =>
  trig(
    {
      on: { type: 'entered', via: 'revolutionChange' },
      subject: 'self',
      ifAtResolve: { not: { logged: { pattern: { type: 'finalRevolution' } } } },
    },
    [log('finalRevolution'), ...steps],
    { label: 'ファイナル革命' },
  );

/** シールドが1つもないプレイヤーがいる(鬼エンド) */
export const noShieldPlayer: Cond = { any: [{ shields: { eq: 0 } }, { shields: { eq: 0, who: 'opponent' } }] };
/** 自分のマナゾーンに、指定の文明('DF' など)がそろっている */
export const manaHas = (cs: string): Cond => ({ civsPresent: { sel: { zone: 'mana', owner: 'self' }, civs: civsOf(cs) } });

/** ハイパー化(他のクリーチャーを n 体タップして、ハイパーモードを解放する) */
export const hyperize = (tapOther = 1): Ability => ({ kind: 'hyperize', tapOther });
/** ハイパーモード中だけ有効にする条件 */
export const hyperMode: Cond = { hyper: true };
/** シンカライズ */
export const shinkalize = (): Ability => ({ kind: 'shinkalize' });
