// @vitest-environment jsdom
// 演出(ui/fx.ts・FxLayer): 演出の判定・長さ・設定、演出が CPU の手の選択を変えないこと
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_DB, deckCards } from '../../src/cards';
import { createGame, legalActions, step } from '../../src/engine/engine';
import { loadRegistry } from '../../src/engine/registry';
import type { Ev } from '../../src/engine/types';
import { FxLayer } from '../../src/ui/FxLayer';
import { FxTicker } from '../../src/ui/FxTicker';
import {
  cpuSeed,
  drawCuesOf,
  stepCueOf,
  STEP_LABEL,
  cpuWaitMs,
  cuesOf,
  FX_KEY,
  FX_MAX_CUES,
  FX_MAX_TOTAL_MS,
  FX_MS,
  fxTotalMs,
  limitCues,
  fxScale,
  loadFxMode,
  saveFxMode,
  scaleMs,
  type FxCue,
} from '../../src/ui/fx';
import { useGame, type GameSetup } from '../../src/ui/useGame';

const reg = loadRegistry(CARD_DB);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** 合法手(進行を優先)で、指定したターンまで進めながら、手ごとのイベントを集める */
function playUntilTurn(turn: number, prefer: (a: { type: string }) => boolean = () => false) {
  const g = createGame(reg, { decks: [deckCards('maruru'), deckCards('zardy')], seed: 7, first: 0 });
  let s = g.state;
  const steps: { state: typeof s; events: Ev[] }[] = [{ state: s, events: g.events }];
  for (let i = 0; i < 600 && s.winner === null && s.turn <= turn; i++) {
    const legal = legalActions(s, reg);
    const a =
      legal.find(prefer) ?? legal.find((x) => x.type === 'END_TURN') ?? legal.find((x) => x.type === 'SKIP_MANA') ?? legal.find((x) => x.type === 'END_MAIN') ?? legal[0];
    const r = step(s, a, reg);
    s = r.state;
    steps.push({ state: s, events: r.events });
  }
  return steps;
}

describe('設定(演出: 通常・高速・オフ)', () => {
  it('保存がなければ通常。保存した値が次回に反映される', () => {
    expect(loadFxMode()).toBe('normal');
    for (const m of ['fast', 'off', 'normal'] as const) {
      saveFxMode(m);
      expect(loadFxMode()).toBe(m);
    }
  });
  it('旧い保存({enabled: boolean})は、true=通常・false=オフとして読む', () => {
    localStorage.setItem(FX_KEY, JSON.stringify({ enabled: false }));
    expect(loadFxMode()).toBe('off');
    localStorage.setItem(FX_KEY, JSON.stringify({ enabled: true }));
    expect(loadFxMode()).toBe('normal');
  });
  it('保存がなく、OS が視覚効果の軽減を求めている時は、オフが既定。明示した設定を優先する', () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList) as typeof window.matchMedia;
    try {
      expect(loadFxMode()).toBe('off');
      saveFxMode('fast');
      expect(loadFxMode()).toBe('fast');
    } finally {
      window.matchMedia = orig;
    }
  });
  it('壊れた・未知の保存値でも例外にせず、既定にする', () => {
    localStorage.setItem(FX_KEY, '{oops');
    expect(loadFxMode()).toBe('normal');
    localStorage.setItem(FX_KEY, JSON.stringify({ mode: 'turbo' }));
    expect(loadFxMode()).toBe('normal');
  });
  it('倍率: 通常 1、高速 0.5(約2倍の速さ)、オフ 0', () => {
    expect(fxScale('normal')).toBe(1);
    expect(fxScale('fast')).toBe(0.5);
    expect(fxScale('off')).toBe(0);
    expect(scaleMs(1200, 0.5)).toBe(600);
  });
  it('高速は、演出の長さがちょうど半分になる(バナー・軽いチップ・ゴースト・CPU の待ち)', () => {
    const steps = playUntilTurn(3);
    const sum = (sc: number) => steps.flatMap((x) => cuesOf(x.state, x.events, 0, sc)).reduce((n, c) => n + c.ms, 0);
    expect(sum(0.5)).toBeGreaterThan(0);
    expect(Math.abs(sum(0.5) * 2 - sum(1))).toBeLessThanOrEqual(steps.length * 2);
    expect(drawCuesOf([{ id: 1, causedBy: null, type: 'moved', turn: 2, cause: 'draw', owner: 0, card: 1 } as Ev], 0, 0.5)[0].ms).toBe(550);
    expect(stepCueOf('main', 0, 0, 0.5).ms).toBe(600);
  });
});

