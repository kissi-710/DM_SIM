// 演出(ターン遷移・攻撃・シールドブレイクなどの見せ場)。見た目だけの層で、ゲームの進行・CPU の手の選択には関与しない。
//
// 守ること(docs/ui-effects.md):
//  1. 演出は、engine が返した Ev(イベント)から作る純粋関数 `cuesOf` だけで決まる。状態は読むだけで書き換えない。
//  2. CPU の手の決定(`chooseWithWorker` への入力 = 状態 + シード)は、演出の有無・長さに依存しない。
//     演出が CPU に与える影響は「次の手を打つまでの待ち時間」だけ(`cpuWaitMs`)。
//  3. 「演出」設定は 通常 / 高速 / オフ の3段階。高速は長さを半分(約2倍の速さ)にし、オフはオーバーレイ・CSS アニメーション・待ち時間の上乗せのすべてを無効にする。
import type { Ev, GameState, ZoneName } from '../engine/types';
import { cardName, reg } from './format';
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

export type FxKind = 'turn' | 'cast' | 'summon' | 'invade' | 'revolution' | 'evolve' | 'attack' | 'block' | 'shield' | 'trigger' | 'direct';

/**
 * 演出の重み。**試合結果への影響が大きい行動ほど、豪華にする**(docs/ui-effects.md 0.2)。
 * - decisive(決定的): 逆転の一手・切り札。S・トリガー / G・ストライク、革命チェンジ・侵略、ダイレクトアタック。
 *   画面を暗くして揺れを足し、長く見せる。数の上限を超えても必ず出す。
 * - major(重要): ターン遷移、呪文、進化、攻撃、ブロック、シールドブレイク。
 * - minor(軽い): 召喚。
 */
export type FxTier = 'minor' | 'major' | 'decisive';

/** 公開されたカードの見せ札(S・トリガーなど。何が起きるか読めるように、名前・コスト・テキストを出す) */
export interface FxReveal {
  name: string;
  civs: string[];
  cost: string;
  power?: number;
  type: string;
  text: string;
}

export interface FxCue {
  /** 元のイベントの id(複数のイベントをまとめた時は先頭) */
  id: number;
  kind: FxKind;
  /** 重み。省略時は種類の既定(tierOf) */
  tier?: FxTier;
  /** 種類の中の変種(S・トリガー / G・ストライク) */
  variant?: 'strigger' | 'gstrike';
  /** 公開されたカードの見せ札 */
  reveal?: FxReveal;
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
  invade: 1500,
  revolution: 1700,
  evolve: 700,
  attack: 700,
  block: 600,
  shield: 800,
  trigger: 2600,
  direct: 1800,
};

/** 種類ごとの重みの既定 */
export const FX_TIER: Record<FxKind, FxTier> = {
  turn: 'major',
  cast: 'major',
  summon: 'minor',
  invade: 'decisive',
  revolution: 'decisive',
  evolve: 'major',
  attack: 'major',
  block: 'major',
  shield: 'major',
  trigger: 'decisive',
  direct: 'decisive',
};

export function tierOf(c: { kind: FxKind; tier?: FxTier }): FxTier {
  return c.tier ?? FX_TIER[c.kind];
}

