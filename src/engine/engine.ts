// エンジンの入口: 初期化・step(reducer)・実行ループ(design 5)。
import { loadRegistry, type Registry } from './registry';
import { defaultPlayFace } from './derive';
import { runSba, pushProc, runProc } from './procs';
import { collectBatch, emit, moveCards } from './ops';
import { legalActions, validateAction } from './legal';
import { cloneState, hashSeed, mkCtx, nextId, rngNext, shuffleInPlace, type Ctx } from './state';
import { runEffect } from './vm';
import {
  type Action,
  type CardDB,
  type Card,
  defaultConfig,
  type Ev,
  type GameConfig,
  type GameState,
  IllegalAction,
  NeedInput,
  type PlayerId,
  type PlayerZones,
  RuleLoopError,
} from './types';

export type { Registry };
export { legalActions, validateAction, cloneState };

export function registryOf(db: CardDB | Registry): Registry {
  return 'defs' in db && 'trigIndex' in db ? (db as Registry) : loadRegistry(db as CardDB);
}

// ───────────────────────── デッキ検証・初期化 ─────────────────────────

export interface DeckCheck {
  ok: boolean;
  errors: string[];
}

export function checkDeck(db: CardDB | Registry, deck: string[], strict = true): DeckCheck {
  const reg = registryOf(db);
  const errors: string[] = [];
  const count = new Map<string, number>();
  // defs は普通のオブジェクトなので、'constructor' や 'toString' などのプロトタイプのキーを、カードIDとして通さない。
  // '?'(見えないカード)は内部用で、デッキには入れられない
  const known = (id: string) => id !== '?' && Object.hasOwn(reg.defs, id);
  for (const id of deck) {
    if (!known(id)) errors.push(`未知のカードID: ${id}`);
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  if (strict) {
    if (deck.length !== 40) errors.push(`デッキは40枚です(現在 ${deck.length} 枚)`);
    for (const [id, n] of count) {
      if (n > 4 && id !== 'dummy') errors.push(`${reg.defs[id]?.name ?? id} は4枚までです(現在 ${n} 枚)`);
    }
  } else if (deck.length < 11) {
    errors.push('デッキは11枚以上必要です(シールド5+手札5+ドロー)');
  }
  return { ok: errors.length === 0, errors };
}

export interface NewGameOpts {
  decks: [string[], string[]];
  seed: number | string;
  /** 先攻。'random' は乱数で決める */
  first?: PlayerId | 'random';
  cfg?: Partial<GameConfig>;
  /** false なら与えられた並びのまま(山札の上が先頭)。シミュレータの初期条件用 */
  shuffle?: boolean | [boolean, boolean];
  /** 構築制限を検査するか */
  strict?: boolean;
}

export function createGame(db: CardDB | Registry, opts: NewGameOpts): { state: GameState; events: Ev[] } {
  const reg = registryOf(db);
  for (const p of [0, 1] as PlayerId[]) {
    const chk = checkDeck(reg, opts.decks[p], !!opts.strict);
    if (!chk.ok) throw new Error(`プレイヤー${p + 1}のデッキ: ${chk.errors.join(' / ')}`);
  }
  const cfg: GameConfig = { ...defaultConfig(), ...(opts.cfg ?? {}) };
  const cards: Card[] = [];
  const zones = (): PlayerZones => ({ deck: [], hand: [], mana: [], shield: [], grave: [], hyper: [], battle: [] });
  const players: [PlayerZones, PlayerZones] = [zones(), zones()];
  const s: GameState = {
    v: 1,
    cards,
    players,
    limbo: [],
    turn: 1,
    active: 0,
    step: 'start',
    first: 0,
    cont: [],
    pool: [],
    effects: [],
    turnLog: [],
    usage: {},
    pending: null,
    rans: [],
    rng: hashSeed(opts.seed) || 1,
    seq: 0,
    nextPid: 1,
    batchNo: 0,
    winner: null,
    loseReason: null,
    skipTurn: false,
    manaCharged: false,
    breaking: [],
    // デッキリストは順序を落とした(ソートした)多重集合で持つ。uid の並びと対応させて、隠れたカードを割り出されないため
    deckIds: [opts.decks[0].slice().sort(), opts.decks[1].slice().sort()],
    cfg,
    dirtySba: true,
  };
  // 乱数を少し進めて、近いシードでも別の並びにする
  for (let i = 0; i < 4; i++) rngNext(s);
  for (const p of [0, 1] as PlayerId[]) {
    // シャッフルしてから uid を振る(uid の並びが、デッキリストの並びと対応しないようにする)。
    // 位置ごとのカードは、従来(uid を振ってから位置を並べ替える)と同じになる。
    const list = opts.decks[p].slice();
    const sh = Array.isArray(opts.shuffle) ? opts.shuffle[p] : opts.shuffle !== false;
    if (sh) shuffleInPlace(s, list);
    for (const id of list) {
      cards.push({ defId: id, owner: p, zone: 'deck', ep: 0, tapped: false, ex: false, exPid: -1, pid: -1, face: 0 });
      players[p].deck.push(cards.length - 1);
    }
    // シールド5枚、手札5枚(spec 3.2)
    for (let i = 0; i < 5; i++) {
      const u = players[p].deck.shift()!;
      cards[u].zone = 'shield';
      players[p].shield.push(u);
    }
    for (let i = 0; i < 5; i++) {
      const u = players[p].deck.shift()!;
      cards[u].zone = 'hand';
      players[p].hand.push(u);
    }
  }
  s.first = opts.first === 'random' || opts.first === undefined ? ((rngNext(s) < 0.5 ? 0 : 1) as PlayerId) : opts.first;
  s.active = s.first;
  const c = mkCtx(s, reg);
  pushProc(c, 'turn');
  drive(c);
  return { state: s, events: c.out };
}

// ───────────────────────── step ─────────────────────────

export function step(state: GameState, action: Action, db: CardDB | Registry): { state: GameState; events: Ev[] } {
  const reg = registryOf(db);
  const err = validateAction(state, reg, action);
  if (err) throw new IllegalAction(err);
  const s = cloneState(state);
  const c = mkCtx(s, reg);
  if (action.type === 'ANSWER') {
    s.rans.push(action.value);
    s.pending = null;
  } else {
    s.pending = null;
    applyTurnAction(c, action);
  }
  drive(c);
  return { state: s, events: c.out };
}

function applyTurnAction(c: Ctx, a: Exclude<Action, { type: 'ANSWER' }>): void {
  const s = c.s;
  switch (a.type) {
    case 'CHARGE_MANA': {
      moveCards(c, [a.uid], { to: 'mana', cause: 'charge' });
      s.manaCharged = true;
      s.step = 'main';
      pushProc(c, 'settle');
      return;
    }
    case 'SKIP_MANA':
      s.step = 'main';
      return;
    case 'END_MAIN':
      s.step = 'attack';
      return;
    case 'END_TURN':
      s.step = 'end';
      return;
    case 'PLAY_CARD': {
      const card = s.cards[a.uid];
      const def = c.reg.defs[card.defId];
      const fi = a.face ?? defaultPlayFace(def);
      pushProc(c, 'settle');
      pushProc(c, 'play', { uid: a.uid, ep: card.ep, from: a.from ?? 'hand', face: fi, extra: a.extra ?? null, free: false, after: null });
      return;
    }
    case 'ATTACK': {
      s.step = 'attack';
      pushProc(c, 'settle');
      pushProc(c, 'attack', { pid: a.attacker, target: a.target });
      return;
    }
  }
}

// ───────────────────────── 実行ループ ─────────────────────────

export function drive(c: Ctx): void {
  const s = c.s;
  let steps = 0;
  while (!s.pending && s.winner === null && s.cont.length > 0) {
    if (++steps > s.cfg.maxFrameSteps) throw new RuleLoopError('処理が終わりません(無限ループの疑い)');
    const f = s.cont[s.cont.length - 1];
    c.askIdx = 0;
    c.rng0 = s.rng;
    c.seq0 = s.seq;
    c.cause = f.id;
    try {
      if (f.kind === 'effect') {
        // 効果の途中でも状況起因処理を優先する(111.2d)
        if (s.dirtySba && s.cfg.sbaTiming === 'afterEachStep' && runSba(c)) {
          s.rans = [];
          continue;
        }
        const done = runEffect(c, f);
        if (done) {
          const top = s.cont[s.cont.length - 1];
          if (top === f) s.cont.pop();
        }
      } else {
        runProc(c, f);
      }
      s.rans = [];
    } catch (e) {
      if (e instanceof NeedInput) {
        s.pending = { ...e.spec, id: nextId(s) };
        break;
      }
      throw e;
    }
  }
}

// ───────────────────────── ヘルパー ─────────────────────────

export { emit, collectBatch };
