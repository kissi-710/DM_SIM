// ドロップ先マップ: legalActions から「札(ドラッグ元)→ 行き先と行動」の表を作る。ルール判定はせず、合法手を並べ替えるだけ(effects 11.3)。
import { powerOf } from '../engine/derive';
import { expandSameNameActions } from '../engine/legal';
import { mkCtx } from '../engine/state';
import type { Action, GameState } from '../engine/types';
import { cardName, reg } from './format';

export interface Drop {
  dropKey: string;
  action: Action;
  label: string;
}

/**
 * 攻撃先のクリーチャーの表記。名前に、パワー・タップ状態を添える。同名が並んでいる時は左から何体目かも添える
 * (キーボードでは見分けがつかないため)。
 */
export function targetLabel(s: GameState, pid: number): string {
  const owner = [0, 1].find((p) => s.players[p].battle.some((x) => x.pid === pid));
  if (owner === undefined) return 'クリーチャー';
  const row = s.players[owner].battle;
  const idx = row.findIndex((x) => x.pid === pid);
  const pm = row[idx];
  const name = cardName(s, pm.cards[0]);
  const same = row.filter((x) => cardName(s, x.cards[0]) === name).length > 1;
  const power = powerOf(mkCtx(s, reg), pm);
  const notes = [`パワー${power}`, pm.tapped ? 'タップ' : 'アンタップ', same ? `左から${idx + 1}体目` : null].filter(Boolean);
  return `${name}(${notes.join('・')})`;
}

/** ドラッグ元のキー → 行き先 */
export function buildDropMap(s: GameState, legal: Action[]): Map<string, Drop[]> {
  const map = new Map<string, Drop[]>();
  const add = (src: string, d: Drop) => {
    const l = map.get(src) ?? [];
    l.push(d);
    map.set(src, l);
  };
  const N = (u: number) => cardName(s, u);
  // legalActions は同名の札を1枚に間引いているので、他の同名の札にも行き先を付ける
  for (const a of expandSameNameActions(s, reg, legal)) {
    if (a.type === 'CHARGE_MANA') {
      add(`hand:${a.uid}`, { dropKey: 'zone:mana', action: a, label: 'マナチャージ' });
    } else if (a.type === 'PLAY_CARD') {
      const from = a.from ?? 'hand';
      const def = reg.defs[s.cards[a.uid].defId];
      const fi = a.face ?? 0;
      const face = def.faces[fi];
      const isSpell = face.type === 'spell';
      let label = `${isSpell ? '唱える' : '召喚'}: ${face.name}`;
      if (from === 'mana') label += '(マナゾーンから)';
      if (from === 'grave') label += '(墓地から)';
      if (a.extra?.alt) {
        const alt = face.abilities.find((x) => x.kind === 'altCost' && x.id === a.extra!.alt);
        if (alt && alt.kind === 'altCost') label += `(${alt.label})`;
      }
      if (a.extra?.under?.length) label += ` [墓地の${a.extra.under.length}体を下に重ねる]`;
      if (a.extra?.tapAlt?.length) label += ` [クリーチャー${a.extra.tapAlt.length}体をタップ]`;
      if (a.extra?.onto !== undefined) {
        const pm = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === a.extra!.onto);
        if (pm) label += ` → ${N(pm.cards[0])}の上に重ねる`;
      }
      if (a.extra?.tap?.length) {
        const names = a.extra.tap.map((pid) => {
          const pm = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === pid);
          return pm ? N(pm.cards[0]) : '?';
        });
        label += ` [ハイパーエナジー: ${names.join('、')}をタップ]`;
      }
      const dropKey = a.extra?.onto !== undefined ? `pile:${a.extra.onto}` : 'zone:battle';
      add(`${from}:${a.uid}`, { dropKey, action: a, label });
      // 進化は、バトルゾーン全体へのドロップでも選べるようにする
      if (a.extra?.onto !== undefined) add(`${from}:${a.uid}`, { dropKey: 'zone:battle', action: a, label });
    } else if (a.type === 'HYPERIZE') {
      const pm = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === a.pid);
      const taps = a.tap.map((pid) => {
        const t = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === pid);
        return t ? N(t.cards[0]) : '?';
      });
      const name = pm ? N(pm.cards[0]) : 'クリーチャー';
      add(`pile:${a.pid}`, { dropKey: 'zone:battle', action: a, label: `ハイパー化: ${name}${taps.length ? ` [${taps.join('、')}をタップ]` : ''}` });
    } else if (a.type === 'CROSS') {
      const pm = [...s.players[0].battle, ...s.players[1].battle].find((p) => p.pid === a.target);
      add(`pile:${a.gear}`, { dropKey: `pile:${a.target}`, action: a, label: `クロス → ${pm ? N(pm.cards[0]) : 'クリーチャー'}` });
    } else if (a.type === 'ATTACK') {
      const pid = a.attacker;
      if (a.target.kind === 'player') {
        const defender = s.players[0].battle.some((p) => p.pid === pid) ? 1 : 0;
        add(`pile:${pid}`, { dropKey: 'zone:oppShield', action: a, label: `プレイヤーを攻撃(シールド ${s.players[defender].shield.length}枚)` });
      } else {
        const targetPid = a.target.pid;
        add(`pile:${pid}`, { dropKey: `opp-pile:${a.target.pid}`, action: a, label: `${targetLabel(s, targetPid)}を攻撃` });
      }
    }
  }
  return map;
}

/** 選択中のカードの行き先(クリック代替のボタン)を作る */
export function selectedActions(s: GameState, legal: Action[], selected: string | null): Drop[] {
  if (!selected) return [];
  return buildDropMap(s, legal).get(selected) ?? [];
}
