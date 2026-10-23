import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST } from '../../src/cards';
import { loadRegistry, validateCardDb } from '../../src/engine/registry';
import type { CardDB, CardDef } from '../../src/engine/types';
import { defIdOf, reg } from '../scenario';

const card = (over: Partial<CardDef> & { face?: any } = {}): CardDef => {
  const { face, ...rest } = over;
  return {
    id: 't-1',
    name: 'テスト',
    faces: [{ name: 'テスト', type: 'creature', cost: 3, civs: ['fire'], power: 3000, abilities: [], ...(face ?? {}) }],
    ...rest,
  } as CardDef;
};
const db = (...cs: CardDef[]): CardDB => Object.fromEntries(cs.map((c) => [c.id, c]));
const errs = (c: CardDef) => validateCardDb(db(c)).join('\n');

describe('validateCardDb(カードデータの検証)', () => {
  it('最小のカードは正しい', () => {
    expect(validateCardDb(db(card()))).toEqual([]);
  });
  it('実際のカードDBはエラーなし', () => {
    expect(validateCardDb(CARD_DB)).toEqual([]);
  });
  it('id がキーと一致しない / name・faces がない', () => {
    expect(validateCardDb({ x: card({ id: 'y' }) }).join()).toContain('id が一致しません');
    expect(errs(card({ name: '' }))).toContain('name がありません');
    expect(errs(card({ faces: [] }))).toContain('faces がありません');
  });
  it('面の必須項目: 種類・cost・civs・power', () => {
    expect(errs(card({ face: { type: 'monster' } }))).toContain('未知の種類');
    expect(errs(card({ face: { cost: undefined } }))).toContain('cost');
    expect(errs(card({ face: { civs: undefined } }))).toContain('civs');
    // 無色は、空の配列
    expect(errs(card({ face: { civs: [] } }))).toBe('');
    expect(errs(card({ face: { power: undefined } }))).toContain('power');
    // 呪文は power 不要
    expect(errs(card({ face: { type: 'spell', power: undefined } }))).toBe('');
  });
  it('進化クリーチャーには evolveFrom が必要', () => {
    expect(errs(card({ face: { type: 'evolution' } }))).toContain('evolveFrom');
    expect(errs(card({ face: { type: 'evolution', evolveFrom: { race: 'ヨビニオン' } } }))).toBe('');
  });
  it('未知の能力・キーワード・trigger の spec.on 欠落', () => {
    expect(errs(card({ face: { abilities: [{ kind: 'magic' }] } }))).toContain('未知の能力');
    expect(errs(card({ face: { abilities: [{ kind: 'keyword', name: 'flying' }] } }))).toContain('未知のキーワード');
    expect(errs(card({ face: { abilities: [{ kind: 'trigger', spec: {}, steps: [] }] } }))).toContain('spec.on');
  });
  it('ステップの検証: 原始操作・select・modes・custom・未知の op', () => {
    const trig = (steps: any[]) => card({ face: { abilities: [{ kind: 'trigger', spec: { on: { type: 'entered' } }, steps }] } });
    expect(errs(trig([{ op: 'act', act: { draw: 1 } }]))).toBe('');
    expect(errs(trig([{ op: 'act', act: { teleport: 1 } }]))).toContain("未対応の原始操作 'teleport'");
    expect(errs(trig([{ op: 'act', act: { draw: 1, tap: {} } }]))).toContain('act は1キー');
    expect(errs(trig([{ op: 'select', from: {} }]))).toContain('as がありません');
    expect(errs(trig([{ op: 'modes', options: [] }]))).toContain('options がありません');
    expect(errs(trig([{ op: 'custom', handler: 'x' }]))).toContain('未対応の custom');
    expect(errs(trig([{ op: 'dance' }]))).toContain("未知のステップ 'dance'");
  });
  it('入れ子(may / if / each / repeat / forPlayers / modes)の中も検証する', () => {
    const bad = { op: 'act', act: { teleport: 1 } };
    const trig = (steps: any[]) => card({ face: { abilities: [{ kind: 'trigger', spec: { on: { type: 'entered' } }, steps }] } });
    for (const wrap of [
      (s: any) => ({ op: 'may', then: [s] }),
      (s: any) => ({ op: 'may', then: [], else: [s] }),
      (s: any) => ({ op: 'if', cond: { true: true }, then: [s] }),
      (s: any) => ({ op: 'each', as: '$x', in: '$y', body: [s] }),
      (s: any) => ({ op: 'repeat', times: 2, body: [s] }),
      (s: any) => ({ op: 'forPlayers', body: [s] }),
      (s: any) => ({ op: 'modes', options: [{ label: 'a', steps: [s] }] }),
    ]) {
      expect(errs(trig([wrap(bad)]))).toContain('teleport');
    }
  });
  it('条件の検証: 未知の条件・空の条件・all/any/not の入れ子', () => {
    const cond = (c: any) => card({ face: { abilities: [{ kind: 'trigger', spec: { on: { type: 'entered' } }, steps: [{ op: 'if', cond: c, then: [] }] }] } });
    expect(errs(cond({ civ: 'fire' }))).toBe('');
    expect(errs(cond({ weird: 1 }))).toContain("未知の条件 'weird'");
    expect(errs(cond({}))).toContain('条件が空');
    expect(errs(cond({ all: [{ civ: 'fire' }, { weird: 1 }] }))).toContain('weird');
    expect(errs(cond({ any: [{ not: { weird: 1 } }] }))).toContain('weird');
  });
  it('複数のカードのエラーをまとめて返す', () => {
    const r = validateCardDb({ a: card({ id: 'a', name: '' }), b: card({ id: 'b', face: { civs: undefined } }) });
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.join()).toContain('[a]');
    expect(r.join()).toContain('[b]');
  });
});