/** 見せ札を作る(S・トリガーとして使える面を優先。ツインパクトは呪文面) */
export function revealOf(defId: string | undefined): FxReveal | undefined {
  const def = defId ? reg.defs[defId] : undefined;
  if (!defId || !def) return undefined;
  let fi = 0;
  for (let i = 0; i < def.faces.length; i++) {
    const info = reg.getInfo(defId, i);
    if (info.shieldTriggers.length > 0 || info.gStrike) {
      fi = i;
      break;
    }
  }
  const f = def.faces[fi];
  const type = f.type === 'spell' ? '呪文' : f.type === 'castle' ? 'G城' : f.type === 'evolution' ? '進化' : f.type === 'smaxEvolution' ? 'S-MAX進化' : 'クリーチャー';
  return { name: f.name ?? def.name, civs: f.civs, cost: String(f.cost), power: f.power, type, text: def.text ?? '' };
}

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
  const triggered = new Set<number>();
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
        if (own(e.owner) || triggered.has(e.card)) break;
        out.push({ id: e.id, kind: 'cast', title: cardName(s, e.card), sub: `${who(e.owner, me)}の呪文`, side: sideOf(e.owner, me), ms: FX_MS.cast });
        break;
      case 'entered':
        // 革命チェンジは切り札なので、自分の分も出す。入れ替わりで手札に戻ったクリーチャーの名前を添える
        if (e.via === 'revolutionChange') {
          const out0 = events.find((x) => x.type === 'moved' && x.cause === 'revolutionChange');
          out.push({
            id: e.id,
            kind: 'revolution',
            title: '革命チェンジ!',
            sub: out0 ? `${cardName(s, out0.card)} → ${cardName(s, e.card)}` : cardName(s, e.card),
            side: sideOf(e.owner, me),
            ms: FX_MS.revolution,
          });
          break;
        }
        if (own(e.owner) || triggered.has(e.card)) break;
        if (e.via === 'summon') out.push({ id: e.id, kind: 'summon', title: cardName(s, e.card), sub: `${who(e.owner, me)}が召喚`, side: sideOf(e.owner, me), ms: FX_MS.summon });
        break;
      case 'evolved':
        if (e.via === 'invade') {
          // 侵略も切り札なので、自分の分も出す(進化元は攻撃中のクリーチャー)
          const base = Array.isArray(e.base) ? e.base[0] : undefined;
          out.push({
            id: e.id,
            kind: 'invade',
            title: '侵略!',
            sub: typeof base === 'number' ? `${cardName(s, base)} の上に ${cardName(s, e.card)}` : cardName(s, e.card),
            side: sideOf(e.owner, me),
            ms: FX_MS.invade,
          });
        } else if (!own(e.owner)) {
          out.push({ id: e.id, kind: 'evolve', title: '進化!', sub: cardName(s, e.card), side: sideOf(e.owner, me), ms: FX_MS.evolve });
        }
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
      case 'gameOver':
        // ダイレクトアタックで決まった時だけ(山札切れ・ターン上限などは出さない)
        if (e.reason === 'ダイレクトアタック' && typeof e.winner === 'number') {
          out.push({ id: e.id, kind: 'direct', title: 'ダイレクトアタック!', sub: `${who(e.winner, me)}の勝ち`, side: sideOf(e.winner, me), ms: FX_MS.direct });
        }
        break;
      case 'resolve': {
        // S・トリガー / G・ストライクは、宣言した時ではなく、**実際に使われた時**に出す。
        // 宣言しても使えなかったもの(呪文を封じられている・コストを封じられている・進化元がない等)は、何も起きないので出さない。
        // S・トリガーの使用は、宣言したカードが同じ手の中で唱えられた・出たことで確かめる。G・ストライクは解決した時
        if (e.kind !== 'shieldTrigger' && e.kind !== 'gStrike') break;
        const card = e.source as number;
        const used = e.kind === 'gStrike' || events.slice(i + 1).some((x) => (x.type === 'cast' || x.type === 'entered') && x.card === card);
        if (!used) break;
        out.push({
          id: e.id,
          kind: 'trigger',
          variant: e.kind === 'gStrike' ? 'gstrike' : 'strigger',
          title: e.kind === 'gStrike' ? 'G・ストライク!' : 'S・トリガー!',
          sub: cardName(s, card),
          reveal: revealOf(s.cards[card]?.defId),
          side: sideOf(e.controller, me),
          ms: FX_MS.trigger,
        });
        // 使われたカードは、見せ札で出したので、同じ手の「呪文」「召喚」の帯は出さない
        triggered.add(card);
        break;
      }
      default:
        break;
    }
  }
  return limitCues(out).map((c) => ({ ...c, ms: scaleMs(c.ms, scale) }));
}

