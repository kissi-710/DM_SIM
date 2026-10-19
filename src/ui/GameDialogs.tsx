// 対戦画面のモーダル: タップするマナを選ぶ(支払い)・棋譜の表示と保存。
import { planPlay } from '../engine/procs';
import { mkCtx } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { cardName, CIV_NAME, reg } from './format';
import { Kbd } from './Kbd';
import { KEY } from './keymap';
import { parseRecord, saveRecord } from './record';
import { downloadText } from './util';
import { PaymentWidget } from './Widgets';

type PlayAction = Extract<Action, { type: 'PLAY_CARD' }>;

/** タップするマナを選ばせる。払い方に選択があるときだけ出る(自明なら聞かずに自動で払う) */
export function PayDialog({
  s,
  me,
  action: a,
  auto,
  error,
  onHover,
  onError,
  onPay,
  onAuto,
  onCancel,
}: {
  s: GameState;
  me: PlayerId;
  action: PlayAction;
  /** 自動で選んだマナ(初期の選択) */
  auto: number[];
  error: string | null;
  onHover: (uid: number | null) => void;
  /** 選んだマナでは支払えない時 */
  onError: (msg: string) => void;
  onPay: (pay: number[]) => void;
  onAuto: () => void;
  onCancel: () => void;
}) {
  const ctx = mkCtx(s, reg);
  const base = planPlay(ctx, me, a.uid, a.from ?? 'hand', a.face ?? 0, a.extra, false);
  const mana = s.players[me].mana.filter((u) => !s.cards[u].tapped && u !== a.uid);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>タップするマナを選ぶ</h2>
        <p className="muted">
          {cardName(s, a.uid)} — {base.need}枚({base.civs.map((x) => CIV_NAME[x]).join('・')}を含む)。候補は自動で選択済み。
        </p>
        <PaymentWidget
          s={s}
          pending={{ id: 0, player: me, why: 'ack', input: null }}
          me={me}
          spec={{ shape: 'payment', need: base.need, mana }}
          initial={auto}
          onHover={onHover}
          onAnswer={(v) => {
            const pay = v as number[];
            const chk = planPlay(ctx, me, a.uid, a.from ?? 'hand', a.face ?? 0, { ...(a.extra ?? {}), pay }, false);
            if (!chk.ok) {
              onError(chk.err ?? '支払えません');
              return;
            }
            onPay(pay);
          }}
        />
        {error && <div style={{ color: 'var(--bad)' }}>{error}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          <button data-key="a" onClick={onAuto}>
            自動で払う <Kbd k={KEY.auto} />
          </button>
          <button data-key="c" onClick={onCancel}>
            キャンセル <Kbd k={KEY.cancel} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 棋譜(シード・デッキ・行動列)の JSON を見せ、ダウンロード・ブラウザへの保存を行う */
export function RecordDialog({ seed, text, onClose }: { seed: number | string; text: string; onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>棋譜(シード・デッキ・行動列)</h2>
        <p className="muted">この JSON を「棋譜の再生」で読み込むと再現できる。</p>
        <textarea className="json" readOnly value={text} onFocus={(e) => e.target.select()} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={() => downloadText(`dm-sim-record-${seed}.json`, text)}>
            ダウンロード <Kbd k="Enter" />
          </button>
          <button
            onClick={() => {
              const c = parseRecord(text);
              if (c.ok) saveRecord(c.rec);
              onClose();
            }}
          >
            ブラウザに保存
          </button>
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
