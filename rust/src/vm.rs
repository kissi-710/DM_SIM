//! 効果のインタプリタ(src/engine/vm.ts)。フレームは pc と vars だけを持ち、再開できる。

use crate::ast::*;
use crate::cond::*;
use crate::ops::*;
use crate::derive::{can_summon_card, cost_base, deck_locked, snap_of};
use crate::state::{target_from_val, target_to_val};
use crate::registry::{Feat, Instr};
use crate::types::*;
use std::collections::HashSet;
use std::rc::Rc;

fn cc_of<'a>(e: Env<'a>, f: &'a EffectFrame) -> CC<'a> {
    let iter = var_get(&f.vars, s::ITER).and_then(|v| v.as_int()).map(|n| n as u8);
    CC {
        e,
        controller: f.controller,
        self_: Some(f.source.uid),
        self_snap: Some(&f.lki),
        vars: Some(&f.vars),
        it: None,
        it_face: -1,
        iter,
        event: f.trigger.as_deref(),
        evo: false,
    }
}

fn obj_ref(c: &Ctx, uid: i32) -> ObjRef {
    ObjRef { uid, ep: c.s.cards[uid as usize].ep }
}

fn refs_of(c: &Ctx, uids: &[i32]) -> Vec<ObjRef> {
    uids.iter().map(|&u| obj_ref(c, u)).collect()
}

fn resolve_sel(cc: &CC, sel: &SelOrVar) -> Vec<i32> {
    match sel {
        SelOrVar::Var(name) => var_uids(cc, name, false),
        SelOrVar::Sel(s) => select_cards(cc, s),
    }
}

fn player_of(f: &EffectFrame, who: Who) -> PlayerId {
    match who {
        Who::Opponent => opp(f.controller),
        // forPlayers の現在のプレイヤー
        Who::Iter => var_get(&f.vars, s::ITER).and_then(|v| v.as_int()).map_or(f.controller, |n| n as u8),
        Who::Controller => f.controller,
    }
}

/// 創造面(クリーチャー面)のインデックス。呪文のみなら -1
fn creature_face(c: &Ctx, uid: i32) -> i32 {
    let def = &c.reg.defs[c.s.cards[uid as usize].def as usize];
    def.faces.iter().position(|x| x.ty.is_permanent()).map_or(-1, |i| i as i32)
}

fn spell_face(c: &Ctx, uid: i32) -> i32 {
    let def = &c.reg.defs[c.s.cards[uid as usize].def as usize];
    def.faces.iter().position(|x| x.ty == FaceType::Spell).map_or(-1, |i| i as i32)
}

/// 実行を1命令進める。フレームが終われば true(呼び出し側が pop する)。
pub fn run_effect(c: &mut Ctx, fi: usize) -> Res<bool> {
    crate::prof!(20);
    let id = c.s.cont[fi].id();
    // 同じ id の空のフレームと入れ替えて取り出す(pop の整合性検査を通すため。複製しない)
    let placeholder = Frame::Proc(ProcFrame { id, caused_by: None, name: ProcName::Sba, stage: 0, vars: Vec::new() });
    let mut f = match std::mem::replace(&mut c.s.cont[fi], placeholder) {
        Frame::Effect(f) => f,
        other => {
            c.s.cont[fi] = other;
            return fail("効果フレームではありません");
        }
    };
    let r = run_effect_inner(c, &mut f);
    c.s.cont[fi] = Frame::Effect(f);
    r
}

fn run_effect_inner(c: &mut Ctx, f: &mut EffectFrame) -> Res<bool> {
    let prog = c.reg.program(f.ability, f.no_optional);
    let ins = match prog.get(f.pc) {
        Some(i) => i,
        None => return Ok(true),
    };
    match ins {
        Instr::Act(act) => {
            exec_act(c, f, act)?;
            f.pc += 1;
            Ok(false)
        }
        Instr::Select(st) => {
            exec_select(c, f, st)?;
            f.pc += 1;
            Ok(false)
        }
        Instr::May { no } => {
            match plan_may(c, f, &prog, f.pc) {
                MayPlan::Skip(empties) => {
                    // 使っても何も起きない: 聞かずに使わない側へ(本体が空にするはずだった変数は、空にしておく)
                    for v in empties {
                        var_set(&mut f.vars, v, Val::refs(&[]));
                    }
                    f.pc = *no;
                }
                MayPlan::Pick { candidates, max } => {
                    // 「使うか」と「どれを対象にするか」を1問に: 選べば使う、選ばなければ使わない
                    let ans = ask(
                        c,
                        NeedInput {
                            player: f.controller,
                            why: Why::May,
                            input: Some(InputSpec::Pick { candidates, min: 0, max: max as i32, sum: None }),
                            source: Some(f.source),
                        },
                    )?;
                    let picked = ans.to_i32s();
                    if picked.is_empty() {
                        f.pc = *no;
                    } else if let Some(Instr::Select(st)) = prog.get(f.pc + 1) {
                        bind_picked(c, f, st, &picked, f.controller);
                        f.pc += 2; // may と、それに続く select を済ませた
                    } else {
                        return fail("may の後ろに select がありません");
                    }
                }
                MayPlan::Ask => {
                    let ans = ask(c, NeedInput { player: f.controller, why: Why::May, input: Some(InputSpec::YesNo), source: Some(f.source) })?;
                    f.pc = if ans.as_bool() == Some(true) { f.pc + 1 } else { *no };
                }
            }
            Ok(false)
        }
        Instr::Jmp(to) => {
            f.pc = *to;
            Ok(false)
        }
        Instr::Jf { cond, to } => {
            let ok = {
                let cc = cc_of(c.env(), f);
                eval_cond(&cc, cond)
            };
            f.pc = if ok { f.pc + 1 } else { *to };
            Ok(false)
        }
        Instr::Modes { step, key, key_i, next, .. } => {
            let all = match &step.all_if {
                Some(cnd) => {
                    let cc = cc_of(c.env(), f);
                    eval_cond(&cc, cnd)
                }
                None => false,
            };
            let who = if step.who == Who::Opponent { opp(f.controller) } else { f.controller };
            // 見てから選べるように、この能力で見て、まだ山札にあるカードを示す
            let seen: Vec<i32> = if who == f.controller {
                var_get(&f.vars, s::SEEN).map(|v| v.to_i32s()).unwrap_or_default().into_iter().filter(|u| c.s.cards[*u as usize].zone == Zone::Deck).collect()
            } else {
                vec![]
            };
            let ans = ask(
                c,
                NeedInput {
                    player: who,
                    why: Why::Modes,
                    input: Some(InputSpec::Option {
                        options: step.labels.clone(),
                        pick: step.pick,
                        repeat: step.repeat,
                        all_if: all,
                        seen: if seen.is_empty() { None } else { Some(seen) },
                    }),
                    source: Some(f.source),
                },
            )?;
            // 能力の文章の上に書かれたものから順に解決する(spec 3.12)
            let mut sel = ans.to_i32s();
            sel.sort();
            var_set(&mut f.vars, *key, Val::ints(&sel));
            var_set(&mut f.vars, *key_i, Val::Int(0));
            f.pc = *next;
            Ok(false)
        }
        Instr::ModesNext { key, key_i, starts, end } => {
            let list = var_get(&f.vars, *key).map(|v| v.to_i32s()).unwrap_or_default();
            let i = var_get(&f.vars, *key_i).and_then(|v| v.as_int()).unwrap_or(0) as usize;
            if i >= list.len() {
                f.pc = *end;
            } else {
                var_set(&mut f.vars, *key_i, Val::Int(i as i64 + 1));
                f.pc = starts[list[i] as usize];
            }
            Ok(false)
        }
        Instr::EachInit { in_var, key, key_list } => {
            // 処理する対象は開始時点で確定する(本体でカードを動かしても、後ろの要素を飛ばさない)
            let uids = {
                let cc = cc_of(c.env(), f);
                var_uids(&cc, in_var, false)
            };
            let refs = refs_of(c, &uids);
            var_set(&mut f.vars, *key_list, Val::refs(&refs));
            var_set(&mut f.vars, *key, Val::Int(0));
            f.pc += 1;
            Ok(false)
        }
        Instr::EachNext { as_, key, key_list, end } => {
            let list: Vec<Val> = var_get(&f.vars, *key_list).and_then(|v| v.as_list().cloned()).unwrap_or_default();
            let mut i = var_get(&f.vars, *key).and_then(|v| v.as_int()).unwrap_or(0) as usize;
            // 先の反復で別のゾーンへ動いた(参照が古くなった)ものは処理しない
            while i < list.len() {
                let r = list[i].as_ref();
                match r {
                    Some(r) if c.s.cards.get(r.uid as usize).map(|cd| cd.ep) == Some(r.ep) => break,
                    _ => i += 1,
                }
            }
            if i >= list.len() {
                f.pc = *end;
            } else {
                var_set(&mut f.vars, *key, Val::Int(i as i64 + 1));
                var_set(&mut f.vars, *as_, list[i].clone());
                f.pc += 1;
            }
            Ok(false)
        }
        Instr::RepeatInit { times, key } => {
            let n = {
                let cc = cc_of(c.env(), f);
                eval_expr(&cc, times)
            };
            var_set(&mut f.vars, *key, Val::Int(n));
            f.pc += 1;
            Ok(false)
        }
        Instr::RepeatNext { key, end } => {
            let n = var_get(&f.vars, *key).and_then(|v| v.as_int()).unwrap_or(0);
            if n <= 0 {
                f.pc = *end;
            } else {
                var_set(&mut f.vars, *key, Val::Int(n - 1));
                f.pc += 1;
            }
            Ok(false)
        }
        Instr::SetIter(which) => {
            // ターンプレイヤーから順に(0 = ターンプレイヤー)
            let p = if *which == 0 { c.s.active } else { opp(c.s.active) };
            var_set(&mut f.vars, s::ITER, Val::Int(p as i64));
            f.pc += 1;
            Ok(false)
        }
        Instr::Custom(h) => fail(format!("未対応のカスタム処理: {}", h)),
    }
}

