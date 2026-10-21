// カードDBの検証・正規化・索引化・能力のコンパイル(spec 4.3 / effects 4.3, 6)。
import type { Ability, ActDef, Cond, Expr, StepDef, TriggerSpec } from './ast';
import { type AbilityRef, type CardDB, type CardDef, type Face, isCreatureType } from './types';

// ───────────────────────── 命令(バイトコード) ─────────────────────────

export type Instr =
  | { o: 'act'; act: ActDef }
  | { o: 'select'; step: Extract<StepDef, { op: 'select' }> }
  | { o: 'may'; no: number; prompt?: string }
  | { o: 'jmp'; to: number }
  | { o: 'jf'; cond: Cond; to: number }
  | { o: 'modes'; step: Extract<StepDef, { op: 'modes' }>; key: string; starts: number[]; next: number }
  | { o: 'modesNext'; key: string; starts: number[]; end: number }
  | { o: 'eachInit'; inVar: string; key: string }
  | { o: 'eachNext'; as: string; inVar: string; key: string; end: number }
  | { o: 'repeatInit'; times: any; key: string }
  | { o: 'repeatNext'; key: string; end: number }
  | { o: 'setIter'; which: 0 | 1 }
  | { o: 'custom'; handler: string; args?: any };

export type Program = Instr[];

export interface TrigRef {
  defId: string;
  face: number;
  idx: number;
  ability: Extract<Ability, { kind: 'trigger' }>;
}

export interface FaceInfo {
  blocker: boolean;
  breaker: number;
  speedAttacker: boolean;
  machFighter: boolean;
  exLife: boolean;
  justDiver: boolean;
  slayer: boolean;
  sympathy: boolean;
  hyperEnergy: boolean;
  shieldTriggers: { ability: Extract<Ability, { kind: 'keyword' }>; idx: number }[];
  gStrike: { ability: Extract<Ability, { kind: 'keyword' }>; idx: number } | null;
  breakers: { n: number; while?: Cond }[];
  selfCosts: { delta: Expr; cond?: Cond; floor?: number }[];
  altCosts: Extract<Ability, { kind: 'altCost' }>[];
  /** ハイパー化の、タップする他のクリーチャーの数(なければ null) */
  hyperize: number | null;
  /** シンカライズを持つか */
  shinkalize: boolean;
  statics: { ability: Extract<Ability, { kind: 'static' }>; idx: number }[];
  replaces: { ability: Extract<Ability, { kind: 'replace' }>; idx: number }[];
  permissions: Extract<Ability, { kind: 'permission' }>[];
  triggers: TrigRef[];
  spell: { ability: Extract<Ability, { kind: 'spell' }>; idx: number } | null;
  hasTriggerOrStatic: boolean;
}

/** 能力を無視されているカードの FaceInfo(何の能力も持たない) */
export const EMPTY_FACE_INFO: FaceInfo = {
  blocker: false, breaker: 1, speedAttacker: false, machFighter: false, exLife: false, justDiver: false, slayer: false,
  sympathy: false, hyperEnergy: false, shieldTriggers: [], gStrike: null, breakers: [], selfCosts: [], altCosts: [], hyperize: null, shinkalize: false, statics: [],
  replaces: [], permissions: [], triggers: [], spell: null, hasTriggerOrStatic: false,
};

