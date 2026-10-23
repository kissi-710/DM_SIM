// Rust 版(WASM)がまだ持たないカードを含む対局は、探索を TS 版で評価する(rustRegistryJson・nativeUnsupported)。
// 25の王道の全23デッキは Rust 版でも動くので(RUST_READY_DECKS)、TS_ONLY_CARD_IDS は今は空。仕組みは、新しいカードを TS 版だけで先に足す時のために残してあり、ここで固定する。
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_DB, RUST_READY_DECKS, SD1_CARD_IDS, SD1_DECKS, TS_ONLY_CARD_IDS } from '../../src/cards';
import { nativeUnsupported, setNativeSkipCards, type SearchEnv } from '../../src/ai/mcts';
import { loadRegistry } from '../../src/engine/registry';
import { rustRegistryJson } from '../../src/wasm/dmEngine';
import { Sim } from '../scenario';

const reg = loadRegistry(CARD_DB);
const envOf = (sim: Sim): SearchEnv => ({ view: sim.s, legal: [], me: 0, policy: 'fair' as never, horizon: 1 });

afterEach(() => setNativeSkipCards(TS_ONLY_CARD_IDS));

describe('Rust 版が持たないカードの扱い', () => {
  it('25の王道の全デッキが Rust 版で動く: 新規カードもすべて Rust 版に渡るカード定義に入る', () => {
    expect(RUST_READY_DECKS.length).toBe(SD1_DECKS.length);
    expect(TS_ONLY_CARD_IDS).toEqual([]);
    const json = JSON.parse(rustRegistryJson(reg.defs)) as Record<string, unknown>;
    expect(SD1_CARD_IDS.length).toBeGreaterThan(100);
    for (const id of SD1_CARD_IDS) expect(json[id], id).toBeDefined();
    expect(json['dm23rp1-070']).toBeDefined();
  });
  it('登録したカードを含む対局は、TS 版で評価する(nativeUnsupported)。含まなければ、Rust 版を使える', () => {
    const withSkipped = new Sim({ p0: { hand: ['全虹帝 ミノガミ'] } });
    const legacy = new Sim({ p0: { hand: ['アクアン'] } });
    const id = withSkipped.s.cards[withSkipped.s.players[0].hand[0]].defId;
    setNativeSkipCards([id]);
    expect(nativeUnsupported(undefined, envOf(withSkipped))).toBe(true);
    expect(nativeUnsupported(undefined, envOf(legacy))).toBe(false);
  });
});
