//! カード定義の索引・能力のコンパイル(src/engine/registry.ts)。
//! 定義は TS 版が展開済み(キーワード → 誘発能力)のものを JSON で受け取る。

use crate::ast::*;
use crate::json::Json;
use crate::types::*;
use std::collections::HashMap;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub struct Face {
    pub name: String,
    pub ty: FaceType,
    pub cost: i32,
    pub civs: Rc<Vec<Civ>>,
    pub power: Option<i32>,
    pub races: Vec<String>,
    /// カード定義に races の項目があるか(呪文面には無い。useCip が見る)
    pub has_races: bool,
    pub abilities: Vec<Ability>,
    pub evolve_from: Option<Cond>,
    /// スター進化(離れる時、かわりに一番上のカードだけが離れる)
    pub star: bool,
    /// 究極進化
    pub ultimate: bool,
    /// 呪文が、相手のクリーチャーがいなければ空振りになるか(ルールベースAIが、相手の盤面が空の時に避ける。
    /// カードのデータから判定する。TS 版の ai/spellTargets.ts と同じ)
    pub needs_opp_creature: bool,
}

fn is_opp_battle(sel: &Json) -> bool {
    let zone_ok = match sel.get("zone") {
        Some(z) => z.as_str() == Some("battle") || z.as_arr().map_or(false, |a| a.len() == 1 && a[0].as_str() == Some("battle")),
        None => false,
    };
    zone_ok && sel.get("owner").and_then(|o| o.as_str()) == Some("opponent")
}

/// 手順の先頭から見て、相手のクリーチャーがいなければ何も起こらないか
fn depends_on_opp_creature(steps: Option<&Json>) -> bool {
    let arr = match steps.and_then(|s| s.as_arr()) {
        Some(a) => a,
        None => return false,
    };
    for st in arr {
        match st.get("op").and_then(|o| o.as_str()) {
            Some("select") => {
                let from_opp = st.get("from").map_or(false, is_opp_battle);
                let min = st.get("min").and_then(|m| m.as_i64()).unwrap_or(1);
                if from_opp && min >= 1 {
                    return true;
                }
                // 選ぶだけでは何も起こらない。後の効果を見る
            }
            Some("act") => {
                let body = st.get("act").and_then(|a| a.keys().first().map(|k| a.get(k))).flatten();
                return body.and_then(|b| b.get("sel")).map_or(false, is_opp_battle);
            }
            Some("modes") => {
                // すべての選択肢が対象を要するときだけ(1つでも対象なしで使えるものがあれば、空振りにならない)
                let opts: &[Json] = st.get("options").and_then(|o| o.as_arr()).map(|a| a.as_slice()).unwrap_or(&[]);
                return st.get("allIf").is_none() && !opts.is_empty() && opts.iter().all(|o| depends_on_opp_creature(o.get("steps")));
            }
            _ => return false,
        }
    }
    false
}

#[derive(Clone, Debug)]
pub struct Def {
    pub id: String,
    pub name: String,
    pub faces: Vec<Face>,
    /// 全面の文明の和集合
    pub union_civs: Rc<Vec<Civ>>,
}

#[derive(Clone, Debug, Default)]
pub struct FaceInfo {
    pub blocker: bool,
    pub breaker: i32,
    pub speed_attacker: bool,
    pub mach_fighter: bool,
    pub ex_life: bool,
    pub just_diver: bool,
    pub slayer: bool,
    pub sympathy: bool,
    pub hyper_energy: bool,
    /// 能力の添字
    pub shield_triggers: Vec<u16>,
    pub g_strike: Option<u16>,
    pub breakers: Vec<u16>,
    pub statics: Vec<u16>,
    pub replaces: Vec<u16>,
    pub permissions: Vec<u16>,
    pub triggers: Vec<u16>,
    pub spell: Option<u16>,
    pub self_costs: Vec<u16>,
    pub alt_costs: Vec<u16>,
    /// ハイパー化の、タップする他のクリーチャーの数
    pub hyperize: Option<i32>,
    /// パワード・ブレイカー: パワー n ごとにシールドをもう1つブレイクする
    pub powered_breaker: Option<i32>,
    pub shinkalize: bool,
}

