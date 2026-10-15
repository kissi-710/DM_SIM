// 演出(ターン遷移・攻撃・シールドブレイクなどの見せ場)。見た目だけの層で、ゲームの進行・CPU の手の選択には関与しない。
//
// 守ること(docs/ui-effects.md):
//  1. 演出は、engine が返した Ev(イベント)から作る純粋関数 `cuesOf` だけで決まる。状態は読むだけで書き換えない。
//  2. CPU の手の決定(`chooseWithWorker` への入力 = 状態 + シード)は、演出の有無・長さに依存しない。
//     演出が CPU に与える影響は「次の手を打つまでの待ち時間」だけ(`cpuWaitMs`)。
//  3. 「演出」設定をオフにすると、オーバーレイ・CSS アニメーション・待ち時間の上乗せのすべてが無効になる。
import type { Ev, GameState } from '../engine/types';
import { cardName } from './format';
import { loadJson, saveJson } from './util';

// ───────────────────────── 設定 ─────────────────────────

export const FX_KEY = 'dmsim.fx';

/** OS の「視覚効果を減らす」設定。保存された設定がない時の既定値に使う */
function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 演出の有効・無効(演出スキップ設定の逆)。保存がなければ、OS の設定に従い、通常は有効 */
export function loadFxEnabled(): boolean {
  const saved = loadJson<{ enabled?: boolean } | null>(FX_KEY, null);
  if (saved && typeof saved.enabled === 'boolean') return saved.enabled;
  return !prefersReducedMotion();
}

export function saveFxEnabled(enabled: boolean): void {
  saveJson(FX_KEY, { enabled });
}

// ───────────────────────── 演出の種類と長さ ─────────────────────────

export type FxKind = 'turn' | 'cast' | 'summon' | 'invade' | 'attack' | 'block' | 'shield' | 'trigger';

export interface FxCue {
  /** 元のイベントの id(複数のイベントをまとめた時は先頭) */
  id: number;
  kind: FxKind;
  title: string;
  sub?: string;
  /** 誰の出来事か(色分け)。観戦では席の番号で 'p0' / 'p1' */
  side: 'me' | 'opp' | 'p0' | 'p1';
  /** 表示する長さ(ms) */
  ms: number;
  /** まとめた数(シールドブレイクの枚数) */
  count?: number;
}

/** 種類ごとの表示の長さ(ms)。ターン遷移は「ターンが変わった」と分かる長さにする */
export const FX_MS: Record<FxKind, number> = {
  turn: 1200,
  cast: 800,
  summon: 600,
  invade: 800,
  attack: 700,
  block: 600,
  shield: 800,
  trigger: 1000,
};

/** 1手で出す演出の最大数と合計の長さ(長い連鎖でも、CPU の手が際限なく遅くならない) */
export const FX_MAX_CUES = 4;
export const FX_MAX_TOTAL_MS = 2600;

function sideOf(owner: number, me: number | null): FxCue['side'] {
  if (me === null) return owner === 0 ? 'p0' : 'p1';
  return owner === me ? 'me' : 'opp';
}

function who(owner: number, me: number | null): string {
  if (me === null) return `プレイヤー${owner + 1}`;
  return owner === me ? 'あなた' : '相手';
}

/**
 * 1手で発生したイベントから、見せる演出を作る(時系列順)。
 * - 人間が自分で行った 召喚・呪文・攻撃宣言 は、本人が分かっているので出さない(観戦では出す)。
 * - 隠れた情報は出さない(カード名は、公開された場面のものだけ。シールドブレイクは枚数だけ)。
 */
