//! 条件・式・セレクタの評価、イベントパターンの照合(src/engine/cond.ts)。

use crate::ast::*;
use crate::derive::*;
use crate::registry::{Feat, Registry};
use crate::types::*;
use std::rc::Rc;

/// 読み取り専用の環境(状態とレジストリ)
#[derive(Clone, Copy)]
pub struct Env<'a> {
    pub s: &'a State,
    pub reg: &'a Registry,
}

/// この対局のデッキに、その機能を持つカードがあるか(TS 版の gameHas)
#[inline]
pub fn game_has(e: Env, f: Feat) -> bool {
    e.s.feats & (1u64 << (f as u32)) != 0
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
    /// 誘発の原因になったイベント($eventCard 用)
    pub event: Option<&'a Ev>,
    /// 進化元を調べている(シンカライズのタマシードを、クリーチャーとして扱う)
    pub evo: bool,
}

/// クロスギア(uid)がクロスしているクリーチャーの山。クロスされていなければ(クロス先が場を離れていても)None
pub fn cross_host_of<'a>(e: Env<'a>, gear: i32) -> Option<&'a Perm> {
    let s = e.s;
    let card = &s.cards[gear as usize];
    if card.zone != Zone::Battle {
        return None;
    }
    let (gp_owner, gi) = s.perm_by_pid(card.pid)?;
    let gp = &s.players[gp_owner as usize].battle[gi];
    let host = gp.crossed_on?;
    let (ho, hi) = s.perm_by_pid(host)?;
    if ho == gp_owner {
        Some(&s.players[ho as usize].battle[hi])
    } else {
        None
    }
}

