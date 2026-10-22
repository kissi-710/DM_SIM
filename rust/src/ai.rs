//! AI の一部の移植: プレイアウト(決定化 → ルールベースの手順で数ターン進める → 評価)。
//! src/ai/mcts.ts の evalRound / rollout / rolloutPick、rulebased.ts の chooseTurnAction、eval.ts、determinize.ts に対応する。

use crate::ast::R;
use crate::cond::*;
use crate::derive::*;
use crate::engine::step_owned;
use crate::json::Json;
use crate::legal::legal_actions;
use crate::registry::Registry;
use crate::state::*;
use crate::types::*;

// ───────────────────────── 評価 ─────────────────────────

#[derive(Clone, Debug)]
pub struct EvalWeights {
    pub creature: f64,
    pub power_div: f64,
    pub blocker: f64,
    pub speed_attacker: f64,
    pub stack: f64,
    pub shield: f64,
    pub hand: f64,
    pub mana: f64,
    pub hand_cost: f64,
    pub deck_out: f64,
    pub scale: f64,
    /// プレイアウトで、ターン中の行動を一様ランダムに指す確率(ε 乱択。src/ai/eval.ts の eps)
    pub eps: f64,
    /// 報酬に、途中のターンの境目の報酬の平均を混ぜる割合(src/ai/eval.ts の traj)
    pub traj: f64,
    /// 軌跡平均の、後の境目ほど軽くする比(src/ai/eval.ts の trajDecay)
    pub traj_decay: f64,
    /// 軌跡平均に、開始時点の報酬も入れる(src/ai/eval.ts の trajStart)
    pub traj_start: bool,
    /// 世界の抽出を対称にする(src/ai/eval.ts の anti)
    pub anti: bool,
    /// プレイアウトの L1: 相打ち(パワー同値)でも、相手のコスト − 自分のコスト がこの値以上なら攻撃する(99 で無効。src/ai/eval.ts の atkTrade)
    pub atk_trade: i32,
    /// 学習した価値関数(src/ai/valueModel.ts)。あれば、打ち切りの報酬はこれが返す勝つ確率になる
    pub model: Option<std::rc::Rc<ValueModel>>,
    /// 学習した召喚の方針(src/ai/l1learn.ts の choosePlayLearned)。あれば、召喚・詠唱の手は点数ではなくこの評価で選ぶ
    pub play_model: Option<std::rc::Rc<PlayModel>>,
}

impl Default for EvalWeights {
    fn default() -> Self {
        // src/ai/eval.ts の DEFAULT_WEIGHTS と同じ
        EvalWeights { creature: 3.0, power_div: 2500.0, blocker: 1.5, speed_attacker: 0.5, stack: 0.5, shield: 4.0, hand: 1.6, mana: 3.5, hand_cost: 0.05, deck_out: 3.0, scale: 30.0, eps: 0.0, traj: 1.0, traj_decay: 1.0, traj_start: false, anti: false, atk_trade: 0, model: None, play_model: None }
    }
}

impl EvalWeights {
    pub fn from_json(reg: &Registry, j: Option<&Json>) -> EvalWeights {
        let mut w = EvalWeights::default();
        if let Some(Json::Obj(o)) = j {
            for (k, v) in o {
                let x = match v.as_f64() {
                    Some(x) => x,
                    None => continue,
                };
                match k.as_str() {
                    "creature" => w.creature = x,
                    "powerDiv" => w.power_div = x,
                    "blocker" => w.blocker = x,
                    "speedAttacker" => w.speed_attacker = x,
                    "stack" => w.stack = x,
                    "shield" => w.shield = x,
                    "hand" => w.hand = x,
                    "mana" => w.mana = x,
                    "handCost" => w.hand_cost = x,
                    "deckOut" => w.deck_out = x,
                    "scale" => w.scale = x,
                    "eps" => w.eps = x,
                    "traj" => w.traj = x,
                    "trajDecay" => w.traj_decay = x,
                    "trajStart" => w.traj_start = x > 0.0,
                    "anti" => w.anti = x > 0.0,
                    "atkTrade" => w.atk_trade = x as i32,
                    _ => {}
                }
            }
            if let Some(m) = o.iter().find(|(k, _)| k == "model").map(|(_, v)| v) {
                w.model = Some(std::rc::Rc::new(ValueModel::from_json(reg, m)));
            }
            if let Some(m) = o.iter().find(|(k, _)| k == "playModel").map(|(_, v)| v) {
                w.play_model = PlayModel::from_json(reg, m).map(std::rc::Rc::new);
            }
        }
        w
    }
}

fn side(e: Env, p: PlayerId, w: &EvalWeights) -> f64 {
    let z = &e.s.players[p as usize];
    let mut v = 0.0;
    for perm in &z.battle {
        let power = power_of(e, perm) as f64;
        v += w.creature + power / w.power_div;
        if has_keyword(e, perm, Kw::Blocker) {
            v += w.blocker;
        }
        if has_keyword(e, perm, Kw::SpeedAttacker) {
            v += w.speed_attacker;
        }
        v += ((perm.cards.len() as f64) - 1.0).min(1.0) * w.stack;
    }
    v += z.shield.len() as f64 * w.shield;
    v += z.hand.len() as f64 * w.hand;
    v += (z.mana.len().min(10)) as f64 * w.mana;
    for &u in &z.hand {
        let cost = chars_lite(e, u, -1).cost;
        if cost < 99 {
            v += (cost.min(8)) as f64 * w.hand_cost;
        }
    }
    // 山札が尽きそうなら不利
    if z.deck.len() < 4 {
        v -= (4 - z.deck.len()) as f64 * w.deck_out;
    }
    v
}

pub fn evaluate(e: Env, me: PlayerId, w: &EvalWeights) -> f64 {
    match e.s.winner {
        Winner::Draw => return 0.0,
        Winner::P(p) => return if p == me { 1000.0 } else { -1000.0 },
        Winner::None => {}
    }
    side(e, me, w) - side(e, opp(me), w)
}

/// 評価を 0〜1 の報酬に写す(勝敗は 1/0/0.5)
pub fn reward(e: Env, me: PlayerId, w: &EvalWeights) -> f64 {
    crate::prof!(4);
    match e.s.winner {
        Winner::Draw => return 0.5,
        Winner::P(p) => return if p == me { 1.0 } else { 0.0 },
        Winner::None => {}
    }
    if let Some(m) = &w.model {
        return model_prob(e, me, m);
    }
    0.5 + 0.5 * (evaluate(e, me, w) / w.scale).tanh()
}

// ───────────────────────── 学習した価値関数(src/ai/valueModel.ts と同じ式) ─────────────────────────

pub const N_BASE: usize = 20;
const BASE_NAMES: [&str; N_BASE] = [
    "creatures",
    "power",
    "blockersUp",
    "blockersAll",
    "speedAttackers",
    "stacked",
    "tapped",
    "sick",
    "breakers",
    "shields",
    "shieldLow",
    "hand",
    "handCost",
    "handPlayable",
    "mana1",
    "mana2",
    "mana3",
    "manaCivs",
    "grave",
    "deckLow",
];

