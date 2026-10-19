// 一人回し(手動)モード: ルール処理を行わず、カードを自由に動かして回す練習用の画面。
// カード効果は自動処理されない(自分で処理する)。確率調査の結果を自分の手で確かめる用途。
import { useMemo, useState } from 'react';
import { CARD_DB } from '../cards';
import { createGame } from '../engine/engine';
import { manualDraw, manualMove, manualNextTurn, manualShuffle, manualToggleTap, manualUntapAll } from '../engine/manual';
import type { Ev, GameState, ZoneName } from '../engine/types';
import { CardView } from './CardView';
import { CardDetail } from './GameView';
import { allDecks, findDeck } from './decks';
import { DeckSelect } from './DeckSelect';
import { cardName, ZONE_NAME } from './format';
import { useDrag } from './useDrag';

interface Entry {
  text: string;
  tag: '手動' | '自動';
}

const ZONES: ZoneName[] = ['battle', 'shield', 'mana', 'hand', 'grave'];

export function ManualView() {
  const decks = allDecks();
  const [deckId, setDeckId] = useState('maruru');
  const [seed, setSeed] = useState(1);
  const [game, setGame] = useState<GameState | null>(null);
  const [history, setHistory] = useState<GameState[]>([]);
  const [log, setLog] = useState<Entry[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [showList, setShowList] = useState<ZoneName | null>(null);
  const [peek, setPeek] = useState(false);

  const start = () => {
    const d = findDeck(deckId).cards;
    const g = createGame(CARD_DB, { decks: [d, Array(40).fill('dummy')], seed, first: 0, shuffle: [true, false], cfg: { solitaire: true } });
    setGame(g.state);
    setHistory([]);
    setLog([{ text: 'ゲーム開始: 山札をシャッフル・シールドを5枚セット・手札を5枚引いた', tag: '自動' }]);
  };

  const apply = (next: GameState, text: string, tag: Entry['tag'] = '手動') => {
    if (!game) return;
    setHistory((h) => [...h, game].slice(-100));
    setGame(next);
    setLog((l) => [...l, { text, tag }]);
  };

  const move = (uid: number, to: ZoneName, pos?: 'top' | 'bottom') => {
    if (!game) return;
    const r = manualMove(CARD_DB, game, uid, to, { pos });
    apply(r.state, `${cardName(game, uid)}: ${ZONE_NAME[game.cards[uid].zone]} → ${ZONE_NAME[to]}${pos === 'bottom' ? '(下)' : ''}`);
  };

  const { drag, begin } = useDrag({
    onDrop: (key, drop) => {
      if (!drop?.startsWith('mz:')) return;
      const uid = Number(key);
      const to = drop.slice(3) as ZoneName;
      if (game && game.cards[uid].zone !== to) move(uid, to);
    },
    onClick: (key) => {
      if (!game) return;
      const uid = Number(key);
      const c = game.cards[uid];
      if (c.zone === 'battle' || c.zone === 'mana') {
        const r = manualToggleTap(CARD_DB, game, uid);
        apply(r.state, `${cardName(game, uid)} をタップ/アンタップ`);
      } else setHover(uid);
    },
  });

  const events: Ev[] = [];
  void events;
  const groups = useMemo(() => game?.players[0], [game]);

  if (!game || !groups) {
    return (
      <div className="page">
        <div className="menu">
          <h2>一人回し(手動)</h2>
          <p className="muted">
            カードを自由に動かして回す練習用のモードです。ルール処理・効果の自動処理は行いません(自分で処理します)。ドラッグでゾーン間を移動、クリックでタップ/アンタップ。
          </p>
          <div className="panel col">
            <DeckSelect decks={decks} value={deckId} onChange={setDeckId} />
            <label className="row">
              シード <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
            </label>
            <button className="primary" onClick={start}>
              開始
            </button>
          </div>
        </div>
      </div>
    );
  }

  const z = groups;
  const cardsOf = (zone: ZoneName): number[] => (zone === 'battle' ? z.battle.map((p) => p.cards[0]) : zone === 'deck' ? z.deck : z[zone as 'hand' | 'mana' | 'shield' | 'grave']);

  const renderZone = (zone: ZoneName) => {
    const list = cardsOf(zone);
    const folded = fold[zone];
    return (
      <div key={zone} className={'zone' + (drag?.over === `mz:${zone}` ? ' drop-ok drop-over' : drag ? ' drop-ok' : '')} data-drop={`mz:${zone}`}>
        <div className="zone-title">
          <strong>{ZONE_NAME[zone]}</strong> {list.length}枚
          <button className="small" onClick={() => setFold((f) => ({ ...f, [zone]: !f[zone] }))}>
            {folded ? '展開' : '折りたたむ'}
          </button>
          <button className="small" onClick={() => setShowList(zone)}>
            ≡ 一覧
          </button>
          {(zone === 'mana' || zone === 'battle') && (
            <button className="small" onClick={() => apply(manualUntapAll(game, 0, zone), `${ZONE_NAME[zone]}を全アンタップ`)}>
              ↺ 全アンタップ
            </button>
          )}
        </div>
        {!folded && (
          <div className="cards">
            {list.map((u) => {
              const tapped = zone === 'battle' ? z.battle.find((p) => p.cards[0] === u)?.tapped : game.cards[u].tapped;
              return (
                <CardView
                  key={u}
                  s={game}
                  uid={u}
                  small={zone !== 'hand' && zone !== 'battle'}
                  hidden={zone === 'shield' && !peek}
                  tiny={zone === 'shield' && !peek}
                  tapped={tapped}
                  draggable
                  onPointerDown={begin(String(u))}
                  onHover={zone === 'shield' && !peek ? undefined : setHover}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="menu" style={{ maxWidth: 1250 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>一人回し(手動)</h2>
          <span className="status-chip">{Math.ceil(game.turn / 2)}ターン目(手動で送る)</span>
          <span className="status-chip">山札 {z.deck.length}枚</span>
          <button onClick={() => { const r = manualDraw(CARD_DB, game, 0, 1); apply(r.state, 'カードを1枚引いた'); }}>ドロー</button>
          <button onClick={() => { const r = manualNextTurn(CARD_DB, game, 0, true); apply(r.state, '次のターン: アンタップ・ドロー'); }}>次のターン</button>
          <button onClick={() => apply(manualShuffle(game, 0, game.rng + log.length), '山札をシャッフルした')}>山札をシャッフル</button>
          <button
            onClick={() => {
              const top = z.deck[0];
              if (top !== undefined) move(top, 'mana');
            }}
          >
            山札の上→マナ
          </button>
          <button
            onClick={() => {
              const top = z.deck[0];
              if (top !== undefined) move(top, 'shield');
            }}
          >
            山札の上→シールド
          </button>
          <button disabled={history.length === 0} onClick={() => { setGame(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); setLog((l) => l.slice(0, -1)); }}>
            ↶ 元に戻す
          </button>
          <label>
            <input type="checkbox" checked={peek} onChange={(e) => setPeek(e.target.checked)} /> 非公開領域を表示
          </label>
          <button onClick={() => setGame(null)}>やり直す</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 12 }}>
          <div className="col">{ZONES.map(renderZone)}</div>
          <div className="col">
            <div className="panel">
              <h3>カードの詳細</h3>
              <CardDetail s={game} uid={hover} />
            </div>
            <div className="panel" style={{ maxHeight: 360, overflow: 'auto' }}>
              <h3>操作履歴</h3>
              {log
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={i} className="log-line">
                    <span className={'tag' + (e.tag === '自動' ? ' auto' : '')}>{e.tag}</span> {e.text}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <CardView s={game} uid={Number(drag.key)} small />
        </div>
      )}
      {showList && (
        <div className="modal-back" onClick={() => setShowList(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>
              {ZONE_NAME[showList]}の一覧({cardsOf(showList).length}枚)
            </h2>
            <div className="cards">
              {cardsOf(showList).map((u) => (
                <div key={u} className="col" style={{ alignItems: 'center' }}>
                  <CardView s={game} uid={u} small onHover={setHover} />
                  <div className="row" style={{ gap: 2 }}>
                    {(['hand', 'mana', 'battle', 'grave', 'shield'] as ZoneName[])
                      .filter((t) => t !== game.cards[u].zone)
                      .map((t) => (
                        <button key={t} className="small" onClick={() => move(u, t)}>
                          →{ZONE_NAME[t].replace('ゾーン', '')}
                        </button>
                      ))}
                    <button className="small" onClick={() => move(u, 'deck', 'top')}>→山札上</button>
                    <button className="small" onClick={() => move(u, 'deck', 'bottom')}>→山札下</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => setShowList(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
