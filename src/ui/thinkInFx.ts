// 「演出中も考える」オプション: CPU の待ち時間(演出・手の間隔)の間も、探索を続けて、より深く考える。
// 待ち時間は、演出のために元々かかる時間なので、その間に考える分には、打つまでの時間は増えない
// (待ちと探索は重ねて進める。docs/ui-effects.md 4.1)。このオプションは、その待ち時間を探索の予算に回す。
//
//  - 既定はオフ。オンにすると、待ち時間が一定以上ある手で、探索の最大の思考時間を待ち時間まで延ばし、
//    「強い」CPU の設定(手を外す判定をせず、僅差の判断に長く考える)にする。
//  - 探索の入力は局面とシードだけで、手の選び方が変わるのは、予算を延ばした分だけ(設定を変えない限り、再現できる)。
//  - 懸念: 探索が CPU を使い切るので、コア数の少ない PC では、演出がカクつく・画面が重くなることがある(警告を出す)。
import { withStrong, type AgentSpec } from '../ai';
import { loadJson, saveJson } from './util';

export const THINK_IN_FX_KEY = 'dmsim.fxThink';

/** これ未満の待ちでは、延長しない(短い待ちを、深く考える時間にしても、得るものが小さい) */
export const THINK_IN_FX_MIN_MS = 600;
/** 延長の上限(ms)。長い待ち(速度を遅くした時など)でも、探索をこれ以上は延ばさない */
export const THINK_IN_FX_MAX_MS = 6000;
/** 最大の思考時間の既定(設定画面と同じ) */
export const DEFAULT_THINK_MS = 1200;

export function loadThinkInFx(): boolean {
  return loadJson<unknown>(THINK_IN_FX_KEY, false) === true;
}

export function saveThinkInFx(on: boolean): void {
  saveJson(THINK_IN_FX_KEY, on);
}

/**
 * 待ち時間 windowMs の手を、探索させる設定にする。
 * - オフ・探索(mcts)以外・反復回数を決めた設定・待ちが短い手は、そのまま返す。
 * - それ以外は、最大の思考時間を max(設定, min(待ち, 上限)) に延ばし、「強い」CPU の設定を重ねる。
 *   (待ちが設定より短くても、設定の最大の思考時間は下回らない。打つのは、待ちの終わりか探索の終わりの遅いほう)
 */
export function thinkSpecFor(spec: AgentSpec, windowMs: number, enabled: boolean): AgentSpec {
  if (!enabled || spec.kind !== 'mcts' || spec.iterations !== undefined || windowMs < THINK_IN_FX_MIN_MS) return spec;
  const ms = Math.max(spec.ms ?? DEFAULT_THINK_MS, Math.min(windowMs, THINK_IN_FX_MAX_MS));
  return withStrong({ ...spec, ms });
}

/** 警告の文言。cores はこの PC の論理コア数(分からなければ 0) */
export function thinkInFxWarning(cores: number): string {
  const base = '⚠ 演出の間も CPU が探索を続けます。探索が CPU を使い切るため、演出がカクつく・画面が重くなることがあります。強くなる幅はわずかです。';
  return cores > 0 && cores <= 4 ? `${base}この PC は論理コアが ${cores} 個と少なく、特に重くなる可能性があります。` : base;
}

export function logicalCores(): number {
  return typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
}
