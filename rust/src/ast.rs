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
    /// 誘発したイベントの、配列の項目(cards など)の数
    EvLen(Sym),
    /// 変数のカードの枚数
    Len(String),
    /// 変数のカードがいるバトルゾーンの山の、下に重なっているカードの枚数
    Under(String),
    /// セレクタに合うカードの、コストの種類の数
    Distinct(Rc<Selector>),
    Mul(Vec<Expr>),
    /// 変数のカードの、いまのパワー
    PowerOf(String),
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
    /// 呪文以外のバトルゾーンのカード
    Element,
    Tamaseed,
    Field,
    Crossgear,
    Castle,
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
    /// 表向きのシールドに置かれたか(G城)
    pub up: Option<bool>,
    pub cause_type: Option<Sym>,
    /// abilityTriggered: 能力の持ち主が、原因のイベントのカード自身か
    pub cause_self: bool,
    pub owner: Option<Rel>,
    pub player: Option<Rel>,
    pub controller: Option<Rel>,
    pub winner: Option<Rel>,
    pub attacker_cond: Option<Box<Cond>>,
    /// beforeBreak など: 攻撃しているのが、この能力の発生源自身
    pub self_attacker: bool,
    pub not_via: Option<Sym>,
    pub target_kind: Option<Sym>,
    /// 攻撃先が、この能力の発生源自身(クリーチャー)
    pub target_self: bool,
    pub broke: Option<bool>,
    /// クロスギアをクロスしているクリーチャーが攻撃する時
    pub host_attacker: bool,
    /// イベントのカード(出た・唱えた・離れたカードなど)が満たす条件
    pub cond: Option<Box<Cond>>,
    /// 置換の対象: そのターンの持ち主(own / opponent)
    pub turn: Option<TurnSel>,
    pub not_from: Option<Sym>,
    pub not_to: Option<Sym>,
    pub by_opponent: bool,
    pub reason: Option<Sym>,
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
    Shields { q: Range3, opponent: bool },
    Cmp { l: Expr, op: CmpOp, r: Expr },
    Count { sel: Rc<Selector>, q: Range3 },
    FiveCivs(Rc<Selector>),
    CivsPresent { sel: Rc<Selector>, civs: Vec<Civ> },
    NonEmpty(String),
    NotInBattle,
    Logged { pattern: Pattern, min: i32, since: Option<Sym> },
    ZoneIs(Zone),
    /// $it が、能力の発生源のEXライフのシールドか
    ExShield,
    Civ(Civ),
    CivsAll(Vec<Civ>),
    Multicolor(bool),
    Cost(CostQ),
    Power(PowerQ),
    /// $it のパワーが、能力の発生源のパワーより小さい
    PowerLtSelf,
    Type(SelType),
    Evolution(bool),
    Race(String),
    Tapped(bool),
    SameCivAs(String),
    /// 変数のカード(いまのゾーンの特性で見る)のどれかが where を満たす
    Some { var: String, where_: Box<Cond> },
    IsSelf,
    StUsed,
    FaceUp,
    Hyper,
    Crossed(bool),
    HostIs(Box<Cond>),
    HasGear,
    SelfTapped(bool),
    OwnedBy(Rel),
    BaseFor(String),
    Ultimate(bool),
    Twin(bool),
    DistinctCosts(String),
    HasKw(Sym),
    AltUsed(String),
    NameHas(String),
    HasCip,
    EventIs(Vec<(Sym, Val)>),
    AllSame { var: String, where_: Option<Box<Cond>> },
    OnBase(Box<Cond>),
    PowerRank { max: bool, of: Rc<Selector> },
    Unused(String),
}

#[derive(Clone, Debug)]
pub struct PowerQ {
    pub lte: Option<Expr>,
    pub gte: Option<Expr>,
    pub lt: Option<Expr>,
    pub gt: Option<Expr>,
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
    /// 次の、相手のターンの終わりまで
    NextOpponentTurnEnd,
    /// 次の、相手のターンの終わりまで(いまが自分のターンなら次のターン、相手のターン中ならその次の相手のターン)
    OppTurnEnd,
}

