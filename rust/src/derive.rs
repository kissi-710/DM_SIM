//! 派生ビュー: コスト・パワー・文明・能力・攻撃可否など(src/engine/derive.ts)。状態を書き換えない。

use crate::ast::*;
use crate::cond::*;
use crate::registry::{Face, FaceInfo};
use crate::types::*;
use std::rc::Rc;

pub struct Chars<'a> {
    pub face: &'a Face,
    pub face_idx: i32,
    pub civs: &'a [Civ],
    pub cost: i32,
    pub power: i32,
    pub ty: FaceType,
    pub races: &'a [String],
}

/// カードの特性。hint=-1 のとき、場以外のカードは面0(文明は全面の和集合)で見る。
pub fn chars_of<'a>(e: Env<'a>, uid: i32, hint: i32) -> Chars<'a> {
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let in_play = card.zone == Zone::Battle || card.zone == Zone::Limbo;
    let idx: usize = if in_play {
        if (card.face as usize) < def.faces.len() && card.face >= 0 {
            card.face as usize
        } else {
            0
        }
    } else if hint >= 0 && (hint as usize) < def.faces.len() {
        hint as usize
    } else {
        0
    };
    let face = &def.faces[idx];
    let civs: &[Civ] = if in_play || hint >= 0 { &face.civs } else { &def.union_civs };
    let mut power = face.power.unwrap_or(0);
    if card.zone == Zone::Battle && card.pid >= 0 {
        if let Some(pm) = e.s.perm(card.pid) {
            if pm.cards[0] == uid {
                power = power_of(e, pm);
            }
        }
    }
    Chars { face, face_idx: idx as i32, civs, cost: face.cost, power, ty: face.ty, races: &face.races }
}

/// 表記コスト(使用中の面。場以外は面0)
pub fn cost_base(e: Env, uid: i32) -> i32 {
    chars_of(e, uid, -1).face.cost
}

pub fn info_of<'a>(e: Env<'a>, uid: i32) -> &'a FaceInfo {
    let card = &e.s.cards[uid as usize];
    let ch = chars_of(e, uid, -1);
    e.reg.info(card.def, ch.face_idx)
}

// ───────────────────────── 継続効果 ─────────────────────────

pub struct ActiveStatic<'a> {
    pub src: i32,
    pub controller: PlayerId,
    pub m: &'a StaticMod,
}

/// バトルゾーンの一番上のカードが持つ常在型能力
pub fn active_statics<'a>(e: Env<'a>) -> Vec<ActiveStatic<'a>> {
    let mut out = Vec::new();
    for p in 0..2u8 {
        for perm in &e.s.players[p as usize].battle {
            let uid = perm.cards[0];
            let card = &e.s.cards[uid as usize];
            let info = info_of(e, uid);
            if info.statics.is_empty() {
                continue;
            }
            let face = e.reg.face(card.def, chars_of(e, uid, -1).face_idx);
            for &si in &info.statics {
                if let Ability::Static { m, while_ } = &face.abilities[si as usize] {
                    if let Some(w) = while_ {
                        let cc = CC::new(e, p).with_self(uid);
                        if !eval_cond(&cc, w) {
                            continue;
                        }
                    }
                    out.push(ActiveStatic { src: uid, controller: p, m });
                }
            }
        }
    }
    out
}

// ───────────────────────── パワー・能力 ─────────────────────────

pub fn power_of(e: Env, perm: &Perm) -> i32 {
    let uid = perm.cards[0];
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let face = def.faces.get(card.face as usize).unwrap_or(&def.faces[0]);
    let mut p = face.power.unwrap_or(0);
    let info = e.reg.info(card.def, card.face);
    // 能力は getInfo の面で読む(TS 版は info.statics[].ability をそのまま使う)
    let face_for_abilities = e.reg.face(card.def, card.face);
    for &si in &info.statics {
        if let Ability::Static { m: StaticMod::PowerAdd { n }, while_ } = &face_for_abilities.abilities[si as usize] {
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                    continue;
                }
            }
            p += n;
        }
    }
    for ef in &e.s.effects {
        if ef.pid == perm.pid {
            if let EffectMod::PowerAdd(n) = ef.m {
                p += n;
            }
        }
    }
    p
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kw {
    Blocker,
    SpeedAttacker,
    MachFighter,
    ShieldTrigger,
    JustDiver,
    ExLife,
}

