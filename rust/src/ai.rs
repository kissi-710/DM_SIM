//! AI の一部の移植: プレイアウト(決定化 → ルールベースの手順で数ターン進める → 評価)。
//! src/ai/mcts.ts の evalRound / rollout / rolloutPick、rulebased.ts の chooseTurnAction、eval.ts、determinize.ts に対応する。

use crate::ast::R;
use crate::cond::*;
use crate::derive::*;
use crate::engine::{step, step_owned};
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
}

impl Default for EvalWeights {
    fn default() -> Self {
        // src/ai/eval.ts の DEFAULT_WEIGHTS と同じ
        EvalWeights { creature: 3.0, power_div: 2500.0, blocker: 1.5, speed_attacker: 0.5, stack: 0.5, shield: 4.0, hand: 1.6, mana: 3.5, hand_cost: 0.05, deck_out: 3.0, scale: 30.0 }
    }
}

impl EvalWeights {
    pub fn from_json(j: Option<&Json>) -> EvalWeights {
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
                    _ => {}
                }
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
        let cost = chars_of(e, u, -1).cost;
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
    match e.s.winner {
        Winner::Draw => return 0.5,
        Winner::P(p) => return if p == me { 1.0 } else { 0.0 },
        Winner::None => {}
    }
    0.5 + 0.5 * (evaluate(e, me, w) / w.scale).tanh()
}

// ───────────────────────── ルールベースの手の選択(ターン中の行動) ─────────────────────────

fn keep_score(e: Env, uid: i32, me: PlayerId) -> f64 {
    let s = e.s;
    let card = &s.cards[uid as usize];
    let ch = chars_of(e, uid, -1);
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
        for cv in chars_of(e, m, -1).civs {
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
        for cv in chars_of(e, h, -1).civs {
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
        if s.players[o as usize].battle.is_empty() && def.text_risky {
            v -= 3.0;
        }
    }
    v
}

/// マナがこの枚数以上で、手札を全部払えるなら、マナチャージをしない
const SKIP_MANA_FROM: usize = 7;

pub fn choose_turn_action(e: Env, legal: &[Action], me: PlayerId) -> usize {
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
                    let cost = chars_of(e, u, -1).cost;
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
    for (i, a) in legal.iter().enumerate() {
        if let Action::PlayCard { uid, from, face, extra } = a {
            let sc = play_score(e, *uid, *from, *face, extra, me);
            if best_play.is_none() || sc > bs {
                bs = sc;
                best_play = Some(i);
            }
        }
    }
    if let Some(i) = best_play {
        return i;
    }
    // 攻撃の評価
    let attacks: Vec<usize> = legal.iter().enumerate().filter(|(_, a)| matches!(a, Action::Attack { .. })).map(|(i, _)| i).collect();
    if !attacks.is_empty() {
        let opp_blockers: Vec<&Perm> = s.players[o as usize].battle.iter().filter(|p| can_block(e, p)).collect();
        let max_block = opp_blockers.iter().map(|p| power_of(e, p)).fold(0, |m, x| m.max(x));
        let opp_shield = s.players[o as usize].shield.len() as i32;
        let my_shield = s.players[me as usize].shield.len() as i32;
        // 勝ちが確定する攻撃(S・トリガーは考えない): ブロッカーに止められない攻撃のブレイク数が、シールド+1以上
        let mine: Vec<&Perm> = s.players[me as usize]
            .battle
            .iter()
            .filter(|p| attacks.iter().any(|&i| matches!(&legal[i], Action::Attack { attacker, target: Target::Player } if *attacker == p.pid)))
            .collect();
        let mut by_breaks: Vec<(&Perm, i32)> = mine.iter().map(|p| (*p, breaker_count(e, p))).collect();
        by_breaks.sort_by(|x, y| y.1.cmp(&x.1)); // 安定(ブレイク数の多い順)
        let nb = opp_blockers.len();
        if by_breaks.len() > nb {
            let through = &by_breaks[nb..];
            if !through.is_empty() && through.iter().map(|x| x.1).sum::<i32>() >= opp_shield + 1 {
                let lethal_pid = by_breaks[0].0.pid;
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
                        if opp_shield == 0 && opp_blockers.is_empty() {
                            score = 100.0;
                        } else if opp_blockers.is_empty() {
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
                            let tcost = chars_of(e, tp.cards[0], -1).cost;
                            if pa > pt {
                                score = 30.0 + (tcost.min(12)) as f64 + pt as f64 / 2000.0;
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

fn answer_len(a: &Action) -> i32 {
    match a {
        Action::Answer { value: Val::List(l), .. } => l.len() as i32,
        _ => 0,
    }
}

/// プレイアウト用の素早い方針: ターン中の行動は L1 の手順、効果の選択は軽い規則
pub fn rollout_pick(e: Env, legal: &[Action], rand: &mut SeededRand) -> usize {
    let p = e.s.pending.as_ref().unwrap();
    if p.why == Why::TurnAction {
        return choose_turn_action(e, legal, p.player);
    }
    let mut pick = |n: usize, rand: &mut SeededRand| (rand.next() * n as f64).floor() as usize;
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
            match yes {
                Some(i) if rand.next() < 0.75 => i,
                _ => pick(legal.len(), rand),
            }
        }
        Why::Block => {
            // 半分はブロックする
            let blocks: Vec<usize> = legal.iter().enumerate().filter(|(_, a)| matches!(a, Action::Answer { value: Val::List(l), .. } if !l.is_empty())).map(|(i, _)| i).collect();
            if !blocks.is_empty() && rand.next() < 0.5 {
                blocks[pick(blocks.len(), rand)]
            } else {
                0
            }
        }
        _ => pick(legal.len(), rand),
    }
}

/// 状態 start から、horizon ターン先(または決着)まで進めて報酬を返す。エンジンの例外は Err。
pub fn rollout(reg: &Registry, start: State, me: PlayerId, rand: &mut SeededRand, horizon: i32, w: &EvalWeights) -> Result<f64, String> {
    let mut st = start;
    let end_turn = st.turn + horizon;
    let mut guard = 0;
    while st.winner == Winner::None && st.turn < end_turn {
        guard += 1;
        if guard > 400 {
            break;
        }
        let legal = legal_actions(&st, reg);
        if legal.is_empty() {
            break;
        }
        let i = rollout_pick(Env { s: &st, reg }, &legal, rand);
        st = step_owned(reg, st, &legal[i])?;
    }
    Ok(reward(Env { s: &st, reg }, me, w))
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
            candidate_decks,
            horizon: j.get("horizon").and_then(|x| x.as_i64()).unwrap_or(3) as i32,
            weights: EvalWeights::from_json(j.get("weights")),
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
        let k = if f.ty == FaceType::Spell { "spell" } else { "creature" };
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

    let mut assign = |s: &mut State, p: PlayerId, list: &[u16], hypo: Option<&[u16]>, rand: &mut SeededRand| {
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
    s
}

// ───────────────────────── 1ラウンド ─────────────────────────

/// 1ラウンド: 種から世界を1つ作り、alive の手を同じ世界・同じ乱数で評価する。
/// 戻り値は手ごとの報酬(alive でない手・例外を出した手は NaN)。
pub fn eval_round(reg: &Registry, env: &SearchEnv, seed: u32, alive: &[usize]) -> Vec<f64> {
    let q_def = reg.def_index("?").unwrap_or(u16::MAX);
    let mut rr = SeededRand::new(seed);
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
