// CPU の手のレビュー表のためのデータ作り: CPU 同士の対局から判断を層化して抜き出し、人が読める形に整える。
//   npx tsx scripts/review-sample.ts [試合数=48] [反復=600] [シード=1] [出力=scratch/review/decisions.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { makeAgent } from '../src/ai';
import { parseSpec } from '../src/ai/specString';
import { legalActions } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import type { Action, GameState } from '../src/engine/types';
import { teacherValues } from '../src/sim/aiEval';
import { mulberry, playGameSync } from '../src/sim/playGame';
import { describeEvent } from '../src/ui/format';
import { installNativeFromEnv } from '../src/wasm/installNode';

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);
const [gamesArg = '48', iter = '600', seedArg = '1', outPath = 'scratch/review/decisions.json'] = process.argv.slice(2);
const seed = Number(seedArg);
const rand = mulberry(seed * 7919);

const CIV_JA: Record<string, string> = { light: '光', water: '水', darkness: '闇', fire: '火', nature: '自然' };
const DECK_JA: Record<string, string> = Object.fromEntries(DECK_PRESETS.map((d) => [d.id, d.short]));

interface CardView {
  name: string;
  cost: number;
  civs: string[];
  kind: string;
  power: number | null;
  text: string;
  tapped?: boolean;
  sick?: boolean;
  stacked?: number;
}
function cardInfo(defId: string): CardView {
  const d = reg.defs[defId];
  const f = d.faces[0];
  const civs = [...new Set(d.faces.flatMap((x) => x.civs))].map((c) => CIV_JA[c] ?? c);
  const kinds = new Set(d.faces.map((x) => (x.type === 'spell' ? '呪文' : 'クリーチャー')));
  return {
    name: d.name,
    cost: Math.min(...d.faces.map((x) => x.cost)),
    civs,
    kind: d.faces.length > 1 ? 'ツインパクト' : [...kinds][0],
    power: f.power ?? null,
    text: (d as { text?: string }).text ?? '',
  };
}
const faceName = (s: GameState, uid: number) => {
  const c = s.cards[uid];
  const d = reg.defs[c.defId];
  return c.zone === 'battle' ? (d.faces[c.face]?.name ?? d.name) : d.name.split(' / ')[0];
};

function sideView(s: GameState, p: number, showHand: boolean) {
  const z = s.players[p];
  const manaCivs = new Set<string>();
  for (const m of z.mana) for (const f of reg.defs[s.cards[m].defId].faces) for (const c of f.civs) manaCivs.add(CIV_JA[c] ?? c);
  return {
    shield: z.shield.length,
    deck: z.deck.length,
    mana: { total: z.mana.length, untapped: z.mana.filter((u) => !s.cards[u].tapped).length, civs: [...manaCivs] },
    hand: showHand ? z.hand.map((u) => cardInfo(s.cards[u].defId)) : z.hand.length,
    battle: z.battle.map((b) => {
      const top = s.cards[b.cards[0]];
      const info = cardInfo(top.defId);
      const face = reg.defs[top.defId].faces[top.face] ?? reg.defs[top.defId].faces[0];
      return { ...info, name: faceName(s, b.cards[0]), power: face.power ?? null, tapped: b.tapped, sick: b.sick, stacked: b.cards.length > 1 ? b.cards.length - 1 : undefined };
    }),
    grave: z.grave.slice(-10).map((u) => faceName(s, u)),
    graveCount: z.grave.length,
  };
}

