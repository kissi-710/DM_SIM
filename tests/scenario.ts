// シナリオDSL(effects 13.1): 状態を与え、行動列を流し、結果を検証する。
import { expect } from 'vitest';
import { CARD_DB } from '../src/cards';
import { step as engineStep, legalActions } from '../src/engine/engine';
import { checkInvariants } from '../src/engine/invariants';
import { loadRegistry, type Registry } from '../src/engine/registry';
import { defaultConfig, type Action, type Card, type Ev, type GameConfig, type GameState, type Pending, type PlayerId, type PlayerZones } from '../src/engine/types';

export const reg: Registry = loadRegistry(CARD_DB);

/** 名前(の一部)かIDからカード定義IDを引く */
export function defIdOf(name: string, r: Registry = reg): string {
  if (r.defs[name]) return name;
  const exact = Object.values(r.defs).filter((d) => d.name === name || d.faces.some((f) => f.name === name));
  if (exact.length === 1) return exact[0].id;
  const part = Object.values(r.defs).filter((d) => d.name.includes(name) || d.faces.some((f) => f.name.includes(name)));
  if (part.length >= 1) return part[0].id;
  throw new Error('カードが見つかりません: ' + name);
}

type Item = string | { c: string; tapped?: boolean; sick?: boolean; under?: string[]; ex?: boolean };

export interface ZoneSpec {
  hand?: Item[];
  mana?: Item[];
  battle?: Item[];
  grave?: Item[];
  hyper?: Item[];
  shield?: Item[] | number;
  deck?: Item[] | number;
}

export interface Setup {
  p0?: ZoneSpec;
  p1?: ZoneSpec;
  active?: PlayerId;
  step?: 'mana' | 'main' | 'attack';
  turn?: number;
  seed?: number;
  cfg?: Partial<GameConfig>;
  first?: PlayerId;
}

export function buildState(setup: Setup, r: Registry = reg): GameState {
  const cards: Card[] = [];
  const players: [PlayerZones, PlayerZones] = [
    { deck: [], hand: [], mana: [], shield: [], grave: [], hyper: [], battle: [] },
    { deck: [], hand: [], mana: [], shield: [], grave: [], hyper: [], battle: [] },
  ];
  let nextPid = 1;
  const add = (p: PlayerId, defId: string, zone: Card['zone']): number => {
    cards.push({ defId, owner: p, zone, ep: 0, tapped: false, ex: false, exPid: -1, pid: -1, face: 0 });
    return cards.length - 1;
  };
  const norm = (x: Item): { c: string; tapped?: boolean; sick?: boolean; under?: string[]; ex?: boolean } => (typeof x === 'string' ? { c: x } : x);
  const fill = (p: PlayerId, spec: ZoneSpec | undefined) => {
    const z = players[p];
    const sp = spec ?? {};
    for (const it of sp.hand ?? []) z.hand.push(add(p, defIdOf(norm(it).c, r), 'hand'));
    for (const it of sp.mana ?? []) {
      const n = norm(it);
      const u = add(p, defIdOf(n.c, r), 'mana');
      cards[u].tapped = !!n.tapped;
      z.mana.push(u);
    }
    for (const it of sp.grave ?? []) z.grave.push(add(p, defIdOf(norm(it).c, r), 'grave'));
    for (const it of sp.hyper ?? []) z.hyper.push(add(p, defIdOf(norm(it).c, r), 'hyper'));
    const sh = sp.shield ?? 5;
    if (typeof sh === 'number') for (let i = 0; i < sh; i++) z.shield.push(add(p, 'dummy', 'shield'));
    else for (const it of sh) z.shield.push(add(p, defIdOf(norm(it).c, r), 'shield'));
    const dk = sp.deck ?? 20;
    if (typeof dk === 'number') for (let i = 0; i < dk; i++) z.deck.push(add(p, 'dummy', 'deck'));
    else for (const it of dk) z.deck.push(add(p, defIdOf(norm(it).c, r), 'deck'));
    for (const it of sp.battle ?? []) {
      const n = norm(it);
      const pid = nextPid++;
      const u = add(p, defIdOf(n.c, r), 'battle');
      cards[u].pid = pid;
      const pile = [u];
      for (const un of n.under ?? []) {
        const v = add(p, defIdOf(un, r), 'battle');
        cards[v].pid = pid;
        pile.push(v);
      }
      z.battle.push({ pid, cards: pile, tapped: !!n.tapped, sick: n.sick ?? false, enteredTurn: 0 });
      if (n.ex) {
        const sh2 = add(p, 'dummy', 'shield');
        cards[sh2].ex = true;
        cards[sh2].exPid = pid;
        z.shield.push(sh2);
      }
    }
  };
  fill(0, setup.p0);
  fill(1, setup.p1);
  const active = setup.active ?? 0;
  const cfg: GameConfig = { ...defaultConfig(), ...(setup.cfg ?? {}) };
  const s: GameState = {
    v: 1,
    cards,
    players,
    limbo: [],
    turn: setup.turn ?? 5,
    active,
    step: setup.step ?? 'main',
    first: setup.first ?? 0,
    cont: [{ kind: 'proc', id: 1, causedBy: null, name: 'turn', stage: 2, vars: {} }],
    pool: [],
    effects: [],
    turnLog: [],
    usage: {},
    pending: null,
    rans: [],
    rng: (setup.seed ?? 12345) | 0,
    seq: 10,
    nextPid,
    batchNo: 0,
    winner: null,
    loseReason: null,
    skipTurn: false,
    manaCharged: false,
    breaking: [],
    deckIds: [[], []],
    cfg,
    dirtySba: true,
  };
  s.pending = { id: 2, player: active, why: 'turnAction', input: null };
  return s;
}

