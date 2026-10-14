//! 合法手の列挙と検証(src/engine/legal.ts)。

use crate::cond::*;
use crate::derive::*;
use crate::procs::plan_play;
use crate::registry::Registry;
use crate::state::*;
use crate::types::*;
use std::rc::Rc;

pub const ENUM_LIMIT: usize = 200;

pub fn legal_actions(s: &State, reg: &Registry) -> Vec<Action> {
    if s.winner != Winner::None {
        return vec![];
    }
    let p = match &s.pending {
        Some(p) => p,
        None => return vec![],
    };
    if p.why == Why::TurnAction {
        return turn_actions(Env { s, reg }, p.player);
    }
    enumerate_answers(p, ENUM_LIMIT).into_iter().map(|value| Action::Answer { id: p.id, value }).collect()
}

// ───────────────────────── ターン中の行動 ─────────────────────────

fn turn_actions(e: Env, player: PlayerId) -> Vec<Action> {
    let s = e.s;
    let mut out: Vec<Action> = Vec::new();
    if s.step == Step::Mana {
        if !s.mana_charged {
            let mut seen: Vec<u16> = Vec::new();
            for &u in &s.players[player as usize].hand {
                let d = s.cards[u as usize].def;
                if seen.contains(&d) {
                    continue;
                }
                seen.push(d);
                out.push(Action::ChargeMana(u));
            }
        }
        out.push(Action::SkipMana);
        return out;
    }
    if s.step == Step::Main {
        let mut seen: Vec<(u16, Zone, i32, Option<PlayExtra>)> = Vec::new();
        for a in play_actions(e, player) {
            if let Action::PlayCard { uid, from, face, extra } = &a {
                let key = (s.cards[*uid as usize].def, from.unwrap_or(Zone::Hand), face.unwrap_or(0), extra.clone());
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key);
            }
            out.push(a);
        }
        out.push(Action::EndMain);
    }
    if s.step == Step::Main || s.step == Step::Attack {
        out.extend(attack_actions(e, player));
        out.push(Action::EndTurn);
    }
    out
}

pub fn attack_actions(e: Env, player: PlayerId) -> Vec<Action> {
    let s = e.s;
    let mut out = Vec::new();
    let o = opp(player);
    for perm in &s.players[player as usize].battle {
        if can_attack(e, perm, &Target::Player) {
            out.push(Action::Attack { attacker: perm.pid, target: Target::Player });
        }
        for t in &s.players[o as usize].battle {
            if can_attack(e, perm, &Target::Creature(t.pid)) {
                out.push(Action::Attack { attacker: perm.pid, target: Target::Creature(t.pid) });
            }
        }
    }
    out
}

/// 使えるカード(召喚・詠唱)の行動を列挙する。各カードの種類・面・進化先・ハイパーエナジーの組み合わせ。
pub fn play_actions(e: Env, player: PlayerId) -> Vec<Action> {
    let s = e.s;
    let mut out = Vec::new();
    for z in [Zone::Hand, Zone::Mana, Zone::Grave] {
        let list: &Vec<i32> = match z {
            Zone::Hand => &s.players[player as usize].hand,
            Zone::Mana => &s.players[player as usize].mana,
            _ => &s.players[player as usize].grave,
        };
        for &uid in list {
            let def = &e.reg.defs[s.cards[uid as usize].def as usize];
            for (fi, face) in def.faces.iter().enumerate() {
                let info = e.reg.info(s.cards[uid as usize].def, fi as i32);
                if z != Zone::Hand {
                    let want_cast = face.ty == FaceType::Spell;
                    let ok = info.permissions.iter().any(|&pi| match &face.abilities[pi as usize] {
                        crate::ast::Ability::Permission { play_cast, from, .. } => *from == z && *play_cast == want_cast,
                        _ => false,
                    });
                    if !ok {
                        continue;
                    }
                }
                for extra in extra_variants(e, player, uid, z, fi as i32) {
                    let plan = plan_play(e, player, uid, z, fi as i32, extra.as_ref(), false);
                    if plan.ok {
                        out.push(Action::PlayCard { uid, from: Some(z), face: Some(fi as i32), extra });
                    }
                }
            }
        }
    }
    out
}

