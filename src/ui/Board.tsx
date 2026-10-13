// 盤面。ドラッグ(手札→マナ/バトルゾーン、クリーチャー→相手/シールド)と、
// すべてのクリック代替(札をクリック → 強調された行き先/ボタンをクリック)を提供する。
// ルール判定はせず、legalActions から作る「ドロップ先マップ」だけを使う(effects 11.3)。
import { useMemo, useState } from 'react';
import { CardView } from './CardView';
import { cardName, reg } from './format';
import { useDrag } from './useDrag';
import type { Action, GameState, PlayerId } from '../engine/types';

export interface Drop {
  dropKey: string;
  action: Action;
  label: string;
}

/** ドラッグ元のキー → 行き先 */
export function buildDropMap(s: GameState, legal: Action[]): Map<string, Drop[]> {
  const map = new Map<string, Drop[]>();
  const add = (src: string, d: Drop) => {
    const l = map.get(src) ?? [];
    l.push(d);
    map.set(src, l);
  };
  const N = (u: number) => cardName(s, u);
  for (const a of legal) {
    if (a.type === 'CHARGE_MANA') {
      add(`hand:${a.uid}`, { dropKey: 'zone:mana', action: a, label: 'マナチャージ' });
    } else if (a.type === 'PLAY_CARD') {
      const from = a.from ?? 'hand';
      const def = reg.defs[s.cards[a.uid].defId];
      const fi = a.face ?? 0;
      const face = def.faces[fi];
      const isSpell = face.type === 'spell';
      let label = `${isSpell ? '唱える' : '召喚'}: ${face.name}`;
      if (from === 'mana') label += '(マナゾーンから)';
      if (from === 'grave') label += '(墓地から)';
      if (a.extra?.onto !== undefined) {
        const pm = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === a.extra!.onto);
        if (pm) label += ` → ${N(pm.cards[0])}の上に重ねる`;
      }
      if (a.extra?.tap?.length) {
        const names = a.extra.tap.map((pid) => {
          const pm = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === pid);
          return pm ? N(pm.cards[0]) : '?';
        });
        label += ` [ハイパーエナジー: ${names.join('、')}をタップ]`;
      }
      const dropKey = a.extra?.onto !== undefined ? `pile:${a.extra.onto}` : 'zone:battle';
      add(`${from}:${a.uid}`, { dropKey, action: a, label });
      // 進化は、バトルゾーン全体へのドロップでも選べるようにする
      if (a.extra?.onto !== undefined) add(`${from}:${a.uid}`, { dropKey: 'zone:battle', action: a, label });
    } else if (a.type === 'ATTACK') {
      const pid = a.attacker;
      if (a.target.kind === 'player') {
        add(`pile:${pid}`, { dropKey: 'zone:oppShield', action: a, label: 'プレイヤーを攻撃' });
      } else {
        const pm = s.players[0].battle.concat(s.players[1].battle).find((p) => p.pid === (a.target as any).pid);
        add(`pile:${pid}`, { dropKey: `opp-pile:${a.target.pid}`, action: a, label: `${pm ? N(pm.cards[0]) : 'クリーチャー'}を攻撃` });
      }
    }
  }
  return map;
}

