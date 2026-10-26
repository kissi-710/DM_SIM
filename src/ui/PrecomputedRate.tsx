// 事前に計算した勝率(全デッキの全組み合わせ。探索 AI 同士・同じ反復回数・複製対局)。バッチを回さずに、選んだ 2 デッキの勝率を表示する。
// 計算は scripts/precompute-matrix.ts、書き出しは src/ui/data/matrix.json。
import { DECK_PRESETS } from '../cards';
import matrixData from './data/matrix.json';

export interface MatrixCell {
  a: string;
  b: string;
  games: number;
  rate: number;
  lo: number;
  hi: number;
  aFirst: number | null;
  aSecond: number | null;
  draw: number;
  turns: number;
  /** 手数の上限で打ち切って引き分けにした試合数 */
  cut?: number;
}
export interface MatrixData {
  iterations: number;
  head: string;
  decks: string[];
  cells: MatrixCell[];
}

/** deckA から見た勝率。保存は(並び順で前の,後の)の 1 方向だけなので、逆の向きは 1−x にして返す */
export function lookupRate(data: MatrixData, deckA: string, deckB: string): MatrixCell | null {
  const direct = data.cells.find((c) => c.a === deckA && c.b === deckB);
  if (direct) return direct;
  const rev = data.cells.find((c) => c.a === deckB && c.b === deckA);
  if (!rev) return null;
  return {
    ...rev,
    a: deckA,
    b: deckB,
    rate: 1 - rev.rate,
    lo: 1 - rev.hi,
    hi: 1 - rev.lo,
    aFirst: rev.aSecond === null ? null : 1 - rev.aSecond,
    aSecond: rev.aFirst === null ? null : 1 - rev.aFirst,
  };
}

const pct = (x: number, d = 1) => (x * 100).toFixed(d);
const data = matrixData as MatrixData;
const nameOf = (id: string) => DECK_PRESETS.find((d) => d.id === id)?.name ?? id;

/** 勝率の色(0% = 赤、50% = 無色、100% = 緑) */
const tint = (rate: number) => {
  const t = Math.abs(rate - 0.5) * 2;
  return `color-mix(in srgb, ${rate >= 0.5 ? 'var(--good, #3a3)' : 'var(--bad, #c44)'} ${Math.round(t * 55)}%, transparent)`;
};

export function PrecomputedRate({ deckA, deckB, d = data }: { deckA: string; deckB: string; d?: MatrixData }) {
  const cell = lookupRate(d, deckA, deckB);
  return (
    <details className="panel col batch-precomputed" open>
      <summary>
        <b>事前計算した勝率(探索 AI 同士・反復 {d.iterations})</b>
      </summary>
      {!cell ? (
        <p className="muted">この組み合わせは、まだ計算されていません(自作デッキなどはバッチで測ります)。</p>
      ) : (
        <>
          <p>
            <b>{nameOf(deckA)}</b> が <b>{nameOf(deckB)}</b> に勝つ率: <b style={{ fontSize: '1.4em' }}>{pct(cell.rate)}%</b>{' '}
            <span className="muted">
              (95% 区間 {pct(cell.lo)}〜{pct(cell.hi)}%、±{pct((cell.hi - cell.lo) / 2)}。{cell.games.toLocaleString('ja-JP')} 試合)
            </span>
          </p>
          <p className="muted">
            Aが先攻の時 {cell.aFirst === null ? '-' : pct(cell.aFirst) + '%'} / 後攻の時 {cell.aSecond === null ? '-' : pct(cell.aSecond) + '%'}。引き分け {pct(cell.draw)}%、平均 {cell.turns.toFixed(1)} ターン。
            両側とも反復 {d.iterations} の探索 AI が操縦した結果で、反復や AI を変えると値も変わります。
            {deckA === deckB && ' 同じデッキ同士は、配りが同じで席を入れ替えた対局なので 50% に決まります。'}
            {(cell.cut ?? 0) > 0 && ` 終わらない試合を手数の上限で打ち切り、引き分けにしたのが ${cell.cut} 試合あります。`}
          </p>
        </>
      )}
      {d.decks.length > 0 && <p className="muted">計算した版: {d.head.slice(0, 7)}。カード・エンジン・AI を変えた場合は、scripts/precompute-matrix.ts で計算し直します(docs/matrix.md)。</p>}
      {d.decks.length > 0 && (
        <details>
          <summary>全組み合わせの表(行のデッキが、列のデッキに勝つ率 %)</summary>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '0.8em' }}>
              <thead>
                <tr>
                  <th />
                  {d.decks.map((id) => (
                    <th key={id} title={nameOf(id)}>
                      {id.replace('sd1-', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.decks.map((r) => (
                  <tr key={r}>
                    <th title={nameOf(r)}>{r.replace('sd1-', '')}</th>
                    {d.decks.map((c) => {
                      const x = lookupRate(d, r, c);
                      return (
                        <td key={c} title={x ? `${nameOf(r)} 対 ${nameOf(c)}: ${pct(x.lo)}〜${pct(x.hi)}%(${x.games}試合)` : ''} style={{ background: x ? tint(x.rate) : undefined, outline: r === deckA && c === deckB ? '2px solid var(--accent, #58f)' : undefined }}>
                          {x ? pct(x.rate, 0) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </details>
  );
}