// ───────────────────────── select ─────────────────────────

/// select の候補・選ぶ枚数(上限・下限は候補の数に丸めた後)・選ぶ人(src/engine/vm.ts の selectInfo)
struct SelInfo {
    cand: Vec<i32>,
    min: i64,
    max: i64,
    chooser: PlayerId,
    /// コストの合計の上限つきで好きな数を選ぶ時の上限
    sum_max: Option<i64>,
}

fn select_info(c: &Ctx, f: &EffectFrame, st: &SelectStep) -> SelInfo {
    let (cand, min0, max0, sum_max) = {
        let cc = cc_of(c.env(), f);
        let cand = match &st.from {
            SelOrVar::Var(name) => var_uids(&cc, name, false),
            SelOrVar::Sel(sel) => select_cards(&cc, sel),
        };
        let min0 = st.min.as_ref().map_or(1, |e| eval_expr(&cc, e));
        let max0 = st.max.as_ref().map_or(1, |e| eval_expr(&cc, e));
        let sum_max = st.sum_lte.as_ref().map(|e| eval_expr(&cc, e));
        (cand, min0, max0, sum_max)
    };
    let chooser: PlayerId = match st.who {
        Who::Opponent => opp(f.controller),
        Who::Iter => var_get(&f.vars, s::ITER).and_then(|v| v.as_int()).map_or(f.controller, |n| n as u8),
        Who::Controller => f.controller,
    };
    if sum_max.is_some() {
        // コストの合計の上限つきで、好きな数を選ぶ
        let n = cand.len() as i64;
        return SelInfo { cand, min: 0, max: n, chooser, sum_max };
    }
    let max = max0.min(cand.len() as i64);
    let min = min0.min(max);
    SelInfo { cand, min, max, chooser, sum_max: None }
}

/// 選んだカードを変数に束ね、ログ用の chosen を出す(select と、may に統合した選択で共通)
fn bind_picked(c: &mut Ctx, f: &mut EffectFrame, st: &SelectStep, picked: &[i32], chooser: PlayerId) {
    let refs = refs_of(c, picked);
    let val = if st.append {
        let mut items: Vec<Val> = match var_get(&f.vars, st.as_) {
            Some(Val::List(l)) => l.as_ref().clone(),
            _ => Vec::new(),
        };
        items.extend(refs.iter().map(|r| Val::from_ref(*r)));
        Val::List(Rc::new(items))
    } else {
        Val::refs(&refs)
    };
    var_set(&mut f.vars, st.as_, val);
    if !picked.is_empty() {
        // 選んだものの公開(相手が選んだものなど)は、ログのためにイベントにする
        emit(
            c,
            s::CHOSEN,
            vec![(s::CARDS, Val::ints(picked)), (s::BY, Val::Int(chooser as i64)), (s::SOURCE, Val::Int(f.source.uid as i64))],
        );
    }
}

/// 参照として数える項目名。ここに入る数値だけが、カードの uid・山の pid として扱われる
fn is_ref_key(k: Sym) -> bool {
    k == s::UID || k == s::PID || k == s::CARD || k == s::CARDS || k == s::BASE || k == s::SOURCE || k == s::ATTACKER || k == s::ATTACKER_CARD || k == s::BLOCKER
}

fn collect_ev(e: &Ev, out: &mut HashSet<i64>) {
    for (k, x) in &e.f {
        collect_refs(x, is_ref_key(*k), out);
    }
}

fn collect_refs(v: &Val, flag: bool, out: &mut HashSet<i64>) {
    match v {
        Val::Int(n) => {
            if flag {
                out.insert(*n);
            }
        }
        Val::List(l) => {
            for x in l.iter() {
                collect_refs(x, flag, out);
            }
        }
        Val::Obj(o) => {
            for (k, x) in o.iter() {
                collect_refs(x, is_ref_key(*k), out);
            }
        }
        Val::Ev(e) => collect_ev(e, out),
        Val::Snap(sn) => {
            out.insert(sn.uid as i64);
            out.insert(sn.pid as i64);
        }
        _ => {}
    }
}

/// 変数の値(配列は uid の列として、オブジェクトは中の参照として数える)
fn collect_var_refs(vars: &Vars, out: &mut HashSet<i64>) {
    for (_, x) in vars {
        collect_refs(x, matches!(x, Val::List(_)), out);
    }
}

fn frame_refs(src: ObjRef, lki: &Snap, vars: &Vars, trigger: Option<&Ev>, out: &mut HashSet<i64>) {
    out.insert(src.uid as i64);
    out.insert(lki.uid as i64);
    out.insert(lki.pid as i64);
    collect_var_refs(vars, out);
    if let Some(e) = trigger {
        collect_ev(e, out);
    }
}

/// 進行中の処理(スタック・待機中の誘発・今ターンの出来事・継続効果など)が、名指しで覚えているカードと山。
/// 同名のカードのうちこれに載っているものは、他の同名と同じ扱いにできない(src/engine/vm.ts の referencedIds)。
fn referenced_ids(c: &Ctx, f: &EffectFrame) -> HashSet<i64> {
    let s = &c.s;
    let mut out = HashSet::new();
    frame_refs(f.source, &f.lki, &f.vars, f.trigger.as_deref(), &mut out);
    for fr in &s.cont {
        match fr {
            Frame::Effect(ef) => frame_refs(ef.source, &ef.lki, &ef.vars, ef.trigger.as_deref(), &mut out),
            Frame::Proc(pf) => collect_var_refs(&pf.vars, &mut out),
        }
    }
    for e in &s.pool {
        frame_refs(e.source, &e.lki, &Vec::new(), e.event.as_deref(), &mut out);
    }
    for ev in &s.turn_log {
        collect_ev(ev, &mut out);
    }
    for e in &s.effects {
        if let Duration::Source { uid, .. } = e.until {
            out.insert(uid as i64);
        }
    }
    for &u in &s.breaking {
        out.insert(u as i64);
    }
    out
}

/// 候補のどれを選んでも、その後の結果が同じか(同じ持ち主・同じゾーン・同名・同じ状態)。
/// 同じなら、どれを選ぶかは聞かない(docs/effects.md 11.6)。不確かな時は false(聞く側に倒す)。
/// 山札(順序が結果を変える)・見えないカード('?')・処理の中で名指しされているカードは同じと見なさない。
pub fn interchangeable(c: &Ctx, f: &EffectFrame, cand: &[i32]) -> bool {
    if cand.len() < 2 {
        return false;
    }
    let s = &c.s;
    let a = &s.cards[cand[0] as usize];
    if Some(a.def) == c.reg.def_index("?") || a.zone == Zone::Deck || a.zone == Zone::Limbo {
        return false;
    }
    for &u in cand {
        let x = &s.cards[u as usize];
        if x.def != a.def || x.zone != a.zone || x.owner != a.owner || x.face != a.face {
            return false;
        }
        if x.tapped != a.tapped || x.ex != a.ex || (x.ex && x.ex_pid != a.ex_pid) || x.up != a.up {
            return false;
        }
    }
    let refs = referenced_ids(c, f);
    if cand.iter().any(|&u| refs.contains(&(u as i64))) {
        return false;
    }
    if a.zone == Zone::Battle {
        let first = match s.perm(a.pid) {
            Some(p) => p,
            None => return false,
        };
        for &u in cand {
            let pm = match s.perm(s.cards[u as usize].pid) {
                Some(p) => p,
                None => return false,
            };
            if pm.cards.len() != 1 || pm.cards[0] != u {
                return false;
            }
            if pm.tapped != first.tapped || pm.sick != first.sick || pm.entered_turn != first.entered_turn {
                return false;
            }
            if refs.contains(&(pm.pid as i64)) || s.effects.iter().any(|e| e.pid == pm.pid) {
                return false;
            }
        }
    }
    true
}

fn exec_select(c: &mut Ctx, f: &mut EffectFrame, st: &SelectStep) -> Res<()> {
    let SelInfo { cand, min, max, chooser, sum_max } = select_info(c, f, st);
    let n = cand.len() as i64;
    let picked: Vec<i32>;
    if let Some(sm) = sum_max {
        // 合計に収まる組み合わせが1通り(何も選ばない)しかなければ、聞かない
        let costs: Vec<i32> = cand.iter().map(|&u| cost_base(c.env(), u)).collect();
        if costs.iter().all(|&x| (x as i64) > sm) {
            picked = vec![];
        } else {
            let ans = ask(
                c,
                NeedInput {
                    player: chooser,
                    why: Why::Select,
                    input: Some(InputSpec::Pick { candidates: cand.clone(), min: 0, max: n as i32, sum: Some((sm as i32, costs)) }),
                    source: Some(f.source),
                },
            )?;
            picked = ans.to_i32s();
        }
    } else if max == 0 {
        picked = vec![];
    } else if st.random {
        let mut pool = cand.clone();
        let mut p = Vec::new();
        while (p.len() as i64) < max && !pool.is_empty() {
            let i = c.s.rng_int(pool.len());
            p.push(pool.remove(i));
        }
        picked = p;
    } else if min == n {
        picked = cand.clone();
    } else if min == max && interchangeable(c, f, &cand) {
        // 何枚選ぶかが決まっていて、どれを選んでも同じ: 聞かずに先頭から
        picked = cand[..min as usize].to_vec();
    } else {
        let ans = ask(
            c,
            NeedInput {
                player: chooser,
                why: Why::Select,
                input: Some(InputSpec::Pick { candidates: cand.clone(), min: min as i32, max: max as i32, sum: None }),
                source: Some(f.source),
            },
        )?;
        picked = ans.to_i32s();
    }
    bind_picked(c, f, st, &picked, chooser);
    Ok(())
}

// ───────────────────────── 任意効果(may)の聞き方 ─────────────────────────

/// 任意効果の聞き方(src/engine/vm.ts の MayPlan)
enum MayPlan {
    /// 使っても何も起きない。聞かずに「使わない」へ。本体が空にするはずだった変数
    Skip(Vec<Sym>),
    /// 本体の最初の select と1問にまとめる(0枚 = 使わない)
    Pick { candidates: Vec<i32>, max: i64 },
    /// 従来どおり「使いますか?」
    Ask,
}