describe('loadRegistry', () => {
  it('検証エラーがあれば、内容つきで例外にする', () => {
    expect(() => loadRegistry(db(card({ name: '' })))).toThrow(/検証エラー[\s\S]*name/);
  });
  it('同じ DB には同じレジストリを返す(キャッシュ)', () => {
    expect(loadRegistry(CARD_DB)).toBe(loadRegistry(CARD_DB));
    const d = db(card());
    expect(loadRegistry(d)).toBe(loadRegistry(d));
  });
  it('見えないカード「?」と、全カードが定義される', () => {
    expect(reg.defs['?']).toBeDefined();
    for (const c of CARD_LIST) expect(reg.defs[c.id]).toBeDefined();
    // 実在するカード + 無能力カード(カード単体の強さの差し替え先。engine/blank.ts) + '?'
    expect(Object.keys(reg.defs)).toHaveLength(Object.keys(CARD_DB).length + 1);
    expect(Object.keys(CARD_DB).length).toBeGreaterThan(CARD_LIST.length);
  });
  it('未知のカードの getFace / getInfo は例外。面が範囲外なら先頭の面', () => {
    expect(() => reg.getFace('nope', 0)).toThrow();
    expect(() => reg.getInfo('nope', 0)).toThrow();
    const id = defIdOf('アクアン');
    expect(reg.getFace(id, 5)).toBe(reg.getFace(id, 0));
    expect(reg.getInfo(id, 5)).toBe(reg.getInfo(id, 0));
  });
  it('元の DB を書き換えない(キーワードの展開は複製側に入る)', () => {
    const before = JSON.stringify(CARD_DB['dm24rp3-S10']);
    loadRegistry(CARD_DB);
    expect(JSON.stringify(CARD_DB['dm24rp3-S10'])).toBe(before);
  });
});

