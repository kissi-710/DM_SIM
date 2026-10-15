//! 条件・式・セレクタの評価、イベントパターンの照合(src/engine/cond.ts)。

use crate::ast::*;
use crate::derive::*;
use crate::registry::Registry;
use crate::types::*;
use std::rc::Rc;

/// 読み取り専用の環境(状態とレジストリ)
#[derive(Clone, Copy)]
pub struct Env<'a> {
    pub s: &'a State,
    pub reg: &'a Registry,
}

pub struct CC<'a> {
    pub e: Env<'a>,
    pub controller: PlayerId,
    pub self_: Option<i32>,
    pub self_snap: Option<&'a Snap>,
    pub vars: Option<&'a Vars>,
    pub it: Option<i32>,
    /// 判定に使う面。-1 = 面0 / 文明は和集合
    pub it_face: i32,
    pub iter: Option<PlayerId>,
}

impl<'a> CC<'a> {
    pub fn new(e: Env<'a>, controller: PlayerId) -> CC<'a> {
        CC { e, controller, self_: None, self_snap: None, vars: None, it: None, it_face: -1, iter: None }
    }
    pub fn with_self(mut self, uid: i32) -> Self {
        self.self_ = Some(uid);
        self
    }
    pub fn with_it(mut self, uid: i32, face: i32) -> Self {
        self.it = Some(uid);
        self.it_face = face;
        self
    }
    /// $it を差し替えた複製
    pub fn sub(&self, it: i32, face: i32) -> CC<'a> {
        CC { e: self.e, controller: self.controller, self_: self.self_, self_snap: self.self_snap, vars: self.vars, it: Some(it), it_face: face, iter: self.iter }
    }
}

// ───────────────────────── 変数 ─────────────────────────

pub fn get_var(cc: &CC, name: &str) -> Option<Val> {
    if name == "$self" {
        return Some(match cc.self_ {
            None => Val::Null,
            Some(u) => Val::from_ref(ObjRef { uid: u, ep: cc.e.s.cards[u as usize].ep }),
        });
    }
    let mut parts = name.split('.');
    let first = parts.next().unwrap();
    let mut v = cc.vars.and_then(|vs| var_get(vs, sym(first))).cloned()?;
    for p in parts {
        v = match &v {
            Val::Obj(_) => v.get(sym(p)).cloned()?,
            _ => return None,
        };
    }
    Some(v)
}