#[derive(Clone, Debug)]
pub struct ValueModel {
    pub base: [f64; N_BASE],
    pub tempo: f64,
    /// 定義の添字 → バトルゾーン1枚あたりの重み
    pub battle: Vec<f64>,
    /// 定義の添字 → 手札1枚あたりの重み
    pub hand: Vec<f64>,
}

impl ValueModel {
    pub fn from_json(reg: &Registry, j: &Json) -> ValueModel {
        let mut base = [0.0; N_BASE];
        if let Some(Json::Obj(o)) = j.get("base") {
            for (k, v) in o {
                if let (Some(i), Some(x)) = (BASE_NAMES.iter().position(|n| n == k), v.as_f64()) {
                    base[i] = x;
                }
            }
        }
        let cards = |key: &str| -> Vec<f64> {
            let mut out = vec![0.0; reg.defs.len()];
            if let Some(Json::Obj(o)) = j.get(key) {
                for (k, v) in o {
                    if let (Some(d), Some(x)) = (reg.def_index(k), v.as_f64()) {
                        out[d as usize] = x;
                    }
                }
            }
            out
        };
        ValueModel { base, tempo: j.get("tempo").and_then(|x| x.as_f64()).unwrap_or(0.0), battle: cards("battle"), hand: cards("hand") }
    }
}

fn bump(v: &mut Vec<(u16, f64)>, d: u16, by: f64) {
    match v.iter_mut().find(|(k, _)| *k == d) {
        Some(e) => e.1 += by,
        None => v.push((d, by)),
    }
}

/// プレイヤー p の基本の特徴量を f に足し(± sign)、カードごとの枚数を battle・hand に足す
fn side_features(e: Env, p: PlayerId, f: &mut [f64; N_BASE], battle: &mut Vec<(u16, f64)>, hand: &mut Vec<(u16, f64)>, sign: f64) {
    let s = e.s;
    let z = &s.players[p as usize];
    let mut blockers_up = 0.0;
    let mut blockers_all = 0.0;
    let mut sa = 0.0;
    let mut stacked = 0.0;
    let mut tapped = 0.0;
    let mut sick = 0.0;
    let mut breakers = 0.0;
    let mut power = 0.0;
    for perm in &z.battle {
        power += (power_of(e, perm).min(15000) as f64) / 1000.0;
        if can_block(e, perm) {
            blockers_up += 1.0;
        }
        if has_keyword(e, perm, Kw::Blocker) {
            blockers_all += 1.0;
        }
        if has_keyword(e, perm, Kw::SpeedAttacker) {
            sa += 1.0;
        }
        if perm.cards.len() > 1 {
            stacked += 1.0;
        }
        if perm.tapped {
            tapped += 1.0;
        }
        if is_sick(e, perm) {
            sick += 1.0;
        }
        breakers += breaker_count(e, perm) as f64;
        bump(battle, s.cards[perm.cards[0] as usize].def, sign);
    }
    let mana_n = z.mana.len() as i32;
    let mut hand_cost = 0.0;
    let mut playable = 0.0;
    for &u in &z.hand {
        let cost = chars_lite(e, u, -1).cost;
        if cost < 99 {
            hand_cost += cost.min(8) as f64;
            if cost <= mana_n {
                playable += 1.0;
            }
        }
        bump(hand, s.cards[u as usize].def, sign);
    }
    let mut civs = 0u32;
    for &m in &z.mana {
        for cv in chars_lite(e, m, -1).civs {
            civs |= 1 << (*cv as u32);
        }
    }
    let mut add = |i: usize, v: f64| f[i] += sign * v;
    add(0, z.battle.len() as f64);
    add(1, power);
    add(2, blockers_up);
    add(3, blockers_all);
    add(4, sa);
    add(5, stacked);
    add(6, tapped);
    add(7, sick);
    add(8, breakers);
    add(9, z.shield.len() as f64);
    add(10, (3 - z.shield.len() as i32).max(0) as f64);
    add(11, z.hand.len() as f64);
    add(12, hand_cost);
    add(13, playable);
    add(14, mana_n.min(4) as f64);
    add(15, (mana_n - 4).max(0).min(3) as f64);
    add(16, (mana_n - 7).max(0).min(3) as f64);
    add(17, civs.count_ones() as f64);
    add(18, z.grave.len().min(10) as f64);
    add(19, (4 - z.deck.len() as i32).max(0) as f64);
}

/// me が勝つ確率の見積もり(決着していない盤面)
pub fn model_prob(e: Env, me: PlayerId, m: &ValueModel) -> f64 {
    let mut f = [0.0; N_BASE];
    let mut battle: Vec<(u16, f64)> = Vec::new();
    let mut hand: Vec<(u16, f64)> = Vec::new();
    side_features(e, me, &mut f, &mut battle, &mut hand, 1.0);
    side_features(e, opp(me), &mut f, &mut battle, &mut hand, -1.0);
    let mut z = if e.s.active == me { m.tempo } else { -m.tempo };
    for i in 0..N_BASE {
        z += m.base[i] * f[i];
    }
    for (d, n) in &battle {
        z += m.battle[*d as usize] * n;
    }
    for (d, n) in &hand {
        z += m.hand[*d as usize] * n;
    }
    1.0 / (1.0 + (-z).exp())
}

// ───────────────────────── ルールベースの手の選択(ターン中の行動) ─────────────────────────

// プレイアウトの方針の調整値(EvalWeights から、ラウンドの評価の入口で設定する。WASM は単一スレッド)
thread_local! {
    static ATK_TRADE: std::cell::Cell<i32> = std::cell::Cell::new(0);
    static PLAY_MODEL: std::cell::RefCell<Option<std::rc::Rc<PlayModel>>> = std::cell::RefCell::new(None);
}

fn apply_policy(w: &EvalWeights) {
    ATK_TRADE.with(|c| c.set(w.atk_trade));
    PLAY_MODEL.with(|c| *c.borrow_mut() = w.play_model.clone());
}

// ───────────────────────── 学習した召喚の方針(src/ai/l1learn.ts の choosePlayLearned と同じ式) ─────────────────────────
// 特徴量のブロックの位置は l1learn.ts の B_PLAY / N_ATTR / B_ID と同じ。重みの長さは B_ID + 3 × (カード別の添字の数)。

const PL_N_ATTR: usize = 13;
const PL_B_PLAY: usize = 27;
const PL_B_ID: usize = 81;

#[derive(Clone, Debug)]
pub struct PlayModel {
    w: Vec<f64>,
    /// 定義の添字 → カード別のブロックの添字(無ければ -1)。l1learn.ts の defIndex と同じ並び(id の昇順。?・dummy・blank は除く)
    id_of_def: Vec<i32>,
    n_ids: usize,
}

impl PlayModel {
    pub fn from_json(reg: &Registry, j: &Json) -> Option<PlayModel> {
        let w: Vec<f64> = j.as_arr()?.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect();
        let mut ids: Vec<(usize, &String)> = reg.ids.iter().enumerate().filter(|(_, id)| id.as_str() != "?" && id.as_str() != "dummy" && !id.starts_with("blank") && !id.starts_with("dm26sd1-")).collect();
        ids.sort_by(|a, b| a.1.cmp(b.1));
        if w.len() != PL_B_ID + 3 * ids.len() {
            return None;
        }
        let mut id_of_def = vec![-1i32; reg.ids.len()];
        for (k, (d, _)) in ids.iter().enumerate() {
            id_of_def[*d] = k as i32;
        }
        Some(PlayModel { w, id_of_def, n_ids: ids.len() })
    }
}

