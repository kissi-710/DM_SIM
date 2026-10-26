// バッチ対戦の参考資料: 「勝率を ±◯% で言うのに必要な試合数」と「探索の反復回数を増やすと強さがどこで頭打ちになるか」。
// 試合数の表は式から計算する(実測で式の当てはまりを確認済み)。反復回数の表は実測(scripts/saturation、docs/saturation.md)。
import iterationData from './data/iterations.json';

/** 勝率 p を、95%区間の半幅 eps(割合)で言うのに必要な試合数(席を入れ替える通常の方式。複製対局でも、デッキが違えば同じ) */
export function gamesNeeded(p: number, eps: number): number {
  return Math.ceil((1.96 * 1.96 * p * (1 - p)) / (eps * eps));
}

/** n 試合の時の、95%区間の半幅(割合) */
export function halfWidth(p: number, n: number): number {
  return 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, n));
}

/** 実測で、最後に ±1% の外に出た試合数の 95% 点 ÷ 固定 N の式(シミュレーション。p=0.5〜0.9 で 1.28〜1.33)。「その後ずっと」の目安 */
export const STAY_FACTOR = 1.3;

const P_ROWS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const EPS_COLS = [0.05, 0.03, 0.02, 0.01, 0.005];

interface Est {
  rate: number;
  ci: number;
  games: number;
}
interface Level {
  iterations: number;
  vsRule: Est | null;
  vsDouble: Est | null;
  secPerGameVsRule: number | null;
  secPerGameVsDouble: number | null;
}

const pct = (x: number, d = 1) => (x * 100).toFixed(d);
const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 2倍にした側の勝率から、伸びの判定(54% 以上 = 伸びる、51.5〜54% = 緩やか(倍ごとに +1.5〜4pt)、それ未満 = ほぼ飽和) */
export function verdict(doubledSideRate: number): string {
  if (doubledSideRate >= 0.54) return '伸びる';
  if (doubledSideRate >= 0.515) return '緩やか';
  return 'ほぼ飽和';
}

export function BatchGuide({ games, iterations }: { games: number; iterations: number }) {
  const levels = (iterationData as { levels: Level[] }).levels.filter((l) => l.vsRule || l.vsDouble);
  const near = levels.reduce((a, b) => (Math.abs(Math.log(b.iterations / iterations)) < Math.abs(Math.log(a.iterations / iterations)) ? b : a), levels[0]);
  return (
    <details className="panel col batch-guide">
      <summary>
        <b>参考資料: 試合数と反復回数の目安</b>
      </summary>
      <h3>勝率を ±◯% で言うのに必要な試合数</h3>
      <p className="muted">
        95%区間の半幅がその値になるまでの試合数(= 1.96² × p(1−p) ÷ ±²)。いまの設定 {fmt(games)} 試合では、勝率 50% なら ±{pct(halfWidth(0.5, games))}%、80% なら ±
        {pct(halfWidth(0.8, games))}% です。
      </p>
      <table>
        <thead>
          <tr>
            <th>真の勝率</th>
            {EPS_COLS.map((e) => (
              <th key={e}>±{pct(e, e < 0.01 ? 1 : 0)}%</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {P_ROWS.map((p) => (
            <tr key={p}>
              <td>{pct(p, 0)}%</td>
              {EPS_COLS.map((e) => (
                <td key={e} style={games >= gamesNeeded(p, e) ? { color: 'var(--good)' } : undefined}>
                  {fmt(gamesNeeded(p, e))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="muted">
        <li>緑は、いまの試合数で足りている精度。勝率が 50% に近いほど多く要り、差が大きい組(90% など)は少なくて済みます。</li>
        <li>
          「途中経過が、その後ずっと ±1% に収まる」ことまで求めるなら、上の表の約 {STAY_FACTOR} 倍(50% で約 {fmt(Math.round(gamesNeeded(0.5, 0.01) * STAY_FACTOR))} 試合)。
        </li>
        <li>
          ルールベース同士の 28.8 万試合(席の方式 3 通り × 16 組)で確かめたところ、推定のばらつきは上の式どおり(式との比 1.0〜1.1)で、交互・ランダム・複製対局に差はありません。
          複製対局が効くのは、同じデッキ・同じ AI で比べる時だけです(ルールベースのミラーは常に 50% になる)。
        </li>
        <li>必要な試合数は反復回数に依らず同じです。反復を増やすと 1 試合が遅くなるだけなので、強い設定ほど「精度」を欲張れません。</li>
      </ul>
      <h3>探索の反復回数と強さ</h3>
      <p className="muted">
        反復回数 N の探索 AI を、(1) ルールベースと、(2) 反復を 2 倍にした同じ AI と対戦させた勝率。4 つのデッキの組(マルル/ザーディの全組合せ)を席を入れ替えて対戦。
        「2倍側の勝率」が 50% に近づくほど、2倍にしても強くならない(飽和)。
        {near && <> いまの反復回数 {iterations} に最も近い行は {near.iterations} です。</>}
      </p>
      <table>
        <thead>
          <tr>
            <th>反復回数 N</th>
            <th>N が ルールベースに勝つ率</th>
            <th>2N が N に勝つ率</th>
            <th>判定</th>
            <th title="この環境(クラウドの1コア)での、探索側が1手ごとに使う時間を含めた1試合あたりの秒。目安">1試合の秒(対ルール)</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => {
            const dbl = l.vsDouble ? 1 - l.vsDouble.rate : null;
            return (
              <tr key={l.iterations} style={l === near ? { background: 'var(--accent-bg, rgba(120,160,255,0.12))' } : undefined}>
                <td>{l.iterations}</td>
                <td>{l.vsRule ? `${pct(l.vsRule.rate)}% ±${pct(l.vsRule.ci)}` : '-'}</td>
                <td>{dbl !== null && l.vsDouble ? `${pct(dbl)}% ±${pct(l.vsDouble.ci)}` : '-'}</td>
                <td>{dbl !== null && l.vsDouble ? verdict(dbl) : '-'}</td>
                <td className="muted">{l.secPerGameVsRule !== null ? l.secPerGameVsRule.toFixed(2) : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="muted">
        <li>判定: 2倍側の勝率が 54% 以上なら「伸びる」、51.5〜54% は「緩やか」(2倍にして +1.5〜4pt)、それ未満は「ほぼ飽和」。各行の区間は ±2pt 前後なので、隣の行との差は誤差の内です。</li>
        <li>ルールベースに対する勝率は 90% 前後が天井で、反復の違いが見えにくい。反復の差を見るなら「2N が N に勝つ率」を使います。</li>
        <li>測定の方法と生データの場所: docs/saturation.md。</li>
      </ul>
    </details>
  );
}