/// 対象が空だと何も起きない原始操作の、対象と(あれば)結果の変数
fn inert_target(act: &Act) -> Option<(&SelOrVar, Option<Sym>)> {
    match act {
        Act::Move { sel, as_, .. } => Some((sel, *as_)),
        Act::Put { sel, as_, .. } | Act::Summon { sel, as_, .. } => Some((sel, *as_)),
        Act::Tap { sel } | Act::Untap { sel } => Some((sel, None)),
        Act::AddEffect { sel, .. } | Act::CastFree { sel, .. } => Some((sel, None)),
        _ => None,
    }
}

/// may の本体(prog[from] 〜 prog[end))を実行しても、状態が何も変わらないか(src/engine/vm.ts の inertBody)。
/// 分からない命令が出たら None(= 聞く)。変わらない時は、本体が空にする変数を返す。
fn inert_body(c: &Ctx, f: &EffectFrame, prog: &[Instr], from: usize, end: usize) -> Option<Vec<Sym>> {
    let cc = cc_of(c.env(), f);
    let mut empties: Vec<Sym> = Vec::new();
    let mut pc = from;
    while pc < end {
        match &prog[pc] {
            Instr::Select(st) => {
                if !select_info(c, f, st).cand.is_empty() {
                    return None;
                }
                if (!st.append || empties.contains(&st.as_) || var_uids(&cc, &st.as_.name(), false).is_empty()) && !empties.contains(&st.as_) {
                    empties.push(st.as_);
                }
                pc += 1;
            }
            Instr::Act(act) => {
                let (sel, as_) = inert_target(act)?;
                let none = match sel {
                    SelOrVar::Var(name) => empties.contains(&sym(name)) || var_uids(&cc, name, false).is_empty(),
                    SelOrVar::Sel(sl) => select_cards(&cc, sl).is_empty(),
                };
                if !none {
                    return None;
                }
                if let Some(v) = as_ {
                    if !empties.contains(&v) {
                        empties.push(v);
                    }
                }
                pc += 1;
            }
            Instr::Jf { cond: Cond::NonEmpty(v), to } => {
                // 空なら条件は成り立たない(eval_cond の NonEmpty と同じく、世代は見ない)
                if !(empties.contains(&sym(v)) || var_uids(&cc, v, true).is_empty()) {
                    return None;
                }
                pc = *to;
            }
            Instr::Jmp(to) => {
                if *to <= pc {
                    return None;
                }
                pc = *to;
            }
            _ => return None,
        }
    }
    Some(empties)
}

fn plan_may(c: &Ctx, f: &EffectFrame, prog: &[Instr], pc: usize) -> MayPlan {
    let no = match prog.get(pc) {
        Some(Instr::May { no }) => *no,
        _ => return MayPlan::Ask,
    };
    if let Some(empties) = inert_body(c, f, prog, pc + 1, no) {
        return MayPlan::Skip(empties);
    }
    if let Some(Instr::Select(st)) = prog.get(pc + 1) {
        if pc + 1 < no && !st.random {
            let info = select_info(c, f, st);
            // 「ちょうど1枚(1〜n 枚)選ぶ」で、選ぶのは自分。0枚を選べる select や、他人が選ぶものは統合しない
            if info.chooser == f.controller && !info.cand.is_empty() && info.min == 1 {
                // 1枚だけ選ぶ時、同じものしか無ければ代表の1枚だけを示す
                let candidates = if info.max == 1 && interchangeable(c, f, &info.cand) { vec![info.cand[0]] } else { info.cand };
                return MayPlan::Pick { candidates, max: info.max };
            }
        }
    }
    MayPlan::Ask
}

// ───────────────────────── 原始操作 ─────────────────────────

fn duration_of(c: &Ctx, f: &EffectFrame, until: UntilKind) -> Duration {
    match until {
        UntilKind::EndOfTurn => Duration::EndOfTurn { turn: c.s.turn },
        UntilKind::NextTurnStart => Duration::UntilTurnStart { player: f.controller, after_turn: c.s.turn },
        UntilKind::Source => Duration::Source { uid: f.source.uid, ep: f.source.ep },
        // 次の、相手のターンの終わりまで(いまが自分のターンなら次のターン、相手のターン中ならその次の相手のターン)
        UntilKind::OppTurnEnd => Duration::UntilOppTurnEnd { player: f.controller, after_turn: c.s.turn },
        // 「次の、相手のターンの終わりまで」: 自分のターン中なら次のターン、相手のターン中ならそのターン
        UntilKind::NextOpponentTurnEnd => Duration::EndOfTurn { turn: if c.s.active == f.controller { c.s.turn + 1 } else { c.s.turn } },
    }
}

fn ack_all(c: &mut Ctx, f: &EffectFrame, shown: &[i32]) -> Res<()> {
    for p in 0..2u8 {
        if c.s.cfg.ack_reveals[p as usize] {
            ask(c, NeedInput { player: p, why: Why::Ack, input: Some(InputSpec::Ack { shown: shown.to_vec() }), source: Some(f.source) })?;
        }
    }
    Ok(())
}

