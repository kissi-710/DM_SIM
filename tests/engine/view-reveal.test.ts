// 情報の価値を測る実験用の開示設定(partial の opponentShield など)と、spec 文字列の info=
import { describe, expect, it } from 'vitest';
import { parseSpec, specLabel } from '../../src/ai/specString';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame } from '../../src/engine/engine';
import { FAIR, toPlayerView, type InfoPolicy } from '../../src/engine/view';
import { reg } from '../scenario';

const s = createGame(CARD_DB, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 3, first: 0 }).state;
const hidden = (v: ReturnType<typeof toPlayerView>, zone: 'hand' | 'shield' | 'deck', p: 0 | 1) => v.players[p][zone].every((u) => v.cards[u].defId === '?');
const shown = (v: ReturnType<typeof toPlayerView>, zone: 'hand' | 'shield' | 'deck', p: 0 | 1) => v.players[p][zone].every((u) => v.cards[u].defId !== '?');
const partial = (reveal: NonNullable<InfoPolicy['reveal']>): InfoPolicy => ({ ...FAIR, preset: 'partial', reveal });

describe('部分開示の実験用フラグ', () => {
  it('何も指定しなければ公平と同じ', () => {
    const v = toPlayerView(s, 0, partial({}), reg);
    expect(hidden(v, 'shield', 0) && hidden(v, 'deck', 0) && hidden(v, 'hand', 1) && hidden(v, 'shield', 1) && hidden(v, 'deck', 1)).toBe(true);
    expect(shown(v, 'hand', 0)).toBe(true);
  });
  it('相手のシールド・山札、自分のシールド・山札を、別々に開示できる', () => {
    const o = toPlayerView(s, 0, partial({ opponentShield: true }), reg);
    expect(shown(o, 'shield', 1) && hidden(o, 'deck', 1) && hidden(o, 'hand', 1) && hidden(o, 'shield', 0)).toBe(true);
    const d = toPlayerView(s, 0, partial({ opponentDeck: true }), reg);
    expect(shown(d, 'deck', 1) && hidden(d, 'shield', 1)).toBe(true);
    const m = toPlayerView(s, 0, partial({ ownShield: true, ownDeck: true }), reg);
    expect(shown(m, 'shield', 0) && shown(m, 'deck', 0) && hidden(m, 'shield', 1)).toBe(true);
  });
});

describe('spec 文字列の info=', () => {
  it('組み合わせを読み、ラベルに書き戻す', () => {
    const spec = parseSpec('mcts:iter=120,info=oh+os');
    expect(spec.policy?.preset).toBe('partial');
    expect(spec.policy?.reveal).toMatchObject({ opponentHandCount: 99, opponentShield: true, opponentDeck: false, ownShield: false, ownDeck: false });
    expect(specLabel(spec)).toContain('info=oh+os');
    expect(parseSpec('mcts:info=full').policy?.preset).toBe('full');
    expect(specLabel(parseSpec('mcts:info=full'))).toContain('info=full');
  });
  it('infer=0 と組み合わせても、開示の設定を失わない', () => {
    const spec = parseSpec('mcts:info=ms,infer=0');
    expect(spec.policy?.inferRevealed).toBe(false);
    expect(spec.policy?.reveal?.ownShield).toBe(true);
  });
  it('未知の記号はエラー', () => {
    expect(() => parseSpec('mcts:info=xx')).toThrow();
  });
});

describe('spec 文字列の chh= と pm=', () => {
  it('chh= はマナチャージの先読みターン数になり、ラベルに戻る', () => {
    const spec = parseSpec('mcts:iter=300,chh=6');
    expect(spec.tuning?.chargeHorizon).toBe(6);
    expect(specLabel(spec)).toContain('chh=6');
  });
  it('pm= は L1 とプレイアウトの両方に召喚の方針を入れる', () => {
    const spec = parseSpec('mcts:iter=120,pm=src/ai/models/play-v1.json');
    expect(spec.l1?.playModel?.length).toBeGreaterThan(100);
    expect(spec.tuning?.weights?.playModel?.length).toBe(spec.l1?.playModel?.length);
    expect(specLabel(spec)).toContain('pm=on');
    expect(() => parseSpec('mcts:pm=')).toThrow();
  });
});