pub fn has_keyword(e: Env, perm: &Perm, kw: Kw) -> bool {
    let uid = perm.cards[0];
    let info = info_of(e, uid);
    let yes = match kw {
        Kw::ShieldTrigger => !info.shield_triggers.is_empty(),
        Kw::Blocker => info.blocker,
        Kw::SpeedAttacker => info.speed_attacker,
        Kw::MachFighter => info.mach_fighter,
        Kw::JustDiver => info.just_diver,
        Kw::ExLife => info.ex_life,
    };
    if yes {
        return true;
    }
    let name = match kw {
        Kw::Blocker => "blocker",
        Kw::SpeedAttacker => "speedAttacker",
        Kw::MachFighter => "machFighter",
        Kw::ShieldTrigger => "shieldTrigger",
        Kw::JustDiver => "justDiver",
        Kw::ExLife => "exLife",
    };
    if e.s.effects.is_empty() {
        return false;
    }
    let ks = sym(name);
    e.s.effects.iter().any(|ef| ef.pid == perm.pid && matches!(ef.m, EffectMod::Grant(k) if k == ks))
}

pub fn breaker_count(e: Env, perm: &Perm) -> i32 {
    let uid = perm.cards[0];
    let card = &e.s.cards[uid as usize];
    let info = info_of(e, uid);
    let face = e.reg.face(card.def, chars_of(e, uid, -1).face_idx);
    let mut n = 1;
    for &bi in &info.breakers {
        if let Ability::Keyword { n: bn, while_, .. } = &face.abilities[bi as usize] {
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                    continue;
                }
            }
            n = n.max(bn.unwrap_or(2));
        }
    }
    n
}

// ───────────────────────── 攻撃・ブロック・選択 ─────────────────────────

pub fn can_be_chosen(e: Env, perm: &Perm, by: PlayerId) -> bool {
    let owner = e.s.cards[perm.cards[0] as usize].owner;
    if owner == by {
        return true;
    }
    !e.s.effects.iter().any(|ef| ef.pid == perm.pid && ef.m == EffectMod::CannotBeChosen)
}

pub fn can_be_attacked(e: Env, perm: &Perm) -> bool {
    !e.s.effects.iter().any(|ef| ef.pid == perm.pid && ef.m == EffectMod::CannotBeAttacked)
}

fn has_effect(e: Env, pid: i32, m: &EffectMod) -> bool {
    e.s.effects.iter().any(|ef| ef.pid == pid && &ef.m == m)
}

/// 相手クリーチャーの「出たターンに自分を攻撃できない」(ガイアッシュ・カイザー)
fn player_attack_blocked_by_entry(e: Env, perm: &Perm, owner: PlayerId) -> bool {
    if perm.entered_turn != e.s.turn {
        return false;
    }
    active_statics(e).iter().any(|st| matches!(st.m, StaticMod::CannotAttackPlayerWhenEntered) && st.controller != owner)
}

/// 召喚酔いか(総合ルール 301.5 / 801.3)。進化クリーチャー(S-MAX進化を含む)は召喚酔いしない。
pub fn is_sick(e: Env, perm: &Perm) -> bool {
    if !perm.sick {
        return false;
    }
    !chars_of(e, perm.cards[0], -1).ty.is_evo()
}

pub fn can_attack(e: Env, perm: &Perm, target: &crate::state::Target) -> bool {
    use crate::state::Target;
    let s = e.s;
    let uid = perm.cards[0];
    let owner = s.cards[uid as usize].owner;
    if perm.tapped {
        return false;
    }
    if has_effect(e, perm.pid, &EffectMod::CannotAttack) {
        return false;
    }
    let speed = has_keyword(e, perm, Kw::SpeedAttacker);
    let mach = has_keyword(e, perm, Kw::MachFighter);
    let sick = is_sick(e, perm);
    if sick && !speed && !mach {
        return false;
    }
    match target {
        Target::Player => {
            if sick && !speed {
                return false; // マッハファイターは出たターン、プレイヤーを攻撃できない
            }
            if player_attack_blocked_by_entry(e, perm, owner) {
                return false;
            }
            true
        }
        Target::Creature(pid) => {
            let (towner, ti) = match s.perm_by_pid(*pid) {
                Some(x) => x,
                None => return false,
            };
            if towner == owner {
                return false;
            }
            let tperm = &s.players[towner as usize].battle[ti];
            if !can_be_attacked(e, tperm) {
                return false;
            }
            if tperm.tapped {
                return true;
            }
            // アンタップ状態のクリーチャーは、出たターンのマッハファイターだけが攻撃できる
            sick && mach
        }
    }
}

