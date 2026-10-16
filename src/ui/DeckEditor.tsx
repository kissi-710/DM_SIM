// デッキの編集・保存(localStorage)・JSONのインポート/エクスポート(design 10)。
import { useMemo, useState } from 'react';
import { CARD_DB, CARD_LIST } from '../cards';
import { checkDeck } from '../engine/engine';
import { civGradient } from './CardView';
import { allDecks, deleteDeck, saveDeck } from './decks';
import { CIV_NAME } from './format';
import { downloadText } from './util';
import { errorMessage } from '../engine/types';

export function DeckEditor() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState('マイデッキ');
  const [id, setId] = useState(() => 'u' + Date.now().toString(36));
  const [saved, setSaved] = useState(() => allDecks());
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const cards = CARD_LIST.filter((c) => c.id !== 'dummy');

  const list = useMemo(() => Object.entries(counts).flatMap(([cid, n]) => Array(n).fill(cid) as string[]), [counts]);
  const chk = checkDeck(CARD_DB, list, true);
  const add = (cid: string, d: number) =>
    setCounts((c) => {
      const n = Math.max(0, Math.min(4, (c[cid] ?? 0) + d));
      const next = { ...c, [cid]: n };
      if (n === 0) delete next[cid];
      return next;
    });
  const load = (cardsList: string[], nm: string, nid?: string) => {
    const m: Record<string, number> = {};
    for (const c of cardsList) m[c] = (m[c] ?? 0) + 1;
    setCounts(m);
    setName(nm);
    if (nid) setId(nid);
  };

  return (
    <div className="page">
      <div className="menu" style={{ maxWidth: 1100 }}>
        <h2>デッキ編集</h2>
        <div className="deck-edit">
          <div className="panel col" style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <h3>カード一覧(対応している28種)</h3>
            {cards.map((c) => (
              <div key={c.id} className="deck-line">
                <span style={{ width: 28, height: 10, borderRadius: 3, background: civGradient(c.faces[0].civs) }} />
                <span className="nm" title={c.text}>
                  {c.name}
                  <span className="muted"> ({c.faces.map((f) => `${f.cost}`).join('/')})</span>
                </span>
                <button className="small" onClick={() => add(c.id, -1)}>
                  −
                </button>
                <span style={{ width: 18, textAlign: 'center' }}>{counts[c.id] ?? 0}</span>
                <button className="small" onClick={() => add(c.id, 1)}>
                  ＋
                </button>
              </div>
            ))}
          </div>
          <div className="col">
            <div className="panel col">
              <label className="row">
                名前 <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
              </label>
              <div>
                {list.length} 枚 {chk.ok ? <span style={{ color: 'var(--good)' }}>(40枚・構築制限OK)</span> : <span style={{ color: 'var(--bad)' }}>{chk.errors.join(' / ')}</span>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {Object.entries(counts)
                  .map(([cid, n]) => `${CARD_DB[cid].name.split(' / ')[0]}×${n}`)
                  .join('、')}
              </div>
              <div className="row">
                <button
                  className="primary"
                  disabled={list.length === 0}
                  onClick={() => {
                    saveDeck({ id, name, cards: list });
                    setSaved(allDecks());
                    setMsg('ブラウザに保存しました');
                  }}
                >
                  保存
                </button>
                <button onClick={() => downloadText(`${name}.json`, JSON.stringify({ name, cards: list }, null, 1))}>JSONで書き出す</button>
                <button
                  onClick={() => {
                    setCounts({});
                    setId('u' + Date.now().toString(36));
                  }}
                >
                  空にする
                </button>
              </div>
              {msg && <span className="muted">{msg}</span>}
            </div>
            <div className="panel col">
              <h3>保存済み・プリセット</h3>
              {saved.map((d) => (
                <div key={d.id} className="deck-line">
                  <span className="nm">
                    {d.name} {d.preset && <span className="tag">プリセット</span>}
                  </span>
                  <button className="small" onClick={() => load(d.cards, d.preset ? d.name + '(コピー)' : d.name, d.preset ? undefined : d.id)}>
                    読み込む
                  </button>
                  {!d.preset && (
                    <button
                      className="small danger"
                      onClick={() => {
                        deleteDeck(d.id);
                        setSaved(allDecks());
                      }}
                    >
                      削除
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="panel col">
              <h3>JSONの読み込み</h3>
              <textarea className="json" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"name":"…","cards":["dmrp01-093", …]}' />
              <button
                onClick={() => {
                  try {
                    const o = JSON.parse(json);
                    const cs: unknown = o?.cards ?? o;
                    if (!Array.isArray(cs) || cs.some((c) => typeof c !== 'string' || !Object.hasOwn(CARD_DB, c))) throw new Error('未知のカードIDがあります');
                    load(cs as string[], typeof o?.name === 'string' && o.name ? o.name : 'インポートしたデッキ');
                    setMsg('読み込みました');
                  } catch (e) {
                    setMsg('読み込めません: ' + errorMessage(e));
                  }
                }}
              >
                読み込む
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

void CIV_NAME;