describe('cuesOf(イベントから演出を作る)', () => {
  it('ターンの開始は「あなたのターン」「相手のターン」を出す。ターンの番号つき', () => {
    const steps = playUntilTurn(3);
    const turnCues = steps.flatMap((x) => cuesOf(x.state, x.events, 0)).filter((c) => c.kind === 'turn');
    expect(turnCues.length).toBeGreaterThanOrEqual(3);
    expect(turnCues[0]).toMatchObject({ title: 'あなたのターン', sub: '1ターン目', side: 'me', ms: FX_MS.turn });
    expect(turnCues[1]).toMatchObject({ title: '相手のターン', sub: '1ターン目', side: 'opp' });
    expect(turnCues[2].title).toBe('あなたのターン');
    expect(turnCues[2].sub).toBe('2ターン目');
  });
  it('観戦(me=null)では、席の番号で出す', () => {
    const steps = playUntilTurn(2);
    const c = cuesOf(steps[0].state, steps[0].events, null).find((x) => x.kind === 'turn')!;
    expect(c.title).toBe('プレイヤー1のターン');
    expect(c.side).toBe('p0');
  });
  it('自分の召喚・呪文・攻撃は出さず、相手の分は出す(観戦では両方出す)', () => {
    const steps = playUntilTurn(30, (a) => a.type === 'ATTACK' || a.type === 'PLAY_CARD' || a.type === 'CHARGE_MANA');
    const mine = steps.flatMap((x) => cuesOf(x.state, x.events, 0));
    const watch = steps.flatMap((x) => cuesOf(x.state, x.events, null));
    const act = ['summon', 'cast', 'attack'];
    expect(mine.filter((c) => act.includes(c.kind) && c.side === 'me')).toHaveLength(0);
    expect(mine.filter((c) => act.includes(c.kind) && c.side === 'opp').length).toBeGreaterThan(0);
    expect(watch.filter((c) => act.includes(c.kind)).length).toBeGreaterThan(mine.filter((c) => act.includes(c.kind)).length);
  });
  it('同じ攻撃で続けて割れたシールドは1つにまとめる', () => {
    const ev = (id: number): Ev => ({ id, causedBy: null, type: 'shieldBroken', turn: 2, card: 1, owner: 1, by: 0 });
    const s = playUntilTurn(1)[0].state;
    const cues = cuesOf(s, [ev(1), ev(2), ev(3)], 0);
    expect(cues).toHaveLength(1);
    expect(cues[0].title).toBe('シールドブレイク! ×3');
    expect(cues[0].count).toBe(3);
  });
  it('隠れた情報を出さない: シールドブレイクの演出に、割れたカードの名前は含まれない', () => {
    const s = playUntilTurn(1)[0].state;
    const uid = s.players[1].shield[0];
    const cue = cuesOf(s, [{ id: 1, causedBy: null, type: 'shieldBroken', turn: 2, card: uid, owner: 1, by: 0 }], 0)[0];
    const name = reg.defs[s.cards[uid].defId].name;
    expect(JSON.stringify(cue)).not.toContain(name);
  });
});

describe('演出の数・長さの上限', () => {
  const cue = (kind: FxCue['kind'], ms: number): FxCue => ({ id: 0, kind, title: '', side: 'me', ms });
  it('数と合計を制限し、ターン遷移は残す', () => {
    const many = Array.from({ length: 10 }, () => cue('attack', 700));
    const lim = limitCues(many);
    expect(lim.length).toBeLessThanOrEqual(FX_MAX_CUES);
    expect(fxTotalMs(lim)).toBeLessThanOrEqual(FX_MAX_TOTAL_MS);
    const withTurn = limitCues([cue('attack', 2500), cue('turn', 1200)]);
    expect(withTurn.map((c) => c.kind)).toEqual(['attack', 'turn']);
  });
});

