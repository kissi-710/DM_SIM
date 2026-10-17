// @vitest-environment jsdom
// 演出の重み(試合結果への影響が大きい行動ほど豪華に): S・トリガー / G・ストライク / ラスト・シールド、
// 決定的な見せ場の上限の扱い、FxLayer の描画、タップの向きを演出が壊さないこと
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FxLayer } from '../../src/ui/FxLayer';
import { FX_MAX_CUES, FX_MS, FX_TIER, cuesOf, fxHoldMs, limitCues, tierOf, type FxCue } from '../../src/ui/fx';
import { Sim } from '../scenario';

afterEach(cleanup);

const N = 'フェアリー・ライフ'; // S・トリガー(呪文)
const RELIFE = 'フェアリー・Re:ライフ'; // G・ストライク

describe('演出の重み(tier)', () => {
  it('逆転の一手・切り札は決定的、ターン・呪文・攻撃などは重要、召喚は軽い', () => {
    for (const k of ['trigger', 'revolution', 'invade', 'direct'] as const) expect(FX_TIER[k]).toBe('decisive');
    for (const k of ['turn', 'cast', 'evolve', 'attack', 'block', 'shield'] as const) expect(FX_TIER[k]).toBe('major');
    expect(FX_TIER.summon).toBe('minor');
    expect(tierOf({ kind: 'shield' })).toBe('major');
    expect(tierOf({ kind: 'shield', tier: 'decisive' })).toBe('decisive');
  });
  it('決定的な見せ場は、数・合計の上限を超えても必ず残る。決定的な演出は、通常より長い', () => {
    const cue = (kind: FxCue['kind'], ms: number, tier?: FxCue['tier']): FxCue => ({ id: 0, kind, tier, title: '', side: 'me', ms });
    const many = [...Array.from({ length: 6 }, () => cue('attack', 700)), cue('trigger', 2600), cue('direct', 1800)];
    const lim = limitCues(many);
    expect(lim.some((c) => c.kind === 'trigger')).toBe(true);
    expect(lim.some((c) => c.kind === 'direct')).toBe(true);
    expect(lim.length).toBeGreaterThan(FX_MAX_CUES - 1);
    expect(FX_MS.trigger).toBeGreaterThan(FX_MS.attack * 2);
    expect(FX_MS.revolution).toBeGreaterThan(FX_MS.cast);
  });
});

describe('S・トリガー / G・ストライクの演出(実際のエンジンのイベント)', () => {
  it('S・トリガー: 決定的な見せ場。宣言したカードを見せ札(名前・コスト・テキスト)で出す。自分の分も出す', () => {
    const sim = new Sim({ p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] }, p1: { shield: [N], deck: ['ティンパニ=シンバリー', 'ダミー'] } });
    sim.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    sim.pick(N);
    for (const me of [1, 0, null]) {
      const cues = cuesOf(sim.s, sim.events, me).filter((c) => c.kind === 'trigger');
      expect(cues).toHaveLength(1);
      expect(cues[0]).toMatchObject({ title: 'S・トリガー!', variant: 'strigger', ms: FX_MS.trigger });
      expect(tierOf(cues[0])).toBe('decisive');
      expect(cues[0].reveal).toMatchObject({ name: N, type: '呪文' });
      expect(cues[0].reveal!.text.length).toBeGreaterThan(0);
      expect(cues[0].reveal!.civs.length).toBeGreaterThan(0);
    }
    // 同じ手の「呪文を唱えた」の帯は、見せ札と重ならないよう出さない
    expect(cuesOf(sim.s, sim.events, 0).some((c) => c.kind === 'cast' && c.title === N)).toBe(false);
  });
  it('G・ストライク: 変種 gstrike で、見せ札を出す', () => {
    const sim = new Sim({ p0: { battle: ['ヨビニオン・マルル', 'ヨビニオン・トライブ'] }, p1: { shield: [RELIFE] } });
    sim.attack('ヨビニオン・マルル', 'player');
    sim.pick(RELIFE);
    const c = cuesOf(sim.s, sim.events, 0).find((x) => x.kind === 'trigger')!;
    expect(c).toMatchObject({ title: 'G・ストライク!', variant: 'gstrike' });
    expect(c.reveal!.name).toContain('フェアリー・Re:ライフ');
  });
  it('CPU の待ちに、見せ札の長さが入る(高速は半分)', () => {
    const sim = new Sim({ p0: { battle: ['終末縫合王 ザ=キラー・キーナリー'] }, p1: { shield: [N], deck: ['ティンパニ=シンバリー', 'ダミー'] } });
    sim.attack('終末縫合王 ザ=キラー・キーナリー', 'player');
    sim.pick(N);
    expect(fxHoldMs(sim.s, sim.events, 0, 1)).toBeGreaterThanOrEqual(FX_MS.trigger);
    expect(fxHoldMs(sim.s, sim.events, 0, 0.5)).toBeLessThan(fxHoldMs(sim.s, sim.events, 0, 1));
  });
});

