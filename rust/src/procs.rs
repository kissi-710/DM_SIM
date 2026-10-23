//! 手続きフレーム: ターン進行・プレイ・攻撃・シールドブレイク・チェックポイント・状況起因処理(src/engine/procs.ts)。
//! 各ステージは「質問 → 変更」の順で書き、再実行しても二重に変更されない。

use crate::ast::*;
use crate::cond::*;
use crate::derive::*;
use crate::ops::*;
use crate::registry::Feat;
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
    /// クリーチャー以外のカード(タマシード・フィールド・クロスギア)を出す
    pub put: bool,
    pub cost: i32,
    pub need: i32,
    pub pay: Vec<i32>,
    pub after_bottom: bool,
    pub taps: Vec<i32>,
    pub onto: Option<i32>,
    /// 別のコストで捨てる手札
    pub discard: Vec<i32>,
    pub alt: Option<String>,
    /// 使った「各ターンに1度」のコスト軽減の発生源
    pub once: Vec<i32>,
    /// 他のカードの許可(allowPlayFrom)で使う時の、その発生源
    pub grant: Option<i32>,
    /// 別のコストでタップする自分のクリーチャーの山
    pub tap_alt: Vec<i32>,
    /// アビスラッシュで召喚する(墓地から)
    pub rush: bool,
    /// 超無限墓地進化で、下に重ねるカード
    pub under: Vec<i32>,
    /// フシギバースで、マナゾーンに置くクリーチャー
    pub to_mana: Vec<i32>,
}

