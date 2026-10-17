// 表示用の整形: カード名・文明の色・イベントの日本語化・因果ツリー(effects 11.4)。
import { CARD_DB } from '../cards';
import { charsOf } from '../engine/derive';
import { loadRegistry } from '../engine/registry';
import { mkCtx } from '../engine/state';
import type { Civ, Duration, Ev, GameState, ZoneName } from '../engine/types';

export const reg = loadRegistry(CARD_DB);

export const CIV_COLOR: Record<Civ, string> = {
  light: '#f2d44f',
  water: '#4ba3ee',
  darkness: '#7a5c99',
  fire: '#e8553d',
  nature: '#4bae5a',
};
export const CIV_NAME: Record<Civ, string> = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然' };

export const ZONE_NAME: Record<ZoneName, string> = {
  deck: '山札',
  hand: '手札',
  mana: 'マナゾーン',
  shield: 'シールド',
  battle: 'バトルゾーン',
  grave: '墓地',
  hyper: '超次元ゾーン',
  limbo: '(処理中)',
};

export function defName(defId: string): string {
  return reg.defs[defId]?.name ?? '？';
}

export function cardName(s: GameState, uid: number): string {
  const c = s.cards[uid];
  if (!c) return '？';
  if (c.defId === '?') return '(裏向き)';
  const def = reg.defs[c.defId];
  if (c.zone === 'battle' || c.zone === 'limbo') return def.faces[c.face]?.name ?? def.name;
  return def.name.split(' / ')[0];
}

/** 画面表示用の短い名前(ツインパクトは面の名前) */
export function shortName(s: GameState, uid: number): string {
  return cardName(s, uid);
}

export function civsOf(s: GameState, uid: number): Civ[] {
  const c = s.cards[uid];
  if (!c || c.defId === '?') return [];
  return charsOf(mkCtx(s, reg), uid, -1).civs;
}

export function playerLabel(p: number, me: number | null): string {
  if (me === null) return `プレイヤー${p + 1}`;
  return p === me ? 'あなた' : '相手';
}

// ───────────────────────── イベントの日本語化 ─────────────────────────


export function describeEvent(s: GameState, e: Ev, me: number | null): string | null {
  const P = (p: number) => playerLabel(p, me);
  const N = (u: number) => cardName(s, u);
  switch (e.type) {
    case 'stepStart':
      return e.step === 'start' ? `── ${P(e.player)}のターン(${Math.ceil(e.turn / 2)}ターン目)──` : e.step === 'end' ? `${P(e.player)}のターン終了` : null;
    case 'moved': {
      if (e.underneath) return null;
      const from = ZONE_NAME[e.from as ZoneName];
      const to = ZONE_NAME[e.to as ZoneName];
      const cause: Record<string, string> = {
        draw: 'ドロー',
        charge: 'マナチャージ',
        boost: 'ブースト',
        destroy: '破壊',
        bounce: '手札に戻る',
        discard: '捨てる',
        break: 'ブレイク',
        manaPlace: 'マナに置く',
        trash: '墓地へ',
        exLifeSwap: 'EXライフ',
        summon: '召喚',
        cast: '唱え終わる',
      };
      if (e.cause === 'draw') return `${P(e.owner)}はカードを1枚引いた`;
      if (e.cause === 'charge') return `${P(e.owner)}は ${e.lki?.defId && e.owner === me ? N(e.card) : N(e.card)} をマナゾーンに置いた`;
      if (e.to === 'battle') return null; // entered で表示
      if (e.to === 'limbo') return null;
      const name = e.owner === me || e.from !== 'deck' ? N(e.card) : 'カード';
      return `${name}: ${from} → ${to}${cause[e.cause] ? `(${cause[e.cause]})` : ''}`;
    }
    case 'entered':
      return `${P(e.owner)}の ${N(e.card)} が出た${e.via === 'summon' ? '(召喚)' : e.via === 'invade' ? '(侵略)' : e.via === 'effect' ? '' : ''}`;
    case 'evolved':
      return `${N(e.card)} が重なった`;
    case 'cast':
      return `${P(e.owner)}は ${N(e.card)} を唱えた${e.free ? '(コストを支払わない)' : ''}`;
    case 'attackDeclared':
      return `${P(e.owner)}の ${N(e.card)} が${e.target?.kind === 'player' ? 'プレイヤーを' : 'クリーチャーを'}攻撃`;
    case 'blocked':
      return `${N(e.card)} がブロックした`;
    case 'battleEnded':
      return e.draw ? 'バトル: 相打ち' : `バトル: ${N(e.card)} の勝ち`;
    case 'shieldBroken':
      return `${P(e.owner)}のシールドがブレイクされた`;
    case 'triggerDeclared':
      return `${P(e.owner)}は ${N(e.card)} を宣言した(${e.kind === 'gStrike' ? 'G・ストライク' : 'S・トリガー'})`;
    case 'resolve':
      return `▶ ${e.label ?? '能力'} を解決`;
    case 'chosen':
      return `${(e.cards as number[]).map(N).join('、')} が選ばれた`;
    case 'looked':
      return e.to === me || me === null
        ? `山札の上${(e.cards as number[]).length}枚を見た: ${(e.cards as number[]).map(N).join('、')}`
        : `${P(e.to)}は山札の上${(e.cards as number[]).length}枚を見た`;
    case 'revealed':
      return `公開: ${(e.cards as number[]).map(N).join('、')}`;
    case 'skipTurn':
      return 'ターンの残りがとばされた';
    case 'gameOver':
      return e.winner === 'draw' ? `引き分け(${e.reason})` : `${P(e.winner)}の勝ち(${e.reason})`;
    case 'tapped':
      return null;
    default:
      return null;
  }
}