#[derive(Clone, Debug)]
pub enum Act {
    Draw { n: Expr, who: Who },
    Move { sel: SelOrVar, to: Zone, cause: Sym, pos: Option<bool>, tapped: Option<bool>, as_: Option<Sym>, no_replace: bool },
    MoveTop { who: Who, n: Expr, to: Zone, cause: Sym, tapped: Option<bool>, as_: Option<Sym> },
    LookTop { who: Who, n: Expr, as_: Sym },
    RevealUntil { who: Who, as_: Sym, rest: Sym, cond: Cond },
    Reveal { items: SelOrVar },
    ShuffleBottom { of: String },
    Shuffle { who: Who },
    Assign { items: String, slots: Vec<SlotDef>, as_: Option<Sym> },
    AddShield { n: i32, who: Who, as_: Option<Sym> },
    Tap { sel: SelOrVar },
    Untap { sel: SelOrVar },
    AddEffect { mods: Vec<ModDef>, sel: SelOrVar, until: UntilKind },
    /// onto: 進化クリーチャーを出す時の、進化元の変数。no_triggers: 出ることによって起こる効果(「出た時」の能力)を無視する
    Put { sel: SelOrVar, as_: Option<Sym>, onto: Option<String>, no_triggers: bool },
    Summon { sel: SelOrVar, as_: Option<Sym>, onto: Option<String>, no_triggers: bool },
    CastFree { sel: SelOrVar, after: Option<Sym> },
    SkipRestOfTurn,
    CopyTrigger,
    Invade,
    RevolutionChange,
    PlayerEffect { m: PlayerMod, until: UntilKind },
    /// イベントを1つ残す(ファイナル革命の「使った」印)
    Log { ty: Sym },
    /// 効果によるバトル(a と b は変数の参照)
    Battle { a: String, b: String },
    /// 値が式(オブジェクト)なら、その場で評価した数を入れる
    SetVar { as_: Sym, value: Val, expr: Option<Expr> },
    MoveBottom { who: Who, n: Expr, to: Zone, cause: Sym, tapped: Option<bool>, as_: Option<Sym> },
    ShuffleIn { sel: SelOrVar, as_: Option<Sym> },
    Bottom { of: String, except: Option<String> },
    Rush { sel: SelOrVar, if_attacked: bool },
    UseCip { sel: SelOrVar },
    GraveToBottom { who: Who },
    Play { sel: SelOrVar, alt: Option<String> },
    Win,
    Cross { gear: SelOrVar, to: SelOrVar },
    NinjaChange { sel: SelOrVar },
    GrantShieldTrigger { sel: SelOrVar },
    BreakOpp { n: i32 },
    AllowSummon { sel: SelOrVar },
    DestroyTop { sel: SelOrVar },
    DropUnder { sel: SelOrVar, n: Option<i32>, deck: bool },
    SummonOnto { sel: SelOrVar, under: String },
    ExtraTurn,
    MarkUsed { key: String },
    PutUnder { sel: SelOrVar, onto: SelOrVar },
    TapLock { sel: SelOrVar },
    BreakShields { n: Option<i32> },
    Judge { as_: Option<Sym> },
    StackShield { sel: SelOrVar, onto: SelOrVar },
    CastSide { sel: SelOrVar },
    Seal { sel: SelOrVar },
    Stab { sel: SelOrVar, depth: i32 },
}

#[derive(Clone, Debug)]
pub enum PlayerMod {
    CannotCast(Option<Expr>),
    CannotUseCost(Expr),
    CannotSummon(Expr),
    CannotCastLte(Expr),
    IgnoreCost(Expr),
    IgnoreAll,
    StartShield,
    Owe { civ: Civ, n: i32 },
    OncePerTurnActs,
    NextSummon { delta: Expr, sa: bool },
    CannotAttackAny,
    CannotLose,
    CannotActCost(Expr),
}

/// addEffect の継続効果(n が式のものは、その場で評価する)
#[derive(Clone, Debug)]
pub enum ModDef {
    Fixed(EffectMod),
    PowerAdd(Expr),
    Breaker(Expr),
}

#[derive(Clone, Debug)]
pub struct SelectStep {
    pub as_: Sym,
    pub who: Who,
    pub from: SelOrVar,
    pub min: Option<Expr>,
    pub max: Option<Expr>,
    pub random: bool,
    /// 変数に、選んだものを追記する(両者が選んでから一括で処理する時に使う)
    pub append: bool,
    /// 選んだカードの表記コストの合計がこの値以下になるように、好きな数を選ぶ
    pub sum_lte: Option<Expr>,
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
    PoweredBreaker,
    SBack,
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
    /// 自身がバトルゾーンを離れた時にも、その出来事で誘発する(離れる直前の状態を見る)
    pub look_back: bool,
    /// 同じ種類・持ち主(・理由)のイベントの、そのターンの n 回目以降
    pub nth_min: Option<i32>,
    pub limit_per_turn: Option<i32>,
    pub if_: Option<Cond>,
    pub if_at_resolve: Option<Cond>,
}

