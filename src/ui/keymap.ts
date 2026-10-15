// ショートカットキーの正規化と、キーの意味の一覧(対戦画面の onKey・ボタンのヒント・ヘルプが同じ定義を使う)。
//
// キーの意味の原則(場面が変わっても同じ意味にする):
//   Enter / Space … 肯定・確定・実行(はい / 確定 / もう一度)
//   Esc / N        … 否定・取り消し・選ばない・閉じる(いいえ / 選ばない / やり直す / ダイアログを閉じる)
//   1〜9           … 画面に番号が出ているものを、その番号で選ぶ
//   A              … 自動(自動で払う・振る)/ すべて(選択肢を全部使う)
//   ← → ↑ ↓        … 盤面のカードを選ぶ(← → は同じ列の中、↑ ↓ は列の移動)
//   その他の文字    … 操作名の頭文字で、1キー1意味(下の KEY)

/** 押されたキーを、IME・配列によらない1つの文字列にしたもの(対応外は null) */
export type KeyToken = string;

interface KeyLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
  keyCode?: number;
  isComposing?: boolean;
}

const NAMED: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ' ': ' ',
  Spacebar: ' ',
};

/**
 * キーイベントを正規化する。文字は小文字、数字は '1'〜'9'、名前付きキーは `KeyboardEvent.key` のまま、'?' は '?'。
 * 日本語 IME が ON の間は `key` が 'Process' になる(keyCode 229)ので、その時は物理キー(`code`)から決める。
 */
export function keyToken(e: KeyLike): KeyToken | null {
  const imeActive = e.key === 'Process' || e.key === 'Unidentified' || e.keyCode === 229 || e.isComposing === true;
  if (!imeActive) {
    if (e.key in NAMED) return NAMED[e.key];
    if (/^[a-zA-Z]$/.test(e.key)) return e.key.toLowerCase();
    if (/^[0-9]$/.test(e.key)) return e.key;
    if (e.key === '?') return '?';
    if (e.key === '/' && e.shiftKey) return '?';
    return null;
  }
  const c = e.code ?? '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return c.slice(6);
  if (c === 'Slash' && e.shiftKey) return '?';
  if (c === 'Space') return ' ';
  if (c === 'Enter' || c === 'NumpadEnter') return 'Enter';
  if (c in NAMED) return NAMED[c];
  return null;
}

/** 数字キー('1'〜'9')なら 0〜8、そうでなければ -1 */
export function digitOf(k: KeyToken | null): number {
  return k !== null && /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
}

/** 画面に出すキーの表記('e' → 'E'、'Enter' → 'Enter'、' ' → 'Space'、'Escape' → 'Esc') */
export function keyLabel(k: string): string {
  if (k === ' ') return 'Space';
  if (k === 'Escape') return 'Esc';
  if (k === 'ArrowLeft') return '←';
  if (k === 'ArrowRight') return '→';
  if (k === 'ArrowUp') return '↑';
  if (k === 'ArrowDown') return '↓';
  return k.length === 1 ? k.toUpperCase() : k;
}

/** 文字キーの割り当て(1キー1意味。同じ画面に同時に出る操作どうしで重ならないようにする) */
export const KEY = {
  // ターンの進行
  skipMana: 'm', // マナチャージしない / メインを終える
  endTurn: 'e',
  undo: 'z',
  // 入力パネル・ダイアログ
  yes: 'y',
  no: 'n',
  auto: 'a',
  redo: 'r',
  cancel: 'c',
  // 画面
  help: 'h',
  log: 'l',
  options: 'o',
  record: 'k',
  fast: 'f',
  quit: 'q',
  peek: 's',
  askPay: 'p',
  oppHand: 't',
  confirmEnd: 'u',
  grave: 'g',
  manaList: 'v',
} as const;

/** 割り振り(assign)の枠に割り当てるキー(数字キーの1段下の並び。数字キーは札、これは枠) */
export const SLOT_KEYS = ['q', 'w', 'e'] as const;

/** [場面, キー, 内容]。同じキーでも場面で意味が変わるので、場面ごとに分けて見せる */
export const SHORTCUTS: Array<[string, string, string]> = [
  ['盤面', '← →', '同じ列の動かせるカードを順に選ぶ'],
  ['盤面', '↑ ↓', '列(バトル・マナ・墓地・手札)を移る'],
  ['盤面', '1 〜 9', '選んだカードの操作を、上から N 番目で実行'],
  ['盤面', 'Enter', '操作が1つならそれを実行'],
  ['盤面', 'M', 'マナチャージしない / メインを終える'],
  ['盤面', 'E', 'ターン終了(出せるカードが残っていれば、もう一度押す)'],
  ['盤面', 'Z', '1手戻す(練習用設定のとき)'],
  ['入力パネル', 'Y / N', 'はい / いいえ'],
  ['入力パネル', '1 〜 9', '選択肢・候補カードの上から N 番目を選ぶ'],
  ['入力パネル', '← →', '候補カードにカーソルを動かして詳細を見る(Enter で選ぶ)'],
  ['入力パネル', 'Enter', '「確定」「はい」'],
  ['ダイアログ', 'A / N / R / C', '自動で払う・振る / 選ばない / やり直す / キャンセル'],
  ['ダイアログ', 'Esc', '閉じる'],
  ['観戦', 'Space', '一時停止 / 再開'],
  ['観戦', '→', '一時停止中に1手進める'],
  ['結果', 'R', '「もう一度」'],
  ['どこでも', 'L / O', 'ログ・詳細の表示切替 / 表示設定'],
  ['どこでも', '? / H', 'このヘルプ'],
];
