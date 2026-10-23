//! 合法手の列挙と検証(src/engine/legal.ts)。

use crate::cond::*;
use crate::derive::*;
use crate::procs::{plan_play, plan_play_ok};
use crate::registry::{Feat, Registry};
use crate::ast::{Ability, PlayKind};
use crate::state::*;
use crate::types::*;
use std::rc::Rc;

pub const ENUM_LIMIT: usize = 200;

pub fn legal_actions(s: &State, reg: &Registry) -> Vec<Action> {
    crate::prof!(5);
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
    // ブレイクするシールド: 見分けのつく違いごとに1つ(どれを選んでも同じ裏向きのシールドは、探索の分岐に数えない)
    if p.why == Why::PickShield {
        if let Some(InputSpec::Pick { candidates, min, .. }) = &p.input {
            return crate::procs::shield_pick_choices(s, candidates, *min as usize).into_iter().map(|v| Action::Answer { id: p.id, value: Val::ints(&v) }).collect();
        }
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
        out.extend(hyperize_actions(e, player));
        out.extend(cross_actions(e, player));
        out.push(Action::EndMain);
    }
    if s.step == Step::Main || s.step == Step::Attack {
        out.extend(attack_actions(e, player));
        out.push(Action::EndTurn);
    }
    out
}

/// クロスできるクロスギアとクリーチャーの組(クロスギアのコストをもう一度、マナで払えるもの)
pub fn cross_actions(e: Env, player: PlayerId) -> Vec<Action> {
    let s = e.s;
    let mut out = Vec::new();
    let mine = &s.players[player as usize].battle;
    let gears: Vec<&Perm> = mine.iter().filter(|p| chars_lite(e, p.cards[0], -1).ty == FaceType::Crossgear).collect();
    if gears.is_empty() {
        return out;
    }
    let hosts: Vec<&Perm> = mine.iter().filter(|p| chars_lite(e, p.cards[0], -1).ty.is_creature()).collect();
    for g in gears {
        let (cost, civs) = cross_cost(e, g.cards[0]);
        let can_pay = plan_payment(e, player, &civs, pay_need(cost, civs.len() as i32), &[], &[]).is_some();
        for h in &hosts {
            if g.crossed_on == Some(h.pid) {
                continue;
            }
            // コストを支払わずにクロスしてもよい相手(freeCrossTo)なら、マナがなくてもクロスできる
            if can_pay || (game_has(e, Feat::FreeCross) && free_cross_to(e, g.cards[0], h.cards[0])) {
                out.push(Action::Cross { gear: g.pid, target: h.pid });
            }
        }
    }
    out
}

/// ハイパー化できるクリーチャーと、タップする他のクリーチャーの組(ハイパーモード中でないもの)
pub fn hyperize_actions(e: Env, player: PlayerId) -> Vec<Action> {
    let mut out = Vec::new();
    let mine = &e.s.players[player as usize].battle;
    for perm in mine {
        if perm.hyper {
            continue;
        }
        let need = match info_of(e, perm.cards[0]).hyperize {
            Some(n) if n >= 0 => n,
            _ => continue,
        };
        let others: Vec<&Perm> = mine.iter().filter(|p| p.pid != perm.pid && !p.tapped && chars_lite(e, p.cards[0], -1).ty.is_creature()).collect();
        if need == 0 {
            out.push(Action::Hyperize { pid: perm.pid, tap: vec![] });
            continue;
        }
        // need = 1 が通常。2体以上なら、組み合わせの先頭だけ(まれ)
        if need == 1 {
            for o in others {
                out.push(Action::Hyperize { pid: perm.pid, tap: vec![o.pid] });
            }
        } else if others.len() as i32 >= need {
            out.push(Action::Hyperize { pid: perm.pid, tap: others.iter().take(need as usize).map(|p| p.pid).collect() });
        }
    }
    out
}

