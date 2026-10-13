// カード1枚の表示(テキストのみ。image があれば表示する)。
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { charsOf, hasKeyword, powerOf } from '../engine/derive';
import { mkCtx, permByPid } from '../engine/state';
import type { GameState } from '../engine/types';
import { CIV_COLOR, reg } from './format';

export interface CardProps {
  s: GameState;
  uid: number;
  /** 裏向きで表示する(隠れた領域) */
  hidden?: boolean;
  tapped?: boolean;
  sick?: boolean;
  small?: boolean;
  tiny?: boolean;
  selectable?: boolean;
  selected?: boolean;
  target?: boolean;
  draggable?: boolean;
  dim?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent) => void;
  onHover?: (uid: number | null) => void;
  dragKey?: string;
  style?: CSSProperties;
}

export function civGradient(civs: string[]): string {
  if (civs.length === 0) return '#555';
  if (civs.length === 1) return (CIV_COLOR as any)[civs[0]];
  const step = 100 / civs.length;
  return `linear-gradient(90deg, ${civs.map((c, i) => `${(CIV_COLOR as any)[c]} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

export function CardView(p: CardProps) {
  const { s, uid } = p;
  const card = s.cards[uid];
  const cls = ['card'];
  if (p.small) cls.push('small');
  if (p.tiny) cls.push('tiny');
  if (p.tapped) cls.push('tapped');
  if (p.selectable) cls.push('selectable');
  if (p.selected) cls.push('selected');
  if (p.target) cls.push('target');
  if (p.draggable) cls.push('draggable');
  if (p.dim) cls.push('dim');
  if (p.sick) cls.push('sick');
  if (card?.ex) cls.push('ex');
  const handlers = {
    onClick: p.onClick,
    onPointerDown: p.onPointerDown,
    onMouseEnter: () => p.onHover?.(uid),
    onMouseLeave: () => p.onHover?.(null),
    'data-drag': p.dragKey,
    style: p.style,
  };
  if (p.hidden || !card || card.defId === '?') {
    cls.push('back');
    return (
      <div className={cls.join(' ')} {...handlers}>
        ?
      </div>
    );
  }
  const def = reg.defs[card.defId];
  const inPlay = card.zone === 'battle' || card.zone === 'limbo';
  const faceIdx = inPlay ? card.face : 0;
  const face = def.faces[faceIdx] ?? def.faces[0];
  const c = mkCtx(s, reg);
  const ch = charsOf(c, uid, -1);
  let power: number | null = null;
  if (face.type !== 'spell') {
    power = face.power ?? 0;
    if (card.zone === 'battle') {
      const pm = permByPid(s, card.pid);
      if (pm && pm.perm.cards[0] === uid) power = powerOf(c, pm.perm);
    }
  }
  const twin = def.faces.length > 1 && !inPlay;
  const civs = twin ? ch.civs : face.civs;
  const keywords: string[] = [];
  if (card.zone === 'battle') {
    const pm = permByPid(s, card.pid);
    if (pm && pm.perm.cards[0] === uid) {
      if (hasKeyword(c, pm.perm, 'blocker')) keywords.push('ブロッカー');
      if (hasKeyword(c, pm.perm, 'speedAttacker')) keywords.push('SA');
      if (hasKeyword(c, pm.perm, 'machFighter')) keywords.push('マッハ');
    }
  }
  const typeLabel = face.type === 'spell' ? '呪文' : face.type === 'evolution' ? '進化' : face.type === 'smaxEvolution' ? 'S-MAX進化' : 'クリーチャー';
  return (
    <div className={cls.join(' ')} title={def.name} {...handlers}>
      <div className="civbar" style={{ background: civGradient(civs) }} />
      <div className="head">
        <span className="cost">{twin ? `${def.faces[0].cost}/${def.faces[1].cost}` : face.cost}</span>
        <span className="name">{twin ? def.name.split(' / ')[0] : face.name}</span>
      </div>
      <div className="body">
        {typeLabel}
        {face.races?.length ? ` / ${face.races[0]}` : ''}
        {keywords.length ? <div>{keywords.join(' ')}</div> : null}
      </div>
      <div className="foot">
        <span>{power !== null ? power : ''}</span>
        <span>{def.faces.length > 1 && !inPlay ? 'ツイン' : ''}</span>
      </div>
      {p.badge ? <span className="badge">{p.badge}</span> : null}
    </div>
  );
}
