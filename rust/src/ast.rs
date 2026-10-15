//! カード能力の AST(src/engine/ast.ts)。展開済みのカード定義(JSON)から型付きの形に読み込む。

use crate::json::Json;
use crate::types::*;
use std::rc::Rc;

pub type R<T> = Result<T, String>;

fn err<T>(m: String) -> R<T> {
    Err(m)
}

#[derive(Clone, Debug)]
pub enum Expr {
    Num(i64),
    Var(String),
    Count(Rc<Selector>),
    CostOf(String),
    Add(Vec<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Min(Vec<Expr>),
    Max(Vec<Expr>),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SelOwner {
    Self_,
    Opponent,
    Any,
    Iter,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SelType {
    Creature,
    Spell,
    Card,
}

#[derive(Clone, Debug)]
pub struct Selector {
    pub zones: Vec<Zone>,
    pub owner: SelOwner,
    pub ty: Option<SelType>,
    pub where_: Option<Cond>,
    pub chooseable: bool,
    pub not_self: bool,
    pub except: Option<String>,
    pub of: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CmpOp {
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
    Ne,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Rel {
    Self_,
    Opponent,
    Any,
}

/// イベントのパターン(cond.ts の matchPattern が読むキーだけを持つ)
#[derive(Clone, Debug)]
pub struct Pattern {
    pub ty: Sym,
    pub self_: bool,
    pub role: Option<Sym>,
    pub via: Option<Sym>,
    pub cause: Option<Sym>,
    pub from: Option<Sym>,
    pub to: Option<Sym>,
    pub kind: Option<Sym>,
    pub ex: Option<bool>,
    pub step: Option<Sym>,
    pub paid: Option<i64>,
    pub free: Option<bool>,
    pub cause_type: Option<Sym>,
    /// abilityTriggered: 能力の持ち主が、原因のイベントのカード自身か
    pub cause_self: bool,
    pub owner: Option<Rel>,
    pub player: Option<Rel>,
    pub controller: Option<Rel>,
    pub winner: Option<Rel>,
    pub attacker_cond: Option<Box<Cond>>,
}

#[derive(Clone, Debug)]
pub struct CostQ {
    pub eq: Option<Expr>,
    pub lt: Option<Expr>,
    pub lte: Option<Expr>,
    pub gt: Option<Expr>,
    pub gte: Option<Expr>,
}

#[derive(Clone, Debug)]
pub struct Range3 {
    pub lte: Option<i32>,
    pub gte: Option<i32>,
    pub eq: Option<i32>,
}

#[derive(Clone, Debug)]
pub enum Cond {
    All(Vec<Cond>),
    Any(Vec<Cond>),
    Not(Box<Cond>),
    True,
    TurnOf(Rel),
    Shields(Range3),
    Cmp { l: Expr, op: CmpOp, r: Expr },
    Count { sel: Rc<Selector>, q: Range3 },
    FiveCivs(Rc<Selector>),
    CivsPresent { sel: Rc<Selector>, civs: Vec<Civ> },
    NonEmpty(String),
    NotInBattle,
    Logged { pattern: Pattern, min: i32 },
    ZoneIs(Zone),
    /// $it が、能力の発生源のEXライフのシールドか
    ExShield,
    Civ(Civ),
    CivsAll(Vec<Civ>),
    Multicolor(bool),
    Cost(CostQ),
    Power { lte: Option<i32>, gte: Option<i32> },
    Type(SelType),
    Evolution(bool),
    Race(String),
    Tapped(bool),
    SameCivAs(String),
}

#[derive(Clone, Debug)]
pub enum SelOrVar {
    Var(String),
    Sel(Rc<Selector>),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Who {
    Controller,
    Opponent,
    Iter,
}

#[derive(Clone, Debug)]
pub struct SlotDef {
    pub id: String,
    pub to: Zone,
    pub count: i32,
    pub label: String,
    pub cause: Option<Sym>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UntilKind {
    EndOfTurn,
    NextTurnStart,
    Source,
}

#[derive(Clone, Debug)]
pub enum Act {
    Draw { n: Expr, who: Who },
    Move { sel: SelOrVar, to: Zone, cause: Sym, pos: Option<bool>, tapped: Option<bool>, as_: Option<Sym> },
    MoveTop { who: Who, n: Expr, to: Zone, cause: Sym, tapped: Option<bool>, as_: Option<Sym> },
    LookTop { who: Who, n: Expr, as_: Sym },
    RevealUntil { who: Who, as_: Sym, rest: Sym, cond: Cond },
    Reveal { items: SelOrVar },
    ShuffleBottom { of: String },
    Shuffle { who: Who },
    Assign { items: String, slots: Vec<SlotDef>, as_: Option<Sym> },
    AddShield { n: i32 },
    Tap { sel: SelOrVar },
    Untap { sel: SelOrVar },
    AddEffect { mods: Vec<EffectMod>, sel: SelOrVar, until: UntilKind },
    Put { sel: SelOrVar, as_: Option<Sym> },
    Summon { sel: SelOrVar, as_: Option<Sym> },
    CastFree { sel: SelOrVar, after: Option<Sym> },
    SkipRestOfTurn,
    CopyTrigger,
    Invade,
    RevolutionChange,
    PlayerEffect { m: PlayerMod, until: UntilKind },
    /// イベントを1つ残す(ファイナル革命の「使った」印)
    Log { ty: Sym },
    SetVar { as_: Sym, value: Val },
}

#[derive(Clone, Debug)]
pub enum PlayerMod {
    CannotCast,
    CannotUseCost(Expr),
}

#[derive(Clone, Debug)]
pub struct SelectStep {
    pub as_: Sym,
    pub who: Who,
    pub from: SelOrVar,
    pub min: Option<Expr>,
    pub max: Option<Expr>,
    pub random: bool,
}

#[derive(Clone, Debug)]
pub struct ModesStep {
    pub pick: i32,
    pub repeat: bool,
    pub all_if: Option<Cond>,
    pub who: Who,
    pub labels: Vec<String>,
}

#[derive(Clone, Debug)]
pub enum StepDef {
    Act(Act),
    Select(SelectStep),
    May { then: Vec<StepDef>, else_: Vec<StepDef> },
    If { cond: Cond, then: Vec<StepDef>, else_: Vec<StepDef> },
    Each { in_: String, as_: Sym, body: Vec<StepDef> },
    Repeat { times: Expr, body: Vec<StepDef> },
    Modes { step: ModesStep, options: Vec<Vec<StepDef>> },
    ForPlayers { body: Vec<StepDef> },
    Custom { handler: String },
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeywordName {
    Blocker,
    Breaker,
    ShieldTrigger,
    GStrike,
    SpeedAttacker,
    MachFighter,
    ExLife,
    JustDiver,
    Sympathy,
    HyperEnergy,
    Yobinion,
    Invasion,
    Slayer,
    RevolutionChange,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Subject {
    Self_,
    Other,
    Any,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TurnSel {
    Own,
    Opponent,
    Any,
}

#[derive(Clone, Debug)]
pub struct TriggerSpec {
    pub on: Vec<Pattern>,
    pub watch: Option<Vec<Zone>>,
    pub subject: Option<Subject>,
    pub turn: Option<TurnSel>,
    pub nth_this_turn: Option<i32>,
    pub limit_per_turn: Option<i32>,
    pub if_: Option<Cond>,
    pub if_at_resolve: Option<Cond>,
}

#[derive(Clone, Debug)]
pub enum StaticMod {
    CostDelta { delta: i32, cond: Cond },
    CannotAttackPlayerWhenEntered,
    CannotCast { cond: Cond },
    PowerAdd { n: i32 },
    /// 自分のクリーチャー(cond に合うもの)すべてにキーワードを与える
    GrantKeyword { keyword: Sym, cond: Cond },
}

#[derive(Clone, Debug)]
pub enum ReplaceApply {
    ChangeDest(Zone),
    CancelTrigger,
    SmaxSacrifice,
}

#[derive(Clone, Debug)]
pub enum Ability {
    Keyword { name: KeywordName, n: Option<i32>, while_: Option<Cond>, steps: Option<Vec<StepDef>>, attacker: Option<Cond>, label: Option<String> },
    Trigger { spec: TriggerSpec, optional: bool, steps: Vec<StepDef>, label: Option<String> },
    Spell { steps: Vec<StepDef> },
    Static { m: StaticMod, while_: Option<Cond> },
    Replace { match_: Pattern, apply: ReplaceApply, optional: bool, while_: Option<Cond>, label: Option<String> },
    Permission { play_cast: bool, from: Zone, after_bottom: bool },
}

// ───────────────────────── パーサ ─────────────────────────

fn s_of<'a>(j: &'a Json, k: &str) -> Option<&'a str> {
    j.get(k).and_then(|x| x.as_str())
}

fn zone_of(s: &str) -> R<Zone> {
    Zone::parse(s).ok_or_else(|| format!("未知のゾーン: {}", s))
}

fn civ_of(s: &str) -> R<Civ> {
    Civ::parse(s).ok_or_else(|| format!("未知の文明: {}", s))
}

fn who_of(j: Option<&Json>) -> Who {
    match j.and_then(|x| x.as_str()) {
        Some("opponent") => Who::Opponent,
        Some("iter") => Who::Iter,
        _ => Who::Controller,
    }
}

fn rel_of(j: &Json) -> Option<Rel> {
    match j.as_str() {
        Some("self") => Some(Rel::Self_),
        Some("opponent") => Some(Rel::Opponent),
        Some("any") => Some(Rel::Any),
        _ => None,
    }
}

pub fn parse_expr(j: &Json) -> R<Expr> {
    if let Json::Num(n) = j {
        return Ok(Expr::Num(*n as i64));
    }
    if let Some(v) = j.get("var") {
        return Ok(Expr::Var(v.as_str().ok_or("var")?.to_string()));
    }
    if let Some(v) = j.get("count") {
        return Ok(Expr::Count(Rc::new(parse_selector(v)?)));
    }
    if let Some(v) = j.get("costOf") {
        return Ok(Expr::CostOf(v.as_str().ok_or("costOf")?.to_string()));
    }
    if let Some(v) = j.get("add") {
        return Ok(Expr::Add(v.as_arr().ok_or("add")?.iter().map(parse_expr).collect::<R<_>>()?));
    }
    if let Some(v) = j.get("sub") {
        let a = v.as_arr().ok_or("sub")?;
        return Ok(Expr::Sub(Box::new(parse_expr(&a[0])?), Box::new(parse_expr(&a[1])?)));
    }
    if let Some(v) = j.get("min") {
        return Ok(Expr::Min(v.as_arr().ok_or("min")?.iter().map(parse_expr).collect::<R<_>>()?));
    }
    if let Some(v) = j.get("max") {
        return Ok(Expr::Max(v.as_arr().ok_or("max")?.iter().map(parse_expr).collect::<R<_>>()?));
    }
    err(format!("未知の式: {}", j))
}

pub fn parse_selector(j: &Json) -> R<Selector> {
    let zj = j.get("zone").ok_or_else(|| format!("セレクタに zone がありません: {}", j))?;
    let zones = match zj {
        Json::Str(s) => vec![zone_of(s)?],
        Json::Arr(a) => a.iter().map(|x| zone_of(x.as_str().unwrap_or(""))).collect::<R<Vec<_>>>()?,
        _ => return err("zone が不正".into()),
    };
    let owner = match s_of(j, "owner") {
        None | Some("self") => SelOwner::Self_,
        Some("opponent") => SelOwner::Opponent,
        Some("any") => SelOwner::Any,
        Some("iter") => SelOwner::Iter,
        Some(o) => return err(format!("未知の owner: {}", o)),
    };
    let ty = match s_of(j, "type") {
        None => None,
        Some("creature") => Some(SelType::Creature),
        Some("spell") => Some(SelType::Spell),
        Some("card") => Some(SelType::Card),
        Some(t) => return err(format!("未知の type: {}", t)),
    };
    let where_ = match j.get("where") {
        Some(w) => Some(parse_cond(w)?),
        None => None,
    };
    Ok(Selector {
        zones,
        owner,
        ty,
        where_,
        chooseable: j.get("chooseable").and_then(|x| x.as_bool()).unwrap_or(false),
        not_self: j.get("notSelf").and_then(|x| x.as_bool()).unwrap_or(false),
        except: s_of(j, "except").map(|s| s.to_string()),
        of: s_of(j, "of").map(|s| s.to_string()),
    })
}

fn range3(j: &Json) -> Range3 {
    Range3 {
        lte: j.get("lte").and_then(|x| x.as_i64()).map(|x| x as i32),
        gte: j.get("gte").and_then(|x| x.as_i64()).map(|x| x as i32),
        eq: j.get("eq").and_then(|x| x.as_i64()).map(|x| x as i32),
    }
}

pub fn parse_pattern(j: &Json) -> R<Pattern> {
    let ty = s_of(j, "type").ok_or_else(|| format!("パターンに type がありません: {}", j))?;
    let symf = |k: &str| s_of(j, k).map(sym);
    let boolf = |k: &str| j.get(k).and_then(|x| x.as_bool());
    Ok(Pattern {
        ty: sym(ty),
        self_: j.get("self").and_then(|x| x.as_bool()).unwrap_or(false),
        role: symf("role"),
        via: symf("via"),
        cause: symf("cause"),
        from: symf("from"),
        to: symf("to"),
        kind: symf("kind"),
        ex: boolf("ex"),
        step: symf("step"),
        paid: j.get("paid").and_then(|x| x.as_i64()),
        free: boolf("free"),
        cause_type: symf("causeType"),
        cause_self: boolf("causeSelf").unwrap_or(false),
        owner: j.get("owner").and_then(rel_of),
        player: j.get("player").and_then(rel_of),
        controller: j.get("controller").and_then(rel_of),
        winner: j.get("winner").and_then(rel_of),
        attacker_cond: match j.get("attackerCond") {
            Some(c) => Some(Box::new(parse_cond(c)?)),
            None => None,
        },
    })
}

pub fn parse_cond(j: &Json) -> R<Cond> {
    let o = j;
    if let Some(v) = o.get("all") {
        return Ok(Cond::All(v.as_arr().ok_or("all")?.iter().map(parse_cond).collect::<R<_>>()?));
    }
    if let Some(v) = o.get("any") {
        return Ok(Cond::Any(v.as_arr().ok_or("any")?.iter().map(parse_cond).collect::<R<_>>()?));
    }
    if let Some(v) = o.get("not") {
        return Ok(Cond::Not(Box::new(parse_cond(v)?)));
    }
    if o.get("true").is_some() {
        return Ok(Cond::True);
    }
    if let Some(v) = o.get("turnOf") {
        return Ok(Cond::TurnOf(if v.as_str() == Some("self") { Rel::Self_ } else { Rel::Opponent }));
    }
    if let Some(v) = o.get("shields") {
        return Ok(Cond::Shields(range3(v)));
    }
    if let Some(v) = o.get("cmp") {
        let op = match s_of(v, "op") {
            Some("<") => CmpOp::Lt,
            Some("<=") => CmpOp::Le,
            Some(">") => CmpOp::Gt,
            Some(">=") => CmpOp::Ge,
            Some("==") => CmpOp::Eq,
            Some("!=") => CmpOp::Ne,
            x => return err(format!("未知の比較: {:?}", x)),
        };
        return Ok(Cond::Cmp { l: parse_expr(v.get("l").ok_or("cmp.l")?)?, op, r: parse_expr(v.get("r").ok_or("cmp.r")?)? });
    }
    if let Some(v) = o.get("count") {
        return Ok(Cond::Count { sel: Rc::new(parse_selector(v)?), q: range3(o) });
    }
    if let Some(v) = o.get("fiveCivs") {
        return Ok(Cond::FiveCivs(Rc::new(parse_selector(v)?)));
    }
    if let Some(v) = o.get("civsPresent") {
        let sel = parse_selector(v.get("sel").ok_or("civsPresent.sel")?)?;
        let civs = v.get("civs").and_then(|c| c.as_arr()).ok_or("civsPresent.civs")?.iter().map(|c| civ_of(c.as_str().unwrap_or(""))).collect::<R<Vec<_>>>()?;
        return Ok(Cond::CivsPresent { sel: Rc::new(sel), civs });
    }
    if let Some(v) = o.get("nonEmpty") {
        return Ok(Cond::NonEmpty(v.as_str().ok_or("nonEmpty")?.to_string()));
    }
    if o.get("notInBattle").is_some() {
        return Ok(Cond::NotInBattle);
    }
    if let Some(v) = o.get("logged") {
        let pattern = parse_pattern(v.get("pattern").ok_or("logged.pattern")?)?;
        let min = v.get("min").and_then(|x| x.as_i64()).unwrap_or(1) as i32;
        return Ok(Cond::Logged { pattern, min });
    }
    if o.get("exShield").is_some() {
        return Ok(Cond::ExShield);
    }
    if let Some(v) = o.get("zoneIs") {
        return Ok(Cond::ZoneIs(zone_of(v.as_str().unwrap_or(""))?));
    }
    if let Some(v) = o.get("civ") {
        return Ok(Cond::Civ(civ_of(v.as_str().unwrap_or(""))?));
    }
    if let Some(v) = o.get("civsAll") {
        return Ok(Cond::CivsAll(v.as_arr().ok_or("civsAll")?.iter().map(|c| civ_of(c.as_str().unwrap_or(""))).collect::<R<_>>()?));
    }
    if let Some(v) = o.get("multicolor") {
        return Ok(Cond::Multicolor(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("cost") {
        let e = |k: &str| -> R<Option<Expr>> {
            match v.get(k) {
                Some(x) => Ok(Some(parse_expr(x)?)),
                None => Ok(None),
            }
        };
        return Ok(Cond::Cost(CostQ { eq: e("eq")?, lt: e("lt")?, lte: e("lte")?, gt: e("gt")?, gte: e("gte")? }));
    }
    if let Some(v) = o.get("power") {
        return Ok(Cond::Power {
            lte: v.get("lte").and_then(|x| x.as_i64()).map(|x| x as i32),
            gte: v.get("gte").and_then(|x| x.as_i64()).map(|x| x as i32),
        });
    }
    if let Some(v) = o.get("type") {
        return Ok(Cond::Type(if v.as_str() == Some("creature") { SelType::Creature } else { SelType::Spell }));
    }
    if let Some(v) = o.get("evolution") {
        return Ok(Cond::Evolution(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("race") {
        return Ok(Cond::Race(v.as_str().ok_or("race")?.to_string()));
    }
    if let Some(v) = o.get("tapped") {
        return Ok(Cond::Tapped(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("sameCivAs") {
        return Ok(Cond::SameCivAs(v.as_str().ok_or("sameCivAs")?.to_string()));
    }
    err(format!("未知の条件: {}", j))
}

fn sel_or_var(j: &Json) -> R<SelOrVar> {
    match j {
        Json::Str(s) => Ok(SelOrVar::Var(s.clone())),
        Json::Obj(_) if j.get("zone").is_some() => Ok(SelOrVar::Sel(Rc::new(parse_selector(j)?))),
        Json::Obj(_) if j.get("var").is_some() => Ok(SelOrVar::Var(j.get("var").unwrap().as_str().unwrap_or("").to_string())),
        _ => err(format!("セレクタか変数が必要です: {}", j)),
    }
}

fn parse_mod(j: &Json) -> R<EffectMod> {
    match s_of(j, "kind") {
        Some("cannotAttack") => Ok(EffectMod::CannotAttack),
        Some("powerAdd") => Ok(EffectMod::PowerAdd(j.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32)),
        Some("grant") => Ok(EffectMod::Grant(sym(s_of(j, "keyword").ok_or("grant.keyword")?))),
        Some("cannotBeChosen") => Ok(EffectMod::CannotBeChosen),
        Some("cannotBeAttacked") => Ok(EffectMod::CannotBeAttacked),
        k => err(format!("未知の効果: {:?}", k)),
    }
}

fn opt_sym(j: &Json, k: &str) -> Option<Sym> {
    s_of(j, k).map(sym)
}

fn parse_act(j: &Json) -> R<Act> {
    let keys = j.keys();
    if keys.len() != 1 {
        return err(format!("act は1キー: {}", j));
    }
    let key = keys[0];
    let a = j.get(key).unwrap();
    let cause_of = |a: &Json| opt_sym(a, "cause").unwrap_or(s::EFFECT);
    Ok(match key {
        "draw" => match a {
            Json::Num(n) => Act::Draw { n: Expr::Num(*n as i64), who: Who::Controller },
            _ => Act::Draw { n: parse_expr(a.get("n").ok_or("draw.n")?)?, who: who_of(a.get("who")) },
        },
        "move" => Act::Move {
            sel: sel_or_var(a.get("sel").ok_or("move.sel")?)?,
            to: zone_of(s_of(a, "to").ok_or("move.to")?)?,
            cause: cause_of(a),
            pos: a.get("pos").and_then(|x| x.as_str()).map(|p| p == "top"),
            tapped: a.get("tapped").and_then(|x| x.as_bool()),
            as_: opt_sym(a, "as"),
        },
        "moveTop" => Act::MoveTop {
            who: who_of(a.get("who")),
            n: parse_expr(a.get("n").ok_or("moveTop.n")?)?,
            to: zone_of(s_of(a, "to").ok_or("moveTop.to")?)?,
            cause: cause_of(a),
            tapped: a.get("tapped").and_then(|x| x.as_bool()),
            as_: opt_sym(a, "as"),
        },
        "lookTop" => Act::LookTop { who: who_of(a.get("who")), n: parse_expr(a.get("n").ok_or("lookTop.n")?)?, as_: opt_sym(a, "as").ok_or("lookTop.as")? },
        "revealUntil" => Act::RevealUntil {
            who: who_of(a.get("who")),
            as_: opt_sym(a, "as").ok_or("revealUntil.as")?,
            rest: opt_sym(a, "rest").ok_or("revealUntil.rest")?,
            cond: parse_cond(a.get("cond").ok_or("revealUntil.cond")?)?,
        },
        "reveal" => Act::Reveal { items: sel_or_var(a.get("items").ok_or("reveal.items")?)? },
        "shuffleBottom" => Act::ShuffleBottom { of: s_of(a, "of").ok_or("shuffleBottom.of")?.to_string() },
        "shuffle" => Act::Shuffle { who: who_of(a.get("who")) },
        "assign" => {
            let slots = a
                .get("slots")
                .and_then(|x| x.as_arr())
                .ok_or("assign.slots")?
                .iter()
                .map(|x| {
                    let id = s_of(x, "id").ok_or("slot.id")?.to_string();
                    Ok(SlotDef {
                        label: s_of(x, "label").map(|s| s.to_string()).unwrap_or_else(|| id.clone()),
                        id,
                        to: zone_of(s_of(x, "to").ok_or("slot.to")?)?,
                        count: x.get("count").and_then(|c| c.as_i64()).unwrap_or(1) as i32,
                        cause: opt_sym(x, "cause"),
                    })
                })
                .collect::<R<Vec<_>>>()?;
            Act::Assign { items: s_of(a, "items").ok_or("assign.items")?.to_string(), slots, as_: opt_sym(a, "as") }
        }
        "addShield" => Act::AddShield { n: a.get("n").and_then(|x| x.as_i64()).unwrap_or(1) as i32 },
        "tap" => Act::Tap { sel: sel_or_var(a.get("sel").ok_or("tap.sel")?)? },
        "untap" => Act::Untap { sel: sel_or_var(a.get("sel").ok_or("untap.sel")?)? },
        "addEffect" => {
            let mods = match a.get("mods") {
                Some(m) => m.as_arr().ok_or("mods")?.iter().map(parse_mod).collect::<R<Vec<_>>>()?,
                None => vec![parse_mod(a.get("mod").ok_or("addEffect.mod")?)?],
            };
            let until = match s_of(a, "until") {
                Some("endOfTurn") => UntilKind::EndOfTurn,
                Some("nextTurnStart") => UntilKind::NextTurnStart,
                Some("source") => UntilKind::Source,
                u => return err(format!("未知の期限: {:?}", u)),
            };
            Act::AddEffect { mods, sel: sel_or_var(a.get("sel").ok_or("addEffect.sel")?)?, until }
        }
        "put" => Act::Put { sel: sel_or_var(a.get("sel").ok_or("put.sel")?)?, as_: opt_sym(a, "as") },
        "summon" => Act::Summon { sel: sel_or_var(a.get("sel").ok_or("summon.sel")?)?, as_: opt_sym(a, "as") },
        "castFree" => Act::CastFree { sel: sel_or_var(a.get("sel").ok_or("castFree.sel")?)?, after: opt_sym(a, "after") },
        "skipRestOfTurn" => Act::SkipRestOfTurn,
        "copyTrigger" => Act::CopyTrigger,
        "invade" => Act::Invade,
        "revolutionChange" => Act::RevolutionChange,
        "log" => Act::Log { ty: sym(a.as_str().ok_or("log")?) },
        "playerEffect" => {
            let m = a.get("mod").ok_or("playerEffect.mod")?;
            let pm = match s_of(m, "kind") {
                Some("cannotCast") => PlayerMod::CannotCast,
                Some("cannotUseCost") => PlayerMod::CannotUseCost(parse_expr(m.get("n").ok_or("cannotUseCost.n")?)?),
                k => return err(format!("未知のプレイヤー効果: {:?}", k)),
            };
            let until = match s_of(a, "until") {
                Some("endOfTurn") => UntilKind::EndOfTurn,
                Some("nextTurnStart") => UntilKind::NextTurnStart,
                Some("source") => UntilKind::Source,
                u => return err(format!("未知の期限: {:?}", u)),
            };
            Act::PlayerEffect { m: pm, until }
        }
        "setVar" => Act::SetVar { as_: opt_sym(a, "as").ok_or("setVar.as")?, value: Val::from_json(a.get("value").unwrap_or(&Json::Null)) },
        k => return err(format!("未対応の原始操作: {}", k)),
    })
}

pub fn parse_steps(j: &Json) -> R<Vec<StepDef>> {
    j.as_arr().ok_or_else(|| format!("steps が配列ではありません: {}", j))?.iter().map(parse_step).collect()
}

fn opt_steps(j: Option<&Json>) -> R<Vec<StepDef>> {
    match j {
        Some(x) => parse_steps(x),
        None => Ok(vec![]),
    }
}

fn parse_step(j: &Json) -> R<StepDef> {
    let op = s_of(j, "op").ok_or_else(|| format!("step に op がありません: {}", j))?;
    Ok(match op {
        "act" => StepDef::Act(parse_act(j.get("act").ok_or("act")?)?),
        "select" => StepDef::Select(SelectStep {
            as_: opt_sym(j, "as").ok_or("select.as")?,
            who: who_of(j.get("who")),
            from: sel_or_var(j.get("from").ok_or("select.from")?)?,
            min: match j.get("min") {
                Some(x) => Some(parse_expr(x)?),
                None => None,
            },
            max: match j.get("max") {
                Some(x) => Some(parse_expr(x)?),
                None => None,
            },
            random: j.get("random").and_then(|x| x.as_bool()).unwrap_or(false),
        }),
        "may" => StepDef::May { then: opt_steps(j.get("then"))?, else_: opt_steps(j.get("else"))? },
        "if" => StepDef::If { cond: parse_cond(j.get("cond").ok_or("if.cond")?)?, then: opt_steps(j.get("then"))?, else_: opt_steps(j.get("else"))? },
        "each" => StepDef::Each { in_: s_of(j, "in").ok_or("each.in")?.to_string(), as_: opt_sym(j, "as").ok_or("each.as")?, body: opt_steps(j.get("body"))? },
        "repeat" => StepDef::Repeat { times: parse_expr(j.get("times").ok_or("repeat.times")?)?, body: opt_steps(j.get("body"))? },
        "modes" => {
            let opts = j.get("options").and_then(|x| x.as_arr()).ok_or("modes.options")?;
            let mut labels = Vec::new();
            let mut options = Vec::new();
            for o in opts {
                labels.push(s_of(o, "label").unwrap_or("").to_string());
                options.push(opt_steps(o.get("steps"))?);
            }
            StepDef::Modes {
                step: ModesStep {
                    pick: j.get("pick").and_then(|x| x.as_i64()).unwrap_or(1) as i32,
                    repeat: j.get("repeat").and_then(|x| x.as_bool()).unwrap_or(false),
                    all_if: match j.get("allIf") {
                        Some(c) => Some(parse_cond(c)?),
                        None => None,
                    },
                    who: if s_of(j, "who") == Some("opponent") { Who::Opponent } else { Who::Controller },
                    labels,
                },
                options,
            }
        }
        "forPlayers" => StepDef::ForPlayers { body: opt_steps(j.get("body"))? },
        "custom" => StepDef::Custom { handler: s_of(j, "handler").unwrap_or("").to_string() },
        o => return err(format!("未知のステップ: {}", o)),
    })
}

fn keyword_of(s: &str) -> R<KeywordName> {
    Ok(match s {
        "blocker" => KeywordName::Blocker,
        "breaker" => KeywordName::Breaker,
        "shieldTrigger" => KeywordName::ShieldTrigger,
        "gStrike" => KeywordName::GStrike,
        "speedAttacker" => KeywordName::SpeedAttacker,
        "machFighter" => KeywordName::MachFighter,
        "exLife" => KeywordName::ExLife,
        "justDiver" => KeywordName::JustDiver,
        "sympathy" => KeywordName::Sympathy,
        "hyperEnergy" => KeywordName::HyperEnergy,
        "yobinion" => KeywordName::Yobinion,
        "invasion" => KeywordName::Invasion,
        "slayer" => KeywordName::Slayer,
        "revolutionChange" => KeywordName::RevolutionChange,
        k => return err(format!("未知のキーワード: {}", k)),
    })
}

fn opt_cond(j: &Json, k: &str) -> R<Option<Cond>> {
    match j.get(k) {
        Some(c) => Ok(Some(parse_cond(c)?)),
        None => Ok(None),
    }
}

pub fn parse_ability(j: &Json) -> R<Ability> {
    let kind = s_of(j, "kind").ok_or("ability.kind")?;
    Ok(match kind {
        "keyword" => Ability::Keyword {
            name: keyword_of(s_of(j, "name").ok_or("keyword.name")?)?,
            n: j.get("n").and_then(|x| x.as_i64()).map(|x| x as i32),
            while_: opt_cond(j, "while")?,
            steps: match j.get("steps") {
                Some(s) => Some(parse_steps(s)?),
                None => None,
            },
            attacker: opt_cond(j, "attacker")?,
            label: s_of(j, "label").map(|s| s.to_string()),
        },
        "trigger" => {
            let spec = j.get("spec").ok_or("trigger.spec")?;
            let on = match spec.get("on").ok_or("spec.on")? {
                Json::Arr(a) => a.iter().map(parse_pattern).collect::<R<Vec<_>>>()?,
                o => vec![parse_pattern(o)?],
            };
            let watch = match spec.get("watch") {
                Some(w) => Some(w.as_arr().ok_or("watch")?.iter().map(|z| zone_of(z.as_str().unwrap_or(""))).collect::<R<Vec<_>>>()?),
                None => None,
            };
            let subject = match s_of(spec, "subject") {
                Some("self") => Some(Subject::Self_),
                Some("other") => Some(Subject::Other),
                Some("any") => Some(Subject::Any),
                _ => None,
            };
            let turn = match s_of(spec, "turn") {
                Some("own") => Some(TurnSel::Own),
                Some("opponent") => Some(TurnSel::Opponent),
                Some("any") => Some(TurnSel::Any),
                _ => None,
            };
            Ability::Trigger {
                spec: TriggerSpec {
                    on,
                    watch,
                    subject,
                    turn,
                    nth_this_turn: spec.get("nthThisTurn").and_then(|x| x.as_i64()).map(|x| x as i32),
                    limit_per_turn: spec.get("limit").and_then(|l| l.get("perTurn")).and_then(|x| x.as_i64()).map(|x| x as i32),
                    if_: opt_cond(spec, "if")?,
                    if_at_resolve: opt_cond(spec, "ifAtResolve")?,
                },
                optional: j.get("optional").and_then(|x| x.as_bool()).unwrap_or(false),
                steps: opt_steps(j.get("steps"))?,
                label: s_of(j, "label").map(|s| s.to_string()),
            }
        }
        "spell" => Ability::Spell { steps: opt_steps(j.get("steps"))? },
        "static" => {
            let m = j.get("mod").ok_or("static.mod")?;
            let sm = match s_of(m, "type") {
                Some("costDelta") => StaticMod::CostDelta { delta: m.get("delta").and_then(|x| x.as_i64()).unwrap_or(0) as i32, cond: parse_cond(m.get("cond").ok_or("costDelta.cond")?)? },
                Some("cannotAttackPlayerWhenEntered") => StaticMod::CannotAttackPlayerWhenEntered,
                Some("cannotCast") => StaticMod::CannotCast { cond: parse_cond(m.get("cond").ok_or("cannotCast.cond")?)? },
                Some("powerAdd") => StaticMod::PowerAdd { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("grantKeyword") => StaticMod::GrantKeyword {
                    keyword: sym(s_of(m, "keyword").ok_or("grantKeyword.keyword")?),
                    cond: parse_cond(m.get("cond").ok_or("grantKeyword.cond")?)?,
                },
                t => return err(format!("未知の常在効果: {:?}", t)),
            };
            Ability::Static { m: sm, while_: opt_cond(j, "while")? }
        }
        "replace" => {
            let ap = j.get("apply").ok_or("replace.apply")?;
            let apply = match s_of(ap, "type") {
                Some("changeDest") => ReplaceApply::ChangeDest(zone_of(s_of(ap, "to").ok_or("changeDest.to")?)?),
                Some("cancelTrigger") => ReplaceApply::CancelTrigger,
                Some("smaxSacrifice") => ReplaceApply::SmaxSacrifice,
                t => return err(format!("未知の置換: {:?}", t)),
            };
            Ability::Replace {
                match_: parse_pattern(j.get("match").ok_or("replace.match")?)?,
                apply,
                optional: j.get("optional").and_then(|x| x.as_bool()).unwrap_or(false),
                while_: opt_cond(j, "while")?,
                label: s_of(j, "label").map(|s| s.to_string()),
            }
        }
        "permission" => Ability::Permission {
            play_cast: s_of(j, "play") == Some("cast"),
            from: zone_of(s_of(j, "from").ok_or("permission.from")?)?,
            after_bottom: s_of(j, "after") == Some("deckBottom"),
        },
        k => return err(format!("未知の能力: {}", k)),
    })
}