pub fn attack_actions(e: Env, player: PlayerId) -> Vec<Action> {
    crate::prof!(7);
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
    crate::prof!(6);
    let s = e.s;
    let mut out = Vec::new();
    let zones: &[Zone] = if game_has(e, Feat::AllowPlayFrom) { &[Zone::Hand, Zone::Mana, Zone::Grave, Zone::Hyper, Zone::Deck] } else { &[Zone::Hand, Zone::Mana, Zone::Grave, Zone::Hyper] };
    for &z in zones {
        // 山札から使えるのは、一番上のカードだけ(「山札の上から召喚してもよい」)
        let list: Vec<i32> = match z {
            Zone::Hand => s.players[player as usize].hand.clone(),
            Zone::Mana => s.players[player as usize].mana.clone(),
            Zone::Hyper => s.players[player as usize].hyper.clone(),
            Zone::Deck => s.players[player as usize].deck.iter().take(1).copied().collect(),
            _ => s.players[player as usize].grave.clone(),
        };
        for uid in list {
            let def = &e.reg.defs[s.cards[uid as usize].def as usize];
            for (fi, face) in def.faces.iter().enumerate() {
                let info = e.reg.info(s.cards[uid as usize].def, fi as i32);
                if z != Zone::Hand {
                    let kind = if face.ty == FaceType::Spell { PlayKind::Cast } else if face.ty.is_creature() { PlayKind::Summon } else { PlayKind::Put };
                    let ok = info.permissions.iter().any(|&pi| match &face.abilities[pi as usize] {
                        Ability::Permission { play, from, .. } => *from == z && *play == kind,
                        _ => false,
                    }) || (face.ty.is_creature() && granted_play_from(e, player, uid, fi as i32, z).is_some())
                        || info.alt_costs.iter().any(|&ai| matches!(&face.abilities[ai as usize], Ability::AltCost { cost, .. } if cost.from.as_ref().map_or(false, |fz| fz.contains(&z))));
                    if !ok {
                        continue;
                    }
                }
                for extra in extra_variants(e, player, uid, z, fi as i32) {
                    if plan_play_ok(e, player, uid, z, fi as i32, extra.as_ref(), false) {
                        out.push(Action::PlayCard { uid, from: Some(z), face: Some(fi as i32), extra });
                    }
                }
            }
        }
    }
    out
}

fn extra_variants(e: Env, player: PlayerId, uid: i32, from: Zone, fi: i32) -> Vec<Option<PlayExtra>> {
    let s = e.s;
    let def = &e.reg.defs[s.cards[uid as usize].def as usize];
    let face = &def.faces[fi as usize];
    let info = e.reg.info(s.cards[uid as usize].def, fi);
    // 別のコスト(マナを払うかわりに、手札を捨てる・マナを払わない)は、別の使い方として並べる。使えるかは、呼び出し側が plan_play で調べる
    let mut alts: Vec<PlayExtra> = Vec::new();
    for &ai in &info.alt_costs {
        if let Ability::AltCost { id, cost, .. } = &face.abilities[ai as usize] {
            let owner = s.cards[uid as usize].owner;
            if cost.grave_evolve {
                // 超無限墓地進化: 墓地のクリーチャーを、コストの大きいものから k 体(1 ≤ k)
                let mut g: Vec<i32> = s.players[owner as usize].grave.iter().copied().filter(|&u| chars_lite(e, u, -1).ty.is_creature()).collect();
                g.sort_by(|a, b| cost_base(e, *b).cmp(&cost_base(e, *a)));
                for k in 1..=g.len().min(8) {
                    alts.push(PlayExtra { alt: Some(id.clone()), under: Some(g[..k].to_vec()), ..Default::default() });
                }
            } else if cost.fushigi.is_some() {
                // フシギバース: タップしてマナゾーンに置く自分のクリーチャーごと
                for p in &s.players[owner as usize].battle {
                    if !p.tapped && chars_lite(e, p.cards[0], -1).ty.is_creature() {
                        alts.push(PlayExtra { alt: Some(id.clone()), tap_alt: Some(vec![p.pid]), ..Default::default() });
                    }
                }
            } else {
                alts.push(PlayExtra { alt: Some(id.clone()), ..Default::default() });
            }
        }
    }
    let mut base = extra_variants_base(e, player, uid, from, fi);
    if !alts.is_empty() {
        base.extend(alts.into_iter().map(Some));
    }
    base
}