describe('キーワードの展開と FaceInfo', () => {
  const info = (name: string, face = 0) => reg.getInfo(defIdOf(name), face);

  it('ヨビニオンは「出た時」の任意の誘発型能力に展開される', () => {
    const def = reg.defs[defIdOf('ヨビニオン・マルル')];
    const added = def.faces[0].abilities.filter((a) => a.kind === 'trigger' && a.label === 'ヨビニオン');
    expect(added).toHaveLength(1);
    const t: any = added[0];
    expect(t.optional).toBe(true);
    expect(t.spec.on.type).toBe('entered');
    expect(t.spec.on.via).toBe('summon');
  });
  it('侵略は「攻撃する時」の誘発型能力に展開される', () => {
    const def = reg.defs[defIdOf('SSS級天災 デッドダムド')];
    const added: any = def.faces[0].abilities.find((a) => a.kind === 'trigger' && a.spec.on && (a.spec.on as any).type === 'attackDeclared');
    expect(added).toBeDefined();
    expect(added.optional).toBe(true);
    expect(added.spec.watch).toContain('hand');
    expect(reg.trigIndex.get('attackDeclared')!.some((r) => r.defId === defIdOf('SSS級天災 デッドダムド'))).toBe(true);
  });
  it('ブロッカー・スピードアタッカー・マッハファイター・EXライフ・ジャストダイバー', () => {
    expect(info('ティンパニ=シンバリー').blocker).toBe(true);
    expect(info('ヨビニオン・マルル').blocker).toBe(false);
    expect(info('漢気の2号 ボスカツ').speedAttacker).toBe(true);
    expect(info('九番龍 ジゴクバンカー').machFighter).toBe(true);
    expect(info('龍風混成 ザーディクリカ').exLife).toBe(true);
    expect(info('魔誕の斬将オルゲイト').justDiver).toBe(true);
  });
  it('シンパシー・ハイパーエナジー', () => {
    expect(info('九番龍 ジゴクバンカー').sympathy).toBe(true);
    expect(info('魔誕の斬将オルゲイト').hyperEnergy).toBe(true);
    expect(info('アクアン').hyperEnergy).toBe(false);
  });
  it('ブレイカーの枚数(W=2, T=3)と、何もなければ1', () => {
    expect(info('アクアン').breaker).toBe(1);
    expect(info('龍風混成 ザーディクリカ').breaker).toBe(2);
    expect(info('CRYMAX ジャオウガ').breakers.length).toBeGreaterThan(0);
    const max = Math.max(...Object.keys(reg.defs).flatMap((id) => reg.info[id].map((i) => i.breaker)));
    expect(max).toBeGreaterThanOrEqual(2);
  });
  it('S・トリガー・G・ストライク', () => {
    expect(info('フェアリー・ライフ').shieldTriggers).toHaveLength(1);
    expect(info('フェアリー・Re:ライフ').gStrike).not.toBeNull();
    expect(info('フェアリー・Re:ライフ').shieldTriggers).toHaveLength(0);
    expect(info('アクアン').shieldTriggers).toHaveLength(0);
  });
  it('ツインパクト: 面ごとに情報が別', () => {
    const id = defIdOf('修羅の死神フミシュナ');
    expect(reg.getInfo(id, 0).blocker).toBe(true);
    expect(reg.getInfo(id, 0).shieldTriggers).toHaveLength(0);
    expect(reg.getInfo(id, 1).shieldTriggers).toHaveLength(1);
    expect(reg.getInfo(id, 1).spell).not.toBeNull();
  });
  it('呪文は spell を持ち、クリーチャーは持たない', () => {
    expect(info('フェアリー・ライフ').spell).not.toBeNull();
    expect(info('アクアン').spell).toBeNull();
  });
  it('trigIndex: 誘発型能力が、きっかけのイベント種類ごとに引ける', () => {
    const entered = reg.trigIndex.get('entered')!;
    expect(entered.length).toBeGreaterThan(0);
    for (const r of entered) {
      const on = r.ability.spec.on;
      const types = (Array.isArray(on) ? on : [on]).map((x) => x.type);
      expect(types).toContain('entered');
    }
  });
  it('ability(ref) は面・添字から能力を引く', () => {
    const id = defIdOf('天災 デドダム');
    const t = reg.getInfo(id, 0).triggers[0];
    expect(reg.ability({ defId: id, face: 0, idx: t.idx })).toBe(t.ability);
  });
});

describe('program(コンパイル済みの手順)', () => {
  const idMaruru = defIdOf('ヨビニオン・マルル');
  const trig = reg.getInfo(idMaruru, 0).triggers.find((t) => t.ability.optional)!;
  const ref = { defId: idMaruru, face: 0, idx: trig.idx };

  it('任意の能力は、先頭に「しますか?」(may)が付く。noOptional で外せる', () => {
    expect(reg.program(ref)[0].o).toBe('may');
    expect(reg.program(ref, true)[0].o).not.toBe('may');
  });
  it('may の「いいえ」の飛び先は、手順の末尾', () => {
    const p = reg.program(ref);
    const m: any = p[0];
    expect(m.no).toBe(p.length);
  });
  it('同じ能力のプログラムはキャッシュされる', () => {
    expect(reg.program(ref)).toBe(reg.program(ref));
    expect(reg.program(ref)).not.toBe(reg.program(ref, true));
  });
  it('全カードの全能力が、例外なくコンパイルできる', () => {
    for (const id of Object.keys(reg.defs)) {
      reg.defs[id].faces.forEach((f, fi) => {
        f.abilities.forEach((_, idx) => {
          expect(() => reg.program({ defId: id, face: fi, idx })).not.toThrow();
          expect(() => reg.program({ defId: id, face: fi, idx }, true)).not.toThrow();
        });
      });
    }
  });
  it('飛び先(jmp / jf / may)はすべて手順の範囲内', () => {
    for (const id of Object.keys(reg.defs)) {
      reg.defs[id].faces.forEach((f, fi) => {
        f.abilities.forEach((_, idx) => {
          const p = reg.program({ defId: id, face: fi, idx });
          for (const ins of p as any[]) {
            for (const k of ['to', 'no', 'end']) {
              if (typeof ins[k] === 'number') {
                expect(ins[k], `${id}:${fi}:${idx} ${ins.o}.${k}`).toBeGreaterThanOrEqual(0);
                expect(ins[k]).toBeLessThanOrEqual(p.length);
              }
            }
          }
        });
      });
    }
  });
});
