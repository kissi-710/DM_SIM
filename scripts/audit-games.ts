// 全デッキの総当たり対局で、エンジンの不変条件を検査し、カードの能力の発火を数える(docs/card-audit.md の A-1・A-2)。
//   npx tsx scripts/audit-games.ts [組ごとの試合数=2] [シード=1] [デッキID,... (既定は全デッキ)]
// 検査: (a) エンジンの例外がない (b) 必ず終局する (c) どのカードも、ちょうど1か所(ゾーン・山・封印・下に重なったカード)にあり、zone と一致する
//       (d) 状態を JSON に往復しても同じ。ずれた対局は scratch/survey/audit-*.json に書き出す(git の管理外)。
// 能力の発火: abilityTriggered(誘発型)の回数を、カード別に集計し、一度も発火しなかった誘発型能力を一覧する。
import { mkdirSync, writeFileSync } from 'node:fs';
import { CARD_DB, DECK_PRESETS, deckCards } from '../src/cards';
import { loadRegistry } from '../src/engine/registry';
import { makeRuleBased } from '../src/ai/rulebased';
import { randomAgent } from '../src/ai/random';
import { playGameSync } from '../src/sim/playGame';
import type { Ev, GameState } from '../src/engine/types';

mkdirSync('scratch/survey', { recursive: true });
const perPair = Number(process.argv[2] ?? 2);
const seed0 = Number(process.argv[3] ?? 1);
const only = process.argv[4] ? process.argv[4].split(',') : null;
const ids = DECK_PRESETS.map((d) => d.id).filter((id) => !only || only.includes(id));
const reg = loadRegistry(CARD_DB);

/** どのカードも、ちょうど1か所にあり、zone が一致するか。ずれがあれば、その説明を返す */
function checkPlacement(s: GameState): string | null {
  const where = new Map<number, string>();
  const put = (u: number, place: string, zone: string | null): string | null => {
    if (u < 0 || u >= s.cards.length) return `範囲外の uid ${u} (${place})`;
    if (where.has(u)) return `uid ${u}(${s.cards[u].defId}) が2か所: ${where.get(u)} と ${place}`;
    where.set(u, place);
    if (zone !== null && s.cards[u].zone !== zone) return `uid ${u}(${s.cards[u].defId}) の zone=${s.cards[u].zone} だが、${place} にある`;
    return null;
  };
  for (const p of [0, 1] as const) {
    const z = s.players[p];
    for (const zone of ['deck', 'hand', 'mana', 'shield', 'grave', 'hyper'] as const) {
      for (const u of z[zone]) {
        const e = put(u, `p${p}.${zone}`, zone);
        if (e) return e;
      }
    }
    for (const perm of z.battle) {
      for (const u of perm.cards) {
        const e = put(u, `p${p}.battle#${perm.pid}`, 'battle');
        if (e) return e;
      }
      for (const u of perm.seals ?? []) {
        const e = put(u, `p${p}.seal#${perm.pid}`, null);
        if (e) return e;
      }
    }
  }
  for (const u of s.limbo) {
    const e = put(u, 'limbo', 'limbo');
    if (e) return e;
  }
  for (const [top, under] of Object.entries(s.piles ?? {})) {
    for (const u of under) {
      const e = put(u, `pile#${top}`, 'shield');
      if (e) return e;
    }
  }
  if (where.size !== s.cards.length) {
    const lost = s.cards.map((c, u) => (where.has(u) ? null : `${u}:${c.defId}:${c.zone}`)).filter((x) => x);
    return `${lost.length} 枚が、どこにもない: ${lost.slice(0, 4).join(', ')}`;
  }
  return null;
}

const fired = new Map<string, number>();
let games = 0;
let bad = 0;
const t0 = Date.now();
const report = (kind: string, a: string, b: string, seed: number, msg: string, extra?: unknown) => {
  bad++;
  console.log(`${kind} ${a} vs ${b} seed=${seed}: ${msg}`);
  if (extra) writeFileSync(`scratch/survey/audit-${kind}-${a}-${b}-${seed}.json`, JSON.stringify(extra));
};

for (const a of ids) {
  for (const b of ids) {
    for (let k = 0; k < perPair; k++) {
      const seed = seed0 * 1000 + k;
      // 偶数番目はルールベース同士、奇数番目はランダム同士(ランダムは、思わぬ選択の組み合わせを試す)
      const rule = k % 2 === 0;
      const agents = rule ? ([makeRuleBased({}), makeRuleBased({})] as const) : ([randomAgent, randomAgent] as const);
      games++;
      let placementError: string | null = null;
      let lastStep = 0;
      try {
        const r = playGameSync(CARD_DB, [agents[0], agents[1]], {
          decks: [deckCards(a), deckCards(b)],
          seed,
          first: k % 4 < 2 ? 0 : 1,
          maxSteps: 6000,
          onStep: (s, _act, events: Ev[]) => {
            lastStep++;
            for (const e of events) {
              if (e.type === 'abilityTriggered' && e.ability) {
                const key = `${e.ability.defId}#${e.ability.face}.${e.ability.idx}`;
                fired.set(key, (fired.get(key) ?? 0) + 1);
              }
            }
            if (placementError === null && s.pending !== null && lastStep % 3 === 0) placementError = checkPlacement(s);
          },
        });
        if (placementError) report('PLACE', a, b, seed, placementError);
        else if (r.winner === null) report('NOFINISH', a, b, seed, `終局しない(${r.steps} 手。pending=${JSON.stringify(r.state.pending)?.slice(0, 160)})`);
        else {
          const back = JSON.parse(JSON.stringify(r.state));
          if (JSON.stringify(back) !== JSON.stringify(r.state)) report('JSON', a, b, seed, '状態が JSON で往復できない');
        }
      } catch (e) {
        report('ERR', a, b, seed, String((e as Error).message).slice(0, 200));
      }
    }
  }
}

// 誘発型能力のうち、一度も発火しなかったもの
const never: string[] = [];
let total = 0;
for (const [id, def] of Object.entries(reg.defs)) {
  if (!id.startsWith('dm26sd1-')) continue;
  def.faces.forEach((f, fi) => {
    f.abilities.forEach((ab, idx) => {
      if (ab.kind !== 'trigger') return;
      total++;
      if (!fired.has(`${id}#${fi}.${idx}`)) never.push(`${id} ${def.name} 面${fi} 能力${idx}`);
    });
  });
}
console.log(`対局 ${games} 件(デッキ ${ids.length}×${ids.length}×${perPair}) 異常 ${bad} 件 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
console.log(`25の王道の誘発型能力 ${total} 個のうち、一度も発火しなかったもの ${never.length} 個`);
for (const n of never) console.log('  未発火: ' + n);