/// 機能ごとの「その機能を持つカード」(TS 版の FeatureName)。持つカードが対局のデッキに無ければ、その機能を探す処理を省く
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Feat {
    EntryReplace,
    AfterCast,
    MoveReplace,
    LeaveReplace,
    HandReplace,
    DrawEmpty,
    MustBeChosen,
    FirstBattleWins,
    EnterTapped,
    AllowPlayFrom,
    NoOppShieldTrigger,
    AttackMeFirst,
    SBack,
    EnteredFrom,
    OneSpellPerTurn,
    PowerAddOthers,
    CannotPlay,
    BattleProxy,
    HostPowerAdd,
    StUsed,
    CannotLeaveOwn,
    NoAttackOnEntry,
    SpellShieldTrigger,
    ManaAllCivs,
    TapAsMana,
    Flying,
    NoGStrike,
    OppManaTapped,
    CannotSummonAll,
    ProtectPlayerFromWeaker,
}

pub const N_FEAT: usize = 30;

#[derive(Clone, Debug)]
pub enum Instr {
    Act(Act),
    Select(SelectStep),
    May { no: usize },
    Jmp(usize),
    Jf { cond: Cond, to: usize },
    Modes { step: ModesStep, key: Sym, key_i: Sym, starts: Rc<Vec<usize>>, next: usize },
    ModesNext { key: Sym, key_i: Sym, starts: Rc<Vec<usize>>, end: usize },
    EachInit { in_var: String, key: Sym, key_list: Sym },
    EachNext { as_: Sym, key: Sym, key_list: Sym, end: usize },
    RepeatInit { times: Expr, key: Sym },
    RepeatNext { key: Sym, end: usize },
    SetIter(u8),
    Custom(String),
}

pub type Program = Rc<Vec<Instr>>;

#[derive(Clone, Copy, Debug)]
pub struct TrigRef {
    pub def: u16,
    pub face: u8,
    pub idx: u16,
}

pub struct Registry {
    pub defs: Vec<Def>,
    pub infos: Vec<Vec<FaceInfo>>,
    pub by_id: HashMap<String, u16>,
    pub ids: Vec<String>,
    pub id_syms: Vec<Sym>,
    /// イベントの種類 → 定義ごとの誘発能力
    pub trig_by_def: Vec<Option<Vec<Vec<TrigRef>>>>,
    /// イベントの種類 → 誘発能力を持つ定義の一覧
    pub trig_defs: Vec<Option<Vec<u16>>>,
    /// [def][face][idx] → (任意あり, 任意なし)
    progs: Vec<Vec<Vec<Option<(Program, Program)>>>>,
    /// 定義ごとの、持つ機能のビット(Feat の番号)
    pub feat_def: Vec<u64>,
    /// いずれかの定義が持つ機能のビット(デッキが分からない状態で使う)
    pub feat_any: u64,
    /// 能力を無視されているカードの FaceInfo(何の能力も持たない)
    pub empty_info: FaceInfo,
}

fn civs_of(j: &Json) -> R<Vec<Civ>> {
    j.as_arr()
        .ok_or("civs")?
        .iter()
        .map(|c| Civ::parse(c.as_str().unwrap_or("")).ok_or_else(|| format!("未知の文明: {}", c)))
        .collect()
}