export class Sim {
  s: GameState;
  events: Ev[] = [];
  r: Registry;
  constructor(setup: Setup, r: Registry = reg) {
    this.r = r;
    this.s = buildState(setup, r);
  }

  // ───── 行動 ─────
  do(a: Action): this {
    const r = engineStep(this.s, a, this.r);
    this.s = r.state;
    this.events.push(...r.events);
    const errs = checkInvariants(this.s);
    if (errs.length) throw new Error('不変条件違反: ' + errs.join(' / '));
    return this;
  }

  uid(p: PlayerId, zone: 'hand' | 'mana' | 'grave' | 'shield' | 'deck' | 'battle' | 'hyper', name: string, nth = 0): number {
    const did = defIdOf(name, this.r);
    const list: number[] = zone === 'battle' ? this.s.players[p].battle.map((x) => x.cards[0]) : this.s.players[p][zone];
    const hits = list.filter((u) => this.s.cards[u].defId === did);
    if (hits.length <= nth) throw new Error(`${p}:${zone} に ${name} が(${nth + 1}枚目)ありません`);
    return hits[nth];
  }

  pid(p: PlayerId, name: string, nth = 0): number {
    return this.s.cards[this.uid(p, 'battle', name, nth)].pid;
  }

  play(name: string, o: { from?: 'hand' | 'mana' | 'grave'; face?: number; extra?: any; p?: PlayerId; nth?: number } = {}): this {
    const p = o.p ?? this.s.active;
    const from = o.from ?? 'hand';
    return this.do({ type: 'PLAY_CARD', uid: this.uid(p, from, name, o.nth ?? 0), from, face: o.face, extra: o.extra });
  }
  charge(name: string): this {
    return this.do({ type: 'CHARGE_MANA', uid: this.uid(this.s.active, 'hand', name) });
  }
  skipMana(): this {
    return this.do({ type: 'SKIP_MANA' });
  }
  endMain(): this {
    return this.do({ type: 'END_MAIN' });
  }
  endTurn(): this {
    return this.do({ type: 'END_TURN' });
  }
  attack(attacker: string, target: 'player' | string, o: { nth?: number; tnth?: number } = {}): this {
    const p = this.s.active;
    const pid = this.pid(p, attacker, o.nth ?? 0);
    if (target === 'player') return this.do({ type: 'ATTACK', attacker: pid, target: { kind: 'player' } });
    const tp = this.pid((1 - p) as PlayerId, target, o.tnth ?? 0);
    return this.do({ type: 'ATTACK', attacker: pid, target: { kind: 'creature', pid: tp } });
  }

