//! エンジンの入口: step(reducer)・実行ループ(src/engine/engine.ts)。

use crate::legal::validate_action;
use crate::ops::*;
use crate::procs::*;
use crate::registry::Registry;
use crate::state::*;
use crate::types::*;
use crate::vm::run_effect;
use std::rc::Rc;

pub struct StepOut {
    pub state: State,
    pub events: Vec<Rc<Ev>>,
}

/// 状態に行動を適用した新しい状態を返す。入力は書き換えない。
pub fn step(reg: &Registry, state: &State, action: &Action) -> Result<StepOut, String> {
    if let Some(err) = validate_action(state, reg, action) {
        return Err(format!("不正な行動: {}", err));
    }
    let mut c = Ctx::new(state.clone(), reg);
    run_step(&mut c, action)?;
    Ok(StepOut { state: c.s, events: c.out })
}

/// 検証せず、状態を消費して進める(プレイアウト用。行動は legal_actions から選ばれている前提。イベントは集めない)
pub fn step_owned(reg: &Registry, state: State, action: &Action) -> Result<State, String> {
    let mut c = Ctx::new(state, reg);
    c.keep_out = false;
    run_step(&mut c, action)?;
    Ok(c.s)
}

fn run_step(c: &mut Ctx, action: &Action) -> Result<(), String> {
    if let Action::Answer { value, .. } = action {
        c.s.rans.push(value.clone());
        c.s.pending = None;
    } else {
        c.s.pending = None;
        match apply_turn_action(c, action) {
            Ok(()) => {}
            Err(Stop::Fail(m)) => return Err(m),
            Err(Stop::Need(_)) => return Err("行動の適用中に入力待ちになりました".into()),
        }
    }
    drive(c)
}

fn apply_turn_action(c: &mut Ctx, a: &Action) -> Res<()> {
    match a {
        Action::ChargeMana(uid) => {
            move_cards(c, &[*uid], &MoveOpts::new(Zone::Mana, s::CHARGE))?;
            c.s.mana_charged = true;
            c.s.step = Step::Main;
            push_proc(c, ProcName::Settle, vec![]);
        }
        Action::SkipMana => c.s.step = Step::Main,
        Action::EndMain => c.s.step = Step::Attack,
        Action::EndTurn => c.s.step = Step::End,
        Action::PlayCard { uid, from, face, extra } => {
            let (def, ep) = {
                let card = &c.s.cards[*uid as usize];
                (card.def, card.ep)
            };
            let fi = match face {
                Some(f) => *f,
                None => c.reg.defs[def as usize].faces.iter().position(|f| f.ty != FaceType::Spell).unwrap_or(0) as i32,
            };
            push_proc(c, ProcName::Settle, vec![]);
            push_proc(
                c,
                ProcName::Play,
                vec![
                    (s::UID, Val::Int(*uid as i64)),
                    (s::EP, Val::Int(ep as i64)),
                    (s::FROM, Val::zone(from.unwrap_or(Zone::Hand))),
                    (s::FACE, Val::Int(fi as i64)),
                    (s::EXTRA, extra.as_ref().map_or(Val::Null, extra_to_val)),
                    (s::FREE, Val::Bool(false)),
                    (s::AFTER, Val::Null),
                ],
            );
        }
        Action::Attack { attacker, target } => {
            c.s.step = Step::Attack;
            push_proc(c, ProcName::Settle, vec![]);
            push_proc(c, ProcName::Attack, vec![(s::PID, Val::Int(*attacker as i64)), (s::TARGET, target_to_val(target))]);
        }
        Action::Answer { .. } => {}
    }
    Ok(())
}

/// 実行ループ。入力待ち・決着・フレームが尽きるまで進める。
pub fn drive(c: &mut Ctx) -> Result<(), String> {
    let mut steps = 0;
    while c.s.pending.is_none() && c.s.winner == Winner::None && !c.s.cont.is_empty() {
        steps += 1;
        if steps > c.s.cfg.max_frame_steps {
            return Err("処理が終わりません(無限ループの疑い)".into());
        }
        let fi = c.s.cont.len() - 1;
        let (is_effect, id) = match &c.s.cont[fi] {
            Frame::Effect(f) => (true, f.id),
            Frame::Proc(f) => (false, f.id),
        };
        c.ask_idx = 0;
        c.rng0 = c.s.rng;
        c.seq0 = c.s.seq;
        c.cause = Some(id);
        let r: Res<()> = if is_effect {
            // 効果の途中でも状況起因処理を優先する(111.2d)
            let sba = if c.s.dirty_sba && c.s.cfg.sba_after_each_step { run_sba(c) } else { Ok(false) };
            match sba {
                Err(e) => Err(e),
                Ok(true) => {
                    c.s.rans.clear();
                    continue;
                }
                Ok(false) => match run_effect(c, fi) {
                    Ok(done) => {
                        if done {
                            if let Some(top) = c.s.cont.last() {
                                if top.id() == id {
                                    c.s.cont.pop();
                                }
                            }
                        }
                        Ok(())
                    }
                    Err(e) => Err(e),
                },
            }
        } else {
            run_proc(c, fi)
        };
        match r {
            Ok(()) => c.s.rans.clear(),
            Err(Stop::Need(spec)) => {
                let pid = c.s.next_id();
                c.s.pending = Some(Pending { id: pid, player: spec.player, why: spec.why, input: spec.input, source: spec.source });
                break;
            }
            Err(Stop::Fail(m)) => return Err(m),
        }
    }
    Ok(())
}