fn extra_variants(e: Env, player: PlayerId, uid: i32, _from: Zone, fi: i32) -> Vec<Option<PlayExtra>> {
    let s = e.s;
    let def = &e.reg.defs[s.cards[uid as usize].def as usize];
    let face = &def.faces[fi as usize];
    let info = e.reg.info(s.cards[uid as usize].def, fi);
    let mut bases: Vec<Option<i32>> = Vec::new();
    if face.ty == FaceType::Evolution {
        for perm in &s.players[player as usize].battle {
            let top = perm.cards[0];
            let cc = CC::new(e, player).with_self(uid).with_it(top, s.cards[top as usize].face);
            if let Some(ef) = &face.evolve_from {
                if eval_cond(&cc, ef) {
                    bases.push(Some(perm.pid));
                }
            }
        }
    } else {
        bases.push(None);
    }
    let mut out: Vec<Option<PlayExtra>> = Vec::new();
    for onto in bases {
        if face.ty == FaceType::Evolution && onto.is_none() {
            continue;
        }
        if !info.hyper_energy {
            out.push(onto.map(|o| PlayExtra { onto: Some(o), tap: None, pay: None }));
            continue;
        }
        // ハイパーエナジー: コストが互いに異なるクリーチャーを j 体タップする代表的な選び方
        let free: Vec<&Perm> = s.players[player as usize].battle.iter().filter(|p| !p.tapped).collect();
        let mut by_cost: Vec<(i32, Vec<&Perm>)> = Vec::new();
        for p in free {
            let cost = chars_of(e, p.cards[0], -1).cost;
            match by_cost.iter_mut().find(|(c, _)| *c == cost) {
                Some((_, l)) => l.push(p),
                None => by_cost.push((cost, vec![p])),
            }
        }
        // 各コストから、価値の低いもの(召喚酔いのもの→パワーの低いもの)を代表にする
        let cmp = |a: &&Perm, b: &&Perm| {
            let sa = is_sick(e, a) as i32;
            let sb = is_sick(e, b) as i32;
            (sb - sa).cmp(&0).then_with(|| chars_of(e, a.cards[0], -1).power.cmp(&chars_of(e, b.cards[0], -1).power))
        };
        let mut reps: Vec<&Perm> = by_cost
            .into_iter()
            .map(|(_, mut l)| {
                l.sort_by(|a, b| cmp(a, b));
                l[0]
            })
            .collect();
        reps.sort_by(|a, b| cmp(a, b));
        let base = cost_of(e, uid, fi, &[], false);
        for j in 0..=reps.len() {
            if j > 0 && base - 2 * (j as i32 - 1) <= 0 {
                break;
            }
            let tap: Vec<i32> = reps[..j].iter().map(|p| p.pid).collect();
            let extra = PlayExtra { onto, tap: Some(tap), pay: None };
            if j == 0 && onto.is_none() {
                out.push(None);
            } else {
                out.push(Some(extra));
            }
        }
    }
    out
}

// ───────────────────────── 回答の列挙・検証 ─────────────────────────

fn combos(items: &[i32], min: i32, max: i32, limit: usize) -> Vec<Vec<i32>> {
    let mut res: Vec<Vec<i32>> = Vec::new();
    fn go(items: &[i32], min: usize, max: usize, limit: usize, start: usize, cur: &mut Vec<i32>, res: &mut Vec<Vec<i32>>) {
        if res.len() >= limit {
            return;
        }
        if cur.len() >= min && cur.len() <= max {
            res.push(cur.clone());
        }
        if cur.len() >= max {
            return;
        }
        for i in start..items.len() {
            cur.push(items[i]);
            go(items, min, max, limit, i + 1, cur, res);
            cur.pop();
            if res.len() >= limit {
                return;
            }
        }
    }
    go(items, min.max(0) as usize, max.max(0) as usize, limit, 0, &mut Vec::new(), &mut res);
    res
}

