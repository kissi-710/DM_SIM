// Rust 版(WASM)が持たないカード(25の王道の新規カード)を含む対局は、探索を TS 版で評価する(rustRegistryJson・nativeUnsupported)。
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_DB, TS_ONLY_CARD_IDS } from '../../src/cards';
import { nativeUnsupported, setNativeSkipCards, type SearchEnv } from '../../src/ai/mcts';
import { loadRegistry } from '../../src/engine/registry';
import { rustRegistryJson } from '../../src/wasm/dmEngine';
import { Sim } from '../scenario';

const reg = loadRegistry(CARD_DB);
const envOf = (sim: Sim): SearchEnv => ({ view: sim.s, legal: [], me: 0, policy: 'fair' as never, horizon: 1 });

afterEach(() => setNativeSkipCards([]));

describe('Rust 版が持たないカードの扱い', () => {
  it('Rust 版に渡すカード定義から、25の王道の新規カードは除かれ、既存のカードは残る', () => {
    const json = JSON.parse(rustRegistryJson(reg.defs)) as Record<string, unknown>;
    expect(TS_ONLY_CARD_IDS.length).toBeGreaterThan(100);
    for (const id of TS_ONLY_CARD_IDS) expect(json[id], id).toBeUndefined();
    expect(json['dm23rp1-070']).toBeDefined();
  });
  it('新規カードを含む対局は、TS 版で評価する(nativeUnsupported)。既存のカードだけなら、Rust 版を使える', () => {
    setNativeSkipCards(TS_ONLY_CARD_IDS);
    const withNew = new Sim({ p0: { hand: ['全虹帝 ミノガミ'] } });
    const legacy = new Sim({ p0: { hand: ['アクアン'] } });
    expect(nativeUnsupported(undefined, envOf(withNew))).toBe(true);
    expect(nativeUnsupported(undefined, envOf(legacy))).toBe(false);
  });
});