impl Registry {
    pub fn from_json(defs_json: &Json) -> R<Registry> {
        let items = match defs_json {
            Json::Obj(o) => o,
            _ => return Err("defs はオブジェクトです".into()),
        };
        let mut defs = Vec::new();
        let mut by_id = HashMap::new();
        let mut ids = Vec::new();
        for (id, d) in items {
            let faces_j = d.get("faces").and_then(|f| f.as_arr()).ok_or_else(|| format!("{}: faces がありません", id))?;
            let mut faces = Vec::new();
            for f in faces_j {
                let ty = FaceType::parse(f.get("type").and_then(|x| x.as_str()).unwrap_or("")).ok_or_else(|| format!("{}: type が不正", id))?;
                let abilities = f
                    .get("abilities")
                    .and_then(|a| a.as_arr())
                    .map(|a| a.iter().map(parse_ability).collect::<R<Vec<_>>>())
                    .unwrap_or_else(|| Ok(vec![]))
                    .map_err(|e| format!("{}: {}", id, e))?;
                faces.push(Face {
                    name: f.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                    ty,
                    cost: f.get("cost").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
                    civs: Rc::new(civs_of(f.get("civs").ok_or("civs")?)?),
                    power: f.get("power").and_then(|x| x.as_i64()).map(|x| x as i32),
                    races: f.get("races").and_then(|r| r.as_arr()).map(|r| r.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default(),
                    has_races: f.get("races").is_some(),
                    abilities,
                    evolve_from: match f.get("evolveFrom") {
                        Some(c) => Some(parse_cond(c).map_err(|e| format!("{}: {}", id, e))?),
                        None => None,
                    },
                    star: f.get("star").and_then(|x| x.as_bool()).unwrap_or(false),
                    ultimate: f.get("ultimate").and_then(|x| x.as_bool()).unwrap_or(false),
                    needs_opp_creature: f
                        .get("abilities")
                        .and_then(|a| a.as_arr())
                        .map_or(false, |a| a.iter().any(|x| x.get("kind").and_then(|k| k.as_str()) == Some("spell") && depends_on_opp_creature(x.get("steps")))),
                });
            }
            let mut union: Vec<Civ> = Vec::new();
            for f in &faces {
                for c in f.civs.iter() {
                    if !union.contains(c) {
                        union.push(*c);
                    }
                }
            }
            let idx = defs.len() as u16;
            by_id.insert(id.clone(), idx);
            ids.push(id.clone());
            defs.push(Def {
                id: id.clone(),
                name: d.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                faces,
                union_civs: Rc::new(union),
            });
        }
        // 索引
        let mut infos = Vec::new();
        let mut trig_map: HashMap<Sym, Vec<Vec<TrigRef>>> = HashMap::new();
        let nd = defs.len();
        for (di, d) in defs.iter().enumerate() {
            let mut finfo = Vec::new();
            for (fi, f) in d.faces.iter().enumerate() {
                let mut info = FaceInfo { breaker: 1, ..Default::default() };
                for (ai, a) in f.abilities.iter().enumerate() {
                    let ai = ai as u16;
                    match a {
                        Ability::Keyword { name, n, .. } => match name {
                            KeywordName::Blocker => info.blocker = true,
                            KeywordName::Breaker => {
                                info.breakers.push(ai);
                                info.breaker = info.breaker.max(n.unwrap_or(2));
                            }
                            KeywordName::SpeedAttacker => info.speed_attacker = true,
                            KeywordName::MachFighter => info.mach_fighter = true,
                            KeywordName::ExLife => info.ex_life = true,
                            KeywordName::JustDiver => info.just_diver = true,
                            KeywordName::Slayer => info.slayer = true,
                            KeywordName::Sympathy => info.sympathy = true,
                            KeywordName::HyperEnergy => info.hyper_energy = true,
                            KeywordName::ShieldTrigger => info.shield_triggers.push(ai),
                            KeywordName::GStrike => info.g_strike = Some(ai),
                            KeywordName::PoweredBreaker => info.powered_breaker = Some(n.unwrap_or(6000)),
                            _ => {}
                        },
                        Ability::Trigger { spec, .. } => {
                            info.triggers.push(ai);
                            // 同じ種類のイベントを複数のパターンで聞く能力も、その種類の索引には1回だけ載せる
                            let mut seen: Vec<Sym> = Vec::new();
                            for on in &spec.on {
                                if seen.contains(&on.ty) {
                                    continue;
                                }
                                seen.push(on.ty);
                                let v = trig_map.entry(on.ty).or_insert_with(|| vec![Vec::new(); nd]);
                                v[di].push(TrigRef { def: di as u16, face: fi as u8, idx: ai });
                            }
                        }
                        Ability::Static { .. } => info.statics.push(ai),
                        Ability::Replace { .. } => info.replaces.push(ai),
                        Ability::Permission { .. } => info.permissions.push(ai),
                        Ability::Spell { .. } => info.spell = Some(ai),
                        Ability::SelfCost { .. } => info.self_costs.push(ai),
                        Ability::AltCost { .. } => info.alt_costs.push(ai),
                        Ability::Hyperize { tap_other } => info.hyperize = Some(*tap_other),
                        Ability::Shinkalize => info.shinkalize = true,
                    }
                }
                finfo.push(info);
            }
            infos.push(finfo);
        }
        // プログラム
        let mut progs = Vec::new();
        for d in &defs {
            let mut pf = Vec::new();
            for f in &d.faces {
                let mut pa = Vec::new();
                for a in &f.abilities {
                    let steps: Option<&Vec<StepDef>> = match a {
                        Ability::Trigger { steps, .. } => Some(steps),
                        Ability::Spell { steps } => Some(steps),
                        Ability::Keyword { steps, .. } => steps.as_ref(),
                        Ability::Replace { apply: ReplaceApply::Steps(st), .. } => Some(st),
                        Ability::Replace { apply: ReplaceApply::ChangeDest { then: Some(st), .. }, .. } => Some(st),
                        _ => None,
                    };
                    let steps_v: Vec<StepDef> = steps.cloned().unwrap_or_default();
                    let optional = matches!(a, Ability::Trigger { optional: true, .. });
                    let mut p_opt: Vec<Instr> = Vec::new();
                    if optional {
                        p_opt.push(Instr::May { no: usize::MAX });
                        compile_steps(&steps_v, &mut p_opt);
                        let end = p_opt.len();
                        p_opt[0] = Instr::May { no: end };
                    } else {
                        compile_steps(&steps_v, &mut p_opt);
                    }
                    let mut p_no: Vec<Instr> = Vec::new();
                    compile_steps(&steps_v, &mut p_no);
                    pa.push(Some((Rc::new(p_opt), Rc::new(p_no))));
                }
                pf.push(pa);
            }
            progs.push(pf);
        }
        let max_sym = trig_map.keys().map(|k| k.0 as usize).max().map_or(0, |m| m + 1);
        let mut trig_by_def: Vec<Option<Vec<Vec<TrigRef>>>> = vec![None; max_sym];
        for (k, v) in trig_map {
            trig_by_def[k.0 as usize] = Some(v);
        }
        let mut trig_defs: Vec<Option<Vec<u16>>> = vec![None; trig_by_def.len()];
        for (i, v) in trig_by_def.iter().enumerate() {
            if let Some(per_def) = v {
                trig_defs[i] = Some(per_def.iter().enumerate().filter(|(_, r)| !r.is_empty()).map(|(d, _)| d as u16).collect());
            }
        }
        let id_syms: Vec<Sym> = ids.iter().map(|i| sym(i)).collect();
        // 機能ごとの定義のビット
        let mut feat_def: Vec<u64> = vec![0; defs.len()];
        let enter = sym("enter");
        let after_cast = sym("afterCast");
        let mv = sym("move");
        let leave = sym("leave");
        let moved = sym("moved");
        let drawn_empty = sym("drawEmpty");
        for (di, d) in defs.iter().enumerate() {
            let mut bits = 0u64;
            let mut set = |f: Feat| bits |= 1u64 << (f as u32);
            for (fi, f) in d.faces.iter().enumerate() {
                let _ = fi;
                for a in &f.abilities {
                    match a {
                        Ability::Replace { match_, .. } => {
                            if match_.ty == enter {
                                set(Feat::EntryReplace);
                            } else if match_.ty == after_cast {
                                set(Feat::AfterCast);
                            } else if match_.ty == mv {
                                set(Feat::MoveReplace);
                            } else if match_.ty == leave {
                                set(Feat::LeaveReplace);
                            } else if match_.ty == drawn_empty {
                                set(Feat::DrawEmpty);
                            }
                            if match_.ty == moved && match_.from == Some(s::Z_HAND) {
                                set(Feat::HandReplace);
                            }
                        }
                        Ability::Static { m, .. } => match m {
                            StaticMod::MustBeChosen => set(Feat::MustBeChosen),
                            StaticMod::FirstBattleWins => set(Feat::FirstBattleWins),
                            StaticMod::EnterTappedFirst | StaticMod::EnterTapped => set(Feat::EnterTapped),
                            StaticMod::AllowPlayFrom { .. } => set(Feat::AllowPlayFrom),
                            StaticMod::NoOppShieldTrigger => set(Feat::NoOppShieldTrigger),
                            StaticMod::AttackMeFirst => set(Feat::AttackMeFirst),
                            StaticMod::OneSpellPerTurn => set(Feat::OneSpellPerTurn),
                            StaticMod::PowerAddOthers { .. } => set(Feat::PowerAddOthers),
                            StaticMod::CannotPlay { .. } => set(Feat::CannotPlay),
                            StaticMod::HostPowerAdd { .. } => set(Feat::HostPowerAdd),
                            StaticMod::CannotLeaveOwn { .. } => set(Feat::CannotLeaveOwn),
                            StaticMod::NoAttackOnEntry => set(Feat::NoAttackOnEntry),
                            StaticMod::SpellShieldTrigger => set(Feat::SpellShieldTrigger),
                            StaticMod::ManaAllCivs => set(Feat::ManaAllCivs),
                            StaticMod::TapAsMana => set(Feat::TapAsMana),
                            StaticMod::Flying => set(Feat::Flying),
                            StaticMod::NoGStrike => set(Feat::NoGStrike),
                            StaticMod::CannotSummonAll { .. } => set(Feat::CannotSummonAll),
                            StaticMod::ProtectPlayerFromWeaker => set(Feat::ProtectPlayerFromWeaker),
                            StaticMod::OppManaTapped => set(Feat::OppManaTapped),
                            StaticMod::BattleProxy { .. } => set(Feat::BattleProxy),
                            _ => {}
                        },
                        Ability::Keyword { name: KeywordName::SBack, .. } => set(Feat::SBack),
                        Ability::Trigger { spec, .. } => {
                            if spec.on.iter().any(|p| p.ty == s::ENTERED && p.from.is_some()) {
                                set(Feat::EnteredFrom);
                            }
                        }
                        _ => {}
                    }
                }
            }
            feat_def[di] = bits;
        }
        // stUsed: 能力の JSON に "stUsed" を含むカード
        for (di, (_, d)) in items.iter().enumerate() {
            let has = d.get("faces").and_then(|f| f.as_arr()).map_or(false, |fs| {
                fs.iter().any(|f| f.get("abilities").map_or(false, |a| format!("{}", a).contains("\"stUsed\"")))
            });
            if has {
                feat_def[di] |= 1u64 << (Feat::StUsed as u32);
            }
        }
        let feat_any = feat_def.iter().fold(0u64, |a, b| a | b);
        let empty_info = FaceInfo { breaker: 1, ..Default::default() };
        Ok(Registry { defs, infos, by_id, ids, id_syms, trig_by_def, trig_defs, progs, feat_def, feat_any, empty_info })
    }

    pub fn def_index(&self, id: &str) -> Option<u16> {
        self.by_id.get(id).copied()
    }

    pub fn face(&self, def: u16, face: i32) -> &Face {
        let d = &self.defs[def as usize];
        d.faces.get(face as usize).unwrap_or(&d.faces[0])
    }

    pub fn info(&self, def: u16, face: i32) -> &FaceInfo {
        let i = &self.infos[def as usize];
        i.get(face as usize).unwrap_or(&i[0])
    }

    pub fn ability(&self, r: AbilityRef) -> &Ability {
        &self.defs[r.def as usize].faces.get(r.face as usize).unwrap_or(&self.defs[r.def as usize].faces[0]).abilities[r.idx as usize]
    }

    pub fn program(&self, r: AbilityRef, no_optional: bool) -> Program {
        let p = self.progs[r.def as usize][r.face as usize][r.idx as usize].as_ref().unwrap();
        if no_optional {
            p.1.clone()
        } else {
            p.0.clone()
        }
    }

    pub fn names(&self) -> Names<'_> {
        Names { defs: &self.ids }
    }
}