function describeAction(s: GameState, a: Action): string {
  const me = s.pending!.player;
  const perm = (p: number, pid: number) => s.players[p].battle.find((x) => x.pid === pid);
  const pw = (p: number, pid: number) => {
    const b = perm(p, pid);
    if (!b) return '?';
    const top = s.cards[b.cards[0]];
    const f = reg.defs[top.defId].faces[top.face] ?? reg.defs[top.defId].faces[0];
    return `${faceName(s, b.cards[0])}(${f.power ?? '-'})`;
  };
  switch (a.type) {
    case 'CHARGE_MANA':
      return `マナに置く: ${faceName(s, a.uid)}`;
    case 'SKIP_MANA':
      return 'マナに置かない';
    case 'PLAY_CARD': {
      const d = reg.defs[s.cards[a.uid].defId];
      const f = d.faces[a.face ?? 0] ?? d.faces[0];
      const from = a.from && a.from !== 'hand' ? `(${a.from === 'mana' ? 'マナ' : '墓地'}から)` : '';
      return `${f.type === 'spell' ? '唱える' : '出す'}: ${f.name}(コスト${f.cost})${from}`;
    }
    case 'ATTACK':
      return `攻撃: ${pw(me, a.attacker)} → ${a.target.kind === 'player' ? `相手プレイヤー(盾${s.players[1 - me].shield.length})` : pw(1 - me, a.target.pid)}`;
    case 'END_MAIN':
      return '攻撃に進む(メインを終える)';
    case 'END_TURN':
      return 'ターンを終える';
    case 'ANSWER': {
      const p = s.pending!;
      const inp = p.input;
      let d = JSON.stringify(a.value);
      if (inp && inp.shape === 'yesno') d = a.value ? 'はい' : 'いいえ';
      else if (inp && inp.shape === 'option') d = (a.value as number[]).map((i) => inp.options[i]).join(' + ');
      else if (inp && inp.shape === 'pick') d = (a.value as number[]).map((u) => faceName(s, u)).join('、') || '選ばない(使わない)';
      else if (inp && inp.shape === 'assign') d = Object.entries(a.value as Record<string, number[]>).map(([k, v]) => `${inp.slots.find((x) => x.id === k)?.label ?? k}: ${v.map((u) => faceName(s, u)).join('、')}`).join(' / ');
      return d;
    }
    default:
      return JSON.stringify(a);
  }
}

const WHY_JA: Record<string, string> = {
  select: '対象を選ぶ',
  may: '効果を使うか選ぶ',
  modes: '効果の選択肢を選ぶ',
  assign: '振り分ける',
  block: 'ブロックするか選ぶ',
  triggerDeclare: 'S・トリガーなどを使うか選ぶ',
  pickNext: '解決の順番を選ぶ',
  replaceChoice: '置き換えを選ぶ',
};
function promptOf(s: GameState): { kind: string; title: string } {
  const p = s.pending!;
  if (p.why === 'turnAction') {
    const legal = legalActions(s, reg);
    if (legal.some((a) => a.type === 'CHARGE_MANA')) return { kind: 'マナチャージ', title: 'マナゾーンにカードを置くか選ぶ' };
    if (legal.some((a) => a.type === 'PLAY_CARD')) return { kind: '召喚・詠唱', title: 'メインフェイズ: 出す・唱えるカードを選ぶ' };
    return { kind: '攻撃・終了', title: '攻撃フェイズ: 攻撃するか、ターンを終えるか' };
  }
  const src = p.source ? faceName(s, p.source.uid) : '';
  return { kind: '効果の選択', title: `${src ? src + ': ' : ''}${WHY_JA[p.why] ?? p.why}${p.prompt ? '(' + p.prompt + ')' : ''}` };
}

