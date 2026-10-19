// 操作ヘルプ(ショートカット一覧と Tips)。
import { Kbd } from './Kbd';
import { SHORTCUTS } from './keymap';

export const TIPS = [
  'カードをクリックすると操作を表示。ドラッグでも操作できる。',
  '矢印キーでカードを選び、数字キーで操作を選ぶ。',
  'E でターン終了、M でマナチャージを飛ばす。質問は Enter で決定、Esc で取り消し。',
  'カードにマウスを乗せると、現在のコストとパワーを表示。',
  '手札が増えたら横スクロール(Shift+ホイール)。',
  'マナの払い方を選ぶかは「⚙ 表示」で切り替えられる。',
  '練習設定なら Z で1手戻せる。',
  'ログの「自動」「手動」で、効果の解決と操作を区別できる。',
];

/** 観戦中に出す Tips(操作のヒントは出さない) */
export const WATCH_TIPS = [
  'Space で一時停止。停止中は → で1手ずつ進む。',
  '「速度」で CPU の手の間隔を変えられる(演出が有効だと、演出の長さが下限。最速にするには、設定の「演出」をなしにする)。',
  '「⚙ 表示」で相手の手札を見られる。',
  'ログの「自動」「手動」で、効果の解決と操作を区別できる。',
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal help" role="dialog" aria-modal="true" aria-label="操作ヘルプ" onClick={(e) => e.stopPropagation()}>
        <h2>操作ヘルプ</h2>
        <div className="help-grid">
          <div>
            <h3>ショートカットキー</h3>
            <table>
              <tbody>
                {SHORTCUTS.map(([scene, key, what]) => (
                  <tr key={scene + key}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {scene}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="kbd">{key}</span>
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Tips</h3>
            <ul className="tips">
              {TIPS.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={onClose}>
            閉じる <Kbd k="Escape" />
          </button>
        </div>
      </div>
    </div>
  );
}