/// 召喚・詠唱の手 1 つの学習した評価(l1learn.ts の features の PLAY_CARD と dot を、添字の昇順で足す)
fn learned_play_score(e: Env, pm: &PlayModel, uid: i32, from: Option<Zone>, face: Option<i32>, extra: &Option<PlayExtra>, me: PlayerId) -> f64 {
    let s = e.s;
    let card = &s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let fi = face.unwrap_or(0);
    let f = &def.faces[fi as usize];
    let taps_v: Vec<i32> = extra.as_ref().and_then(|x| x.tap.clone()).unwrap_or_default();
    let cost = cost_of(e, uid, fi, &taps_v, false);
    let ch = chars_lite(e, uid, -1);
    let info = e.reg.info(card.def, ch.face_idx);
    let w = &pm.w;
    let mut z = 0.0f64;
    z += w[PL_B_PLAY];
    let a = PL_B_PLAY + 1;
    z += w[a] * (ch.cost.min(12) as f64 / 10.0);
    if ch.face.ty == FaceType::Spell {
        z += w[a + 1];
    }
    if !info.shield_triggers.is_empty() {
        z += w[a + 2];
    }
    if info.blocker {
        z += w[a + 3];
    }
    if info.speed_attacker {
        z += w[a + 4];
    }
    z += w[a + 5] * (ch.face.power.unwrap_or(0) as f64 / 10000.0);
    let mut civ_mask = 0u32;
    for cv in ch.civs {
        civ_mask |= 1 << (*cv as u32);
    }
    if civ_mask.count_ones() > 1 {
        z += w[a + 6];
    }
    if ch.face.ty != FaceType::Spell {
        z += w[a + 7];
    }
    for i in 0..5usize {
        if civ_mask & (1 << i) != 0 {
            z += w[a + 8 + i];
        }
    }
    let at = a + PL_N_ATTR;
    let o = opp(me);
    let untapped = s.players[me as usize].mana.iter().filter(|&&m| !s.cards[m as usize].tapped).count() as i32;
    let opp_creatures = s.players[o as usize].battle.len() as f64;
    z += w[at] * (pay_need(cost, f.civs.len() as i32) as f64 / 5.0);
    z += w[at + 1] * ((f.cost - cost) as f64 / 5.0);
    z += w[at + 2] * (taps_v.len() as f64 / 3.0);
    if from.unwrap_or(Zone::Hand) != Zone::Hand {
        z += w[at + 3];
    }
    if f.ty == FaceType::Spell && s.players[o as usize].battle.is_empty() && f.needs_opp_creature {
        z += w[at + 4];
    }
    z += w[at + 5] * ((untapped - cost) as f64 / 10.0);
    z += w[at + 6] * (s.players[me as usize].battle.len() as f64 / 5.0);
    z += w[at + 7] * (opp_creatures / 5.0);
    z += w[at + 8] * (s.players[o as usize].shield.len() as f64 / 5.0);
    if f.ty == FaceType::Spell {
        z += w[at + 9] * (opp_creatures / 5.0);
    }
    let di = pm.id_of_def[card.def as usize];
    if di >= 0 {
        z += w[PL_B_ID + pm.n_ids + di as usize];
    }
    z
}

fn play_model() -> Option<std::rc::Rc<PlayModel>> {
    PLAY_MODEL.with(|c| c.borrow().clone())
}

fn keep_score(e: Env, uid: i32, me: PlayerId) -> f64 {
    let s = e.s;
    let card = &s.cards[uid as usize];
    let ch = chars_lite(e, uid, -1);
    let mana_n = s.players[me as usize].mana.len() as i32;
    let mut v: f64 = if ch.cost <= mana_n + 2 { 4.5 } else { 3.0 };
    v -= ch.cost as f64 * 0.15;
    if ch.cost <= mana_n {
        v -= 0.5; // 今でも使えるカードは、先にマナへ回してよい
    }
    let info = e.reg.info(card.def, ch.face_idx);
    if !info.shield_triggers.is_empty() {
        v -= 2.0;
    }
    let mut have: Vec<Civ> = Vec::new();
    for &m in &s.players[me as usize].mana {
        for cv in crate::derive::mana_civs(e, m) {
            if !have.contains(cv) {
                have.push(*cv);
            }
        }
    }
    let mut need: Vec<Civ> = Vec::new();
    for &h in &s.players[me as usize].hand {
        if h == uid {
            continue;
        }
        for cv in crate::derive::mana_civs(e, h) {
            if !have.contains(cv) && !need.contains(cv) {
                need.push(*cv);
            }
        }
    }
    // 手札の他のカードが必要とする文明は、マナに足せるなら置きたい。マナにない文明を足すのも良い
    for cv in ch.civs {
        if need.contains(cv) {
            v -= 3.0;
        }
        if !have.contains(cv) {
            v -= 1.0;
        }
    }
    // 同じカードが複数あれば1枚は置いてよい
    let dup = s.players[me as usize].hand.iter().filter(|&&h| s.cards[h as usize].def == card.def).count();
    if dup > 1 {
        v -= 1.0;
    }
    v += if ch.face.ty == FaceType::Spell { -1.0 } else { 1.0 };
    v
}

fn play_score(e: Env, uid: i32, from: Option<Zone>, face: Option<i32>, extra: &Option<PlayExtra>, me: PlayerId) -> f64 {
    let s = e.s;
    let card = &s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let fi = face.unwrap_or(0);
    let f = &def.faces[fi as usize];
    let taps_v: Vec<i32> = extra.as_ref().and_then(|x| x.tap.clone()).unwrap_or_default();
    let taps = taps_v.len() as f64;
    let cost = cost_of(e, uid, fi, &taps_v, false);
    let mut v = pay_need(cost, f.civs.len() as i32) as f64 * 1.0 + taps * 0.0 + (f.cost - cost) as f64 * 0.4;
    if f.ty != FaceType::Spell {
        v += 1.5; // 盤面に残るものを優先
    }
    // タップする分、攻撃できる数が減る
    v -= taps * 0.8;
    // 墓地・マナからのプレイは手札を使わないので、同じコストなら少し優先
    if from.unwrap_or(Zone::Hand) != Zone::Hand {
        v += 0.5;
    }
    // 呪文は、対象がいなくて空振りしやすいものを避ける(相手の盤面が空)
    if f.ty == FaceType::Spell {
        let o = opp(me);
        if s.players[o as usize].battle.is_empty() && f.needs_opp_creature {
            v -= 3.0;
        }
    }
    v
}

/// マナがこの枚数以上で、手札を全部払えるなら、マナチャージをしない
const SKIP_MANA_FROM: usize = 7;

