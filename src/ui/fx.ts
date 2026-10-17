// 演出(ターン遷移・攻撃・シールドブレイクなどの見せ場)。見た目だけの層で、ゲームの進行・CPU の手の選択には関与しない。
//
// 守ること(docs/ui-effects.md):
//  1. 演出は、engine が返した Ev(イベント)から作る純粋関数 `cuesOf` だけで決まる。状態は読むだけで書き換えない。
//  2. CPU の手の決定(`chooseWithWorker` への入力 = 状態 + シード)は、演出の有無・長さに依存しない。
//     演出が CPU に与える影響は「次の手を打つまでの待ち時間」だけ(`cpuWaitMs`)。
//  3. 「演出」設定は 通常 / 高速 / オフ の3段階。高速は長さを半分(約2倍の速さ)にし、オフはオーバーレイ・CSS アニメーション・待ち時間の上乗せのすべてを無効にする。
import type { Ev, GameState, ZoneName } from '../engine/types';
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

export type FxMode = 'normal' | 'fast' | 'off';
export const FX_MODES: FxMode[] = ['normal', 'fast', 'off'];
export const FX_MODE_LABEL: Record<FxMode, string> = { normal: '通常', fast: '高速', off: 'オフ' };

/** 演出の長さの倍率。高速は半分(約2倍の速さ)。オフは使わない(0) */
export function fxScale(mode: FxMode): number {
  return mode === 'normal' ? 1 : mode === 'fast' ? 0.5 : 0;
}

/** 長さ(ms)に倍率をかける(最低 1ms) */
export function scaleMs(ms: number, scale: number): number {
  return Math.max(1, Math.round(ms * scale));
}

/**
 * 演出の設定(通常・高速・オフ)。保存がなければ、OS の設定に従い、通常は「通常」。
 * 旧い保存({enabled: boolean})は、true=通常・false=オフとして読む。
 */
export function loadFxMode(): FxMode {
  const saved = loadJson<{ mode?: unknown; enabled?: unknown } | null>(FX_KEY, null);
  if (saved && FX_MODES.includes(saved.mode as FxMode)) return saved.mode as FxMode;
  if (saved && typeof saved.enabled === 'boolean') return saved.enabled ? 'normal' : 'off';
  return prefersReducedMotion() ? 'off' : 'normal';
}

