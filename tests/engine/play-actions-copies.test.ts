// playActions の skipCopies(同じゾーンの同名の札は最初の 1 枚だけ調べる)が、間引き後の一覧を変えないこと。
// 同名の札は区別がないので、使えるかどうかも同じはず、という前提の検査。全デッキの組・ランダム/ルールベースの対局で、
// 毎手の合法手の列挙を、skipCopies の有無で比べる。
import { describe, expect, it } from 'vitest';
import { CARD_DB, DECK_PRESETS, deckCards } from '../../src/cards';
import { makeAgent } from '../../src/ai';
import { mkCtx } from '../../src/engine/state';
import { playActionKey, playActions } from '../../src/engine/legal';
import { loadRegistry } from '../../src/engine/registry';
import { playGameSync } from '../../src/sim/playGame';
import type { GameState } from '../../src/engine/types';

const reg = loadRegistry(CARD_DB);

/** 同名の間引き(turnActions と同じ規則: 最初に現れたものを残す)後の一覧 */
function thinned(s: GameState, skipCopies: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of playActions(mkCtx(s, reg), s.pending!.player, skipCopies)) {
    const k = playActionKey(s, a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(`${k}#${a.uid}`);
  }
  return out;
}

describe('playActions の skipCopies', () => {
  it('全デッキの組・対局の毎手で、間引き後の一覧(札の uid まで)が同じ', () => {
    let checked = 0;
    let games = 0;
    let withCopies = 0;
    for (const da of DECK_PRESETS) {
      for (const db of DECK_PRESETS) {
        for (const kind of ['random', 'rule', 'random', 'rule'] as const) {
          games++;
          playGameSync(reg, [makeAgent({ kind }), makeAgent({ kind })], {
            decks: [deckCards(da.id), deckCards(db.id)],
            seed: 11 + games,
            onStep: (s) => {
              if (s.winner !== null || !s.pending || s.pending.why !== 'turnAction' || s.step !== 'main') return;
              const p = s.players[s.pending.player];
              const names = [...p.hand, ...p.mana, ...p.grave].map((u) => s.cards[u].defId);
              if (new Set(names).size < names.length) withCopies++;
              expect(thinned(s, true)).toEqual(thinned(s, false));
              checked++;
            },
          });
        }
      }
    }
    expect(checked).toBeGreaterThan(1500);
    expect(withCopies).toBeGreaterThan(300); // 同名の札が複数ある場面が、十分に含まれている
  });
});
