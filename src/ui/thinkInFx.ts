// 「演出中も考える」オプション: CPU の待ち時間(演出・手の間隔)の間も、探索を続けて、より深く考える。
// 待ち時間は、演出のために元々かかる時間なので、その間に考える分には、打つまでの時間は増えない
// (待ちと探索は重ねて進める。docs/ui-effects.md 4.1)。
//
//  - 既定はオフ。オンにすると、待ち時間が一定以上ある手で、「強い」CPU の設定(手を外す判定をせず、僅差の判断に長く考える。
//    早期終了をほとんどしないので、1手に約 640ms 使う)にする。
//  - **探索の最大の思考時間は延ばさない。** 効果測定(docs/ui-effects.md 4.2)で、強さが上がるのは「早期終了をしない」ことによる分で、
//    最大の思考時間を 1200ms → 2000ms に延ばしても、上乗せは測れなかった(51.0%、区間 46.1〜55.9%)。延ばしても CPU を余計に使うだけ。
//  - 探索の入力は局面とシードだけで、設定を変えない限り、再現できる。
//  - 懸念: 探索が CPU を使うので、コア数の少ない PC では、演出がカクつく・画面が重くなることがある(警告を出す)。
import { withStrong, type AgentSpec } from '../ai';
import { loadJson, saveJson } from './util';

export const THINK_IN_FX_KEY = 'dmsim.fxThink';

/** これ未満の待ちでは、「強い」設定にしない(1手の平均が約 640ms かかるので、短い待ちだと、待ちより長くかかりやすい) */
export const THINK_IN_FX_MIN_MS = 600;

export function loadThinkInFx(): boolean {
  return loadJson<unknown>(THINK_IN_FX_KEY, false) === true;
}

export function saveThinkInFx(on: boolean): void {
  saveJson(THINK_IN_FX_KEY, on);
}

/**
 * 待ち時間 windowMs の手を、探索させる設定にする。
 * - オフ・探索(mcts)以外・反復回数を決めた設定・待ちが短い手は、そのまま返す。
 * - それ以外は、「強い」CPU の設定を重ねる(最大の思考時間は、設定のまま)。
 */
export function thinkSpecFor(spec: AgentSpec, windowMs: number, enabled: boolean): AgentSpec {
  if (!enabled || spec.kind !== 'mcts' || spec.iterations !== undefined || windowMs < THINK_IN_FX_MIN_MS) return spec;
  return withStrong(spec);
}

/** 警告の文言。cores はこの PC の論理コア数(分からなければ 0) */
export function thinkInFxWarning(cores: number): string {
  const base = '⚠ 演出の間も CPU が探索を続けます。探索が CPU を使うため、演出がカクつく・画面が重くなることがあります。強くなる幅は小さめです(対戦で約 57% 勝つ程度)。';
  return cores > 0 && cores <= 4 ? `${base}この PC は論理コアが ${cores} 個と少なく、特に重くなる可能性があります。` : base;
}

export function logicalCores(): number {
  return typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
}
