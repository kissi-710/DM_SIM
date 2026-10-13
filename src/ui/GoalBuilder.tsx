// 目標の条件ビルダー(spec 6.3): タイミング・述語・カード条件を AND/OR/NOT で組み合わせる。
import { useState } from 'react';
import { CARD_LIST } from '../cards';
import type { Civ } from '../engine/types';
import { CIV_NAME } from './format';
import { describeGoal, type CardMatcher, type Goal, type Predicate, type Timing } from '../sim/goal';

interface Leaf {
  not: boolean;
  timing: Timing;
  pred: Predicate;
}
interface Form {
  op: 'and' | 'or';
  leaves: Leaf[];
}

export function toForm(g: Goal): Form | null {
  const leafOf = (x: Goal): Leaf | null => {
    if (x.op === 'pred') return { not: false, timing: x.timing, pred: x.pred };
    if (x.op === 'not' && x.arg.op === 'pred') return { not: true, timing: x.arg.timing, pred: x.arg.pred };
    return null;
  };
  const one = leafOf(g);
  if (one) return { op: 'and', leaves: [one] };
  if (g.op === 'and' || g.op === 'or') {
    const leaves = g.args.map(leafOf);
    if (leaves.every((l): l is Leaf => !!l)) return { op: g.op, leaves };
  }
  return null;
}

export function fromForm(f: Form): Goal {
  const nodes: Goal[] = f.leaves.map((l) => {
    const p: Goal = { op: 'pred', timing: l.timing, pred: l.pred };
    return l.not ? { op: 'not', arg: p } : p;
  });
  if (nodes.length === 1) return nodes[0];
  return { op: f.op, args: nodes };
}

const CIVS: Civ[] = ['light', 'water', 'darkness', 'fire', 'nature'];
const NAMES = [...new Set(CARD_LIST.filter((c) => c.id !== 'dummy').flatMap((c) => [c.name, ...c.faces.map((f) => f.name)]))];

function MatcherEditor({ m, onChange }: { m: CardMatcher; onChange: (m: CardMatcher) => void }) {
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const set = (patch: Partial<CardMatcher>) => onChange({ ...m, ...patch });
  const setCost = (k: 'eq' | 'gte' | 'lte', v: string) => {
    const cost = { ...(m.cost ?? {}), [k]: num(v) };
    const clean = Object.fromEntries(Object.entries(cost).filter(([, x]) => x !== undefined));
    set({ cost: Object.keys(clean).length ? (clean as CardMatcher['cost']) : undefined });
  };
  return (
    <div className="col" style={{ padding: '4px 0 4px 10px', borderLeft: '2px solid var(--line)' }}>
      <label className="row">
        カード名
        <input
          list="card-names"
          type="text"
          style={{ minWidth: 240 }}
          placeholder="空欄で指定しない(カンマ区切りで複数)"
          value={(m.names ?? []).join(',')}
          onChange={(e) => {
            const names = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
            set({ names: names.length ? names : undefined });
          }}
        />
      </label>
      <div className="row">
        コスト
        <label>
          = <input type="number" value={m.cost?.eq ?? ''} onChange={(e) => setCost('eq', e.target.value)} />
        </label>
        <label>
          ≧ <input type="number" value={m.cost?.gte ?? ''} onChange={(e) => setCost('gte', e.target.value)} />
        </label>
        <label>
          ≦ <input type="number" value={m.cost?.lte ?? ''} onChange={(e) => setCost('lte', e.target.value)} />
        </label>
        <select value={m.costBasis ?? 'printed'} onChange={(e) => set({ costBasis: e.target.value as any })}>
          <option value="printed">表記コスト</option>
          <option value="effective">実コスト(軽減後)</option>
        </select>
      </div>
      <div className="row">
        文明
        {CIVS.map((c) => (
          <label key={c}>
            <input
              type="checkbox"
              checked={m.civs?.includes(c) ?? false}
              onChange={(e) => {
                const cur = new Set(m.civs ?? []);
                if (e.target.checked) cur.add(c);
                else cur.delete(c);
                set({ civs: cur.size ? [...cur] : undefined });
              }}
            />
            {CIV_NAME[c]}
          </label>
        ))}
        <select value={m.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as any })}>
          <option value="">種類を問わない</option>
          <option value="creature">クリーチャー</option>
          <option value="spell">呪文</option>
        </select>
        <select value={m.face ?? ''} onChange={(e) => set({ face: (e.target.value || undefined) as any })}>
          <option value="">ツインパクト: 面を問わない</option>
          <option value="creature">クリーチャー面</option>
          <option value="spell">呪文面</option>
        </select>
      </div>
    </div>
  );
}