describe('ラスト・シールド', () => {
  it('最後のシールドが割れた時は決定的な見せ場(王手)。まだ残っている時は通常のシールドブレイク', () => {
    const last = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { shield: 1 } });
    last.attack('ヨビニオン・マルル', 'player');
    const lc = cuesOf(last.s, last.events, 0).find((c) => c.kind === 'shield')!;
    expect(lc.variant).toBe('last');
    expect(tierOf(lc)).toBe('decisive');
    expect(lc.sub).toContain('ラスト・シールド');

    const many = new Sim({ p0: { battle: ['ヨビニオン・マルル'] }, p1: { shield: 5 } });
    many.attack('ヨビニオン・マルル', 'player');
    const mc = cuesOf(many.s, many.events, 0).find((c) => c.kind === 'shield')!;
    expect(mc.variant).toBeUndefined();
    expect(tierOf(mc)).toBe('major');
  });
});

describe('FxLayer(重みごとの描画)', () => {
  const base: FxCue = { id: 1, kind: 'trigger', title: 'S・トリガー!', sub: 'フェアリー・ライフ', side: 'opp', ms: 5000, variant: 'strigger' };
  it('決定的な見せ場は、見せ札を出し、光が回る装飾は付けず、重みを属性に持つ', () => {
    const reveal = { name: 'フェアリー・ライフ', civs: ['nature'], cost: '2', type: '呪文', text: 'マナをふやす' };
    const { container } = render(<FxLayer cues={[{ ...base, reveal }]} token={1} enabled />);
    const layer = container.querySelector('.fx-layer')!;
    expect(layer.getAttribute('data-fx-tier')).toBe('decisive');
    expect(layer.getAttribute('data-fx-variant')).toBe('strigger');
    expect(container.querySelector('.fx-rays')).toBeNull(); // 光が回る装飾は、くどいので付けない
    expect(container.querySelector('.fx-reveal-name')!.textContent).toBe('フェアリー・ライフ');
    expect(container.querySelector('.fx-reveal-text')!.textContent).toBe('マナをふやす');
    expect(container.textContent).not.toContain('逆転の一手');
  });
  it('重要・軽い演出は、見せ札を出さない', () => {
    const { container } = render(<FxLayer cues={[{ id: 2, kind: 'cast', title: '呪文', side: 'opp', ms: 5000 }]} token={1} enabled />);
    expect(container.querySelector('.fx-layer')!.getAttribute('data-fx-tier')).toBe('major');
    expect(container.querySelector('.fx-reveal')).toBeNull();
  });
});

describe('手番の色(styles.css)', () => {
  const css = readFileSync('src/ui/styles.css', 'utf8');
  it('自分は青(accent)、相手は赤(bad)。背景・ヘッダー・手番の盤面に使い、手番でない側は暗くする', () => {
    expect(css).toMatch(/\.game\[data-turn='mine'\]\s*\{[^}]*--turn-color:\s*var\(--accent\)/);
    expect(css).toMatch(/\.game\[data-turn='theirs'\]\s*\{[^}]*--turn-color:\s*var\(--bad\)/);
    expect(css).toMatch(/\.game\[data-turn\]\s*\{[^}]*background-color:[^;]*var\(--turn-color\)/);
    expect(css).toMatch(/\.game\[data-turn\] \.game-head\s*\{[^}]*var\(--turn-color\)/);
    expect(css).toMatch(/\.game\[data-turn\] \.side-board\.turn-active\s*\{[^}]*border-color:\s*var\(--turn-color\)/);
    expect(css).toMatch(/\.game\[data-turn\] \.side-board:not\(\.turn-active\)\s*\{[^}]*filter:\s*brightness/);
  });
});

describe('タップの向きを、演出が壊さない(styles.css)', () => {
  const css = readFileSync('src/ui/styles.css', 'utf8');
  it('自分は左(反時計回り)、相手は右(時計回り)にタップする(変数 --rot)', () => {
    expect(css).toMatch(/\.card\.tapped\s*\{[^}]*--rot:\s*-90deg;[^}]*transform:\s*rotate\(var\(--rot\)\)/);
    expect(css).toMatch(/\.side-board\.opp \.card\.tapped\s*\{[^}]*--rot:\s*90deg/);
  });
  it('札の transform を動かす演出のキーフレームは、回転(--rot)を保つ', () => {
    for (const name of ['fx-pop', 'fx-block', 'fx-trump-in']) {
      const m = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}\\n`).exec(css);
      expect(m, name).not.toBeNull();
      const body = m![1];
      const transforms = body.match(/transform:[^;]+;/g) ?? [];
      expect(transforms.length).toBeGreaterThan(0);
      for (const t of transforms) expect(t, `${name}: ${t}`).toContain('var(--rot');
    }
  });
});
