// 悪手の洗い出し用 Worker: CPU 同士で対局し、判断ごとの直前の局面を教師(多数のラウンド)で評価して、損失を記録する。
import { parentPort } from 'node:worker_threads';
import { CARD_DB, deckCards } from '../src/cards';
import { makeAgent, type AgentSpec } from '../src/ai';
import { legalActions } from '../src/engine/engine';
import { loadRegistry } from '../src/engine/registry';
import type { Action, GameState } from '../src/engine/types';
import { teacherValues, type Position } from '../src/sim/aiEval';
import { playGameSync } from '../src/sim/playGame';
import { installNativeFromEnv } from '../src/wasm/installNode';

installNativeFromEnv();
const reg = loadRegistry(CARD_DB);

export interface BlunderTask {
  games: { deckA: string; deckB: string; seed: number }[];
  spec: AgentSpec;
  rounds: number;
}
export interface Rec {
  seed: number;
  decks: [string, string];
  turn: number;
  who: number;
  why: string;
  n: number;
  regret: number;
  qBest: number;
  qChosen: number;
  chosen: string;
  best: string;
  all: { text: string; q: number }[];
  state: string;
  /** [自分の山札, 相手の山札] の枚数(山札切れに絡む局面は、教師の L1 の続きが不自然になる) */
  deck: [number, number];
}

const nameOfUid = (s: GameState, u: number) => reg.defs[s.cards[u].defId].name;
const topName = (s: GameState, p: number, pid: number) => {
  const perm = s.players[p].battle.find((x) => x.pid === pid);
  return perm ? nameOfUid(s, perm.cards[0]) : '?';
};

function describe(s: GameState, a: Action): string {
  const me = s.pending!.player;
  switch (a.type) {
    case 'CHARGE_MANA':
      return `マナに置く:${nameOfUid(s, a.uid)}`;
    case 'SKIP_MANA':
      return 'マナに置かない';
    case 'PLAY_CARD': {
      const def = reg.defs[s.cards[a.uid].defId];
      const f = def.faces[a.face ?? 0] ?? def.faces[0];
      return `出す:${f.name}${a.from && a.from !== 'hand' ? `(${a.from}から)` : ''}`;
    }
    case 'ATTACK':
      return `攻撃:${topName(s, me, a.attacker)} → ${a.target.kind === 'player' ? 'プレイヤー' : topName(s, 1 - me, a.target.pid)}`;
    case 'END_MAIN':
      return 'メインを終える';
    case 'END_TURN':
      return 'ターンを終える';
    case 'ANSWER': {
      const p = s.pending!;
      const inp = p.input;
      const src = p.source ? nameOfUid(s, p.source.uid) : '';
      let d = JSON.stringify(a.value);
      if (inp && inp.shape === 'yesno') d = a.value ? 'はい' : 'いいえ';
      else if (inp && inp.shape === 'option') d = (a.value as number[]).map((i) => inp.options[i]).join('+');
      else if (inp && inp.shape === 'pick') d = (a.value as number[]).map((u) => nameOfUid(s, u)).join(',') || 'なし';
      return `回答[${p.why}${src ? ':' + src : ''}] ${d}`;
    }
    default:
      return JSON.stringify(a);
  }
}

function summary(s: GameState): string {
  const me = s.pending!.player;
  const side = (p: number) => {
    const z = s.players[p];
    const bf = z.battle.map((x) => `${nameOfUid(s, x.cards[0])}${x.tapped ? '(T)' : ''}`).join(' ');
    return `盾${z.shield.length} 手${z.hand.length} マナ${z.mana.length} 場[${bf}]`;
  };
  const hand = s.players[me].hand.map((u) => nameOfUid(s, u)).join(' ');
  return `T${s.turn} 自分:${side(me)} 手札[${hand}] / 相手:${side(1 - me)}`;
}

parentPort!.on('message', (t: BlunderTask) => {
  try {
    const out: Rec[] = [];
    for (const g of t.games) {
      const agents = [makeAgent(t.spec), makeAgent(t.spec)] as const;
      const pre: { s: GameState; a: Action }[] = [];
      let prev: GameState | null = null;
      playGameSync(reg, [agents[0], agents[1]], {
        decks: [deckCards(g.deckA), deckCards(g.deckB)],
        seed: g.seed,
        first: 0,
        onStep: (s, a) => {
          if (prev && prev.pending && prev.winner === null) pre.push({ s: prev, a });
          prev = s;
        },
      });
      for (const { s, a } of pre) {
        const legal = legalActions(s, reg);
        if (legal.length < 2) continue;
        const pos: Position = { pair: 0, turn: s.turn, state: s };
        const te = teacherValues(reg, pos, { rounds: t.rounds, horizon: 99, seed: g.seed });
        if (te.means.some((m) => Number.isNaN(m))) continue;
        const key = JSON.stringify(a);
        const ci = legal.findIndex((x) => JSON.stringify(x) === key);
        if (ci < 0) continue;
        let bi = 0;
        te.means.forEach((m, i) => {
          if (m > te.means[bi]) bi = i;
        });
        const all = legal.map((x, i) => ({ text: describe(s, x), q: te.means[i] })).sort((x, y) => y.q - x.q);
        out.push({
          seed: g.seed,
          decks: [g.deckA, g.deckB],
          turn: s.turn,
          who: s.pending!.player,
          why: s.pending!.why,
          n: legal.length,
          regret: te.means[bi] - te.means[ci],
          qBest: te.means[bi],
          qChosen: te.means[ci],
          chosen: describe(s, a),
          best: describe(s, legal[bi]),
          all: all.slice(0, 6),
          state: summary(s),
          deck: [s.players[s.pending!.player].deck.length, s.players[1 - s.pending!.player].deck.length],
        });
      }
    }
    parentPort!.postMessage({ ok: true, recs: out });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: String(e) });
  }
});