describe('cpuWaitMs(演出が CPU に与えるのは、待ち時間だけ)', () => {
  const base = { speedMs: 0, fast: false, vsHuman: true, fxEnabled: true, fxHoldMs: 1200 };
  it('演出が有効なら、演出の間は待つ', () => {
    expect(cpuWaitMs(base)).toBe(1200);
    expect(cpuWaitMs({ ...base, speedMs: 2000 })).toBe(2000);
  });
  it('演出を無効にすると、演出の分は一切待たない(従来と同じ)', () => {
    expect(cpuWaitMs({ ...base, fxEnabled: false })).toBe(300);
    expect(cpuWaitMs({ ...base, fxEnabled: false, vsHuman: false })).toBe(0);
    expect(cpuWaitMs({ ...base, fxEnabled: false, vsHuman: false, speedMs: 500 })).toBe(500);
  });
  it('「一気に進める」は、演出の有無によらず0', () => {
    expect(cpuWaitMs({ ...base, fast: true })).toBe(0);
  });
  it('手の決定に使うシードは、手数だけで決まる(演出・時間に依存する引数がない)', () => {
    expect(cpuSeed.length).toBe(2);
    expect(cpuSeed(123, 5)).toBe(cpuSeed(123, 5));
    expect(cpuSeed(123, 5)).not.toBe(cpuSeed(123, 6));
  });
});

describe('演出が CPU の手を変えない(同じシードなら、演出の有無で行動列が一致する)', () => {
  const cpuSetup = (): GameSetup => ({
    decks: [deckCards('maruru'), deckCards('zardy')],
    deckNames: ['マルル', '5cザーディ'],
    seats: [
      { kind: 'cpu', agent: { kind: 'random' } },
      { kind: 'cpu', agent: { kind: 'rule' } },
    ],
    first: 0,
    seed: 11,
    autoOrder: false,
    allowUndo: false,
    cpuDelayMs: 0,
    strict: true,
  });
  const N = 16;
  const run = async (fx: 'normal' | 'fast' | 'off') => {
    const { result, unmount } = renderHook(() => useGame(cpuSetup(), fx));
    await waitFor(() => expect(result.current.session.actions.length).toBeGreaterThanOrEqual(N), { timeout: 50000 });
    const actions = result.current.session.actions.slice(0, N);
    unmount();
    return actions;
  };
  it('演出あり・なしで、先頭 N 手が同じ', async () => {
    const off = await run('off');
    const on = await run('normal');
    expect(on).toEqual(off);
  }, 120000);
});

describe('FxLayer', () => {
  const cues: FxCue[] = [
    { id: 1, kind: 'turn', title: '相手のターン', sub: '2ターン目', side: 'opp', ms: 40 },
    { id: 2, kind: 'attack', title: '攻撃!', side: 'opp', ms: 40 },
  ];
  it('無効なら、何も描かない', () => {
    const { container } = render(<FxLayer cues={cues} token={1} enabled={false} />);
    expect(container.querySelector('.fx-layer')).toBeNull();
  });
  it('有効なら、演出を順に出し、終われば消える', async () => {
    const { container } = render(<FxLayer cues={cues} token={1} enabled />);
    expect(await screen.findByText('相手のターン')).toBeInTheDocument();
    expect(container.querySelector('.fx-layer')).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(screen.getByText('攻撃!')).toBeInTheDocument());
    await waitFor(() => expect(container.querySelector('.fx-layer')).toBeNull());
  });
  it('StrictMode(効果の二重実行)でも、同じ演出が重複して居座らない', async () => {
    const one: FxCue[] = [{ id: 1, kind: 'turn', title: 'あなたのターン', sub: '1ターン目', side: 'me', ms: 40 }];
    const { container } = render(
      <StrictMode>
        <FxLayer cues={one} token={1} enabled />
      </StrictMode>,
    );
    await screen.findByText('あなたのターン');
    await waitFor(() => expect(container.querySelector('.fx-layer')).toBeNull());
  });
  it('同じ演出を連続して積んでも、順に消えていく', async () => {
    const c: FxCue = { id: 1, kind: 'block', title: 'ブロック!', side: 'me', ms: 30 };
    const { container, rerender } = render(<FxLayer cues={[c]} token={1} enabled />);
    rerender(<FxLayer cues={[c]} token={2} enabled />);
    rerender(<FxLayer cues={[c]} token={3} enabled />);
    await waitFor(() => expect(container.querySelector('.fx-layer')).toBeNull());
  });
  it('途中で無効にすると、残りの演出は出さずに消える', async () => {
    const { container, rerender } = render(<FxLayer cues={cues} token={1} enabled />);
    await screen.findByText('相手のターン');
    act(() => rerender(<FxLayer cues={cues} token={1} enabled={false} />));
    expect(container.querySelector('.fx-layer')).toBeNull();
  });
});

