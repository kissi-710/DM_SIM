import { describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { randomAgent } from '../../src/ai/random';
import type { Ev, GameState } from '../../src/engine/types';
import { playGameSync } from '../../src/sim/playGame';
import { CIV_COLOR, CIV_NAME, ZONE_NAME, buildLogTree, cardName, civsOf, defName, describeEvent, playerLabel, recentFeed, shortName, type LogNode } from '../../src/ui/format';
import { Sim } from '../scenario';

describe('名前・文明・ラベル', () => {
  const sim = new Sim({ p0: { hand: ['ワクムテラス', '天災 デドダム'], battle: ['ワクムテラス'], mana: ['アクアン'] } });
  const hand = sim.s.players[0].hand;

  it('defName: カード名。未知は「？」', () => {
    expect(defName('dm23bd1-014')).toBe('天災 デドダム');
    expect(defName('zzz')).toBe('？');
  });
  it('cardName: 手札のツインパクトは先頭の名前、バトルゾーンでは面の名前', () => {
    expect(cardName(sim.s, hand[0])).toBe('蒼狼の豊穣 ワクムテラス');
    expect(cardName(sim.s, sim.s.players[0].battle[0].cards[0])).toBe('蒼狼の豊穣 ワクムテラス');
    expect(cardName(sim.s, hand[1])).toBe('天災 デドダム');
    expect(shortName(sim.s, hand[1])).toBe('天災 デドダム');
  });
  it('cardName: 隠れたカードは「(裏向き)」、存在しないカードは「？」', () => {
    const s: GameState = JSON.parse(JSON.stringify(sim.s));
    s.cards[hand[0]].defId = '?';
    expect(cardName(s, hand[0])).toBe('(裏向き)');
    expect(cardName(s, 99999)).toBe('？');
  });
  it('civsOf: 文明の配列。隠れたカード・存在しないカードは空', () => {
    expect(civsOf(sim.s, hand[1]).sort()).toEqual(['darkness', 'nature', 'water']);
    expect(civsOf(sim.s, 99999)).toEqual([]);
    const s: GameState = JSON.parse(JSON.stringify(sim.s));
    s.cards[hand[0]].defId = '?';
    expect(civsOf(s, hand[0])).toEqual([]);
  });
  it('playerLabel: 観戦(null)ではプレイヤー番号、対戦では あなた/相手', () => {
    expect(playerLabel(0, null)).toBe('プレイヤー1');
    expect(playerLabel(1, null)).toBe('プレイヤー2');
    expect(playerLabel(0, 0)).toBe('あなた');
    expect(playerLabel(1, 0)).toBe('相手');
  });
  it('文明・ゾーンの表示名が全て揃っている', () => {
    for (const c of ['light', 'water', 'darkness', 'fire', 'nature'] as const) {
      expect(CIV_NAME[c].length).toBeGreaterThan(0);
      expect(CIV_COLOR[c]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const z of ['deck', 'hand', 'mana', 'shield', 'battle', 'grave', 'limbo'] as const) expect(ZONE_NAME[z].length).toBeGreaterThan(0);
  });
});

describe('describeEvent / buildLogTree(実際の対戦のログ)', () => {
  const collect = (seed: number) => {
    const events: Ev[] = [];
    let last: GameState | null = null;
    const r = playGameSync(CARD_DB, [randomAgent, randomAgent], {
      decks: [deckCards('maruru'), deckCards('zardy')],
      seed,
      onStep: (s, _a, e) => {
        events.push(...e);
        last = s;
      },
    });
    return { events, state: last as unknown as GameState, winner: r.winner };
  };
  const flatten = (tree: LogNode[]): LogNode[] => {
    const all: LogNode[] = [];
    const walk = (n: LogNode) => {
      all.push(n);
      n.children.forEach(walk);
    };
    tree.forEach(walk);
    return all;
  };

  it('すべてのイベントを、例外なく文字列か null にできる(undefined/NaN を含まない)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { events, state } = collect(seed);
      for (const me of [null, 0, 1]) {
        for (const e of events) {
          const t = describeEvent(state, e, me);
          if (t !== null) {
            expect(typeof t).toBe('string');
            expect(t).not.toMatch(/undefined|NaN|\[object/);
          }
        }
      }
    }
  });
  it('ターン開始・ゲーム終了の見出しが出る', () => {
    const { events, state } = collect(2);
    const texts = events.map((e) => describeEvent(state, e, null)).filter((t): t is string => t !== null);
    expect(texts.some((t) => /ターン目/.test(t))).toBe(true);
    expect(texts.some((t) => /勝ち|引き分け/.test(t))).toBe(true);
  });
  it('視点によって、自分のドローは名前、相手のドローは「カード」', () => {
    const s = new Sim({ p0: { hand: ['アクアン'] } }).s;
    const e: Ev = { id: 1, causedBy: null, type: 'moved', turn: 1, from: 'deck', to: 'hand', owner: 1, card: s.players[0].hand[0], cause: 'effect' };
    expect(describeEvent(s, e, 0)).toMatch(/^カード/);
    expect(describeEvent(s, { ...e, owner: 0 }, 0)).toContain('アクアン');
  });
  it('未知の種類のイベントは null(表示しない)', () => {
    const s = new Sim({}).s;
    expect(describeEvent(s, { id: 1, causedBy: null, type: 'zzz', turn: 1 }, null)).toBeNull();
  });
  it('buildLogTree: 表示するイベントがすべて木に含まれ、子は親より後のイベント', () => {
    const { events, state } = collect(3);
    const all = flatten(buildLogTree(state, events, null));
    const shown = events.filter((e) => describeEvent(state, e, null) !== null);
    expect(all).toHaveLength(shown.length);
    expect(new Set(all.map((n) => n.id)).size).toBe(all.length);
    const check = (n: LogNode) =>
      n.children.forEach((c) => {
        expect(c.id).toBeGreaterThan(n.id);
        check(c);
      });
    buildLogTree(state, events, null).forEach(check);
  });
  it('buildLogTree: ターン開始は見出し、能力の解決は「自動」、召喚・攻撃・マナチャージは「手動」', () => {
    const { events, state } = collect(3);
    const all = flatten(buildLogTree(state, events, null));
    expect(all.some((n) => n.heading)).toBe(true);
    expect(all.some((n) => n.tag === '自動')).toBe(true);
    expect(all.some((n) => n.tag === '手動')).toBe(true);
  });
  it('buildLogTree: 空のログは空の木', () => {
    expect(buildLogTree(new Sim({}).s, [], null)).toEqual([]);
  });
});

describe('recentFeed: 直近の出来事の要約', () => {
  const sim = new Sim({ p0: { hand: ['ワクムテラス'] } });
  const u = sim.s.players[0].hand[0];
  const ev = (id: number, over: Record<string, unknown>) => ({ id, turn: 1, ...over }) as unknown as Ev;

  it('ドロー・解決などは出さず、行動と結果だけを時系列で返す', () => {
    const evs = [ev(1, { type: 'moved', cause: 'draw', owner: 0, card: u, from: 'deck', to: 'hand' }), ev(2, { type: 'cast', owner: 1, card: u }), ev(3, { type: 'resolve', label: 'x' }), ev(4, { type: 'shieldBroken', owner: 0 })];
    const feed = recentFeed(sim.s, evs, 0);
    expect(feed.map((f) => f.id)).toEqual([2, 4]);
    expect(feed[0].text).toContain('相手');
    expect(feed[1].text).toContain('シールドがブレイク');
  });
  it('max 件に切り詰め、新しいものを残す', () => {
    const evs = [1, 2, 3, 4, 5].map((i) => ev(i, { type: 'blocked', card: u }));
    expect(recentFeed(sim.s, evs, 0, 2).map((f) => f.id)).toEqual([4, 5]);
  });
  it('マナチャージは出す', () => {
    const evs = [ev(1, { type: 'moved', cause: 'charge', owner: 0, card: u, from: 'hand', to: 'mana' })];
    expect(recentFeed(sim.s, evs, 0)[0].text).toContain('マナゾーンに置いた');
  });
});
