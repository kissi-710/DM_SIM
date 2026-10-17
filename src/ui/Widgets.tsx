// 入力ウィジェット7種(effects 11.2): pick / assign / option / yesno / order / payment / ack。
// カードの数が増えてもウィジェットは増えない。UI は pending の input だけを見て部品を選ぶ。
import { useMemo, useState } from 'react';
import type { AnswerValue, GameState, InputSpec, Pending } from '../engine/types';
import { CardView } from './CardView';
import { cardName } from './format';
import { Kbd } from './Kbd';
import { SLOT_KEYS } from './keymap';
import { useDrag } from './useDrag';

interface Props {
  s: GameState;
  pending: Pending;
  onAnswer: (v: AnswerValue) => void;
  /** 自分の視点のプレイヤー(null なら観戦) */
  me: number | null;
  onHover?: (uid: number | null) => void;
  /** ← → で動かすカーソルの位置(候補・札の並びの何番目か)。詳細は右レールに出る */
  cursor?: number | null;
}

export function InputWidget(p: Props) {
  const inp = p.pending.input as InputSpec;
  const src = p.pending.source ? cardName(p.s, p.pending.source.uid) : null;
  return (
    <div className="widget">
      <div className="prompt">
        {p.pending.prompt ?? '入力してください'}
        {src ? <span className="from"> ({src})</span> : null}
        {p.me !== null && p.pending.player !== p.me ? <span className="tag auto"> 相手の選択</span> : null}
      </div>
      {inp.shape === 'pick' && <PickWidget {...p} spec={inp} />}
      {inp.shape === 'assign' && <AssignWidget {...p} spec={inp} />}
      {inp.shape === 'option' && <OptionWidget {...p} spec={inp} />}
      {inp.shape === 'yesno' && <YesNoWidget onAnswer={p.onAnswer} />}
      {inp.shape === 'order' && <OrderWidget spec={inp} onAnswer={p.onAnswer} />}
      {inp.shape === 'payment' && <PaymentWidget {...p} spec={inp} />}
      {inp.shape === 'ack' && <AckWidget {...p} spec={inp} />}
    </div>
  );
}

// ── pick: 候補を強調して選ぶ ──
export function PickWidget({ s, spec, onAnswer, onHover, cursor }: Props & { spec: Extract<InputSpec, { shape: 'pick' }> }) {
  const [sel, setSel] = useState<number[]>([]);
  // ホバーできない端末(タッチ)では、1回目のタップで詳細を出し、2回目で決める
  const [armed, setArmed] = useState<number | null>(null);
  const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
  // 1枚だけ選ぶ時(0枚も選べる「ブロックしますか?」などを含む)は、クリックした時点で回答する
  const instant = spec.min <= 1 && spec.max === 1;
  const toggle = (u: number) => {
    if (instant) {
      if (touch && armed !== u) {
        setArmed(u);
        onHover?.(u);
        return;
      }
      return onAnswer([u]);
    }
    setSel((cur) => (cur.includes(u) ? cur.filter((x) => x !== u) : cur.length < spec.max ? [...cur, u] : cur));
  };
  const ok = sel.length >= spec.min && sel.length <= spec.max;
  return (
    <>
      <div className="cards">
        {spec.candidates.map((u, i) => (
          <CardView
            key={u}
            s={s}
            uid={u}
            small
            selectable
            selected={sel.includes(u)}
            hidden={s.cards[u].defId === '?'}
            num={i + 1}
            cursor={cursor === i}
            onClick={() => toggle(u)}
            onHover={onHover}
          />
        ))}
      </div>
      <div className="row">
        {!instant && (
          <>
            <span className="muted">
              {spec.min === spec.max ? `${spec.min}枚` : `${spec.min}〜${spec.max}枚`}を選ぶ({sel.length}枚選択中)
            </span>
            <button className="primary" disabled={!ok} onClick={() => onAnswer(sel)}>
              確定 <Kbd k="Enter" />
            </button>
            {sel.length > 0 && (
              <button data-key="r" onClick={() => setSel([])}>
                選び直す <Kbd k="r" />
              </button>
            )}
          </>
        )}
        {instant && (
          <span className="muted">
            {touch ? (armed !== null ? 'もう一度タップで決定' : 'タップで詳細、もう一度タップで決定') : 'クリックか番号キーで選択。← → で詳細を見て Enter で決定'}
          </span>
        )}
        {spec.min === 0 && (
          <button data-key="n" onClick={() => onAnswer([])}>
            選ばない <Kbd k="n" />
          </button>
        )}
      </div>
    </>
  );
}