pub fn choose_turn_action(e: Env, legal: &[Action], me: PlayerId) -> usize {
    crate::prof!(23);
    let s = e.s;
    let o = opp(me);
    // マナチャージ
    let charges: Vec<usize> = legal.iter().enumerate().filter(|(_, a)| matches!(a, Action::ChargeMana(_))).map(|(i, _)| i).collect();
    if !charges.is_empty() {
        // マナが十分にあり、手札のどのカードも払えるなら、これ以上マナを増やしても使い道がない(カードを手札に残す)
        let skip = legal.iter().position(|a| matches!(a, Action::SkipMana));
        let mana_n = s.players[me as usize].mana.len();
        if let Some(sk) = skip {
            if mana_n >= SKIP_MANA_FROM {
                let mut max_cost = 0;
                for &u in &s.players[me as usize].hand {
                    let cost = chars_lite(e, u, -1).cost;
                    if cost < 99 {
                        max_cost = max_cost.max(cost);
                    }
                }
                if mana_n as i32 >= max_cost {
                    return sk;
                }
            }
        }
        let mut best = charges[0];
        let mut bs = f64::INFINITY;
        for &i in &charges {
            if let Action::ChargeMana(u) = &legal[i] {
                let sc = keep_score(e, *u, me);
                if sc < bs {
                    bs = sc;
                    best = i;
                }
            }
        }
        return best;
    }
    // 召喚を先に行う
    let mut best_play: Option<usize> = None;
    let mut bs = f64::NEG_INFINITY;
    let pm = play_model();
    for (i, a) in legal.iter().enumerate() {
        if let Action::PlayCard { uid, from, face, extra } = a {
            let sc = match &pm {
                Some(m) => learned_play_score(e, m, *uid, *from, *face, extra, me),
                None => play_score(e, *uid, *from, *face, extra, me),
            };
            if best_play.is_none() || sc > bs {
                bs = sc;
                best_play = Some(i);
            }
        }
    }
    if let Some(i) = best_play {
        return i;
    }
    // クロスギア(まだどのクリーチャーにもクロスしていないもの)は、クロスする。ハイパー化できるなら、攻撃の前にハイパー化する
    let mine = &s.players[me as usize].battle;
    let cross = legal.iter().position(|a| {
        matches!(a, Action::Cross { gear, target }
            if mine.iter().any(|x| x.pid == *gear && x.crossed_on.is_none()) && !mine.iter().any(|x| x.crossed_on == Some(*target)))
    });
    if let Some(i) = cross {
        return i;
    }
    if let Some(i) = legal.iter().position(|a| matches!(a, Action::Hyperize { .. })) {
        return i;
    }
    // 攻撃の評価
    let attacks: Vec<usize> = legal.iter().enumerate().filter(|(_, a)| matches!(a, Action::Attack { .. })).map(|(i, _)| i).collect();
    if !attacks.is_empty() {
        let opp_blockers: Vec<&Perm> = s.players[o as usize].battle.iter().filter(|p| can_block(e, p)).collect();
        let max_block = opp_blockers.iter().map(|p| power_of(e, p)).fold(0, |m, x| m.max(x));
        let opp_shield = s.players[o as usize].shield.len() as i32;
        let my_shield = s.players[me as usize].shield.len() as i32;
        // 勝ちが確定する攻撃(S・トリガーは考えない)。ブロッカーに止められない攻撃のうち、
        // 最後の1体(ダイレクトアタック役。ブレイク数の最小のもの)を除いたブレイク数が、シールド以上
        let mine: Vec<&Perm> = s.players[me as usize]
            .battle
            .iter()
            .filter(|p| attacks.iter().any(|&i| matches!(&legal[i], Action::Attack { attacker, target: Target::Player } if *attacker == p.pid)))
            .collect();
        // (ブレイク数, pid, ブロックされないか)
        let mut by_breaks: Vec<(i32, i32, bool)> = mine.iter().map(|p| (breaker_count(e, p), p.pid, is_unblockable(e, p))).collect();
        by_breaks.sort_by(|x, y| y.0.cmp(&x.0)); // 安定(ブレイク数の多い順)
        // ブロックされるのは、ブロックされない攻撃を除き、ブレイク数の多い順(ブロッカー1体で1回だけ止められる)
        let nb = opp_blockers.len();
        let mut through: Vec<(i32, i32)> = by_breaks.iter().filter(|x| x.2).map(|x| (x.0, x.1)).collect();
        through.extend(by_breaks.iter().filter(|x| !x.2).skip(nb).map(|x| (x.0, x.1)));
        if !through.is_empty() {
            let sum: i32 = through.iter().map(|x| x.0).sum();
            let last = through.iter().map(|x| x.0).min().unwrap_or(0);
            if opp_shield == 0 || (through.len() >= 2 && sum - last >= opp_shield) {
                // 先にブレイク数の多いものから攻撃し、最後の1体を残す(攻撃のたびに、この判定をやり直す)
                through.sort_by(|x, y| y.0.cmp(&x.0));
                let lethal_pid = through[0].1;
                if let Some(i) = attacks.iter().copied().find(|&i| matches!(&legal[i], Action::Attack { attacker, target: Target::Player } if *attacker == lethal_pid)) {
                    return i;
                }
            }
        }
        let mut best: Option<usize> = None;
        let mut bsc = 0.0f64;
        for &i in &attacks {
            if let Action::Attack { attacker, target } = &legal[i] {
                let pm = match s.players[me as usize].battle.iter().find(|p| p.pid == *attacker) {
                    Some(p) => p,
                    None => continue,
                };
                let pa = power_of(e, pm);
                let mut score = -1.0f64;
                match target {
                    Target::Player => {
                        let breakers = breaker_count(e, pm);
                        // 「ブロックされない」攻撃は、相手のブロッカーに止められない
                        let no_blockers = opp_blockers.is_empty() || is_unblockable(e, pm);
                        if opp_shield == 0 && no_blockers {
                            score = 100.0;
                        } else if no_blockers {
                            score = 20.0 + breakers as f64;
                        } else if max_block < pa {
                            score = 12.0 + breakers as f64; // ブロックされても負けない
                        } else if opp_shield == 0 {
                            score = 8.0; // ブロッカーを引きつける
                        }
                        // 自分のブロッカーは、シールドが少ない時は残す
                        if has_keyword(e, pm, Kw::Blocker) && my_shield <= 3 && score < 100.0 {
                            score = -1.0;
                        }
                    }
                    Target::Creature(tpid) => {
                        if let Some(tp) = s.players[o as usize].battle.iter().find(|p| p.pid == *tpid) {
                            let pt = power_of(e, tp);
                            let tcost = chars_lite(e, tp.cards[0], -1).cost;
                            if pa > pt {
                                score = 30.0 + (tcost.min(12)) as f64 + pt as f64 / 2000.0;
                            } else if pa == pt && tcost - chars_lite(e, pm.cards[0], -1).cost >= ATK_TRADE.with(|c| c.get()) {
                                score = 20.0 + (tcost.min(12)) as f64;
                            }
                            if has_keyword(e, pm, Kw::Blocker) && score > 0.0 && my_shield <= 3 {
                                score -= 8.0;
                            }
                        }
                    }
                }
                if score > bsc {
                    bsc = score;
                    best = Some(i);
                }
            }
        }
        if let Some(i) = best {
            return i;
        }
    }
    if let Some(i) = legal.iter().position(|a| matches!(a, Action::EndTurn)) {
        return i;
    }
    legal
        .iter()
        .position(|a| matches!(a, Action::EndMain))
        .or_else(|| legal.iter().position(|a| matches!(a, Action::SkipMana)))
        .unwrap_or(0)
}