export interface LogNode {
  id: number;
  text: string;
  children: LogNode[];
  turn: number;
  heading?: boolean;
  /** 自動(能力の解決など)/ 手動(プレイヤーの操作) */
  tag?: '自動' | '手動';
}

/** 因果ツリー: causedBy を辿り、「なぜ今これが起きたか」が分かる形にする */
export function buildLogTree(s: GameState, evs: Ev[], me: number | null): LogNode[] {
  const nodes = new Map<number, LogNode>();
  const roots: LogNode[] = [];
  for (const e of evs) {
    const text = describeEvent(s, e, me);
    if (text === null) continue;
    const manual = e.type === 'cast' || e.type === 'attackDeclared' || (e.type === 'entered' && e.via === 'summon') || (e.type === 'moved' && e.cause === 'charge');
    const n: LogNode = {
      id: e.id,
      text,
      children: [],
      turn: e.turn,
      heading: e.type === 'stepStart' && e.step === 'start',
      tag: e.type === 'resolve' ? '自動' : manual ? '手動' : undefined,
    };
    nodes.set(e.id, n);
    const parent = e.causedBy != null ? nodes.get(e.causedBy) : undefined;
    if (parent && e.type !== 'stepStart') parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

// ───────────────────────── 直近の出来事(盤面の下に出す要約) ─────────────────────────

/** 盤面の下の「直近の出来事」に出す種類。ドロー・能力の解決・補助的な移動は含めない(ログに任せる) */
const FEED_TYPES = new Set(['cast', 'entered', 'evolved', 'attackDeclared', 'blocked', 'battleEnded', 'shieldBroken', 'triggerDeclared', 'gameOver']);

export interface FeedLine {
  id: number;
  text: string;
  turn: number;
}

/** 因果ツリーではなく、プレイヤーが「いま何が起きたか」を追うための時系列の要約(新しいものが後ろ) */
export function recentFeed(s: GameState, evs: Ev[], me: number | null, max = 3): FeedLine[] {
  const out: FeedLine[] = [];
  for (let i = evs.length - 1; i >= 0 && out.length < max; i--) {
    const e = evs[i];
    const charge = e.type === 'moved' && e.cause === 'charge';
    if (!FEED_TYPES.has(e.type) && !charge) continue;
    const text = describeEvent(s, e, me);
    if (text === null) continue;
    out.push({ id: e.id, text, turn: e.turn });
  }
  return out.reverse();
}

// ───────────────────────── 触れない状態(ジャストダイバーなど) ─────────────────────────

export interface Ward {
  /** 相手の効果で選ばれない */
  chosen: boolean;
  /** 攻撃されない */
  attacked: boolean;
  /** 短い名前(「触れない」「選ばれない」「攻撃されない」) */
  label: string;
  /** いつまでか(「持ち主の次のターンの開始まで」など) */
  until: string;
}

/** 期限の言い方 */
export function untilLabel(d: Duration): string {
  return d.kind === 'endOfTurn' ? 'このターンの終わりまで' : d.kind === 'untilTurnStart' ? '持ち主の次のターンの開始まで' : '発生源が場にいる間';
}

/**
 * クリーチャー(山)が、いま「選ばれない」「攻撃されない」状態か。ジャストダイバーは、出たあと次のターンの開始まで両方になる。
 * どちらかでもあれば返す(どちらも無ければ null)。
 */
export function wardOf(s: GameState, pid: number): Ward | null {
  let chosen = false;
  let attacked = false;
  let until: Duration | null = null;
  for (const e of s.effects) {
    if (e.pid !== pid) continue;
    if (e.mod.kind === 'cannotBeChosen') chosen = true;
    else if (e.mod.kind === 'cannotBeAttacked') attacked = true;
    else continue;
    until = until ?? e.until;
  }
  if (!chosen && !attacked) return null;
  return {
    chosen,
    attacked,
    label: chosen && attacked ? '触れない' : chosen ? '選ばれない' : '攻撃されない',
    until: until ? untilLabel(until) : '',
  };
}
