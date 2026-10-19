// デッキの選択(ラベル「デッキ」+ プルダウン)。対戦設定・調査・バッチ・手動盤面で共通。
import type { DeckEntry } from './decks';

export function DeckSelect({ decks, value, onChange }: { decks: DeckEntry[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="row">
      デッキ
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {decks.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
