// 入力ウィジェット7種(effects 11.2): pick / assign / option / yesno / order / payment / ack。
// カードの数が増えてもウィジェットは増えない。UI は pending の input だけを見て部品を選ぶ。
import { useMemo, useState } from 'react';
import type { AnswerValue, GameState, InputSpec, Pending } from '../engine/types';
import { CardView } from './CardView';
import { cardName } from './format';
import { useDrag } from './useDrag';

interface Props {
  s: GameState;
  pending: Pending;
  onAnswer: (v: AnswerValue) => void;
  /** 自分の視点のプレイヤー(null なら観戦) */
  me: number | null;
  onHover?: (uid: number | null) => void;
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
export function PickWidget({ s, spec, onAnswer, onHover }: Props & { spec: Extract<InputSpec, { shape: 'pick' }> }) {
  const [sel, setSel] = useState<number[]>([]);
  const instant = spec.min === 1 && spec.max === 1;
  const toggle = (u: number) => {
    if (instant) return onAnswer([u]);
    setSel((cur) => (cur.includes(u) ? cur.filter((x) => x !== u) : cur.length < spec.max ? [...cur, u] : cur));
  };
  const ok = sel.length >= spec.min && sel.length <= spec.max;
  return (
    <>
      <div className="cards">
        {spec.candidates.map((u) => (
          <CardView
            key={u}
            s={s}
            uid={u}
            small
            selectable
            selected={sel.includes(u)}
            hidden={s.cards[u].defId === '?'}
            onClick={() => toggle(u)}
            onHover={onHover}
          />
        ))}
      </div>
      {!instant && (
        <div className="row">
          <span className="muted">
            {spec.min === spec.max ? `${spec.min}枚` : `${spec.min}〜${spec.max}枚`}を選ぶ({sel.length}枚選択中)
          </span>
          <button className="primary" disabled={!ok} onClick={() => onAnswer(sel)}>
            確定
          </button>
          {spec.min === 0 && <button onClick={() => onAnswer([])}>選ばない</button>}
        </div>
      )}
    </>
  );
}

// ── assign: 札を枠に割り振る(ドラッグ or クリック) ──
export function AssignWidget({ s, spec, onAnswer, onHover }: Props & { spec: Extract<InputSpec, { shape: 'assign' }> }) {
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
      <div className="cards">
        {spec.items
          .filter((u) => !placed.has(u))
          .map((u) => (
            <CardView
              key={u}
              s={s}
              uid={u}
              small
              selectable
              selected={picked === u}
              draggable
              onPointerDown={begin(`item:${u}`)}
              onHover={onHover}
            />
          ))}
        {spec.items.every((u) => placed.has(u)) && <span className="muted">すべて割り振りました</span>}
      </div>
      <div className="slots">
        {spec.slots.map((sl) => (
          <div
            key={sl.id}
            className={'slot' + (asg[sl.id].length >= sl.count ? ' full' : '') + (drag ? ' drop-ok' : '')}
            data-drop={`slot:${sl.id}`}
            onClick={() => picked !== null && place(picked, sl.id)}
            style={{ cursor: picked !== null ? 'pointer' : undefined }}
          >
            <div className="muted">
              {sl.label}({asg[sl.id].length}/{sl.count})
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
        <span className="muted">札をクリックして枠をクリック(またはドラッグ)。{need}枚を割り振ります。</span>
        <button className="primary" disabled={placed.size !== need} onClick={() => onAnswer(asg)}>
          確定
        </button>
        <button
          onClick={() => {
            // 自動(先頭から詰める)
            const items = spec.items.slice();
            const out: Record<string, number[]> = {};
            for (const sl of spec.slots) out[sl.id] = items.splice(0, Math.min(sl.count, items.length));
            setAsg(out);
          }}
        >
          自動で振る
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
              {i + 1}. {label}
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
          {spec.pick}回選ぶ{spec.repeat ? '(同じものを何度でも)' : ''}。上に書かれたものから順に処理されます({sel.length}/{spec.pick})
        </span>
        <button className="primary" disabled={sel.length !== spec.pick} onClick={() => onAnswer(sel)}>
          確定
        </button>
        {spec.allIf && (
          <button onClick={() => onAnswer(spec.options.map((_, i) => i))}>すべて1回ずつ使う</button>
        )}
        {sel.length > 0 && <button onClick={() => setSel([])}>やり直す</button>}
      </div>
    </>
  );
}

// ── yesno ──
export function YesNoWidget({ onAnswer }: { onAnswer: (v: AnswerValue) => void }) {
  return (
    <div className="row">
      <button className="primary" onClick={() => onAnswer(true)}>
        はい
      </button>
      <button onClick={() => onAnswer(false)}>いいえ</button>
    </div>
  );
}

// ── order: 待機中の能力から、次に解決するものを選ぶ ──
export function OrderWidget({ spec, onAnswer }: { spec: Extract<InputSpec, { shape: 'order' }>; onAnswer: (v: AnswerValue) => void }) {
  return (
    <div className="col">
      {spec.candidates.map((id, i) => (
        <button key={id} className="choice" onClick={() => onAnswer(id)}>
          {i + 1}. {spec.labels[i]}
        </button>
      ))}
      <span className="muted">同時に誘発した能力は、好きな順に解決できます。</span>
    </div>
  );
}

// ── payment: マナの割り当て(手動支払い) ──
export function PaymentWidget({ s, spec, onAnswer, onHover }: Props & { spec: Extract<InputSpec, { shape: 'payment' }> }) {
  const [sel, setSel] = useState<number[]>([]);
  return (
    <>
      <div className="cards">
        {spec.mana.map((u) => (
          <CardView
            key={u}
            s={s}
            uid={u}
            small
            selectable
            selected={sel.includes(u)}
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
          確定
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
          確認した
        </button>
      </div>
    </>
  );
}
