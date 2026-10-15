// キーのヒント(ボタンの中に添える)。読み上げでは名前に混ざらないよう、装飾として扱う。
import { keyLabel } from './keymap';

export function Kbd({ k }: { k: string }) {
  return (
    <span className="kbd" aria-hidden="true">
      {keyLabel(k)}
    </span>
  );
}
