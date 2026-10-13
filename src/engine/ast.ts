// カード能力のAST(effects 6)。カードJSONはこの形で書く。

import type { Civ, ZoneName, EffectMod } from './types';

export type Expr =
  | number
  | { var: string }
  | { count: Selector }
  | { costOf: string }
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { min: Expr[] }
  | { max: Expr[] };

export interface Selector {
  zone: ZoneName | ZoneName[];
  /** 能力の処理者から見た持ち主。'iter' は forPlayers の現在のプレイヤー */
  owner?: 'self' | 'opponent' | 'any' | 'iter';
  type?: 'creature' | 'spell' | 'card';
  where?: Cond;
  /** 「選ぶ」対象か(ジャストダイバー等の判定を行う) */
  chooseable?: boolean;
  notSelf?: boolean;
  /** 除外する変数(参照のリスト) */
  except?: string;
  /** 候補を、この変数が指すカードに限る(lookTop で見たカードなど) */
  of?: string;
}

/** 条件。1キーのオブジェクトとして書く(評価は cond.ts)。$it = 判定対象のカード */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { civ: Civ }
  | { civsAll: Civ[] }
  | { multicolor: boolean }
  | { cost: { eq?: Expr; lt?: Expr; lte?: Expr; gt?: Expr; gte?: Expr } }
  | { power: { lte?: number; gte?: number } }
  | { type: 'creature' | 'spell' }
  | { evolution: boolean }
  | { race: string }
  | { tapped: boolean }
  | { sameCivAs: string }
  | { cmp: { l: Expr; op: '<' | '<=' | '>' | '>=' | '==' | '!='; r: Expr } }
  | { count: Selector; gte?: number; lte?: number; eq?: number }
  | { fiveCivs: Selector }
  | { civsPresent: { sel: Selector; civs: Civ[] } }
  | { logged: { pattern: { [k: string]: any }; min?: number } }
  | { shields: { lte?: number; eq?: number; gte?: number } }
  | { notInBattle: boolean }
  | { nonEmpty: string }
  | { turnOf: 'self' | 'opponent' }
  | { zoneIs: ZoneName }
  | { true: true };

export type ActDef = { [act: string]: any };

export type StepDef =
  | { op: 'act'; act: ActDef }
  | {
      op: 'select';
      as: string;
      who?: 'controller' | 'opponent' | 'iter';
      from: Selector | { var: string };
      min?: Expr;
      max?: Expr;
      random?: boolean;
      prompt?: string;
    }
  | { op: 'may'; then: StepDef[]; else?: StepDef[]; prompt?: string }
  | { op: 'if'; cond: Cond; then: StepDef[]; else?: StepDef[] }
  | { op: 'each'; in: string; as: string; body: StepDef[] }
  | { op: 'repeat'; times: Expr; body: StepDef[] }
  | {
      op: 'modes';
      pick: number;
      repeat?: boolean;
      allIf?: Cond;
      who?: 'controller' | 'opponent';
      options: { label: string; steps: StepDef[] }[];
    }
  | { op: 'forPlayers'; body: StepDef[] }
  | { op: 'custom'; handler: string; args?: any };

export type Pattern = { type: string; [k: string]: any };

export interface TriggerSpec {
  on: Pattern | Pattern[];
  watch?: ZoneName[];
  subject?: 'self' | 'other' | 'any';
  turn?: 'own' | 'opponent' | 'any';
  nthThisTurn?: number;
  limit?: { perTurn: number };
  if?: Cond;
  ifAtResolve?: Cond;
}

export type KeywordName =
  | 'blocker'
  | 'breaker'
  | 'shieldTrigger'
  | 'gStrike'
  | 'speedAttacker'
  | 'machFighter'
  | 'exLife'
  | 'justDiver'
  | 'sympathy'
  | 'hyperEnergy'
  | 'yobinion'
  | 'invasion';

export type StaticMod =
  | { type: 'costDelta'; delta: number; cond: Cond }
  | { type: 'cannotAttackPlayerWhenEntered' }
  | { type: 'cannotCast'; cond: Cond }
  | { type: 'powerAdd'; n: number };

export type ReplaceApply =
  | { type: 'changeDest'; to: ZoneName }
  | { type: 'cancelTrigger' }
  | { type: 'smaxSacrifice' };

export type Ability =
  | { kind: 'keyword'; name: KeywordName; n?: number; while?: Cond; steps?: StepDef[]; attacker?: Cond; label?: string }
  | { kind: 'trigger'; spec: TriggerSpec; optional?: boolean; steps: StepDef[]; label?: string }
  | { kind: 'spell'; steps: StepDef[] }
  | { kind: 'static'; mod: StaticMod; while?: Cond }
  | { kind: 'replace'; match: Pattern; apply: ReplaceApply; optional?: boolean; while?: Cond; label?: string }
  | { kind: 'permission'; play: 'summon' | 'cast'; from: ZoneName; after?: 'deckBottom' };

export type { EffectMod };