describe('軽い演出(ドロー・ステップ)', () => {
  const draw = (id: number, owner: number): Ev => ({ id, causedBy: null, type: 'moved', turn: 2, cause: 'draw', owner, card: id, from: 'deck', to: 'hand' });
  it('ドローは、プレイヤーごとの枚数にまとめる。引いたカードの名前は出さない', () => {
    const cues = drawCuesOf([draw(1, 0), draw(2, 0), draw(3, 1)], 0);
    expect(cues.map((c) => c.title)).toEqual(['ドロー ×2', '相手がドロー ×1']);
    expect(cues.map((c) => c.side)).toEqual(['me', 'opp']);
    expect(drawCuesOf([draw(1, 0)], null)[0]).toMatchObject({ title: 'ドロー ×1', sub: 'プレイヤー1', side: 'p0' });
  });
  it('ドロー以外の移動は数えない', () => {
    const ev: Ev = { id: 1, causedBy: null, type: 'moved', turn: 2, cause: 'charge', owner: 0, card: 1 };
    expect(drawCuesOf([ev], 0)).toEqual([]);
  });
  it('ステップの表示は、ステップの名前と誰の番かを出す', () => {
    expect(stepCueOf('main', 1, 0)).toMatchObject({ title: STEP_LABEL.main, sub: '相手', side: 'opp' });
    expect(stepCueOf('mana', 0, 0)).toMatchObject({ title: 'マナチャージ', sub: 'あなた' });
  });
  it('軽い演出は、CPU の待ち時間に入らない(cpuWaitMs に渡す値は cuesOf だけ)', () => {
    const s = playUntilTurn(3);
    const heavy = s.flatMap((x) => cuesOf(x.state, x.events, 0));
    expect(heavy.some((c) => (c.kind as string) === 'draw' || (c.kind as string) === 'step')).toBe(false);
  });

  const step = (key: string, s = 'main') => ({ key, step: s, active: 0, me: 0 as number | null });
  const draws = [{ kind: 'draw' as const, title: 'ドロー ×1', side: 'me' as const, ms: 3000 }]; // 負荷で検査が遅れても消えない長さ
  it('無効なら何も描かない', () => {
    const { container } = render(<FxTicker draws={draws} drawToken={1} step={step('a')} enabled={false} />);
    expect(container.querySelector('.fx-ticker')).toBeNull();
  });
  it('最初の表示ではステップを出さず、切り替わった時に出して、自動で消える', async () => {
    const { container, rerender } = render(<FxTicker draws={[]} drawToken={0} step={step('1:0:mana', 'mana')} enabled />);
    expect(container.querySelector('.fx-ticker')).toBeNull();
    rerender(<FxTicker draws={[]} drawToken={0} step={step('1:0:main', 'main')} enabled />);
    expect(await screen.findByText('メイン')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.fx-ticker')).toBeNull(), { timeout: 3000 });
  });
  it('ドローは1手につき一度だけ出る(StrictMode でも)', async () => {
    const { container } = render(
      <StrictMode>
        <FxTicker draws={draws} drawToken={1} step={step('a')} enabled />
      </StrictMode>,
    );
    await screen.findByText('ドロー ×1');
    expect(container.querySelectorAll('.fx-chip')).toHaveLength(1);
  });
});