fn exec_act(c: &mut Ctx, f: &mut EffectFrame, act: &Act) -> Res<()> {
    match act {
        Act::Draw { n, who } => {
            let n = {
                let cc = cc_of(c.env(), f);
                eval_expr(&cc, n)
            };
            let p = player_of(f, *who);
            draw_cards(c, p, n)?;
            Ok(())
        }
        Act::Move { sel, to, cause, pos, tapped, as_, no_replace } => {
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            let mut o = MoveOpts::new(*to, *cause);
            o.pos = *pos;
            o.tapped = tapped.unwrap_or(false);
            o.by = Some(f.controller);
            o.no_replace = *no_replace;
            let res = move_cards(c, &uids, &o)?;
            if let Some(a) = as_ {
                let refs: Vec<ObjRef> = res.iter().filter(|r| r.moved && r.to == *to).map(|r| ObjRef { uid: r.uid, ep: r.ep }).collect();
                var_set(&mut f.vars, *a, Val::refs(&refs));
            }
            Ok(())
        }
        Act::MoveTop { who, n, to, cause, tapped, as_ } => {
            let p = player_of(f, *who);
            let n = {
                let cc = cc_of(c.env(), f);
                eval_expr(&cc, n)
            } as usize;
            let top: Vec<i32> = c.s.players[p as usize].deck.iter().take(n).copied().collect();
            let mut o = MoveOpts::new(*to, *cause);
            o.tapped = tapped.unwrap_or(false);
            let res = move_cards(c, &top, &o)?;
            if let Some(a) = as_ {
                let refs: Vec<ObjRef> = res.iter().filter(|r| r.moved).map(|r| ObjRef { uid: r.uid, ep: r.ep }).collect();
                var_set(&mut f.vars, *a, Val::refs(&refs));
            }
            Ok(())
        }
        Act::LookTop { who, n, as_ } => {
            let p = player_of(f, *who);
            let n = {
                let cc = cc_of(c.env(), f);
                eval_expr(&cc, n)
            } as usize;
            if deck_locked(c.env(), p) {
                var_set(&mut f.vars, *as_, Val::refs(&[])); // 山札を見れない(5.S.D.)
                return Ok(());
            }
            let top: Vec<i32> = c.s.players[p as usize].deck.iter().take(n).copied().collect();
            let refs = refs_of(c, &top);
            var_set(&mut f.vars, *as_, Val::refs(&refs));
            // この能力で見たカード。後の選択肢(modes)で、選ぶ人に見せる(マルル: 見てから選ぶ)
            let mut seen = var_get(&f.vars, s::SEEN).map(|v| v.to_i32s()).unwrap_or_default();
            seen.extend_from_slice(&top);
            var_set(&mut f.vars, s::SEEN, Val::ints(&seen));
            emit(c, s::LOOKED, vec![(s::CARDS, Val::ints(&top)), (s::TO, Val::Int(p as i64)), (s::FROM, Val::zone(Zone::Deck))]);
            Ok(())
        }
        Act::RevealUntil { who, as_, rest, cond } => {
            let p = player_of(f, *who);
            let deck = c.s.players[p as usize].deck.clone();
            let mut revealed: Vec<i32> = Vec::new();
            let mut found: Option<i32> = None;
            {
                let cc = cc_of(c.env(), f);
                for u in deck {
                    revealed.push(u);
                    let sub = cc.sub(u, -1);
                    if eval_cond(&sub, cond) {
                        found = Some(u);
                        break;
                    }
                }
            }
            // 公開の確認(確認が必要な人間のみ)
            ack_all(c, f, &revealed)?;
            let found_refs: Vec<ObjRef> = found.map(|u| obj_ref(c, u)).into_iter().collect();
            var_set(&mut f.vars, *as_, Val::refs(&found_refs));
            let rest_uids: Vec<i32> = revealed.iter().copied().filter(|u| Some(*u) != found).collect();
            let rest_refs = refs_of(c, &rest_uids);
            var_set(&mut f.vars, *rest, Val::refs(&rest_refs));
            emit(c, s::REVEALED, vec![(s::CARDS, Val::ints(&revealed)), (s::TO, Val::Str(s::ALL)), (s::FROM, Val::zone(Zone::Deck))]);
            Ok(())
        }
        Act::Reveal { items } => {
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, items)
            };
            ack_all(c, f, &uids)?;
            emit(c, s::REVEALED, vec![(s::CARDS, Val::ints(&uids)), (s::TO, Val::Str(s::ALL))]);
            Ok(())
        }
        Act::ShuffleBottom { of } => {
            let uids: Vec<i32> = {
                let cc = cc_of(c.env(), f);
                var_uids(&cc, of, true)
            }
            .into_iter()
            .filter(|u| c.s.cards[*u as usize].zone == Zone::Deck)
            .collect();
            if uids.is_empty() {
                return Ok(());
            }
            let owner = c.s.cards[uids[0] as usize].owner as usize;
            for &u in &uids {
                let deck = &mut c.s.players[owner].deck;
                if let Some(i) = deck.iter().position(|x| *x == u) {
                    deck.remove(i);
                }
            }
            let mut uids = uids;
            shuffle_in_place(&mut c.s, &mut uids);
            let mut group = Vec::with_capacity(uids.len());
            for u in uids {
                c.s.players[owner].deck.push(u);
                c.s.cards[u as usize].ep += 1;
                group.push((u, c.s.cards[u as usize].ep));
            }
            // 公開した札(ヨビニオン)を山札の下に戻した: 並びは分からないが、どの札が下にあるかは両者が知っている
            c.s.known_deck.get_or_insert_with(|| [Vec::new(), Vec::new()])[owner].push(group);
            Ok(())
        }
        Act::Shuffle { who } => {
            let p = player_of(f, *who);
            shuffle_deck(c, p);
            Ok(())
        }
        Act::Assign { items, slots, as_ } => {
            let items_u = {
                let cc = cc_of(c.env(), f);
                var_uids(&cc, items, false)
            };
            let cap: i32 = slots.iter().map(|x| x.count).sum();
            let need = (items_u.len() as i32).min(cap);
            let mut result: Vec<(String, Vec<i32>)> = Vec::new();
            if !items_u.is_empty() {
                if items_u.len() as i32 == need && slots.iter().all(|x| x.count >= items_u.len() as i32) && slots.len() == 1 {
                    result.push((slots[0].id.clone(), items_u.clone()));
                } else {
                    let input = InputSpec::Assign {
                        items: items_u.clone(),
                        slots: slots.iter().map(|x| SlotSpec { id: x.id.clone(), to: x.to, count: x.count, label: x.label.clone() }).collect(),
                    };
                    let ans = ask(c, NeedInput { player: f.controller, why: Why::Assign, input: Some(input), source: Some(f.source) })?;
                    for sl in slots {
                        if let Some(v) = ans.get(sym(&sl.id)) {
                            result.push((sl.id.clone(), v.to_i32s()));
                        }
                    }
                }
            }
            let mut bound: Vec<(Sym, Val)> = Vec::new();
            for sl in slots {
                let us: Vec<i32> = result.iter().find(|(id, _)| *id == sl.id).map(|(_, v)| v.clone()).unwrap_or_default().into_iter().filter(|u| items_u.contains(u)).collect();
                if us.is_empty() {
                    bound.push((sym(&sl.id), Val::List(Rc::new(vec![]))));
                    continue;
                }
                let o = MoveOpts::new(sl.to, sl.cause.unwrap_or(s::EFFECT));
                let res = move_cards(c, &us, &o)?;
                let refs: Vec<ObjRef> = res.iter().filter(|r| r.moved).map(|r| ObjRef { uid: r.uid, ep: r.ep }).collect();
                bound.push((sym(&sl.id), Val::refs(&refs)));
            }
            if let Some(a) = as_ {
                var_set(&mut f.vars, *a, Val::Obj(Rc::new(bound)));
            }
            Ok(())
        }
        Act::AddShield { n, who, as_ } => {
            let p = player_of(f, *who);
            let mut added: Vec<ObjRef> = Vec::new();
            for _ in 0..*n {
                if let Some(u) = add_shield_from_deck(c, p)? {
                    added.push(obj_ref(c, u));
                }
            }
            if let Some(a) = as_ {
                var_set(&mut f.vars, *a, Val::refs(&added));
            }
            Ok(())
        }
        Act::Tap { sel } | Act::Untap { sel } => {
            let tap = matches!(act, Act::Tap { .. });
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                set_tapped(c, u, tap);
            }
            Ok(())
        }
        Act::AddEffect { mods, sel, until } => {
            // mod の n が式なら、その場で評価した数にする(「自分の墓地のクリーチャー1体につき-1000」など)
            let (targets, mods): (Vec<i32>, Vec<EffectMod>) = {
                let cc = cc_of(c.env(), f);
                let ms: Vec<EffectMod> = mods
                    .iter()
                    .map(|m| match m {
                        ModDef::Fixed(x) => x.clone(),
                        ModDef::PowerAdd(e) => EffectMod::PowerAdd(eval_expr(&cc, e) as i32),
                        ModDef::Breaker(e) => EffectMod::Breaker(eval_expr(&cc, e) as i32),
                    })
                    .collect();
                (resolve_sel(&cc, sel), ms)
            };
            for u in targets {
                let (zone, pid) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.pid)
                };
                if zone != Zone::Battle {
                    continue;
                }
                for m in &mods {
                    let id = c.s.next_id();
                    let until = duration_of(c, f, *until);
                    c.s.effects.push(ContEffect { id, pid, m: m.clone(), until, controller: f.controller });
                }
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::Put { sel, as_, onto, no_triggers } | Act::Summon { sel, as_, onto, no_triggers } => {
            let via = if matches!(act, Act::Summon { .. }) { s::SUMMON } else { s::EFFECT };
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            let mut entered: Vec<ObjRef> = Vec::new();
            // 複数を同時に出す時、出る時の置換の質問は、最初の1枚を出す前にまとめて行う(質問は、状態を変更する前に行うため)
            let mut reps: Vec<(i32, EntryRep)> = Vec::new();
            let batch = uids.len() > 1 && game_has(c.env(), Feat::EntryReplace);
            if batch {
                for &u in &uids {
                    let fi = creature_face(c, u);
                    if fi < 0 {
                        continue;
                    }
                    let mut o = MoveOpts::new(Zone::Battle, via);
                    o.via = Some(via);
                    o.face = Some(fi);
                    o.paid = Some(0);
                    if let Some(rep) = entry_replacement(c, u, &o, fi, via)? {
                        reps.push((u, rep));
                    }
                }
            }
            for u in uids {
                let fi = creature_face(c, u);
                if fi < 0 {
                    continue;
                }
                let face_ty = c.reg.face(c.s.cards[u as usize].def, fi).ty;
                if let Some(pos) = reps.iter().position(|(x, _)| *x == u) {
                    let (_, rep) = reps.remove(pos);
                    apply_entry_replacement(c, u, &rep)?;
                    continue;
                }
                let mut onto_pid: Option<i32> = None;
                if face_ty == FaceType::Evolution {
                    // 進化クリーチャーは、進化元(onto: 変数のクリーチャー)の上に出す。進化元の条件を満たさなければ出せない
                    let ok = {
                        let cc = cc_of(c.env(), f);
                        let base = onto.as_ref().and_then(|name| var_uids(&cc, name, true).first().copied());
                        let ef = c.reg.face(c.s.cards[u as usize].def, fi).evolve_from.as_ref();
                        match (base, ef) {
                            (Some(b), Some(ef)) if c.s.cards[b as usize].zone == Zone::Battle => {
                                let top = if c.s.cards[b as usize].pid >= 0 { c.s.perm(c.s.cards[b as usize].pid).map(|p| p.cards[0]) } else { None };
                                match top {
                                    Some(tu) => {
                                        let sub = CC { e: cc.e, controller: cc.controller, self_: Some(u), self_snap: cc.self_snap, vars: cc.vars, it: Some(tu), it_face: c.s.cards[tu as usize].face, iter: cc.iter, event: cc.event, evo: true };
                                        if eval_cond(&sub, ef) {
                                            Some(c.s.cards[tu as usize].pid)
                                        } else {
                                            None
                                        }
                                    }
                                    None => None,
                                }
                            }
                            _ => None,
                        }
                    };
                    match ok {
                        Some(p) => onto_pid = Some(p),
                        None => continue,
                    }
                }
                if via == s::SUMMON && !can_summon_card(c.env(), c.s.cards[u as usize].owner, u, fi) {
                    continue; // 召喚できない効果を受けている
                }
                let mut o = MoveOpts::new(Zone::Battle, via);
                o.via = Some(via);
                o.face = Some(fi);
                o.paid = Some(0);
                o.no_replace = batch;
                o.onto = onto_pid;
                let r = enter_battle(c, u, &o, &mut evs)?;
                if r.moved && r.to == Zone::Battle {
                    entered.push(ObjRef { uid: u, ep: r.ep }); // G城の置換でマナゾーンに置かれたものは、出ていない
                    if via == s::SUMMON {
                        on_summoned(c, u);
                    }
                }
            }
            if let Some(a) = as_ {
                var_set(&mut f.vars, *a, Val::refs(&entered));
            }
            c.s.batch_no += 1;
            // noTriggers: 出ることによって起こる効果(「出た時」の能力)はすべて無視する
            if *no_triggers {
                let kept: Vec<Rc<Ev>> = evs.iter().filter(|e| e.ty != s::ENTERED).cloned().collect();
                collect_batch(c, &kept);
            } else {
                collect_batch(c, &evs);
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::CastFree { sel, after } => {
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let fi = spell_face(c, u);
                if fi < 0 {
                    continue;
                }
                let id = c.s.next_id();
                let (ep, zone) = {
                    let card = &c.s.cards[u as usize];
                    (card.ep, card.zone)
                };
                let vars: Vars = vec![
                    (s::UID, Val::Int(u as i64)),
                    (s::EP, Val::Int(ep as i64)),
                    (s::FROM, Val::zone(zone)),
                    (s::FACE, Val::Int(fi as i64)),
                    (s::FREE, Val::Bool(true)),
                    (s::AFTER, after.map_or(Val::Null, Val::Str)),
                    (s::SETTLE, Val::Bool(false)),
                ];
                c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Play, stage: 0, vars }));
            }
            Ok(())
        }
        Act::SkipRestOfTurn => {
            c.s.skip_turn = true;
            emit(c, s::SKIP_TURN, vec![(s::BY, Val::Int(f.controller as i64)), (s::SOURCE, Val::Int(f.source.uid as i64))]);
            Ok(())
        }
        Act::CopyTrigger => {
            let trig = match &f.trigger {
                Some(t) if t.ty == s::ABILITY_TRIGGERED => t.clone(),
                _ => return Ok(()),
            };
            let src_uid = trig.int(s::SOURCE).unwrap_or(0) as i32;
            let ability = match trig.get(s::ABILITY) {
                Some(v) => {
                    let id = v.get(s::DEFID).and_then(|x| x.as_sym()).map(|x| x.name().to_string()).unwrap_or_default();
                    AbilityRef {
                        def: c.reg.def_index(&id).ok_or_else(|| Stop::Fail(format!("未知のカード: {}", id)))?,
                        face: v.get(s::FACE).and_then(|x| x.as_int()).unwrap_or(0) as u8,
                        idx: v.get(s::IDX).and_then(|x| x.as_int()).unwrap_or(0) as u16,
                    }
                }
                None => return fail("copyTrigger: ability がありません"),
            };
            let cause_ev = match trig.get(s::CAUSE) {
                Some(Val::Ev(e)) => Some(e.clone()),
                _ => None,
            };
            let id = c.s.next_id();
            let source = obj_ref(c, src_uid);
            let lki = Rc::new(crate::derive::snap_of(c.env(), src_uid));
            c.s.cont.push(Frame::Effect(EffectFrame {
                id,
                caused_by: c.cause,
                ability,
                source,
                lki,
                controller: f.controller, // L4: 処理者はオルゲイトの持ち主
                pc: 0,
                vars: vec![],
                trigger: cause_ev,
                no_optional: true,
            }));
            Ok(())
        }
        Act::Invade => {
            let trig = match &f.trigger {
                Some(t) if t.ty == s::ATTACK_DECLARED => t.clone(),
                _ => return Ok(()),
            };
            let uid = f.source.uid;
            let attacker = trig.int(s::ATTACKER).unwrap_or(-1) as i32;
            let (card_ep, card_zone, card_pid) = {
                let card = &c.s.cards[uid as usize];
                (card.ep, card.zone, card.pid)
            };
            if c.s.perm(attacker).is_none() || card_ep != f.source.ep {
                return Ok(());
            }
            if card_zone == Zone::Battle && card_pid == attacker {
                return Ok(());
            }
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            let fi = creature_face(c, uid);
            let mut o = MoveOpts::new(Zone::Battle, s::INVADE);
            o.via = Some(s::INVADE);
            o.onto = Some(attacker);
            o.face = Some(fi);
            enter_battle(c, uid, &o, &mut evs)?;
            c.s.batch_no += 1;
            collect_batch(c, &evs);
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::RevolutionChange => {
            // 革命チェンジ: 攻撃中のクリーチャーを手札に戻し、このカードを手札から攻撃中のクリーチャーとして出す。
            let trig = match &f.trigger {
                Some(t) if t.ty == s::ATTACK_DECLARED => t.clone(),
                _ => return Ok(()),
            };
            let uid = f.source.uid;
            let (card_ep, card_zone) = {
                let card = &c.s.cards[uid as usize];
                (card.ep, card.zone)
            };
            if card_ep != f.source.ep || card_zone != Zone::Hand {
                return Ok(());
            }
            let attacker = trig.int(s::ATTACKER).unwrap_or(-1) as i32;
            let a_card = trig.int(s::CARD).unwrap_or(-1) as i32;
            match c.s.perm(attacker) {
                Some(pm) if pm.cards[0] == a_card => {}
                _ => return Ok(()),
            }
            // 入れ替える時にも、攻撃クリーチャーが条件(文明・種族・コストなど)を満たしている必要がある
            // (革命チェンジの確認は、使用宣言と入れ替えの2回。侵略は宣言の1回だけ)
            let reg = c.reg;
            if let Ability::Trigger { spec, .. } = reg.ability(f.ability) {
                if let Some(ac) = spec.on.first().and_then(|p| p.attacker_cond.as_ref()) {
                    let cc = cc_of(c.env(), f);
                    let sub = cc.sub(a_card, -1);
                    if !eval_cond(&sub, ac) {
                        return Ok(());
                    }
                }
            }
            let fr_idx = c.s.cont.iter().rposition(|x| matches!(x, Frame::Proc(p) if p.name == ProcName::Attack && var_get(&p.vars, s::PID).and_then(|v| v.as_i32()) == Some(attacker)));
            let fr_idx = match fr_idx {
                Some(i) => i,
                None => return Ok(()),
            };
            let fi = creature_face(c, uid);
            if fi < 0 {
                return Ok(());
            }
            let mut o = MoveOpts::new(Zone::Battle, s::REVOLUTION_CHANGE);
            o.via = Some(s::REVOLUTION_CHANGE);
            o.face = Some(fi);
            o.tapped = true;
            o.paid = Some(0);
            // 出る時の置換の質問は、状態を変更する前(手札に戻す前)に行う
            let rep = if game_has(c.env(), Feat::EntryReplace) { entry_replacement(c, uid, &o, fi, s::REVOLUTION_CHANGE)? } else { None };
            let res = move_cards(c, &[a_card], &MoveOpts::new(Zone::Hand, s::REVOLUTION_CHANGE))?;
            if !res.first().map_or(false, |r| r.moved) {
                return Ok(()); // 置換されて離れなかった(EXライフなど): 入れ替わらない
            }
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            if let Some(rep) = rep {
                apply_entry_replacement(c, uid, &rep)?;
            } else {
                o.no_replace = true;
                enter_battle(c, uid, &o, &mut evs)?;
            }
            // G城の置換でマナゾーンに置かれた時は、入れ替わらない(攻撃していたクリーチャーは手札に戻った後で、攻撃は終わる)
            if c.s.cards[uid as usize].zone == Zone::Battle {
                let new_pid = c.s.cards[uid as usize].pid;
                if let Frame::Proc(p) = &mut c.s.cont[fr_idx] {
                    var_set(&mut p.vars, s::PID, Val::Int(new_pid as i64));
                }
            }
            c.s.batch_no += 1;
            collect_batch(c, &evs);
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::PlayerEffect { m, until } => {
            // プレイヤー単位の継続効果(pid = -1)。「相手は〜できない」
            let em = {
                let cc = cc_of(c.env(), f);
                match m {
                    PlayerMod::CannotCast(n) => EffectMod::CannotCast(n.as_ref().map(|x| eval_expr(&cc, x) as i32)),
                    PlayerMod::CannotUseCost(x) => EffectMod::CannotUseCost(eval_expr(&cc, x) as i32),
                    PlayerMod::CannotSummon(x) => EffectMod::CannotSummon(eval_expr(&cc, x) as i32),
                    PlayerMod::CannotCastLte(x) => EffectMod::CannotCastLte(eval_expr(&cc, x) as i32),
                    PlayerMod::IgnoreCost(x) => EffectMod::IgnoreCost(eval_expr(&cc, x) as i32),
                    PlayerMod::IgnoreAll => EffectMod::IgnoreAll,
                    PlayerMod::StartShield => EffectMod::StartShield,
                    PlayerMod::Owe { civ, n } => EffectMod::Owe { civ: *civ, n: *n },
                    PlayerMod::OncePerTurnActs => EffectMod::OncePerTurnActs,
                    PlayerMod::NextSummon { delta, sa } => EffectMod::NextSummon { delta: eval_expr(&cc, delta) as i32, sa: *sa },
                    PlayerMod::CannotAttackAny => EffectMod::CannotAttackAny,
                    PlayerMod::CannotLose => EffectMod::CannotLose,
                    PlayerMod::CannotActCost(x) => EffectMod::CannotActCost(eval_expr(&cc, x) as i32),
                }
            };
            let id = c.s.next_id();
            let until = duration_of(c, f, *until);
            c.s.effects.push(ContEffect { id, pid: -1, m: em, until, controller: f.controller });
            Ok(())
        }
        Act::Battle { a, b } => {
            // 効果によるバトル: a と b(どちらも変数の参照)のクリーチャーをバトルさせる。どちらかがバトルゾーンにいなければ何も起きない。
            // 「バトルする時」「バトルの後」の誘発や身代わり(battleProxy)がある対戦は、手続き(battle)で段階を踏む。ない対戦は、その場で解決する
            let staged = game_has(c.env(), Feat::BattleProxy) || listens(c, s::BATTLE_STARTED) || listens(c, s::AFTER_BATTLE);
            if !staged {
                let (pa, pb) = {
                    let cc = cc_of(c.env(), f);
                    let pid_of = |name: &str| -> Option<i32> {
                        let u = *var_uids(&cc, name, false).first()?;
                        let card = &c.s.cards[u as usize];
                        if card.zone != Zone::Battle {
                            return None;
                        }
                        let pm = c.s.perm(card.pid)?;
                        if pm.cards[0] == u {
                            Some(pm.pid)
                        } else {
                            None
                        }
                    };
                    (pid_of(a), pid_of(b))
                };
                if let (Some(x), Some(y)) = (pa, pb) {
                    if x != y {
                        resolve_battle(c, x, y)?;
                        c.s.dirty_sba = true;
                    }
                }
                return Ok(());
            }
            let (as_, bs) = {
                let cc = cc_of(c.env(), f);
                (var_uids(&cc, a, false), var_uids(&cc, b, false))
            };
            let as_: Vec<i32> = as_.into_iter().filter(|&u| c.s.cards[u as usize].zone == Zone::Battle).collect();
            let bs: Vec<i32> = bs.into_iter().filter(|&u| c.s.cards[u as usize].zone == Zone::Battle).collect();
            if as_.is_empty() || bs.is_empty() {
                return Ok(());
            }
            let id = c.s.next_id();
            let vars: Vars = vec![(sym("a"), Val::Int(c.s.cards[as_[0] as usize].pid as i64)), (sym("d"), Val::Int(c.s.cards[bs[0] as usize].pid as i64))];
            c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Battle, stage: 0, vars }));
            Ok(())
        }
        Act::MoveBottom { who, n, to, cause, tapped, as_ } => {
            let p = player_of(f, *who);
            let n = {
                let cc = cc_of(c.env(), f);
                eval_expr(&cc, n)
            } as usize;
            let deck = &c.s.players[p as usize].deck;
            let bottom: Vec<i32> = deck[deck.len().saturating_sub(n)..].to_vec();
            let mut o = MoveOpts::new(*to, *cause);
            o.tapped = tapped.unwrap_or(false);
            let res = move_cards(c, &bottom, &o)?;
            if let Some(a) = as_ {
                let refs: Vec<ObjRef> = res.iter().filter(|r| r.moved).map(|r| ObjRef { uid: r.uid, ep: r.ep }).collect();
                var_set(&mut f.vars, *a, Val::refs(&refs));
            }
            Ok(())
        }
        Act::ShuffleIn { sel, as_ } => {
            // 山札に加えてシャッフルする(それぞれの持ち主の山札に)
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            if let Some(a) = as_ {
                var_set(&mut f.vars, *a, Val::Int(0));
            }
            if uids.is_empty() {
                return Ok(());
            }
            let mut owners: Vec<PlayerId> = Vec::new();
            for &u in &uids {
                let o = c.s.cards[u as usize].owner;
                if !owners.contains(&o) {
                    owners.push(o);
                }
            }
            let before: Vec<usize> = owners.iter().map(|&p| c.s.players[p as usize].deck.len()).collect();
            let mut o = MoveOpts::new(Zone::Deck, s::EFFECT);
            o.pos = Some(true);
            move_cards(c, &uids, &o)?;
            // as: 山札に加わったカードの枚数(進化元など、重なっていたカードも数える)
            if let Some(a) = as_ {
                let moved: usize = owners.iter().zip(before.iter()).map(|(&p, &b)| c.s.players[p as usize].deck.len() - b).sum();
                var_set(&mut f.vars, *a, Val::Int(moved as i64));
            }
            for p in owners {
                shuffle_deck(c, p);
            }
            Ok(())
        }
        Act::Bottom { of, except } => {
            // 山札の下に、いまの並びのまま置く(「好きな順序で山札の下に置く」。並びは変えない)
            let (skip, all) = {
                let cc = cc_of(c.env(), f);
                (except.as_ref().map_or(vec![], |e| var_uids(&cc, e, true)), var_uids(&cc, of, true))
            };
            let uids: Vec<i32> = all.into_iter().filter(|u| c.s.cards[*u as usize].zone == Zone::Deck && !skip.contains(u)).collect();
            if uids.is_empty() {
                return Ok(());
            }
            let owner = c.s.cards[uids[0] as usize].owner;
            if deck_locked(c.env(), owner) {
                return Ok(()); // 山札の順序を変えられない(5.S.D.)
            }
            for &u in &uids {
                let deck = &mut c.s.players[owner as usize].deck;
                if let Some(i) = deck.iter().position(|x| *x == u) {
                    deck.remove(i);
                }
            }
            for &u in &uids {
                c.s.players[owner as usize].deck.push(u);
                c.s.cards[u as usize].ep += 1;
            }
            Ok(())
        }
        Act::SummonOnto { sel, under } => {
            // 無月の門など: このカードを、選んだカードの上に重ねて召喚する(コストは支払わない)
            let (uid, under_u) = {
                let cc = cc_of(c.env(), f);
                (resolve_sel(&cc, sel).first().copied(), var_uids(&cc, under, false))
            };
            let uid = match uid {
                Some(u) => u,
                None => return Ok(()),
            };
            let zone = c.s.cards[uid as usize].zone;
            if zone != Zone::Hand && zone != Zone::Grave {
                return Ok(());
            }
            let fi = creature_face(c, uid);
            if fi < 0 {
                return Ok(());
            }
            let under_u: Vec<i32> = under_u.into_iter().filter(|&u| u != uid).collect();
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            let mut o = MoveOpts::new(Zone::Battle, s::SUMMON);
            o.via = Some(s::SUMMON);
            o.face = Some(fi);
            o.paid = Some(0);
            o.free = true;
            o.under = Some(under_u);
            o.from = Some(zone);
            enter_battle(c, uid, &o, &mut evs)?;
            c.s.batch_no += 1;
            collect_batch(c, &evs);
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::ExtraTurn => {
            // 「このターンの後に自分のターンを追加する」
            c.s.extra_turns.get_or_insert_with(Vec::new).push(f.controller);
            emit(c, sym("extraTurn"), vec![(s::BY, Val::Int(f.controller as i64)), (s::SOURCE, Val::Int(f.source.uid as i64))]);
            Ok(())
        }
        Act::MarkUsed { key } => {
            // ゲーム中に1度の能力を使った印(cond の unused で調べる)
            c.s.usage_set(&UKey::Other(format!("once:{}:{}", f.source.uid, key)), 1);
            Ok(())
        }
        Act::PutUnder { sel, onto } => {
            // カードを、バトルゾーンの山(フィールドなど)の下に置く。sel = 置くカード、onto = 山の一番上のカード
            let (base, uids) = {
                let cc = cc_of(c.env(), f);
                (resolve_sel(&cc, onto).first().copied(), resolve_sel(&cc, sel))
            };
            let base = match base {
                Some(b) if c.s.cards[b as usize].zone == Zone::Battle => b,
                _ => return Ok(()),
            };
            let perm_pid = match c.s.perm(c.s.cards[base as usize].pid) {
                Some(p) => p.pid,
                None => return Ok(()),
            };
            for u in uids {
                if c.s.cards[u as usize].zone == Zone::Battle {
                    continue;
                }
                let from = c.s.cards[u as usize].zone;
                let snap = Rc::new(snap_of(c.env(), u));
                let owner = c.s.cards[u as usize].owner;
                remove_zone_card(c, u);
                {
                    let card = &mut c.s.cards[u as usize];
                    card.zone = Zone::Battle;
                    card.ep += 1;
                    card.pid = perm_pid;
                    card.tapped = false;
                    card.face = 0;
                }
                if let Some((po, pi)) = c.s.perm_by_pid(perm_pid) {
                    c.s.players[po as usize].battle[pi].cards.push(u);
                }
                emit(
                    c,
                    s::MOVED,
                    vec![
                        (s::CARD, Val::Int(u as i64)),
                        (s::OWNER, Val::Int(owner as i64)),
                        (s::FROM, Val::zone(from)),
                        (s::TO, Val::zone(Zone::Battle)),
                        (s::CAUSE, Val::Str(sym("putUnder"))),
                        (s::KIND, Val::Str(s::SPELL)),
                        (s::EX, Val::Bool(false)),
                        (s::LKI, Val::Snap(snap)),
                        (s::UNDERNEATH, Val::Bool(true)),
                    ],
                );
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::TapLock { sel } => {
            // タップして、次の持ち主のターンのはじめにアンタップしない(クリーチャー・マナのカード)
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            if uids.is_empty() {
                return Ok(());
            }
            let mut pids: Vec<i32> = Vec::new();
            let mut mana: Vec<i32> = Vec::new();
            let mut owners: Vec<PlayerId> = Vec::new();
            for &u in &uids {
                let (owner, zone, pid) = {
                    let card = &c.s.cards[u as usize];
                    (card.owner, card.zone, card.pid)
                };
                if !owners.contains(&owner) {
                    owners.push(owner);
                }
                set_tapped(c, u, true);
                if zone == Zone::Battle {
                    pids.push(pid);
                } else if zone == Zone::Mana {
                    mana.push(u);
                }
            }
            for owner in owners {
                let ps: Vec<i32> = pids.iter().copied().filter(|&p| c.s.perm_by_pid(p).map_or(false, |(po, _)| po == owner)).collect();
                let ms: Vec<i32> = mana.iter().copied().filter(|&u| c.s.cards[u as usize].owner == owner).collect();
                let id = c.s.next_id();
                let turn = c.s.turn;
                c.s.effects.push(ContEffect { id, pid: -1, m: EffectMod::NoUntap { pids: ps, uids: ms }, until: Duration::UntilTurnStart { player: owner, after_turn: turn }, controller: f.controller });
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::BreakShields { n } => {
            // 自分のシールドをすべて、ブレイクする(S・トリガーも使える。終極宣言)。n があれば、そのぶんだけ
            let me = f.controller;
            let have = c.s.players[me as usize].shield.len();
            let n = n.map_or(have, |x| (x.max(0) as usize).min(have));
            if n == 0 {
                return Ok(());
            }
            let pid = c.s.cards[f.source.uid as usize].pid;
            let id = c.s.next_id();
            let vars: Vars = vec![(s::PID, Val::Int(pid as i64)), (s::OWNER, Val::Int(opp(me) as i64)), (s::N, Val::Int(n as i64))];
            c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Break, stage: 0, vars }));
            Ok(())
        }
        Act::Judge { as_ } => {
            // ガチンコ・ジャッジ: 各プレイヤーは、自身の山札の上から1枚目を表向きにし、それを一番下に置く。
            // そのカードのコストが相手以上であれば、自分の勝ち。勝った時、変数 as に自分の公開したカードを入れる(負けたら空)
            let me = f.controller;
            let o = opp(me);
            let um = c.s.players[me as usize].deck.first().copied();
            let uo = c.s.players[o as usize].deck.first().copied();
            let cm = um.map_or(-1, |u| cost_base(c.env(), u));
            let co = uo.map_or(-1, |u| cost_base(c.env(), u));
            let shown: Vec<i32> = [um, uo].iter().filter_map(|x| *x).collect();
            if !shown.is_empty() {
                emit(c, s::REVEALED, vec![(s::CARDS, Val::ints(&shown)), (s::TO, Val::Str(s::ALL)), (s::FROM, Val::zone(Zone::Deck))]);
            }
            for &u in &shown {
                let owner = c.s.cards[u as usize].owner as usize;
                let deck = &mut c.s.players[owner].deck;
                if let Some(i) = deck.iter().position(|x| *x == u) {
                    deck.remove(i);
                }
                deck.push(u);
                c.s.cards[u as usize].ep += 1;
            }
            if let Some(a) = as_ {
                let won = cm >= co && um.is_some();
                let refs: Vec<ObjRef> = if won { vec![obj_ref(c, um.unwrap())] } else { vec![] };
                var_set(&mut f.vars, *a, Val::refs(&refs));
            }
            Ok(())
        }
        Act::StackShield { sel, onto } => {
            // カードを、表向きでシールド1つの上に置く(重ねる)。重ねても、シールドの枚数は変わらない
            let (uid, base) = {
                let cc = cc_of(c.env(), f);
                (resolve_sel(&cc, sel).first().copied(), resolve_sel(&cc, onto).first().copied())
            };
            let (uid, base) = match (uid, base) {
                (Some(u), Some(b)) => (u, b),
                _ => return Ok(()),
            };
            let (bz, bowner) = {
                let bc = &c.s.cards[base as usize];
                (bc.zone, bc.owner)
            };
            let (uowner, from) = {
                let cd = &c.s.cards[uid as usize];
                (cd.owner, cd.zone)
            };
            if bz != Zone::Shield || uowner != bowner || uid == base {
                return Ok(());
            }
            let i = match c.s.players[bowner as usize].shield.iter().position(|x| *x == base) {
                Some(i) => i,
                None => return Ok(()),
            };
            if from == Zone::Shield {
                return Ok(()); // シールドのカードどうしを重ねることは、いまのカードにはない
            }
            let snap = Rc::new(snap_of(c.env(), uid));
            // 下のカードたち(元の山の分も含む)
            let mut under: Vec<i32> = vec![base];
            {
                let piles = c.s.piles.get_or_insert_with(Vec::new);
                if let Some(pi) = piles.iter().position(|(k, _)| *k == base) {
                    let (_, rest) = piles.remove(pi);
                    under.extend(rest);
                }
            }
            remove_zone_card(c, uid);
            {
                let card = &mut c.s.cards[uid as usize];
                card.zone = Zone::Shield;
                card.ep += 1;
                card.pid = -1;
                card.tapped = false;
                card.face = 0;
                card.up = true;
            }
            c.s.players[bowner as usize].shield[i] = uid;
            {
                let piles = c.s.piles.get_or_insert_with(Vec::new);
                piles.push((uid, under));
                piles.sort_by_key(|(k, _)| *k);
            }
            emit(
                c,
                s::MOVED,
                vec![
                    (s::CARD, Val::Int(uid as i64)),
                    (s::OWNER, Val::Int(uowner as i64)),
                    (s::FROM, Val::zone(from)),
                    (s::TO, Val::zone(Zone::Shield)),
                    (s::CAUSE, Val::Str(sym("stackShield"))),
                    (s::KIND, Val::Str(s::CREATURE)),
                    (s::EX, Val::Bool(false)),
                    (s::LKI, Val::Snap(snap)),
                ],
            );
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::CastSide { sel } => {
            // バトルゾーンに置いたまま、ツインパクトの呪文側を、コストを支払わずに唱える。カードは動かない。呪文を唱えた時の能力は誘発する
            let uid = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel).first().copied()
            };
            let uid = match uid {
                Some(u) => u,
                None => return Ok(()),
            };
            let (zone, owner, def, ep) = {
                let card = &c.s.cards[uid as usize];
                (card.zone, card.owner, card.def, card.ep)
            };
            if zone != Zone::Battle {
                return Ok(());
            }
            let fi = spell_face(c, uid);
            if fi < 0 {
                return Ok(());
            }
            let spell_idx = match c.reg.info(def, fi).spell {
                Some(i) => i,
                None => return Ok(()),
            };
            let ev = emit(
                c,
                s::CAST,
                vec![
                    (s::CARD, Val::Int(uid as i64)),
                    (s::OWNER, Val::Int(owner as i64)),
                    (s::FREE, Val::Bool(true)),
                    (s::PAID, Val::Int(0)),
                    (s::COST, Val::Int(0)),
                    (s::FACE, Val::Int(fi as i64)),
                    (s::FROM, Val::zone(Zone::Battle)),
                ],
            );
            c.s.batch_no += 1;
            collect_batch(c, &[ev.clone()]);
            let id = c.s.next_id();
            let lki = Rc::new(snap_of(c.env(), uid));
            c.s.cont.push(Frame::Effect(EffectFrame {
                id,
                caused_by: Some(ev.id),
                ability: AbilityRef { def, face: fi as u8, idx: spell_idx },
                source: ObjRef { uid, ep },
                lki,
                controller: owner,
                pc: 0,
                vars: vec![],
                trigger: Some(ev),
                no_optional: false,
            }));
            Ok(())
        }
        Act::Seal { sel } => {
            // 封印を付ける: 持ち主の山札の上から1枚を、裏向きで、そのクリーチャーの上に置く
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let (zone, pid, owner) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.pid, card.owner)
                };
                if zone != Zone::Battle {
                    continue;
                }
                let perm_pid = match c.s.perm(pid) {
                    Some(p) => p.pid,
                    None => continue,
                };
                let d = match c.s.players[owner as usize].deck.first().copied() {
                    Some(d) => d,
                    None => continue,
                };
                let snap = Rc::new(snap_of(c.env(), d));
                remove_zone_card(c, d);
                let downer = c.s.cards[d as usize].owner;
                {
                    let dc = &mut c.s.cards[d as usize];
                    dc.zone = Zone::Battle;
                    dc.ep += 1;
                    dc.pid = perm_pid;
                    dc.face = 0;
                    dc.tapped = false;
                }
                if let Some((po, pi)) = c.s.perm_by_pid(perm_pid) {
                    c.s.players[po as usize].battle[pi].seals.push(d);
                }
                c.s.sealed = true;
                emit(
                    c,
                    s::MOVED,
                    vec![
                        (s::CARD, Val::Int(d as i64)),
                        (s::OWNER, Val::Int(downer as i64)),
                        (s::FROM, Val::zone(Zone::Deck)),
                        (s::TO, Val::zone(Zone::Battle)),
                        (s::CAUSE, Val::Str(sym("seal"))),
                        (s::KIND, Val::Str(s::CREATURE)),
                        (s::EX, Val::Bool(false)),
                        (s::LKI, Val::Snap(snap)),
                        (s::UNDERNEATH, Val::Bool(true)),
                    ],
                );
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::Stab { sel, depth } => {
            // 持ち主の山札の上から depth 枚目の位置に、横向きに刺す
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            stab_into_deck(c, &uids, *depth);
            Ok(())
        }
        Act::NinjaChange { sel } => {
            // ニンジャ・チェンジ: 相手のクリーチャーの攻撃・ブロックの途中で、自分のクリーチャー(sel)を手札に戻し、手札のこのクリーチャーを出す。
            // 攻撃先・ブロッカーが入れ替わるクリーチャーだったなら、出たクリーチャーがその役を引き継ぐ
            let trig = match &f.trigger {
                Some(t) if t.ty == s::ATTACK_DECLARED || t.ty == s::BLOCKED => t.clone(),
                _ => return Ok(()),
            };
            let uid = f.source.uid;
            let (cep, czone, cowner) = {
                let card = &c.s.cards[uid as usize];
                (card.ep, card.zone, card.owner)
            };
            if cep != f.source.ep || czone != Zone::Hand {
                return Ok(());
            }
            let old = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel).first().copied()
            };
            let old = match old {
                Some(o) if c.s.cards[o as usize].zone == Zone::Battle => o,
                _ => return Ok(()),
            };
            let (old_pid, was_tapped) = match c.s.perm_by_pid(c.s.cards[old as usize].pid) {
                Some((po, pi)) if po == cowner => {
                    let pm = &c.s.players[po as usize].battle[pi];
                    (pm.pid, pm.tapped)
                }
                _ => return Ok(()),
            };
            let attacker = trig.int(s::ATTACKER).unwrap_or(-1) as i32;
            let fr_idx = c.s.cont.iter().rposition(|x| matches!(x, Frame::Proc(p) if p.name == ProcName::Attack && var_get(&p.vars, s::PID).and_then(|v| v.as_i32()) == Some(attacker)));
            let fi = creature_face(c, uid);
            if fi < 0 {
                return Ok(());
            }
            let nj = sym("ninjaChange");
            let mut o = MoveOpts::new(Zone::Battle, nj);
            o.via = Some(nj);
            o.face = Some(fi);
            o.tapped = was_tapped;
            o.paid = Some(0);
            let rep = if game_has(c.env(), Feat::EntryReplace) { entry_replacement(c, uid, &o, fi, nj)? } else { None };
            let res = move_cards(c, &[old], &MoveOpts::new(Zone::Hand, s::BOUNCE))?;
            if !res.first().map_or(false, |r| r.moved) {
                return Ok(());
            }
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            if let Some(rep) = rep {
                apply_entry_replacement(c, uid, &rep)?;
            } else {
                o.no_replace = true;
                enter_battle(c, uid, &o, &mut evs)?;
            }
            let new_pid = c.s.cards[uid as usize].pid;
            if let Some(i) = fr_idx {
                if let Frame::Proc(p) = &mut c.s.cont[i] {
                    let is_old = var_get(&p.vars, s::TARGET).and_then(target_from_val) == Some(crate::state::Target::Creature(old_pid));
                    if is_old {
                        var_set(&mut p.vars, s::TARGET, target_to_val(&crate::state::Target::Creature(new_pid)));
                    }
                }
            }
            c.s.batch_no += 1;
            collect_batch(c, &evs);
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::GrantShieldTrigger { sel } => {
            // シールドのカード(sel)に、次の持ち主のターンのはじめまで「S・トリガー」を与える
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let (zone, ep) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.ep)
                };
                if zone != Zone::Shield {
                    continue;
                }
                let turn = c.s.turn as i64;
                c.s.usage_set(&UKey::Other(format!("stg:{}:{}", u, ep)), turn);
            }
            Ok(())
        }
        Act::Cross { gear, to } => {
            // クロスギア(gear)を、クリーチャー(to)にクロスする(コストは支払わない)
            let (gu, hu) = {
                let cc = cc_of(c.env(), f);
                let g = match gear {
                    SelOrVar::Var(n) => var_uids(&cc, n, true),
                    SelOrVar::Sel(sl) => select_cards(&cc, sl),
                };
                let h = match to {
                    SelOrVar::Var(n) => var_uids(&cc, n, true),
                    SelOrVar::Sel(sl) => select_cards(&cc, sl),
                };
                (g.first().copied(), h.first().copied())
            };
            let (gu, hu) = match (gu, hu) {
                (Some(g), Some(h)) => (g, h),
                _ => return Ok(()),
            };
            let gp = if c.s.cards[gu as usize].zone == Zone::Battle { c.s.perm_by_pid(c.s.cards[gu as usize].pid) } else { None };
            let hp = if c.s.cards[hu as usize].zone == Zone::Battle { c.s.perm_by_pid(c.s.cards[hu as usize].pid) } else { None };
            let ((go, gi), (ho, hi)) = match (gp, hp) {
                (Some(g), Some(h)) => (g, h),
                _ => return Ok(()),
            };
            let host_pid = c.s.players[ho as usize].battle[hi].pid;
            let host_top = c.s.players[ho as usize].battle[hi].cards[0];
            if go != ho || c.s.players[go as usize].battle[gi].crossed_on == Some(host_pid) {
                return Ok(());
            }
            c.s.players[go as usize].battle[gi].crossed_on = Some(host_pid);
            let ev = emit(
                c,
                sym("crossed"),
                vec![
                    (s::CARD, Val::Int(gu as i64)),
                    (s::OWNER, Val::Int(go as i64)),
                    (sym("host"), Val::Int(host_top as i64)),
                    (sym("hostPid"), Val::Int(host_pid as i64)),
                    (s::FREE, Val::Bool(true)),
                ],
            );
            collect_batch(c, &[ev]);
            Ok(())
        }
        Act::AllowSummon { sel } => {
            // そのカード(マナゾーン)を、このターン、マナゾーンから召喚してもよい(コストは支払う)
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let (zone, ep) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.ep)
                };
                if zone == Zone::Mana {
                    let turn = c.s.turn as i64;
                    c.s.usage_set(&UKey::Other(format!("pm:{}:{}", u, ep)), turn);
                }
            }
            Ok(())
        }
        Act::DropUnder { sel, n, deck } => {
            // クリーチャー(進化の山)の下にあるカードを、n 枚(省略 = すべて)、墓地(または山札の下)に置く
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let (zone, pid) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.pid)
                };
                if zone != Zone::Battle {
                    continue;
                }
                let (po, pi) = match c.s.perm_by_pid(pid) {
                    Some(x) => x,
                    None => continue,
                };
                if c.s.players[po as usize].battle[pi].cards[0] != u {
                    continue;
                }
                let len = c.s.players[po as usize].battle[pi].cards.len();
                let k = n.map_or(len.saturating_sub(1), |x| (x.max(0) as usize).min(len.saturating_sub(1)));
                for _ in 0..k {
                    let uc = match c.s.players[po as usize].battle[pi].cards.pop() {
                        Some(x) => x,
                        None => break,
                    };
                    if uc == u {
                        break;
                    }
                    let snap = Rc::new(snap_of(c.env(), uc));
                    let uowner = c.s.cards[uc as usize].owner;
                    let dest = if *deck { Zone::Deck } else { Zone::Grave };
                    {
                        let ucard = &mut c.s.cards[uc as usize];
                        ucard.zone = dest;
                        ucard.ep += 1;
                        ucard.pid = -1;
                        ucard.tapped = false;
                        ucard.face = 0;
                    }
                    if *deck {
                        c.s.players[uowner as usize].deck.push(uc);
                    } else {
                        c.s.players[uowner as usize].grave.push(uc);
                    }
                    emit(
                        c,
                        s::MOVED,
                        vec![
                            (s::CARD, Val::Int(uc as i64)),
                            (s::OWNER, Val::Int(uowner as i64)),
                            (s::FROM, Val::zone(Zone::Battle)),
                            (s::TO, Val::zone(dest)),
                            (s::CAUSE, Val::Str(sym("trashUnder"))),
                            (s::KIND, Val::Str(s::CREATURE)),
                            (s::EX, Val::Bool(false)),
                            (s::LKI, Val::Snap(snap)),
                            (s::UNDERNEATH, Val::Bool(true)),
                        ],
                    );
                }
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::DestroyTop { sel } => {
            // クリーチャー(進化の山)の一番上のカードだけを破壊する(下のカードは残る)
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                if c.s.cards[u as usize].zone != Zone::Battle {
                    continue;
                }
                let mut o = MoveOpts::new(Zone::Grave, s::DESTROY);
                o.alone = true;
                move_cards(c, &[u], &o)?;
            }
            Ok(())
        }
        Act::BreakOpp { n } => {
            // このクリーチャー(発生源)が、相手のシールドを n 個ブレイクする(破天九語)
            let me = f.controller;
            let have = c.s.players[opp(me) as usize].shield.len();
            let k = (*n).min(have as i32);
            if k <= 0 {
                return Ok(());
            }
            let pid = c.s.cards[f.source.uid as usize].pid;
            let id = c.s.next_id();
            let vars: Vars = vec![(s::PID, Val::Int(pid as i64)), (s::OWNER, Val::Int(me as i64)), (s::N, Val::Int(k as i64))];
            c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Break, stage: 0, vars }));
            Ok(())
        }
        Act::Win => {
            // 自分はゲームに勝つ
            if c.s.winner != Winner::None {
                return Ok(());
            }
            c.s.winner = Winner::P(f.controller);
            c.s.lose_reason = Some("効果による勝利".to_string());
            emit(c, s::GAME_OVER, vec![(s::WINNER, Val::Int(f.controller as i64)), (s::REASON, Val::Str(sym("効果による勝利")))]);
            Ok(())
        }
        Act::Rush { sel, if_attacked } => {
            // アビスラッシュ(効果で出したクリーチャー): このターン攻撃でき、ターンの終わりに(ifAttacked なら、攻撃していれば)山札の下に置く
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let (zone, pid) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.pid)
                };
                if zone != Zone::Battle {
                    continue;
                }
                let turn = c.s.turn;
                if let Some((po, pi)) = c.s.perm_by_pid(pid) {
                    let pm = &mut c.s.players[po as usize].battle[pi];
                    pm.rush = Some(turn);
                    if *if_attacked {
                        pm.rush_if_attacked = true;
                    }
                }
            }
            Ok(())
        }
        Act::Play { sel, alt } => {
            // そのカードを、別のコスト(alt)で使う(キリフダッシュ)。払えなければ何も起きない
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in uids {
                let fi = creature_face(c, u);
                if fi < 0 {
                    continue;
                }
                let (ep, zone) = {
                    let card = &c.s.cards[u as usize];
                    (card.ep, card.zone)
                };
                let id = c.s.next_id();
                let extra = match alt {
                    Some(a) => Val::Obj(Rc::new(vec![(sym("alt"), Val::Str(sym(a)))])),
                    None => Val::Null,
                };
                let mut vars: Vars = vec![
                    (s::UID, Val::Int(u as i64)),
                    (s::EP, Val::Int(ep as i64)),
                    (s::FROM, Val::zone(zone)),
                    (s::FACE, Val::Int(fi as i64)),
                    (s::FREE, Val::Bool(false)),
                ];
                if alt.is_some() {
                    vars.push((s::EXTRA, extra));
                }
                vars.push((s::AFTER, Val::Null));
                vars.push((s::SETTLE, Val::Bool(false)));
                vars.push((sym("soft"), Val::Bool(true)));
                c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Play, stage: 0, vars }));
            }
            Ok(())
        }
        Act::UseCip { sel } => {
            // そのカードの「このクリーチャーが出た時」で始まる能力を1つ使う(どのゾーンのカードでもよい。最初の1つ)
            // 捨てたばかりのカードなど、直前に動いたカードも指せるように、世代は見ない
            let uids = {
                let cc = cc_of(c.env(), f);
                match sel {
                    SelOrVar::Var(n) => var_uids(&cc, n, true),
                    SelOrVar::Sel(sl) => select_cards(&cc, sl),
                }
            };
            for u in uids {
                let (def, owner) = {
                    let card = &c.s.cards[u as usize];
                    (card.def, card.owner)
                };
                let nfaces = c.reg.defs[def as usize].faces.len();
                for fi in 0..nfaces {
                    let found = {
                        let face = &c.reg.defs[def as usize].faces[fi];
                        if !face.has_races && face.ty == FaceType::Spell {
                            continue;
                        }
                        c.reg.info(def, fi as i32).triggers.iter().copied().find(|&ti| match &face.abilities[ti as usize] {
                            Ability::Trigger { spec, gen, .. } => {
                                !*gen && spec.subject == Some(Subject::Self_) && spec.on.len() == 1 && spec.on[0].ty == s::ENTERED
                            }
                            _ => false,
                        })
                    };
                    let ti = match found {
                        Some(x) => x,
                        None => continue,
                    };
                    let evid = c.s.next_id();
                    let ev = Rc::new(Ev { id: evid, caused_by: None, ty: s::ENTERED, turn: c.s.turn, f: vec![(s::CARD, Val::Int(u as i64)), (s::OWNER, Val::Int(owner as i64))] });
                    let src = obj_ref(c, u);
                    push_effect(c, AbilityRef { def, face: fi as u8, idx: ti }, src, f.controller, Some(ev), true);
                    break;
                }
            }
            Ok(())
        }
        Act::GraveToBottom { who } => {
            // プレイヤーの墓地をシャッフルして、山札の下に置く
            let p = player_of(f, *who);
            let mut uids: Vec<i32> = c.s.players[p as usize].grave.clone();
            if uids.is_empty() {
                return Ok(());
            }
            shuffle_in_place(&mut c.s, &mut uids);
            let mut o = MoveOpts::new(Zone::Deck, s::EFFECT);
            o.pos = Some(false);
            move_cards(c, &uids, &o)?;
            Ok(())
        }
        Act::Log { ty } => {
            // 「そのターン中に〜を使っていなければ」の判定用の印
            emit(c, *ty, vec![(s::OWNER, Val::Int(f.controller as i64)), (s::SOURCE, Val::Int(f.source.uid as i64))]);
            Ok(())
        }
        Act::SetVar { as_, value, expr } => {
            let v = match expr {
                Some(x) => {
                    let cc = cc_of(c.env(), f);
                    Val::Int(eval_expr(&cc, x))
                }
                None => value.clone(),
            };
            var_set(&mut f.vars, *as_, v);
            Ok(())
        }
    }
}