export function saveFxMode(mode: FxMode): void {
  saveJson(FX_KEY, { mode });
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
export function cuesOf(s: GameState, events: Ev[], me: number | null, scale = 1): FxCue[] {
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
  return limitCues(out).map((c) => ({ ...c, ms: scaleMs(c.ms, scale) }));
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

// ───────────────────────── 軽い演出(ドロー・ステップの切り替わり) ─────────────────────────
// 画面の端に小さく出して、自動で消える。操作も CPU の進行も待たせない(待ち時間 `cpuWaitMs` には入れない)。
// 無効にすると、これも出さない(FxTicker は enabled=false で何も描かない)。

export const STEP_LABEL: Record<string, string> = {
  start: 'ターン開始',
  draw: 'ドロー',
  mana: 'マナチャージ',
  main: 'メイン',
  attack: '攻撃',
  end: 'ターン終了',
};

export type LightKind = 'draw' | 'step' | 'remove';

export interface LightCue {
  kind: LightKind;
  title: string;
  sub?: string;
  side: FxCue['side'];
  ms: number;
}

export const LIGHT_MS: Record<LightKind, number> = { draw: 1100, step: 1200, remove: 2000 };

/** 1手の中のドローを、プレイヤーごとの枚数にまとめる(引いたカードの名前は出さない) */
export function drawCuesOf(events: Ev[], me: number | null, scale = 1): LightCue[] {
  const n: Record<number, number> = {};
  const order: number[] = [];
  for (const e of events) {
    if (e.type !== 'moved' || e.cause !== 'draw') continue;
    const o = e.owner as number;
    if (n[o] === undefined) {
      n[o] = 0;
      order.push(o);
    }
    n[o]++;
  }
  return order.map((o) => ({
    kind: 'draw' as const,
    title: me === null || o === me ? `ドロー ×${n[o]}` : `相手がドロー ×${n[o]}`,
    sub: me === null ? `プレイヤー${o + 1}` : undefined,
    side: sideOf(o, me),
    ms: scaleMs(LIGHT_MS.draw, scale),
  }));
}

/** ステップが切り替わった時の表示(「相手 ▸ メイン」など) */
export function stepCueOf(step: string, active: number, me: number | null, scale = 1): LightCue {
  return {
    kind: 'step',
    title: STEP_LABEL[step] ?? step,
    sub: me === null ? `プレイヤー${active + 1}` : active === me ? 'あなた' : '相手',
    side: sideOf(active, me),
    ms: scaleMs(LIGHT_MS.step, scale),
  };
}

// ───────────────────────── カードがフィールドなどから離れた時(破壊・バウンスなど) ─────────────────────────
// 何が起きたか分かるよう、(1) 離れたカードを元の位置から行き先(墓地・手札など)へ飛ばす「ゴースト」と、
// (2) 「破壊: カード名」のチップを出す。見えている情報(場・マナ・捨てた手札)だけを使い、シールド・山札の移動は扱わない。

export interface Removal {
  uid: number;
  owner: number;
  from: ZoneName;
  to: ZoneName;
  /** 「破壊」「手札に戻る」など */
  label: string;
}

/** ゴーストの長さ(ms)。一瞬でよい */
export const GHOST_MS = 550;

/** 1手のイベントから、離れたカード(公開されているもの)を拾う */
export function removalsOf(events: Ev[]): Removal[] {
  const out: Removal[] = [];
  for (const e of events) {
    if (e.type !== 'moved' || typeof e.card !== 'number') continue;
    const from = e.from as ZoneName;
    const to = e.to as ZoneName;
    const visible =
      (from === 'battle' && (to === 'grave' || to === 'hand' || to === 'mana' || to === 'deck')) ||
      (from === 'mana' && to === 'grave' && e.cause === 'destroy') ||
      (from === 'hand' && to === 'grave' && e.cause === 'discard');
    if (!visible) continue;
    const label = e.cause === 'destroy' ? '破壊' : to === 'hand' ? '手札に戻る' : e.cause === 'discard' ? '捨てる' : to === 'mana' ? 'マナゾーンへ' : to === 'deck' ? '山札へ' : '墓地へ';
    out.push({ uid: e.card, owner: e.owner as number, from, to, label });
  }
  return out;
}

const MAX_NAMES = 3;

/** 離れたカードのチップ(「破壊: A、B ほか2枚」)。持ち主・種類ごとにまとめる */
export function removalCuesOf(s: GameState, events: Ev[], me: number | null, scale = 1): LightCue[] {
  const groups = new Map<string, { owner: number; label: string; uids: number[] }>();
  for (const r of removalsOf(events)) {
    const k = `${r.owner}:${r.label}`;
    const g = groups.get(k) ?? { owner: r.owner, label: r.label, uids: [] };
    g.uids.push(r.uid);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => {
    const names = [...new Set(g.uids.map((u) => cardName(s, u)))];
    const shown = names.slice(0, MAX_NAMES).join('、');
    const more = names.length > MAX_NAMES ? ` ほか${names.length - MAX_NAMES}枚` : '';
    return {
      kind: 'remove' as const,
      title: `${g.label}: ${shown}${more}`,
      sub: who(g.owner, me),
      side: sideOf(g.owner, me),
      ms: scaleMs(LIGHT_MS.remove, scale),
    };
  });
}

/**
 * CPU が次の手を打つ前に待つ、演出の長さ(ms)。バナーの合計と、ゴーストの長さの大きいほう。
 * (チップ・ステップ表示は待たせない)
 */
export function fxHoldMs(s: GameState, events: Ev[], me: number | null, scale: number): number {
  const banners = fxTotalMs(cuesOf(s, events, me, scale));
  const ghost = removalsOf(events).length > 0 ? scaleMs(GHOST_MS, scale) : 0;
  return Math.max(banners, ghost);
}
