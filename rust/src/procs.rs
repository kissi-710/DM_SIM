//! 手続きフレーム: ターン進行・プレイ・攻撃・シールドブレイク・チェックポイント・状況起因処理(src/engine/procs.ts)。
//! 各ステージは「質問 → 変更」の順で書き、再実行しても二重に変更されない。

use crate::ast::*;
use crate::cond::*;
use crate::derive::*;
use crate::ops::*;
use crate::state::{extra_from_val, target_from_val, target_to_val, PlayExtra, Target};
use crate::types::*;
use std::rc::Rc;

// ───────────────────────── フレームの積み方 ─────────────────────────

pub fn push_proc(c: &mut Ctx, name: ProcName, vars: Vars) {
    let id = c.s.next_id();
    c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name, stage: 0, vars }));
}

fn pop_frame(c: &mut Ctx, id: i32) -> Res<()> {
    match c.s.cont.last() {
        Some(t) if t.id() == id => {
            c.s.cont.pop();
            Ok(())
        }
        _ => fail("フレームの積み順が不正です"),
    }
}

fn vi(v: &Vars, k: Sym) -> i64 {
    var_get(v, k).and_then(|x| x.as_int()).unwrap_or(0)
}

fn vb(v: &Vars, k: Sym) -> bool {
    var_get(v, k).map_or(false, |x| x.as_bool() == Some(true))
}

// ───────────────────────── プレイの計画(召喚・詠唱) ─────────────────────────

#[derive(Clone, Debug)]
pub struct PlayPlan {
    pub ok: bool,
    pub err: Option<&'static str>,
    pub face: i32,
    pub cast: bool,
    /// G城の実行(呪文を唱えることではない)
    pub castle: bool,
    pub cost: i32,
    pub need: i32,
    pub pay: Vec<i32>,
    pub after_bottom: bool,
    pub taps: Vec<i32>,
    pub onto: Option<i32>,
}

fn plan_fail(face: i32, err: &'static str) -> PlayPlan {
    PlayPlan { ok: false, err: Some(err), face, cast: false, castle: false, cost: 0, need: 0, pay: vec![], after_bottom: false, taps: vec![], onto: None }
}

pub fn plan_play(e: Env, player: PlayerId, uid: i32, from: Zone, face_idx: i32, extra: Option<&PlayExtra>, free: bool) -> PlayPlan {
    plan_play_inner(e, player, uid, from, face_idx, extra, free, true)
}

/// 使えるかだけを調べる(払うマナの選択は計算しない)。合法手の列挙で使う。
pub fn plan_play_ok(e: Env, player: PlayerId, uid: i32, from: Zone, face_idx: i32, extra: Option<&PlayExtra>, free: bool) -> bool {
    plan_play_inner(e, player, uid, from, face_idx, extra, free, false).ok
}

#[allow(clippy::too_many_arguments)]
fn plan_play_inner(e: Env, player: PlayerId, uid: i32, from: Zone, face_idx: i32, extra: Option<&PlayExtra>, free: bool, want_pay: bool) -> PlayPlan {
    crate::prof!(8);
    let s = e.s;
    let card = match s.cards.get(uid as usize) {
        Some(c) if c.owner == player => c,
        _ => return plan_fail(face_idx, "自分のカードではありません"),
    };
    if card.zone != from {
        return plan_fail(face_idx, "カードがそのゾーンにありません");
    }
    let def = &e.reg.defs[card.def as usize];
    let face = match def.faces.get(face_idx as usize) {
        Some(f) if face_idx >= 0 => f,
        _ => return plan_fail(face_idx, "面がありません"),
    };
    let info = e.reg.info(card.def, face_idx);
    let cast = face.ty == FaceType::Spell;
    let castle = face.ty == FaceType::Castle;
    let mut after_bottom = false;
    let perm_of = |f: Zone| -> Option<bool> {
        for &pi in &info.permissions {
            if let crate::ast::Ability::Permission { play_cast, from: pf, after_bottom } = &face.abilities[pi as usize] {
                if *pf == f && *play_cast == cast {
                    return Some(*after_bottom);
                }
            }
        }
        None
    };
    if from != Zone::Hand && !free {
        match perm_of(from) {
            None => return plan_fail(face_idx, "そのゾーンからはプレイできません"),
            Some(a) => after_bottom = a,
        }
    } else if from != Zone::Hand && free {
        after_bottom = perm_of(from).unwrap_or(false);
    }
    if cast && !can_cast(e, player, uid, face_idx) {
        return plan_fail(face_idx, "この呪文は唱えられません");
    }
    if !can_use_cost(e, player, face.cost) {
        return plan_fail(face_idx, "そのコストのカードは実行できません");
    }
    if face.ty.is_creature() && !can_summon(e, player, face.cost) {
        return plan_fail(face_idx, "そのクリーチャーは召喚できません");
    }
    let mut onto: Option<i32> = None;
    if face.ty == FaceType::Evolution {
        let target = extra.and_then(|x| x.onto).and_then(|p| s.perm_by_pid(p));
        let (po, pi) = match target {
            Some((po, pi)) if po == player => (po, pi),
            _ => return plan_fail(face_idx, "進化元を選んでください"),
        };
        let pm = &s.players[po as usize].battle[pi];
        let top = pm.cards[0];
        let cc = CC::new(e, player).with_self(uid).with_it(top, s.cards[top as usize].face);
        match &face.evolve_from {
            Some(cond) if eval_cond(&cc, cond) => {}
            _ => return plan_fail(face_idx, "進化元の条件を満たしていません"),
        }
        onto = Some(pm.pid);
    } else if extra.and_then(|x| x.onto).is_some() {
        return plan_fail(face_idx, "進化クリーチャーではありません");
    }
    let taps: Vec<i32> = extra.and_then(|x| x.tap.clone()).unwrap_or_default();
    if !taps.is_empty() {
        if !info.hyper_energy {
            return plan_fail(face_idx, "ハイパーエナジーを持ちません");
        }
        let mut seen: Vec<i32> = Vec::new();
        for &pid in &taps {
            let (po, pi) = match s.perm_by_pid(pid) {
                Some(x) => x,
                None => return plan_fail(face_idx, "タップできないクリーチャーです"),
            };
            let pm = &s.players[po as usize].battle[pi];
            if po != player || pm.tapped {
                return plan_fail(face_idx, "タップできないクリーチャーです");
            }
            let cost = chars_lite(e, pm.cards[0], -1).cost;
            if seen.contains(&cost) {
                return plan_fail(face_idx, "コストが互いに異なるクリーチャーを選んでください");
            }
            seen.push(cost);
        }
    }
    let cost = cost_of(e, uid, face_idx, &taps, free);
    let civs = &face.civs;
    let need = if free { 0 } else { pay_need(cost, civs.len() as i32) };
    let mut pay: Vec<i32> = Vec::new();
    if need > 0 {
        if let Some(m) = extra.and_then(|x| x.pay.as_ref()).filter(|m| !m.is_empty()) {
            // 手動支払い: 文明と枚数を検証
            let mut uniq = m.clone();
            uniq.sort();
            uniq.dedup();
            if m.len() as i32 != need || uniq.len() != m.len() {
                return plan_fail(face_idx, "支払うマナの枚数が違います");
            }
            for &u in m {
                match s.cards.get(u as usize) {
                    Some(mc) if mc.owner == player && mc.zone == Zone::Mana && !mc.tapped && u != uid => {}
                    _ => return plan_fail(face_idx, "そのマナは使えません"),
                }
            }
            if !covers(e, m, civs) {
                return plan_fail(face_idx, "文明を満たしていません");
            }
            pay = m.clone();
        } else {
            let exclude: Vec<i32> = if from == Zone::Mana { vec![uid] } else { vec![] };
            if want_pay {
                let keep: Vec<i32> = s.players[player as usize].hand.iter().copied().filter(|u| *u != uid).collect();
                match plan_payment(e, player, civs, need, &exclude, &keep) {
                    Some(p) => pay = p,
                    None => return plan_fail(face_idx, "マナが足りません"),
                }
            } else if !can_pay(e, player, civs, need, &exclude) {
                return plan_fail(face_idx, "マナが足りません");
            }
        }
    }
    PlayPlan { ok: true, err: None, face: face_idx, cast, castle, cost, need, pay, after_bottom, taps, onto }
}