export function cuesOf(s: GameState, events: Ev[], me: number | null): FxCue[] {
  const out: FxCue[] = [];
  const own = (owner: number) => me !== null && owner === me;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'stepStart': {
        if (e.step !== 'start') break;
        const turnNo = Math.ceil((e.turn as number) / 2);
        out.push({
          id: e.id,
          kind: 'turn',
          title: me === null ? `プレイヤー${(e.player as number) + 1}のターン` : e.player === me ? 'あなたのターン' : '相手のターン',
          sub: `${turnNo}ターン目`,
          side: sideOf(e.player, me),
          ms: FX_MS.turn,
        });
        break;
      }
      case 'cast':
        if (own(e.owner)) break;
        out.push({ id: e.id, kind: 'cast', title: cardName(s, e.card), sub: `${who(e.owner, me)}が呪文を唱えた`, side: sideOf(e.owner, me), ms: FX_MS.cast });
        break;
      case 'entered':
        if (own(e.owner)) break;
        if (e.via === 'summon') out.push({ id: e.id, kind: 'summon', title: cardName(s, e.card), sub: `${who(e.owner, me)}が召喚`, side: sideOf(e.owner, me), ms: FX_MS.summon });
        else if (e.via === 'invade') out.push({ id: e.id, kind: 'invade', title: cardName(s, e.card), sub: `${who(e.owner, me)}の侵略`, side: sideOf(e.owner, me), ms: FX_MS.invade });
        break;
      case 'attackDeclared':
        if (own(e.owner)) break;
        out.push({
          id: e.id,
          kind: 'attack',
          title: '攻撃!',
          sub: `${cardName(s, e.card)} → ${e.target?.kind === 'player' ? 'プレイヤー' : 'クリーチャー'}`,
          side: sideOf(e.owner, me),
          ms: FX_MS.attack,
        });
        break;
      case 'blocked':
        out.push({ id: e.id, kind: 'block', title: 'ブロック!', sub: cardName(s, e.card), side: sideOf(e.owner, me), ms: FX_MS.block });
        break;
      case 'shieldBroken': {
        // 同じ攻撃で続けて割れたシールドは、1つにまとめる(W・ブレイカーなど)
        const prev = out[out.length - 1];
        if (prev && prev.kind === 'shield' && prev.side === sideOf(e.owner, me)) {
          const n = (prev.count ?? 1) + 1;
          prev.count = n;
          prev.title = `シールドブレイク! ×${n}`;
          break;
        }
        out.push({ id: e.id, kind: 'shield', title: 'シールドブレイク!', sub: `${who(e.owner, me)}のシールド`, side: sideOf(e.owner, me), ms: FX_MS.shield, count: 1 });
        break;
      }
      case 'triggerDeclared':
        out.push({
          id: e.id,
          kind: 'trigger',
          title: e.kind === 'gStrike' ? 'G・ストライク!' : 'S・トリガー!',
          sub: cardName(s, e.card),
          side: sideOf(e.owner, me),
          ms: FX_MS.trigger,
        });
        break;
      default:
        break;
    }
  }
  return limitCues(out);
}

/** 数と合計の長さを制限する(先頭を優先。ターン遷移は必ず残す) */
export function limitCues(cues: FxCue[]): FxCue[] {
  const keep: FxCue[] = [];
  let total = 0;
  for (const c of cues) {
    if (keep.length >= FX_MAX_CUES) break;
    if (total + c.ms > FX_MAX_TOTAL_MS && c.kind !== 'turn') continue;
    keep.push(c);
    total += c.ms;
  }
  return keep;
}

/** 演出の合計の長さ(ms) */
export function fxTotalMs(cues: FxCue[]): number {
  return cues.reduce((a, c) => a + c.ms, 0);
}

// ───────────────────────── CPU への影響(待ち時間だけ) ─────────────────────────

/** 人間と対戦する時の、CPU の手の最低間隔(ms) */
export const MIN_CPU_GAP_MS = 300;

export interface CpuWaitInput {
  /** 「CPU の手の間隔」(設定・速度スライダー) */
  speedMs: number;
  /** 「一気に進める」 */
  fast: boolean;
  /** 人間が1人いる対戦か(観戦ではない) */
  vsHuman: boolean;
  /** 演出が有効か */
  fxEnabled: boolean;
  /** 直前の手の演出の合計の長さ(ms) */
  fxHoldMs: number;
}

/**
 * CPU が次の手を打つまでの待ち時間(ms)。これは「いつ打つか」だけを決める。
 * 何を打つかは、状態とシード(`cpuSeed`)だけで決まり、この値には依存しない。
 */
export function cpuWaitMs(i: CpuWaitInput): number {
  if (i.fast) return 0;
  const gap = i.vsHuman ? Math.max(i.speedMs, MIN_CPU_GAP_MS) : i.speedMs;
  // 演出の間は待つ(演出が終わる前に、盤面が次の手で書き換わらないように)。間隔の設定とは重ねて取る
  return i.fxEnabled ? Math.max(gap, i.fxHoldMs) : gap;
}

/** CPU の手の探索に渡すシード。経過した手数だけで決まる(時間・演出・画面の状態に依存しない) */
export function cpuSeed(setupSeedHash: number, actionsLen: number): number {
  return setupSeedHash ^ (actionsLen * 2654435761);
}
