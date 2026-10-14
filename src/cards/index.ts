// カードDBとデッキリスト(decks.md)。engine は CardDB を引数で受け取るだけなので、ここで束ねる。
import type { CardDB, CardDef } from '../engine/types';
import raw from './data/cards.json';

export const CARD_LIST = raw as unknown as CardDef[];

export const CARD_DB: CardDB = Object.fromEntries(CARD_LIST.map((c) => [c.id, c]));

export interface DeckPreset {
  id: string;
  name: string;
  short: string;
  /** [カードID, 枚数] */
  list: [string, number][];
}

export const DECK_PRESETS: DeckPreset[] = [
  {
    id: 'maruru',
    name: '究極のヨビニオン!水闇自然マルルデッキ',
    short: 'マルル',
    list: [
      ['dmrp01-093', 4], // フェアリー・ライフ
      ['dm23ex2-107', 4], // フェアリー・Re:ライフ
      ['dm24ex2-096', 2], // ワクムテラス / オリジナル・ライフ
      ['dm23bd1-014', 4], // 天災 デドダム
      ['dm24rp3-S10', 2], // ヨビニオン・マルル
      ['dm24rp3-027', 2], // ヨビニオン・トライブ
      ['dm24rp3-020', 3], // ティンパニ=シンバリー
      ['dm24bd4-007', 2], // フミシュナ
      ['dm23bd3-003', 3], // 決断
      ['dmex17-021', 3], // ガイアッシュ・カイザー
      ['dm23bd3-002', 2], // ジャオウガ
      ['dm24rp4-S02', 2], // オルゲイト
      ['dm24rp2-TR03', 2], // ジ・ウォッチ
      ['dm24rp3-025', 2], // スカイソード
      ['dm23bd1-007', 2], // キーナリー
      ['dm24rp3-008', 1], // ジゴクバンカー
    ],
  },
  {
    id: 'zardy',
    name: '五文明がミラクルする5cザーディデッキ',
    short: '5cザーディ',
    list: [
      ['dmbd01-015', 4], // フェアリー・ミラクル
      ['dm23bd1-014', 4], // 天災 デドダム
      ['dm23bd7-031', 2], // アクアン
      ['dm24bd1-001', 2], // ドギラゴン
      ['dm24bd1-016', 2], // ボスカツ
      ['dm24rp4-011', 2], // 5色の決断
      ['promoy21-048', 4], // ドラゴンズ・サイン
      ['dmrp17-029', 4], // ドンドン火噴くナウ
      ['dm24ex2-Cho033', 4], // ブレイン・スラッシュ
      ['dmrp17-s07', 4], // ザーディクリカ
      ['dmrp20-017', 4], // ロスト・Re:ソウル
      ['dmrp17-km2', 3], // ドルファディロム
      ['dm23bd3-001', 1], // デッドダムド
    ],
  },
  {
    id: 'lost-maruru',
    name: 'ロスト型水闇自然マルル',
    short: 'ロストマルル',
    list: [
      ['dm23ex2-107', 4], // フェアリー・Re:ライフ
      ['dmrp01-093', 4], // フェアリー・ライフ
      ['dm23bd1-014', 4], // 天災 デドダム
      ['dm24rp3-S10', 4], // ヨビニオン・マルル
      ['dmex17-021', 4], // ガイアッシュ・カイザー
      ['dmrp20-017', 4], // ロスト・Re:ソウル
      ['dm24rp3-020', 2], // ティンパニ=シンバリー
      ['dm24bd4-007', 2], // フミシュナ
      ['dm23bd3-001', 2], // デッドダムド
      ['dm23rp1-070', 2], // 配球の超人 / 記録的剛球
      ['dm24rp3-025', 2], // スカイソード
      ['dm24rp2-TR03', 2], // ジ・ウォッチ
      ['dm23bd1-007', 2], // キーナリー
      ['dm23bd3-002', 1], // ジャオウガ
      ['dm24rp4-S02', 1], // オルゲイト
    ],
  },
];

export function deckCards(id: string): string[] {
  const p = DECK_PRESETS.find((d) => d.id === id);
  if (!p) throw new Error(`未知のデッキ: ${id}`);
  const out: string[] = [];
  for (const [cid, n] of p.list) for (let i = 0; i < n; i++) out.push(cid);
  return out;
}

export function deckPreset(id: string): DeckPreset {
  const p = DECK_PRESETS.find((d) => d.id === id);
  if (!p) throw new Error(`未知のデッキ: ${id}`);
  return p;
}