export interface Registry {
  db: CardDB;
  defs: CardDB;
  info: Record<string, FaceInfo[]>;
  trigIndex: Map<string, TrigRef[]>;
  /** イベント種類 → 定義ID → その定義の誘発能力(trigIndex の定義別の索引。collect が全カードを走査する時に使う) */
  trigByDef: Map<string, Map<string, TrigRef[]>>;
  progs: Map<string, Program>;
  /** 出る時の置換(match.type = 'enter')を持つカードがあるか(なければ、出る処理で探さない) */
  hasEntryReplace: boolean;
  /** 呪文の解決後の置換(match.type = 'afterCast')を持つカードがあるか */
  hasAfterCastReplace: boolean;
  /** どのカードの移動にも当てはまる置換(match.type = 'move')を持つカードがあるか */
  hasMoveReplace: boolean;
  /** 手札から捨てられる時の自身の置換(match: moved, from: hand)を持つカードがあるか */
  hasHandReplace: boolean;
  /** 出る時にタップさせる静的能力(enterTappedFirst)を持つカードがあるか */
  hasEnterTapped: boolean;
  /** 各ターンはじめてバトルする自分のクリーチャーが勝つ静的能力を持つカードがあるか */
  hasFirstBattleWins: boolean;
  getFace(defId: string, face: number): Face;
  getInfo(defId: string, face: number): FaceInfo;
  program(ref: AbilityRef, noOptional?: boolean): Program;
  ability(ref: AbilityRef): Ability;
}

// ───────────────────────── 展開(キーワード → 誘発型能力) ─────────────────────────

function expandFace(face: Face): Face {
  const out: Ability[] = [];
  for (const a of face.abilities) {
    out.push(a);
    if (a.kind !== 'keyword') continue;
    if (a.name === 'yobinion') {
      out.push({
        kind: 'trigger',
        label: 'ヨビニオン',
        optional: true,
        spec: { on: { type: 'entered', via: 'summon' }, subject: 'self' },
        steps: [
          {
            op: 'act',
            act: {
              revealUntil: {
                as: '$found',
                rest: '$rest',
                cond: { all: [{ type: 'creature' }, { evolution: false }, { cost: { lt: { costOf: '$self' } } }] },
              },
            },
          },
          { op: 'act', act: { put: { sel: '$found' } } },
          { op: 'act', act: { shuffleBottom: { of: '$rest' } } },
        ],
      });
    } else if (a.name === 'justDiver') {
      out.push({
        kind: 'trigger',
        label: 'ジャストダイバー',
        spec: { on: { type: 'entered' }, subject: 'self' },
        steps: [
          {
            op: 'act',
            act: { addEffect: { sel: '$self', mods: [{ kind: 'cannotBeChosen' }, { kind: 'cannotBeAttacked' }], until: 'nextTurnStart' } },
          },
        ],
      });
    } else if (a.name === 'revolutionChange') {
      out.push({
        kind: 'trigger',
        label: a.label ?? '革命チェンジ',
        optional: true,
        spec: {
          on: { type: 'attackDeclared', attackerCond: a.attacker, owner: 'self' },
          watch: ['hand'],
          subject: 'any',
        },
        steps: [{ op: 'act', act: { revolutionChange: {} } }],
      });
    } else if (a.name === 'invasion') {
      const spec: TriggerSpec = {
        on: { type: 'attackDeclared', attackerCond: a.attacker, owner: 'self' },
        watch: ['battle', 'hand', 'grave', 'mana'],
        // 自分自身が攻撃する時には誘発しない(自分自身の上には重ねられない)。
        // バトルゾーンから侵略する場合の「別のクリーチャー」の攻撃だけが対象
        subject: 'other',
      };
      out.push({
        kind: 'trigger',
        label: a.label ?? '侵略',
        optional: true,
        spec,
        steps: [{ op: 'act', act: { invade: {} } }],
      });
    }
  }
  return { ...face, abilities: out };
}

const KNOWN_ACTS = new Set([
  'draw', 'move', 'lookTop', 'revealUntil', 'shuffleBottom', 'assign', 'addShield', 'tap', 'untap',
  'addEffect', 'put', 'summon', 'castFree', 'skipRestOfTurn', 'copyTrigger', 'reveal', 'invade', 'shuffle',
  'setVar', 'moveTop', 'revolutionChange', 'playerEffect', 'log', 'battle', 'shuffleIn', 'bottom', 'moveBottom', 'summonOnto', 'extraTurn', 'markUsed', 'putUnder', 'tapLock', 'breakShields',
]);
const KNOWN_COND = new Set([
  'all', 'any', 'not', 'civ', 'civsAll', 'multicolor', 'cost', 'power', 'type', 'evolution', 'race', 'tapped',
  'sameCivAs', 'cmp', 'count', 'fiveCivs', 'civsPresent', 'logged', 'shields', 'notInBattle', 'nonEmpty',
  'turnOf', 'zoneIs', 'exShield', 'true', 'some', 'isSelf', 'stUsed', 'unused', 'faceUp', 'hyper', 'altUsed', 'nameHas',
]);
const KNOWN_CUSTOM = new Set<string>([]);
const KNOWN_KEYWORD = new Set([
  'blocker', 'breaker', 'shieldTrigger', 'gStrike', 'speedAttacker', 'machFighter', 'exLife', 'justDiver',
  'sympathy', 'hyperEnergy', 'yobinion', 'invasion', 'slayer', 'revolutionChange',
]);