pub fn enumerate_answers(p: &Pending, limit: usize) -> Vec<Val> {
    let inp = match &p.input {
        Some(i) => i,
        None => return vec![],
    };
    match inp {
        InputSpec::Pick { candidates, min, max } => combos(candidates, *min, *max, limit).into_iter().map(|v| Val::ints(&v)).collect(),
        InputSpec::YesNo => vec![Val::Bool(true), Val::Bool(false)],
        InputSpec::Order { candidates, .. } => candidates.iter().map(|&c| Val::Int(c as i64)).collect(),
        InputSpec::Ack { .. } => vec![Val::Bool(true)],
        InputSpec::Option { options, pick, repeat, all_if, .. } => {
            let n = options.len();
            let mut res: Vec<Vec<i32>> = Vec::new();
            fn go(n: usize, pick: usize, repeat: bool, limit: usize, start: usize, cur: &mut Vec<i32>, res: &mut Vec<Vec<i32>>) {
                if res.len() >= limit {
                    return;
                }
                if cur.len() == pick {
                    res.push(cur.clone());
                    return;
                }
                for i in start..n {
                    cur.push(i as i32);
                    go(n, pick, repeat, limit, if repeat { i } else { i + 1 }, cur, res);
                    cur.pop();
                }
            }
            go(n, (*pick).max(0) as usize, *repeat, limit, 0, &mut Vec::new(), &mut res);
            let mut out: Vec<Val> = res.into_iter().map(|v| Val::ints(&v)).collect();
            if *all_if {
                let all: Vec<i32> = (0..n as i32).collect();
                out.push(Val::ints(&all));
            }
            out
        }
        InputSpec::Assign { items, slots } => enumerate_assign(items, slots, limit),
        InputSpec::Payment { need, mana } => {
            let k = (*need).max(0) as usize;
            vec![Val::ints(&mana[..k.min(mana.len())])]
        }
    }
}

fn enumerate_assign(items: &[i32], slots: &[SlotSpec], limit: usize) -> Vec<Val> {
    let cap: i32 = slots.iter().map(|x| x.count).sum();
    let need = (items.len() as i32).min(cap);
    let mut res: Vec<Vec<Vec<i32>>> = Vec::new();
    let mut cur: Vec<Vec<i32>> = slots.iter().map(|_| Vec::new()).collect();
    fn go(items: &[i32], slots: &[SlotSpec], need: i32, limit: usize, i: usize, assigned: i32, cur: &mut Vec<Vec<i32>>, res: &mut Vec<Vec<Vec<i32>>>) {
        if res.len() >= limit {
            return;
        }
        if i == items.len() {
            if assigned == need {
                res.push(cur.clone());
            }
            return;
        }
        // この札を、どの枠に入れるか(または入れない)
        for (si, sl) in slots.iter().enumerate() {
            if cur[si].len() as i32 >= sl.count {
                continue;
            }
            cur[si].push(items[i]);
            go(items, slots, need, limit, i + 1, assigned + 1, cur, res);
            cur[si].pop();
        }
        if items.len() as i32 - i as i32 - 1 + assigned >= need {
            go(items, slots, need, limit, i + 1, assigned, cur, res);
        }
    }
    go(items, slots, need, limit, 0, 0, &mut cur, &mut res);
    res.into_iter()
        .map(|r| {
            Val::Obj(Rc::new(slots.iter().zip(r.iter()).map(|(sl, v)| (sym(&sl.id), Val::ints(v))).collect()))
        })
        .collect()
}

