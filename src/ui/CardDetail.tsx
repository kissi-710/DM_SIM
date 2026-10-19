// カード詳細(名前・面・全文・現在のコスト/パワー/付与された能力)。対戦画面・観戦・手動盤面で共通。
import { costOf, effectsOnPerm, hasKeyword, powerOf, type KwName } from '../engine/derive';
import { mkCtx, permByPid } from '../engine/state';
import type { GameState } from '../engine/types';
import { civGradient } from './CardView';
import { CIV_NAME, isConcealed, reg, untilLabel } from './format';

/** reveal: 本人にも見えないカード(シールドなど)を見せる(練習用の「自分のシールドを見る」) */
export function CardDetail({ s, uid, reveal = false }: { s: GameState; uid: number | null; reveal?: boolean }) {
  if (uid !== null && s.cards[uid] && (s.cards[uid].defId === '?' || (!reveal && isConcealed(s, uid)))) {
    return <div className="muted">非公開のカード</div>;
  }
  if (uid === null || !s.cards[uid]) {
    return <div className="muted">カードにマウスを乗せると詳細を表示</div>;
  }
  const c = s.cards[uid];
  const def = reg.defs[c.defId];
  return (
    <div className="col">
      <strong>{def.name}</strong>
      {def.faces.map((f, i) => (
        <div key={i} className="panel" style={{ padding: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="tag">{f.type === 'spell' ? '呪文' : f.type === 'evolution' ? '進化' : f.type === 'smaxEvolution' ? 'S-MAX進化' : 'クリーチャー'}</span>
            <span className="tag">コスト {f.cost}</span>
            {f.power !== undefined && <span className="tag">パワー {f.power}</span>}
            <span style={{ width: 60, height: 8, background: civGradient(f.civs), borderRadius: 4, display: 'inline-block' }} title={f.civs.map((x) => CIV_NAME[x]).join('・')} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {f.civs.map((x) => CIV_NAME[x]).join('・')}
            {f.races?.length ? ` / ${f.races.join('・')}` : ''}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12.5 }}>{def.text}</div>
      <Derived s={s} uid={uid} />
    </div>
  );
}

const KW_LABEL: Record<string, string> = {
  blocker: 'ブロッカー',
  speedAttacker: 'スピードアタッカー',
  machFighter: 'マッハファイター',
  shieldTrigger: 'S・トリガー',
  justDiver: 'ジャストダイバー',
  exLife: 'EXライフ',
};
const EFFECT_LABEL: Record<string, string> = {
  cannotAttack: '攻撃できない',
  cannotBeChosen: '選ばれない',
  cannotBeAttacked: '攻撃されない',
  mustBlock: 'ブロックしなければならない',
};

/** 現在のコスト・パワー・付与された能力(画像なしなので、全文と一緒に派生値を出す) */
function Derived({ s, uid }: { s: GameState; uid: number }) {
  const c = mkCtx(s, reg);
  const card = s.cards[uid];
  const lines: string[] = [];
  if (card.zone === 'battle') {
    const pm = permByPid(s, card.pid);
    if (pm && pm.perm.cards[0] === uid) {
      lines.push(`現在のパワー: ${powerOf(c, pm.perm)}`);
      const kws = (['blocker', 'speedAttacker', 'machFighter', 'shieldTrigger', 'justDiver', 'exLife'] as KwName[]).filter((k) => hasKeyword(c, pm.perm, k));
      if (kws.length) lines.push('持っている能力: ' + kws.map((k) => KW_LABEL[k]).join('、'));
      for (const e of effectsOnPerm(c, pm.perm.pid)) {
        if (e.mod.kind === 'powerAdd') lines.push(`パワー ${e.mod.n > 0 ? '+' : ''}${e.mod.n}(${e.until.kind === 'endOfTurn' ? 'このターン中' : '次の自分のターンのはじめまで'})`);
        else if (e.mod.kind === 'grant') lines.push(`${KW_LABEL[e.mod.keyword] ?? e.mod.keyword} を得ている`);
        else if (e.mod.kind === 'cannotBeChosen' || e.mod.kind === 'cannotBeAttacked') lines.push(`🛡 ${EFFECT_LABEL[e.mod.kind]}(${untilLabel(e.until)})`);
        else lines.push(EFFECT_LABEL[e.mod.kind] ?? e.mod.kind);
      }
      lines.push(`${pm.perm.tapped ? 'タップ' : 'アンタップ'}状態${pm.perm.sick ? '(召喚酔い)' : ''}${pm.perm.cards.length > 1 ? ' / 進化元 ' + (pm.perm.cards.length - 1) + '枚' : ''}`);
    }
  } else if (card.zone === 'hand' || card.zone === 'mana' || card.zone === 'grave') {
    const def = reg.defs[card.defId];
    def.faces.forEach((f, i) => {
      const now = costOf(c, uid, i, {});
      lines.push(`${def.faces.length > 1 ? f.name + ': ' : ''}現在のコスト ${now}${now !== f.cost ? `(表記 ${f.cost})` : ''}`);
    });
  }
  if (lines.length === 0) return null;
  return (
    <div className="panel" style={{ padding: 6, fontSize: 12.5 }}>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