/** 条件(カードデータの JSON)の検査。形がまだ信用できない入力なので、型は緩く受ける */
function checkCond(input: unknown, where: string, errs: string[]) {
  if (input == null) return;
  const c = input as { all?: Cond[]; any?: Cond[]; not?: Cond } & Record<string, unknown>;
  const keys = Object.keys(c).filter((k) => KNOWN_COND.has(k) || !['gte', 'lte', 'eq'].includes(k));
  if (keys.length === 0) errs.push(`${where}: 条件が空です`);
  for (const k of keys) {
    if (!KNOWN_COND.has(k)) errs.push(`${where}: 未知の条件 '${k}'`);
  }
  if (c.all) c.all.forEach((x: Cond) => checkCond(x, where, errs));
  if (c.any) c.any.forEach((x: Cond) => checkCond(x, where, errs));
  if (c.not) checkCond(c.not, where, errs);
}

function checkSteps(steps: StepDef[] | undefined, where: string, errs: string[]) {
  if (!steps) return;
  for (const st of steps) {
    switch (st.op) {
      case 'act': {
        const ks = Object.keys(st.act);
        if (ks.length !== 1) errs.push(`${where}: act は1キー(${ks.join(',')})`);
        for (const k of ks) if (!KNOWN_ACTS.has(k)) errs.push(`${where}: 未対応の原始操作 '${k}'`);
        break;
      }
      case 'select':
        if (!st.as) errs.push(`${where}: select に as がありません`);
        if ((st.from as { where?: unknown }).where) checkCond((st.from as { where?: unknown }).where, where, errs);
        break;
      case 'may':
        checkSteps(st.then, where, errs);
        checkSteps(st.else, where, errs);
        break;
      case 'if':
        checkCond(st.cond, where, errs);
        checkSteps(st.then, where, errs);
        checkSteps(st.else, where, errs);
        break;
      case 'each':
      case 'repeat':
      case 'forPlayers':
        checkSteps(st.body, where, errs);
        break;
      case 'modes':
        if (!st.options?.length) errs.push(`${where}: modes に options がありません`);
        for (const o of st.options ?? []) checkSteps(o.steps, where, errs);
        if (st.allIf) checkCond(st.allIf, where, errs);
        break;
      case 'custom':
        if (!KNOWN_CUSTOM.has(st.handler)) errs.push(`${where}: 未対応の custom '${st.handler}'`);
        break;
      default:
        errs.push(`${where}: 未知のステップ '${(st as { op?: unknown }).op}'`);
    }
  }
}