pub fn can_block(e: Env, perm: &Perm) -> bool {
    if perm.tapped {
        return false;
    }
    has_keyword(e, perm, Kw::Blocker)
}

// ───────────────────────── コスト ─────────────────────────

/// 召喚・詠唱するカードの最終コスト(0未満にならない)。
pub fn cost_of(e: Env, uid: i32, face_idx: i32, taps: &[i32], free: bool) -> i32 {
    let s = e.s;
    let card = &s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let face = def.faces.get(face_idx as usize).unwrap_or(&def.faces[0]);
    if free {
        return 0;
    }
    let mut cost = face.cost;
    let info = e.reg.info(card.def, face_idx);
    if info.sympathy {
        cost -= s.players[card.owner as usize].mana.len() as i32;
    }
    if info.hyper_energy && !taps.is_empty() {
        cost -= 2 * taps.len() as i32;
    }
    for st in active_statics(e) {
        if let StaticMod::CostDelta { delta, cond } = st.m {
            if st.controller != card.owner {
                continue;
            }
            let cc = CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx);
            if eval_cond(&cc, cond) {
                cost += delta;
            }
        }
    }
    cost.max(0)
}

/// 実際にタップするマナの枚数(文明の数を下回らない)
pub fn pay_need(cost: i32, civ_count: i32) -> i32 {
    cost.max(civ_count).max(0)
}

pub fn mana_civs<'a>(e: Env<'a>, uid: i32) -> &'a [Civ] {
    chars_of(e, uid, -1).civs
}