impl<'a> CC<'a> {
    pub fn new(e: Env<'a>, controller: PlayerId) -> CC<'a> {
        CC { e, controller, self_: None, self_snap: None, vars: None, it: None, it_face: -1, iter: None, event: None, evo: false }
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
        CC { e: self.e, controller: self.controller, self_: self.self_, self_snap: self.self_snap, vars: self.vars, it: Some(it), it_face: face, iter: self.iter, event: self.event, evo: self.evo }
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
    if name == "$ev.card" {
        // 誘発したイベントのカード(いまのゾーンで参照する。呪文を唱えた後に墓地にある、など)
        let ev = cc.event;
        return Some(match ev.and_then(|e| e.int(s::CARD)) {
            Some(u) => Val::from_ref(ObjRef { uid: u as i32, ep: cc.e.s.cards[u as usize].ep }),
            None => Val::Null,
        });
    }
    if name == "$eventCard" {
        // 誘発の原因になったイベントのカード(出たクリーチャーなど)。出た後に別の山になっていれば無効
        let ev = cc.event?;
        let uid = ev.int(s::CARD)? as i32;
        let card = cc.e.s.cards.get(uid as usize)?;
        if let Some(pid) = ev.int(s::PID) {
            if card.pid as i64 != pid {
                return Some(Val::Null);
            }
        }
        return Some(Val::from_ref(ObjRef { uid, ep: card.ep }));
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
        Expr::Mul(v) => v.iter().fold(1i64, |a, x| a * eval_expr(cc, x)),
        Expr::Len(name) => var_uids(cc, name, true).len() as i64,
        Expr::EvLen(k) => match cc.event.and_then(|ev| ev.get(*k)) {
            Some(Val::List(l)) => l.len() as i64,
            _ => 0,
        },
        Expr::Distinct(sel) => {
            let mut set: Vec<i32> = Vec::new();
            for u in select_cards(cc, sel) {
                let c = cost_base(cc.e, u);
                if !set.contains(&c) {
                    set.push(c);
                }
            }
            set.len() as i64
        }
        Expr::Under(name) => {
            let uids = var_uids(cc, name, true);
            if uids.is_empty() {
                return 0;
            }
            let card = &cc.e.s.cards[uids[0] as usize];
            if card.zone != Zone::Battle {
                return 0;
            }
            match cc.e.s.perm(card.pid) {
                Some(p) => (p.cards.len() as i64 - 1).max(0),
                None => 0,
            }
        }
        Expr::PowerOf(name) => {
            let uids = var_uids(cc, name, true);
            if uids.is_empty() {
                0
            } else {
                chars_of(cc.e, uids[0], -1).power as i64
            }
        }
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
        Cond::Shields { q, opponent } => {
            let broken = &s.breaking;
            let who = if *opponent { opp(cc.controller) } else { cc.controller };
            let n = s.players[who as usize].shield.iter().filter(|u| !broken.contains(u)).count() as i64;
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
                for civ in mana_civs(cc.e, u).iter() {
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
                for civ in mana_civs(cc.e, u).iter() {
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
        Cond::Logged { pattern, min, since } => {
            let mut n = 0;
            let mut from = 0;
            if let Some(sn) = since {
                for i in (0..s.turn_log.len()).rev() {
                    if s.turn_log[i].ty == *sn {
                        from = i + 1;
                        break;
                    }
                }
            }
            for ev in &s.turn_log[from..] {
                if match_pattern(cc, pattern, ev) {
                    n += 1;
                }
            }
            n >= *min
        }
        Cond::Some { var, where_ } => var_uids(cc, var, true).into_iter().any(|u| eval_cond(&cc.sub(u, -1), where_)),
        Cond::IsSelf => cc.it.is_some() && cc.it == cc.self_,
        Cond::FaceUp => cc.it.map_or(false, |u| s.cards[u as usize].up),
        Cond::AltUsed(id) => cc.self_.map_or(false, |me| s.usage_get(&UKey::Other(format!("alt:{}:{}", me, id))) == Some(s.turn as i64)),
        Cond::NameHas(t) => cc.it.map_or(false, |u| cc.e.reg.defs[s.cards[u as usize].def as usize].name.contains(t.as_str())),
        Cond::OnBase(c) => {
            let base = cc.event.and_then(|ev| ev.get(s::BASE)).and_then(|v| v.as_list()).and_then(|l| l.first()).and_then(|x| x.as_i32());
            match base {
                Some(b) => eval_cond(&cc.sub(b, -1), c),
                None => false,
            }
        }
        Cond::PowerRank { max, of } => {
            let it = match cc.it {
                Some(i) => i,
                None => return false,
            };
            let powers: Vec<i32> = select_cards(cc, of).into_iter().map(|u| chars_of(cc.e, u, -1).power).collect();
            if powers.is_empty() {
                return false;
            }
            let want = if *max { *powers.iter().max().unwrap() } else { *powers.iter().min().unwrap() };
            chars_of(cc.e, it, -1).power == want
        }
        Cond::AllSame { var, where_ } => {
            let uids = var_uids(cc, var, true);
            if uids.is_empty() {
                return false;
            }
            let cost0 = cost_base(cc.e, uids[0]);
            uids.iter().all(|&u| cost_base(cc.e, u) == cost0 && where_.as_ref().map_or(true, |w| eval_cond(&cc.sub(u, -1), w)))
        }
        Cond::EventIs(kv) => match cc.event {
            Some(ev) => kv.iter().all(|(k, v)| ev.get(*k) == Some(v)),
            None => false,
        },
        Cond::HasCip => {
            let it = match cc.it {
                Some(i) => i,
                None => return false,
            };
            let cd = &s.cards[it as usize];
            let fi = if cc.it_face >= 0 { cc.it_face } else if cd.zone == Zone::Battle || cd.zone == Zone::Limbo { cd.face } else { 0 };
            let face = cc.e.reg.face(cd.def, fi);
            cc.e.reg.info(cd.def, fi).triggers.iter().any(|&ti| match &face.abilities[ti as usize] {
                Ability::Trigger { spec, gen, .. } => {
                    !*gen && spec.subject == Some(Subject::Self_) && spec.on.iter().any(|p| p.ty == s::ENTERED && p.via.is_none())
                }
                _ => false,
            })
        }
        Cond::Hyper => match cc.self_ {
            Some(me) if s.cards[me as usize].zone == Zone::Battle => s.perm(s.cards[me as usize].pid).map_or(false, |p| p.hyper),
            _ => false,
        },
        Cond::StUsed => match cc.event {
            Some(ev) if ev.ty == s::CAST || ev.ty == s::ENTERED => {
                let card = ev.int(s::CARD).unwrap_or(-1);
                s.usage_get(&UKey::Other(format!("st:{}", card))) == Some(ev.id as i64)
            }
            _ => false,
        },
        Cond::CfgKiyonaga => s.cfg.kiyonaga_leftover_on_fail,
        Cond::Unused(key) => cc.self_.map_or(true, |me| s.usage_get(&UKey::Other(format!("once:{}:{}", me, key))).is_none()),
        Cond::Ultimate(b) => match cc.it {
            Some(it) => cc.e.reg.defs[s.cards[it as usize].def as usize].faces.iter().any(|f| f.ultimate) == *b,
            None => false,
        },
        Cond::Twin(b) => match cc.it {
            Some(it) => (cc.e.reg.defs[s.cards[it as usize].def as usize].faces.len() >= 2) == *b,
            None => false,
        },
        Cond::DistinctCosts(var) => {
            let uids = var_uids(cc, var, true);
            if uids.len() < 2 {
                return false;
            }
            // ツインパクトカードは、好きな方のコストを参照できる(公式Q&A 45933)。どちらかを選んで、すべて異なるコストにできるか
            let options: Vec<Vec<i32>> = uids
                .iter()
                .map(|&u| {
                    let card = &cc.e.s.cards[u as usize];
                    if card.zone == Zone::Battle || card.zone == Zone::Limbo {
                        vec![cost_base(cc.e, u)]
                    } else {
                        let mut v: Vec<i32> = Vec::new();
                        for f in &cc.e.reg.defs[card.def as usize].faces {
                            if !v.contains(&f.cost) {
                                v.push(f.cost);
                            }
                        }
                        v
                    }
                })
                .collect();
            fn assign(options: &[Vec<i32>], i: usize, used: &mut Vec<i32>) -> bool {
                if i == options.len() {
                    return true;
                }
                for &cost in &options[i] {
                    if used.contains(&cost) {
                        continue;
                    }
                    used.push(cost);
                    if assign(options, i + 1, used) {
                        return true;
                    }
                    used.pop();
                }
                false
            }
            assign(&options, 0, &mut Vec::new())
        }
        Cond::Crossed(b) => match cc.self_ {
            Some(me) => cross_host_of(cc.e, me).is_some() == *b,
            None => false,
        },
        Cond::HostIs(c) => match cc.self_ {
            Some(me) => match cross_host_of(cc.e, me) {
                Some(host) => {
                    let top = host.cards[0];
                    eval_cond(&cc.sub(top, s.cards[top as usize].face), c)
                }
                None => false,
            },
            None => false,
        },
        Cond::HasGear => match cc.self_ {
            Some(me) => match s.perm(s.cards[me as usize].pid) {
                Some(sp) => s.players[s.cards[me as usize].owner as usize].battle.iter().any(|g| g.crossed_on == Some(sp.pid)),
                None => false,
            },
            None => false,
        },
        Cond::OwnedBy(rel) => match cc.it {
            Some(it) => (s.cards[it as usize].owner == cc.controller) == (*rel == Rel::Self_),
            None => false,
        },
        Cond::BaseFor(var) => {
            let it = match cc.it {
                Some(i) => i,
                None => return false,
            };
            let evo_uid = match var_uids(cc, var, true).first() {
                Some(u) => *u,
                None => return false,
            };
            let evo_def = &cc.e.reg.defs[s.cards[evo_uid as usize].def as usize];
            let ef = match evo_def.faces.iter().find_map(|f| f.evolve_from.as_ref()) {
                Some(x) => x,
                None => return false,
            };
            let sub = CC { e: cc.e, controller: cc.controller, self_: Some(evo_uid), self_snap: cc.self_snap, vars: cc.vars, it: Some(it), it_face: s.cards[it as usize].face, iter: cc.iter, event: cc.event, evo: true };
            eval_cond(&sub, ef)
        }
        Cond::HasKw(kw) => {
            let it = match cc.it {
                Some(i) => i,
                None => return false,
            };
            let hc = &s.cards[it as usize];
            if hc.zone == Zone::Battle {
                let k = if *kw == sym("blocker") {
                    Kw::Blocker
                } else if *kw == s::KW_SPEED_ATTACKER {
                    Kw::SpeedAttacker
                } else if *kw == s::KW_MACH_FIGHTER {
                    Kw::MachFighter
                } else {
                    Kw::Slayer
                };
                return match s.perm(hc.pid) {
                    Some(p) => has_keyword(cc.e, p, k),
                    None => false,
                };
            }
            // バトルゾーン以外(手札など): そのカードの(クリーチャー面の)能力に、そのキーワードがあるか
            let hdef = &cc.e.reg.defs[hc.def as usize];
            match hdef.faces.iter().position(|x| x.ty != FaceType::Spell) {
                Some(hfi) => {
                    let info = cc.e.reg.info(hc.def, hfi as i32);
                    if *kw == sym("blocker") {
                        info.blocker
                    } else if *kw == s::KW_SPEED_ATTACKER {
                        info.speed_attacker
                    } else if *kw == s::KW_MACH_FIGHTER {
                        info.mach_fighter
                    } else if *kw == s::KW_SLAYER {
                        info.slayer
                    } else {
                        false
                    }
                }
                None => false,
            }
        }
        Cond::SelfTapped(t) => match cc.self_ {
            Some(me) => {
                let sp = s.perm(s.cards[me as usize].pid);
                sp.map_or(false, |p| s.cards[me as usize].zone == Zone::Battle && p.tapped == *t)
            }
            None => false,
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
            // パワーを見る条件だけ、常在型能力・継続効果を含むパワーを計算する(他の条件は基本の特性だけ)
            let ch = if matches!(cond, Cond::Power(_) | Cond::PowerLtSelf) { chars_of(cc.e, it, cc.it_face) } else { chars_lite(cc.e, it, cc.it_face) };
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
                Cond::Power(q) => {
                    let p = ch.power as i64;
                    if let Some(x) = &q.lte {
                        if p > eval_expr(cc, x) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.gte {
                        if p < eval_expr(cc, x) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.lt {
                        if !(p < eval_expr(cc, x)) {
                            return false;
                        }
                    }
                    if let Some(x) = &q.gt {
                        if !(p > eval_expr(cc, x)) {
                            return false;
                        }
                    }
                    true
                }
                Cond::PowerLtSelf => cc.self_.map_or(false, |me| ch.power < chars_of(cc.e, me, -1).power),
                Cond::Type(t) => {
                    if cc.evo && *t == SelType::Creature && ch.ty == FaceType::Tamaseed {
                        let cd = &s.cards[it as usize];
                        if cd.zone == Zone::Battle && cc.e.reg.info(cd.def, cd.face).shinkalize {
                            return true;
                        }
                    }
                    matches_type(ch.ty, *t)
                }
                Cond::Evolution(e) => ch.ty.is_evo() == *e,
                Cond::Race(r) => {
                    // ツインパクトは、バトルゾーン以外ではどちらの面の種族も持つ
                    let card = &s.cards[it as usize];
                    if cc.it_face < 0 && card.zone != Zone::Battle && card.zone != Zone::Limbo {
                        return cc.e.reg.defs[card.def as usize].faces.iter().any(|f| f.races.iter().any(|x| race_matches(x, r)));
                    }
                    ch.races.iter().any(|x| race_matches(x, r))
                }
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

/// 種族の一致。種族名に want を含めば一致とする(「コマンド」は「アーマード・ドラゴン」などの複合名の一部にも当たる)。
/// ただし「ドラゴンギルド」は、ドラゴンとは別の種族なので、「ドラゴン」には当たらない。
fn race_matches(race: &str, want: &str) -> bool {
    const GUILD: &str = "ドラゴンギルド";
    if want.contains(GUILD) {
        race.contains(want)
    } else {
        race.replace(GUILD, "").contains(want)
    }
}

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
                if of_list.is_some() && s.cards[uid as usize].zone != *z {
                    continue; // 変数のカードのうち、そのゾーンに今あるものだけ
                }
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
                        if !can_be_chosen(cc.e, perm, cc.controller, cc.self_) {
                            continue;
                        }
                    }
                }
                out.push(uid);
            }
        }
    }
    // 「相手がクリーチャーを選ぶなら、可能ならこのクリーチャーを選ぶ」(同期の妖精)
    if sel.chooseable && out.len() > 1 && game_has(cc.e, Feat::MustBeChosen) {
        let taunt: Vec<i32> = out
            .iter()
            .copied()
            .filter(|&u| {
                let cd = &s.cards[u as usize];
                cd.zone == Zone::Battle && cd.owner != cc.controller && info_of(cc.e, u).statics.iter().any(|&si| matches!(&cc.e.reg.face(cd.def, chars_lite(cc.e, u, -1).face_idx).abilities[si as usize], Ability::Static { m: StaticMod::MustBeChosen, .. }))
            })
            .collect();
        if !taunt.is_empty() {
            return taunt;
        }
    }
    out
}

/// 面の種類が、条件・セレクタの type に合うか('element' = 呪文以外のバトルゾーンのカード)
pub fn matches_type(t: FaceType, want: SelType) -> bool {
    match want {
        SelType::Creature => t.is_creature(),
        SelType::Spell => t == FaceType::Spell,
        SelType::Element => t != FaceType::Spell,
        SelType::Card => true,
        SelType::Tamaseed => t == FaceType::Tamaseed,
        SelType::Field => t == FaceType::Field,
        SelType::Crossgear => t == FaceType::Crossgear,
        SelType::Castle => t == FaceType::Castle,
    }
}

/// セレクタの type に合うか。合うなら判定に使う面(-1=面0)を、合わなければ None を返す。
fn face_hint(cc: &CC, uid: i32, ty: Option<SelType>) -> Option<i32> {
    let s = cc.e.s;
    let card = &s.cards[uid as usize];
    let def = &cc.e.reg.defs[card.def as usize];
    if card.zone == Zone::Battle || card.zone == Zone::Limbo {
        let f = def.faces.get(card.face as usize).unwrap_or(&def.faces[0]);
        return match ty {
            None | Some(SelType::Card) => Some(card.face),
            // バトルゾーンでは、条件つきでタマシードとして扱うカード(ヘラクレス)の今の種類で見る
            Some(t) => matches_type(if f.tamaseed_unless.is_some() { chars_lite(cc.e, uid, -1).ty } else { f.ty }, t).then_some(card.face),
        };
    }
    match ty {
        None | Some(SelType::Card) => Some(-1),
        Some(t) => {
            let idx = def.faces.iter().position(|f| matches_type(f.ty, t));
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
    // beforeBreak など: 攻撃しているのが、この能力の発生源自身
    if pat.self_attacker {
        match cc.self_ {
            Some(me) if ev.int(s::ATTACKER) == Some(cc.e.s.cards[me as usize].pid as i64) => {}
            _ => return false,
        }
    }
    if let Some(v) = pat.not_via {
        if ev.sym_of(s::VIA) == Some(v) {
            return false;
        }
    }
    if let Some(v) = pat.target_kind {
        let tk = ev.get(s::TARGET).and_then(|t| t.get(s::KIND)).and_then(|k| k.as_sym());
        if tk != Some(v) {
            return false;
        }
    }
    // 攻撃先が、この能力の発生源自身(クリーチャー)
    if pat.target_self {
        let tg = ev.get(s::TARGET);
        let ok = match (tg, cc.self_) {
            (Some(t), Some(me)) => t.get(s::KIND).and_then(|k| k.as_sym()) == Some(s::CREATURE) && t.get(s::PID).and_then(|p| p.as_int()) == Some(cc.e.s.cards[me as usize].pid as i64),
            _ => false,
        };
        if !ok {
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
    if let Some(v) = pat.up {
        let actual = ev.get(s::UP).map_or(false, |x| x.as_bool() == Some(true));
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
    if let Some(v) = pat.broke {
        let actual = ev.get(sym("broke")).map_or(false, |x| x.as_bool() == Some(true));
        if actual != v {
            return false;
        }
    }
    // クロスギアをクロスしているクリーチャーが攻撃する時
    if pat.host_attacker {
        let ok = match cc.self_ {
            Some(me) => match cross_host_of(cc.e, me) {
                Some(host) => ev.int(s::ATTACKER) == Some(host.pid as i64),
                None => false,
            },
            None => false,
        };
        if !ok {
            return false;
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
    // イベントのカード(出た・唱えた・離れたカードなど)が満たす条件
    if let Some(c) = &pat.cond {
        match ev_card {
            None => return false,
            Some(u) => {
                let face = ev.int(s::FACE).map_or(-1, |f| f as i32);
                if !eval_cond(&cc.sub(u as i32, face), c) {
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