// ───────────────────────── 対局と抜き出し ─────────────────────────
interface Cand {
  pre: GameState;
  action: Action;
  game: string;
  gseed: number;
  kind: string;
}
const spec = parseSpec(`mcts:iter=${iter}`);
const ids = DECK_PRESETS.map((d) => d.id);
const cands: Cand[] = [];
const t0 = Date.now();
for (let g = 0; g < Number(gamesArg); g++) {
  const a = ids[g % ids.length];
  const b = ids[Math.floor(g / ids.length) % ids.length];
  const gseed = seed * 10007 + g;
  const agents = [makeAgent(spec), makeAgent(spec)] as const;
  let prev: GameState | null = null;
  playGameSync(reg, [agents[0], agents[1]], {
    decks: [deckCards(a), deckCards(b)],
    seed: gseed,
    first: 0,
    onStep: (s, act) => {
      if (prev && prev.pending && prev.winner === null && prev.pending.why !== 'pickNext') {
        cands.push({ pre: prev, action: act, game: `${DECK_JA[a]} 対 ${DECK_JA[b]}`, gseed, kind: '' });
      }
      prev = s;
    },
  });
}
console.error(`対局 ${gamesArg} 試合 / 候補 ${cands.length} (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);

// 2 択以上で、同名の候補を畳んでも 2 択以上のものだけ
interface Opt {
  text: string;
  act: Action;
}
const usable: (Cand & { opts: Opt[]; chosenIdx: number; kindJa: string; title: string })[] = [];
for (const c of cands) {
  const legal = legalActions(c.pre, reg);
  if (legal.length < 2) continue;
  const seen = new Map<string, Opt>();
  for (const a of legal) {
    const t = describeAction(c.pre, a);
    if (!seen.has(t)) seen.set(t, { text: t, act: a });
  }
  const opts = [...seen.values()];
  if (opts.length < 2) continue;
  const chosenText = describeAction(c.pre, c.action);
  const chosenIdx = opts.findIndex((o) => o.text === chosenText);
  if (chosenIdx < 0) continue;
  const p = promptOf(c.pre);
  usable.push({ ...c, opts, chosenIdx, kindJa: p.kind, title: p.title });
}

const pickN = <T,>(xs: T[], n: number): T[] => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
};
const late = (c: (typeof usable)[number]) => c.pre.turn >= 5;
const quota: [string, number][] = [
  ['マナチャージ', 14],
  ['召喚・詠唱', 12],
  ['攻撃・終了', 16],
  ['効果の選択', 12],
];
let chosen: typeof usable = [];
for (const [k, n] of quota) chosen = chosen.concat(pickN(usable.filter((c) => c.kindJa === k && late(c) && c.opts.length >= 2), n));
// 順序は混ぜる(種類が偏らないよう)
chosen = pickN(chosen, chosen.length);

// 参考値: 教師(ゲーム終了まで・300 ラウンド)による各候補の勝率
const records = chosen.map((c, i) => {
  const s = c.pre;
  const who = s.pending!.player;
  let q: number[] | null = null;
  try {
    const legal = legalActions(s, reg);
    const te = teacherValues(reg, { pair: 0, turn: s.turn, state: s }, { rounds: 300, horizon: 99, seed: c.gseed });
    if (!te.means.some((m) => Number.isNaN(m))) {
      const byText = new Map<string, number>();
      legal.forEach((a, k) => {
        const t = describeAction(s, a);
        if (!byText.has(t)) byText.set(t, te.means[k]);
      });
      q = c.opts.map((o) => byText.get(o.text) ?? NaN);
    }
  } catch {
    q = null;
  }
  const recent = s.turnLog
    .map((e) => describeEvent(s, e, who))
    .filter((x): x is string => !!x)
    .slice(-8);
  return {
    id: `d${String(i + 1).padStart(2, '0')}`,
    game: c.game,
    seed: c.gseed,
    turn: Math.ceil(s.turn / 2),
    totalTurn: s.turn,
    who: who === 0 ? '先攻' : '後攻',
    step: s.step,
    kind: c.kindJa,
    title: c.title,
    me: sideView(s, who, true),
    opp: sideView(s, 1 - who, false),
    recent,
    options: c.opts.map((o, k) => ({ text: o.text, q: q && Number.isFinite(q[k]) ? Math.round(q[k] * 1000) / 10 : null })),
    cpu: c.chosenIdx,
  };
});
mkdirSync('scratch/review', { recursive: true });
writeFileSync(outPath, JSON.stringify(records));
console.log(`出力 ${records.length} 件 → ${outPath}(${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
const byKind: Record<string, number> = {};
for (const r of records) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log(JSON.stringify(byKind));