/// マナの支払いの割り当て。必要な文明ごとに1枚(1枚のマナは1文明)+残りは数値で支払う。
/// 手札の他のカードの文明条件を残しやすいように、価値の低いマナからタップする。払えなければ None。
pub fn plan_payment(e: Env, player: PlayerId, civs: &[Civ], need: i32, exclude: &[i32], keep_for: &[i32]) -> Option<Vec<i32>> {
    let s = e.s;
    if need <= 0 {
        return Some(vec![]);
    }
    let avail: Vec<i32> = s.players[player as usize].mana.iter().copied().filter(|u| !s.cards[*u as usize].tapped && !exclude.contains(u)).collect();
    if (avail.len() as i32) < need {
        return None;
    }
    // 価値(残したいほど高い)
    let mut want = [0i32; 5];
    for &h in keep_for {
        for civ in chars_of(e, h, -1).civs {
            want[*civ as usize] += 1;
        }
    }
    let mut mc: Vec<(i32, &[Civ])> = Vec::with_capacity(avail.len());
    let mut value: Vec<(i32, f64)> = Vec::with_capacity(avail.len());
    for &u in &avail {
        let cs = mana_civs(e, u);
        mc.push((u, cs));
        let mut v = 0.01 * cs.len() as f64;
        for cv in cs {
            v += want[*cv as usize] as f64;
        }
        value.push((u, v));
    }
    let val_of = |u: i32| value.iter().find(|(x, _)| *x == u).unwrap().1;
    let civs_of = |u: i32| mc.iter().find(|(x, _)| *x == u).unwrap().1;
    let mut sorted = avail.clone();
    sorted.sort_by(|a, b| val_of(*a).partial_cmp(&val_of(*b)).unwrap_or(std::cmp::Ordering::Equal));
    // 文明ごとの割り当て(マッチング)。1文明につき、その文明を持つ別々のマナ1枚。
    let k = civs.len();
    let cands: Vec<Vec<i32>> = civs.iter().map(|cv| sorted.iter().copied().filter(|u| civs_of(*u).contains(cv)).collect()).collect();
    if cands.iter().any(|l| l.is_empty()) {
        return None;
    }
    // 解の探索(価値の合計が最小になる割り当て。ノード数に上限)
    let mut order: Vec<usize> = (0..k).collect();
    order.sort_by(|a, b| cands[*a].len().cmp(&cands[*b].len()));
    struct Dfs<'x> {
        cands: &'x [Vec<i32>],
        order: &'x [usize],
        k: usize,
        best: Option<Vec<i32>>,
        best_score: f64,
        nodes: i32,
        chosen: Vec<i32>,
    }
    fn dfs(d: &mut Dfs, i: usize, score: f64, val_of: &dyn Fn(i32) -> f64) {
        d.nodes += 1;
        if d.nodes - 1 > 3000 {
            return;
        }
        if score >= d.best_score {
            return;
        }
        if i == d.k {
            d.best = Some(d.chosen.clone());
            d.best_score = score;
            return;
        }
        let list = &d.cands[d.order[i]];
        for idx in 0..list.len() {
            let u = d.cands[d.order[i]][idx];
            if d.chosen.contains(&u) {
                continue;
            }
            d.chosen.push(u);
            dfs(d, i + 1, score + val_of(u), val_of);
            d.chosen.pop();
        }
    }
    let mut d = Dfs { cands: &cands, order: &order, k, best: None, best_score: f64::INFINITY, nodes: 0, chosen: Vec::new() };
    dfs(&mut d, 0, 0.0, &val_of);
    let mut result: Vec<i32>;
    if let Some(b) = d.best {
        result = b;
    } else {
        // 上限に達して見つからなかった場合の、確実な二部マッチング(増加路)
        let mut match_of: Vec<(i32, usize)> = Vec::new();
        fn try_aug(ci: usize, seen: &mut Vec<i32>, cands: &[Vec<i32>], match_of: &mut Vec<(i32, usize)>) -> bool {
            for &u in &cands[ci] {
                if seen.contains(&u) {
                    continue;
                }
                seen.push(u);
                let cur = match_of.iter().find(|(x, _)| *x == u).map(|(_, c)| *c);
                let ok = match cur {
                    None => true,
                    Some(c) => try_aug(c, seen, cands, match_of),
                };
                if ok {
                    if let Some(e) = match_of.iter_mut().find(|(x, _)| *x == u) {
                        e.1 = ci;
                    } else {
                        match_of.push((u, ci));
                    }
                    return true;
                }
            }
            false
        }
        for i in 0..k {
            let mut seen = Vec::new();
            if !try_aug(i, &mut seen, &cands, &mut match_of) {
                return None;
            }
        }
        result = match_of.iter().map(|(u, _)| *u).collect();
    }
    let total = need.max(k as i32);
    if (avail.len() as i32) < total {
        return None;
    }
    for &u in &sorted {
        if result.len() as i32 >= total {
            break;
        }
        if !result.contains(&u) {
            result.push(u);
        }
    }
    Some(result)
}

// ───────────────────────── 呪文の制限 ─────────────────────────

/// プレイヤーがこの呪文(面)を唱えられるか(ドルファディロムの制限など)
pub fn can_cast(e: Env, player: PlayerId, uid: i32, face_idx: i32) -> bool {
    for st in active_statics(e) {
        if let StaticMod::CannotCast { cond } = st.m {
            if st.controller == player {
                continue; // 「相手は〜できない」
            }
            let cc = CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx);
            if eval_cond(&cc, cond) {
                return false;
            }
        }
    }
    true
}

// ───────────────────────── スナップショット ─────────────────────────

pub fn snap_of(e: Env, uid: i32) -> Snap {
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let in_play = card.zone == Zone::Battle || card.zone == Zone::Limbo;
    let face = if in_play { def.faces.get(card.face as usize).unwrap_or(&def.faces[0]) } else { &def.faces[0] };
    let civs: Rc<Vec<Civ>> = if in_play { face.civs.clone() } else { def.union_civs.clone() };
    Snap {
        uid,
        def: card.def,
        owner: card.owner,
        face: card.face,
        zone: card.zone,
        multicolor: civs.len() > 1,
        civs,
        cost: face.cost,
        power: face.power.unwrap_or(0),
        pid: card.pid,
    }
}