// ───────────────────────── プレイアウト ─────────────────────────

/// プレイアウト1回の手数の上限(src/ai/mcts.ts の MAX_ROLLOUT_STEPS と同じ)
const MAX_ROLLOUT_STEPS: i32 = 4000;

fn answer_len(a: &Action) -> i32 {
    match a {
        Action::Answer { value: Val::List(l), .. } => l.len() as i32,
        _ => 0,
    }
}

/// プレイアウト用の素早い方針: ターン中の行動は L1 の手順、効果の選択は軽い規則
pub fn rollout_pick(e: Env, legal: &[Action], rand: &mut SeededRand) -> usize {
    crate::prof!(2);
    let p = e.s.pending.as_ref().unwrap();
    if p.why == Why::TurnAction {
        return choose_turn_action(e, legal, p.player);
    }
    let pick = |n: usize, rand: &mut SeededRand| (rand.next() * n as f64).floor() as usize;
    match p.why {
        Why::TriggerDeclare => {
            // S・トリガーは宣言できるだけ宣言する
            let mut best = 0;
            let mut bl = -1;
            for (i, a) in legal.iter().enumerate() {
                let n = answer_len(a);
                if n > bl {
                    bl = n;
                    best = i;
                }
            }
            best
        }
        Why::May => {
            let yes = legal.iter().position(|a| matches!(a, Action::Answer { value: Val::Bool(true), .. }));
            if yes.is_some() {
                return match yes {
                    Some(i) if rand.next() < 0.75 => i,
                    _ => pick(legal.len(), rand),
                };
            }
            // 「使うか + 対象」を1問にした形(pick。空 = 使わない): 従来の はい/いいえ と同じ、約 7/8 で使う
            let uses: Vec<usize> = legal.iter().enumerate().filter(|(_, a)| answer_len(a) > 0).map(|(i, _)| i).collect();
            if uses.is_empty() {
                return pick(legal.len(), rand);
            }
            if rand.next() < 0.875 {
                uses[pick(uses.len(), rand)]
            } else {
                legal.iter().position(|a| matches!(a, Action::Answer { value: Val::List(l), .. } if l.is_empty())).unwrap_or(uses[0])
            }
        }
        Why::Block => {
            // 半分はブロックする。複数体のブロッカーを選ぶと、余分にタップするだけで損なので、1体の選択を優先する(507.1a)
            let blocks: Vec<usize> = legal.iter().enumerate().filter(|(_, a)| matches!(a, Action::Answer { value: Val::List(l), .. } if !l.is_empty())).map(|(i, _)| i).collect();
            let single: Vec<usize> = blocks.iter().copied().filter(|&i| answer_len(&legal[i]) == 1).collect();
            let pool: &Vec<usize> = if single.is_empty() { &blocks } else { &single };
            if !pool.is_empty() && rand.next() < 0.5 {
                pool[pick(pool.len(), rand)]
            } else {
                0
            }
        }
        _ => pick(legal.len(), rand),
    }
}

/// ターン中の行動(turnAction)について、legal_actions を作ってから choose_turn_action で選んだ手と同じ手を、
/// 必要な分だけ列挙して返す。マナのステップでは charges だけ、メインでは使えるカードがあればそれだけを調べる。
fn fast_turn_action(e: Env, me: PlayerId) -> Action {
    use crate::legal::{attack_actions, play_actions};
    let s = e.s;
    if s.step == Step::Mana {
        let mut legal: Vec<Action> = Vec::new();
        if !s.mana_charged {
            let mut seen: Vec<u16> = Vec::new();
            for &u in &s.players[me as usize].hand {
                let d = s.cards[u as usize].def;
                if !seen.contains(&d) {
                    seen.push(d);
                    legal.push(Action::ChargeMana(u));
                }
            }
        }
        legal.push(Action::SkipMana);
        let i = choose_turn_action(e, &legal, me);
        return legal.swap_remove(i);
    }
    if s.step == Step::Main {
        let plays = play_actions(e, me);
        if !plays.is_empty() {
            let mut best = 0usize;
            let mut bs = f64::NEG_INFINITY;
            let pm = play_model();
            for (i, a) in plays.iter().enumerate() {
                if let Action::PlayCard { uid, from, face, extra } = a {
                    let sc = match &pm {
                        Some(m) => learned_play_score(e, m, *uid, *from, *face, extra, me),
                        None => play_score(e, *uid, *from, *face, extra, me),
                    };
                    if i == 0 || sc > bs {
                        bs = sc;
                        best = i;
                    }
                }
            }
            let mut plays = plays;
            return plays.swap_remove(best);
        }
    }
    // 使えるカードが無い: クロス・ハイパー化(メインだけ)と攻撃(メインでは END_MAIN が先に並ぶが、選択には影響しない)
    let mut legal: Vec<Action> = Vec::new();
    if s.step == Step::Main {
        legal.extend(crate::legal::hyperize_actions(e, me));
        legal.extend(crate::legal::cross_actions(e, me));
    }
    legal.extend(attack_actions(e, me));
    legal.push(Action::EndTurn);
    let i = choose_turn_action(e, &legal, me);
    legal.swap_remove(i)
}

/// 状態 start から、horizon ターン先(または決着)まで進めて報酬を返す。エンジンの例外は Err。
pub fn rollout(reg: &Registry, start: State, me: PlayerId, rand: &mut SeededRand, horizon: i32, w: &EvalWeights) -> Result<f64, String> {
    crate::prof!(1);
    let mut st = start;
    let end_turn = st.turn + horizon;
    let mut guard = 0;
    // 軌跡平均(src/ai/mcts.ts の rollout と同じ)
    let mut acc = 0.0;
    let mut wsum = 0.0;
    let mut wt = 1.0;
    let mut cnt = 0u32;
    let mut last_turn = st.turn;
    if w.traj > 0.0 && w.traj_start && st.winner == Winner::None {
        acc += wt * reward(Env { s: &st, reg }, me, w);
        wsum += wt;
        wt *= w.traj_decay;
        cnt += 1;
    }
    while st.winner == Winner::None && st.turn < end_turn {
        guard += 1;
        if guard > MAX_ROLLOUT_STEPS {
            break;
        }
        let pending = match &st.pending {
            Some(p) => p,
            None => break,
        };
        let action = if pending.why == Why::TurnAction {
            if w.eps > 0.0 && rand.next() < w.eps {
                // ε 乱択: 一様ランダムな手
                let mut legal = legal_actions(&st, reg);
                if legal.is_empty() {
                    break;
                }
                let i = (rand.next() * legal.len() as f64).floor() as usize;
                legal.swap_remove(i)
            } else {
                fast_turn_action(Env { s: &st, reg }, pending.player)
            }
        } else {
            let mut legal = legal_actions(&st, reg);
            if legal.is_empty() {
                break;
            }
            let i = rollout_pick(Env { s: &st, reg }, &legal, rand);
            legal.swap_remove(i)
        };
        st = step_owned(reg, st, &action)?;
        if w.traj > 0.0 && st.turn != last_turn && st.turn < end_turn && st.winner == Winner::None {
            last_turn = st.turn;
            acc += wt * reward(Env { s: &st, reg }, me, w);
            wsum += wt;
            wt *= w.traj_decay;
            cnt += 1;
        }
    }
    let fin = reward(Env { s: &st, reg }, me, w);
    if w.traj > 0.0 && cnt > 0 {
        return Ok((1.0 - w.traj) * fin + w.traj * ((acc + wt * fin) / (wsum + wt)));
    }
    Ok(fin)
}