#[derive(Clone, Debug)]
pub enum StaticMod {
    CostDelta { delta: Expr, cond: Cond, once_per_turn: bool, floor: Option<i32> },
    PowerAttacker { n: i32 },
    /// バトル中だけ、パワーを n 増やす(王道の革命 ドギラゴンの革命0)
    PowerAddInBattle { n: i32 },
    BurnShields,
    FirstBattleWins,
    EnterTappedFirst,
    UntapLimit { n: i32 },
    AllowPlayFrom { from: Zone, cond: Option<Cond>, once_per_turn: bool, rush: bool },
    CannotBeChosen,
    MustBeChosen,
    ProtectFromSpells,
    IgnoreCastBan { cond: Cond },
    GraveCastToBottom,
    NoDeckOutLoss,
    /// 自分のターン中、自分の山札の上から1枚をいつでも見てもよい(情報だけ。探索には影響しない)
    PeekDeckTop,
    EnterTapped,
    PowerAddExpr { expr: Expr },
    Stab5sd,
    DeckLock,
    NoOppShieldTrigger,
    AttackMeFirst,
    OneSpellPerTurn,
    CannotAttack,
    CannotAttackPlayer,
    /// 出たターンに相手プレイヤーを攻撃できる(クリーチャーは攻撃できない。ヘルトッQ)
    AttackPlayerOnEntry,
    CannotPlay { cond: Cond },
    BattleProxy { cond: Cond },
    Guardman,
    CannotSummonAll { cond: Cond },
    /// このクロスギアは、コストを支払わずに、cond に合う自分のクリーチャーにクロスしてもよい
    FreeCrossTo { cond: Cond },
    ProtectPlayerFromWeaker,
    NoGStrike,
    OppManaTapped,
    Flying,
    CannotBreak,
    TapAsMana,
    SpellShieldTrigger,
    ManaAllCivs,
    CannotLeaveOwn { cond: Cond, except_destroy: bool },
    NoAttackOnEntry,
    HostPowerAdd { n: i32 },
    PowerAddOthers { n: i32, cond: Cond },
    CannotAttackPlayerWhenEntered,
    CannotCast { cond: Cond },
    PowerAdd { n: i32 },
    /// バトルする時、パワーは無限として扱う
    InfinitePowerInBattle,
    /// 相手の、cond に合うクリーチャーは、タップして出る
    EntersTapped { cond: Cond },
    /// シールドゾーンに表向きである間(G城)、相手のクリーチャーが召喚以外の方法で出る時、かわりにマナゾーンに置く
    NonSummonEntryToMana,
    /// 自分のクリーチャー(cond に合うもの)すべてにキーワードを与える
    GrantKeyword { keyword: Sym, cond: Cond },
}

#[derive(Clone, Debug)]
pub enum ReplaceApply {
    /// 出る時の置換: かわりに、出ない(いまのゾーンに残る)
    Stay,
    ChangeDest { to: Zone, then: Option<Vec<StepDef>> },
    CancelTrigger,
    SmaxSacrifice,
    /// かわりに、この手順を行う
    Steps(Vec<StepDef>),
}