interface BoardProps {
  s: GameState;
  me: PlayerId | null;
  legal: Action[];
  /** 人間が今、行動できるか */
  interactive: boolean;
  onAction: (a: Action) => void;
  onHover: (uid: number | null) => void;
  /** 自分の山札・シールドの中身を見る(練習用) */
  peek: boolean;
  /** 相手の手札も見せる(観戦用) */
  showOppHand: boolean;
  /** 選択中のカード(外に出して、フッターで行き先ボタンを出す) */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

export function Board(b: BoardProps) {
  const { s, me, interactive } = b;
  const viewer: PlayerId = me ?? 0;
  const opp: PlayerId = viewer === 0 ? 1 : 0;
  const dropMap = useMemo(() => (interactive ? buildDropMap(s, b.legal) : new Map<string, Drop[]>()), [s, b.legal, interactive]);
  const [chooser, setChooser] = useState<Drop[] | null>(null);

  const dropsFor = (src: string | null) => (src ? dropMap.get(src) ?? [] : []);
  const activeKey = b.selected;
  const activeDrops = dropsFor(activeKey);
  const dropKeys = new Set(activeDrops.map((d) => d.dropKey));

  const exec = (src: string, dropKey: string | null) => {
    if (!dropKey) return;
    const ds = dropsFor(src).filter((d) => d.dropKey === dropKey);
    if (ds.length === 0) return;
    if (ds.length === 1) {
      b.onSelect(null);
      b.onAction(ds[0].action);
    } else setChooser(ds);
  };

  const { drag, begin } = useDrag({
    onStart: (key) => b.onSelect(key),
    onDrop: (key, drop) => exec(key, drop),
    onClick: (key) => b.onSelect(b.selected === key ? null : key),
  });
  // ドラッグ中は、そのカードの行き先を強調する
  const live = drag ? drag.key : activeKey;
  const liveDrops = new Set(dropsFor(live).map((d) => d.dropKey));
  void dropKeys;

  const zoneProps = (key: string) => ({
    'data-drop': key,
    onClick: () => {
      if (activeKey && liveDrops.has(key)) exec(activeKey, key);
    },
  });
  const zcls = (key: string, base = 'zone') => base + (live && liveDrops.has(key) ? ' drop-ok' : '') + (drag?.over === key ? ' drop-over' : '');

  const renderHand = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    return (
      <div className="zone grow">
        <div className="zone-title">手札 {z.hand.length}枚</div>
        <div className="cards">
          {z.hand.map((u) => {
            const key = `hand:${u}`;
            const can = mine && interactive && dropMap.has(key);
            const hidden = !mine && !b.showOppHand;
            return (
              <CardView
                key={u}
                s={s}
                uid={u}
                hidden={hidden}
                small={!mine}
                tiny={hidden}
                draggable={can}
                selected={activeKey === key}
                dim={mine && interactive && !can}
                selectable={can && activeKey !== key}
                onPointerDown={can ? begin(key) : undefined}
                onHover={hidden ? undefined : b.onHover}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderMana = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    return (
      <div className={zcls('zone:mana') + ' grow'} {...(mine ? zoneProps('zone:mana') : {})} style={{ flex: 1 }}>
        <div className="zone-title">マナゾーン {z.mana.length}枚(未使用 {z.mana.filter((u) => !s.cards[u].tapped).length})</div>
        <div className="cards">
          {z.mana.map((u) => {
            const key = `mana:${u}`;
            const can = mine && interactive && dropMap.has(key);
            return (
              <CardView
                key={u}
                s={s}
                uid={u}
                small
                tapped={s.cards[u].tapped}
                draggable={can}
                selected={activeKey === key}
                selectable={can && activeKey !== key}
                onPointerDown={can ? begin(key) : undefined}
                onHover={b.onHover}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderBattle = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    return (
      <div className={zcls('zone:battle') + ' grow'} {...(mine ? zoneProps('zone:battle') : {})} style={{ flex: 3 }}>
        <div className="zone-title">バトルゾーン {z.battle.length}体</div>
        <div className="cards">
          {z.battle.map((perm) => {
            const top = perm.cards[0];
            const key = `pile:${perm.pid}`;
            const pileDropKey = mine ? `pile:${perm.pid}` : `opp-pile:${perm.pid}`;
            const can = mine && interactive && dropMap.has(key);
            const isTarget = live && liveDrops.has(pileDropKey);
            return (
              <div
                key={perm.pid}
                className={'pile' + (isTarget ? ' drop-ok' : '')}
                data-drop={pileDropKey}
                onClick={() => {
                  if (activeKey && liveDrops.has(pileDropKey)) exec(activeKey, pileDropKey);
                }}
              >
                {perm.cards.length > 1 && <div className="under" />}
                <CardView
                  s={s}
                  uid={top}
                  tapped={perm.tapped}
                  sick={perm.sick}
                  draggable={can}
                  target={!!isTarget && !mine}
                  selected={activeKey === key}
                  selectable={can && activeKey !== key}
                  badge={perm.cards.length > 1 ? `重${perm.cards.length}` : undefined}
                  onPointerDown={can ? begin(key) : undefined}
                  onClick={mine && !can ? undefined : undefined}
                  onHover={b.onHover}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderShield = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    const isOppShield = !mine;
    const key = 'zone:oppShield';
    return (
      <div className={(isOppShield ? zcls(key) : 'zone') + ' '} {...(isOppShield ? zoneProps(key) : {})} style={{ minWidth: 150 }}>
        <div className="zone-title">
          シールド {z.shield.length}枚 {isOppShield && live && liveDrops.has(key) ? <span className="arrow-hint">← 攻撃</span> : null}
        </div>
        <div className="cards">
          {z.shield.map((u) => (
            <CardView key={u} s={s} uid={u} small tiny={!(mine && b.peek)} hidden={!(mine && b.peek)} onHover={mine && b.peek ? b.onHover : undefined} />
          ))}
        </div>
      </div>
    );
  };

  const renderGrave = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    return (
      <div className="zone" style={{ minWidth: 150, maxWidth: 360 }}>
        <div className="zone-title">
          墓地 {z.grave.length}枚 / 山札 {z.deck.length}枚
        </div>
        <div className="cards scroll">
          {z.grave
            .slice()
            .reverse()
            .map((u) => {
              const key = `grave:${u}`;
              const can = mine && interactive && dropMap.has(key);
              return (
                <CardView
                  key={u}
                  s={s}
                  uid={u}
                  small
                  draggable={can}
                  selected={activeKey === key}
                  selectable={can && activeKey !== key}
                  onPointerDown={can ? begin(key) : undefined}
                  onHover={b.onHover}
                />
              );
            })}
        </div>
      </div>
    );
  };

  const side = (p: PlayerId, mine: boolean) => {
    const top = (
      <div className="zone-row" key="top">
        {renderShield(p, mine)}
        {renderBattle(p, mine)}
        {renderGrave(p, mine)}
      </div>
    );
    const mana = (
      <div className="zone-row" key="mana">
        {renderMana(p, mine)}
      </div>
    );
    const hand = (
      <div className="zone-row" key="hand">
        {renderHand(p, mine)}
      </div>
    );
    return <div className={'side-board' + (mine ? '' : ' opp')}>{mine ? [top, mana, hand] : [hand, mana, top]}</div>;
  };

  return (
    <div className="board">
      {side(opp, false)}
      {side(viewer, true)}
      {chooser && (
        <div className="modal-back" onClick={() => setChooser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>どれを行いますか?</h2>
            <div className="col">
              {chooser.map((d, i) => (
                <button
                  key={i}
                  className="choice"
                  onClick={() => {
                    setChooser(null);
                    b.onSelect(null);
                    b.onAction(d.action);
                  }}
                >
                  {d.label}
                </button>
              ))}
              <button onClick={() => setChooser(null)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {(() => {
            const [kind, id] = drag.key.split(':');
            let uid = Number(id);
            if (kind === 'pile') {
              const pm = s.players[viewer].battle.find((p) => p.pid === Number(id));
              uid = pm ? pm.cards[0] : 0;
            }
            return <CardView s={s} uid={uid} small />;
          })()}
        </div>
      )}
    </div>
  );
}

/** 選択中のカードの行き先(クリック代替のボタン)を作る */
export function selectedActions(s: GameState, legal: Action[], selected: string | null): Drop[] {
  if (!selected) return [];
  return buildDropMap(s, legal).get(selected) ?? [];
}