// ───────────────────────── 決定化 ─────────────────────────

pub struct Policy {
    pub preset: String,
    pub hypotheses: Vec<(u16, String)>,
    pub hypothesis_weight: f64,
}

pub struct SearchEnv {
    pub view: State,
    pub legal: Vec<Action>,
    pub me: PlayerId,
    pub policy: Policy,
    pub opp_hand_kinds: Option<Vec<(String, i32)>>,
    /// 山札の中で中身が公開された札のまとまり(ヨビニオンで山札の下に戻した札)。プレイヤーごとに (山札の位置の uid, 中身)
    pub deck_known: [Vec<(Vec<i32>, Vec<u16>)>; 2],
    pub candidate_decks: Vec<Vec<u16>>,
    pub horizon: i32,
    pub weights: EvalWeights,
}

impl SearchEnv {
    pub fn from_json(reg: &Registry, j: &Json) -> R<SearchEnv> {
        let view_j = j.get("view").ok_or("view がありません")?;
        let view = state_from_json(reg, view_j)?;
        let legal = j
            .get("legal")
            .and_then(|l| l.as_arr())
            .ok_or("legal がありません")?
            .iter()
            .map(|a| action_from_json(reg, a))
            .collect::<R<Vec<_>>>()?;
        let pj = j.get("policy");
        let mut hypotheses = Vec::new();
        if let Some(h) = pj.and_then(|p| p.get("hypotheses")).and_then(|h| h.as_arr()) {
            for x in h {
                let id = x.get("defId").and_then(|d| d.as_str()).unwrap_or("");
                let zone = x.get("zone").and_then(|z| z.as_str()).unwrap_or("hand").to_string();
                if let Some(d) = reg.def_index(id) {
                    hypotheses.push((d, zone));
                }
            }
        }
        let policy = Policy {
            preset: pj.and_then(|p| p.get("preset")).and_then(|x| x.as_str()).unwrap_or("fair").to_string(),
            hypotheses,
            hypothesis_weight: pj.and_then(|p| p.get("hypothesisWeight")).and_then(|x| x.as_f64()).unwrap_or(0.7),
        };
        let opp_hand_kinds = match view_j.get("hints").and_then(|h| h.get("oppHandKinds")) {
            Some(Json::Obj(o)) => Some(o.iter().map(|(k, v)| (k.clone(), v.as_i64().unwrap_or(0) as i32)).collect()),
            _ => None,
        };
        let mut deck_known: [Vec<(Vec<i32>, Vec<u16>)>; 2] = [Vec::new(), Vec::new()];
        if let Some(Json::Arr(per_player)) = view_j.get("hints").and_then(|h| h.get("deckKnown")) {
            for (p, groups) in per_player.iter().take(2).enumerate() {
                for g in groups.as_arr().ok_or("deckKnown")? {
                    let uids = g.get("uids").and_then(|u| u.as_arr()).ok_or("deckKnown.uids")?;
                    let defs = g.get("defIds").and_then(|u| u.as_arr()).ok_or("deckKnown.defIds")?;
                    let uids: Vec<i32> = uids.iter().map(|u| u.as_i64().unwrap_or(-1) as i32).collect();
                    let mut ds = Vec::new();
                    for d in defs {
                        ds.push(reg.def_index(d.as_str().unwrap_or("")).ok_or("未知のカード")?);
                    }
                    deck_known[p].push((uids, ds));
                }
            }
        }
        let mut candidate_decks = Vec::new();
        if let Some(Json::Arr(ds)) = j.get("candidateDecks") {
            for d in ds {
                let mut v = Vec::new();
                for id in d.as_arr().ok_or("candidateDecks")? {
                    v.push(reg.def_index(id.as_str().unwrap_or("")).ok_or("未知のカード")?);
                }
                candidate_decks.push(v);
            }
        }
        Ok(SearchEnv {
            view,
            legal,
            me: j.get("me").and_then(|x| x.as_i64()).ok_or("me がありません")? as u8,
            policy,
            opp_hand_kinds,
            deck_known,
            candidate_decks,
            horizon: j.get("horizon").and_then(|x| x.as_i64()).unwrap_or(3) as i32,
            weights: EvalWeights::from_json(reg, j.get("weights")),
        })
    }
}

fn shuffled(arr: &[u16], rand: &mut SeededRand) -> Vec<u16> {
    let mut a = arr.to_vec();
    let mut i = a.len();
    while i > 1 {
        i -= 1;
        let j = (rand.next() * (i + 1) as f64).floor() as usize;
        a.swap(i, j);
    }
    a
}

fn subtract_known(list: &[u16], known: &[u16]) -> Vec<u16> {
    let mut rest = list.to_vec();
    for k in known {
        if let Some(i) = rest.iter().position(|x| x == k) {
            rest.remove(i);
        }
    }
    rest
}

pub fn kinds_of(reg: &Registry, def: u16) -> Vec<&'static str> {
    let d = &reg.defs[def as usize];
    let mut out: Vec<&'static str> = Vec::new();
    for (fi, f) in d.faces.iter().enumerate() {
        let k = match f.ty {
            FaceType::Spell => "spell",
            FaceType::Castle => "castle",
            _ => "creature",
        };
        if !out.contains(&k) {
            out.push(k);
        }
        let info = reg.info(def, fi as i32);
        if !info.shield_triggers.is_empty() && !out.contains(&"shieldTrigger") {
            out.push("shieldTrigger");
        }
        if info.blocker && !out.contains(&"blocker") {
            out.push("blocker");
        }
        if info.speed_attacker && !out.contains(&"speedAttacker") {
            out.push("speedAttacker");
        }
    }
    out
}