function LeafEditor({ leaf, onChange, onRemove }: { leaf: Leaf; onChange: (l: Leaf) => void; onRemove: () => void }) {
  const p = leaf.pred;
  const setKind = (kind: Predicate['kind']) => {
    const card: CardMatcher = 'card' in p ? p.card : { costBasis: 'printed' };
    if (kind === 'manaCount') onChange({ ...leaf, pred: { kind, min: 5 } });
    else if (kind === 'zoneHas') onChange({ ...leaf, pred: { kind, zone: 'hand', card, min: 1 } });
    else onChange({ ...leaf, pred: { kind, card } });
  };
  return (
    <div className="panel col" style={{ background: 'var(--bg)' }}>
      <div className="row">
        <label>
          <input type="checkbox" checked={leaf.not} onChange={(e) => onChange({ ...leaf, not: e.target.checked })} /> ではない(NOT)
        </label>
        <select value={leaf.timing.at} onChange={(e) => onChange({ ...leaf, timing: { ...leaf.timing, at: e.target.value as Timing['at'] } })}>
          <option value="anyMain">Nターン目のメインのどこかで</option>
          <option value="turnEnd">Nターン目の終了時に</option>
          <option value="byTurn">Nターン目までに</option>
          <option value="opening">初手(ゲーム開始時)に</option>
        </select>
        {leaf.timing.at !== 'opening' && (
          <label>
            N = <input type="number" min={1} max={20} value={leaf.timing.turn} onChange={(e) => onChange({ ...leaf, timing: { ...leaf.timing, turn: Math.max(1, Number(e.target.value)) } })} />
          </label>
        )}
        <select value={p.kind} onChange={(e) => setKind(e.target.value as Predicate['kind'])}>
          <option value="castable">使える(手札にあり、支払える)</option>
          <option value="cast">使った(召喚・唱えた)</option>
          <option value="manaCount">マナの枚数</option>
          <option value="zoneHas">ゾーンにカードがある</option>
        </select>
        <button className="small danger" onClick={onRemove}>
          削除
        </button>
      </div>
      {p.kind === 'manaCount' && (
        <div className="row">
          <label>
            枚数 ≧ <input type="number" min={0} value={p.min} onChange={(e) => onChange({ ...leaf, pred: { ...p, min: Number(e.target.value) } })} />
          </label>
          <select value={p.civ ?? ''} onChange={(e) => onChange({ ...leaf, pred: { ...p, civ: (e.target.value || undefined) as any } })}>
            <option value="">文明を問わない</option>
            {CIVS.map((c) => (
              <option key={c} value={c}>
                {CIV_NAME[c]}のマナ
              </option>
            ))}
          </select>
        </div>
      )}
      {p.kind === 'zoneHas' && (
        <div className="row">
          <select value={p.zone} onChange={(e) => onChange({ ...leaf, pred: { ...p, zone: e.target.value as any } })}>
            <option value="hand">手札</option>
            <option value="mana">マナゾーン</option>
            <option value="battle">バトルゾーン</option>
            <option value="grave">墓地</option>
            <option value="shield">シールド</option>
          </select>
          <label>
            枚数 ≧ <input type="number" min={1} value={p.min ?? 1} onChange={(e) => onChange({ ...leaf, pred: { ...p, min: Number(e.target.value) } })} />
          </label>
        </div>
      )}
      {'card' in p && <MatcherEditor m={p.card} onChange={(card) => onChange({ ...leaf, pred: { ...p, card } as Predicate })} />}
    </div>
  );
}

export function GoalBuilder({ goal, onChange }: { goal: Goal; onChange: (g: Goal) => void }) {
  const form = toForm(goal);
  const [raw, setRaw] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!form || raw) {
    const cur = JSON.stringify(goal, null, 2);
    return (
      <div className="col">
        {!form && <div className="muted">この目標は入れ子が深いため、JSON で編集します。</div>}
        <textarea
          className="json"
          value={text || cur}
          onChange={(e) => {
            setText(e.target.value);
            try {
              onChange(JSON.parse(e.target.value));
              setErr(null);
            } catch (x: any) {
              setErr(String(x.message));
            }
          }}
        />
        {err && <span style={{ color: 'var(--bad)' }}>{err}</span>}
        {form && (
          <button
            onClick={() => {
              setRaw(false);
              setText('');
            }}
          >
            ビルダーに戻る
          </button>
        )}
      </div>
    );
  }
  const update = (f: Form) => onChange(fromForm(f));
  return (
    <div className="col">
      <datalist id="card-names">
        {NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {form.leaves.length > 1 && (
        <label className="row">
          条件の組み合わせ
          <select value={form.op} onChange={(e) => update({ ...form, op: e.target.value as any })}>
            <option value="and">すべて満たす(AND)</option>
            <option value="or">どれかを満たす(OR)</option>
          </select>
        </label>
      )}
      {form.leaves.map((l, i) => (
        <LeafEditor
          key={i}
          leaf={l}
          onChange={(nl) => update({ ...form, leaves: form.leaves.map((x, j) => (j === i ? nl : x)) })}
          onRemove={() => form.leaves.length > 1 && update({ ...form, leaves: form.leaves.filter((_, j) => j !== i) })}
        />
      ))}
      <div className="row">
        <button
          onClick={() =>
            update({
              ...form,
              leaves: [...form.leaves, { not: false, timing: { turn: 4, at: 'anyMain' }, pred: { kind: 'manaCount', min: 5 } }],
            })
          }
        >
          ＋ 条件を追加
        </button>
        <button onClick={() => setRaw(true)}>JSONで編集</button>
      </div>
      <div className="muted">目標: {describeGoal(goal)}</div>
    </div>
  );
}
