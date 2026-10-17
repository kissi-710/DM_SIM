// ターン終了の確認: 「うっかり」だと思われる時だけ止める(使う気のないカードが手札に残っているだけでは止めない)。
import type { Action, GameState, PlayerId } from '../engine/types';

/**
 * ターンを終える前に、確認を出す理由を返す(確認が要らなければ null)。
 * - マナステップで、マナチャージ(まだできる)をせずに終えようとしている
 * - メインステップで、まだ出せるカードがあるのに、このターンは何も(カードを出す・唱える・攻撃)していない
 */
export function endTurnWarning(s: GameState, legal: Action[], me: PlayerId): string | null {
  if (legal.some((a) => a.type === 'CHARGE_MANA')) return 'マナチャージをしていません';
  if (!legal.some((a) => a.type === 'PLAY_CARD')) return null;
  const acted = s.turnLog.some((e) => e.owner === me && (e.type === 'cast' || e.type === 'entered' || e.type === 'attackDeclared'));
  return acted ? null : 'まだ何もしていません(出せるカードあり)';
}