/// 決定化: 隠れたカード('?')に、あり得る中身を割り当てて、実際に進められる状態を作る
pub fn determinize(reg: &Registry, env: &SearchEnv, rand: &mut SeededRand, q_def: u16) -> State {
    crate::prof!(3);
    let view = &env.view;
    let me = env.me;
    let opp_p = opp(me);
    let mut s = view.clone();
    let known_of = |s: &State, p: PlayerId| -> Vec<u16> { s.cards.iter().filter(|c| c.owner == p && c.def != q_def).map(|c| c.def).collect() };
    let unknown_of = |s: &State, p: PlayerId| -> Vec<i32> {
        let z = &s.players[p as usize];
        let mut out = Vec::new();
        for &u in z.hand.iter().chain(z.shield.iter()).chain(z.deck.iter()) {
            if s.cards[u as usize].def == q_def {
                out.push(u);
            }
        }
        out
    };

    let assign = |s: &mut State, p: PlayerId, list: &[u16], hypo: Option<&[u16]>, rand: &mut SeededRand| {
        let slots = unknown_of(s, p);
        if slots.is_empty() {
            return;
        }
        let mut pool = subtract_known(list, &known_of(s, p));
        // 決め打ち: 仮説のカードを手札の枠に先に置く
        let mut hand_slots: Vec<i32> = slots.iter().copied().filter(|&u| s.cards[u as usize].zone == Zone::Hand).collect();
        let mut rest: Vec<i32> = slots.clone();
        if let Some(h) = hypo {
            if !h.is_empty() {
                let w = env.policy.hypothesis_weight;
                for &hc in h {
                    let idx = match pool.iter().position(|x| *x == hc) {
                        Some(i) => i,
                        None => continue,
                    };
                    if hand_slots.is_empty() {
                        continue;
                    }
                    if rand.next() > w {
                        continue;
                    }
                    let slot = hand_slots.remove(0);
                    s.cards[slot as usize].def = hc;
                    rest.retain(|x| *x != slot);
                    pool.remove(idx);
                }
            }
        }
        let open = rest;
        // 手札の種類が部分開示されている場合は、満たす割り当てを試す(棄却サンプリング)
        let want: Option<&Vec<(String, i32)>> = if p == opp_p { env.opp_hand_kinds.as_ref() } else { None };
        let mut best: Vec<u16> = Vec::new();
        let tries = if want.is_some() { 60 } else { 1 };
        for _ in 0..tries {
            let mut cand = shuffled(&pool, rand);
            while cand.len() < open.len() {
                if list.is_empty() {
                    break;
                }
                cand.extend(shuffled(list, rand));
            }
            cand.truncate(open.len());
            best = cand.clone();
            let w = match want {
                Some(w) => w,
                None => break,
            };
            let mut cnt: Vec<(String, i32)> = w.iter().map(|(k, _)| (k.clone(), 0)).collect();
            for (i, &u) in open.iter().enumerate() {
                if s.cards[u as usize].zone != Zone::Hand || i >= cand.len() {
                    continue;
                }
                for k in kinds_of(reg, cand[i]) {
                    if let Some(c) = cnt.iter_mut().find(|(kk, _)| kk == k) {
                        c.1 += 1;
                    }
                }
            }
            for &u in &s.players[opp_p as usize].hand {
                if !open.contains(&u) && s.cards[u as usize].def != q_def {
                    for k in kinds_of(reg, s.cards[u as usize].def) {
                        if let Some(c) = cnt.iter_mut().find(|(kk, _)| kk == k) {
                            c.1 += 1;
                        }
                    }
                }
            }
            if w.iter().all(|(k, v)| cnt.iter().find(|(kk, _)| kk == k).map_or(false, |c| c.1 == *v)) {
                break;
            }
        }
        for (i, &u) in open.iter().enumerate() {
            if i < best.len() {
                s.cards[u as usize].def = best[i];
            }
        }
    };

    // 公開されて山札の下に戻った札(ヨビニオンなど)は、先に山札のその枠へ割り当てる(TS 版 determinize.ts と同じ順・同じ乱数の使い方)。
    // 残りの未知の札は、デッキリストからこの札を引いた残りから選ばれる
    for p in 0..2usize {
        for (uids, defs) in &env.deck_known[p] {
            let ok = uids.len() == defs.len()
                && uids.iter().all(|&u| u >= 0 && (u as usize) < s.cards.len() && s.cards[u as usize].def == q_def && s.cards[u as usize].zone == Zone::Deck);
            if !ok {
                continue;
            }
            let ds = shuffled(defs, rand);
            for (i, &u) in uids.iter().enumerate() {
                s.cards[u as usize].def = ds[i];
            }
        }
    }

    // 自分のデッキ・シールド
    let my_list: Vec<u16> = if !s.deck_ids[me as usize].is_empty() { s.deck_ids[me as usize].clone() } else { known_of(&s, me) };
    assign(&mut s, me, &my_list, None, rand);
    // 相手
    let mut opp_list: Vec<u16> = s.deck_ids[opp_p as usize].clone();
    if opp_list.is_empty() {
        let seen = known_of(&s, opp_p);
        let cands: Vec<&Vec<u16>> =
            env.candidate_decks.iter().filter(|d| subtract_known(d, &seen).len() == d.len().saturating_sub(seen.len())).collect();
        opp_list = if !cands.is_empty() { cands[(rand.next() * cands.len() as f64).floor() as usize].clone() } else { my_list.clone() };
    }
    let hypo: Option<Vec<u16>> = if env.policy.preset == "hypothesis" {
        Some(env.policy.hypotheses.iter().filter(|(_, z)| z == "hand").map(|(d, _)| *d).collect())
    } else {
        None
    };
    assign(&mut s, opp_p, &opp_list, hypo.as_deref(), rand);
    s.rng = ((rand.next() * 2147483647.0).floor() as i64 | 1) as i32;
    s.rebuild_index(reg.defs.len());
    s
}

// ───────────────────────── 1ラウンド ─────────────────────────

/// 1ラウンド: 種から世界を1つ作り、alive の手を同じ世界・同じ乱数で評価する。
/// 戻り値は手ごとの報酬(alive でない手・例外を出した手は NaN)。
/// 世界の乱数の種と対称の向き(src/ai/mcts.ts の worldSeed)
fn world_seed(seed: u32, anti: bool) -> (u32, bool) {
    if anti {
        (seed & !1u32, seed & 1 == 1)
    } else {
        (seed, false)
    }
}

pub fn eval_round(reg: &Registry, env: &SearchEnv, seed: u32, alive: &[usize]) -> Vec<f64> {
    crate::prof!(0);
    apply_policy(&env.weights);
    let q_def = reg.def_index("?").unwrap_or(u16::MAX);
    let (ws, wa) = world_seed(seed, env.weights.anti);
    let mut rr = SeededRand::new_anti(ws, wa);
    let det = determinize(reg, env, &mut rr, q_def);
    let rollout_seed = (rr.next() * 2147483647.0).floor() as u32;
    let mut r = vec![f64::NAN; env.legal.len()];
    for &k in alive {
        if k >= env.legal.len() {
            continue;
        }
        let res = step_owned(reg, det.clone(), &env.legal[k]).and_then(|st| {
            let mut rand = SeededRand::new(rollout_seed);
            rollout(reg, st, env.me, &mut rand, env.horizon, &env.weights)
        });
        if let Ok(v) = res {
            r[k] = v;
        }
    }
    r
}

// ───────────────────────── ターン内の行動列を木にする探索 ─────────────────────────
// src/ai/tree.ts の treeSearch に対応する(決定化つき UCT)。乱数の使い方・選び方は TS 版と同じ。

/// ラウンドの種(src/ai/mcts.ts の roundSeed と同じ)
pub fn round_seed(base: u32, r: u32) -> u32 {
    let mut x = base ^ (r.wrapping_add(1)).wrapping_mul(0x9e3779b1);
    x = (x ^ (x >> 16)).wrapping_mul(0x85ebca6b);
    x = (x ^ (x >> 13)).wrapping_mul(0xc2b2ae35);
    x ^ (x >> 16)
}

#[derive(Clone, Copy, Debug)]
pub struct TreeOpts {
    pub c: f64,
    pub max_depth: i32,
}

struct TNode {
    acts: Vec<Action>,
    n: Vec<u32>,
    w: Vec<f64>,
    avail: Vec<u32>,
    kids: Vec<Option<usize>>,
}