/// 変数の値を uid の配列にする。ep が合わない参照(別のカードになった)は除外する。
pub fn var_uids(cc: &CC, name: &str, ignore_ep: bool) -> Vec<i32> {
    let v = match get_var(cc, name) {
        None | Some(Val::Null) => return vec![],
        Some(v) => v,
    };
    let items: Vec<Val> = match &v {
        Val::List(l) => l.as_ref().clone(),
        other => vec![other.clone()],
    };
    let mut out = Vec::new();
    for r in items {
        match &r {
            Val::Int(n) => out.push(*n as i32),
            Val::Obj(_) => {
                if let (Some(uid), Some(ep)) = (r.get(s::UID).and_then(|x| x.as_i32()), r.get(s::EP).and_then(|x| x.as_i32())) {
                    if let Some(card) = cc.e.s.cards.get(uid as usize) {
                        if ignore_ep || card.ep == ep {
                            out.push(uid);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out
}

// ───────────────────────── 式 ─────────────────────────

pub fn eval_expr(cc: &CC, e: &Expr) -> i64 {
    match e {
        Expr::Num(n) => *n,
        Expr::Var(name) => match get_var(cc, name) {
            Some(Val::Int(n)) => n,
            Some(Val::List(l)) => l.len() as i64,
            _ => 0,
        },
        Expr::Count(sel) => select_cards(cc, sel).len() as i64,
        Expr::CostOf(name) => {
            if name == "$self" {
                if let Some(sn) = cc.self_snap {
                    return sn.cost as i64;
                }
            }
            let uids = var_uids(cc, name, true);
            if uids.is_empty() {
                return 0;
            }
            cost_base(cc.e, uids[0]) as i64
        }
        Expr::Add(v) => v.iter().map(|x| eval_expr(cc, x)).sum(),
        Expr::Sub(a, b) => eval_expr(cc, a) - eval_expr(cc, b),
        Expr::Min(v) => v.iter().map(|x| eval_expr(cc, x)).min().unwrap_or(0),
        Expr::Max(v) => v.iter().map(|x| eval_expr(cc, x)).max().unwrap_or(0),
    }
}

// ───────────────────────── 条件 ─────────────────────────

fn in_range(n: i64, q: &Range3) -> bool {
    if let Some(l) = q.lte {
        if n > l as i64 {
            return false;
        }
    }
    if let Some(g) = q.gte {
        if n < g as i64 {
            return false;
        }
    }
    if let Some(e) = q.eq {
        if n != e as i64 {
            return false;
        }
    }
    true
}

pub fn eval_cond(cc: &CC, cond: &Cond) -> bool {
    let s = cc.e.s;
    match cond {
        Cond::All(v) => v.iter().all(|x| eval_cond(cc, x)),
        Cond::Any(v) => v.iter().any(|x| eval_cond(cc, x)),
        Cond::Not(c) => !eval_cond(cc, c),
        Cond::True => true,
        Cond::TurnOf(rel) => {
            let who = if *rel == Rel::Self_ { cc.controller } else { opp(cc.controller) };
            s.active == who
        }
        Cond::Shields(q) => {
            let broken = &s.breaking;
            let n = s.players[cc.controller as usize].shield.iter().filter(|u| !broken.contains(u)).count() as i64;
            in_range(n, q)
        }
        Cond::Cmp { l, op, r } => {
            let l = eval_expr(cc, l);
            let r = eval_expr(cc, r);
            match op {
                CmpOp::Lt => l < r,
                CmpOp::Le => l <= r,
                CmpOp::Gt => l > r,
                CmpOp::Ge => l >= r,
                CmpOp::Eq => l == r,
                CmpOp::Ne => l != r,
            }
        }
        Cond::Count { sel, q } => {
            let n = select_cards(cc, sel).len() as i64;
            if let Some(g) = q.gte {
                if n < g as i64 {
                    return false;
                }
            }
            if let Some(l) = q.lte {
                if n > l as i64 {
                    return false;
                }
            }
            if let Some(e) = q.eq {
                if n != e as i64 {
                    return false;
                }
            }
            true
        }
        Cond::FiveCivs(sel) => {
            let mut set: Vec<Civ> = Vec::new();
            for u in select_cards(cc, sel) {
                for civ in chars_lite(cc.e, u, -1).civs.iter() {
                    if !set.contains(civ) {
                        set.push(*civ);
                    }
                }
            }
            set.len() >= 5
        }
        Cond::CivsPresent { sel, civs } => {
            let mut set: Vec<Civ> = Vec::new();
            for u in select_cards(cc, sel) {
                for civ in chars_lite(cc.e, u, -1).civs.iter() {
                    if !set.contains(civ) {
                        set.push(*civ);
                    }
                }
            }
            civs.iter().all(|x| set.contains(x))
        }
        Cond::NonEmpty(name) => !var_uids(cc, name, true).is_empty(),
        Cond::NotInBattle => match cc.self_ {
            None => true,
            Some(me) => {
                let def = s.cards[me as usize].def;
                !s.players[cc.controller as usize].battle.iter().any(|p| s.cards[p.cards[0] as usize].def == def)
            }
        },
        Cond::Logged { pattern, min } => {
            let mut n = 0;
            for ev in &s.turn_log {
                if match_pattern(cc, pattern, ev) {
                    n += 1;
                }
            }
            n >= *min
        }
        Cond::ZoneIs(z) => cc.it.map_or(false, |u| s.cards[u as usize].zone == *z),
        Cond::ExShield => match (cc.it, cc.self_) {
            (Some(it), Some(me)) => {
                let sh = &s.cards[it as usize];
                sh.zone == Zone::Shield && sh.ex && sh.ex_pid == s.cards[me as usize].pid
            }
            _ => false,
        },
        _ => {
            // ここから先は「判定対象のカード $it」を使う条件
            let it = match cc.it {
                Some(i) => i,
                None => return false, // TS 版は例外。ここへ来るのは不正なカード定義だけ
            };
            let ch = chars_of(cc.e, it, cc.it_face);
            match cond {
                Cond::Civ(c) => ch.civs.contains(c),
                Cond::CivsAll(v) => v.iter().all(|x| ch.civs.contains(x)),
                Cond::Multicolor(m) => (ch.civs.len() > 1) == *m,
                Cond::Cost(q) => {
                    if let Some(x) = &q.eq {
                        if ch.cost as i64 != eval_expr(cc, x) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.lt {
                        if !((ch.cost as i64) < eval_expr(cc, x)) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.lte {
                        if !(ch.cost as i64 <= eval_expr(cc, x)) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.gt {
                        if !(ch.cost as i64 > eval_expr(cc, x)) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.gte {
                        if !(ch.cost as i64 >= eval_expr(cc, x)) {
                            return false;
                        }
                    }
                    true
                }
                Cond::Power { lte, gte } => {
                    let p = ch.power;
                    if let Some(l) = lte {
                        if p > *l {
                            return false;
                        }
                    }
                    if let Some(g) = gte {
                        if p < *g {
                            return false;
                        }
                    }
                    true
                }
                Cond::Type(t) => {
                    if *t == SelType::Creature {
                        ch.ty != FaceType::Spell
                    } else {
                        ch.ty == FaceType::Spell
                    }
                }
                Cond::Evolution(e) => ch.ty.is_evo() == *e,
                Cond::Race(r) => ch.races.iter().any(|x| x.contains(r.as_str())),
                Cond::Tapped(t) => {
                    let card = &s.cards[it as usize];
                    if card.zone == Zone::Battle {
                        s.perm(card.pid).map_or(false, |p| p.tapped) == *t
                    } else {
                        card.tapped == *t
                    }
                }
                Cond::SameCivAs(name) => {
                    let refs = var_uids(cc, name, true);
                    if refs.is_empty() {
                        return false;
                    }
                    let civs = chars_lite(cc.e, refs[0], -1).civs;
                    ch.civs.iter().any(|x| civs.contains(x))
                }
                _ => false,
            }
        }
    }
}

// ───────────────────────── セレクタ ─────────────────────────

fn owners_of(cc: &CC, owner: SelOwner) -> Vec<PlayerId> {
    match owner {
        SelOwner::Self_ => vec![cc.controller],
        SelOwner::Opponent => vec![opp(cc.controller)],
        SelOwner::Iter => vec![cc.iter.unwrap_or(cc.controller)],
        SelOwner::Any => vec![cc.controller, opp(cc.controller)],
    }
}

/// セレクタに合うカード(バトルゾーンは山の一番上)の uid を返す。
pub fn select_cards(cc: &CC, sel: &Selector) -> Vec<i32> {
    let s = cc.e.s;
    let except = match &sel.except {
        Some(name) => var_uids(cc, name, true),
        None => vec![],
    };
    let of_list = sel.of.as_ref().map(|name| var_uids(cc, name, false));
    let mut out = Vec::new();
    for owner in owners_of(cc, sel.owner) {
        for z in &sel.zones {
            let list: Vec<i32> = if let Some(of) = &of_list {
                of.iter().copied().filter(|u| s.cards[*u as usize].owner == owner).collect()
            } else {
                match z {
                    Zone::Battle => s.players[owner as usize].battle.iter().map(|p| p.cards[0]).collect(),
                    Zone::Limbo => s.limbo.iter().copied().filter(|u| s.cards[*u as usize].owner == owner).collect(),
                    Zone::Deck => s.players[owner as usize].deck.clone(),
                    Zone::Hand => s.players[owner as usize].hand.clone(),
                    Zone::Mana => s.players[owner as usize].mana.clone(),
                    Zone::Shield => s.players[owner as usize].shield.clone(),
                    Zone::Grave => s.players[owner as usize].grave.clone(),
                    Zone::Hyper => s.players[owner as usize].hyper.clone(),
                }
            };
            for uid in list {
                if except.contains(&uid) {
                    continue;
                }
                if sel.not_self && Some(uid) == cc.self_ {
                    continue;
                }
                let hint = match face_hint(cc, uid, sel.ty) {
                    Some(h) => h,
                    None => continue, // 種類が合わない
                };
                if let Some(w) = &sel.where_ {
                    let sub = cc.sub(uid, hint);
                    if !eval_cond(&sub, w) {
                        continue;
                    }
                }
                if sel.chooseable && *z == Zone::Battle && owner != cc.controller {
                    if let Some(perm) = s.perm(s.cards[uid as usize].pid) {
                        if !can_be_chosen(cc.e, perm, cc.controller) {
                            continue;
                        }
                    }
                }
                out.push(uid);
            }
        }
    }
    out
}

/// セレクタの type に合うか。合うなら判定に使う面(-1=面0)を、合わなければ None を返す。
fn face_hint(cc: &CC, uid: i32, ty: Option<SelType>) -> Option<i32> {
    let s = cc.e.s;
    let card = &s.cards[uid as usize];
    let def = &cc.e.reg.defs[card.def as usize];
    if card.zone == Zone::Battle || card.zone == Zone::Limbo {
        let f = def.faces.get(card.face as usize).unwrap_or(&def.faces[0]);
        return match ty {
            Some(SelType::Spell) => (f.ty == FaceType::Spell).then_some(card.face),
            Some(SelType::Creature) => (f.ty != FaceType::Spell).then_some(card.face),
            _ => Some(card.face),
        };
    }
    match ty {
        None | Some(SelType::Card) => Some(-1),
        Some(t) => {
            let idx = def.faces.iter().position(|f| if t == SelType::Spell { f.ty == FaceType::Spell } else { f.ty != FaceType::Spell });
            idx.map(|i| i as i32)
        }
    }
}

// ───────────────────────── イベントパターン ─────────────────────────

fn rel_ok(want: Option<Rel>, actual: Option<i64>, controller: PlayerId) -> bool {
    match want {
        None | Some(Rel::Any) => true,
        Some(w) => match actual {
            None => false,
            Some(a) => {
                if w == Rel::Self_ {
                    a == controller as i64
                } else {
                    a != controller as i64
                }
            }
        },
    }
}

/// イベント値の「型」(Ev または Obj に入った type)
fn val_type(v: &Val) -> Option<Sym> {
    match v {
        Val::Ev(e) => Some(e.ty),
        Val::Obj(_) => v.get(s::TYPE).and_then(|t| t.as_sym()),
        _ => None,
    }
}

/// イベントがパターンに合うか。owner/controller/player は cc.controller から見た相対('self'/'opponent'/'any')。
pub fn match_pattern(cc: &CC, pat: &Pattern, ev: &Ev) -> bool {
    if pat.ty != ev.ty {
        return false;
    }
    let ev_card = ev.get(s::CARD).and_then(|v| v.as_int());
    if pat.self_ {
        match (ev_card, cc.self_) {
            (Some(a), Some(b)) if a == b as i64 => {}
            _ => return false,
        }
    }
    if let Some(role) = pat.role {
        let key = if ev.ty == s::BLOCKED {
            if role == s::ATTACKER {
                s::ATTACKER_CARD
            } else {
                s::CARD
            }
        } else if ev.ty == s::BATTLE_STARTED || ev.ty == s::AFTER_BATTLE {
            // attacker / defender(バトルの攻撃側 / 攻撃された側)
            if role == s::ATTACKER {
                s::ATTACKER_CARD
            } else {
                s::DEFENDER_CARD
            }
        } else if role == s::WINNER {
            s::WINNER_CARD
        } else {
            s::LOSER_CARD
        };
        match (ev.get(key).and_then(|v| v.as_int()), cc.self_) {
            (Some(a), Some(b)) if a == b as i64 => {}
            _ => return false,
        }
    }
    if let Some(v) = pat.via {
        if ev.sym_of(s::VIA) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.cause {
        if ev.sym_of(s::CAUSE) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.from {
        if ev.sym_of(s::FROM) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.to {
        if ev.sym_of(s::TO) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.kind {
        if ev.sym_of(s::KIND) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.ex {
        let actual = ev.get(s::EX).map_or(false, |x| x.as_bool() == Some(true));
        if actual != v {
            return false;
        }
    }
    if let Some(v) = pat.step {
        if ev.sym_of(s::STEP) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.paid {
        if ev.int(s::PAID) != Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.free {
        let actual = ev.get(s::FREE).map_or(false, |x| x.as_bool() == Some(true));
        if actual != v {
            return false;
        }
    }
    if let Some(v) = pat.cause_type {
        if ev.get(s::CAUSE).and_then(val_type) != Some(v) {
            return false;
        }
    }
    if pat.cause_self {
        // その能力の持ち主(SOURCE)が、原因のイベントのカード自身か
        let cause_card = match ev.get(s::CAUSE) {
            Some(Val::Ev(e)) => e.int(s::CARD),
            Some(v @ Val::Obj(_)) => v.get(s::CARD).and_then(|x| x.as_int()),
            _ => None,
        };
        let src = ev.int(s::SOURCE);
        if src.is_none() || src != cause_card {
            return false;
        }
    }
    if !rel_ok(pat.owner, ev.int(s::OWNER), cc.controller) {
        return false;
    }
    if !rel_ok(pat.player, ev.int(s::PLAYER), cc.controller) {
        return false;
    }
    if !rel_ok(pat.controller, ev.int(s::CONTROLLER), cc.controller) {
        return false;
    }
    if pat.winner.is_some() {
        match ev.int(s::WINNER_OWNER) {
            None => return false,
            Some(w) => {
                if !rel_ok(pat.winner, Some(w), cc.controller) {
                    return false;
                }
            }
        }
    }
    if let Some(ac) = &pat.attacker_cond {
        match ev_card {
            None => return false,
            Some(u) => {
                let sub = cc.sub(u as i32, -1);
                if !eval_cond(&sub, ac) {
                    return false;
                }
            }
        }
    }
    true
}

pub fn rc_snap_of(e: Env, uid: i32) -> Rc<Snap> {
    Rc::new(snap_of(e, uid))
}