  // ───── 回答 ─────
  get pending(): Pending {
    if (!this.s.pending) throw new Error('入力待ちではありません');
    return this.s.pending;
  }
  answer(value: any): this {
    return this.do({ type: 'ANSWER', id: this.pending.id, value });
  }
  yes(): this {
    expect(this.pending.input?.shape).toBe('yesno');
    return this.answer(true);
  }
  no(): this {
    expect(this.pending.input?.shape).toBe('yesno');
    return this.answer(false);
  }
  /** pick に、名前で答える(同名が複数あるときは同じ名前を繰り返す。候補のうち先頭から割り当てる) */
  pick(...names: string[]): this {
    const inp = this.pending.input;
    if (!inp || inp.shape !== 'pick') throw new Error('pick ではありません: ' + JSON.stringify(inp));
    const used = new Set<number>();
    const out: number[] = [];
    for (const n of names) {
      const did = defIdOf(n, this.r);
      const u = inp.candidates.find((x) => this.s.cards[x].defId === did && !used.has(x));
      if (u === undefined) throw new Error(`候補に ${n} がありません`);
      used.add(u);
      out.push(u);
    }
    return this.answer(out);
  }
  none(): this {
    return this.answer([]);
  }
  /** option に、選択肢の番号で答える */
  option(...idx: number[]): this {
    expect(this.pending.input?.shape).toBe('option');
    return this.answer(idx);
  }
  /** assign に、枠ごとの名前で答える */
  assign(map: Record<string, string[]>): this {
    const inp = this.pending.input;
    if (!inp || inp.shape !== 'assign') throw new Error('assign ではありません');
    const used = new Set<number>();
    const out: Record<string, number[]> = {};
    for (const [slot, names] of Object.entries(map)) {
      out[slot] = [];
      for (const n of names) {
        const did = defIdOf(n, this.r);
        const u = inp.items.find((x) => this.s.cards[x].defId === did && !used.has(x));
        if (u === undefined) throw new Error(`items に ${n} がありません`);
        used.add(u);
        out[slot].push(u);
      }
    }
    return this.answer(out);
  }
  /** order に、ラベルの一部で答える */
  order(labelPart: string): this {
    const inp = this.pending.input;
    if (!inp || inp.shape !== 'order') throw new Error('order ではありません');
    const i = inp.labels.findIndex((l) => l.includes(labelPart));
    if (i < 0) throw new Error(`順序の候補に ${labelPart} がありません: ${inp.labels.join(' / ')}`);
    return this.answer(inp.candidates[i]);
  }

  /** turnAction になるまで、既定の答え(最小の選択・いいえ・先頭)で進める */
  drain(max = 30): this {
    let n = 0;
    while (this.s.pending && this.s.pending.why !== 'turnAction' && this.s.winner === null && n++ < max) {
      const inp: any = this.s.pending.input;
      if (inp.shape === 'pick') this.answer(inp.candidates.slice(0, inp.min));
      else if (inp.shape === 'yesno') this.answer(false);
      else if (inp.shape === 'option') this.answer(Array(inp.pick).fill(0));
      else if (inp.shape === 'order') this.answer(inp.candidates[0]);
      else if (inp.shape === 'ack') this.answer(true);
      else if (inp.shape === 'assign') {
        const out: Record<string, number[]> = {};
        const items = inp.items.slice();
        for (const sl of inp.slots) out[sl.id] = items.splice(0, Math.min(sl.count, items.length));
        this.answer(out);
      }
    }
    return this;
  }

  // ───── 検証 ─────
  names(p: PlayerId, zone: 'hand' | 'mana' | 'grave' | 'shield' | 'deck' | 'battle' | 'hyper'): string[] {
    const list: number[] = zone === 'battle' ? this.s.players[p].battle.map((x) => x.cards[0]) : this.s.players[p][zone];
    return list.map((u) => this.r.defs[this.s.cards[u].defId].name);
  }
  count(p: PlayerId, zone: 'hand' | 'mana' | 'grave' | 'shield' | 'deck' | 'battle' | 'hyper', name?: string): number {
    if (!name) return zone === 'battle' ? this.s.players[p].battle.length : this.s.players[p][zone].length;
    const did = defIdOf(name, this.r);
    const list: number[] = zone === 'battle' ? this.s.players[p].battle.map((x) => x.cards[0]) : this.s.players[p][zone];
    return list.filter((u) => this.s.cards[u].defId === did).length;
  }
  has(p: PlayerId, zone: 'hand' | 'mana' | 'grave' | 'shield' | 'deck' | 'battle' | 'hyper', name: string): boolean {
    return this.count(p, zone, name) > 0;
  }
  legal(): Action[] {
    return legalActions(this.s, this.r);
  }
  canPlay(name: string, from: 'hand' | 'mana' | 'grave' = 'hand'): boolean {
    const did = defIdOf(name, this.r);
    return this.legal().some((a) => a.type === 'PLAY_CARD' && this.s.cards[a.uid].defId === did && (a.from ?? 'hand') === from);
  }
  tappedMana(p: PlayerId): number {
    return this.s.players[p].mana.filter((u) => this.s.cards[u].tapped).length;
  }
  evs(type: string): Ev[] {
    return this.events.filter((e) => e.type === type);
  }
}

/** 自然のマナ(フェアリー・ライフ)を n 枚。別のカード名も指定できる */
export const mana = (n: number, c = 'フェアリー・ライフ'): string[] => Array.from({ length: n }, () => c);