/** カードDBを検証する。エラー文字列の配列を返す(空なら正常)。 */
export function validateCardDb(db: CardDB): string[] {
  const errs: string[] = [];
  for (const [id, def] of Object.entries(db)) {
    const w0 = `[${id}]`;
    if (def.id !== id) errs.push(`${w0}: id が一致しません`);
    if (!def.name) errs.push(`${w0}: name がありません`);
    if (!def.faces?.length) errs.push(`${w0}: faces がありません`);
    def.faces?.forEach((f, fi) => {
      const w = `${w0}面${fi}(${f.name})`;
      if (!['creature', 'spell', 'evolution', 'smaxEvolution', 'tamaseed', 'field', 'crossgear'].includes(f.type)) errs.push(`${w}: 未知の種類 ${f.type}`);
      if (typeof f.cost !== 'number') errs.push(`${w}: cost がありません`);
      if (!Array.isArray(f.civs)) errs.push(`${w}: civs がありません`); // 無色は空の配列
      if (isCreatureType(f.type) && typeof f.power !== 'number') errs.push(`${w}: power がありません`);
      if (f.type === 'evolution' && !f.evolveFrom) errs.push(`${w}: 進化には evolveFrom が必要です`);
      f.abilities?.forEach((a, ai) => {
        const wa = `${w}能力${ai}`;
        switch (a.kind) {
          case 'keyword':
            if (!KNOWN_KEYWORD.has(a.name)) errs.push(`${wa}: 未知のキーワード '${a.name}'`);
            checkSteps(a.steps, wa, errs);
            break;
          case 'trigger':
            if (!a.spec?.on) errs.push(`${wa}: trigger に spec.on がありません`);
            checkSteps(a.steps, wa, errs);
            break;
          case 'spell':
            checkSteps(a.steps, wa, errs);
            break;
          case 'replace':
            if (a.apply.type === 'steps') checkSteps(a.apply.steps, wa, errs);
            break;
          case 'static':
          case 'permission':
          case 'selfCost':
          case 'altCost':
          case 'hyperize':
          case 'shinkalize':
            break;
          default:
            errs.push(`${wa}: 未知の能力 kind '${(a as { kind?: unknown }).kind}'`);
        }
      });
    });
  }
  return errs;
}

// ───────────────────────── コンパイル ─────────────────────────


function compileSteps(steps: StepDef[], out: Instr[]): void {
  for (const st of steps) {
    switch (st.op) {
      case 'act':
        out.push({ o: 'act', act: st.act });
        break;
      case 'select':
        out.push({ o: 'select', step: st });
        break;
      case 'custom':
        out.push({ o: 'custom', handler: st.handler, args: st.args });
        break;
      case 'may': {
        const m: Instr = { o: 'may', no: -1, prompt: st.prompt };
        out.push(m);
        compileSteps(st.then, out);
        if (st.else?.length) {
          const j: Instr = { o: 'jmp', to: -1 };
          out.push(j);
          m.no = out.length;
          compileSteps(st.else, out);
          j.to = out.length;
        } else {
          m.no = out.length;
        }
        break;
      }
      case 'if': {
        const j: Instr = { o: 'jf', cond: st.cond, to: -1 };
        out.push(j);
        compileSteps(st.then, out);
        if (st.else?.length) {
          const j2: Instr = { o: 'jmp', to: -1 };
          out.push(j2);
          j.to = out.length;
          compileSteps(st.else, out);
          j2.to = out.length;
        } else {
          j.to = out.length;
        }
        break;
      }
      case 'modes': {
        const key = `$m${out.length}`;
        const starts: number[] = [];
        const head: Instr = { o: 'modes', step: st, key, starts, next: -1 };
        out.push(head);
        const nextI: Instr = { o: 'modesNext', key, starts, end: -1 };
        head.next = out.length;
        out.push(nextI);
        const nextPc = head.next;
        const endJumps: Instr[] = [];
        // 各選択肢の本体 → 末尾で modesNext に戻る
        for (const opt of st.options) {
          starts.push(out.length);
          compileSteps(opt.steps, out);
          out.push({ o: 'jmp', to: nextPc });
        }
        nextI.end = out.length;
        void endJumps;
        break;
      }
      case 'each': {
        const key = `$e${out.length}`;
        out.push({ o: 'eachInit', inVar: st.in, key });
        const nextPc = out.length;
        const nx: Instr = { o: 'eachNext', as: st.as, inVar: st.in, key, end: -1 };
        out.push(nx);
        compileSteps(st.body, out);
        out.push({ o: 'jmp', to: nextPc });
        nx.end = out.length;
        break;
      }
      case 'repeat': {
        const key = `$r${out.length}`;
        out.push({ o: 'repeatInit', times: st.times, key });
        const nextPc = out.length;
        const nx: Instr = { o: 'repeatNext', key, end: -1 };
        out.push(nx);
        compileSteps(st.body, out);
        out.push({ o: 'jmp', to: nextPc });
        nx.end = out.length;
        break;
      }
      case 'forPlayers':
        out.push({ o: 'setIter', which: 0 });
        compileSteps(st.body, out);
        out.push({ o: 'setIter', which: 1 });
        compileSteps(st.body, out);
        break;
    }
  }
}

