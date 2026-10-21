// 不変条件(design 11): カードの総数保存・各カードがちょうど1か所にある・ゾーン情報の整合。
import type { GameState, PlayerId } from './types';

export function checkInvariants(s: GameState): string[] {
  const errs: string[] = [];
  const where = new Map<number, string>();
  const put = (uid: number, label: string) => {
    if (where.has(uid)) errs.push(`カード${uid}が重複: ${where.get(uid)} と ${label}`);
    where.set(uid, label);
  };
  for (const p of [0, 1] as PlayerId[]) {
    const z = s.players[p];
    for (const name of ['deck', 'hand', 'mana', 'shield', 'grave', 'hyper'] as const) {
      for (const u of z[name]) {
        put(u, `${p}:${name}`);
        const c = s.cards[u];
        if (!c) errs.push(`存在しないカード ${u}`);
        else {
          if (c.zone !== name) errs.push(`カード${u}の zone=${c.zone} だが ${name} にある`);
          if (c.owner !== p) errs.push(`カード${u}の持ち主が違う`);
        }
      }
    }
    for (const perm of z.battle) {
      if (perm.cards.length === 0) errs.push(`空の山 ${perm.pid}`);
      for (const u of perm.cards) {
        put(u, `${p}:battle`);
        const c = s.cards[u];
        if (c.zone !== 'battle') errs.push(`カード${u}の zone=${c.zone} だが battle にある`);
        if (c.pid !== perm.pid) errs.push(`カード${u}の pid が違う`);
        if (c.owner !== p) errs.push(`カード${u}の持ち主が違う(battle)`);
      }
    }
  }
  // 重ねて置かれたシールド(山)の、下のカード
  for (const [top, under] of Object.entries(s.piles ?? {})) {
    const t = s.cards[Number(top)];
    if (!t || t.zone !== 'shield') errs.push(`シールドの山の一番上 ${top} がシールドゾーンにない`);
    for (const u of under) {
      put(u, `${s.cards[u]?.owner}:shield-under`);
      if (s.cards[u]?.zone !== 'shield') errs.push(`山の下のカード${u}の zone が shield でない`);
    }
  }
  for (const u of s.limbo) {
    put(u, 'limbo');
    if (s.cards[u].zone !== 'limbo') errs.push(`カード${u}の zone が limbo でない`);
  }
  if (where.size !== s.cards.length) errs.push(`カード総数が合わない: ${where.size} / ${s.cards.length}`);
  for (const e of s.effects) {
    if (e.pid >= 0 && !s.players[0].battle.concat(s.players[1].battle).some((x) => x.pid === e.pid)) {
      // 場を離れた山への継続効果は残ってもよいが、参照は壊れていないこと
    }
  }
  if (s.pending && s.cont.length === 0 && s.winner === null) errs.push('pending があるが実行スタックが空');
  return errs;
}