#[derive(Clone, Debug)]
pub struct AltCostSpec {
    pub from: Option<Vec<Zone>>,
    pub tap_creatures: Option<i32>,
    pub pay: Option<i32>,
    pub discard: Option<(i32, Option<Cond>)>,
    pub reduce: Option<i32>,
    pub end_bottom_draw: bool,
    pub to_hyper: bool,
    pub grave_evolve: bool,
    pub fushigi: Option<(i32, i32)>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PlayKind {
    Summon,
    Cast,
    Put,
}

#[derive(Clone, Debug)]
pub enum Ability {
    Keyword { name: KeywordName, n: Option<i32>, while_: Option<Cond>, steps: Option<Vec<StepDef>>, attacker: Option<Cond>, label: Option<String> },
    Trigger { spec: TriggerSpec, optional: bool, steps: Vec<StepDef>, label: Option<String>, gen: bool },
    Spell { steps: Vec<StepDef> },
    Static { m: StaticMod, while_: Option<Cond> },
    Replace { match_: Pattern, apply: ReplaceApply, optional: bool, while_: Option<Cond>, label: Option<String> },
    Permission { play: PlayKind, from: Zone, after_bottom: bool, rush: bool },
    SelfCost { delta: Expr, cond: Option<Cond>, floor: Option<i32> },
    Hyperize { tap_other: i32 },
    Shinkalize,
    AltCost { id: String, label: String, when: Option<Cond>, cost: AltCostSpec },
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
    if let Some(v) = j.get("mul") {
        return Ok(Expr::Mul(v.as_arr().ok_or("mul")?.iter().map(parse_expr).collect::<R<_>>()?));
    }
    if let Some(v) = j.get("evLen") {
        return Ok(Expr::EvLen(sym(v.as_str().ok_or("evLen")?)));
    }
    if let Some(v) = j.get("len") {
        return Ok(Expr::Len(v.as_str().ok_or("len")?.to_string()));
    }
    if let Some(v) = j.get("under") {
        return Ok(Expr::Under(v.as_str().ok_or("under")?.to_string()));
    }
    if let Some(v) = j.get("distinct") {
        return Ok(Expr::Distinct(Rc::new(parse_selector(v.get("sel").ok_or("distinct.sel")?)?)));
    }
    if let Some(v) = j.get("powerOf") {
        return Ok(Expr::PowerOf(v.as_str().ok_or("powerOf")?.to_string()));
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
        Some(t) => Some(sel_type_of(t)?),
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

fn sel_type_of(t: &str) -> R<SelType> {
    Ok(match t {
        "creature" => SelType::Creature,
        "spell" => SelType::Spell,
        "card" => SelType::Card,
        "element" => SelType::Element,
        "tamaseed" => SelType::Tamaseed,
        "field" => SelType::Field,
        "crossgear" => SelType::Crossgear,
        "castle" => SelType::Castle,
        t => return err(format!("未知の type: {}", t)),
    })
}

fn turn_of(j: Option<&Json>) -> Option<TurnSel> {
    match j.and_then(|x| x.as_str()) {
        Some("own") => Some(TurnSel::Own),
        Some("opponent") => Some(TurnSel::Opponent),
        Some("any") => Some(TurnSel::Any),
        _ => None,
    }
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
        up: boolf("up"),
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
        self_attacker: boolf("selfAttacker").unwrap_or(false),
        not_via: symf("notVia"),
        target_kind: symf("targetKind"),
        target_self: boolf("targetSelf").unwrap_or(false),
        broke: boolf("broke"),
        host_attacker: boolf("hostAttacker").unwrap_or(false),
        cond: match j.get("cond") {
            Some(c) => Some(Box::new(parse_cond(c)?)),
            None => None,
        },
        turn: turn_of(j.get("turn")),
        not_from: symf("notFrom"),
        not_to: symf("notTo"),
        by_opponent: boolf("byOpponent").unwrap_or(false),
        reason: symf("reason"),
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
        return Ok(Cond::Shields { q: range3(v), opponent: s_of(v, "who") == Some("opponent") });
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
        return Ok(Cond::Logged { pattern, min, since: s_of(v, "since").map(sym) });
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
    if o.get("powerLtSelf").is_some() {
        return Ok(Cond::PowerLtSelf);
    }
    if let Some(v) = o.get("power") {
        let e = |k: &str| -> R<Option<Expr>> {
            match v.get(k) {
                Some(x) => Ok(Some(parse_expr(x)?)),
                None => Ok(None),
            }
        };
        return Ok(Cond::Power(PowerQ { lte: e("lte")?, gte: e("gte")?, lt: e("lt")?, gt: e("gt")? }));
    }
    if let Some(v) = o.get("type") {
        return Ok(Cond::Type(sel_type_of(v.as_str().unwrap_or(""))?));
    }
    if let Some(v) = o.get("some") {
        return Ok(Cond::Some { var: s_of(v, "var").ok_or("some.var")?.to_string(), where_: Box::new(parse_cond(v.get("where").ok_or("some.where")?)?) });
    }
    if o.get("isSelf").is_some() {
        return Ok(Cond::IsSelf);
    }
    if o.get("stUsed").is_some() {
        return Ok(Cond::StUsed);
    }
    if o.get("faceUp").is_some() {
        return Ok(Cond::FaceUp);
    }
    if o.get("hyper").is_some() {
        return Ok(Cond::Hyper);
    }
    if let Some(v) = o.get("crossed") {
        return Ok(Cond::Crossed(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("hostIs") {
        return Ok(Cond::HostIs(Box::new(parse_cond(v)?)));
    }
    if o.get("hasGear").is_some() {
        return Ok(Cond::HasGear);
    }
    if let Some(v) = o.get("selfTapped") {
        return Ok(Cond::SelfTapped(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("ownedBy") {
        return Ok(Cond::OwnedBy(rel_of(v).ok_or("ownedBy")?));
    }
    if let Some(v) = o.get("baseFor") {
        return Ok(Cond::BaseFor(v.as_str().ok_or("baseFor")?.to_string()));
    }
    if let Some(v) = o.get("ultimate") {
        return Ok(Cond::Ultimate(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("twin") {
        return Ok(Cond::Twin(v.as_bool().unwrap_or(true)));
    }
    if let Some(v) = o.get("distinctCosts") {
        return Ok(Cond::DistinctCosts(v.as_str().ok_or("distinctCosts")?.to_string()));
    }
    if let Some(v) = o.get("hasKw") {
        return Ok(Cond::HasKw(sym(v.as_str().ok_or("hasKw")?)));
    }
    if let Some(v) = o.get("altUsed") {
        return Ok(Cond::AltUsed(v.as_str().ok_or("altUsed")?.to_string()));
    }
    if let Some(v) = o.get("nameHas") {
        return Ok(Cond::NameHas(v.as_str().ok_or("nameHas")?.to_string()));
    }
    if o.get("hasCip").is_some() {
        return Ok(Cond::HasCip);
    }
    if let Some(v) = o.get("eventIs") {
        let mut kv = Vec::new();
        if let Json::Obj(m) = v {
            for (k, x) in m {
                kv.push((sym(k), Val::from_json(x)));
            }
        }
        return Ok(Cond::EventIs(kv));
    }
    if let Some(v) = o.get("allSame") {
        return Ok(Cond::AllSame {
            var: s_of(v, "var").ok_or("allSame.var")?.to_string(),
            where_: match v.get("where") {
                Some(w) => Some(Box::new(parse_cond(w)?)),
                None => None,
            },
        });
    }
    if let Some(v) = o.get("onBase") {
        return Ok(Cond::OnBase(Box::new(parse_cond(v)?)));
    }
    if let Some(v) = o.get("powerRank") {
        return Ok(Cond::PowerRank { max: s_of(v, "which") == Some("max"), of: Rc::new(parse_selector(v.get("of").ok_or("powerRank.of")?)?) });
    }
    if let Some(v) = o.get("unused") {
        return Ok(Cond::Unused(v.as_str().ok_or("unused")?.to_string()));
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

fn parse_mod(j: &Json) -> R<ModDef> {
    let fixed = |m: EffectMod| Ok(ModDef::Fixed(m));
    match s_of(j, "kind") {
        Some("cannotAttack") => fixed(EffectMod::CannotAttack),
        Some("powerAdd") => Ok(ModDef::PowerAdd(parse_expr(j.get("n").unwrap_or(&Json::Num(0.0)))?)),
        Some("grant") => fixed(EffectMod::Grant(sym(s_of(j, "keyword").ok_or("grant.keyword")?))),
        Some("cannotBeChosen") => fixed(EffectMod::CannotBeChosen),
        Some("cannotBeAttacked") => fixed(EffectMod::CannotBeAttacked),
        Some("mustBlock") => fixed(EffectMod::MustBlock),
        Some("cannotBlock") => fixed(EffectMod::CannotBlock),
        Some("breaker") => Ok(ModDef::Breaker(parse_expr(j.get("n").ok_or("breaker.n")?)?)),
        Some("untapAfterAttack") => fixed(EffectMod::UntapAfterAttack),
        Some("cannotLeave") => fixed(EffectMod::CannotLeave),
        k => err(format!("未知の効果: {:?}", k)),
    }
}

fn until_of(a: &Json) -> R<UntilKind> {
    Ok(match s_of(a, "until") {
        Some("endOfTurn") => UntilKind::EndOfTurn,
        Some("nextTurnStart") => UntilKind::NextTurnStart,
        Some("source") => UntilKind::Source,
        Some("nextOpponentTurnEnd") => UntilKind::NextOpponentTurnEnd,
        Some("oppTurnEnd") => UntilKind::OppTurnEnd,
        u => return err(format!("未知の期限: {:?}", u)),
    })
}

fn opt_expr(j: Option<&Json>) -> R<Option<Expr>> {
    match j {
        Some(x) => Ok(Some(parse_expr(x)?)),
        None => Ok(None),
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
            // 引く枚数は、数・{ n: 式, who? }・式(例: { count: ... })のどれでもよい
            _ if a.get("n").is_some() => Act::Draw { n: parse_expr(a.get("n").unwrap())?, who: who_of(a.get("who")) },
            _ => Act::Draw { n: parse_expr(a)?, who: Who::Controller },
        },
        "move" => Act::Move {
            sel: sel_or_var(a.get("sel").ok_or("move.sel")?)?,
            to: zone_of(s_of(a, "to").ok_or("move.to")?)?,
            cause: cause_of(a),
            pos: a.get("pos").and_then(|x| x.as_str()).map(|p| p == "top"),
            tapped: a.get("tapped").and_then(|x| x.as_bool()),
            as_: opt_sym(a, "as"),
            no_replace: a.get("noReplace").and_then(|x| x.as_bool()).unwrap_or(false),
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
        "addShield" => Act::AddShield { n: a.get("n").and_then(|x| x.as_i64()).unwrap_or(1) as i32, who: who_of(a.get("who")), as_: opt_sym(a, "as") },
        "tap" => Act::Tap { sel: sel_or_var(a.get("sel").ok_or("tap.sel")?)? },
        "untap" => Act::Untap { sel: sel_or_var(a.get("sel").ok_or("untap.sel")?)? },
        "addEffect" => {
            let mods = match a.get("mods") {
                Some(m) => m.as_arr().ok_or("mods")?.iter().map(parse_mod).collect::<R<Vec<_>>>()?,
                None => vec![parse_mod(a.get("mod").ok_or("addEffect.mod")?)?],
            };
            let until = until_of(a)?;
            Act::AddEffect { mods, sel: sel_or_var(a.get("sel").ok_or("addEffect.sel")?)?, until }
        }
        "put" => Act::Put {
            sel: sel_or_var(a.get("sel").ok_or("put.sel")?)?,
            as_: opt_sym(a, "as"),
            onto: s_of(a, "onto").map(|s| s.to_string()),
            no_triggers: a.get("noTriggers").and_then(|x| x.as_bool()).unwrap_or(false),
        },
        "summon" => Act::Summon {
            sel: sel_or_var(a.get("sel").ok_or("summon.sel")?)?,
            as_: opt_sym(a, "as"),
            onto: s_of(a, "onto").map(|s| s.to_string()),
            no_triggers: a.get("noTriggers").and_then(|x| x.as_bool()).unwrap_or(false),
        },
        "castFree" => Act::CastFree { sel: sel_or_var(a.get("sel").ok_or("castFree.sel")?)?, after: opt_sym(a, "after") },
        "skipRestOfTurn" => Act::SkipRestOfTurn,
        "copyTrigger" => Act::CopyTrigger,
        "invade" => Act::Invade,
        "revolutionChange" => Act::RevolutionChange,
        "log" => Act::Log { ty: sym(a.as_str().ok_or("log")?) },
        "battle" => Act::Battle { a: s_of(a, "a").ok_or("battle.a")?.to_string(), b: s_of(a, "b").ok_or("battle.b")?.to_string() },
        "playerEffect" => {
            let m = a.get("mod").ok_or("playerEffect.mod")?;
            let pm = match s_of(m, "kind") {
                Some("cannotCast") => PlayerMod::CannotCast(opt_expr(m.get("n"))?),
                Some("cannotUseCost") => PlayerMod::CannotUseCost(parse_expr(m.get("n").ok_or("cannotUseCost.n")?)?),
                Some("cannotSummon") => PlayerMod::CannotSummon(parse_expr(m.get("maxCost").ok_or("cannotSummon.maxCost")?)?),
                Some("cannotCastLte") => PlayerMod::CannotCastLte(parse_expr(m.get("n").ok_or("cannotCastLte.n")?)?),
                Some("ignoreCost") => PlayerMod::IgnoreCost(parse_expr(m.get("n").ok_or("ignoreCost.n")?)?),
                Some("ignoreAll") => PlayerMod::IgnoreAll,
                Some("startShield") => PlayerMod::StartShield,
                Some("owe") => PlayerMod::Owe { civ: civ_of(s_of(m, "civ").ok_or("owe.civ")?)?, n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("oncePerTurnActs") => PlayerMod::OncePerTurnActs,
                Some("nextSummon") => PlayerMod::NextSummon { delta: parse_expr(m.get("delta").ok_or("nextSummon.delta")?)?, sa: m.get("sa").and_then(|x| x.as_bool()).unwrap_or(false) },
                Some("cannotAttackAny") => PlayerMod::CannotAttackAny,
                Some("cannotLose") => PlayerMod::CannotLose,
                Some("cannotActCost") => PlayerMod::CannotActCost(parse_expr(m.get("n").ok_or("cannotActCost.n")?)?),
                k => return err(format!("未知のプレイヤー効果: {:?}", k)),
            };
            let until = until_of(a)?;
            Act::PlayerEffect { m: pm, until }
        }
        "setVar" => {
            let v = a.get("value").unwrap_or(&Json::Null);
            let expr = if matches!(v, Json::Obj(_)) { Some(parse_expr(v)?) } else { None };
            Act::SetVar { as_: opt_sym(a, "as").ok_or("setVar.as")?, value: Val::from_json(v), expr }
        }
        "moveBottom" => Act::MoveBottom {
            who: who_of(a.get("who")),
            n: parse_expr(a.get("n").ok_or("moveBottom.n")?)?,
            to: zone_of(s_of(a, "to").ok_or("moveBottom.to")?)?,
            cause: cause_of(a),
            tapped: a.get("tapped").and_then(|x| x.as_bool()),
            as_: opt_sym(a, "as"),
        },
        "shuffleIn" => Act::ShuffleIn { sel: sel_or_var(a.get("sel").ok_or("shuffleIn.sel")?)?, as_: opt_sym(a, "as") },
        "bottom" => Act::Bottom { of: s_of(a, "of").ok_or("bottom.of")?.to_string(), except: s_of(a, "except").map(|s| s.to_string()) },
        "rush" => Act::Rush { sel: sel_or_var(a.get("sel").ok_or("rush.sel")?)?, if_attacked: a.get("ifAttacked").and_then(|x| x.as_bool()).unwrap_or(false) },
        "useCip" => Act::UseCip { sel: sel_or_var(a.get("sel").ok_or("useCip.sel")?)? },
        "graveToBottom" => Act::GraveToBottom { who: who_of(a.get("who")) },
        "play" => Act::Play { sel: sel_or_var(a.get("sel").ok_or("play.sel")?)?, alt: s_of(a, "alt").map(|s| s.to_string()) },
        "win" => Act::Win,
        "cross" => Act::Cross { gear: sel_or_var(a.get("gear").ok_or("cross.gear")?)?, to: sel_or_var(a.get("to").ok_or("cross.to")?)? },
        "ninjaChange" => Act::NinjaChange { sel: sel_or_var(a.get("sel").ok_or("ninjaChange.sel")?)? },
        "grantShieldTrigger" => Act::GrantShieldTrigger { sel: sel_or_var(a.get("sel").ok_or("grantShieldTrigger.sel")?)? },
        "breakOpp" => Act::BreakOpp { n: a.get("n").and_then(|x| x.as_i64()).unwrap_or(1) as i32 },
        "allowSummon" => Act::AllowSummon { sel: sel_or_var(a.get("sel").ok_or("allowSummon.sel")?)? },
        "destroyTop" => Act::DestroyTop { sel: sel_or_var(a.get("sel").ok_or("destroyTop.sel")?)? },
        "dropUnder" => Act::DropUnder { sel: sel_or_var(a.get("sel").ok_or("dropUnder.sel")?)?, n: a.get("n").and_then(|x| x.as_i64()).map(|n| n as i32), deck: s_of(a, "to") == Some("deck") },
        "summonOnto" => Act::SummonOnto { sel: sel_or_var(a.get("sel").ok_or("summonOnto.sel")?)?, under: s_of(a, "under").ok_or("summonOnto.under")?.to_string() },
        "extraTurn" => Act::ExtraTurn,
        "markUsed" => Act::MarkUsed { key: s_of(a, "key").ok_or("markUsed.key")?.to_string() },
        "putUnder" => Act::PutUnder { sel: sel_or_var(a.get("sel").ok_or("putUnder.sel")?)?, onto: sel_or_var(a.get("onto").ok_or("putUnder.onto")?)? },
        "tapLock" => Act::TapLock { sel: sel_or_var(a.get("sel").ok_or("tapLock.sel")?)? },
        "breakShields" => Act::BreakShields { n: a.get("n").and_then(|x| x.as_i64()).map(|n| n as i32) },
        "judge" => Act::Judge { as_: opt_sym(a, "as") },
        "stackShield" => Act::StackShield { sel: sel_or_var(a.get("sel").ok_or("stackShield.sel")?)?, onto: sel_or_var(a.get("onto").ok_or("stackShield.onto")?)? },
        "castSide" => Act::CastSide { sel: sel_or_var(a.get("sel").ok_or("castSide.sel")?)? },
        "seal" => Act::Seal { sel: sel_or_var(a.get("sel").ok_or("seal.sel")?)? },
        "stab" => Act::Stab { sel: sel_or_var(a.get("sel").ok_or("stab.sel")?)?, depth: a.get("depth").and_then(|x| x.as_i64()).unwrap_or(4) as i32 },
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
            append: j.get("append").and_then(|x| x.as_bool()).unwrap_or(false),
            sum_lte: opt_expr(j.get("sumLte"))?,
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
        "poweredBreaker" => KeywordName::PoweredBreaker,
        "sBack" => KeywordName::SBack,
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
                    look_back: spec.get("lookBack").and_then(|x| x.as_bool()).unwrap_or(false),
                    nth_min: spec.get("nthMin").and_then(|x| x.as_i64()).map(|x| x as i32),
                    limit_per_turn: spec.get("limit").and_then(|l| l.get("perTurn")).and_then(|x| x.as_i64()).map(|x| x as i32),
                    if_: opt_cond(spec, "if")?,
                    if_at_resolve: opt_cond(spec, "ifAtResolve")?,
                },
                optional: j.get("optional").and_then(|x| x.as_bool()).unwrap_or(false),
                steps: opt_steps(j.get("steps"))?,
                label: s_of(j, "label").map(|s| s.to_string()),
                gen: j.get("gen").and_then(|x| x.as_bool()).unwrap_or(false),
            }
        }
        "spell" => Ability::Spell { steps: opt_steps(j.get("steps"))? },
        "static" => {
            let m = j.get("mod").ok_or("static.mod")?;
            let sm = match s_of(m, "type") {
                Some("costDelta") => StaticMod::CostDelta {
                    delta: parse_expr(m.get("delta").unwrap_or(&Json::Num(0.0)))?,
                    cond: parse_cond(m.get("cond").ok_or("costDelta.cond")?)?,
                    once_per_turn: m.get("oncePerTurn").and_then(|x| x.as_bool()).unwrap_or(false),
                    floor: m.get("floor").and_then(|x| x.as_i64()).map(|x| x as i32),
                },
                Some("powerAttacker") => StaticMod::PowerAttacker { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("powerAddInBattle") => StaticMod::PowerAddInBattle { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("burnShields") => StaticMod::BurnShields,
                Some("firstBattleWins") => StaticMod::FirstBattleWins,
                Some("enterTappedFirst") => StaticMod::EnterTappedFirst,
                Some("untapLimit") => StaticMod::UntapLimit { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("allowPlayFrom") => StaticMod::AllowPlayFrom {
                    from: zone_of(s_of(m, "from").ok_or("allowPlayFrom.from")?)?,
                    cond: opt_cond(m, "cond")?,
                    once_per_turn: m.get("oncePerTurn").and_then(|x| x.as_bool()).unwrap_or(false),
                    rush: m.get("rush").and_then(|x| x.as_bool()).unwrap_or(false),
                },
                Some("cannotBeChosen") => StaticMod::CannotBeChosen,
                Some("mustBeChosen") => StaticMod::MustBeChosen,
                Some("protectFromSpells") => StaticMod::ProtectFromSpells,
                Some("ignoreCastBan") => StaticMod::IgnoreCastBan { cond: parse_cond(m.get("cond").ok_or("ignoreCastBan.cond")?)? },
                Some("graveCastToBottom") => StaticMod::GraveCastToBottom,
                Some("noDeckOutLoss") => StaticMod::NoDeckOutLoss,
                Some("peekDeckTop") => StaticMod::PeekDeckTop,
                Some("enterTapped") => StaticMod::EnterTapped,
                Some("powerAddExpr") => StaticMod::PowerAddExpr { expr: parse_expr(m.get("expr").ok_or("powerAddExpr.expr")?)? },
                Some("stab5sd") => StaticMod::Stab5sd,
                Some("deckLock") => StaticMod::DeckLock,
                Some("noOppShieldTrigger") => StaticMod::NoOppShieldTrigger,
                Some("attackMeFirst") => StaticMod::AttackMeFirst,
                Some("oneSpellPerTurn") => StaticMod::OneSpellPerTurn,
                Some("cannotAttack") => StaticMod::CannotAttack,
                Some("cannotAttackPlayer") => StaticMod::CannotAttackPlayer,
                Some("attackPlayerOnEntry") => StaticMod::AttackPlayerOnEntry,
                Some("cannotPlay") => StaticMod::CannotPlay { cond: parse_cond(m.get("cond").ok_or("cannotPlay.cond")?)? },
                Some("freeCrossTo") => StaticMod::FreeCrossTo { cond: parse_cond(m.get("cond").ok_or("freeCrossTo.cond")?)? },
                Some("battleProxy") => StaticMod::BattleProxy { cond: parse_cond(m.get("cond").ok_or("battleProxy.cond")?)? },
                Some("guardman") => StaticMod::Guardman,
                Some("cannotSummonAll") => StaticMod::CannotSummonAll { cond: parse_cond(m.get("cond").ok_or("cannotSummonAll.cond")?)? },
                Some("protectPlayerFromWeaker") => StaticMod::ProtectPlayerFromWeaker,
                Some("noGStrike") => StaticMod::NoGStrike,
                Some("oppManaTapped") => StaticMod::OppManaTapped,
                Some("flying") => StaticMod::Flying,
                Some("cannotBreak") => StaticMod::CannotBreak,
                Some("tapAsMana") => StaticMod::TapAsMana,
                Some("spellShieldTrigger") => StaticMod::SpellShieldTrigger,
                Some("manaAllCivs") => StaticMod::ManaAllCivs,
                Some("cannotLeaveOwn") => StaticMod::CannotLeaveOwn {
                    cond: parse_cond(m.get("cond").ok_or("cannotLeaveOwn.cond")?)?,
                    except_destroy: m.get("exceptDestroy").and_then(|x| x.as_bool()).unwrap_or(false),
                },
                Some("noAttackOnEntry") => StaticMod::NoAttackOnEntry,
                Some("hostPowerAdd") => StaticMod::HostPowerAdd { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("powerAddOthers") => StaticMod::PowerAddOthers { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32, cond: parse_cond(m.get("cond").ok_or("powerAddOthers.cond")?)? },
                Some("cannotAttackPlayerWhenEntered") => StaticMod::CannotAttackPlayerWhenEntered,
                Some("cannotCast") => StaticMod::CannotCast { cond: parse_cond(m.get("cond").ok_or("cannotCast.cond")?)? },
                Some("powerAdd") => StaticMod::PowerAdd { n: m.get("n").and_then(|x| x.as_i64()).unwrap_or(0) as i32 },
                Some("infinitePowerInBattle") => StaticMod::InfinitePowerInBattle,
                Some("entersTapped") => StaticMod::EntersTapped { cond: parse_cond(m.get("cond").ok_or("entersTapped.cond")?)? },
                Some("nonSummonEntryToMana") => StaticMod::NonSummonEntryToMana,
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
                Some("changeDest") => ReplaceApply::ChangeDest {
                    to: zone_of(s_of(ap, "to").ok_or("changeDest.to")?)?,
                    then: match ap.get("then") {
                        Some(t) => Some(parse_steps(t)?),
                        None => None,
                    },
                },
                Some("stay") => ReplaceApply::Stay,
                Some("steps") => ReplaceApply::Steps(opt_steps(ap.get("steps"))?),
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
            play: match s_of(j, "play") {
                Some("cast") => PlayKind::Cast,
                Some("put") => PlayKind::Put,
                _ => PlayKind::Summon,
            },
            from: zone_of(s_of(j, "from").ok_or("permission.from")?)?,
            after_bottom: s_of(j, "after") == Some("deckBottom"),
            rush: j.get("rush").and_then(|x| x.as_bool()).unwrap_or(false),
        },
        "selfCost" => Ability::SelfCost {
            delta: parse_expr(j.get("delta").ok_or("selfCost.delta")?)?,
            cond: opt_cond(j, "cond")?,
            floor: j.get("floor").and_then(|x| x.as_i64()).map(|x| x as i32),
        },
        "hyperize" => Ability::Hyperize { tap_other: j.get("tapOther").and_then(|x| x.as_i64()).unwrap_or(1) as i32 },
        "shinkalize" => Ability::Shinkalize,
        "altCost" => {
            let c = j.get("cost").ok_or("altCost.cost")?;
            Ability::AltCost {
                id: s_of(j, "id").ok_or("altCost.id")?.to_string(),
                label: s_of(j, "label").unwrap_or("").to_string(),
                when: opt_cond(j, "when")?,
                cost: AltCostSpec {
                    from: match c.get("from") {
                        Some(f) => Some(f.as_arr().ok_or("altCost.from")?.iter().map(|z| zone_of(z.as_str().unwrap_or(""))).collect::<R<Vec<_>>>()?),
                        None => None,
                    },
                    tap_creatures: c.get("tapCreatures").and_then(|x| x.as_i64()).map(|x| x as i32),
                    pay: c.get("pay").and_then(|x| x.as_i64()).map(|x| x as i32),
                    discard: match c.get("discard") {
                        Some(d) => Some((d.get("n").and_then(|x| x.as_i64()).unwrap_or(1) as i32, opt_cond(d, "where")?)),
                        None => None,
                    },
                    reduce: c.get("reduce").and_then(|x| x.as_i64()).map(|x| x as i32),
                    end_bottom_draw: c.get("endBottomDraw").and_then(|x| x.as_bool()).unwrap_or(false),
                    to_hyper: c.get("toHyper").and_then(|x| x.as_bool()).unwrap_or(false),
                    grave_evolve: c.get("graveEvolve").and_then(|x| x.as_bool()).unwrap_or(false),
                    fushigi: c.get("fushigi").map(|f| (f.get("base").and_then(|x| x.as_i64()).unwrap_or(0) as i32, f.get("min").and_then(|x| x.as_i64()).unwrap_or(0) as i32)),
                },
            }
        }
        k => return err(format!("未知の能力: {}", k)),
    })
}