function abilitySteps(a: Ability): StepDef[] {
  switch (a.kind) {
    case 'trigger':
    case 'spell':
      return a.steps;
    case 'keyword':
      return a.steps ?? [];
    case 'replace':
      return a.apply.type === 'steps' ? a.apply.steps : [];
    default:
      return [];
  }
}

// ───────────────────────── レジストリ ─────────────────────────

const cache = new WeakMap<CardDB, Registry>();

export function loadRegistry(origDb: CardDB): Registry {
  let db = origDb;
  const hit = cache.get(origDb);
  if (hit) return hit;
  const errs = validateCardDb(db);
  if (errs.length) throw new Error('カードデータの検証エラー:\n' + errs.join('\n'));

  const defs: CardDB = {};
  const info: Record<string, FaceInfo[]> = {};
  // 見えないカード('?')は、何もしないカードとして扱う(PlayerView を安全に扱えるようにする)
  if (!db['?']) {
    db = { ...db, '?': { id: '?', name: '(不明)', faces: [{ name: '(不明)', type: 'creature', cost: 99, civs: ['light'], power: 0, abilities: [] }] } };
  }
  const trigIndex = new Map<string, TrigRef[]>();
  for (const [id, def] of Object.entries(db)) {
    const faces = def.faces.map(expandFace);
    const nd: CardDef = { ...def, faces };
    defs[id] = nd;
    info[id] = faces.map((f, fi) => {
      const fi_: FaceInfo = {
        blocker: false, breaker: 1, speedAttacker: false, machFighter: false, exLife: false, justDiver: false, slayer: false,
        sympathy: false, hyperEnergy: false, shieldTriggers: [], gStrike: null, breakers: [], selfCosts: [], altCosts: [], hyperize: null, shinkalize: false, statics: [],
        replaces: [], permissions: [], triggers: [], spell: null, hasTriggerOrStatic: false,
      };
      f.abilities.forEach((a, idx) => {
        switch (a.kind) {
          case 'keyword':
            if (a.name === 'blocker') fi_.blocker = true;
            else if (a.name === 'breaker') {
              fi_.breakers.push({ n: a.n ?? 2, while: a.while });
              fi_.breaker = Math.max(fi_.breaker, a.n ?? 2);
            } else if (a.name === 'speedAttacker') fi_.speedAttacker = true;
            else if (a.name === 'machFighter') fi_.machFighter = true;
            else if (a.name === 'exLife') fi_.exLife = true;
            else if (a.name === 'justDiver') fi_.justDiver = true;
            else if (a.name === 'slayer') fi_.slayer = true;
            else if (a.name === 'sympathy') fi_.sympathy = true;
            else if (a.name === 'hyperEnergy') fi_.hyperEnergy = true;
            else if (a.name === 'shieldTrigger') fi_.shieldTriggers.push({ ability: a, idx });
            else if (a.name === 'gStrike') fi_.gStrike = { ability: a, idx };
            break;
          case 'trigger': {
            const ref: TrigRef = { defId: id, face: fi, idx, ability: a };
            fi_.triggers.push(ref);
            fi_.hasTriggerOrStatic = true;
            const ons = Array.isArray(a.spec.on) ? a.spec.on : [a.spec.on];
            for (const on of ons) {
              const l = trigIndex.get(on.type) ?? [];
              l.push(ref);
              trigIndex.set(on.type, l);
            }
            break;
          }
          case 'static':
            fi_.statics.push({ ability: a, idx });
            fi_.hasTriggerOrStatic = true;
            break;
          case 'replace':
            fi_.replaces.push({ ability: a, idx });
            fi_.hasTriggerOrStatic = true;
            break;
          case 'permission':
            fi_.permissions.push(a);
            break;
          case 'selfCost':
            fi_.selfCosts.push({ delta: a.delta, cond: a.cond, floor: a.floor });
            break;
          case 'altCost':
            fi_.altCosts.push(a);
            break;
          case 'hyperize':
            fi_.hyperize = a.tapOther;
            break;
          case 'shinkalize':
            fi_.shinkalize = true;
            break;
          case 'spell':
            fi_.spell = { ability: a, idx };
            break;
        }
      });
      return fi_;
    });
  }

  const trigByDef = new Map<string, Map<string, TrigRef[]>>();
  for (const [type, refs] of trigIndex) {
    const m = new Map<string, TrigRef[]>();
    for (const r of refs) {
      const l = m.get(r.defId) ?? [];
      l.push(r);
      m.set(r.defId, l);
    }
    trigByDef.set(type, m);
  }

  const progs = new Map<string, Program>();
  const hasReplace = (type: string) => Object.values(defs).some((d) => d.faces.some((f) => f.abilities.some((a) => a.kind === 'replace' && a.match.type === type)));
  const hasEntryReplace = hasReplace('enter');
  const hasAfterCastReplace = hasReplace('afterCast');
  const hasMoveReplace = hasReplace('move');
  const hasFirstBattleWins = Object.values(defs).some((d) => d.faces.some((f) => f.abilities.some((a) => a.kind === 'static' && a.mod.type === 'firstBattleWins')));
  const hasEnterTapped = Object.values(defs).some((d) => d.faces.some((f) => f.abilities.some((a) => a.kind === 'static' && a.mod.type === 'enterTappedFirst')));
  const hasHandReplace = Object.values(defs).some((d) => d.faces.some((f) => f.abilities.some((a) => a.kind === 'replace' && a.match.type === 'moved' && a.match.from === 'hand')));
  // program() の高速な引き当て: 定義ID → (面・能力・任意なし) の配列。文字列キーを毎回作らない
  const progFast = new Map<string, (Program | undefined)[]>();
  const reg: Registry = {
    db,
    defs,
    info,
    trigIndex,
    trigByDef,
    progs,
    hasEntryReplace,
    hasAfterCastReplace,
    hasMoveReplace,
    hasHandReplace,
    hasEnterTapped,
    hasFirstBattleWins,
    getFace(defId, face) {
      const d = defs[defId];
      if (!d) throw new Error(`未知のカード: ${defId}`);
      return d.faces[face] ?? d.faces[0];
    },
    getInfo(defId, face) {
      const i = info[defId];
      if (!i) throw new Error(`未知のカード: ${defId}`);
      return i[face] ?? i[0];
    },
    ability(ref) {
      return reg.getFace(ref.defId, ref.face).abilities[ref.idx];
    },
    program(ref, noOptional = false) {
      let fast = progFast.get(ref.defId);
      if (!fast) {
        fast = [];
        progFast.set(ref.defId, fast);
      }
      const fi = (ref.face * 1024 + ref.idx) * 2 + (noOptional ? 1 : 0);
      const hit = fast[fi];
      if (hit) return hit;
      const key = `${ref.defId}:${ref.face}:${ref.idx}:${noOptional ? 1 : 0}`;
      let p = progs.get(key);
      if (!p) {
        const a = reg.ability(ref);
        p = [];
        const optional = a.kind === 'trigger' && a.optional && !noOptional;
        if (optional) {
          const m: Instr = { o: 'may', no: -1, prompt: (a as { label?: string }).label };
          p.push(m);
          compileSteps(abilitySteps(a), p);
          m.no = p.length;
        } else {
          compileSteps(abilitySteps(a), p);
        }
        progs.set(key, p);
      }
      fast[fi] = p;
      return p;
    },
  };
  cache.set(origDb, reg);
  return reg;
}