/// 選んだマナが、必要な文明を1枚ずつ(1枚は1文明)満たせるか
pub fn covers(e: Env, mana: &[i32], civs: &[Civ]) -> bool {
    let cs: Vec<&[Civ]> = mana.iter().map(|&u| chars_lite(e, u, -1).civs).collect();
    let mut used = vec![false; mana.len()];
    fn go(i: usize, civs: &[Civ], cs: &[&[Civ]], used: &mut Vec<bool>) -> bool {
        if i == civs.len() {
            return true;
        }
        for j in 0..cs.len() {
            if used[j] || !cs[j].contains(&civs[i]) {
                continue;
            }
            used[j] = true;
            if go(i + 1, civs, cs, used) {
                return true;
            }
            used[j] = false;
        }
        false
    }
    go(0, civs, &cs, &mut used)
}

// ───────────────────────── ターン進行 ─────────────────────────

fn run_turn(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let p = c.s.active;
    match f.stage {
        0 => {
            if c.s.turn > c.s.cfg.turn_limit {
                c.s.winner = Winner::Draw;
                c.s.lose_reason = Some("ターン上限".to_string());
                emit(c, s::GAME_OVER, vec![(s::WINNER, Val::Str(s::DRAW)), (s::REASON, Val::Str(sym("ターン上限")))]);
                return Ok(());
            }
            c.s.step = Step::Start;
            c.s.turn_log.clear();
            c.s.skip_turn = false;
            c.s.mana_charged = false;
            // 自分のマナとクリーチャーをアンタップし、召喚酔いを解除する
            let mana: Vec<i32> = c.s.players[p as usize].mana.clone();
            for u in mana {
                c.s.cards[u as usize].tapped = false;
            }
            for perm in c.s.players[p as usize].battle.iter_mut() {
                perm.tapped = false;
                perm.sick = false;
            }
            // 「次の自分のターンのはじめまで」の期限切れ
            let turn = c.s.turn;
            c.s.effects.retain(|e| !matches!(e.until, Duration::UntilTurnStart { player, after_turn } if player == p && turn > after_turn));
            let ev = emit(c, s::STEP_START, vec![(s::STEP, Val::Str(s::START)), (s::PLAYER, Val::Int(p as i64))]);
            c.s.batch_no += 1;
            collect_batch(c, &[ev]);
            f.stage = 1;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        1 => {
            c.s.step = Step::Draw;
            let skip_draw = c.s.turn == 1 && p == c.s.first;
            if !skip_draw && !(c.s.cfg.solitaire && p == 1) {
                draw_cards(c, p, 1)?;
            }
            c.s.step = Step::Mana;
            f.stage = 2;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        2 => {
            if c.s.winner != Winner::None {
                return Ok(());
            }
            if c.s.skip_turn {
                c.s.step = Step::End;
                c.s.skip_turn = false;
                // L6: 設定で、ターン終了時の誘発を起こさないこともできる
                if !c.s.cfg.skip_runs_end_triggers {
                    var_set(&mut f.vars, s::NO_END, Val::Bool(true));
                }
            }
            if c.s.cfg.solitaire && p == 1 {
                c.s.step = Step::End;
            }
            if c.s.step == Step::End {
                f.stage = 3;
                return Ok(());
            }
            let id = c.s.next_id();
            c.s.pending = Some(Pending { id, player: p, why: Why::TurnAction, input: None, source: None });
            Ok(())
        }
        3 => {
            if vb(&f.vars, s::NO_END) {
                var_set(&mut f.vars, s::NO_END, Val::Bool(false));
                f.stage = 4;
                return Ok(());
            }
            let ev = emit(c, s::STEP_START, vec![(s::STEP, Val::Str(s::END)), (s::PLAYER, Val::Int(p as i64))]);
            c.s.batch_no += 1;
            collect_batch(c, &[ev]);
            f.stage = 4;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        4 => {
            let turn = c.s.turn;
            c.s.effects.retain(|e| !matches!(e.until, Duration::EndOfTurn { turn: t } if t <= turn));
            c.s.turn += 1;
            c.s.active = opp(p);
            c.s.step = Step::Start;
            f.stage = 0;
            Ok(())
        }
        _ => Ok(()),
    }
}

// ───────────────────────── プレイ(召喚・詠唱) ─────────────────────────

fn remove_from(c: &mut Ctx, uid: i32) {
    let (owner, zone) = {
        let card = &c.s.cards[uid as usize];
        (card.owner as usize, card.zone)
    };
    match zone {
        Zone::Limbo => {
            if let Some(i) = c.s.limbo.iter().position(|x| *x == uid) {
                c.s.limbo.remove(i);
            }
        }
        Zone::Battle => {}
        z => {
            let own = &mut c.s.players[owner];
            let arr = match z {
                Zone::Deck => &mut own.deck,
                Zone::Hand => &mut own.hand,
                Zone::Mana => &mut own.mana,
                Zone::Shield => &mut own.shield,
                Zone::Hyper => &mut own.hyper,
                _ => &mut own.grave,
            };
            if let Some(i) = arr.iter().position(|x| *x == uid) {
                arr.remove(i);
            }
        }
    }
}

fn run_play(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let uid = vi(&f.vars, s::UID) as i32;
    match f.stage {
        0 => {
            let ep = vi(&f.vars, s::EP) as i32;
            let from = var_get(&f.vars, s::FROM).and_then(|v| v.as_sym()).and_then(Zone::from_sym);
            let ok = match c.s.cards.get(uid as usize) {
                Some(card) => card.ep == ep && Some(card.zone) == from,
                None => false,
            };
            if !ok {
                return pop_frame(c, f.id); // 何かの効果で離れた
            }
            let from = from.unwrap();
            let owner = c.s.cards[uid as usize].owner;
            let extra: Option<PlayExtra> = var_get(&f.vars, s::EXTRA).and_then(extra_from_val);
            let free = vb(&f.vars, s::FREE);
            let face = vi(&f.vars, s::FACE) as i32;
            let plan = plan_play(c.env(), owner, uid, from, face, extra.as_ref(), free);
            if !plan.ok {
                if free {
                    return pop_frame(c, f.id); // 無料で使えない(進化元がない等)
                }
                return fail(format!("プレイできません: {}", plan.err.unwrap_or("")));
            }
            // ハイパーエナジー: クリーチャーをタップ
            for &pid in &plan.taps {
                if let Some(pm) = c.s.perm(pid) {
                    let top = pm.cards[0];
                    set_tapped(c, top, true);
                }
            }
            for &u in &plan.pay {
                set_tapped(c, u, true);
            }
            // プレイ中として処理する(場所は limbo)
            let prev_zone = c.s.cards[uid as usize].zone;
            remove_from(c, uid);
            {
                let card = &mut c.s.cards[uid as usize];
                card.zone = Zone::Limbo;
                card.ep += 1;
                card.face = plan.face;
            }
            c.s.limbo.push(uid);
            let plan_val = Val::Obj(Rc::new(vec![
                (s::KIND, Val::Str(if plan.cast { s::CAST } else if plan.castle { s::CASTLE } else { s::SUMMON })),
                (s::PAID, Val::Int(plan.pay.len() as i64)),
                (s::COST, Val::Int(plan.cost as i64)),
                (s::AFTER, if plan.after_bottom { Val::Str(s::DECK_BOTTOM) } else { Val::Null }),
                (s::ONTO, plan.onto.map_or(Val::Null, |o| Val::Int(o as i64))),
                (s::FACE, Val::Int(plan.face as i64)),
                (s::FREE, Val::Bool(free)),
            ]));
            var_set(&mut f.vars, s::PLAN, plan_val);
            var_set(&mut f.vars, s::FROM_ZONE, Val::zone(prev_zone));
            f.stage = 1;
            Ok(())
        }
        1 => {
            let p = var_get(&f.vars, s::PLAN).cloned().unwrap_or(Val::Null);
            let kind = p.get(s::KIND).and_then(|x| x.as_sym());
            let face = p.get(s::FACE).and_then(|x| x.as_int()).unwrap_or(0) as i32;
            let paid = p.get(s::PAID).and_then(|x| x.as_int()).unwrap_or(0) as i32;
            let cost = p.get(s::COST).and_then(|x| x.as_int()).unwrap_or(0) as i32;
            let free = p.get(s::FREE).and_then(|x| x.as_bool()).unwrap_or(false);
            let owner = c.s.cards[uid as usize].owner;
            if kind == Some(s::SUMMON) {
                let mut evs: Vec<Rc<Ev>> = Vec::new();
                let mut o = MoveOpts::new(Zone::Battle, s::SUMMON);
                o.via = Some(s::SUMMON);
                o.onto = p.get(s::ONTO).and_then(|x| x.as_i32());
                o.face = Some(face);
                o.paid = Some(paid);
                o.cost = Some(cost);
                o.free = free;
                enter_battle(c, uid, &o, &mut evs)?;
                c.s.batch_no += 1;
                collect_batch(c, &evs);
                c.s.dirty_sba = true;
                f.stage = 3;
                return Ok(());
            }
            let from_zone = var_get(&f.vars, s::FROM_ZONE).cloned().unwrap_or(Val::Null);
            if kind == Some(s::CASTLE) {
                // G城の実行: 呪文を唱えたことにはならない。表向きのシールドとして置く(シールドゾーンに置かれた時の誘発を集める)
                let ev = emit(
                    c,
                    s::EXECUTED,
                    vec![
                        (s::CARD, Val::Int(uid as i64)),
                        (s::OWNER, Val::Int(owner as i64)),
                        (s::FREE, Val::Bool(free)),
                        (s::PAID, Val::Int(paid as i64)),
                        (s::COST, Val::Int(cost as i64)),
                        (s::FACE, Val::Int(face as i64)),
                        (s::FROM, from_zone),
                    ],
                );
                c.s.batch_no += 1;
                collect_batch(c, &[ev]);
                let mut o = MoveOpts::new(Zone::Shield, s::CASTLE);
                o.up = true;
                o.no_replace = true;
                move_cards(c, &[uid], &o)?;
                f.stage = 3;
                return Ok(());
            }
            let ev = emit(
                c,
                s::CAST,
                vec![
                    (s::CARD, Val::Int(uid as i64)),
                    (s::OWNER, Val::Int(owner as i64)),
                    (s::FREE, Val::Bool(free)),
                    (s::PAID, Val::Int(paid as i64)),
                    (s::COST, Val::Int(cost as i64)),
                    (s::FACE, Val::Int(face as i64)),
                    (s::FROM, from_zone),
                ],
            );
            c.s.batch_no += 1;
            collect_batch(c, &[ev.clone()]);
            f.stage = 2;
            let (def, ep) = {
                let card = &c.s.cards[uid as usize];
                (card.def, card.ep)
            };
            if let Some(spell_idx) = c.reg.info(def, face).spell {
                let id = c.s.next_id();
                let lki = Rc::new(snap_of(c.env(), uid));
                c.s.cont.push(Frame::Effect(EffectFrame {
                    id,
                    caused_by: Some(ev.id),
                    ability: AbilityRef { def, face: face as u8, idx: spell_idx },
                    source: ObjRef { uid, ep },
                    lki,
                    controller: owner,
                    pc: 0,
                    vars: vec![],
                    trigger: Some(ev),
                    no_optional: false,
                }));
            }
            Ok(())
        }
        2 => {
            // 呪文の解決後。墓地(または山札の下)に置く
            let p = var_get(&f.vars, s::PLAN).cloned().unwrap_or(Val::Null);
            if c.s.cards[uid as usize].zone == Zone::Limbo {
                let plan_bottom = p.get(s::AFTER).and_then(|x| x.as_sym()) == Some(s::DECK_BOTTOM);
                let var_bottom = var_get(&f.vars, s::AFTER).and_then(|x| x.as_sym()) == Some(s::DECK_BOTTOM);
                let var_hyper = var_get(&f.vars, s::AFTER).and_then(|x| x.as_sym()) == Some(s::Z_HYPER);
                if var_hyper {
                    // インターステラ: 墓地(や山札の下)のかわりに超次元ゾーンに置く
                    let mut o = MoveOpts::new(Zone::Hyper, s::CAST_HYPER);
                    o.no_replace = true;
                    move_cards(c, &[uid], &o)?;
                } else if plan_bottom || var_bottom {
                    let mut o = MoveOpts::new(Zone::Deck, s::CAST_BOTTOM);
                    o.pos = Some(false);
                    o.no_replace = true;
                    move_cards(c, &[uid], &o)?;
                } else {
                    // 呪文自身の効果が、自身の移動を置換する(チャージャーなど)。他の置換効果より優先する(409.2b / 609.8a)。
                    // 質問は、状態を変更する前に行う
                    let face = p.get(s::FACE).and_then(|x| x.as_int()).unwrap_or(0) as i32;
                    let (def, owner, ep) = {
                        let cd = &c.s.cards[uid as usize];
                        (cd.def, cd.owner, cd.ep)
                    };
                    let reg = c.reg;
                    let mut dest: Option<Zone> = None;
                    for &ri in &reg.info(def, face).replaces {
                        if let Ability::Replace { match_, apply, optional, while_, .. } = &reg.face(def, face).abilities[ri as usize] {
                            let to = match apply {
                                ReplaceApply::ChangeDest(to) => *to,
                                _ => continue,
                            };
                            if match_.ty != s::MOVED || match_.cause != Some(s::CAST) {
                                continue;
                            }
                            if let Some(w) = while_ {
                                if !eval_cond(&CC::new(c.env(), owner).with_self(uid), w) {
                                    continue;
                                }
                            }
                            if *optional {
                                let ans = ask(c, NeedInput { player: owner, why: Why::May, input: Some(InputSpec::YesNo), source: Some(ObjRef { uid, ep }) })?;
                                if ans.as_bool() != Some(true) {
                                    continue;
                                }
                            }
                            dest = Some(to);
                            break;
                        }
                    }
                    let mut o = match dest {
                        Some(z) => MoveOpts::new(z, s::REPLACED),
                        None => MoveOpts::new(Zone::Grave, s::CAST),
                    };
                    o.no_replace = true;
                    move_cards(c, &[uid], &o)?;
                }
            }
            f.stage = 3;
            Ok(())
        }
        3 => pop_frame(c, f.id),
        _ => Ok(()),
    }
}

// ───────────────────────── 攻撃 ─────────────────────────

/// そのイベントの種類を監視する能力が、対局のデッキのカードにあるか(なければ、イベントを発行しない)。
/// TS 版(ops.ts の listens)と同じ: デッキが分からない状態では、カードDB全体で調べる
fn has_listener(c: &Ctx, ty: Sym) -> bool {
    let by_def = match c.reg.trig_by_def.get(ty.0 as usize) {
        Some(Some(v)) => v,
        _ => return false,
    };
    let ids = &c.s.deck_ids;
    if ids.len() < 2 || ids[0].is_empty() || ids[1].is_empty() {
        return true;
    }
    ids.iter().any(|l| l.iter().any(|&d| by_def.get(d as usize).map_or(false, |r| !r.is_empty())))
}

fn run_attack(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let pid = vi(&f.vars, s::PID) as i32;
    match f.stage {
        0 => {
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return pop_frame(c, f.id),
            };
            let (top, perm_pid) = {
                let pm = &c.s.players[po as usize].battle[pi];
                (pm.cards[0], pm.pid)
            };
            set_tapped(c, top, true);
            let target = var_get(&f.vars, s::TARGET).cloned().unwrap_or(Val::Null);
            let ev = emit(
                c,
                s::ATTACK_DECLARED,
                vec![(s::CARD, Val::Int(top as i64)), (s::ATTACKER, Val::Int(perm_pid as i64)), (s::OWNER, Val::Int(po as i64)), (s::TARGET, target)],
            );
            c.s.batch_no += 1;
            collect_batch(c, &[ev]);
            f.stage = 1;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        1 => {
            if c.s.winner != Winner::None || c.s.skip_turn {
                return pop_frame(c, f.id);
            }
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return pop_frame(c, f.id),
            };
            let target = var_get(&f.vars, s::TARGET).and_then(target_from_val).unwrap_or(Target::Player);
            if let Target::Creature(tp) = &target {
                if c.s.perm_by_pid(*tp).is_none() {
                    return pop_frame(c, f.id); // 攻撃先が場を離れた → 攻撃は終了
                }
            }
            let defender = opp(po);
            // 攻撃されているクリーチャー自身は、ブロッカーとして選べない(総合ルール 507.1a)
            let attacked = match &target {
                Target::Creature(p) => *p,
                Target::Player => -1,
            };
            let cands: Vec<i32> = {
                let e = c.env();
                if is_unblockable(e, &c.s.players[po as usize].battle[pi]) {
                    Vec::new()
                } else {
                    c.s.players[defender as usize].battle.iter().filter(|p| p.pid != attacked && can_block(e, p)).map(|p| p.cards[0]).collect()
                }
            };
            // ブロッカーは、複数体を同時に選べる(507.1a / 507.2)。ブロックを強制する効果を受けているものは、必ず選ぶ(507.1b)。
            // 選んだ全員がタップし、最後に解決した1体だけが、攻撃先を変更してブロッククリーチャーになる(507.2a)
            let forced: Vec<i32> = {
                let e = c.env();
                cands
                    .iter()
                    .copied()
                    .filter(|&u| c.s.perm(c.s.cards[u as usize].pid).map_or(false, |p| must_block(e, p)))
                    .collect()
            };
            let mut chosen: Vec<i32> = Vec::new();
            if !forced.is_empty() {
                chosen = forced;
            } else if !cands.is_empty() {
                let n = cands.len() as i32;
                let ans = ask(c, NeedInput { player: defender, why: Why::Block, input: Some(InputSpec::Pick { candidates: cands, min: 0, max: n }), source: None })?;
                chosen = ans.to_i32s();
            }
            let mut blocker: Option<i32> = None;
            if chosen.len() == 1 {
                blocker = Some(chosen[0]);
            } else if chosen.len() > 1 {
                let ans = ask(c, NeedInput { player: defender, why: Why::Block, input: Some(InputSpec::Pick { candidates: chosen.clone(), min: 1, max: 1 }), source: None })?;
                blocker = ans.to_i32s().first().copied();
            }
            if let Some(b) = blocker {
                let bpid = c.s.cards[b as usize].pid;
                let bperm_pid = match c.s.perm(bpid) {
                    Some(p) => p.pid,
                    None => return fail("ブロッカーの山がありません"),
                };
                for &u in &chosen {
                    set_tapped(c, u, true);
                }
                var_set(&mut f.vars, s::TARGET, target_to_val(&Target::Creature(bperm_pid)));
                var_set(&mut f.vars, s::BLOCKED, Val::Bool(true));
                let (aperm_pid, atop) = {
                    let pm = &c.s.players[po as usize].battle[pi];
                    (pm.pid, pm.cards[0])
                };
                let ev = emit(
                    c,
                    s::BLOCKED,
                    vec![
                        (s::ATTACKER, Val::Int(aperm_pid as i64)),
                        (s::ATTACKER_CARD, Val::Int(atop as i64)),
                        (s::BLOCKER, Val::Int(bperm_pid as i64)),
                        (s::CARD, Val::Int(b as i64)),
                        (s::OWNER, Val::Int(defender as i64)),
                    ],
                );
                c.s.batch_no += 1;
                collect_batch(c, &[ev]);
                f.stage = 2;
                push_proc(c, ProcName::Settle, vec![]);
            } else {
                f.stage = 2;
            }
            Ok(())
        }
        2 => {
            if c.s.winner != Winner::None || c.s.skip_turn {
                return pop_frame(c, f.id);
            }
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return pop_frame(c, f.id),
            };
            let target = var_get(&f.vars, s::TARGET).and_then(target_from_val).unwrap_or(Target::Player);
            let (a_pid, a_top) = {
                let pm = &c.s.players[po as usize].battle[pi];
                (pm.pid, pm.cards[0])
            };
            match target {
                Target::Player => {
                    f.stage = 3;
                    let n = {
                        let pm = &c.s.players[po as usize].battle[pi];
                        breaker_count(c.env(), pm)
                    };
                    push_proc(
                        c,
                        ProcName::Break,
                        vec![(s::PID, Val::Int(a_pid as i64)), (s::OWNER, Val::Int(po as i64)), (s::N, Val::Int(n as i64))],
                    );
                    Ok(())
                }
                Target::Creature(tp) => {
                    let (dop, di) = match c.s.perm_by_pid(tp) {
                        Some(x) => x,
                        None => return pop_frame(c, f.id),
                    };
                    // 「バトルする時」の誘発は、パワーを比べる前に解決する(総合ルール 115.2 / 701.13a)。
                    // 聞き手のいるカードがある時だけ、イベントを発行する(段階を増やさず、既存の対戦の記録を変えない)
                    f.stage = 4;
                    if has_listener(c, s::BATTLE_STARTED) {
                        let d_top = c.s.players[dop as usize].battle[di].cards[0];
                        let ev = emit(
                            c,
                            s::BATTLE_STARTED,
                            vec![
                                (s::ATTACKER, Val::Int(a_pid as i64)),
                                (s::DEFENDER, Val::Int(tp as i64)),
                                (s::ATTACKER_CARD, Val::Int(a_top as i64)),
                                (s::DEFENDER_CARD, Val::Int(d_top as i64)),
                                (s::OWNER, Val::Int(po as i64)),
                            ],
                        );
                        c.s.batch_no += 1;
                        collect_batch(c, &[ev]);
                        push_proc(c, ProcName::Settle, vec![]);
                    }
                    Ok(())
                }
            }
        }
        4 => {
            // バトル。「バトルする時」の効果の解決で、どちらかが場を離れていれば、バトルは行われない(115.3a)
            if c.s.winner != Winner::None || c.s.skip_turn {
                return pop_frame(c, f.id);
            }
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return pop_frame(c, f.id),
            };
            let target = var_get(&f.vars, s::TARGET).and_then(target_from_val).unwrap_or(Target::Player);
            let tp = match target {
                Target::Creature(tp) => tp,
                Target::Player => return pop_frame(c, f.id),
            };
            let a_pid = c.s.players[po as usize].battle[pi].pid;
            {
                let br = match resolve_battle(c, a_pid, tp)? {
                    Some(b) => b,
                    None => return pop_frame(c, f.id),
                };
                // 「バトルの後」の誘発のために、バトルの当事者を残す(聞き手がいる時だけ)
                if has_listener(c, s::AFTER_BATTLE) {
                    var_set(
                        &mut f.vars,
                        sym("battle"),
                        Val::Obj(Rc::new(vec![
                            (s::ATTACKER, Val::Int(br.a_pid as i64)),
                            (s::DEFENDER, Val::Int(br.d_pid as i64)),
                            (s::ATTACKER_CARD, Val::Int(br.a_top as i64)),
                            (s::DEFENDER_CARD, Val::Int(br.d_top as i64)),
                            (s::OWNER, Val::Int(br.a_owner as i64)),
                        ])),
                    );
                }
                f.stage = 5;
                push_proc(c, ProcName::Settle, vec![]);
                Ok(())
            }
        }
        5 => {
            // 「バトルの後」の誘発(総合ルール 701.13d)。勝敗の誘発を解決し終えた後に誘発する
            if has_listener(c, s::AFTER_BATTLE) && c.s.winner == Winner::None && !c.s.skip_turn {
                if let Some(Val::Obj(o)) = var_get(&f.vars, sym("battle")).cloned() {
                    let ev = emit(c, s::AFTER_BATTLE, o.iter().map(|(k, v)| (*k, v.clone())).collect());
                    c.s.batch_no += 1;
                    collect_batch(c, &[ev]);
                    f.stage = 3;
                    push_proc(c, ProcName::Settle, vec![]);
                    return Ok(());
                }
            }
            pop_frame(c, f.id)
        }
        3 => pop_frame(c, f.id),
        _ => Ok(()),
    }
}