// ── assign: 札を枠に割り振る(ドラッグ or クリック) ──
export function AssignWidget({ s, spec, onAnswer, onHover, cursor }: Props & { spec: Extract<InputSpec, { shape: 'assign' }> }) {
  const [asg, setAsg] = useState<Record<string, number[]>>(() => Object.fromEntries(spec.slots.map((x) => [x.id, []])));
  const [picked, setPicked] = useState<number | null>(null);
  const placed = new Set(Object.values(asg).flat());
  const cap = spec.slots.reduce((t, x) => t + x.count, 0);
  const need = Math.min(spec.items.length, cap);
  const place = (u: number, slot: string) => {
    setAsg((cur) => {
      const next: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(cur)) next[k] = v.filter((x) => x !== u);
      const sl = spec.slots.find((x) => x.id === slot)!;
      if (next[slot].length >= sl.count) next[slot] = next[slot].slice(0, sl.count - 1);
      next[slot] = [...next[slot], u];
      return next;
    });
    setPicked(null);
  };
  const { drag, begin } = useDrag({
    onDrop: (key, drop) => {
      const u = Number(key.replace('item:', ''));
      if (drop?.startsWith('slot:')) place(u, drop.slice(5));
    },
    onClick: (key) => setPicked((cur) => (cur === Number(key.replace('item:', '')) ? null : Number(key.replace('item:', '')))),
  });
  const unplace = (u: number) =>
    setAsg((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v.filter((x) => x !== u)])) as Record<string, number[]>);
  return (
    <>
      <div className="cards items">
        {spec.items
          .filter((u) => !placed.has(u))
          .map((u, i) => (
            <CardView
              key={u}
              s={s}
              uid={u}
              small
              selectable
              selected={picked === u}
              draggable
              num={i + 1}
              cursor={cursor === i}
              // マウス・タッチの選択は useDrag が扱う。キーボードの番号キーからの click(detail が 0)だけをここで扱う
              onClick={(e) => {
                if (e.detail === 0) setPicked((cur) => (cur === u ? null : u));
              }}
              onPointerDown={begin(`item:${u}`)}
              onHover={onHover}
            />
          ))}
        {spec.items.every((u) => placed.has(u)) && <span className="muted">割り振り済み</span>}
      </div>
      <div className="slots">
        {spec.slots.map((sl, si) => (
          <div
            key={sl.id}
            className={'slot' + (asg[sl.id].length >= sl.count ? ' full' : '') + (drag ? ' drop-ok' : '')}
            data-drop={`slot:${sl.id}`}
            data-key={SLOT_KEYS[si]}
            onClick={() => picked !== null && place(picked, sl.id)}
            style={{ cursor: picked !== null ? 'pointer' : undefined }}
          >
            <div className="muted">
              {SLOT_KEYS[si] && <Kbd k={SLOT_KEYS[si]} />} {sl.label}({asg[sl.id].length}/{sl.count})
            </div>
            <div className="cards">
              {asg[sl.id].map((u) => (
                <CardView key={u} s={s} uid={u} small selectable onClick={() => unplace(u)} onHover={onHover} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <CardView s={s} uid={Number(drag.key.replace('item:', ''))} small />
        </div>
      )}
      <div className="row">
        <span className="muted">札(数字キー)を枠(Q・W・E)に割り振る。クリック・ドラッグも可({need}枚)</span>
        <button className="primary" disabled={placed.size !== need} onClick={() => onAnswer(asg)}>
          確定 <Kbd k="Enter" />
        </button>
        {placed.size > 0 && (
          <button
            data-key="r"
            onClick={() => {
              setAsg(Object.fromEntries(spec.slots.map((x) => [x.id, []])));
              setPicked(null);
            }}
          >
            やり直す <Kbd k="r" />
          </button>
        )}
        <button
          data-key="a"
          onClick={() => {
            // 自動(先頭から詰める)
            const items = spec.items.slice();
            const out: Record<string, number[]> = {};
            for (const sl of spec.slots) out[sl.id] = items.splice(0, Math.min(sl.count, items.length));
            setAsg(out);
          }}
        >
          自動で振る <Kbd k="a" />
        </button>
      </div>
    </>
  );
}

// ── option: 選択肢(回数・重複可・「全部使う」) ──
export function OptionWidget({ s, spec, onAnswer, onHover }: Props & { spec: Extract<InputSpec, { shape: 'option' }> }) {
  const [sel, setSel] = useState<number[]>([]);
  const add = (i: number) => {
    setSel((cur) => {
      if (spec.pick === 1 && !spec.repeat) return [i];
      if (!spec.repeat && cur.includes(i)) return cur.filter((x) => x !== i);
      if (cur.length >= spec.pick) return cur;
      return [...cur, i];
    });
  };
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    sel.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
    return m;
  }, [sel]);
  return (
    <>
      {spec.seen && spec.seen.length > 0 && (
        <>
          <div className="muted">見たカード</div>
          <div className="cards">
            {spec.seen.map((u) => (
              <CardView key={u} s={s} uid={u} small onHover={onHover} />
            ))}
          </div>
        </>
      )}
      <div className="col">
        {spec.options.map((label, i) => (
          <div key={i} className="row">
            <button className={'choice' + (counts.get(i) ? ' on' : '')} onClick={() => add(i)}>
              {i < 9 && <Kbd k={String(i + 1)} />} {label}
              {counts.get(i) ? ` ×${counts.get(i)}` : ''}
            </button>
            {spec.repeat && counts.get(i) ? (
              <button className="small" onClick={() => setSel((c) => { const k = c.lastIndexOf(i); return c.filter((_, j) => j !== k); })}>
                −
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="row">
        <span className="muted">
          {spec.pick}回選ぶ{spec.repeat ? '(重複可)' : ''}。上から順に処理({sel.length}/{spec.pick})
        </span>
        <button className="primary" disabled={sel.length !== spec.pick} onClick={() => onAnswer(sel)}>
          確定 <Kbd k="Enter" />
        </button>
        {spec.allIf && (
          <button data-key="a" onClick={() => onAnswer(spec.options.map((_, i) => i))}>
            すべて1回ずつ使う <Kbd k="a" />
          </button>
        )}
        {sel.length > 0 && (
          <button data-key="r" onClick={() => setSel([])}>
            やり直す <Kbd k="r" />
          </button>
        )}
      </div>
    </>
  );
}

// ── yesno ──
export function YesNoWidget({ onAnswer }: { onAnswer: (v: AnswerValue) => void }) {
  return (
    <div className="row">
      <button className="primary" data-key="y" onClick={() => onAnswer(true)}>
        はい <Kbd k="y" />
      </button>
      <button data-key="n" onClick={() => onAnswer(false)}>
        いいえ <Kbd k="n" />
      </button>
    </div>
  );
}

// ── order: 待機中の能力から、次に解決するものを選ぶ ──
export function OrderWidget({ spec, onAnswer }: { spec: Extract<InputSpec, { shape: 'order' }>; onAnswer: (v: AnswerValue) => void }) {
  return (
    <div className="col">
      {spec.candidates.map((id, i) => (
        <button key={id} className="choice" onClick={() => onAnswer(id)}>
          {i < 9 && <Kbd k={String(i + 1)} />} {spec.labels[i]}
        </button>
      ))}
      <span className="muted">同時に誘発した能力。解決する順を選ぶ</span>
    </div>
  );
}

// ── payment: マナの割り当て(手動支払い) ──
export function PaymentWidget({ s, spec, onAnswer, onHover, initial, cursor }: Props & { spec: Extract<InputSpec, { shape: 'payment' }>; initial?: number[] }) {
  const [sel, setSel] = useState<number[]>(initial ?? []);
  return (
    <>
      <div className="cards">
        {spec.mana.map((u, i) => (
          <CardView
            key={u}
            s={s}
            uid={u}
            small
            selectable
            selected={sel.includes(u)}
            num={i + 1}
            cursor={cursor === i}
            onClick={() => setSel((c) => (c.includes(u) ? c.filter((x) => x !== u) : c.length < spec.need ? [...c, u] : c))}
            onHover={onHover}
          />
        ))}
      </div>
      <div className="row">
        <span className="muted">
          タップするマナを{spec.need}枚選ぶ({sel.length}/{spec.need})
        </span>
        <button className="primary" disabled={sel.length !== spec.need} onClick={() => onAnswer(sel)}>
          確定 <Kbd k="Enter" />
        </button>
      </div>
    </>
  );
}

// ── ack: 公開した札の確認 ──
export function AckWidget({ s, spec, onAnswer, onHover }: Props & { spec: Extract<InputSpec, { shape: 'ack' }> }) {
  return (
    <>
      <div className="cards">
        {spec.shown.map((u) => (
          <CardView key={u} s={s} uid={u} small onHover={onHover} />
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={() => onAnswer(true)}>
          確認した <Kbd k="Enter" />
        </button>
      </div>
    </>
  );
}