/// 回答の形式が正しいか(列挙せずに判定)。エラー文字列か None。
pub fn validate_answer(p: &Pending, v: &Val) -> Option<String> {
    let inp = match &p.input {
        Some(i) => i,
        None => return Some("入力を受け付けていません".into()),
    };
    match inp {
        InputSpec::Pick { candidates, min, max } => {
            let a = match v {
                Val::List(_) => v.to_i32s(),
                _ => return Some("配列で答えてください".into()),
            };
            if (a.len() as i32) < *min || a.len() as i32 > *max {
                return Some(format!("{}〜{}個選んでください", min, max));
            }
            let mut u = a.clone();
            u.sort();
            u.dedup();
            if u.len() != a.len() {
                return Some("重複しています".into());
            }
            if !a.iter().all(|x| candidates.contains(x)) {
                return Some("候補にないものを選んでいます".into());
            }
            None
        }
        InputSpec::YesNo => match v {
            Val::Bool(_) => None,
            _ => Some("はい/いいえで答えてください".into()),
        },
        InputSpec::Ack { .. } => None,
        InputSpec::Order { candidates, .. } => match v {
            Val::Int(n) if candidates.contains(&(*n as i32)) => None,
            _ => Some("候補から選んでください".into()),
        },
        InputSpec::Option { options, pick, repeat, all_if, .. } => {
            let a = match v {
                Val::List(_) => v.to_i32s(),
                _ => return Some("配列で答えてください".into()),
            };
            let n = options.len() as i32;
            if !a.iter().all(|x| *x >= 0 && *x < n) {
                return Some("選択肢が範囲外です".into());
            }
            let mut u = a.clone();
            u.sort();
            u.dedup();
            let is_all = *all_if && a.len() as i32 == n && u.len() as i32 == n;
            if is_all {
                return None;
            }
            if a.len() as i32 != *pick {
                return Some(format!("{}個選んでください", pick));
            }
            if !*repeat && u.len() != a.len() {
                return Some("同じものは選べません".into());
            }
            None
        }
        InputSpec::Assign { items, slots } => {
            if !matches!(v, Val::Obj(_)) {
                return Some("割り振りが不正です".into());
            }
            let cap: i32 = slots.iter().map(|x| x.count).sum();
            let need = (items.len() as i32).min(cap);
            let mut all: Vec<i32> = Vec::new();
            for sl in slots {
                let l = v.get(sym(&sl.id)).map(|x| x.to_i32s()).unwrap_or_default();
                if l.len() as i32 > sl.count {
                    return Some(format!("{}は{}枚までです", sl.label, sl.count));
                }
                all.extend(l);
            }
            if let Val::Obj(o) = v {
                for (k, _) in o.iter() {
                    if !slots.iter().any(|x| sym(&x.id) == *k) {
                        return Some("未知の枠です".into());
                    }
                }
            }
            if all.len() as i32 != need {
                return Some(format!("{}枚を割り振ってください", need));
            }
            let mut u = all.clone();
            u.sort();
            u.dedup();
            if u.len() != all.len() {
                return Some("重複しています".into());
            }
            if !all.iter().all(|x| items.contains(x)) {
                return Some("対象外のカードです".into());
            }
            None
        }
        InputSpec::Payment { .. } => match v {
            Val::List(_) => None,
            _ => Some("配列で答えてください".into()),
        },
    }
}

/// 行動が合法かを検証する(エラー文字列か None)
pub fn validate_action(s: &State, reg: &Registry, a: &Action) -> Option<String> {
    if s.winner != Winner::None {
        return Some("ゲームは終了しています".into());
    }
    let p = match &s.pending {
        Some(p) => p,
        None => return Some("入力待ちではありません".into()),
    };
    if let Action::Answer { id, value } = a {
        if p.why == Why::TurnAction {
            return Some("今は回答ではなく行動を選ぶ場面です".into());
        }
        if *id != p.id {
            return Some("古い入力です".into());
        }
        return validate_answer(p, value);
    }
    if p.why != Why::TurnAction {
        return Some("今は回答を求められています".into());
    }
    let e = Env { s, reg };
    let player = p.player;
    match a {
        Action::ChargeMana(uid) => {
            if s.step != Step::Mana || s.mana_charged {
                return Some("今はマナチャージできません".into());
            }
            match s.cards.get(*uid as usize) {
                Some(c) if c.owner == player && c.zone == Zone::Hand => None,
                _ => Some("手札のカードではありません".into()),
            }
        }
        Action::SkipMana => (s.step != Step::Mana).then(|| "今はマナチャージのステップではありません".to_string()),
        Action::EndMain => (s.step != Step::Main).then(|| "今はメインステップではありません".to_string()),
        Action::EndTurn => (!(s.step == Step::Main || s.step == Step::Attack)).then(|| "今はターンを終えられません".to_string()),
        Action::PlayCard { uid, from, face, extra } => {
            if s.step != Step::Main {
                return Some("今はカードを使えません".into());
            }
            let card = match s.cards.get(*uid as usize) {
                Some(c) => c,
                None => return Some("カードがありません".into()),
            };
            let from = from.unwrap_or(Zone::Hand);
            let def = &reg.defs[card.def as usize];
            let fi = face.unwrap_or_else(|| def.faces.iter().position(|f| f.ty != FaceType::Spell).unwrap_or(0) as i32);
            let plan = plan_play(e, player, *uid, from, fi, extra.as_ref(), false);
            if plan.ok {
                None
            } else {
                Some(plan.err.unwrap_or("使えません").to_string())
            }
        }
        Action::Attack { attacker, target } => {
            if s.step != Step::Main && s.step != Step::Attack {
                return Some("今は攻撃できません".into());
            }
            match s.players[player as usize].battle.iter().find(|x| x.pid == *attacker) {
                None => Some("攻撃できるクリーチャーではありません".into()),
                Some(pm) => (!can_attack(e, pm, target)).then(|| "その対象は攻撃できません".to_string()),
            }
        }
        Action::Answer { .. } => None,
    }
}
