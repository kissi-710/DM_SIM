//! 効果のインタプリタ(src/engine/vm.ts)。フレームは pc と vars だけを持ち、再開できる。

use crate::ast::*;
use crate::cond::*;
use crate::ops::*;
use crate::registry::Instr;
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
    if who == Who::Opponent {
        opp(f.controller)
    } else {
        f.controller
    }
}

/// 創造面(クリーチャー面)のインデックス。呪文のみなら -1
fn creature_face(c: &Ctx, uid: i32) -> i32 {
    let def = &c.reg.defs[c.s.cards[uid as usize].def as usize];
    def.faces.iter().position(|x| x.ty.is_creature()).map_or(-1, |i| i as i32)
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
                            input: Some(InputSpec::Pick { candidates, min: 0, max: max as i32 }),
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
}

fn select_info(c: &Ctx, f: &EffectFrame, st: &SelectStep) -> SelInfo {
    let (cand, min0, max0) = {
        let cc = cc_of(c.env(), f);
        let cand = match &st.from {
            SelOrVar::Var(name) => var_uids(&cc, name, false),
            SelOrVar::Sel(sel) => select_cards(&cc, sel),
        };
        let min0 = st.min.as_ref().map_or(1, |e| eval_expr(&cc, e));
        let max0 = st.max.as_ref().map_or(1, |e| eval_expr(&cc, e));
        (cand, min0, max0)
    };
    let chooser: PlayerId = match st.who {
        Who::Opponent => opp(f.controller),
        Who::Iter => var_get(&f.vars, s::ITER).and_then(|v| v.as_int()).map_or(f.controller, |n| n as u8),
        Who::Controller => f.controller,
    };
    let max = max0.min(cand.len() as i64);
    let min = min0.min(max);
    SelInfo { cand, min, max, chooser }
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
    let SelInfo { cand, min, max, chooser } = select_info(c, f, st);
    let n = cand.len() as i64;
    let picked: Vec<i32>;
    if max == 0 {
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
                input: Some(InputSpec::Pick { candidates: cand.clone(), min: min as i32, max: max as i32 }),
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
        Act::Put { sel, as_ } | Act::Summon { sel, as_ } => Some((sel, *as_)),
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
        Act::Move { sel, to, cause, pos, tapped, as_ } => {
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            let mut o = MoveOpts::new(*to, *cause);
            o.pos = *pos;
            o.tapped = tapped.unwrap_or(false);
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
        Act::AddShield { n } => {
            for _ in 0..*n {
                add_shield_from_deck(c, f.controller)?;
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
            let targets = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            for u in targets {
                let (zone, pid) = {
                    let card = &c.s.cards[u as usize];
                    (card.zone, card.pid)
                };
                if zone != Zone::Battle {
                    continue;
                }
                for m in mods {
                    let id = c.s.next_id();
                    let until = duration_of(c, f, *until);
                    c.s.effects.push(ContEffect { id, pid, m: m.clone(), until, controller: f.controller });
                }
            }
            c.s.dirty_sba = true;
            Ok(())
        }
        Act::Put { sel, as_ } | Act::Summon { sel, as_ } => {
            let via = if matches!(act, Act::Summon { .. }) { s::SUMMON } else { s::EFFECT };
            let uids = {
                let cc = cc_of(c.env(), f);
                resolve_sel(&cc, sel)
            };
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            let mut entered: Vec<ObjRef> = Vec::new();
            for u in uids {
                let fi = creature_face(c, u);
                if fi < 0 {
                    continue;
                }
                let (face_ty, face_cost) = {
                    let fc = c.reg.face(c.s.cards[u as usize].def, fi);
                    (fc.ty, fc.cost)
                };
                if face_ty == FaceType::Evolution {
                    continue; // 進化元がないので出せない
                }
                if matches!(act, Act::Summon { .. }) && !crate::derive::can_summon(c.env(), c.s.cards[u as usize].owner, face_cost) {
                    continue; // 召喚できない効果を受けている
                }
                let mut o = MoveOpts::new(Zone::Battle, via);
                o.via = Some(via);
                o.face = Some(fi);
                o.paid = Some(0);
                let r = enter_battle(c, u, &o, &mut evs)?;
                if r.to == Zone::Battle {
                    entered.push(ObjRef { uid: u, ep: r.ep }); // G城の置換でマナゾーンに置かれたものは、出ていない
                }
            }
            if let Some(a) = as_ {
                var_set(&mut f.vars, *a, Val::refs(&entered));
            }
            c.s.batch_no += 1;
            collect_batch(c, &evs);
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
            let res = move_cards(c, &[a_card], &MoveOpts::new(Zone::Hand, s::REVOLUTION_CHANGE))?;
            if !res.first().map_or(false, |r| r.moved) {
                return Ok(()); // 置換されて離れなかった(EXライフなど): 入れ替わらない
            }
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            let mut o = MoveOpts::new(Zone::Battle, s::REVOLUTION_CHANGE);
            o.via = Some(s::REVOLUTION_CHANGE);
            o.face = Some(fi);
            o.tapped = true;
            o.paid = Some(0);
            enter_battle(c, uid, &o, &mut evs)?;
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
            let em = match m {
                PlayerMod::CannotCast => EffectMod::CannotCast,
                PlayerMod::CannotUseCost(x) => {
                    let cc = cc_of(c.env(), f);
                    EffectMod::CannotUseCost(eval_expr(&cc, x) as i32)
                }
                PlayerMod::CannotSummon(x) => {
                    let cc = cc_of(c.env(), f);
                    EffectMod::CannotSummon(eval_expr(&cc, x) as i32)
                }
            };
            let id = c.s.next_id();
            let until = duration_of(c, f, *until);
            c.s.effects.push(ContEffect { id, pid: -1, m: em, until, controller: f.controller });
            Ok(())
        }
        Act::Battle { a, b } => {
            // 効果によるバトル: a と b(どちらも変数の参照)のクリーチャーをバトルさせる。どちらかがバトルゾーンにいなければ何も起きない
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
            Ok(())
        }
        Act::Log { ty } => {
            // 「そのターン中に〜を使っていなければ」の判定用の印
            emit(c, *ty, vec![(s::OWNER, Val::Int(f.controller as i64)), (s::SOURCE, Val::Int(f.source.uid as i64))]);
            Ok(())
        }
        Act::SetVar { as_, value } => {
            var_set(&mut f.vars, *as_, value.clone());
            Ok(())
        }
    }
}