/** 数と合計の長さを制限する(先頭を優先。ターン遷移と決定的な見せ場は必ず残す) */
export function limitCues(cues: FxCue[]): FxCue[] {
  const keep: FxCue[] = [];
  let total = 0;
  for (const c of cues) {
    // ターン遷移と決定的な見せ場は、数・合計の上限を超えても必ず残す
    const must = c.kind === 'turn' || tierOf(c) === 'decisive';
    if (keep.length >= FX_MAX_CUES && !must) continue;
    if (total + c.ms > FX_MAX_TOTAL_MS && !must) continue;
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

// ───────────────────────── 攻撃(攻撃線・ブロック線・ブレイク・バトルの火花) ─────────────────────────
// アタックはデュエマの華。攻撃の対象(シールドかクリーチャーか)を赤い線で明示し、割れる・ぶつかる瞬間を派手に見せる。
// 位置は盤面の要素から取る(fxRects.ts のキー)。判定は Ev だけで決まる純粋関数。

export type AttackTone = 'attack' | 'block';
export type BurstTone = 'shield' | 'clash' | 'direct' | 'trump';

export type AttackFx =
  | {
      kind: 'line';
      id: number;
      /** 位置のキー(uid:/pid:/zone:)。fxRects.ts */
      from: string;
      to: string;
      tone: AttackTone;
      /** 狙いの表示(「シールド」「クリーチャー」「ブロック」) */
      label: string;
      /** 対象がシールド(プレイヤーへの攻撃)か */
      shield: boolean;
      /** 開始までの遅れ(ms。倍率の前) */
      delay: number;
    }
  | {
      kind: 'burst';
      id: number;
      at: string;
      tone: BurstTone;
      /** 割れたシールドの枚数 */
      n: number;
      /** バトルが相打ちか */
      draw: boolean;
      delay: number;
      /** 今の位置(攻撃後の描画)で出す。消えるカードではなく、出てきたカードの位置 */
      cur?: boolean;
    };

export const ATK_MS = {
  line: 800,
  burst: 750,
  /** 攻撃線が引かれてから、着弾(ブレイク・バトル)までの間 */
  impact: 450,
  /** ブロック線が引かれてから、着弾までの間 */
  blockImpact: 400,
};

/**
 * 1手のイベントから、攻撃の演出を作る。
 * 攻撃線 → (ブロックされたらブロック線)→ 着弾(シールドが割れる・バトルの火花・ダイレクトアタック)の順に、遅れを付ける。
 * 攻撃宣言とそのあとの処理が別の手に分かれる(ブロッカーの選択が入る)ことがあるので、手の中にあるものだけで組む。
 */
export function attackFxOf(events: Ev[]): AttackFx[] {
  const out: AttackFx[] = [];
  let t = 0;
  // 同じ手で続けて割れたシールドは、持ち主ごとに1つの着弾にまとめる
  const shieldBurst = new Map<number, Extract<AttackFx, { kind: 'burst' }>>();
  for (const e of events) {
    switch (e.type) {
      case 'attackDeclared': {
        const isPlayer = e.target?.kind === 'player';
        const defender = (e.owner as number) === 0 ? 1 : 0;
        out.push({
          id: e.id,
          kind: 'line',
          from: `uid:${e.card}`,
          to: isPlayer ? `zone:shield:${defender}` : `pid:${e.target?.pid}`,
          tone: 'attack',
          label: isPlayer ? 'シールド' : 'クリーチャー',
          shield: isPlayer,
          delay: t,
        });
        t += ATK_MS.impact;
        break;
      }
      case 'blocked':
        out.push({ id: e.id, kind: 'line', from: `pid:${e.blocker}`, to: `uid:${e.attackerCard}`, tone: 'block', label: 'ブロック', shield: false, delay: t });
        t += ATK_MS.blockImpact;
        break;
      case 'shieldBroken': {
        const o = e.owner as number;
        const cur = shieldBurst.get(o);
        if (cur) {
          cur.n++;
          break;
        }
        const b: Extract<AttackFx, { kind: 'burst' }> = { kind: 'burst', id: e.id, at: `zone:shield:${o}`, tone: 'shield', n: 1, draw: false, delay: t };
        shieldBurst.set(o, b);
        out.push(b);
        break;
      }
      case 'battleEnded':
        out.push({ kind: 'burst', id: e.id, at: `pid:${e.defender}`, tone: 'clash', n: 1, draw: !!e.draw, delay: t });
        break;
      case 'gameOver':
        if (e.reason === 'ダイレクトアタック' && typeof e.winner === 'number') {
          out.push({ kind: 'burst', id: e.id, at: `zone:shield:${e.winner === 0 ? 1 : 0}`, tone: 'direct', n: 1, draw: false, delay: t });
        }
        break;
      case 'entered':
      case 'evolved':
        // 革命チェンジ・侵略で出てきたクリーチャーの位置に、金色の着弾
        if ((e.type === 'entered' && e.via === 'revolutionChange') || (e.type === 'evolved' && e.via === 'invade')) {
          out.push({ kind: 'burst', id: e.id, at: `uid:${e.card}`, tone: 'trump', n: 1, draw: false, delay: 0, cur: true });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

/** 攻撃の演出が終わるまでの長さ(ms。倍率込み) */
export function attackFxMs(fx: AttackFx[], scale: number): number {
  let end = 0;
  for (const f of fx) end = Math.max(end, f.delay + (f.kind === 'line' ? ATK_MS.line : ATK_MS.burst));
  return fx.length === 0 ? 0 : scaleMs(end, scale);
}

/**
 * CPU が次の手を打つ前に待つ、演出の長さ(ms)。バナーの合計・ゴースト・攻撃の演出の、長いもの。
 * (チップ・ステップ表示は待たせない)
 */
export function fxHoldMs(s: GameState, events: Ev[], me: number | null, scale: number): number {
  const banners = fxTotalMs(cuesOf(s, events, me, scale));
  const ghost = removalsOf(events).length > 0 ? scaleMs(GHOST_MS, scale) : 0;
  return Math.max(banners, ghost, attackFxMs(attackFxOf(events), scale));
}
