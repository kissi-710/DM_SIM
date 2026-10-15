//! 基本の型: シンボル・動的な値・イベント・状態。TS 版(src/engine/types.ts, state.ts)と同じ形。

use crate::json::Json;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

// ───────────────────────── シンボル(文字列の索引化) ─────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub struct Sym(pub u16);

struct Interner {
    names: Vec<Rc<str>>,
    map: HashMap<Rc<str>, u16>,
}

macro_rules! syms {
    ($($id:ident => $s:expr),* $(,)?) => {
        #[allow(non_camel_case_types, dead_code, clippy::upper_case_acronyms)]
        #[repr(u16)]
        enum K { $($id),* }
        /// 頻出の名前(あらかじめ索引化済み)
        #[allow(dead_code)]
        pub mod s {
            use super::{Sym, K};
            $(pub const $id: Sym = Sym(K::$id as u16);)*
        }
        const PRE: &[&str] = &[$($s),*];
    };
}

syms! {
    // イベントの種類
    MOVED => "moved", ENTERED => "entered", EVOLVED => "evolved", CHOSEN => "chosen", LOOKED => "looked",
    REVEALED => "revealed", CAST => "cast", ATTACK_DECLARED => "attackDeclared", BLOCKED => "blocked",
    BATTLE_ENDED => "battleEnded", SHIELD_BROKEN => "shieldBroken", TRIGGER_DECLARED => "triggerDeclared",
    TAPPED => "tapped", UNTAPPED => "untapped", STEP_START => "stepStart", ABILITY_TRIGGERED => "abilityTriggered",
    RESOLVE => "resolve", GAME_OVER => "gameOver", SKIP_TURN => "skipTurn", GAME_LOSS => "gameLoss",
    // イベントのフィールド
    CARD => "card", OWNER => "owner", FROM => "from", TO => "to", CAUSE => "cause", KIND => "kind", EX => "ex",
    LKI => "lki", VIA => "via", UNDERNEATH => "underneath", PAID => "paid", COST => "cost", FREE => "free",
    PID => "pid", FACE => "face", BASE => "base", CARDS => "cards", BY => "by", SOURCE => "source", STEP => "step",
    PLAYER => "player", TARGET => "target", ATTACKER => "attacker", ATTACKER_CARD => "attackerCard",
    BLOCKER => "blocker", WINNER => "winner", WINNER_CARD => "winnerCard", LOSER_CARD => "loserCard",
    LOSER_OWNER => "loserOwner", WINNER_OWNER => "winnerOwner", DRAW => "draw", CONTROLLER => "controller",
    ABILITY => "ability", ENTRY => "entry", REASON => "reason", LABEL => "label", DEFENDER => "defender",
    // 理由(cause / via / kind)
    EFFECT => "effect", SUMMON => "summon", DESTROY => "destroy", BOUNCE => "bounce",
    CHARGE => "charge", BREAK => "break", ADD_SHIELD => "addShield", CAST_BOTTOM => "castBottom",
    EX_LIFE => "exLife", EX_LIFE_SWAP => "exLifeSwap", REPLACED => "replaced", INVADE => "invade",
    CREATURE => "creature", SPELL => "spell", SHIELD_TRIGGER => "shieldTrigger", G_STRIKE => "gStrike",
    // フレーム・変数
    ITER => "$iter", SEEN => ":seen", UID => "uid", EP => "ep", PLAN => "plan", FROM_ZONE => "fromZone",
    EXTRA => "extra", AFTER => "after", NO_END => "noEnd", BROKEN => "broken", N => "n",
    ONTO => "onto", SETTLE => "settle", SELF_VAR => "$self",
    // 使用回数のキー
    DECK_OUT => "deckOutHandled",
    // ゾーン名・その他
    Z_DECK => "deck", Z_HAND => "hand", Z_MANA => "mana", Z_SHIELD => "shield", Z_BATTLE => "battle", Z_GRAVE => "grave", Z_LIMBO => "limbo", Z_HYPER => "hyper",
    DEFID => "defId", IDX => "idx", TAP => "tap", PAY => "pay", TYPE => "type",
    ALL => "all", START => "start", END => "end", DECK_BOTTOM => "deckBottom",
    KW_SPEED_ATTACKER => "speedAttacker", KW_MACH_FIGHTER => "machFighter", KW_JUST_DIVER => "justDiver",
    KW_SLAYER => "slayer", KW_UNBLOCKABLE => "unblockable", CAST_HYPER => "castHyper",
    REVOLUTION_CHANGE => "revolutionChange",
}

