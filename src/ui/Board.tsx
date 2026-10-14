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
        const targetPid = a.target.pid;
        const pm = s.players[0].battle.concat(s.players[1].battle).find((p) => p.pid === targetPid);
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
  /** 直近のイベントで動いたカード(強調表示) */
  flash?: Set<number>;
}

export function Board(b: BoardProps) {
  const { s, me, interactive } = b;
  const viewer: PlayerId = me ?? 0;
  const opp: PlayerId = viewer === 0 ? 1 : 0;
  const dropMap = useMemo(() => (interactive ? buildDropMap(s, b.legal) : new Map<string, Drop[]>()), [s, b.legal, interactive]);
  const [chooser, setChooser] = useState<Drop[] | null>(null);
  const flashOf = (u: number) => !!b.flash?.has(u);
  /** 行動を実行する(支払いの確認などは、呼び出し側の onAction で行う) */
  const act = (d: Drop) => {
    b.onSelect(null);
    b.onAction(d.action);
  };
  // 一覧パネル(墓地・マナ・シールドの全体を見る。ダブルクリックでも開く)
  const [listOf, setListOf] = useState<{ p: PlayerId; zone: 'mana' | 'grave' | 'shield' } | null>(null);
  const openList = (p: PlayerId, zone: 'mana' | 'grave' | 'shield') => setListOf({ p, zone });

  const dropsFor = (src: string | null) => (src ? dropMap.get(src) ?? [] : []);
  const activeKey = b.selected;
  const activeDrops = dropsFor(activeKey);
  const dropKeys = new Set(activeDrops.map((d) => d.dropKey));

  const exec = (src: string, dropKey: string | null) => {
    if (!dropKey) return;
    const ds = dropsFor(src).filter((d) => d.dropKey === dropKey);
    if (ds.length === 0) return;
    if (ds.length === 1) act(ds[0]);
    else setChooser(ds);
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
      <div className="zone hand grow">
        <div className="cards hscroll">
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
                flash={flashOf(u)}
                draggable={can}
                selected={activeKey === key}
                dim={mine && interactive && !can}
                selectable={can && activeKey !== key}
                onPointerDown={can ? begin(key) : undefined}
                onHover={hidden ? undefined : b.onHover}
              />
            );
          })}
          {mine && z.hand.length === 0 && <span className="muted">手札なし</span>}
        </div>
      </div>
    );
  };

  /** マナ: 小さなタイルで並べる(文明の色・コスト・タップ状態だけ。詳細はホバー/一覧) */
  const renderMana = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    const free = z.mana.filter((u) => !s.cards[u].tapped).length;
    return (
      <div
        className={(mine ? zcls('zone:mana') : 'zone') + ' mana grow'}
        {...(mine ? zoneProps('zone:mana') : {})}
        onDoubleClick={() => openList(p, 'mana')}
      >
        <div className="zone-label">
          マナ <b>{free}</b>/{z.mana.length}
        </div>
        <div className="cards hscroll mana-cards">
          {z.mana.map((u) => {
            const key = `mana:${u}`;
            const can = mine && interactive && dropMap.has(key);
            return (
              <CardView
                key={u}
                s={s}
                uid={u}
                mini
                tapped={s.cards[u].tapped}
                flash={flashOf(u)}
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
      <div className={(mine ? zcls('zone:battle') : 'zone') + ' battle grow'} {...(mine ? zoneProps('zone:battle') : {})}>
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
                  flash={flashOf(top)}
                  target={!!isTarget && !mine}
                  selected={activeKey === key}
                  selectable={can && activeKey !== key}
                  badge={perm.cards.length > 1 ? `重${perm.cards.length}` : undefined}
                  onPointerDown={can ? begin(key) : undefined}
                  onHover={b.onHover}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /** シールド: 枚数だけ(EXライフの枚数を添える)。相手のシールドは攻撃先 */
  const renderShield = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    const isOppShield = !mine;
    const key = 'zone:oppShield';
    const ex = z.shield.filter((u) => s.cards[u].ex).length;
    const canPeek = mine && b.peek;
    return (
      <div
        className={(isOppShield ? zcls(key, 'chip shield') : 'chip shield') + (canPeek ? ' clickable' : '')}
        {...(isOppShield ? zoneProps(key) : {})}
        onDoubleClick={canPeek ? () => openList(p, 'shield') : undefined}
        title={canPeek ? 'ダブルクリックで一覧' : undefined}
      >
        <span className="chip-label">シールド</span>
        <b>{z.shield.length}</b>
        {ex > 0 && <span className="chip-sub">EX {ex}</span>}
        {isOppShield && live && liveDrops.has(key) ? <span className="arrow-hint">← 攻撃</span> : null}
      </div>
    );
  };

  /** 墓地: 一番上(最後に置かれた)カードだけ見せる。ダブルクリック/≡で一覧 */
  const renderGrave = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    const top = z.grave.length > 0 ? z.grave[z.grave.length - 1] : null;
    const key = top !== null ? `grave:${top}` : '';
    const can = top !== null && mine && interactive && dropMap.has(key);
    return (
      <div className="chip grave" onDoubleClick={() => openList(p, 'grave')} title="ダブルクリックで一覧">
        <span className="chip-label">
          墓地 <b>{z.grave.length}</b>
          <button className="small icon" onClick={() => openList(p, 'grave')} aria-label="墓地の一覧">
            ≡
          </button>
        </span>
        {top !== null ? (
          <CardView
            s={s}
            uid={top}
            small
            draggable={can}
            selected={activeKey === key}
            selectable={can && activeKey !== key}
            onPointerDown={can ? begin(key) : undefined}
            onHover={b.onHover}
          />
        ) : (
          <span className="muted">なし</span>
        )}
      </div>
    );
  };

  const side = (p: PlayerId, mine: boolean) => {
    const z = s.players[p];
    const info = (
      <div className="zone-row info" key="info">
        {!mine && (
          <div className="chip">
            <span className="chip-label">手札</span>
            <b>{z.hand.length}</b>
          </div>
        )}
        <div className="chip">
          <span className="chip-label">山札</span>
          <b>{z.deck.length}</b>
        </div>
        {renderShield(p, mine)}
        {renderGrave(p, mine)}
        {renderMana(p, mine)}
      </div>
    );
    const battle = (
      <div className="zone-row battle-row" key="battle">
        {renderBattle(p, mine)}
      </div>
    );
    const hand = (
      <div className="zone-row" key="hand">
        {renderHand(p, mine)}
      </div>
    );
    if (mine) return <div className="side-board">{[battle, info, hand]}</div>;
    return <div className="side-board opp">{[b.showOppHand ? hand : null, info, battle]}</div>;
  };

  return (
    <div className="board">
      {side(opp, false)}
      {side(viewer, true)}
      {chooser && (
        <div className="modal-back" onClick={() => setChooser(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>どれを行いますか?</h2>
            <div className="col">
              {chooser.map((d, i) => (
                <button
                  key={i}
                  className="choice"
                  onClick={() => {
                    setChooser(null);
                    act(d);
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
      {listOf && (
        <div className="modal-back" onClick={() => setListOf(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>
              {listOf.p === viewer ? '自分' : '相手'}の{listOf.zone === 'mana' ? 'マナゾーン' : listOf.zone === 'grave' ? '墓地' : 'シールド'}(
              {s.players[listOf.p][listOf.zone].length}枚)
            </h2>
            <div className="cards">
              {(listOf.zone === 'grave' ? s.players[listOf.p].grave.slice().reverse() : s.players[listOf.p][listOf.zone]).map((u) => {
                const key = `${listOf.zone}:${u}`;
                const can = listOf.p === viewer && interactive && dropMap.has(key);
                return (
                  <CardView
                    key={u}
                    s={s}
                    uid={u}
                    tapped={false}
                    hidden={listOf.zone === 'shield' && !(listOf.p === viewer && b.peek)}
                    badge={listOf.zone === 'mana' && s.cards[u].tapped ? 'タップ' : undefined}
                    selectable={can}
                    onClick={
                      can
                        ? () => {
                            setListOf(null);
                            b.onSelect(key);
                          }
                        : undefined
                    }
                    onHover={b.onHover}
                  />
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => setListOf(null)}>閉じる</button>
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