fn plan_fail(face: i32, err: &'static str) -> PlayPlan {
    PlayPlan {
        ok: false,
        err: Some(err),
        face,
        cast: false,
        castle: false,
        put: false,
        cost: 0,
        need: 0,
        pay: vec![],
        after_bottom: false,
        taps: vec![],
        onto: None,
        discard: vec![],
        alt: None,
        once: vec![],
        grant: None,
        tap_alt: vec![],
        rush: false,
        under: vec![],
        to_mana: vec![],
    }
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
    let mut free = free;
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
    let summon = face.ty.is_creature();
    let put = !cast && !castle && !summon;
    let play_kind = if cast { PlayKind::Cast } else if summon { PlayKind::Summon } else { PlayKind::Put };
    let alt_ab: Option<&AltCostSpec> = extra.and_then(|x| x.alt.as_ref()).and_then(|id| {
        info.alt_costs.iter().find_map(|&ai| match &face.abilities[ai as usize] {
            Ability::AltCost { id: aid, cost, .. } if aid == id => Some(cost),
            _ => None,
        })
    });
    let mut after_bottom = false;
    let mut rush = false;
    let mut grant_src: Option<i32> = None;
    // (after_bottom, rush)
    let perm_of = |f: Zone| -> Option<(bool, bool)> {
        if castle {
            return None;
        }
        for &pi in &info.permissions {
            if let crate::ast::Ability::Permission { play, from: pf, after_bottom, rush } = &face.abilities[pi as usize] {
                if *pf == f && *play == play_kind {
                    return Some((*after_bottom, *rush));
                }
            }
        }
        None
    };
    if from != Zone::Hand && !free {
        match perm_of(from) {
            // 別のコストで、そのゾーンから使える(ムゲンクライムなど)
            None if alt_ab.map_or(false, |a| a.from.as_ref().map_or(false, |fz| fz.contains(&from))) => {
                after_bottom = false;
            }
            None => {
                // 他のカードの「自分のターン中、〜を from から召喚してもよい」
                grant_src = if summon { granted_play_from(e, player, uid, face_idx, from) } else { None };
                match grant_src {
                    None => return plan_fail(face_idx, "そのゾーンからはプレイできません"),
                    Some(g) => rush = grants_rush(e, g),
                }
            }
            Some((a, r)) => {
                after_bottom = a;
                rush = r;
            }
        }
    } else if from != Zone::Hand && free {
        let p = perm_of(from);
        after_bottom = p.map_or(false, |x| x.0);
        rush = p.map_or(false, |x| x.1);
    }
    if cast && !can_cast(e, player, uid, face_idx) {
        return plan_fail(face_idx, "この呪文は唱えられません");
    }
    if summon && !can_summon_card(e, player, uid, face_idx) {
        return plan_fail(face_idx, "このクリーチャーは召喚できません");
    }
    if !can_use_cost(e, player, face.cost) {
        return plan_fail(face_idx, "そのコストのカードは実行できません");
    }
    if !can_play_card(e, player, uid, face_idx) {
        return plan_fail(face_idx, "そのカードは使えません");
    }
    let mut onto: Option<i32> = None;
    if face.ty == FaceType::Evolution && !alt_ab.map_or(false, |a| a.grave_evolve) {
        let target = extra.and_then(|x| x.onto).and_then(|p| s.perm_by_pid(p));
        let (po, pi) = match target {
            Some((po, pi)) if po == player => (po, pi),
            _ => return plan_fail(face_idx, "進化元を選んでください"),
        };
        let pm = &s.players[po as usize].battle[pi];
        let top = pm.cards[0];
        let mut cc = CC::new(e, player).with_self(uid).with_it(top, s.cards[top as usize].face);
        cc.evo = true;
        match &face.evolve_from {
            Some(cond) if eval_cond(&cc, cond) => {}
            _ => return plan_fail(face_idx, "進化元の条件を満たしていません"),
        }
        onto = Some(pm.pid);
    } else if extra.and_then(|x| x.onto).is_some() {
        return plan_fail(face_idx, "進化クリーチャーではありません");
    }
    // 別のコスト(マナを払うかわりに、手札を捨てる・マナを払わない)
    let mut reduce_alt: i32 = 0;
    let mut tap_alt: Vec<i32> = Vec::new();
    let mut grave_under: Vec<i32> = Vec::new();
    let mut to_mana: Vec<i32> = Vec::new();
    let mut pay_alt: Option<i32> = None;
    let mut discard: Vec<i32> = Vec::new();
    let mut has_grave_under = false;
    if let Some(alt_id) = extra.and_then(|x| x.alt.as_ref()) {
        let ab = match alt_ab {
            Some(a) => a,
            None => return plan_fail(face_idx, "その別のコストはありません"),
        };
        let _ = alt_id;
        let ab_from: Vec<Zone> = ab.from.clone().unwrap_or_else(|| vec![Zone::Hand]);
        if !ab_from.contains(&from) {
            return plan_fail(face_idx, "そのゾーンから使う別のコストではありません");
        }
        let when = info.alt_costs.iter().find_map(|&ai| match &face.abilities[ai as usize] {
            Ability::AltCost { id: aid, when, .. } if Some(aid) == extra.and_then(|x| x.alt.as_ref()) => Some(when),
            _ => None,
        });
        if let Some(Some(w)) = when {
            if !eval_cond(&CC::new(e, player).with_self(uid), w) {
                return plan_fail(face_idx, "別のコストを使える条件を満たしていません");
            }
        }
        // 別のコストは、マナを払うかわりのコスト(reduce は軽減、pay はコストのかわりに払う。墓地進化・フシギバースは、コストを払う)
        let free_alt = ab.reduce.is_none() && ab.pay.is_none() && !ab.grave_evolve && ab.fushigi.is_none();
        reduce_alt = ab.reduce.unwrap_or(0);
        if let Some(n) = ab.tap_creatures {
            let cands: Vec<i32> = s.players[player as usize].battle.iter().filter(|p| !p.tapped && chars_lite(e, p.cards[0], -1).ty.is_creature()).map(|p| p.pid).collect();
            let given = extra.and_then(|x| x.tap_alt.clone()).unwrap_or_default();
            if !given.is_empty() {
                let mut uniq = given.clone();
                uniq.sort();
                uniq.dedup();
                if given.len() as i32 != n || uniq.len() as i32 != n || !given.iter().all(|p| cands.contains(p)) {
                    return plan_fail(face_idx, "タップするクリーチャーが条件に合いません");
                }
                tap_alt = given;
            } else {
                if (cands.len() as i32) < n {
                    return plan_fail(face_idx, "タップできるクリーチャーが足りません");
                }
                tap_alt = cands[..n as usize].to_vec();
            }
        }
        if let Some(p) = ab.pay {
            pay_alt = Some(p);
        }
        if ab.grave_evolve {
            // 超無限墓地進化: 墓地のクリーチャーを1体以上選んで、その上に重ねて出す。選んだ数だけコストを少なくする(1未満にならない)
            let under = extra.and_then(|x| x.under.clone()).unwrap_or_default();
            let mut uniq = under.clone();
            uniq.sort();
            uniq.dedup();
            let ok = !under.is_empty()
                && uniq.len() == under.len()
                && under.iter().all(|&u| s.cards.get(u as usize).map_or(false, |cd| cd.zone == Zone::Grave && cd.owner == player) && chars_lite(e, u, -1).ty.is_creature());
            if !ok {
                return plan_fail(face_idx, "墓地から重ねるクリーチャーを選んでください");
            }
            reduce_alt = under.len() as i32;
            grave_under = under;
            has_grave_under = true;
        }
        if let Some((base, min)) = ab.fushigi {
            // フシギバース: 自分のクリーチャーを1体タップしてマナゾーンに置き、基準のコストからそのコストを引いた数を支払う
            let pid = extra.and_then(|x| x.tap_alt.as_ref()).and_then(|v| v.first().copied());
            let pm = pid.and_then(|p| s.perm_by_pid(p));
            let (po, pi) = match pm {
                Some(x) => x,
                None => return plan_fail(face_idx, "マナゾーンに置く、アンタップしている自分のクリーチャーを選んでください"),
            };
            let perm = &s.players[po as usize].battle[pi];
            if po != player || perm.tapped || !chars_lite(e, perm.cards[0], -1).ty.is_creature() {
                return plan_fail(face_idx, "マナゾーンに置く、アンタップしている自分のクリーチャーを選んでください");
            }
            pay_alt = Some(min.max(base - cost_base(e, perm.cards[0])));
            to_mana = vec![perm.cards[0]];
            tap_alt = Vec::new();
        }
        if let Some((n, wh)) = &ab.discard {
            let ccd = CC::new(e, player).with_self(uid);
            let cands: Vec<i32> = s.players[player as usize].hand.iter().copied().filter(|&u| u != uid && wh.as_ref().map_or(true, |w| eval_cond(&ccd.sub(u, -1), w))).collect();
            let given = extra.and_then(|x| x.discard.clone()).unwrap_or_default();
            if !given.is_empty() {
                let mut uniq = given.clone();
                uniq.sort();
                uniq.dedup();
                if given.len() as i32 != *n || uniq.len() as i32 != *n || !given.iter().all(|u| cands.contains(u)) {
                    return plan_fail(face_idx, "捨てる手札が条件に合いません");
                }
                discard = given;
            } else {
                if (cands.len() as i32) < *n {
                    return plan_fail(face_idx, "捨てる手札が足りません");
                }
                discard = cands[..*n as usize].to_vec();
            }
        }
        if free_alt {
            free = true;
        }
    } else if extra.and_then(|x| x.discard.as_ref()).map_or(false, |d| !d.is_empty()) {
        return plan_fail(face_idx, "別のコストを選んでいません");
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
    let mut once: Vec<i32> = Vec::new();
    let cost = match pay_alt {
        Some(p) => p,
        None => (if has_grave_under { 1 } else { 0 }).max(cost_of_once(e, uid, face_idx, &taps, free, &mut once) - reduce_alt),
    };
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
            let srcs = mana_sources(e, player, &[]);
            for &u in m {
                match s.cards.get(u as usize) {
                    Some(mc) if mc.owner == player && u != uid && srcs.contains(&u) => {}
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
    PlayPlan {
        ok: true,
        err: None,
        face: face_idx,
        cast,
        castle,
        put,
        cost,
        need,
        pay,
        after_bottom,
        taps,
        onto,
        discard,
        alt: extra.and_then(|x| x.alt.clone()),
        once,
        grant: grant_src,
        tap_alt,
        rush,
        under: grave_under,
        to_mana,
    }
}

/// 選んだマナが、必要な文明を1枚ずつ(1枚は1文明)満たせるか
pub fn covers(e: Env, mana: &[i32], civs: &[Civ]) -> bool {
    let cs: Vec<&[Civ]> = mana.iter().map(|&u| source_civs(e, u)).collect();
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
            // 「相手のターンのはじめに、相手はマナゾーンのカードを n 枚までしかアンタップできない」(卍月 ガ・リュザーク 卍)
            let mut untap_left: i64 = {
                let e = c.env();
                let mut m: Option<i32> = None;
                any_static(e, |st| {
                    if let StaticMod::UntapLimit { n } = st.m {
                        if st.controller != p {
                            m = Some(m.map_or(*n, |x| x.min(*n)));
                        }
                    }
                    false
                });
                m.map_or(i64::MAX, |x| x as i64)
            };
            // 「次のターンのはじめに、アンタップしない」(noUntap)
            let mut no_untap_pids: Vec<i32> = Vec::new();
            let mut no_untap_uids: Vec<i32> = Vec::new();
            for ef in &c.s.effects {
                if let (EffectMod::NoUntap { pids, uids }, Duration::UntilTurnStart { player, .. }) = (&ef.m, &ef.until) {
                    if *player == p {
                        no_untap_pids.extend(pids.iter().copied());
                        no_untap_uids.extend(uids.iter().copied());
                    }
                }
            }
            let mana: Vec<i32> = c.s.players[p as usize].mana.clone();
            for u in mana {
                if !c.s.cards[u as usize].tapped || no_untap_uids.contains(&u) {
                    continue;
                }
                if untap_left > 0 {
                    c.s.cards[u as usize].tapped = false;
                    if untap_left != i64::MAX {
                        untap_left -= 1;
                    }
                }
            }
            for perm in c.s.players[p as usize].battle.iter_mut() {
                if !no_untap_pids.contains(&perm.pid) {
                    perm.tapped = false;
                }
                perm.sick = false;
                perm.hyper = false; // ハイパーモードは、次の自分のターンのはじめまで
            }
            // 「次の自分のターンのはじめまで」の期限切れ(逆転撃の支払い(owe)は、支払いの段階で消す)
            let turn = c.s.turn;
            c.s.effects.retain(|e| {
                !(matches!(e.until, Duration::UntilTurnStart { player, after_turn } if player == p && turn > after_turn) && !matches!(e.m, EffectMod::Owe { .. } | EffectMod::StartShield))
            });
            let ev = emit(c, s::STEP_START, vec![(s::STEP, Val::Str(s::START)), (s::PLAYER, Val::Int(p as i64))]);
            c.s.batch_no += 1;
            collect_batch(c, &[ev]);
            f.stage = if c.s.effects.iter().any(|e| matches!(e.m, EffectMod::Owe { .. } | EffectMod::StartShield) && e.controller == p) { 5 } else { 1 };
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        5 => {
            // 逆転撃: 次の自分のターンのはじめに、マナを支払う。払えなければ、ゲームに負ける。1回に1つずつ処理する
            let e_idx = c.s.effects.iter().position(|x| matches!(x.m, EffectMod::Owe { .. } | EffectMod::StartShield) && x.controller == p);
            let e_idx = match e_idx {
                Some(i) => i,
                None => {
                    f.stage = 1;
                    return Ok(());
                }
            };
            let (eid, em) = (c.s.effects[e_idx].id, c.s.effects[e_idx].m.clone());
            if em == EffectMod::StartShield {
                // 次の自分のターンのはじめに、自分のシールドを1つ手札に加える(「S・トリガー」は使えない)。質問は、状態を変更する前に行う
                let shields = c.s.players[p as usize].shield.clone();
                if shields.is_empty() {
                    c.s.effects.retain(|x| x.id != eid);
                    return Ok(());
                }
                let pick: Vec<i32> = if shields.len() == 1 {
                    vec![shields[0]]
                } else {
                    let ans = ask(c, NeedInput { player: p, why: Why::Select, input: Some(InputSpec::Pick { candidates: shields.clone(), min: 1, max: 1, sum: None }), source: None })?;
                    ans.to_i32s()
                };
                c.s.effects.retain(|x| x.id != eid);
                move_cards(c, &pick, &MoveOpts::new(Zone::Hand, s::EFFECT))?;
                push_proc(c, ProcName::Settle, vec![]);
                return Ok(());
            }
            let (civ, n) = match em {
                EffectMod::Owe { civ, n } => (civ, n),
                _ => {
                    f.stage = 1;
                    return Ok(());
                }
            };
            let plan = plan_payment(c.env(), p, &[civ], n, &[], &[]);
            let plan = match plan {
                Some(pl) => pl,
                None => {
                    // 払えない: 負ける(「ゲームに負ける時」の置換があれば使える)。質問は、状態を変更する前に行う
                    if loss_replacement(c, p, false)? {
                        c.s.effects.retain(|x| x.id != eid);
                        return Ok(());
                    }
                    c.s.effects.retain(|x| x.id != eid);
                    c.s.winner = Winner::P(opp(p));
                    c.s.lose_reason = Some("逆転撃の支払い不能".to_string());
                    emit(c, s::GAME_OVER, vec![(s::WINNER, Val::Int(opp(p) as i64)), (s::REASON, Val::Str(sym("逆転撃の支払い不能")))]);
                    return Ok(());
                }
            };
            for &u in &plan {
                set_tapped(c, u, true);
            }
            c.s.effects.retain(|x| x.id != eid);
            emit(c, sym("paidDebt"), vec![(s::OWNER, Val::Int(p as i64)), (s::N, Val::Int(plan.len() as i64))]);
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
            // アビスラッシュ・J・O・E: ターンの終わりに山札の下に置く(置換の質問が出ることがあるので、1体ずつ、この段階の先頭で行う)
            {
                let turn = c.s.turn;
                let done: Vec<i32> = var_get(&f.vars, sym("bottomDone")).map(|v| v.to_i32s()).unwrap_or_default();
                let found: Option<(i32, i32, bool)> = c.s.players[p as usize].battle.iter().find_map(|x| {
                    if done.contains(&x.pid) {
                        return None;
                    }
                    let hit = if x.rush == Some(turn) {
                        !(x.rush_if_attacked && !c.s.turn_log.iter().any(|e| e.ty == s::ATTACK_DECLARED && e.int(s::ATTACKER) == Some(x.pid as i64)))
                    } else {
                        x.end_bottom == Some(turn)
                    };
                    if hit {
                        Some((x.pid, x.cards[0], x.end_bottom == Some(turn)))
                    } else {
                        None
                    }
                });
                // ニンジャ・ストライク: 相手のターンに出たシノビ(そのターンの終わりに、山札の下に置く)
                if found.is_none() {
                    let o = opp(p);
                    let ninja = c.s.players[o as usize].battle.iter().find(|x| x.ninja_bottom == Some(turn) && !done.contains(&x.pid)).map(|x| (x.pid, x.cards[0]));
                    if let Some((pid, top)) = ninja {
                        let mut mo = MoveOpts::new(Zone::Deck, s::EFFECT);
                        mo.pos = Some(false);
                        move_cards(c, &[top], &mo)?;
                        let mut nd = done.clone();
                        nd.push(pid);
                        var_set(&mut f.vars, sym("bottomDone"), Val::ints(&nd));
                        push_proc(c, ProcName::Settle, vec![]);
                        return Ok(());
                    }
                }
                if let Some((pid, top, end_bottom)) = found {
                    let mut o = MoveOpts::new(Zone::Deck, s::EFFECT);
                    o.pos = Some(false);
                    let moved = move_cards(c, &[top], &o)?;
                    let mut nd = done.clone();
                    nd.push(pid);
                    var_set(&mut f.vars, sym("bottomDone"), Val::ints(&nd));
                    // J・O・E: 山札の下に置いたら、カードを1枚引く
                    if end_bottom && moved.iter().any(|r| r.moved) {
                        draw_cards(c, p, 1)?;
                    }
                    push_proc(c, ProcName::Settle, vec![]);
                    return Ok(());
                }
            }
            let turn = c.s.turn;
            c.s.effects.retain(|e| {
                !matches!(e.until, Duration::EndOfTurn { turn: t } if t <= turn) && !matches!(e.until, Duration::UntilOppTurnEnd { player, after_turn } if turn > after_turn && p != player)
            });
            c.s.turn += 1;
            // 「このターンの後に自分のターンを追加する」: 追加のターンの後は、本来の順番に戻る
            let normal = c.s.resume.unwrap_or(opp(p));
            let extra = c.s.extra_turns.as_mut().and_then(|v| if v.is_empty() { None } else { Some(v.remove(0)) });
            match extra {
                Some(x) => {
                    c.s.resume = Some(normal);
                    c.s.active = x;
                }
                None => {
                    c.s.resume = None;
                    c.s.active = normal;
                }
            }
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
                if free || vb(&f.vars, sym("soft")) {
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
            // 別のコスト: 手札を捨てる・クリーチャーをタップする
            for &pid in &plan.tap_alt {
                if let Some(pm) = c.s.perm(pid) {
                    let top = pm.cards[0];
                    set_tapped(c, top, true);
                }
            }
            if !plan.discard.is_empty() {
                move_cards(c, &plan.discard, &MoveOpts::new(Zone::Grave, sym("discard")))?;
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
            let turn = c.s.turn as i64;
            for &src in &plan.once {
                c.s.usage_set(&UKey::Other(format!("cd:{}", src)), turn);
            }
            if let Some(g) = plan.grant {
                c.s.usage_set(&UKey::Other(format!("gp:{}", g)), turn);
            }
            let mut pv: Vec<(Sym, Val)> = vec![
                (s::KIND, Val::Str(if plan.cast { s::CAST } else if plan.castle { s::CASTLE } else if plan.put { sym("put") } else { s::SUMMON })),
                (s::PAID, Val::Int(plan.pay.len() as i64)),
                (s::COST, Val::Int(plan.cost as i64)),
                (s::AFTER, if plan.after_bottom { Val::Str(s::DECK_BOTTOM) } else { Val::Null }),
                (s::ONTO, plan.onto.map_or(Val::Null, |o| Val::Int(o as i64))),
                (s::FACE, Val::Int(plan.face as i64)),
                (s::FREE, Val::Bool(free)),
            ];
            if let Some(a) = &plan.alt {
                pv.push((sym("alt"), Val::Str(sym(a))));
            }
            if plan.rush {
                pv.push((sym("rush"), Val::Bool(true)));
            }
            if !plan.under.is_empty() {
                pv.push((sym("under"), Val::ints(&plan.under)));
            }
            var_set(&mut f.vars, s::PLAN, Val::Obj(Rc::new(pv)));
            var_set(&mut f.vars, s::FROM_ZONE, Val::zone(prev_zone));
            // フシギバース: タップしたクリーチャーを、マナゾーンに置く(離れる時の置換の質問が出ることがあるので、別の段階で行う)
            if !plan.to_mana.is_empty() {
                var_set(&mut f.vars, sym("toMana"), Val::ints(&plan.to_mana));
            }
            f.stage = if plan.to_mana.is_empty() { 1 } else { 4 };
            Ok(())
        }
        4 => {
            let to_mana: Vec<i32> = var_get(&f.vars, sym("toMana")).map(|v| v.to_i32s()).unwrap_or_default();
            let mut o = MoveOpts::new(Zone::Mana, sym("manaPlace"));
            o.tapped = true;
            move_cards(c, &to_mana, &o)?;
            f.vars.retain(|(k, _)| *k != sym("toMana"));
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
            let alt = p.get(sym("alt")).and_then(|x| x.as_sym());
            let alt_flag = |c: &Ctx, pick: &dyn Fn(&AltCostSpec) -> bool| -> bool {
                let (def, _) = (c.s.cards[uid as usize].def, 0);
                let face_ref = c.reg.face(def, face);
                alt.map_or(false, |a| {
                    c.reg.info(def, face).alt_costs.iter().any(|&ai| matches!(&face_ref.abilities[ai as usize], Ability::AltCost { id, cost, .. } if sym(id) == a && pick(cost)))
                })
            };
            // パンドラ・シフト: 出すかわりに、超次元ゾーンに置く
            if kind == Some(s::SUMMON) && alt_flag(&*c, &|a| a.to_hyper) {
                let mut o = MoveOpts::new(Zone::Hyper, sym("pandora"));
                o.no_replace = true;
                move_cards(c, &[uid], &o)?;
                f.stage = 3;
                return Ok(());
            }
            let is_put = kind == Some(sym("put"));
            if kind == Some(s::SUMMON) || is_put {
                let mut evs: Vec<Rc<Ev>> = Vec::new();
                let via = if is_put { sym("put") } else { s::SUMMON };
                let mut o = MoveOpts::new(Zone::Battle, via);
                o.via = Some(via);
                o.onto = p.get(s::ONTO).and_then(|x| x.as_i32());
                o.face = Some(face);
                o.paid = Some(paid);
                o.cost = Some(cost);
                o.free = free;
                o.from = var_get(&f.vars, s::FROM_ZONE).and_then(|v| v.as_sym()).and_then(Zone::from_sym);
                let under = p.get(sym("under")).map(|x| x.to_i32s()).unwrap_or_default();
                if !under.is_empty() {
                    o.under = Some(under);
                }
                enter_battle(c, uid, &o, &mut evs)?;
                let turn = c.s.turn;
                let in_battle = c.s.cards[uid as usize].zone == Zone::Battle;
                if kind == Some(s::SUMMON) && in_battle {
                    on_summoned(c, uid);
                }
                // J・O・E: このターンの終わりに山札の下に置き、カードを1枚引く
                if alt.is_some() && in_battle && alt_flag(&*c, &|a| a.end_bottom_draw) {
                    if let Some((po, pi)) = c.s.perm_by_pid(c.s.cards[uid as usize].pid) {
                        c.s.players[po as usize].battle[pi].end_bottom = Some(turn);
                    }
                }
                // アビスラッシュ
                if p.get(sym("rush")).and_then(|x| x.as_bool()) == Some(true) && in_battle {
                    if let Some((po, pi)) = c.s.perm_by_pid(c.s.cards[uid as usize].pid) {
                        c.s.players[po as usize].battle[pi].rush = Some(turn);
                    }
                }
                // 別のコストを使って出た印(そのターンだけ。altUsed の条件で調べる)
                if let Some(a) = alt {
                    if in_battle {
                        c.s.usage_set(&UKey::Other(format!("alt:{}:{}", uid, a.name())), turn as i64);
                    }
                }
                // S・トリガーとして使って出た印(S・トリガー・プラスのP能力の条件。イベントの内容は変えない)
                if vb(&f.vars, sym("st")) {
                    let ent = evs.iter().find(|e| e.ty == s::ENTERED && e.int(s::CARD) == Some(uid as i64)).map(|e| e.id);
                    if let (Some(id), true) = (ent, game_has(c.env(), Feat::StUsed)) {
                        c.s.usage_set(&UKey::Other(format!("st:{}", uid)), id as i64);
                    }
                }
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
            if vb(&f.vars, sym("st")) && game_has(c.env(), Feat::StUsed) {
                c.s.usage_set(&UKey::Other(format!("st:{}", uid)), ev.id as i64); // S・トリガーとして唱えた印(その印を見る能力があるゲームだけ)
            }
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
                let pface = p.get(s::FACE).and_then(|x| x.as_int()).unwrap_or(0) as i32;
                // 唱え終わった呪文を、墓地のかわりに別の手順で動かす(フィールドの下に置く、など)
                if game_has(c.env(), Feat::AfterCast) && !var_hyper && after_cast_replacement(c, uid, pface)? {
                    f.stage = 3;
                    return Ok(());
                }
                let from_grave = var_get(&f.vars, s::FROM_ZONE).and_then(|v| v.as_sym()) == Some(s::Z_GRAVE);
                let grave_bottom = from_grave && {
                    let owner = c.s.cards[uid as usize].owner;
                    let e = c.env();
                    any_static(e, |st| matches!(st.m, StaticMod::GraveCastToBottom) && st.controller == owner)
                };
                if var_hyper {
                    // インターステラ: 墓地(や山札の下)のかわりに超次元ゾーンに置く
                    let mut o = MoveOpts::new(Zone::Hyper, s::CAST_HYPER);
                    o.no_replace = true;
                    move_cards(c, &[uid], &o)?;
                } else if plan_bottom || var_bottom || grave_bottom {
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
                                ReplaceApply::ChangeDest { to, .. } => *to,
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

/// 唱え終わった呪文に当てはまる「かわりに〜する」(match.type = 'afterCast')を探し、あれば、その手順を行う効果を積んで true を返す。
/// 持つのはバトルゾーンの、能力を無視されていないカード(複数あれば、先頭のもの)。
fn after_cast_replacement(c: &mut Ctx, uid: i32, face_idx: i32) -> Res<bool> {
    let owner = c.s.cards[uid as usize].owner;
    let mut found: Option<(PlayerId, i32, u16, u16, i32, i32, bool)> = None; // (p, src, face, idx, def, ep, optional)
    {
        let e = c.env();
        let sym_ac = sym("afterCast");
        'outer: for p in 0..2u8 {
            for perm in &c.s.players[p as usize].battle {
                let src = perm.cards[0];
                let info = info_of(e, src);
                if info.replaces.is_empty() {
                    continue;
                }
                let sc = &c.s.cards[src as usize];
                let face = e.reg.face(sc.def, chars_lite(e, src, -1).face_idx);
                for &ri in &info.replaces {
                    if let Ability::Replace { match_, apply: ReplaceApply::Steps(_), while_, optional, .. } = &face.abilities[ri as usize] {
                        if match_.ty != sym_ac {
                            continue;
                        }
                        if let Some(rel) = match_.owner {
                            if rel != Rel::Any && (if rel == Rel::Self_ { owner != p } else { owner == p }) {
                                continue;
                            }
                        }
                        if let Some(w) = while_ {
                            if !eval_cond(&CC::new(e, p).with_self(src), w) {
                                continue;
                            }
                        }
                        if let Some(m) = &match_.cond {
                            if !eval_cond(&CC::new(e, p).with_self(src).with_it(uid, face_idx), m) {
                                continue;
                            }
                        }
                        found = Some((p, src, sc.face as u16, ri, sc.def as i32, sc.ep, *optional));
                        break 'outer;
                    }
                }
            }
        }
    }
    if let Some((p, src, sface, ri, def, ep, optional)) = found {
        // 「かわりに〜してもよい」: 置き換えるかを、状態を変更する前に聞く(断れば、墓地に置く)
        if optional {
            let ans = ask(c, NeedInput { player: p, why: Why::May, input: Some(InputSpec::YesNo), source: Some(ObjRef { uid: src, ep }) })?;
            if ans.as_bool() != Some(true) {
                return Ok(false);
            }
        }
        let evid = c.s.next_id();
        let ev = Rc::new(Ev { id: evid, caused_by: None, ty: sym("afterCast"), turn: c.s.turn, f: vec![(s::CARD, Val::Int(uid as i64)), (s::OWNER, Val::Int(owner as i64))] });
        push_effect(c, AbilityRef { def: def as u16, face: sface as u8, idx: ri }, ObjRef { uid: src, ep }, p, Some(ev), true);
        return Ok(true);
    }
    Ok(false)
}

// ───────────────────────── 攻撃 ─────────────────────────

/// そのイベントの種類を監視する能力が、対局のデッキのカードにあるか(なければ、イベントを発行しない)。
/// TS 版(ops.ts の listens)と同じ: デッキが分からない状態では、カードDB全体で調べる
fn has_listener(c: &Ctx, ty: Sym) -> bool {
    listens(c, ty)
}

/// 「バトルする時」の誘発を発行する(聞き手のいるカードがある時だけ。段階を増やさず、既存の対戦の記録を変えない)
fn emit_battle_started(c: &mut Ctx, a_pid: i32, d_pid: i32) {
    if !has_listener(c, s::BATTLE_STARTED) {
        return;
    }
    let (a_top, a_owner) = match c.s.perm_by_pid(a_pid) {
        Some((po, pi)) => (c.s.players[po as usize].battle[pi].cards[0], po),
        None => return,
    };
    let d_top = match c.s.perm(d_pid) {
        Some(p) => p.cards[0],
        None => return,
    };
    let ev = emit(
        c,
        s::BATTLE_STARTED,
        vec![
            (s::ATTACKER, Val::Int(a_pid as i64)),
            (s::DEFENDER, Val::Int(d_pid as i64)),
            (s::ATTACKER_CARD, Val::Int(a_top as i64)),
            (s::DEFENDER_CARD, Val::Int(d_top as i64)),
            (s::OWNER, Val::Int(a_owner as i64)),
        ],
    );
    c.s.batch_no += 1;
    collect_batch(c, &[ev]);
    push_proc(c, ProcName::Settle, vec![]);
}

/// パワーを比べて、負けた方(同じなら両方)を破壊する。スレイヤーも処理する。「バトルの後」に使う当事者の情報を返す
fn resolve_battle_core(c: &mut Ctx, a_pid: i32, d_pid: i32) -> Res<Option<Val>> {
    let br = match resolve_battle(c, a_pid, d_pid)? {
        Some(b) => b,
        None => return Ok(None),
    };
    Ok(Some(Val::Obj(Rc::new(vec![
        (s::ATTACKER, Val::Int(br.a_pid as i64)),
        (s::DEFENDER, Val::Int(br.d_pid as i64)),
        (s::ATTACKER_CARD, Val::Int(br.a_top as i64)),
        (s::DEFENDER_CARD, Val::Int(br.d_top as i64)),
        (s::OWNER, Val::Int(br.a_owner as i64)),
    ]))))
}

/// バトルの当事者を、「かわりにこのクリーチャーにバトルさせてもよい」(battleProxy)で置き換える。置き換えなければ、そのまま返す
fn battle_proxy_swap(c: &mut Ctx, a_pid: i32, d_pid: i32) -> Res<(i32, i32)> {
    if !game_has(c.env(), Feat::BattleProxy) {
        return Ok((a_pid, d_pid));
    }
    let mut out = [a_pid, d_pid];
    for k in 0..2 {
        let side_pid = [a_pid, d_pid][k];
        let (owner, side_top) = match c.s.perm_by_pid(side_pid) {
            Some((po, pi)) => (po, c.s.players[po as usize].battle[pi].cards[0]),
            None => continue,
        };
        let cands: Vec<i32> = {
            let e = c.env();
            c.s.players[owner as usize]
                .battle
                .iter()
                .filter(|x| {
                    if x.pid == side_pid || x.pid == a_pid || x.pid == d_pid {
                        return false;
                    }
                    let top = x.cards[0];
                    let info = info_of(e, top);
                    if info.statics.is_empty() {
                        return false;
                    }
                    let face = top_face(e, top);
                    info.statics.iter().any(|&si| match &face.abilities[si as usize] {
                        Ability::Static { m: StaticMod::BattleProxy { cond }, while_ } => {
                            while_.as_ref().map_or(true, |w| eval_cond(&CC::new(e, owner).with_self(top), w))
                                && eval_cond(&CC::new(e, owner).with_self(top).with_it(side_top, c.s.cards[side_top as usize].face), cond)
                        }
                        _ => false,
                    })
                })
                .map(|x| x.cards[0])
                .collect()
        };
        if cands.is_empty() {
            continue;
        }
        let src = ObjRef { uid: cands[0], ep: c.s.cards[cands[0] as usize].ep };
        let ans = ask(c, NeedInput { player: owner, why: Why::May, input: Some(InputSpec::Pick { candidates: cands, min: 0, max: 1, sum: None }), source: Some(src) })?;
        let picked = ans.to_i32s();
        if let Some(&u) = picked.first() {
            if let Some(p) = c.s.perm(c.s.cards[u as usize].pid) {
                out[k] = p.pid;
            }
        }
    }
    Ok((out[0], out[1]))
}

fn run_battle(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let a = vi(&f.vars, sym("a")) as i32;
    let d = vi(&f.vars, sym("d")) as i32;
    let pma = c.s.perm_by_pid(a);
    let pmd = c.s.perm_by_pid(d);
    match f.stage {
        0 => {
            let (ma, md) = match (pma, pmd) {
                (Some(x), Some(y)) if x.0 != y.0 => (x, y),
                _ => return pop_frame(c, f.id),
            };
            let _ = (ma, md);
            // 「自分の他のジャイアントが相手のクリーチャーとバトルする時、かわりにこのクリーチャーにバトルさせてもよい」(銀河竜 ゴルファンタジスタ)
            let (na, nd) = battle_proxy_swap(c, a, d)?;
            var_set(&mut f.vars, sym("a"), Val::Int(na as i64));
            var_set(&mut f.vars, sym("d"), Val::Int(nd as i64));
            f.stage = 1;
            emit_battle_started(c, na, nd);
            Ok(())
        }
        1 => {
            // 「バトルする時」の効果の解決で、どちらかが場を離れていれば、バトルは行われない(115.3a)
            if pma.is_none() || pmd.is_none() || c.s.winner != Winner::None {
                return pop_frame(c, f.id);
            }
            let bi = resolve_battle_core(c, a, d)?;
            if has_listener(c, s::AFTER_BATTLE) {
                if let Some(b) = bi {
                    var_set(&mut f.vars, sym("battle"), b);
                }
            }
            f.stage = 2;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
        }
        2 => {
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

/// 攻撃の終わり: 「攻撃の終わりに」の誘発(聞き手がいる時だけ)・「最初の攻撃の終わりにアンタップする」を処理して、攻撃の手続きを終える。
/// ターンが飛ばされる・勝敗が決まった場合は、何も起こさない。
fn end_attack(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let pid = vi(&f.vars, s::PID) as i32;
    let pm = c.s.perm_by_pid(pid).map(|(po, pi)| {
        let p = &c.s.players[po as usize].battle[pi];
        (po, p.pid, p.cards[0])
    });
    // 攻撃が行われた(攻撃の宣言をした)クリーチャーがいる時だけ
    if let Some((owner, ppid, top)) = pm {
        if c.s.winner == Winner::None && !c.s.skip_turn {
            // 最初の攻撃の終わりにアンタップする効果(調律師ピーカプなど)
            if let Some(i) = c.s.effects.iter().position(|e| e.pid == ppid && e.m == EffectMod::UntapAfterAttack) {
                c.s.effects.remove(i);
                set_tapped(c, top, false);
            }
            if has_listener(c, sym("attackEnded")) {
                // 攻撃中にシールドをブレイクしたか(キリフダッシュの条件)
                let mut broke = false;
                for e in c.s.turn_log.iter().rev() {
                    if e.ty == s::SHIELD_BROKEN && e.int(s::BY) == Some(ppid as i64) {
                        broke = true;
                    }
                    if e.ty == s::ATTACK_DECLARED && e.int(s::ATTACKER) == Some(ppid as i64) {
                        break;
                    }
                }
                let ev = emit(c, sym("attackEnded"), vec![(s::CARD, Val::Int(top as i64)), (s::ATTACKER, Val::Int(ppid as i64)), (s::OWNER, Val::Int(owner as i64)), (sym("broke"), Val::Bool(broke))]);
                c.s.batch_no += 1;
                collect_batch(c, &[ev]);
            }
        }
    }
    // G・ブレイカー: その攻撃の後、自分のシールドをすべてブレイクする
    if let Some((owner, _, _)) = pm {
        let nshield = c.s.players[owner as usize].shield.len();
        if c.s.winner == Winner::None && !c.s.skip_turn && nshield > 0 {
            let big = match c.s.perm_by_pid(pid) {
                Some((po, pi)) => breaker_count(c.env(), &c.s.players[po as usize].battle[pi]) >= 99,
                None => false,
            };
            if big {
                pop_frame(c, f.id)?;
                let id = c.s.next_id();
                let vars: Vars = vec![(s::PID, Val::Int(pid as i64)), (s::OWNER, Val::Int(opp(owner) as i64)), (s::N, Val::Int(nshield as i64))];
                c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Break, stage: 0, vars }));
                return Ok(());
            }
        }
    }
    pop_frame(c, f.id)
}

fn run_attack(c: &mut Ctx, f: &mut ProcFrame) -> Res<()> {
    let pid = vi(&f.vars, s::PID) as i32;
    match f.stage {
        0 => {
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return end_attack(c, f),
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
                return end_attack(c, f);
            }
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return end_attack(c, f),
            };
            let target = var_get(&f.vars, s::TARGET).and_then(target_from_val).unwrap_or(Target::Player);
            if let Target::Creature(tp) = &target {
                if c.s.perm_by_pid(*tp).is_none() {
                    return end_attack(c, f); // 攻撃先が場を離れた → 攻撃は終了
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
                let atk_top = c.s.players[po as usize].battle[pi].cards[0];
                if is_unblockable(e, &c.s.players[po as usize].battle[pi]) {
                    Vec::new()
                } else {
                    c.s.players[defender as usize]
                        .battle
                        .iter()
                        .filter(|p| p.pid != attacked && (can_block(e, p) || (attacked != -1 && can_guard(e, p))))
                        // 飛行: 飛行を持つクリーチャーは、飛行を持たないクリーチャーにブロックされない
                        .filter(|p| {
                            !(game_has(e, Feat::Flying)
                                && has_self_static(e, atk_top, |m| matches!(m, StaticMod::Flying))
                                && !has_self_static(e, p.cards[0], |m| matches!(m, StaticMod::Flying)))
                        })
                        .map(|p| p.cards[0])
                        .collect()
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
                let ans = ask(c, NeedInput { player: defender, why: Why::Block, input: Some(InputSpec::Pick { candidates: cands, min: 0, max: n, sum: None }), source: None })?;
                chosen = ans.to_i32s();
            }
            let mut blocker: Option<i32> = None;
            if chosen.len() == 1 {
                blocker = Some(chosen[0]);
            } else if chosen.len() > 1 {
                let ans = ask(c, NeedInput { player: defender, why: Why::Block, input: Some(InputSpec::Pick { candidates: chosen.clone(), min: 1, max: 1, sum: None }), source: None })?;
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
                return end_attack(c, f);
            }
            let (po, pi) = match c.s.perm_by_pid(pid) {
                Some(x) => x,
                None => return end_attack(c, f),
            };
            let target = var_get(&f.vars, s::TARGET).and_then(target_from_val).unwrap_or(Target::Player);
            let a_pid = c.s.players[po as usize].battle[pi].pid;
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
                    if c.s.perm_by_pid(tp).is_none() {
                        return end_attack(c, f);
                    }
                    // 「バトルする時」の誘発は、パワーを比べる前に解決する(総合ルール 115.2 / 701.13a)。
                    // 聞き手のいるカードがある時だけ、イベントを発行する(段階を増やさず、既存の対戦の記録を変えない)
                    let (na, nd) = battle_proxy_swap(c, a_pid, tp)?;
                    if na != a_pid || nd != tp {
                        var_set(&mut f.vars, sym("ba"), Val::Int(na as i64));
                        var_set(&mut f.vars, sym("bd"), Val::Int(nd as i64));
                    }
                    f.stage = 4;
                    emit_battle_started(c, na, nd);
                    Ok(())
                }
            }
        }
        4 => {
            // バトル。「バトルする時」の効果の解決で、どちらかが場を離れていれば、バトルは行われない(115.3a)
            if c.s.winner != Winner::None || c.s.skip_turn {
                return end_attack(c, f);
            }
            let target = var_get(&f.vars, s::TARGET).and_then(target_from_val).unwrap_or(Target::Player);
            // バトルの当事者(置き換えられていなければ、攻撃したクリーチャーと攻撃先)
            let a_pid = var_get(&f.vars, sym("ba")).and_then(|v| v.as_i32()).unwrap_or(pid);
            let d_pid = match target {
                Target::Creature(tp) => var_get(&f.vars, sym("bd")).and_then(|v| v.as_i32()).unwrap_or(tp),
                Target::Player => return end_attack(c, f),
            };
            if c.s.perm_by_pid(a_pid).is_none() || c.s.perm_by_pid(d_pid).is_none() {
                return end_attack(c, f);
            }
            let bi = resolve_battle_core(c, a_pid, d_pid)?;
            // 「バトルの後」の誘発のために、バトルの当事者を残す(聞き手がいる時だけ)
            if has_listener(c, s::AFTER_BATTLE) {
                if let Some(b) = bi {
                    var_set(&mut f.vars, sym("battle"), b);
                }
            }
            f.stage = 5;
            push_proc(c, ProcName::Settle, vec![]);
            Ok(())
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
            end_attack(c, f)
        }
        3 => end_attack(c, f),
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
                if player_cannot_lose(c.env(), defender) {
                    return pop_frame(c, f.id); // ゲームに負けない効果を受けている: 攻撃は終わる
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
                    NeedInput { player: attacker_owner, why: Why::PickShield, input: Some(InputSpec::Pick { candidates: shields.clone(), min: n as i32, max: n as i32, sum: None }), source: None },
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
            // 「ブレイクする前に」の効果で、ブレイクするシールドの上にカードが重ねられていたら、山の一番上のカードをブレイクする
            let mut under_of: Vec<(i32, i32)> = Vec::new();
            if let Some(pl) = &c.s.piles {
                for (top, under) in pl {
                    for &u in under {
                        under_of.push((u, *top));
                    }
                }
            }
            let mut broken: Vec<i32> = Vec::new();
            for u in var_get(&f.vars, s::BROKEN).map(|v| v.to_i32s()).unwrap_or_default() {
                let m = under_of.iter().find(|(x, _)| *x == u).map_or(u, |(_, t)| *t);
                if !broken.contains(&m) {
                    broken.push(m);
                }
            }
            let broken: Vec<i32> = broken
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
            // ボルメテウス・サファイア・ドラゴン: シールドを手札に加えるかわりに墓地に置く(S・トリガーは使えない)。
            // Q.Q.QX.(5.S.D.): シールドを手札に加えるかわりに、相手の山札の上から4枚目の位置に、横向きに刺す
            let atk_top = c.s.perm(vi(&f.vars, s::PID) as i32).map(|p| p.cards[0]);
            if let Some(top) = atk_top {
                let burn = has_self_static_unconditional_pub(c.env(), top, |m| matches!(m, StaticMod::BurnShields));
                if burn {
                    let mut o = MoveOpts::new(Zone::Grave, sym("burn"));
                    o.no_replace = true;
                    move_cards(c, &broken, &o)?;
                    c.s.breaking.clear();
                    f.stage = 2;
                    push_proc(c, ProcName::Settle, vec![]);
                    return Ok(());
                }
                let stab = has_self_static_unconditional_pub(c.env(), top, |m| matches!(m, StaticMod::Stab5sd));
                if stab {
                    c.s.breaking.clear();
                    stab_into_deck(c, &broken, 4);
                    f.stage = 2;
                    push_proc(c, ProcName::Settle, vec![]);
                    return Ok(());
                }
            }
            // S・トリガー/G・ストライクを宣言できるカード(革命2は、ブレイク後の枚数で判定)。重ねられたシールドは、山の全部のカードが手札に加わる
            let with_under: Vec<i32> = broken
                .iter()
                .flat_map(|&u| {
                    let mut v = vec![u];
                    if let Some(pl) = &c.s.piles {
                        if let Some((_, un)) = pl.iter().find(|(k, _)| *k == u) {
                            v.extend(un.iter().copied());
                        }
                    }
                    v
                })
                .collect();
            let cands: Vec<i32> = with_under.iter().copied().filter(|&u| declaration(c.env(), u).is_some()).collect();
            let mut declared: Vec<i32> = Vec::new();
            if !cands.is_empty() {
                let max = cands.len() as i32;
                let ans = ask(
                    c,
                    NeedInput { player: defender, why: Why::TriggerDeclare, input: Some(InputSpec::Pick { candidates: cands, min: 0, max, sum: None }), source: None },
                )?;
                declared = ans.to_i32s();
            }
            // S・バック: 宣言しなかったシールドのカードを捨てて、手札の呪文をコストを支払わずに唱える
            let mut sbacks: Vec<(i32, i32)> = Vec::new();
            if game_has(c.env(), Feat::SBack) {
                for &u in &broken {
                    if declared.contains(&u) {
                        continue;
                    }
                    let back = {
                        let e = c.env();
                        c.s.players[defender as usize].hand.iter().copied().find(|&h| !sbacks.iter().any(|x| x.1 == h) && s_back_matches(e, defender, h, u))
                    };
                    let back = match back {
                        Some(b) => b,
                        None => continue,
                    };
                    let src = ObjRef { uid: back, ep: c.s.cards[back as usize].ep };
                    let ans = ask(c, NeedInput { player: defender, why: Why::May, input: Some(InputSpec::YesNo), source: Some(src) })?;
                    if ans.as_bool() == Some(true) {
                        sbacks.push((u, back));
                    }
                }
            }
            // 宣言がすべて終わってから、手札に加える(112.3a)
            // 宣言できないカードを宣言した(決定化した世界で、見えていたシールドと中身が違う)時は、TS 版と同じく例外にする
            let mut kinds: Vec<(i32, Decl)> = Vec::with_capacity(declared.len());
            for &u in &declared {
                match declaration(c.env(), u) {
                    Some(d) => kinds.push((u, d)),
                    None => return Err(Stop::Fail("宣言できないカードが宣言されました".into())),
                }
            }
            let to_hand: Vec<i32> = if sbacks.is_empty() { broken.clone() } else { broken.iter().copied().filter(|u| !sbacks.iter().any(|x| x.0 == *u)).collect() };
            let mut o = MoveOpts::new(Zone::Hand, s::BREAK);
            o.no_replace = true;
            move_cards(c, &to_hand, &o)?;
            if !sbacks.is_empty() {
                let mut o2 = MoveOpts::new(Zone::Grave, sym("discard"));
                o2.no_replace = true;
                let us: Vec<i32> = sbacks.iter().map(|x| x.0).collect();
                move_cards(c, &us, &o2)?;
            }
            for &(_, back) in &sbacks {
                let (def, ep) = {
                    let bc = &c.s.cards[back as usize];
                    (bc.def, bc.ep)
                };
                let sf = c.reg.defs[def as usize].faces.iter().position(|x| x.ty == FaceType::Spell);
                let sf = match sf {
                    Some(x) => x as i64,
                    None => continue,
                };
                let id = c.s.next_id();
                let vars: Vars = vec![
                    (s::UID, Val::Int(back as i64)),
                    (s::EP, Val::Int(ep as i64)),
                    (s::FROM, Val::zone(Zone::Hand)),
                    (s::FACE, Val::Int(sf)),
                    (s::FREE, Val::Bool(true)),
                    (s::AFTER, Val::Null),
                    (s::SETTLE, Val::Bool(false)),
                ];
                c.s.cont.push(Frame::Proc(ProcFrame { id, caused_by: c.cause, name: ProcName::Play, stage: 0, vars }));
            }
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

/// S・バック: 手札のカード back が、シールドから手札に加わるカード u に対して使えるか
fn s_back_matches(e: Env, owner: PlayerId, back: i32, u: i32) -> bool {
    if back == u {
        return false;
    }
    let def = &e.reg.defs[e.s.cards[back as usize].def as usize];
    for face in &def.faces {
        for a in &face.abilities {
            if let Ability::Keyword { name: KeywordName::SBack, attacker: Some(ac), .. } = a {
                if eval_cond(&CC::new(e, owner).with_self(back).with_it(u, -1), ac) {
                    return true;
                }
            }
        }
    }
    false
}

/// while を見ずに、そのカード自身が持つ常在型能力に pred に合うものがあるか
fn has_self_static_unconditional_pub(e: Env, uid: i32, pred: impl Fn(&StaticMod) -> bool) -> bool {
    let info = info_of(e, uid);
    if info.statics.is_empty() {
        return false;
    }
    let card = &e.s.cards[uid as usize];
    let face = e.reg.face(card.def, chars_lite(e, uid, -1).face_idx);
    info.statics.iter().any(|&si| matches!(&face.abilities[si as usize], Ability::Static { m, .. } if pred(m)))
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
    // 豪龍の記憶: 「S・トリガー」を与えられたシールド(次の持ち主のターンのはじめまで)
    let granted = match e.s.usage_get(&UKey::Other(format!("stg:{}:{}", uid, card.ep))) {
        Some(g) => card.zone == Zone::Shield && (e.s.turn as i64) - g <= 1,
        None => false,
    };
    // 「自分のシールドゾーンから手札に加える呪文すべてに、S・トリガーを与える」(天雷龍姫エリザベス)
    let spell_granted = game_has(e, Feat::SpellShieldTrigger) && any_static(e, |st| matches!(st.m, StaticMod::SpellShieldTrigger) && st.controller == card.owner);
    // 攻撃中の相手のクリーチャーの「このクリーチャーの攻撃中、相手は G・ストライクを使えない」(覇帝なき侵略 レッドゾーンF)
    let g_banned = game_has(e, Feat::NoGStrike)
        && any_static(e, |st| matches!(st.m, StaticMod::NoGStrike) && st.controller != card.owner && is_attacking(e, e.s.cards[st.src as usize].pid));
    // 相手の「自身の S・トリガーを使えない」(バイラス・カースド)
    let st_banned = game_has(e, Feat::NoOppShieldTrigger) && any_static(e, |st| matches!(st.m, StaticMod::NoOppShieldTrigger) && st.controller != card.owner);
    let spell_face = def.faces.iter().position(|x| x.ty == FaceType::Spell);
    for (fi, face) in def.faces.iter().enumerate() {
        let info = e.reg.info(card.def, fi as i32);
        if !st_banned {
            for &si in &info.shield_triggers {
                if let Ability::Keyword { while_: Some(w), .. } = &face.abilities[si as usize] {
                    if !eval_cond(&cc, w) {
                        continue;
                    }
                }
                return Some(Decl { kind: PoolKind::ShieldTrigger, aref: AbilityRef { def: card.def, face: fi as u8, idx: si }, face: fi as i32 });
            }
        }
        if spell_granted && !st_banned && face.ty == FaceType::Spell {
            return Some(Decl { kind: PoolKind::ShieldTrigger, aref: AbilityRef { def: card.def, face: fi as u8, idx: 0 }, face: fi as i32 });
        }
        if granted && !st_banned && !def.faces.is_empty() && fi == spell_face.unwrap_or(0) {
            return Some(Decl { kind: PoolKind::ShieldTrigger, aref: AbilityRef { def: card.def, face: fi as u8, idx: 0 }, face: fi as i32 });
        }
        if let Some(gi) = info.g_strike {
            if !g_banned {
                return Some(Decl { kind: PoolKind::GStrike, aref: AbilityRef { def: card.def, face: fi as u8, idx: gi }, face: fi as i32 });
            }
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
                cc.event = e.event.as_deref();
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
            ]
            .into_iter()
            .chain(if game_has(c.env(), Feat::StUsed) { Some((sym("st"), Val::Bool(true))) } else { None })
            .collect(),
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
    // 山札の横向きのカードを手札に加えたプレイヤーは、ゲームに負ける(「ゲームに負ける時」の置換・負けない効果が使える)
    if c.s.pending_loss.as_ref().map_or(false, |v| !v.is_empty()) {
        let p = c.s.pending_loss.as_ref().unwrap()[0];
        if loss_replacement(c, p, false)? {
            c.s.pending_loss.as_mut().unwrap().remove(0);
            return Ok(true);
        }
        c.s.pending_loss.as_mut().unwrap().remove(0);
        if !player_cannot_lose(c.env(), p) {
            c.s.winner = Winner::P(opp(p));
            c.s.lose_reason = Some("山札の横向きのカードを手札に加えた".to_string());
            emit(c, s::GAME_OVER, vec![(s::WINNER, Val::Int(opp(p) as i64)), (s::REASON, Val::Str(sym("山札の横向きのカードを手札に加えた")))]);
        }
        return Ok(true);
    }
    // 山札が0枚のプレイヤーは敗北(104.2b)。置換された後は、山札が増えるまで再度は起きない
    for p in 0..2usize {
        if !c.s.players[p].deck.is_empty() {
            c.s.usage_del(&UKey::DeckOut(p as u8));
        }
    }
    let losers: Vec<usize> = (0..2usize)
        .filter(|&p| {
            c.s.players[p].deck.is_empty()
                && c.s.turn >= 1
                && !(c.s.cfg.solitaire && p == 1)
                && c.s.usage_get(&UKey::DeckOut(p as u8)).unwrap_or(0) == 0
                && !player_cannot_lose(c.env(), p as u8)
                && !any_static(c.env(), |st| matches!(st.m, StaticMod::NoDeckOutLoss) && st.controller == p as u8)
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
                let u = perm.cards[0];
                // 「離れない」クリーチャーは、破壊されない(破壊しようとしても何も起きないので、状況起因処理が終わらなくなるのを避ける)
                if !chars_lite(e, u, -1).ty.is_creature() || power_of(e, perm) > 0 || cannot_leave(e, u, Some(s::DESTROY)) {
                    continue;
                }
                // 破壊のかわりの手順(エスケープなど)がまだ終わっていないクリーチャーは、その手順のあとにもう一度調べる
                let pending_replace = c.s.cont.iter().any(|fr| match fr {
                    Frame::Effect(ef) => ef.trigger.as_ref().map_or(false, |t| t.ty == sym("replaced") && t.int(s::CARD) == Some(u as i64)),
                    _ => false,
                });
                if pending_replace {
                    continue;
                }
                dead.push(u);
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
                NeedInput { player: p as u8, why: Why::KeepOne, input: Some(InputSpec::Pick { candidates: smax.clone(), min: 1, max: 1, sum: None }), source: None },
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
/// 山札からカードが最後に離れたのが、カードを引いたことによるものか(今のターンの記録から調べる)
fn last_deck_exit_was_draw(c: &Ctx, p: PlayerId) -> bool {
    for e in c.s.turn_log.iter().rev() {
        if e.ty == s::MOVED && e.sym_of(s::FROM) == Some(Zone::Deck.sym()) && e.int(s::OWNER) == Some(p as i64) {
            return e.sym_of(s::CAUSE) == Some(s::DRAW);
        }
    }
    false
}

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
                        input: Some(InputSpec::Pick { candidates: pool, min: 3, max: 3, sum: None }),
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
    // 「ゲームに負ける時、かわりに〜してもよい」(手順を行う置換): バトルゾーンと手札のカードが持つ
    let mut cands: Vec<(i32, u16, u16, bool, Option<String>)> = Vec::new(); // (uid, face, idx, optional, label)
    {
        let e = c.env();
        let mut holders: Vec<i32> = c.s.players[p as usize].battle.iter().map(|x| x.cards[0]).collect();
        holders.extend(c.s.players[p as usize].hand.iter().copied());
        for uid in holders {
            let card = &c.s.cards[uid as usize];
            let (info, face_i) = if card.zone == Zone::Battle {
                (info_of(e, uid), chars_lite(e, uid, -1).face_idx)
            } else {
                (e.reg.info(card.def, 0), 0)
            };
            let face = reg.face(card.def, face_i);
            for &ri in &info.replaces {
                if let Ability::Replace { match_, apply: ReplaceApply::Steps(_), optional, while_, label } = &face.abilities[ri as usize] {
                    if match_.ty != s::GAME_LOSS {
                        continue;
                    }
                    if match_.turn == Some(TurnSel::Opponent) && c.s.active == p {
                        continue;
                    }
                    if match_.turn == Some(TurnSel::Own) && c.s.active != p {
                        continue;
                    }
                    if match_.reason == Some(sym("deckOut")) && !deck_out {
                        continue; // 山札切れによる敗北だけ
                    }
                    // 山札の最後の1枚を「引いたことによって」負ける時だけ(山札が墓地に置かれて0枚になった時などは含まない)
                    if match_.reason == Some(sym("deckOutDraw")) && !(deck_out && last_deck_exit_was_draw(c, p)) {
                        continue;
                    }
                    if let Some(w) = while_ {
                        if !eval_cond(&CC::new(e, p).with_self(uid), w) {
                            continue;
                        }
                    }
                    cands.push((uid, face_i as u16, ri, *optional, label.clone()));
                }
            }
        }
    }
    if cands.is_empty() {
        return Ok(false);
    }
    let mut pick_idx = 0usize;
    if cands.len() > 1 || cands[0].3 {
        let mut options: Vec<String> = cands.iter().map(|x| x.4.clone().unwrap_or_else(|| "かわりの処理を行う".to_string())).collect();
        options.push("置換しない".to_string());
        let src = ObjRef { uid: cands[0].0, ep: c.s.cards[cands[0].0 as usize].ep };
        let ans = ask(c, NeedInput { player: p, why: Why::ReplaceChoice, input: Some(InputSpec::Option { options, pick: 1, repeat: false, all_if: false, seen: None }), source: Some(src) })?;
        pick_idx = ans.to_i32s().first().copied().unwrap_or(0) as usize;
        if pick_idx >= cands.len() {
            return Ok(false);
        }
    }
    let (cuid, cface, cidx, _, _) = cands[pick_idx].clone();
    let (cdef, cep, czone, cface_cur) = {
        let card = &c.s.cards[cuid as usize];
        (card.def, card.ep, card.zone, card.face)
    };
    if deck_out {
        c.s.usage_set(&key, 1);
    }
    let _ = (cface, cface_cur);
    let face_use = if czone == Zone::Battle { cface_cur } else { 0 };
    push_effect(c, AbilityRef { def: cdef, face: face_use as u8, idx: cidx }, ObjRef { uid: cuid, ep: cep }, p, None, true);
    Ok(true)
}

// ───────────────────────── ディスパッチ ─────────────────────────

pub fn run_proc(c: &mut Ctx, fi: usize) -> Res<()> {
    crate::prof!(9);
    let id = c.s.cont[fi].id();
    // 実行中の攻撃の手続きは、いま攻撃中のクリーチャーの判定(is_attacking)のために、名前と pid だけ残しておく
    let placeholder = match &c.s.cont[fi] {
        Frame::Proc(p) if p.name == ProcName::Attack => {
            Frame::Proc(ProcFrame { id, caused_by: None, name: ProcName::Attack, stage: p.stage, vars: p.vars.iter().filter(|(k, _)| *k == s::PID).cloned().collect() })
        }
        _ => Frame::Proc(ProcFrame { id, caused_by: None, name: ProcName::Sba, stage: 0, vars: Vec::new() }),
    };
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
        ProcName::Battle => run_battle(c, &mut f),
        ProcName::Sba => fail("未知の手続き: sba"),
    };
    // 自分が pop されていなければ、変更を書き戻す(入力待ちで止まった時も含む)
    if c.s.cont.len() > fi && c.s.cont[fi].id() == f.id {
        c.s.cont[fi] = Frame::Proc(f);
    }
    r
}