thread_local! {
    static INTERN: RefCell<Interner> = RefCell::new({
        let mut it = Interner { names: Vec::new(), map: HashMap::new() };
        for n in PRE {
            assert!(!it.map.contains_key(*n), "シンボルが重複しています: {}", n);
            let r: Rc<str> = Rc::from(*n);
            let id = it.names.len() as u16;
            it.names.push(r.clone());
            it.map.insert(r, id);
        }
        it
    });
}

pub fn sym(name: &str) -> Sym {
    INTERN.with(|i| {
        let mut i = i.borrow_mut();
        if let Some(&id) = i.map.get(name) {
            return Sym(id);
        }
        let r: Rc<str> = Rc::from(name);
        let id = i.names.len() as u16;
        i.names.push(r.clone());
        i.map.insert(r, id);
        Sym(id)
    })
}

impl Sym {
    pub fn name(self) -> Rc<str> {
        INTERN.with(|i| i.borrow().names[self.0 as usize].clone())
    }
}

// ───────────────────────── 列挙 ─────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Civ {
    Light,
    Water,
    Darkness,
    Fire,
    Nature,
}

impl Civ {
    pub fn parse(s: &str) -> Option<Civ> {
        Some(match s {
            "light" => Civ::Light,
            "water" => Civ::Water,
            "darkness" => Civ::Darkness,
            "fire" => Civ::Fire,
            "nature" => Civ::Nature,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Civ::Light => "light",
            Civ::Water => "water",
            Civ::Darkness => "darkness",
            Civ::Fire => "fire",
            Civ::Nature => "nature",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Zone {
    Deck,
    Hand,
    Mana,
    Shield,
    Battle,
    Grave,
    Limbo,
    Hyper,
}

impl Zone {
    pub fn parse(s: &str) -> Option<Zone> {
        Some(match s {
            "deck" => Zone::Deck,
            "hand" => Zone::Hand,
            "mana" => Zone::Mana,
            "shield" => Zone::Shield,
            "battle" => Zone::Battle,
            "grave" => Zone::Grave,
            "limbo" => Zone::Limbo,
            "hyper" => Zone::Hyper,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Zone::Deck => "deck",
            Zone::Hand => "hand",
            Zone::Mana => "mana",
            Zone::Shield => "shield",
            Zone::Battle => "battle",
            Zone::Grave => "grave",
            Zone::Limbo => "limbo",
            Zone::Hyper => "hyper",
        }
    }
    pub fn sym(self) -> Sym {
        match self {
            Zone::Deck => s::Z_DECK,
            Zone::Hand => s::Z_HAND,
            Zone::Mana => s::Z_MANA,
            Zone::Shield => s::Z_SHIELD,
            Zone::Battle => s::Z_BATTLE,
            Zone::Grave => s::Z_GRAVE,
            Zone::Limbo => s::Z_LIMBO,
            Zone::Hyper => s::Z_HYPER,
        }
    }
    pub fn from_sym(x: Sym) -> Option<Zone> {
        Some(match x {
            s::Z_DECK => Zone::Deck,
            s::Z_HAND => Zone::Hand,
            s::Z_MANA => Zone::Mana,
            s::Z_SHIELD => Zone::Shield,
            s::Z_BATTLE => Zone::Battle,
            s::Z_GRAVE => Zone::Grave,
            s::Z_LIMBO => Zone::Limbo,
            s::Z_HYPER => Zone::Hyper,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaceType {
    Creature,
    Spell,
    Evolution,
    SmaxEvolution,
}

impl FaceType {
    pub fn parse(s: &str) -> Option<FaceType> {
        Some(match s {
            "creature" => FaceType::Creature,
            "spell" => FaceType::Spell,
            "evolution" => FaceType::Evolution,
            "smaxEvolution" => FaceType::SmaxEvolution,
            _ => return None,
        })
    }
    pub fn is_evo(self) -> bool {
        matches!(self, FaceType::Evolution | FaceType::SmaxEvolution)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Step {
    Start,
    Draw,
    Mana,
    Main,
    Attack,
    End,
}

impl Step {
    pub fn parse(s: &str) -> Option<Step> {
        Some(match s {
            "start" => Step::Start,
            "draw" => Step::Draw,
            "mana" => Step::Mana,
            "main" => Step::Main,
            "attack" => Step::Attack,
            "end" => Step::End,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Step::Start => "start",
            Step::Draw => "draw",
            Step::Mana => "mana",
            Step::Main => "main",
            Step::Attack => "attack",
            Step::End => "end",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Winner {
    None,
    P(u8),
    Draw,
}

pub type PlayerId = u8;
pub fn opp(p: PlayerId) -> PlayerId {
    1 - p
}

// ───────────────────────── 動的な値 ─────────────────────────

/// 参照(カードの uid と、そのゾーン移動の世代 ep)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ObjRef {
    pub uid: i32,
    pub ep: i32,
}

/// イベント・フレームの変数に入る動的な値(TS 版の any に相当)
#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    Null,
    Bool(bool),
    Int(i64),
    Str(Sym),
    List(Rc<Vec<Val>>),
    Obj(Rc<Vec<(Sym, Val)>>),
    Ev(Rc<Ev>),
    Snap(Rc<Snap>),
}

impl Val {
    pub fn ints(v: &[i32]) -> Val {
        Val::List(Rc::new(v.iter().map(|&x| Val::Int(x as i64)).collect()))
    }
    pub fn refs(v: &[ObjRef]) -> Val {
        Val::List(Rc::new(v.iter().map(|r| Val::from_ref(*r)).collect()))
    }
    pub fn from_ref(r: ObjRef) -> Val {
        Val::Obj(Rc::new(vec![(s::UID, Val::Int(r.uid as i64)), (s::EP, Val::Int(r.ep as i64))]))
    }
    pub fn zone(z: Zone) -> Val {
        Val::Str(z.sym())
    }
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Val::Int(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_i32(&self) -> Option<i32> {
        self.as_int().map(|n| n as i32)
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Val::Bool(b) => Some(*b),
            _ => None,
        }
    }
    pub fn as_sym(&self) -> Option<Sym> {
        match self {
            Val::Str(s) => Some(*s),
            _ => None,
        }
    }
    pub fn as_list(&self) -> Option<&Vec<Val>> {
        match self {
            Val::List(l) => Some(l),
            _ => None,
        }
    }
    pub fn get(&self, k: Sym) -> Option<&Val> {
        match self {
            Val::Obj(o) => o.iter().find(|(kk, _)| *kk == k).map(|(_, v)| v),
            _ => None,
        }
    }
    /// [Int...] を Vec<i32> にする
    pub fn to_i32s(&self) -> Vec<i32> {
        match self {
            Val::List(l) => l.iter().filter_map(|x| x.as_i32()).collect(),
            Val::Int(n) => vec![*n as i32],
            _ => vec![],
        }
    }
    /// 参照(uid, ep)として読む
    pub fn as_ref(&self) -> Option<ObjRef> {
        match self {
            Val::Obj(_) => {
                let uid = self.get(s::UID)?.as_i32()?;
                let ep = self.get(s::EP)?.as_i32()?;
                Some(ObjRef { uid, ep })
            }
            _ => None,
        }
    }

    pub fn from_json(j: &Json) -> Val {
        match j {
            Json::Null => Val::Null,
            Json::Bool(b) => Val::Bool(*b),
            Json::Num(n) => Val::Int(*n as i64),
            Json::Str(s) => Val::Str(sym(s)),
            Json::Arr(a) => Val::List(Rc::new(a.iter().map(Val::from_json).collect())),
            Json::Obj(o) => Val::Obj(Rc::new(o.iter().map(|(k, v)| (sym(k), Val::from_json(v))).collect())),
        }
    }
}

/// 参照つきの値をそのまま JSON にする(カード定義 ID の復元に、定義の名前表を使う)
pub struct Names<'a> {
    pub defs: &'a [String],
}

impl Val {
    pub fn to_json(&self, n: &Names) -> Json {
        match self {
            Val::Null => Json::Null,
            Val::Bool(b) => Json::Bool(*b),
            Val::Int(i) => Json::int(*i),
            Val::Str(s) => Json::Str(s.name().to_string()),
            Val::List(l) => Json::Arr(l.iter().map(|x| x.to_json(n)).collect()),
            Val::Obj(o) => Json::Obj(o.iter().map(|(k, v)| (k.name().to_string(), v.to_json(n))).collect()),
            Val::Ev(e) => e.to_json(n),
            Val::Snap(s) => s.to_json(n),
        }
    }
}

// ───────────────────────── イベント・スナップショット ─────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub struct Ev {
    pub id: i32,
    pub caused_by: Option<i32>,
    pub ty: Sym,
    pub turn: i32,
    pub f: Vec<(Sym, Val)>,
}

impl Ev {
    pub fn get(&self, k: Sym) -> Option<&Val> {
        self.f.iter().find(|(kk, _)| *kk == k).map(|(_, v)| v)
    }
    pub fn int(&self, k: Sym) -> Option<i64> {
        self.get(k).and_then(|v| v.as_int())
    }
    pub fn sym_of(&self, k: Sym) -> Option<Sym> {
        self.get(k).and_then(|v| v.as_sym())
    }
    pub fn to_json(&self, n: &Names) -> Json {
        let mut o = vec![
            ("id".to_string(), Json::int(self.id as i64)),
            ("causedBy".to_string(), self.caused_by.map_or(Json::Null, |c| Json::int(c as i64))),
            ("type".to_string(), Json::Str(self.ty.name().to_string())),
            ("turn".to_string(), Json::int(self.turn as i64)),
        ];
        for (k, v) in &self.f {
            o.push((k.name().to_string(), v.to_json(n)));
        }
        Json::Obj(o)
    }
}

/// 場を離れる前の姿(LKI)
#[derive(Clone, Debug, PartialEq)]
pub struct Snap {
    pub uid: i32,
    pub def: u16,
    pub owner: PlayerId,
    pub face: i32,
    pub zone: Zone,
    pub civs: Rc<Vec<Civ>>,
    pub cost: i32,
    pub power: i32,
    pub multicolor: bool,
    pub pid: i32,
}

impl Snap {
    pub fn to_json(&self, n: &Names) -> Json {
        Json::obj(vec![
            ("uid", Json::int(self.uid as i64)),
            ("defId", Json::Str(n.defs[self.def as usize].clone())),
            ("owner", Json::int(self.owner as i64)),
            ("face", Json::int(self.face as i64)),
            ("zone", Json::str(self.zone.name())),
            ("civs", Json::Arr(self.civs.iter().map(|c| Json::str(c.name())).collect())),
            ("cost", Json::int(self.cost as i64)),
            ("power", Json::int(self.power as i64)),
            ("multicolor", Json::Bool(self.multicolor)),
            ("pid", Json::int(self.pid as i64)),
        ])
    }
}

// ───────────────────────── 状態 ─────────────────────────

#[derive(Clone, Debug)]
pub struct Card {
    pub def: u16,
    pub owner: PlayerId,
    pub zone: Zone,
    pub ep: i32,
    pub tapped: bool,
    pub ex: bool,
    pub ex_pid: i32,
    pub pid: i32,
    pub face: i32,
}

#[derive(Clone, Debug)]
pub struct Perm {
    pub pid: i32,
    pub cards: Vec<i32>,
    pub tapped: bool,
    pub sick: bool,
    pub entered_turn: i32,
}

#[derive(Clone, Debug, Default)]
pub struct PlayerZones {
    pub deck: Vec<i32>,
    pub hand: Vec<i32>,
    pub mana: Vec<i32>,
    pub shield: Vec<i32>,
    pub grave: Vec<i32>,
    pub hyper: Vec<i32>,
    pub battle: Vec<Perm>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AbilityRef {
    pub def: u16,
    pub face: u8,
    pub idx: u16,
}

pub type Vars = Vec<(Sym, Val)>;

pub fn var_get(v: &Vars, k: Sym) -> Option<&Val> {
    v.iter().find(|(kk, _)| *kk == k).map(|(_, x)| x)
}

pub fn var_set(v: &mut Vars, k: Sym, val: Val) {
    if let Some(e) = v.iter_mut().find(|(kk, _)| *kk == k) {
        e.1 = val;
    } else {
        v.push((k, val));
    }
}

#[derive(Clone, Debug)]
pub struct EffectFrame {
    pub id: i32,
    pub caused_by: Option<i32>,
    pub ability: AbilityRef,
    pub source: ObjRef,
    pub lki: Rc<Snap>,
    pub controller: PlayerId,
    pub pc: usize,
    pub vars: Vars,
    pub trigger: Option<Rc<Ev>>,
    pub no_optional: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProcName {
    Turn,
    Play,
    Attack,
    Break,
    Settle,
    Sba,
}

impl ProcName {
    pub fn name(self) -> &'static str {
        match self {
            ProcName::Turn => "turn",
            ProcName::Play => "play",
            ProcName::Attack => "attack",
            ProcName::Break => "break",
            ProcName::Settle => "settle",
            ProcName::Sba => "sba",
        }
    }
    pub fn parse(s: &str) -> Option<ProcName> {
        Some(match s {
            "turn" => ProcName::Turn,
            "play" => ProcName::Play,
            "attack" => ProcName::Attack,
            "break" => ProcName::Break,
            "settle" => ProcName::Settle,
            "sba" => ProcName::Sba,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug)]
pub struct ProcFrame {
    pub id: i32,
    pub caused_by: Option<i32>,
    pub name: ProcName,
    pub stage: i32,
    pub vars: Vars,
}

#[derive(Clone, Debug)]
pub enum Frame {
    Effect(EffectFrame),
    Proc(ProcFrame),
}

impl Frame {
    pub fn id(&self) -> i32 {
        match self {
            Frame::Effect(f) => f.id,
            Frame::Proc(f) => f.id,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PoolKind {
    Ability,
    ShieldTrigger,
    GStrike,
}

#[derive(Clone, Debug)]
pub struct PoolEntry {
    pub id: i32,
    pub batch: i32,
    pub ability: Option<AbilityRef>,
    pub kind: PoolKind,
    pub source: ObjRef,
    pub lki: Rc<Snap>,
    pub controller: PlayerId,
    pub event: Option<Rc<Ev>>,
    pub st_layer: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Duration {
    EndOfTurn { turn: i32 },
    UntilTurnStart { player: PlayerId, after_turn: i32 },
    Source { uid: i32, ep: i32 },
}

#[derive(Clone, Debug, PartialEq)]
pub enum EffectMod {
    CannotAttack,
    PowerAdd(i32),
    Grant(Sym),
    CannotBeChosen,
    CannotBeAttacked,
    /// プレイヤー単位(pid = -1): 発生源の持ち主の相手は呪文を唱えられない
    CannotCast,
    /// プレイヤー単位: 発生源の持ち主の相手は、コストが n のカードを実行できない
    CannotUseCost(i32),
}

#[derive(Clone, Debug)]
pub struct ContEffect {
    pub id: i32,
    pub pid: i32,
    pub m: EffectMod,
    pub until: Duration,
    pub controller: PlayerId,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WaitingPolicy {
    Pool,
    NewFirst,
    OldFirst,
}

#[derive(Clone, Debug)]
pub struct Cfg {
    pub turn_limit: i32,
    pub solitaire: bool,
    pub auto_order: [bool; 2],
    pub ack_reveals: [bool; 2],
    pub waiting_policy: WaitingPolicy,
    pub sba_after_each_step: bool,
    pub skip_runs_end_triggers: bool,
    pub max_frame_steps: i32,
}

impl Default for Cfg {
    fn default() -> Self {
        Cfg {
            turn_limit: 100,
            solitaire: false,
            auto_order: [false, false],
            ack_reveals: [false, false],
            waiting_policy: WaitingPolicy::Pool,
            sba_after_each_step: true,
            skip_runs_end_triggers: false,
            max_frame_steps: 20000,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum InputSpec {
    Pick { candidates: Vec<i32>, min: i32, max: i32 },
    Assign { items: Vec<i32>, slots: Vec<SlotSpec> },
    Option { options: Vec<String>, pick: i32, repeat: bool, all_if: bool, seen: Option<Vec<i32>> },
    YesNo,
    Order { candidates: Vec<i32>, labels: Vec<String> },
    Payment { need: i32, mana: Vec<i32> },
    Ack { shown: Vec<i32> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct SlotSpec {
    pub id: String,
    pub to: Zone,
    pub count: i32,
    pub label: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Why {
    TurnAction,
    Block,
    TriggerDeclare,
    PickNext,
    Select,
    Modes,
    May,
    Assign,
    ReplaceChoice,
    Ack,
    KeepOne,
}

impl Why {
    pub fn name(self) -> &'static str {
        match self {
            Why::TurnAction => "turnAction",
            Why::Block => "block",
            Why::TriggerDeclare => "triggerDeclare",
            Why::PickNext => "pickNext",
            Why::Select => "select",
            Why::Modes => "modes",
            Why::May => "may",
            Why::Assign => "assign",
            Why::ReplaceChoice => "replaceChoice",
            Why::Ack => "ack",
            Why::KeepOne => "keepOne",
        }
    }
    pub fn parse(s: &str) -> Option<Why> {
        Some(match s {
            "turnAction" => Why::TurnAction,
            "block" => Why::Block,
            "triggerDeclare" => Why::TriggerDeclare,
            "pickNext" => Why::PickNext,
            "select" => Why::Select,
            "modes" => Why::Modes,
            "may" => Why::May,
            "assign" => Why::Assign,
            "replaceChoice" => Why::ReplaceChoice,
            "ack" => Why::Ack,
            "keepOne" => Why::KeepOne,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    pub id: i32,
    pub player: PlayerId,
    pub why: Why,
    pub input: Option<InputSpec>,
    pub source: Option<ObjRef>,
}

/// 入力待ちの要求(id は drive が振る)
#[derive(Clone, Debug)]
pub struct NeedInput {
    pub player: PlayerId,
    pub why: Why,
    pub input: Option<InputSpec>,
    pub source: Option<ObjRef>,
}

/// 使用回数の記録のキー(誘発の回数制限 / 山札切れの置換済み)
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum UKey {
    /// "uid:ep:face:idx"(hash なら末尾に "#")
    Lim { uid: i32, ep: i32, face: i32, idx: i32, hash: bool },
    /// 山札切れの置換を済ませたプレイヤー
    DeckOut(u8),
    Other(String),
}

impl UKey {
    pub fn parse(s: &str) -> UKey {
        let (body, hash) = match s.strip_suffix('#') {
            Some(b) => (b, true),
            None => (s, false),
        };
        let parts: Vec<&str> = body.split(':').collect();
        if parts.len() == 4 {
            let n: Vec<Option<i32>> = parts.iter().map(|p| p.parse::<i32>().ok()).collect();
            if n.iter().all(|x| x.is_some()) {
                return UKey::Lim { uid: n[0].unwrap(), ep: n[1].unwrap(), face: n[2].unwrap(), idx: n[3].unwrap(), hash };
            }
        }
        match s {
            "deckOutHandled0" => UKey::DeckOut(0),
            "deckOutHandled1" => UKey::DeckOut(1),
            _ => UKey::Other(s.to_string()),
        }
    }
    pub fn to_str(&self) -> String {
        match self {
            UKey::Lim { uid, ep, face, idx, hash } => format!("{}:{}:{}:{}{}", uid, ep, face, idx, if *hash { "#" } else { "" }),
            UKey::DeckOut(p) => format!("deckOutHandled{}", p),
            UKey::Other(s) => s.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct State {
    pub cards: Vec<Card>,
    pub players: [PlayerZones; 2],
    pub limbo: Vec<i32>,
    pub turn: i32,
    pub active: PlayerId,
    pub step: Step,
    pub first: PlayerId,
    pub cont: Vec<Frame>,
    pub pool: Vec<PoolEntry>,
    pub effects: Vec<ContEffect>,
    pub turn_log: Vec<Rc<Ev>>,
    pub usage: Vec<(UKey, i64)>,
    pub pending: Option<Pending>,
    pub rans: Vec<Val>,
    pub rng: i32,
    pub seq: i32,
    pub next_pid: i32,
    pub batch_no: i32,
    pub winner: Winner,
    pub lose_reason: Option<String>,
    pub skip_turn: bool,
    pub mana_charged: bool,
    pub breaking: Vec<i32>,
    pub deck_ids: Rc<Vec<Vec<u16>>>,
    /// 定義 → その定義のカードの uid(昇順)。誘発の収集で、全カードを走査しないための索引
    pub cards_by_def: Rc<Vec<Vec<i32>>>,
    pub cfg: Rc<Cfg>,
    pub dirty_sba: bool,
    pub v: i32,
}

// ───────────────────────── 乱数(mulberry32。状態に内包) ─────────────────────────

impl State {
    /// cards の defId を書き換えた後(決定化など)は、これで索引を作り直す
    pub fn rebuild_index(&mut self, n_defs: usize) {
        let mut v: Vec<Vec<i32>> = vec![Vec::new(); n_defs];
        for (i, c) in self.cards.iter().enumerate() {
            v[c.def as usize].push(i as i32);
        }
        self.cards_by_def = Rc::new(v);
    }
    pub fn rng_next(&mut self) -> f64 {
        self.rng = self.rng.wrapping_add(0x6d2b79f5u32 as i32);
        let mut t = self.rng as u32;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    pub fn rng_int(&mut self, n: usize) -> usize {
        (self.rng_next() * n as f64).floor() as usize
    }
    pub fn next_id(&mut self) -> i32 {
        self.seq += 1;
        self.seq
    }
    pub fn usage_get(&self, k: &UKey) -> Option<i64> {
        self.usage.iter().find(|(kk, _)| kk == k).map(|(_, v)| *v)
    }
    pub fn usage_set(&mut self, k: &UKey, v: i64) {
        if let Some(e) = self.usage.iter_mut().find(|(kk, _)| kk == k) {
            e.1 = v;
        } else {
            self.usage.push((k.clone(), v));
        }
    }
    pub fn usage_del(&mut self, k: &UKey) {
        self.usage.retain(|(kk, _)| kk != k);
    }
    pub fn perm_by_pid(&self, pid: i32) -> Option<(PlayerId, usize)> {
        for p in 0..2u8 {
            for (i, perm) in self.players[p as usize].battle.iter().enumerate() {
                if perm.pid == pid {
                    return Some((p, i));
                }
            }
        }
        None
    }
    pub fn perm(&self, pid: i32) -> Option<&Perm> {
        self.perm_by_pid(pid).map(|(p, i)| &self.players[p as usize].battle[i])
    }
}

/// mulberry(JS 版 sim/playGame.ts と同じ)
pub struct Mulberry {
    a: i32,
}

impl Mulberry {
    pub fn new(seed: i32) -> Mulberry {
        Mulberry { a: seed }
    }
    pub fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5u32 as i32);
        let a = self.a;
        let mut t = (a ^ ((a as u32) >> 15) as i32).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ ((t as u32) >> 7) as i32).wrapping_mul(61 | t)) ^ t;
        (((t ^ ((t as u32) >> 14) as i32) as u32) as f64) / 4294967296.0
    }
}

/// mcts.ts の seededRand(mulberry32 の別実装。プレイアウト用)
pub struct SeededRand {
    a: u32,
    /// 対称(antithetic): 出力を 1 − u − 2^-32 に反転する(src/ai/mcts.ts の seededRand の anti)
    anti: bool,
}

impl SeededRand {
    pub fn new(seed: u32) -> SeededRand {
        SeededRand { a: seed, anti: false }
    }
    pub fn new_anti(seed: u32, anti: bool) -> SeededRand {
        SeededRand { a: seed, anti }
    }
    pub fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let mut t = self.a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        let raw = t ^ (t >> 14);
        (if self.anti { 4294967295u32 - raw } else { raw } as f64) / 4294967296.0
    }
}