// ───────────────────────── シールドブレイク ─────────────────────────

fn run_break(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let attacker_owner = vi(&f.vars, s::OWNER) as u8;
    let defender = opp(attacker_owner);
    match f.stage {
        0 => {
            let shields = c.s.players[defender as usize].shield.clone();
            if shields.is_empty() {
                // 攻撃先が変更されないまま、シールドが0枚の相手プレイヤーへの攻撃が成立 → 勝利。
                // 負ける側の「ゲームに負ける時、かわりに〜してもよい」(ジャオウガ)を使えるなら、勝敗は決まらず攻撃は終わる
                if loss_replacement(c, defender, false)? {
                    f.stage = 2;
                    push_proc(c, ProcName::Settle, vec![]);
                    return Ok(());
                }
                c.s.winner = Winner::P(attacker_owner);
                c.s.lose_reason = Some("ダイレクトアタック".to_string());
                emit(c, s::GAME_OVER, vec![(s::WINNER, Val::Int(attacker_owner as i64)), (s::REASON, Val::Str(sym("ダイレクトアタック")))]);
                return pop_frame(c, f.id);
            }
            let n = (vi(&f.vars, s::N) as usize).min(shields.len());
            let mut broken: Vec<i32> = Vec::new();
            if n < shields.len() && shield_classes(&c.s, &shields).len() >= 2 {
                // 見分けのつくシールド(EXライフなど)があり、全部は割れない: どれを割るかは攻撃側が選ぶ(509.3)
                let ans = ask(
                    c,
                    NeedInput { player: attacker_owner, why: Why::PickShield, input: Some(InputSpec::Pick { candidates: shields.clone(), min: n as i32, max: n as i32 }), source: None },
                )?;
                broken = ans.to_i32s();
            } else {
                // 見分けがつかない(全部が裏向きで同じ扱い)ので、無作為に扱う(spec 3.7)
                let mut pool = shields;
                while broken.len() < n {
                    let i = c.s.rng_int(pool.len());
                    broken.push(pool.remove(i));
                }
            }
            var_set(&mut f.vars, s::BROKEN, Val::ints(&broken));
            // 「ブレイクする前に」の誘発は、ブレイクするシールドを選んだ後、ブレイクする前に解決する(総合ルール 509.3 / 509.4)。
            // 聞き手のいるカードがある時だけ、イベントを発行する(既存の対戦の記録を変えない)
            f.stage = 3;
            if has_listener(c, s::BEFORE_BREAK) {
                let by = vi(&f.vars, s::PID);
                let ev = emit(
                    c,
                    s::BEFORE_BREAK,
                    vec![
                        (s::ATTACKER, Val::Int(by)),
                        (s::OWNER, Val::Int(attacker_owner as i64)),
                        (sym("defenderOwner"), Val::Int(defender as i64)),
                        (s::CARDS, Val::ints(&broken)),
                    ],
                );
                c.s.batch_no += 1;
                collect_batch(c, &[ev]);
                push_proc(c, ProcName::Settle, vec![]);
            }
            Ok(())
        }
        3 => {
            // 「ブレイクする前に」の効果の解決でクリーチャーが場を離れても、すでに選んだシールドはブレイクされる(509.4c)。
            // シールドゾーンから離れたカードだけは、ブレイクできない
            let broken: Vec<i32> = var_get(&f.vars, s::BROKEN)
                .map(|v| v.to_i32s())
                .unwrap_or_default()
                .into_iter()
                .filter(|&u| {
                    let cd = &c.s.cards[u as usize];
                    cd.zone == Zone::Shield && cd.owner == defender
                })
                .collect();
            var_set(&mut f.vars, s::BROKEN, Val::ints(&broken));
            if broken.is_empty() {
                return pop_frame(c, f.id);
            }
            c.s.breaking = broken.clone();
            let by = vi(&f.vars, s::PID);
            let mut evs: Vec<Rc<Ev>> = Vec::new();
            for &u in &broken {
                evs.push(emit(c, s::SHIELD_BROKEN, vec![(s::CARD, Val::Int(u as i64)), (s::OWNER, Val::Int(defender as i64)), (s::BY, Val::Int(by))]));
            }
            c.s.batch_no += 1;
            collect_batch(c, &evs);
            f.stage = 1;
            Ok(())
        }
        1 => {
            let broken: Vec<i32> = var_get(&f.vars, s::BROKEN).map(|v| v.to_i32s()).unwrap_or_default();
            c.s.breaking = broken.clone(); // 再実行時の復元
            // S・トリガー/G・ストライクを宣言できるカード(革命2は、ブレイク後の枚数で判定)
            let cands: Vec<i32> = broken.iter().copied().filter(|&u| declaration(c.env(), u).is_some()).collect();
            let mut declared: Vec<i32> = Vec::new();
            if !cands.is_empty() {
                let max = cands.len() as i32;
                let ans = ask(
                    c,
                    NeedInput { player: defender, why: Why::TriggerDeclare, input: Some(InputSpec::Pick { candidates: cands, min: 0, max }), source: None },
                )?;
                declared = ans.to_i32s();
            }
            // 宣言がすべて終わってから、手札に加える(112.3a)
            let kinds: Vec<(i32, Decl)> = declared.iter().filter_map(|&u| declaration(c.env(), u).map(|d| (u, d))).collect();
            let mut o = MoveOpts::new(Zone::Hand, s::BREAK);
            o.no_replace = true;
            move_cards(c, &broken, &o)?;
            c.s.breaking.clear();
            c.s.batch_no += 1;
            let batch = c.s.batch_no;
            for (u, d) in kinds {
                let kind_sym = if d.kind == PoolKind::ShieldTrigger { s::SHIELD_TRIGGER } else { s::G_STRIKE };
                emit(c, s::TRIGGER_DECLARED, vec![(s::CARD, Val::Int(u as i64)), (s::OWNER, Val::Int(defender as i64)), (s::KIND, Val::Str(kind_sym))]);
                let (ep, id) = {
                    let ep = c.s.cards[u as usize].ep;
                    (ep, c.s.next_id())
                };
                let lki = Rc::new(snap_of(c.env(), u));
                c.s.pool.push(PoolEntry {
                    id,
                    batch,
                    ability: Some(d.aref),
                    kind: d.kind,
                    source: ObjRef { uid: u, ep },
                    lki,
                    controller: defender,
                    event: None,
                    st_layer: true,
                    declared: false,
                });
            }
            f.stage = 2;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        2 => pop_frame(c, f.id),
        _ => Ok(()),
    }
}

/// シールドを「攻撃側から見て見分けがつくか」で分けた組(シールドゾーンの並びの順。procs.ts の shieldClasses)。
/// 裏向きのシールドはどれも同じ扱い(組 -1)。見分けがつくのは、EXライフのシールド(紐づくクリーチャーごとに組が分かれる)と、
/// 表向きのシールド(G城。同じ札ごとに組が分かれる。キーは -2 - 定義番号)。
pub fn shield_classes(s: &State, shields: &[i32]) -> Vec<Vec<i32>> {
    let mut groups: Vec<(i32, Vec<i32>)> = Vec::new();
    for &u in shields {
        let card = &s.cards[u as usize];
        let key = if card.up {
            -2 - card.def as i32
        } else if card.ex {
            card.ex_pid
        } else {
            -1
        };
        match groups.iter_mut().find(|g| g.0 == key) {
            Some(g) => g.1.push(u),
            None => groups.push((key, vec![u])),
        }
    }
    groups.into_iter().map(|g| g.1).collect()
}

/// ブレイクするシールドの選び方を、見分けがつく違いごとに1つずつ(procs.ts の shieldPickChoices)。
pub fn shield_pick_choices(s: &State, shields: &[i32], n: usize) -> Vec<Vec<i32>> {
    let classes = shield_classes(s, shields);
    let mut out: Vec<Vec<i32>> = Vec::new();
    fn go(classes: &[Vec<i32>], i: usize, left: usize, cur: &mut Vec<i32>, out: &mut Vec<Vec<i32>>) {
        if i == classes.len() {
            if left == 0 {
                out.push(cur.clone());
            }
            return;
        }
        for k in 0..=classes[i].len().min(left) {
            let len = cur.len();
            cur.extend_from_slice(&classes[i][..k]);
            go(classes, i + 1, left - k, cur, out);
            cur.truncate(len);
        }
    }
    go(&classes, 0, n, &mut Vec::new(), &mut out);
    out
}

#[derive(Clone, Copy)]
pub struct Decl {
    pub kind: PoolKind,
    pub aref: AbilityRef,
    pub face: i32,
}

/// シールドゾーンから手札に加わる時に宣言できる能力(S・トリガー / G・ストライク)。
pub fn declaration(e: Env, uid: i32) -> Option<Decl> {
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let cc = CC::new(e, card.owner).with_self(uid);
    for (fi, face) in def.faces.iter().enumerate() {
        let info = e.reg.info(card.def, fi as i32);
        for &si in &info.shield_triggers {
            if let Ability::Keyword { while_: Some(w), .. } = &face.abilities[si as usize] {
                if !eval_cond(&cc, w) {
                    continue;
                }
            }
            return Some(Decl { kind: PoolKind::ShieldTrigger, aref: AbilityRef { def: card.def, face: fi as u8, idx: si }, face: fi as i32 });
        }
        if let Some(gi) = info.g_strike {
            return Some(Decl { kind: PoolKind::GStrike, aref: AbilityRef { def: card.def, face: fi as u8, idx: gi }, face: fi as i32 });
        }
    }
    None
}

// ───────────────────────── チェックポイント ─────────────────────────

/// 待機プールから次に解決する能力の候補を選ぶ(101.4 / effects 5.2)
fn pick_next_candidates(c: &Ctx) -> Option<(PlayerId, Vec<usize>)> {
    let s = &c.s;
    if s.pool.is_empty() {
        return None;
    }
    let st: Vec<usize> = s.pool.iter().enumerate().filter(|(_, e)| e.st_layer).map(|(i, _)| i).collect();
    let group: Vec<usize>;
    if !st.is_empty() {
        let max_batch = st.iter().map(|&i| s.pool[i].batch).max().unwrap();
        group = st.into_iter().filter(|&i| s.pool[i].batch == max_batch).collect();
    } else {
        let all: Vec<usize> = (0..s.pool.len()).collect();
        group = match s.cfg.waiting_policy {
            WaitingPolicy::NewFirst => {
                let m = all.iter().map(|&i| s.pool[i].batch).max().unwrap();
                all.into_iter().filter(|&i| s.pool[i].batch == m).collect()
            }
            WaitingPolicy::OldFirst => {
                let m = all.iter().map(|&i| s.pool[i].batch).min().unwrap();
                all.into_iter().filter(|&i| s.pool[i].batch == m).collect()
            }
            WaitingPolicy::Pool => all,
        };
    }
    let tp: Vec<usize> = group.iter().copied().filter(|&i| s.pool[i].controller == s.active).collect();
    if !tp.is_empty() {
        return Some((s.active, tp));
    }
    Some((opp(s.active), group))
}

fn run_settle(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    // 状況起因処理(1回につき1つの変更を行い、再びここへ戻る)
    if run_sba(c)? {
        return Ok(());
    }
    if c.s.winner != Winner::None {
        return pop_frame(c, f.id);
    }
    // 宣言を確定したら、いったんここで終える(質問は状態を変更する前に行う規約。次の回で解決順を聞く)
    if declare_hidden(c)? {
        return Ok(());
    }
    let (player, entries) = match pick_next_candidates(c) {
        Some(x) => x,
        None => return pop_frame(c, f.id),
    };
    // 同じ能力(同じカード・同じ能力)ばかりなら、順序で結果が変わらないので質問しない(effects 12)
    let first = &c.s.pool[entries[0]];
    let same = entries.iter().all(|&i| {
        let e = &c.s.pool[i];
        e.kind == first.kind && e.controller == first.controller && e.lki.def == first.lki.def && e.ability == first.ability
    });
    let chosen_pool_idx: usize;
    if entries.len() == 1 || same || c.s.cfg.auto_order[player as usize] {
        chosen_pool_idx = entries[0];
    } else {
        let cands: Vec<i32> = entries.iter().map(|&i| c.s.pool[i].id).collect();
        let labels: Vec<String> = entries.iter().map(|_| String::new()).collect();
        let ans = ask(c, NeedInput { player, why: Why::PickNext, input: Some(InputSpec::Order { candidates: cands, labels }), source: None })?;
        let id = ans.as_i32().unwrap_or(-1);
        chosen_pool_idx = entries.iter().copied().find(|&i| c.s.pool[i].id == id).unwrap_or(entries[0]);
    }
    let chosen = c.s.pool.remove(chosen_pool_idx);
    resolve_entry(c, chosen)
}

/// 条件を持つ誘発型能力が、いま条件を満たしているか。解決の時点で満たしていれば解決される
/// (総合ルール 603.4。誘発した時点で満たしているかは問わない)。
fn trigger_condition_holds(c: &Ctx, e: &PoolEntry) -> bool {
    if e.kind != PoolKind::Ability {
        return true;
    }
    if let Some(ar) = e.ability {
        if let Ability::Trigger { spec, .. } = c.reg.ability(ar) {
            if spec.if_.is_some() || spec.if_at_resolve.is_some() {
                let env = c.env();
                let mut cc = CC::new(env, e.controller).with_self(e.source.uid);
                cc.self_snap = Some(&e.lki);
                cc.it = e.event.as_ref().and_then(|ev| ev.get(s::CARD)).and_then(|v| v.as_i32());
                cc.it_face = -1;
                if let Some(cnd) = &spec.if_ {
                    if !eval_cond(&cc, cnd) {
                        return false;
                    }
                }
                if let Some(cnd) = &spec.if_at_resolve {
                    if !eval_cond(&cc, cnd) {
                        return false;
                    }
                }
            }
        }
    }
    true
}

/// 非公開ゾーン(手札・山札・シールド)で誘発した「してもよい」の能力(侵略・革命チェンジなど)は、
/// どれも解決する前に、まとめて使用宣言する。ターン・プレイヤー側から宣言し、宣言したものは解決時に取りやめられない。
/// 宣言しなかったものは、誘発しなかったことになる(総合ルール 506.3b・507.3、公式Q&A 40435 / 42940)。
/// 質問(ask)は、状態を変更する前に、全員分をまとめて行う。何か変更したら true。
fn declare_hidden(c: &mut Ctx) -> Res<bool> {
    let mut need: Vec<usize> = Vec::new();
    for (i, e) in c.s.pool.iter().enumerate() {
        if e.kind != PoolKind::Ability || e.declared {
            continue;
        }
        let ar = match e.ability {
            Some(a) => a,
            None => continue,
        };
        if !matches!(c.reg.ability(ar), Ability::Trigger { optional: true, .. }) {
            continue;
        }
        let card = &c.s.cards[e.source.uid as usize];
        if card.ep != e.source.ep || !matches!(card.zone, Zone::Hand | Zone::Deck | Zone::Shield) {
            continue;
        }
        // いま条件を満たさない能力は、解決しても何も起こらないので、宣言を聞かない
        if !trigger_condition_holds(c, e) {
            continue;
        }
        need.push(i);
    }
    if need.is_empty() {
        return Ok(false);
    }
    // ターン・プレイヤー側が先に宣言し、その待機中の効果を解決し終えてから、非ターン・プレイヤー側が宣言する(506.3b〜e)
    let active = c.s.active;
    let mut group: Vec<usize> = need.iter().copied().filter(|&i| c.s.pool[i].controller == active).collect();
    if group.is_empty() {
        if c.s.pool.iter().any(|e| e.controller == active) {
            return Ok(false); // ターン・プレイヤーの効果を先に解決する
        }
        group = need.clone();
    }
    let mut answers: Vec<(usize, bool)> = Vec::new();
    for player in [active, opp(active)] {
        for &i in &group {
            let (ctrl, src) = (c.s.pool[i].controller, c.s.pool[i].source);
            if ctrl != player {
                continue;
            }
            let ans = ask(c, NeedInput { player, why: Why::May, input: Some(InputSpec::YesNo), source: Some(src) })?;
            answers.push((i, ans.as_bool() == Some(true)));
        }
    }
    let mut remove: Vec<usize> = Vec::new();
    for (i, yes) in answers {
        if yes {
            c.s.pool[i].declared = true;
        } else {
            remove.push(i);
        }
    }
    remove.sort_unstable_by(|a, b| b.cmp(a));
    for i in remove {
        c.s.pool.remove(i);
    }
    Ok(true)
}

/// 待機していた能力を解決するフレームを積む
fn resolve_entry(c: &mut Ctx, e: PoolEntry) -> Res<()> {
    let (card_ep, card_zone) = {
        let card = &c.s.cards[e.source.uid as usize];
        (card.ep, card.zone)
    };
    // 条件を満たさなければ、何も起こさず(ログにも出さず)終える
    if !trigger_condition_holds(c, &e) {
        return Ok(());
    }
    let prev_cause = c.cause;
    c.cause = e.event.as_ref().map(|ev| ev.id);
    let kind_sym = match e.kind {
        PoolKind::Ability => s::ABILITY,
        PoolKind::ShieldTrigger => s::SHIELD_TRIGGER,
        PoolKind::GStrike => s::G_STRIKE,
    };
    let logged = emit(
        c,
        s::RESOLVE,
        vec![(s::SOURCE, Val::Int(e.source.uid as i64)), (s::CONTROLLER, Val::Int(e.controller as i64)), (s::KIND, Val::Str(kind_sym))],
    );
    c.cause = prev_cause;
    if e.kind == PoolKind::ShieldTrigger {
        // 宣言されたS・トリガーを使う(コストを支払わない)
        if card_ep != e.source.ep || card_zone != Zone::Hand {
            return Ok(());
        }
        let d = declaration(c.env(), e.source.uid);
        let face = match e.ability {
            Some(a) => a.face as i64,
            None => d.map_or(0, |d| d.face as i64),
        };
        let id = c.s.next_id();
        c.s.cont.push(Frame::Proc(ProcFrame {
            id,
            caused_by: Some(logged.id),
            name: ProcName::Play,
            stage: 0,
            vars: vec![
                (s::UID, Val::Int(e.source.uid as i64)),
                (s::EP, Val::Int(card_ep as i64)),
                (s::FROM, Val::zone(Zone::Hand)),
                (s::FACE, Val::Int(face)),
                (s::FREE, Val::Bool(true)),
                (s::AFTER, Val::Null),
            ],
        }));
        return Ok(());
    }
    let ability = match e.ability {
        Some(a) => a,
        None => return fail("能力がありません"),
    };
    c.s.cont.push(Frame::Effect(EffectFrame {
        id: logged.id,
        caused_by: e.event.as_ref().map(|ev| ev.id),
        ability,
        source: e.source,
        lki: e.lki.clone(),
        controller: e.controller,
        pc: 0,
        vars: vec![],
        trigger: e.event.clone(),
        // 使用宣言したものは、解決時に取りやめられない(「してもよい」の確認を重ねない)
        no_optional: e.declared,
    }));
    Ok(())
}

// ───────────────────────── 状況起因処理 ─────────────────────────

/// 1つの変更を行ったら true を返す(呼び出し側は再度チェックする)。
pub fn run_sba(c: &mut Ctx) -> Res<bool> {
    crate::prof!(10);
    if !c.s.dirty_sba {
        return Ok(false);
    }
    if c.s.winner != Winner::None {
        return Ok(false);
    }
    // 山札が0枚のプレイヤーは敗北(104.2b)。置換された後は、山札が増えるまで再度は起きない
    for p in 0..2usize {
        if !c.s.players[p].deck.is_empty() {
            c.s.usage_del(&UKey::DeckOut(p as u8));
        }
    }
    let losers: Vec<usize> = (0..2usize)
        .filter(|&p| {
            c.s.players[p].deck.is_empty() && c.s.turn >= 1 && !(c.s.cfg.solitaire && p == 1) && c.s.usage_get(&UKey::DeckOut(p as u8)).unwrap_or(0) == 0
        })
        .collect();
    if !losers.is_empty() {
        for &p in &losers {
            if loss_replacement(c, p as u8, true)? {
                return Ok(true);
            }
        }
        c.s.winner = if losers.len() == 2 { Winner::Draw } else { Winner::P(opp(losers[0] as u8)) };
        c.s.lose_reason = Some("山札切れ".to_string());
        let w = match c.s.winner {
            Winner::P(p) => Val::Int(p as i64),
            _ => Val::Str(s::DRAW),
        };
        emit(c, s::GAME_OVER, vec![(s::WINNER, w), (s::REASON, Val::Str(sym("山札切れ")))]);
        return Ok(true);
    }
    // パワー0以下のクリーチャーは破壊される(108.1b)
    let mut dead: Vec<i32> = Vec::new();
    {
        let e = c.env();
        for p in 0..2usize {
            for perm in &c.s.players[p].battle {
                if power_of(e, perm) <= 0 {
                    dead.push(perm.cards[0]);
                }
            }
        }
    }
    if !dead.is_empty() {
        move_cards(c, &dead, &MoveOpts::new(Zone::Grave, s::DESTROY))?;
        return Ok(true);
    }
    // S-MAX進化クリーチャーが2体以上いる場合、1体を残して手札に戻す
    for p in 0..2usize {
        let smax: Vec<i32> = {
            let e = c.env();
            c.s.players[p].battle.iter().filter(|perm| chars_lite(e, perm.cards[0], -1).ty == FaceType::SmaxEvolution).map(|x| x.cards[0]).collect()
        };
        if smax.len() >= 2 {
            let ans = ask(
                c,
                NeedInput { player: p as u8, why: Why::KeepOne, input: Some(InputSpec::Pick { candidates: smax.clone(), min: 1, max: 1 }), source: None },
            )?;
            let keep = ans.to_i32s().first().copied().unwrap_or(-1);
            let bounce: Vec<i32> = smax.into_iter().filter(|u| *u != keep).collect();
            move_cards(c, &bounce, &MoveOpts::new(Zone::Hand, s::BOUNCE))?;
            return Ok(true);
        }
    }
    c.s.dirty_sba = false;
    Ok(false)
}

/// 「ゲームに負ける時、かわりに〜してもよい」(ジャオウガ)。置換したら true。
/// deck_out: 山札切れによる敗北か(置換後、山札が増えるまで再度は起きないので、記録する)。
/// ダイレクトアタックによる敗北は、攻撃のたびに起きる出来事なので記録しない。
fn loss_replacement(c: &mut Ctx, p: PlayerId, deck_out: bool) -> Res<bool> {
    let key = UKey::DeckOut(p);
    let reg = c.reg;
    let perms: Vec<i32> = c.s.players[p as usize].battle.iter().map(|x| x.cards[0]).collect();
    for uid in perms {
        let info_replaces: Vec<(ReplaceApply, Pattern)> = {
            let e = c.env();
            let info = info_of(e, uid);
            let card = &c.s.cards[uid as usize];
            let face = reg.face(card.def, chars_lite(e, uid, -1).face_idx);
            info.replaces
                .iter()
                .filter_map(|&ri| match &face.abilities[ri as usize] {
                    Ability::Replace { apply, match_, .. } => Some((apply.clone(), match_.clone())),
                    _ => None,
                })
                .collect()
        };
        for (apply, m) in info_replaces {
            if !matches!(apply, ReplaceApply::SmaxSacrifice) || m.ty != s::GAME_LOSS {
                continue;
            }
            let pool = match smax_victims(c, p, uid) {
                Some(v) => v,
                None => continue,
            };
            let ep = c.s.cards[uid as usize].ep;
            let use_ = ask(
                c,
                NeedInput {
                    player: p,
                    why: Why::ReplaceChoice,
                    input: Some(InputSpec::Option {
                        options: vec!["かわりに表向きのカード3枚を破壊する".to_string(), "置換しない".to_string()],
                        pick: 1,
                        repeat: false,
                        all_if: false,
                        seen: None,
                    }),
                    source: Some(ObjRef { uid, ep }),
                },
            )?;
            if use_.to_i32s().first().copied().unwrap_or(1) != 0 {
                return Ok(false);
            }
            // 3枚ちょうどなら選択の余地がない。それより多ければ、破壊する3枚を選ぶ(破壊できるのはバトルゾーンのカードだけ)
            let picks: Vec<i32> = if pool.len() == 3 {
                pool
            } else {
                let ans = ask(
                    c,
                    NeedInput {
                        player: p,
                        why: Why::Select,
                        input: Some(InputSpec::Pick { candidates: pool, min: 3, max: 3 }),
                        source: Some(ObjRef { uid, ep }),
                    },
                )?;
                ans.to_i32s()
            };
            if deck_out {
                c.s.usage_set(&key, 1);
            }
            let mut o = MoveOpts::new(Zone::Grave, s::DESTROY);
            o.no_replace = true;
            move_cards(c, &picks, &o)?;
            return Ok(true);
        }
    }
    Ok(false)
}

// ───────────────────────── ディスパッチ ─────────────────────────

pub fn run_proc(c: &mut Ctx, fi: usize) -> Res<()> {
    crate::prof!(9);
    let id = c.s.cont[fi].id();
    let placeholder = Frame::Proc(ProcFrame { id, caused_by: None, name: ProcName::Sba, stage: 0, vars: Vec::new() });
    let mut f = match std::mem::replace(&mut c.s.cont[fi], placeholder) {
        Frame::Proc(f) => f,
        other => {
            c.s.cont[fi] = other;
            return fail("手続きフレームではありません");
        }
    };
    let r = match f.name {
        ProcName::Turn => run_turn(c, &mut f),
        ProcName::Play => run_play(c, &mut f),
        ProcName::Attack => run_attack(c, &mut f),
        ProcName::Break => run_break(c, &mut f),
        ProcName::Settle => run_settle(c, &mut f),
        ProcName::Sba => fail("未知の手続き: sba"),
    };
    // 自分が pop されていなければ、変更を書き戻す(入力待ちで止まった時も含む)
    if c.s.cont.len() > fi && c.s.cont[fi].id() == f.id {
        c.s.cont[fi] = Frame::Proc(f);
    }
    r
}