impl TNode {
    fn new() -> TNode {
        TNode { acts: Vec::new(), n: Vec::new(), w: Vec::new(), avail: Vec::new(), kids: Vec::new() }
    }
}

/// 木(続きから反復できる)。根は nodes[0] で、根の手は env.legal の並び
pub struct Tree {
    nodes: Vec<TNode>,
    pub done: u32,
}

impl Tree {
    pub fn new(env: &SearchEnv) -> Tree {
        let mut root = TNode::new();
        for a in &env.legal {
            root.acts.push(a.clone());
            root.n.push(0);
            root.w.push(0.0);
            root.avail.push(0);
            root.kids.push(None);
        }
        Tree { nodes: vec![root], done: 0 }
    }

    /// 根の手ごとの (訪問回数, 報酬の合計)
    pub fn root_stats(&self) -> (Vec<u32>, Vec<f64>) {
        (self.nodes[0].n.clone(), self.nodes[0].w.clone())
    }

    /// 木を下る(src/ai/tree.ts の descend と同じ)。stv の状態から始め、止まった時の状態を stv に残す。失敗(エンジンの例外)なら true
    fn descend(&mut self, reg: &Registry, env: &SearchEnv, o: TreeOpts, stv: &mut Option<State>, start: usize, start_depth: i32, path: &mut Vec<(usize, usize)>) -> bool {
        let me = env.me;
        let root_turn = env.view.turn;
        let mut node = start;
        let mut depth = start_depth;
        loop {
            let st = stv.as_ref().unwrap();
            let (why, ok) = match &st.pending {
                Some(p) => (p.why, p.player == me),
                None => break,
            };
            if st.winner != Winner::None || !ok || st.turn != root_turn || depth >= o.max_depth {
                break;
            }
            let legal: Vec<Action> = if depth == 0 { env.legal.clone() } else { legal_actions(st, reg) };
            if legal.is_empty() {
                break;
            }
            if legal.len() == 1 {
                match step_owned(reg, stv.take().unwrap(), &legal[0]) {
                    Ok(s2) => *stv = Some(s2),
                    Err(_) => return true,
                }
                depth += 1;
                continue;
            }
            let nd = &mut self.nodes[node];
            let idxs: Vec<Option<usize>> = legal.iter().map(|a| nd.acts.iter().position(|x| x == a)).collect();
            for i in idxs.iter().flatten() {
                nd.avail[*i] += 1;
            }
            let untried: Vec<usize> = (0..legal.len())
                .filter(|&j| match idxs[j] {
                    None => true,
                    Some(i) => nd.n[i] == 0,
                })
                .collect();
            let expand = !untried.is_empty();
            let chosen: usize = if expand {
                let mut c = untried[0];
                if why == Why::TurnAction {
                    let j = choose_turn_action(Env { s: st, reg }, &legal, me);
                    if untried.contains(&j) {
                        c = j;
                    }
                }
                c
            } else {
                let mut best = 0usize;
                let mut bs = f64::NEG_INFINITY;
                for j in 0..legal.len() {
                    let i = idxs[j].unwrap();
                    let s = nd.w[i] / nd.n[i] as f64 + o.c * ((nd.avail[i].max(1) as f64).ln() / nd.n[i] as f64).sqrt();
                    if s > bs {
                        bs = s;
                        best = j;
                    }
                }
                best
            };
            let ci = match idxs[chosen] {
                Some(i) => i,
                None => {
                    nd.acts.push(legal[chosen].clone());
                    nd.n.push(0);
                    nd.w.push(0.0);
                    nd.avail.push(1);
                    nd.kids.push(None);
                    nd.acts.len() - 1
                }
            };
            path.push((node, ci));
            match step_owned(reg, stv.take().unwrap(), &legal[chosen]) {
                Ok(s2) => *stv = Some(s2),
                Err(_) => return true,
            }
            depth += 1;
            if expand {
                break;
            }
            node = match self.nodes[node].kids[ci] {
                Some(k) => k,
                None => {
                    self.nodes.push(TNode::new());
                    let k = self.nodes.len() - 1;
                    self.nodes[node].kids[ci] = Some(k);
                    k
                }
            };
        }
        false
    }

    /// 反復を done から target まで行う(標準の ISMCTS)
    pub fn run(&mut self, reg: &Registry, env: &SearchEnv, base: u32, target: u32, o: TreeOpts) {
        apply_policy(&env.weights);
        let q_def = reg.def_index("?").unwrap_or(u16::MAX);
        let end_turn = env.view.turn + env.horizon;
        while self.done < target {
            let it = self.done;
            self.done += 1;
            let mut rr = SeededRand::new(round_seed(base, it));
            let det = determinize(reg, env, &mut rr, q_def);
            let rollout_seed = (rr.next() * 2147483647.0).floor() as u32;
            let mut stv: Option<State> = Some(det);
            let mut path: Vec<(usize, usize)> = Vec::new();
            if self.descend(reg, env, o, &mut stv, 0, 0, &mut path) {
                continue;
            }
            let st = stv.unwrap();
            let mut rand = SeededRand::new(rollout_seed);
            let hz = (end_turn - st.turn).max(0);
            if let Ok(r) = rollout(reg, st, env.me, &mut rand, hz, &env.weights) {
                for (nd, i) in path {
                    self.nodes[nd].n[i] += 1;
                    self.nodes[nd].w[i] += r;
                }
            }
        }
    }

    /// ペア比較の1ラウンド(src/ai/tree.ts の PairedTree.round)。手ごとの報酬(alive でない手・失敗した手は NaN)
    pub fn paired_round(&mut self, reg: &Registry, env: &SearchEnv, seed: u32, alive: &[usize], o: TreeOpts) -> Vec<f64> {
        apply_policy(&env.weights);
        let q_def = reg.def_index("?").unwrap_or(u16::MAX);
        let end_turn = env.view.turn + env.horizon;
        let (ws, wa) = world_seed(seed, env.weights.anti);
        let mut rr = SeededRand::new_anti(ws, wa);
        let det = determinize(reg, env, &mut rr, q_def);
        let rollout_seed = (rr.next() * 2147483647.0).floor() as u32;
        let mut out = vec![f64::NAN; env.legal.len()];
        for &k in alive {
            if k >= env.legal.len() {
                continue;
            }
            let child = match self.nodes[0].kids[k] {
                Some(c) => c,
                None => {
                    self.nodes.push(TNode::new());
                    let c = self.nodes.len() - 1;
                    self.nodes[0].kids[k] = Some(c);
                    c
                }
            };
            let first = match step_owned(reg, det.clone(), &env.legal[k]) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let mut stv: Option<State> = Some(first);
            let mut path: Vec<(usize, usize)> = Vec::new();
            if self.descend(reg, env, o, &mut stv, child, 1, &mut path) {
                continue;
            }
            let st = stv.unwrap();
            let mut rand = SeededRand::new(rollout_seed);
            let hz = (end_turn - st.turn).max(0);
            if let Ok(r) = rollout(reg, st, env.me, &mut rand, hz, &env.weights) {
                for (nd, i) in path {
                    self.nodes[nd].n[i] += 1;
                    self.nodes[nd].w[i] += r;
                }
                self.nodes[0].n[k] += 1;
                self.nodes[0].w[k] += r;
                out[k] = r;
            }
        }
        out
    }
}