fn extra_variants_base(e: Env, player: PlayerId, uid: i32, _from: Zone, fi: i32) -> Vec<Option<PlayExtra>> {
    let s = e.s;
    let def = &e.reg.defs[s.cards[uid as usize].def as usize];
    let face = &def.faces[fi as usize];
    let info = e.reg.info(s.cards[uid as usize].def, fi);
    let mut bases: Vec<Option<i32>> = Vec::new();
    if face.ty == FaceType::Evolution {
        for perm in &s.players[player as usize].battle {
            let top = perm.cards[0];
            let mut cc = CC::new(e, player).with_self(uid).with_it(top, s.cards[top as usize].face);
            cc.evo = true;
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
            out.push(onto.map(|o| PlayExtra { onto: Some(o), ..Default::default() }));
            continue;
        }
        // ハイパーエナジー: コストが互いに異なるクリーチャーを j 体タップする代表的な選び方
        let free: Vec<&Perm> = s.players[player as usize].battle.iter().filter(|p| !p.tapped).collect();
        let mut by_cost: Vec<(i32, Vec<&Perm>)> = Vec::new();
        for p in free {
            let cost = chars_lite(e, p.cards[0], -1).cost;
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
            let extra = PlayExtra { onto, tap: Some(tap), ..Default::default() };
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

fn combos(items: &[i32], min: i32, max: i32, limit: usize, sum: Option<&(i32, Vec<i32>)>) -> Vec<Vec<i32>> {
    let mut res: Vec<Vec<i32>> = Vec::new();
    #[allow(clippy::too_many_arguments)]
    fn go(items: &[i32], min: usize, max: usize, limit: usize, start: usize, cur: &mut Vec<i32>, res: &mut Vec<Vec<i32>>, total: i32, sum: Option<&(i32, Vec<i32>)>) {
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
            let t = total + sum.map_or(0, |s| s.1[i]);
            if let Some(s) = sum {
                if t > s.0 {
                    continue;
                }
            }
            cur.push(items[i]);
            go(items, min, max, limit, i + 1, cur, res, t, sum);
            cur.pop();
            if res.len() >= limit {
                return;
            }
        }
    }
    go(items, min.max(0) as usize, max.max(0) as usize, limit, 0, &mut Vec::new(), &mut res, 0, sum);
    res
}

pub fn enumerate_answers(p: &Pending, limit: usize) -> Vec<Val> {
    let inp = match &p.input {
        Some(i) => i,
        None => return vec![],
    };
    match inp {
        InputSpec::Pick { candidates, min, max, sum } => combos(candidates, *min, *max, limit, sum.as_ref()).into_iter().map(|v| Val::ints(&v)).collect(),
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
        InputSpec::Pick { candidates, min, max, sum } => {
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
            if let Some((m, costs)) = sum {
                let total: i32 = a.iter().map(|x| costs[candidates.iter().position(|c| c == x).unwrap_or(0)]).sum();
                if total > *m {
                    return Some(format!("コストの合計は {} 以下にしてください", m));
                }
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
            let fi = face.unwrap_or_else(|| def.faces.iter().position(|f| f.ty.is_creature()).unwrap_or(0) as i32);
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
        Action::Cross { gear, target } => {
            if s.step != Step::Main {
                return Some("今はクロスできません".into());
            }
            let ok = cross_actions(e, player).iter().any(|x| matches!(x, Action::Cross { gear: g, target: t } if g == gear && t == target));
            if ok {
                None
            } else {
                Some("クロスできません".into())
            }
        }
        Action::Hyperize { pid, tap } => {
            if s.step != Step::Main {
                return Some("今はハイパー化できません".into());
            }
            let ok = hyperize_actions(e, player).iter().any(|x| matches!(x, Action::Hyperize { pid: p, tap: t } if p == pid && t.len() == tap.len() && t.iter().all(|y| tap.contains(y))));
            if ok {
                return None;
            }
            // 組み合わせは、先頭だけを列挙している。タップする他のクリーチャーが条件に合えば通す
            let pm = match s.players[player as usize].battle.iter().find(|x| x.pid == *pid) {
                Some(p) if !p.hyper => p,
                _ => return Some("ハイパー化できません".into()),
            };
            let need = match info_of(e, pm.cards[0]).hyperize {
                Some(n) if tap.len() as i32 == n => n,
                _ => return Some("ハイパー化できません".into()),
            };
            let _ = need;
            let mut u = tap.clone();
            u.sort();
            u.dedup();
            if u.len() != tap.len() {
                return Some("ハイパー化できません".into());
            }
            for t in tap {
                match s.players[player as usize].battle.iter().find(|x| x.pid == *t) {
                    Some(tp) if tp.pid != pm.pid && !tp.tapped && chars_lite(e, tp.cards[0], -1).ty.is_creature() => {}
                    _ => return Some("タップできないクリーチャーです".into()),
                }
            }
            None
        }
        Action::Answer { .. } => None,
    }
}