fn key_syms(prefix: &str, pc: usize) -> (Sym, Sym) {
    let k = format!("${}{}", prefix, pc);
    (sym(&k), sym(&format!("{}:i", k)))
}

fn compile_steps(steps: &[StepDef], out: &mut Vec<Instr>) {
    for st in steps {
        match st {
            StepDef::Act(a) => out.push(Instr::Act(a.clone())),
            StepDef::Select(s) => out.push(Instr::Select(s.clone())),
            StepDef::Custom { handler } => out.push(Instr::Custom(handler.clone())),
            StepDef::May { then, else_ } => {
                let m = out.len();
                out.push(Instr::May { no: usize::MAX });
                compile_steps(then, out);
                if !else_.is_empty() {
                    let j = out.len();
                    out.push(Instr::Jmp(usize::MAX));
                    out[m] = Instr::May { no: out.len() };
                    compile_steps(else_, out);
                    out[j] = Instr::Jmp(out.len());
                } else {
                    out[m] = Instr::May { no: out.len() };
                }
            }
            StepDef::If { cond, then, else_ } => {
                let j = out.len();
                out.push(Instr::Jf { cond: cond.clone(), to: usize::MAX });
                compile_steps(then, out);
                if !else_.is_empty() {
                    let j2 = out.len();
                    out.push(Instr::Jmp(usize::MAX));
                    out[j] = Instr::Jf { cond: cond.clone(), to: out.len() };
                    compile_steps(else_, out);
                    out[j2] = Instr::Jmp(out.len());
                } else {
                    out[j] = Instr::Jf { cond: cond.clone(), to: out.len() };
                }
            }
            StepDef::Modes { step, options } => {
                let head = out.len();
                let (key, key_i) = key_syms("m", head);
                let starts: Rc<Vec<usize>> = Rc::new(Vec::new());
                out.push(Instr::Modes { step: step.clone(), key, key_i, starts: starts.clone(), next: usize::MAX });
                let next_pc = out.len();
                out.push(Instr::ModesNext { key, key_i, starts: starts.clone(), end: usize::MAX });
                let mut st_vec = Vec::new();
                for opt in options {
                    st_vec.push(out.len());
                    compile_steps(opt, out);
                    out.push(Instr::Jmp(next_pc));
                }
                let end = out.len();
                let starts_rc = Rc::new(st_vec);
                out[head] = Instr::Modes { step: step.clone(), key, key_i, starts: starts_rc.clone(), next: next_pc };
                out[next_pc] = Instr::ModesNext { key, key_i, starts: starts_rc, end };
            }
            StepDef::Each { in_, as_, body } => {
                let init = out.len();
                let (key, key_list) = {
                    let k = format!("$e{}", init);
                    (sym(&k), sym(&format!("{}:list", k)))
                };
                out.push(Instr::EachInit { in_var: in_.clone(), key, key_list });
                let next_pc = out.len();
                out.push(Instr::EachNext { as_: *as_, key, key_list, end: usize::MAX });
                compile_steps(body, out);
                out.push(Instr::Jmp(next_pc));
                let end = out.len();
                out[next_pc] = Instr::EachNext { as_: *as_, key, key_list, end };
            }
            StepDef::Repeat { times, body } => {
                let init = out.len();
                let key = sym(&format!("$r{}", init));
                out.push(Instr::RepeatInit { times: times.clone(), key });
                let next_pc = out.len();
                out.push(Instr::RepeatNext { key, end: usize::MAX });
                compile_steps(body, out);
                out.push(Instr::Jmp(next_pc));
                let end = out.len();
                out[next_pc] = Instr::RepeatNext { key, end };
            }
            StepDef::ForPlayers { body } => {
                out.push(Instr::SetIter(0));
                compile_steps(body, out);
                out.push(Instr::SetIter(1));
                compile_steps(body, out);
            }
        }
    }
}
