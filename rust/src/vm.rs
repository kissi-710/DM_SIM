//! 効果のインタプリタ(src/engine/vm.ts)。フレームは pc と vars だけを持ち、再開できる。

use crate::ast::*;
use crate::cond::*;
use crate::ops::*;
use crate::registry::Instr;
use crate::types::*;
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
    def.faces.iter().position(|x| x.ty != FaceType::Spell).map_or(-1, |i| i as i32)
}

fn spell_face(c: &Ctx, uid: i32) -> i32 {
    let def = &c.reg.defs[c.s.cards[uid as usize].def as usize];
    def.faces.iter().position(|x| x.ty == FaceType::Spell).map_or(-1, |i| i as i32)
}

/// 実行を1命令進める。フレームが終われば true(呼び出し側が pop する)。
pub fn run_effect(c: &mut Ctx, fi: usize) -> Res<bool> {
    let mut f = match &c.s.cont[fi] {
        Frame::Effect(f) => f.clone(),
        _ => return fail("効果フレームではありません"),
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
            let ans = ask(c, NeedInput { player: f.controller, why: Why::May, input: Some(InputSpec::YesNo), source: Some(f.source) })?;
            f.pc = if ans.as_bool() == Some(true) { f.pc + 1 } else { *no };
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

fn exec_select(c: &mut Ctx, f: &mut EffectFrame, st: &SelectStep) -> Res<()> {
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
    let n = cand.len() as i64;
    let max = max0.min(n);
    let min = min0.min(max);
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
    let refs = refs_of(c, &picked);
    var_set(&mut f.vars, st.as_, Val::refs(&refs));
    if !picked.is_empty() {
        // 選んだものの公開(相手が選んだものなど)は、ログのためにイベントにする
        emit(
            c,
            s::CHOSEN,
            vec![(s::CARDS, Val::ints(&picked)), (s::BY, Val::Int(chooser as i64)), (s::SOURCE, Val::Int(f.source.uid as i64))],
        );
    }
    Ok(())
}

// ───────────────────────── 原始操作 ─────────────────────────

fn duration_of(c: &Ctx, f: &EffectFrame, until: UntilKind) -> Duration {
    match until {
        UntilKind::EndOfTurn => Duration::EndOfTurn { turn: c.s.turn },
        UntilKind::NextTurnStart => Duration::UntilTurnStart { player: f.controller, after_turn: c.s.turn },
        UntilKind::Source => Duration::Source { uid: f.source.uid, ep: f.source.ep },
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
            for u in uids {
                c.s.players[owner].deck.push(u);
                c.s.cards[u as usize].ep += 1;
            }
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
                let face_ty = c.reg.face(c.s.cards[u as usize].def, fi).ty;
                if face_ty == FaceType::Evolution {
                    continue; // 進化元がないので出せない
                }
                let mut o = MoveOpts::new(Zone::Battle, via);
                o.via = Some(via);
                o.face = Some(fi);
                o.paid = Some(0);
                let r = enter_battle(c, u, &o, &mut evs)?;
                entered.push(ObjRef { uid: u, ep: r.ep });
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
        Act::SetVar { as_, value } => {
            var_set(&mut f.vars, *as_, value.clone());
            Ok(())
        }
    }
}
