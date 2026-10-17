// 手札のカードが今は使えない理由(灰色のカードをクリックした時に出す)。ルール判定はエンジン(planPlay)に任せ、文言だけを作る。
import { costOf } from '../engine/derive';
import { planPlay } from '../engine/procs';
import { mkCtx } from '../engine/state';
import type { GameState, PlayerId } from '../engine/types';
import { CIV_NAME, reg } from './format';

const STEP_WHY: Record<string, string> = {
  mana: 'マナステップ中。マナチャージするか「マナチャージしない」でメインに進むと出せる',
  attack: '攻撃ステップ中は出せない(メインステップのみ)',
};

export function whyUnplayable(s: GameState, me: PlayerId, uid: number): string {
  if (s.step !== 'main') return STEP_WHY[s.step] ?? 'このステップでは出せない';
  const card = s.cards[uid];
  const def = card ? reg.defs[card.defId] : null;
  if (!card || !def) return '使えない';
  const c = mkCtx(s, reg);
  const free = s.players[me].mana.filter((u) => !s.cards[u].tapped).length;
  const reasons: string[] = [];
  def.faces.forEach((f, i) => {
    const plan = planPlay(c, me, uid, 'hand', i, undefined, false);
    if (plan.ok) return; // 進化元の選択などが要るだけの面(別の理由で出せない面が他にある時の説明は不要)
    const name = def.faces.length > 1 ? `${f.name}: ` : '';
    const err = plan.err ?? '使えません';
    const cost = costOf(c, uid, i, {});
    if (err === 'マナが足りません') {
      reasons.push(free < cost ? `${name}マナが足りません(コスト ${cost} / 使えるマナ ${free})` : `${name}${f.civs.map((x) => CIV_NAME[x]).join('・')}のマナが必要`);
    } else if (err === '進化元を選んでください') {
      reasons.push(`${name}進化元がいません`);
    } else reasons.push(`${name}${err}`);
  });
  return reasons.length > 0 ? reasons.join(' / ') : '条件を満たしていない';
}
