//! 派生ビュー: コスト・パワー・文明・能力・攻撃可否など(src/engine/derive.ts)。状態を書き換えない。

use crate::ast::*;
use crate::cond::*;
use crate::registry::{Face, FaceInfo, Feat};
use crate::types::*;
use std::rc::Rc;

pub struct Chars<'a> {
    pub face: &'a Face,
    pub face_idx: i32,
    pub civs: &'a [Civ],
    pub cost: i32,
    pub power: i32,
    pub ty: FaceType,
    pub races: &'a [String],
}

/// カードの特性。hint=-1 のとき、場以外のカードは面0(文明は全面の和集合)で見る。
pub fn chars_of<'a>(e: Env<'a>, uid: i32, hint: i32) -> Chars<'a> {
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let in_play = card.zone == Zone::Battle || card.zone == Zone::Limbo;
    let idx: usize = if in_play {
        if (card.face as usize) < def.faces.len() && card.face >= 0 {
            card.face as usize
        } else {
            0
        }
    } else if hint >= 0 && (hint as usize) < def.faces.len() {
        hint as usize
    } else {
        0
    };
    let face = &def.faces[idx];
    let civs: &[Civ] = if in_play || hint >= 0 { &face.civs } else { &def.union_civs };
    let mut power = face.power.unwrap_or(0);
    if card.zone == Zone::Battle && card.pid >= 0 {
        if let Some(pm) = e.s.perm(card.pid) {
            if pm.cards[0] == uid {
                power = power_of(e, pm);
            }
        }
    }
    Chars { face, face_idx: idx as i32, civs, cost: face.cost, power, ty: face.ty, races: &face.races }
}

/// chars_of の、パワーを計算しない版(パワーは面の基本値のまま)。コスト・面・文明・タイプだけ使う呼び出しは、こちらを使う
/// (場のカードのパワーは、常在型能力・継続効果の走査が要るので、chars_of では重い)。
pub fn chars_lite<'a>(e: Env<'a>, uid: i32, hint: i32) -> Chars<'a> {
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let in_play = card.zone == Zone::Battle || card.zone == Zone::Limbo;
    let idx: usize = if in_play {
        if (card.face as usize) < def.faces.len() && card.face >= 0 {
            card.face as usize
        } else {
            0
        }
    } else if hint >= 0 && (hint as usize) < def.faces.len() {
        hint as usize
    } else {
        0
    };
    let face = &def.faces[idx];
    let civs: &[Civ] = if in_play || hint >= 0 { &face.civs } else { &def.union_civs };
    let ty = if face.tamaseed_unless.is_some() { dynamic_type(e, uid, face) } else { face.ty };
    // 「このカードが山札で表向きになっている間、パワーは∞」(カツムゲン): 山札のカードのパワーを見るのは、表向きにした時だけ
    let power = if card.zone == Zone::Deck && face.abilities.iter().any(|a| matches!(a, Ability::Static { m: StaticMod::InfinitePowerInBattle, .. })) { 999_999_999 } else { face.power.unwrap_or(0) };
    Chars { face, face_idx: idx as i32, civs, cost: face.cost, power, ty, races: &face.races }
}

thread_local! {
    /// 種類の条件を評価中のカード(その間、そのカード自身の種類は本来の種類として数える)
    static TYPE_GUARD: std::cell::RefCell<Vec<i32>> = std::cell::RefCell::new(Vec::new());
}

/// バトルゾーンのカードの種類(タマシード/クリーチャー(ヘラクレス)は、条件を満たさない間、タマシード)
fn dynamic_type(e: Env, uid: i32, face: &Face) -> FaceType {
    let cond = match &face.tamaseed_unless {
        Some(c) => c,
        None => return face.ty,
    };
    let card = &e.s.cards[uid as usize];
    if card.zone != Zone::Battle || TYPE_GUARD.with(|g| g.borrow().contains(&uid)) {
        return face.ty;
    }
    TYPE_GUARD.with(|g| g.borrow_mut().push(uid));
    let ok = eval_cond(&CC::new(e, card.owner).with_self(uid), cond);
    TYPE_GUARD.with(|g| g.borrow_mut().pop());
    if ok {
        face.ty
    } else {
        FaceType::Tamaseed
    }
}

/// 表記コスト(使用中の面。場以外は面0)
pub fn cost_base(e: Env, uid: i32) -> i32 {
    chars_lite(e, uid, -1).face.cost
}

pub fn info_of<'a>(e: Env<'a>, uid: i32) -> &'a FaceInfo {
    let card = &e.s.cards[uid as usize];
    if card.zone == Zone::Battle && (!e.s.effects.is_empty() || e.s.sealed) && is_ignored(e, uid) {
        return &e.reg.empty_info;
    }
    let ch = chars_lite(e, uid, -1);
    e.reg.info(card.def, ch.face_idx)
}

/// 封印されているか(封印されているクリーチャーは、能力を失い、攻撃もブロックもできない)
pub fn is_sealed(e: Env, uid: i32) -> bool {
    let card = &e.s.cards[uid as usize];
    if !e.s.sealed || card.zone != Zone::Battle {
        return false;
    }
    e.s.perm(card.pid).map_or(false, |p| !p.seals.is_empty())
}

/// 相手は、自身の山札を見れず、順序を変えられない(5.S.D.)
pub fn deck_locked(e: Env, p: PlayerId) -> bool {
    game_has_any_static(e, |st| matches!(st.m, StaticMod::DeckLock) && st.controller != p)
}

/// 常在型能力のうち、pred に合うものがあるか(while を満たすもののみ)
fn game_has_any_static<'a>(e: Env<'a>, pred: impl Fn(&ActiveStatic<'a>) -> bool) -> bool {
    any_static(e, |st| pred(st))
}

/// バトルゾーンのカードが、能力を無視されているか(「そのコストの相手のエレメントの能力を無視する」「相手のクリーチャーすべての能力を無視する」・封印)
pub fn is_ignored(e: Env, uid: i32) -> bool {
    let card = &e.s.cards[uid as usize];
    if e.s.sealed && is_sealed(e, uid) {
        return true;
    }
    for ef in &e.s.effects {
        if ef.controller == card.owner {
            continue;
        }
        match ef.m {
            // 「相手のクリーチャーすべての能力を無視する」: クリーチャーだけが対象(クロスギア・フィールドなどは対象外)
            EffectMod::IgnoreAll => {
                let def = &e.reg.defs[card.def as usize];
                let face = def.faces.get(card.face.max(0) as usize).unwrap_or(&def.faces[0]);
                if face.ty.is_creature() {
                    return true;
                }
            }
            EffectMod::IgnoreCost(n) => {
                if cost_base(e, uid) == n {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// そのカード自身が持つ常在型能力(while を満たしているもの)に、pred に合うものがあるか
pub fn has_self_static(e: Env, uid: i32, pred: impl Fn(&StaticMod) -> bool) -> bool {
    let info = info_of(e, uid);
    if info.statics.is_empty() {
        return false;
    }
    let card = &e.s.cards[uid as usize];
    let face = e.reg.face(card.def, chars_lite(e, uid, -1).face_idx);
    for &si in &info.statics {
        if let Ability::Static { m, while_ } = &face.abilities[si as usize] {
            if !pred(m) {
                continue;
            }
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                    continue;
                }
            }
            return true;
        }
    }
    false
}

/// その山のクリーチャーが、いま攻撃中か(攻撃の手続きが終わっていない)
pub fn is_attacking(e: Env, pid: i32) -> bool {
    e.s.cont.iter().any(|f| matches!(f, Frame::Proc(p) if p.name == ProcName::Attack && var_get(&p.vars, s::PID).and_then(|v| v.as_i32()) == Some(pid)))
}

/// そのプレイヤーが、ゲームに負けない効果を受けているか
pub fn player_cannot_lose(e: Env, p: PlayerId) -> bool {
    e.s.effects.iter().any(|ef| ef.m == EffectMod::CannotLose && ef.controller == p)
}

// ───────────────────────── 継続効果 ─────────────────────────

pub struct ActiveStatic<'a> {
    pub src: i32,
    pub controller: PlayerId,
    pub m: &'a StaticMod,
}

/// バトルゾーンの一番上のカードが持つ常在型能力
pub fn active_statics<'a>(e: Env<'a>) -> Vec<ActiveStatic<'a>> {
    crate::prof!(15);
    let mut out = Vec::new();
    for p in 0..2u8 {
        for perm in &e.s.players[p as usize].battle {
            let uid = perm.cards[0];
            let card = &e.s.cards[uid as usize];
            let info = info_of(e, uid);
            if info.statics.is_empty() {
                continue;
            }
            let face = e.reg.face(card.def, chars_lite(e, uid, -1).face_idx);
            for &si in &info.statics {
                if let Ability::Static { m, while_ } = &face.abilities[si as usize] {
                    if let Some(w) = while_ {
                        let cc = CC::new(e, p).with_self(uid);
                        if !eval_cond(&cc, w) {
                            continue;
                        }
                    }
                    out.push(ActiveStatic { src: uid, controller: p, m });
                }
            }
        }
    }
    out
}

/// 常在型能力を1つずつ処理する(f が true を返したら打ち切って true を返す)。Vec を確保しない。
pub fn any_static<'a>(e: Env<'a>, f: impl FnMut(&ActiveStatic<'a>) -> bool) -> bool {
    any_static_if(e, |_| true, f)
}

/// any_static の、能力の種類 `sel` で先に絞ってから `while` を評価する版(TS の activeStatics(c, modType) と同じ順序)。
/// 絞らないと、パワーの計算中に無関係な `while`(パワーを見るもの)を評価して再帰する。
pub fn any_static_if<'a>(e: Env<'a>, sel: impl Fn(&StaticMod) -> bool, mut f: impl FnMut(&ActiveStatic<'a>) -> bool) -> bool {
    crate::prof!(15);
    for p in 0..2u8 {
        for perm in &e.s.players[p as usize].battle {
            let uid = perm.cards[0];
            let card = &e.s.cards[uid as usize];
            // バトルゾーンの一番上: 使用中の面(無ければ面0)
            let def = &e.reg.defs[card.def as usize];
            let fidx = if card.face >= 0 && (card.face as usize) < def.faces.len() { card.face } else { 0 };
            let info = if !e.s.effects.is_empty() || e.s.sealed { info_of(e, uid) } else { e.reg.info(card.def, fidx) };
            if info.statics.is_empty() {
                continue;
            }
            let face = &def.faces[fidx as usize];
            for &si in &info.statics {
                if let Ability::Static { m, while_ } = &face.abilities[si as usize] {
                    if !sel(m) {
                        continue;
                    }
                    if let Some(w) = while_ {
                        let cc = CC::new(e, p).with_self(uid);
                        if !eval_cond(&cc, w) {
                            continue;
                        }
                    }
                    if f(&ActiveStatic { src: uid, controller: p, m }) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

// ───────────────────────── パワー・能力 ─────────────────────────

pub fn power_of(e: Env, perm: &Perm) -> i32 {
    crate::prof!(14);
    let uid = perm.cards[0];
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let face = def.faces.get(card.face as usize).unwrap_or(&def.faces[0]);
    let mut p = face.power.unwrap_or(0);
    let info = info_of(e, uid);
    // 能力は getInfo の面で読む(TS 版は info.statics[].ability をそのまま使う)
    let face_for_abilities = e.reg.face(card.def, card.face);
    for &si in &info.statics {
        if let Ability::Static { m: StaticMod::PowerAdd { n }, while_ } = &face_for_abilities.abilities[si as usize] {
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                    continue;
                }
            }
            p += n;
        }
    }
    for ef in &e.s.effects {
        if ef.pid == perm.pid {
            if let EffectMod::PowerAdd(n) = ef.m {
                p += n;
            }
        }
    }
    // 式で増減するパワー(「コストが異なるクリーチャー1体につき+3000」など)
    for &si in &info.statics {
        if let Ability::Static { m: StaticMod::PowerAddExpr { expr }, while_ } = &face_for_abilities.abilities[si as usize] {
            let cc = CC::new(e, card.owner).with_self(uid);
            if let Some(w) = while_ {
                if !eval_cond(&cc, w) {
                    continue;
                }
            }
            p += eval_expr(&cc, expr) as i32;
        }
    }
    // このクロスギアをクロスしたクリーチャーのパワーを増やす(竜装 ゴウソク・タキオンアーマー)
    if game_has(e, Feat::HostPowerAdd) {
        for g in &e.s.players[card.owner as usize].battle {
            if g.crossed_on != Some(perm.pid) {
                continue;
            }
            let gi = info_of(e, g.cards[0]);
            let gcard = &e.s.cards[g.cards[0] as usize];
            let gface = e.reg.face(gcard.def, chars_lite(e, g.cards[0], -1).face_idx);
            for &si in &gi.statics {
                if let Ability::Static { m: StaticMod::HostPowerAdd { n }, while_ } = &gface.abilities[si as usize] {
                    if let Some(w) = while_ {
                        if !eval_cond(&CC::new(e, card.owner).with_self(g.cards[0]), w) {
                            continue;
                        }
                    }
                    p += n;
                }
            }
        }
    }
    // 自分の他のカードのパワーを増やす(アルカディアス・モモキング)
    if game_has(e, Feat::PowerAddOthers) {
        any_static_if(e, |m| matches!(m, StaticMod::PowerAddOthers { .. }), |st| {
            if let StaticMod::PowerAddOthers { n, cond } = st.m {
                if st.controller == card.owner && st.src != uid {
                    let cc = CC::new(e, card.owner).with_self(st.src).with_it(uid, card.face);
                    if eval_cond(&cc, cond) {
                        p += n;
                    }
                }
            }
            false
        });
    }
    // パワーアタッカー: 攻撃中だけ
    if !info.statics.is_empty() && is_attacking(e, perm.pid) {
        for &si in &info.statics {
            if let Ability::Static { m: StaticMod::PowerAttacker { n }, while_ } = &face_for_abilities.abilities[si as usize] {
                if let Some(w) = while_ {
                    if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                        continue;
                    }
                }
                p += n;
            }
        }
    }
    p
}

/// バトルの時のパワー(カツムゲン: 無限)。無限は i64::MAX で表す(比べるだけ)
pub fn battle_power(e: Env, perm: &Perm) -> i64 {
    let uid = perm.cards[0];
    let card = &e.s.cards[uid as usize];
    let info = info_of(e, uid);
    let mut add: i64 = 0;
    if !info.statics.is_empty() {
        let face = e.reg.face(card.def, chars_lite(e, uid, -1).face_idx);
        // 「バトル中、パワーを+n する」(ふだんのパワーには入らない)
        for &si in &info.statics {
            if let Ability::Static { m: StaticMod::PowerAddInBattle { n }, while_ } = &face.abilities[si as usize] {
                if let Some(w) = while_ {
                    if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                        continue;
                    }
                }
                add += *n as i64;
            }
        }
        for &si in &info.statics {
            if let Ability::Static { m: StaticMod::InfinitePowerInBattle, while_ } = &face.abilities[si as usize] {
                if let Some(w) = while_ {
                    if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                        continue;
                    }
                }
                return i64::MAX;
            }
        }
    }
    power_of(e, perm) as i64 + add
}

/// プレイヤーの表向きのシールド(G城)が持つ常在型能力のうち、pred に合うものがあるか
pub fn shield_static(e: Env, controller: PlayerId, pred: impl Fn(&StaticMod) -> bool) -> bool {
    for &uid in &e.s.players[controller as usize].shield {
        let card = &e.s.cards[uid as usize];
        if !card.up {
            continue;
        }
        let info = e.reg.info(card.def, 0);
        if info.statics.is_empty() {
            continue;
        }
        let face = e.reg.face(card.def, 0);
        for &si in &info.statics {
            if let Ability::Static { m, while_ } = &face.abilities[si as usize] {
                if !pred(m) {
                    continue;
                }
                if let Some(w) = while_ {
                    if !eval_cond(&CC::new(e, controller).with_self(uid), w) {
                        continue;
                    }
                }
                return true;
            }
        }
    }
    false
}

/// 相手の常在型能力(entersTapped)で、このクリーチャー(出る面 face_idx)がタップして出るか
pub fn enters_tapped_by_static(e: Env, uid: i32, owner: PlayerId, face_idx: i32) -> bool {
    any_static(e, |st| {
        if let StaticMod::EntersTapped { cond } = st.m {
            if st.controller != owner {
                let cc = CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx);
                return eval_cond(&cc, cond);
            }
        }
        false
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kw {
    Blocker,
    SpeedAttacker,
    MachFighter,
    ShieldTrigger,
    JustDiver,
    ExLife,
    Slayer,
    Unblockable,
    CannotBeAttacked,
}

pub fn has_keyword(e: Env, perm: &Perm, kw: Kw) -> bool {
    let uid = perm.cards[0];
    let info = info_of(e, uid);
    let yes = match kw {
        Kw::ShieldTrigger => !info.shield_triggers.is_empty(),
        Kw::Blocker => info.blocker,
        Kw::SpeedAttacker => info.speed_attacker,
        Kw::MachFighter => info.mach_fighter,
        Kw::JustDiver => info.just_diver,
        Kw::ExLife => info.ex_life,
        Kw::Slayer => info.slayer,
        Kw::Unblockable => false,
        Kw::CannotBeAttacked => false,
    };
    if yes {
        return true;
    }
    let ks = match kw {
        Kw::Blocker => s::BLOCKER,
        Kw::SpeedAttacker => s::KW_SPEED_ATTACKER,
        Kw::MachFighter => s::KW_MACH_FIGHTER,
        Kw::ShieldTrigger => s::SHIELD_TRIGGER,
        Kw::JustDiver => s::KW_JUST_DIVER,
        Kw::ExLife => s::EX_LIFE,
        Kw::Slayer => s::KW_SLAYER,
        Kw::Unblockable => s::KW_UNBLOCKABLE,
        Kw::CannotBeAttacked => sym("cannotBeAttacked"),
    };
    if e.s.effects.iter().any(|ef| ef.pid == perm.pid && matches!(ef.m, EffectMod::Grant(k) if k == ks)) {
        return true;
    }
    // 場の常在型能力(grantKeyword)で与えられているか
    granted_by_static(e, perm, ks)
}

fn granted_by_static(e: Env, perm: &Perm, ks: Sym) -> bool {
    let uid = perm.cards[0];
    let owner = e.s.cards[uid as usize].owner;
    let face_of_it = e.s.cards[uid as usize].face;
    for src in &e.s.players[owner as usize].battle {
        let su = src.cards[0];
        let card = &e.s.cards[su as usize];
        let def = &e.reg.defs[card.def as usize];
        let fidx = if card.face >= 0 && (card.face as usize) < def.faces.len() { card.face } else { 0 };
        let info = if !e.s.effects.is_empty() || e.s.sealed { info_of(e, su) } else { e.reg.info(card.def, fidx) };
        if info.statics.is_empty() {
            continue;
        }
        let face = &def.faces[fidx as usize];
        for &si in &info.statics {
            if let Ability::Static { m: StaticMod::GrantKeyword { keyword, cond }, while_ } = &face.abilities[si as usize] {
                if *keyword != ks {
                    continue;
                }
                if let Some(w) = while_ {
                    if !eval_cond(&CC::new(e, owner).with_self(su), w) {
                        continue;
                    }
                }
                if eval_cond(&CC::new(e, owner).with_self(su).with_it(uid, face_of_it), cond) {
                    return true;
                }
            }
        }
    }
    false
}

/// 攻撃クリーチャーが「ブロックされない」か
pub fn is_unblockable(e: Env, attacker: &Perm) -> bool {
    has_keyword(e, attacker, Kw::Unblockable)
}

pub fn breaker_count(e: Env, perm: &Perm) -> i32 {
    let uid = perm.cards[0];
    if has_self_static(e, uid, |m| matches!(m, StaticMod::CannotBreak)) {
        return 0; // シールドをブレイクできない
    }
    let card = &e.s.cards[uid as usize];
    let info = info_of(e, uid);
    let face = e.reg.face(card.def, chars_lite(e, uid, -1).face_idx);
    let mut n = 1;
    for &bi in &info.breakers {
        if let Ability::Keyword { n: bn, while_, .. } = &face.abilities[bi as usize] {
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(e, card.owner).with_self(uid), w) {
                    continue;
                }
            }
            n = n.max(bn.unwrap_or(2));
        }
    }
    // パワード・ブレイカー: パワー n ごとに、シールドをもう1つ(1 + パワー / n)
    if let Some(pb) = info.powered_breaker {
        if pb > 0 {
            n = n.max(1 + power_of(e, perm).div_euclid(pb));
        }
    }
    for ef in &e.s.effects {
        if ef.pid == perm.pid {
            if let EffectMod::Breaker(b) = ef.m {
                n = n.max(b);
            }
        }
    }
    n
}

// ───────────────────────── 攻撃・ブロック・選択 ─────────────────────────

pub fn can_be_chosen(e: Env, perm: &Perm, by: PlayerId, source: Option<i32>) -> bool {
    let owner = e.s.cards[perm.cards[0] as usize].owner;
    if owner == by {
        return true;
    }
    if e.s.effects.iter().any(|ef| ef.pid == perm.pid && ef.m == EffectMod::CannotBeChosen) {
        return false;
    }
    let uid = perm.cards[0];
    let info = info_of(e, uid);
    if !info.statics.is_empty() {
        if has_self_static_unconditional(e, uid, |m| matches!(m, StaticMod::CannotBeChosen)) {
            return false;
        }
        // 「呪文によって相手に選ばれない」: 選ぶ効果の発生源が呪文の時
        if let Some(src) = source {
            if chars_lite(e, src, -1).ty == FaceType::Spell && has_self_static_unconditional(e, uid, |m| matches!(m, StaticMod::ProtectFromSpells)) {
                return false;
            }
        }
    }
    true
}

/// while を見ずに、そのカード自身が持つ常在型能力に pred に合うものがあるか(TS 版の info.statics.some(...))
fn has_self_static_unconditional(e: Env, uid: i32, pred: impl Fn(&StaticMod) -> bool) -> bool {
    let info = info_of(e, uid);
    let card = &e.s.cards[uid as usize];
    let face = e.reg.face(card.def, chars_lite(e, uid, -1).face_idx);
    info.statics.iter().any(|&si| matches!(&face.abilities[si as usize], Ability::Static { m, .. } if pred(m)))
}

pub fn can_be_attacked(e: Env, perm: &Perm) -> bool {
    if e.s.effects.iter().any(|ef| ef.pid == perm.pid && ef.m == EffectMod::CannotBeAttacked) {
        return false;
    }
    // 場の常在型能力で、攻撃されなくなっている(ガチャンコ ガチロボ)
    !granted_by_static(e, perm, sym("cannotBeAttacked"))
}

fn has_effect(e: Env, pid: i32, m: &EffectMod) -> bool {
    e.s.effects.iter().any(|ef| ef.pid == pid && &ef.m == m)
}

/// 相手クリーチャーの「出たターンに自分を攻撃できない」(ガイアッシュ・カイザー)
fn player_attack_blocked_by_entry(e: Env, perm: &Perm, owner: PlayerId) -> bool {
    if perm.entered_turn != e.s.turn {
        return false;
    }
    any_static(e, |st| matches!(st.m, StaticMod::CannotAttackPlayerWhenEntered) && st.controller != owner)
}

/// 召喚酔いか(総合ルール 301.5 / 801.3)。進化クリーチャー(S-MAX進化を含む)は召喚酔いしない。
pub fn is_sick(e: Env, perm: &Perm) -> bool {
    if !perm.sick {
        return false;
    }
    if perm.rush == Some(e.s.turn) {
        return false; // アビスラッシュ: そのターン、プレイヤーを攻撃できる
    }
    !chars_lite(e, perm.cards[0], -1).ty.is_evo()
}

pub fn can_attack(e: Env, perm: &Perm, target: &crate::state::Target) -> bool {
    use crate::state::Target;
    if !can_attack_base(e, perm, target) {
        return false;
    }
    // 「相手のクリーチャーが攻撃するなら、可能ならこのクリーチャーを攻撃する」(バイラス・カースド)
    if game_has(e, Feat::AttackMeFirst) {
        let owner = e.s.cards[perm.cards[0] as usize].owner;
        let mut pids: Vec<i32> = Vec::new();
        any_static(e, |st| {
            if matches!(st.m, StaticMod::AttackMeFirst) && st.controller != owner {
                let pid = e.s.cards[st.src as usize].pid;
                if can_attack_base(e, perm, &Target::Creature(pid)) {
                    pids.push(pid);
                }
            }
            false
        });
        if !pids.is_empty() {
            return matches!(target, Target::Creature(p) if pids.contains(p));
        }
    }
    true
}

/// 「各ターン1度までしか、クリーチャーで攻撃もブロックもできない」の制限で、もう動けないか
fn acts_limited(e: Env, player: PlayerId) -> bool {
    if !e.s.effects.iter().any(|ef| ef.m == EffectMod::OncePerTurnActs && ef.controller != player) {
        return false;
    }
    let mut n = 0;
    for ev in &e.s.turn_log {
        if (ev.ty == s::ATTACK_DECLARED || ev.ty == s::BLOCKED) && ev.int(s::OWNER) == Some(player as i64) {
            n += 1;
        }
    }
    n >= 1
}

/// 「表記コストが n のクリーチャーは、攻撃もブロックもできない」(♪やせ蛙)に当たるか
fn cost_locked(e: Env, uid: i32) -> bool {
    if e.s.effects.is_empty() {
        return false;
    }
    let owner = e.s.cards[uid as usize].owner;
    e.s.effects.iter().any(|ef| matches!(ef.m, EffectMod::CannotActCost(n) if ef.controller != owner && cost_base(e, uid) == n))
}

/// ガードマン: 攻撃先が自分のクリーチャーの時に、ブロッカーのかわりにその攻撃先を変更できるか
pub fn can_guard(e: Env, perm: &Perm) -> bool {
    if perm.tapped {
        return false;
    }
    let uid = perm.cards[0];
    if e.s.sealed && is_sealed(e, uid) {
        return false;
    }
    if cost_locked(e, uid) {
        return false;
    }
    if has_effect(e, perm.pid, &EffectMod::CannotBlock) {
        return false;
    }
    if acts_limited(e, e.s.cards[uid as usize].owner) {
        return false;
    }
    if !chars_lite(e, uid, -1).ty.is_creature() {
        return false;
    }
    has_self_static(e, uid, |m| matches!(m, StaticMod::Guardman))
}

fn can_attack_base(e: Env, perm: &Perm, target: &crate::state::Target) -> bool {
    crate::prof!(13);
    use crate::state::Target;
    let s = e.s;
    let uid = perm.cards[0];
    if !chars_lite(e, uid, -1).ty.is_creature() {
        return false; // タマシード・フィールド・クロスギアは攻撃できない
    }
    let owner = s.cards[uid as usize].owner;
    if s.sealed && is_sealed(e, uid) {
        return false;
    }
    if acts_limited(e, owner) {
        return false;
    }
    if !s.effects.is_empty() && s.effects.iter().any(|ef| ef.m == EffectMod::CannotAttackAny && ef.controller != owner) {
        return false;
    }
    if cost_locked(e, uid) {
        return false;
    }
    if perm.tapped {
        return false;
    }
    // 「相手のクリーチャーは、出たターン攻撃できない」(聖カオスマントラ)
    if perm.entered_turn == s.turn && game_has(e, Feat::NoAttackOnEntry) && any_static(e, |st| matches!(st.m, StaticMod::NoAttackOnEntry) && st.controller != owner) {
        return false;
    }
    if has_effect(e, perm.pid, &EffectMod::CannotAttack) {
        return false;
    }
    if has_self_static(e, uid, |m| matches!(m, StaticMod::CannotAttack)) {
        return false;
    }
    if matches!(target, Target::Player) && has_self_static(e, uid, |m| matches!(m, StaticMod::CannotAttackPlayer)) {
        return false;
    }
    let speed = has_keyword(e, perm, Kw::SpeedAttacker);
    let mach = has_keyword(e, perm, Kw::MachFighter);
    let sick = is_sick(e, perm);
    // 「出たターンに相手プレイヤーを攻撃できる」(ヘルトッQ): プレイヤーだけ。クリーチャーは攻撃できない
    let player_only = sick && !speed && !mach && has_self_static(e, uid, |m| matches!(m, StaticMod::AttackPlayerOnEntry));
    if sick && !speed && !mach && !player_only {
        return false;
    }
    match target {
        Target::Player => {
            if sick && !speed && !player_only {
                return false; // マッハファイターは出たターン、プレイヤーを攻撃できない
            }
            if player_attack_blocked_by_entry(e, perm, owner) {
                return false;
            }
            // 「自分は、このクリーチャーよりパワーが小さいクリーチャーに攻撃されない」(大樹王 ギガンディダノス)
            if game_has(e, Feat::ProtectPlayerFromWeaker) {
                let atk_power = power_of(e, perm);
                let blocked = any_static(e, |st| {
                    if matches!(st.m, StaticMod::ProtectPlayerFromWeaker) && st.controller != owner {
                        if let Some(sp) = s.perm(s.cards[st.src as usize].pid) {
                            return atk_power < power_of(e, sp);
                        }
                    }
                    false
                });
                if blocked {
                    return false;
                }
            }
            true
        }
        Target::Creature(pid) => {
            if player_only {
                return false;
            }
            let (towner, ti) = match s.perm_by_pid(*pid) {
                Some(x) => x,
                None => return false,
            };
            if towner == owner {
                return false;
            }
            let tperm = &s.players[towner as usize].battle[ti];
            if !can_be_attacked(e, tperm) {
                return false;
            }
            // 飛行: 飛行を持たないクリーチャーからは、攻撃されない
            if game_has(e, Feat::Flying)
                && has_self_static(e, tperm.cards[0], |m| matches!(m, StaticMod::Flying))
                && !has_self_static(e, uid, |m| matches!(m, StaticMod::Flying))
            {
                return false;
            }
            if tperm.tapped {
                return true;
            }
            // アンタップ状態のクリーチャーは、出たターンのマッハファイターだけが攻撃できる
            sick && mach
        }
    }
}

pub fn can_block(e: Env, perm: &Perm) -> bool {
    if perm.tapped {
        return false;
    }
    let uid = perm.cards[0];
    if e.s.sealed && is_sealed(e, uid) {
        return false;
    }
    if cost_locked(e, uid) {
        return false;
    }
    if has_effect(e, perm.pid, &EffectMod::CannotBlock) {
        return false;
    }
    if acts_limited(e, e.s.cards[uid as usize].owner) {
        return false;
    }
    if !chars_lite(e, uid, -1).ty.is_creature() {
        return false;
    }
    has_keyword(e, perm, Kw::Blocker)
}

/// ブロックを強制する効果を受けているか(総合ルール 507.1b)
pub fn must_block(e: Env, perm: &Perm) -> bool {
    has_effect(e, perm.pid, &EffectMod::MustBlock)
}

// ───────────────────────── コスト ─────────────────────────

/// 召喚・詠唱するカードの最終コスト(0未満にならない)。
pub fn cost_of(e: Env, uid: i32, face_idx: i32, taps: &[i32], free: bool) -> i32 {
    cost_of_once(e, uid, face_idx, taps, free, &mut Vec::new())
}

/// cost_of に加えて、「各ターンに1度」の軽減を使った発生源を once に集める(使ったと記録するのは、実際に使う側)
pub fn cost_of_once(e: Env, uid: i32, face_idx: i32, taps: &[i32], free: bool, once: &mut Vec<i32>) -> i32 {
    crate::prof!(12);
    let s = e.s;
    let card = &s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let face = def.faces.get(face_idx as usize).unwrap_or(&def.faces[0]);
    if free {
        return 0;
    }
    let mut cost = face.cost;
    let info = e.reg.info(card.def, face_idx);
    if info.sympathy {
        // 「ただしコストは0以下にはならない」(軽減が働いた時だけ。マナが0枚なら軽減されない)
        let before = cost;
        cost = (cost - s.players[card.owner as usize].mana.len() as i32).max(before.min(1));
    }
    if info.hyper_energy && !taps.is_empty() {
        // 「ただしコストは0以下にはならない」(軽減が働いた時だけ。元が0なら0のまま)
        let before = cost;
        cost = (cost - 2 * taps.len() as i32).max(before.min(1));
    }
    if !info.self_costs.is_empty() {
        let cc = CC::new(e, card.owner).with_self(uid);
        let fc = e.reg.face(card.def, face_idx);
        for &si in &info.self_costs {
            if let Ability::SelfCost { delta, cond, floor } = &fc.abilities[si as usize] {
                if let Some(cn) = cond {
                    if !eval_cond(&cc, cn) {
                        continue;
                    }
                }
                cost += eval_expr(&cc, delta) as i32;
                if let Some(fl) = floor {
                    if cost < *fl {
                        cost = *fl;
                    }
                }
            }
        }
    }
    // 「このターン、次に召喚する自分のクリーチャーのコストを少なくする」
    if !s.effects.is_empty() && face.ty.is_creature() {
        for ef in &s.effects {
            if let EffectMod::NextSummon { delta, .. } = ef.m {
                if ef.controller == card.owner {
                    // 「ただしコストは0以下にはならない」(軽減が働いた時だけ。元が0なら0のまま)
                    let before = cost;
                    cost = (cost + delta).max(before.min(1));
                }
            }
        }
    }
    any_static(e, |st| {
        if let StaticMod::CostDelta { delta, cond, once_per_turn, floor } = st.m {
            if st.controller == card.owner {
                if *once_per_turn && s.usage_get(&UKey::Other(format!("cd:{}", st.src))) == Some(s.turn as i64) {
                    return false;
                }
                let cc = CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx);
                if eval_cond(&cc, cond) {
                    cost += eval_expr(&cc, delta) as i32;
                    if let Some(fl) = floor {
                        if cost < *fl {
                            cost = *fl;
                        }
                    }
                    if *once_per_turn {
                        once.push(st.src);
                    }
                }
            }
        }
        false
    });
    cost.max(0)
}

/// 実際にタップするマナの枚数(文明の数を下回らない)
pub fn pay_need(cost: i32, civ_count: i32) -> i32 {
    cost.max(civ_count).max(0)
}

const ALL_CIVS: [Civ; 5] = [Civ::Light, Civ::Water, Civ::Darkness, Civ::Fire, Civ::Nature];

/// マナの支払いに使える、アンタップのカード(マナゾーンのカードと、「タップしてマナとして使える」クリーチャー)
pub fn mana_sources(e: Env, player: PlayerId, exclude: &[i32]) -> Vec<i32> {
    let s = e.s;
    let mut out: Vec<i32> = s.players[player as usize].mana.iter().copied().filter(|u| !s.cards[*u as usize].tapped && !exclude.contains(u)).collect();
    if game_has(e, Feat::TapAsMana) {
        for perm in &s.players[player as usize].battle {
            let u = perm.cards[0];
            if !perm.tapped && !exclude.contains(&u) && has_self_static(e, u, |m| matches!(m, StaticMod::TapAsMana)) {
                out.push(u);
            }
        }
    }
    out
}

/// マナの支払いに使う時の文明(「すべての文明を持つかのように」使えるクリーチャーは、すべて)
pub fn source_civs<'a>(e: Env<'a>, uid: i32) -> &'a [Civ] {
    if e.s.cards[uid as usize].zone == Zone::Battle {
        return &ALL_CIVS;
    }
    mana_civs(e, uid)
}

pub fn mana_civs<'a>(e: Env<'a>, uid: i32) -> &'a [Civ] {
    let card = &e.s.cards[uid as usize];
    // 「自分のマナゾーンにあるカードは、すべての文明を持つ」(怪盗妖精カサブランカ)
    if card.zone == Zone::Mana && game_has(e, Feat::ManaAllCivs) && any_static(e, |st| matches!(st.m, StaticMod::ManaAllCivs) && st.controller == card.owner) {
        return &ALL_CIVS;
    }
    chars_lite(e, uid, -1).civs
}

/// 払えるか(plan_payment が Some を返す条件と同じ)だけを調べる。どのマナを払うかは計算しない(確保もしない)。
pub fn can_pay(e: Env, player: PlayerId, civs: &[Civ], need: i32, exclude: &[i32]) -> bool {
    if need <= 0 {
        return true;
    }
    if game_has(e, Feat::TapAsMana) {
        return plan_payment(e, player, civs, need, exclude, &[]).is_some();
    }
    let s = e.s;
    let mut masks = [0u8; 32];
    let mut n = 0usize;
    for &u in &s.players[player as usize].mana {
        if s.cards[u as usize].tapped || exclude.contains(&u) {
            continue;
        }
        if n >= masks.len() {
            return plan_payment(e, player, civs, need, exclude, &[]).is_some();
        }
        let mut m = 0u8;
        for c in mana_civs(e, u) {
            m |= 1 << (*c as u8);
        }
        masks[n] = m;
        n += 1;
    }
    let total = need.max(civs.len() as i32);
    if (n as i32) < total {
        return false;
    }
    // 文明ごとに、その文明を持つ別々のマナを1枚ずつ割り当てられるか
    fn go(i: usize, civs: &[Civ], masks: &[u8], used: u32) -> bool {
        if i == civs.len() {
            return true;
        }
        let bit = 1u8 << (civs[i] as u8);
        for (j, m) in masks.iter().enumerate() {
            if used & (1 << j) != 0 || m & bit == 0 {
                continue;
            }
            if go(i + 1, civs, masks, used | (1 << j)) {
                return true;
            }
        }
        false
    }
    go(0, civs, &masks[..n], 0)
}

/// マナの支払いの割り当て。必要な文明ごとに1枚(1枚のマナは1文明)+残りは数値で支払う。
/// 手札の他のカードの文明条件を残しやすいように、価値の低いマナからタップする。払えなければ None。
pub fn plan_payment(e: Env, player: PlayerId, civs: &[Civ], need: i32, exclude: &[i32], keep_for: &[i32]) -> Option<Vec<i32>> {
    crate::prof!(11);
    if need <= 0 {
        return Some(vec![]);
    }
    let avail: Vec<i32> = mana_sources(e, player, exclude);
    if (avail.len() as i32) < need {
        return None;
    }
    // 価値(残したいほど高い)
    let mut want = [0i32; 5];
    for &h in keep_for {
        for civ in chars_lite(e, h, -1).civs {
            want[*civ as usize] += 1;
        }
    }
    let mut mc: Vec<(i32, &[Civ])> = Vec::with_capacity(avail.len());
    let mut value: Vec<(i32, f64)> = Vec::with_capacity(avail.len());
    for &u in &avail {
        let cs = source_civs(e, u);
        mc.push((u, cs));
        let mut v = 0.01 * cs.len() as f64;
        for cv in cs {
            v += want[*cv as usize] as f64;
        }
        value.push((u, v));
    }
    let val_of = |u: i32| value.iter().find(|(x, _)| *x == u).unwrap().1;
    let civs_of = |u: i32| mc.iter().find(|(x, _)| *x == u).unwrap().1;
    let mut sorted = avail.clone();
    sorted.sort_by(|a, b| val_of(*a).partial_cmp(&val_of(*b)).unwrap_or(std::cmp::Ordering::Equal));
    // 文明ごとの割り当て(マッチング)。1文明につき、その文明を持つ別々のマナ1枚。
    let k = civs.len();
    let cands: Vec<Vec<i32>> = civs.iter().map(|cv| sorted.iter().copied().filter(|u| civs_of(*u).contains(cv)).collect()).collect();
    if cands.iter().any(|l| l.is_empty()) {
        return None;
    }
    // 解の探索(価値の合計が最小になる割り当て。ノード数に上限)
    let mut order: Vec<usize> = (0..k).collect();
    order.sort_by(|a, b| cands[*a].len().cmp(&cands[*b].len()));
    struct Dfs<'x> {
        cands: &'x [Vec<i32>],
        order: &'x [usize],
        k: usize,
        best: Option<Vec<i32>>,
        best_score: f64,
        nodes: i32,
        chosen: Vec<i32>,
    }
    fn dfs(d: &mut Dfs, i: usize, score: f64, val_of: &dyn Fn(i32) -> f64) {
        d.nodes += 1;
        if d.nodes - 1 > 3000 {
            return;
        }
        if score >= d.best_score {
            return;
        }
        if i == d.k {
            d.best = Some(d.chosen.clone());
            d.best_score = score;
            return;
        }
        let list = &d.cands[d.order[i]];
        for idx in 0..list.len() {
            let u = d.cands[d.order[i]][idx];
            if d.chosen.contains(&u) {
                continue;
            }
            d.chosen.push(u);
            dfs(d, i + 1, score + val_of(u), val_of);
            d.chosen.pop();
        }
    }
    let mut d = Dfs { cands: &cands, order: &order, k, best: None, best_score: f64::INFINITY, nodes: 0, chosen: Vec::new() };
    dfs(&mut d, 0, 0.0, &val_of);
    let mut result: Vec<i32>;
    if let Some(b) = d.best {
        result = b;
    } else {
        // 上限に達して見つからなかった場合の、確実な二部マッチング(増加路)
        let mut match_of: Vec<(i32, usize)> = Vec::new();
        fn try_aug(ci: usize, seen: &mut Vec<i32>, cands: &[Vec<i32>], match_of: &mut Vec<(i32, usize)>) -> bool {
            for &u in &cands[ci] {
                if seen.contains(&u) {
                    continue;
                }
                seen.push(u);
                let cur = match_of.iter().find(|(x, _)| *x == u).map(|(_, c)| *c);
                let ok = match cur {
                    None => true,
                    Some(c) => try_aug(c, seen, cands, match_of),
                };
                if ok {
                    if let Some(e) = match_of.iter_mut().find(|(x, _)| *x == u) {
                        e.1 = ci;
                    } else {
                        match_of.push((u, ci));
                    }
                    return true;
                }
            }
            false
        }
        for i in 0..k {
            let mut seen = Vec::new();
            if !try_aug(i, &mut seen, &cands, &mut match_of) {
                return None;
            }
        }
        result = match_of.iter().map(|(u, _)| *u).collect();
    }
    let total = need.max(k as i32);
    if (avail.len() as i32) < total {
        return None;
    }
    for &u in &sorted {
        if result.len() as i32 >= total {
            break;
        }
        if !result.contains(&u) {
            result.push(u);
        }
    }
    Some(result)
}

// ───────────────────────── 呪文の制限 ─────────────────────────

/// そのクリーチャーは、離れない効果を受けているか
pub fn cannot_leave(e: Env, uid: i32, cause: Option<Sym>) -> bool {
    let card = &e.s.cards[uid as usize];
    if card.zone != Zone::Battle {
        return false;
    }
    if !e.s.effects.is_empty() && e.s.effects.iter().any(|ef| ef.pid == card.pid && ef.m == EffectMod::CannotLeave) {
        return true;
    }
    if !game_has(e, Feat::CannotLeaveOwn) {
        return false;
    }
    any_static(e, |st| {
        if let StaticMod::CannotLeaveOwn { cond, except_destroy } = st.m {
            if st.controller != card.owner {
                return false;
            }
            if *except_destroy && cause == Some(s::DESTROY) {
                return false;
            }
            return eval_cond(&CC::new(e, st.controller).with_self(st.src).with_it(uid, card.face), cond);
        }
        false
    })
}

/// クロスのコスト(クロスギアのマナコストをもう一度払う。コスト軽減の効果も受ける)と文明
/// このクロスギアを、コストを支払わずにこのクリーチャーにクロスしてもよいか(FreeCrossTo)
pub fn free_cross_to(e: Env, gear: i32, host: i32) -> bool {
    let hface = e.s.cards[host as usize].face;
    any_static(e, |st| {
        if let StaticMod::FreeCrossTo { cond } = st.m {
            if st.src == gear {
                return eval_cond(&CC::new(e, st.controller).with_self(st.src).with_it(host, hface), cond);
            }
        }
        false
    })
}

pub fn cross_cost(e: Env, gear: i32) -> (i32, Rc<Vec<Civ>>) {
    let card = &e.s.cards[gear as usize];
    let fi = chars_lite(e, gear, -1).face_idx;
    (cost_of(e, gear, fi, &[], false), e.reg.face(card.def, fi).civs.clone())
}

/// 「相手は、〜のカードを使えない」(超球の超人)に当たらないか。召喚・唱える・出すのすべてに働く
pub fn can_play_card(e: Env, player: PlayerId, uid: i32, face_idx: i32) -> bool {
    if !game_has(e, Feat::CannotPlay) {
        return true;
    }
    !any_static(e, |st| {
        if let StaticMod::CannotPlay { cond } = st.m {
            if st.controller != player {
                return eval_cond(&CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx), cond);
            }
        }
        false
    })
}

/// プレイヤーがこの呪文(面)を唱えられるか(ドルファディロムの制限など)
pub fn can_cast(e: Env, player: PlayerId, uid: i32, face_idx: i32) -> bool {
    let s = e.s;
    // 「相手は、自身のターンに1回までしか呪文を唱えられない」(ジョギラゴン&ジョニー)
    if game_has(e, Feat::OneSpellPerTurn) && s.active == player && any_static(e, |st| matches!(st.m, StaticMod::OneSpellPerTurn) && st.controller != player) {
        if s.turn_log.iter().any(|ev| ev.ty == s::CAST && ev.int(s::OWNER) == Some(player as i64)) {
            return false;
        }
    }
    // 「呪文を唱えられなくする効果を無視して、〜を唱えてもよい」(卍 新世壊 卍)
    let ignore = any_static(e, |st| {
        if let StaticMod::IgnoreCastBan { cond } = st.m {
            if st.controller == player {
                return eval_cond(&CC::new(e, player).with_self(st.src).with_it(uid, face_idx), cond);
            }
        }
        false
    });
    if ignore {
        return true;
    }
    // 「次の自分のターンのはじめまで、相手は呪文を唱えられない」(XXDDZ)。n があれば、そのコストの呪文だけ
    if !s.effects.is_empty() {
        let cost = e.reg.defs[s.cards[uid as usize].def as usize].faces.get(face_idx as usize).map_or(0, |f| f.cost);
        for ef in &s.effects {
            if ef.controller == player {
                continue;
            }
            match ef.m {
                EffectMod::CannotCast(n) if n.map_or(true, |n| n == cost) => return false,
                EffectMod::CannotCastLte(n) if cost <= n => return false,
                _ => {}
            }
        }
    }
    // 「相手は〜できない」(自分の常在能力は対象外)
    !any_static(e, |st| {
        if let StaticMod::CannotCast { cond } = st.m {
            if st.controller != player {
                let cc = CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx);
                return eval_cond(&cc, cond);
            }
        }
        false
    })
}

/// 「自分のターン中、〜を from のゾーンから召喚してもよい」(allowPlayFrom)で、このカードを from から召喚できる発生源。なければ None。
pub fn granted_play_from(e: Env, player: PlayerId, uid: i32, face_idx: i32, from: Zone) -> Option<i32> {
    let s = e.s;
    // 冒険妖精ポレキチ: このターン、そのクリーチャーをマナゾーンから召喚してもよい
    if from == Zone::Mana && s.active == player && s.usage_get(&UKey::Other(format!("pm:{}:{}", uid, s.cards[uid as usize].ep))) == Some(s.turn as i64) {
        return Some(uid);
    }
    if s.active != player || !game_has(e, Feat::AllowPlayFrom) {
        return None;
    }
    if from == Zone::Deck && s.players[player as usize].deck.first() != Some(&uid) {
        return None; // 山札から召喚できるのは、一番上のカードだけ
    }
    let mut found: Option<i32> = None;
    any_static(e, |st| {
        if let StaticMod::AllowPlayFrom { from: z, cond, once_per_turn, .. } = st.m {
            if st.controller != player || *z != from {
                return false;
            }
            if *once_per_turn && s.usage_get(&UKey::Other(format!("gp:{}", st.src))) == Some(s.turn as i64) {
                return false;
            }
            if let Some(cn) = cond {
                if !eval_cond(&CC::new(e, player).with_self(st.src).with_it(uid, face_idx), cn) {
                    return false;
                }
            }
            found = Some(st.src);
            return true;
        }
        false
    });
    found
}

/// allowPlayFrom の発生源が、アビスラッシュを与えているか
pub fn grants_rush(e: Env, src: i32) -> bool {
    let info = info_of(e, src);
    let card = &e.s.cards[src as usize];
    let face = e.reg.face(card.def, chars_lite(e, src, -1).face_idx);
    info.statics.iter().any(|&si| matches!(&face.abilities[si as usize], Ability::Static { m: StaticMod::AllowPlayFrom { rush: true, .. }, .. }))
}

/// そのカードを召喚してよいか(「すべてのプレイヤーは、パワー5000以下のクリーチャーを召喚できない」と、召喚封じ(can_summon))
pub fn can_summon_card(e: Env, player: PlayerId, uid: i32, face_idx: i32) -> bool {
    if game_has(e, Feat::CannotSummonAll) {
        let blocked = any_static(e, |st| {
            if let StaticMod::CannotSummonAll { cond } = st.m {
                return eval_cond(&CC::new(e, st.controller).with_self(st.src).with_it(uid, face_idx), cond);
            }
            false
        });
        if blocked {
            return false;
        }
    }
    can_summon(e, player, e.reg.defs[e.s.cards[uid as usize].def as usize].faces.get(face_idx as usize).map_or(0, |f| f.cost))
}

/// 「相手はコストが cost 以下のクリーチャーを召喚できない」(ミラダンテXII のファイナル革命)に当たらないか
pub fn can_summon(e: Env, player: PlayerId, cost: i32) -> bool {
    !e.s.effects.iter().any(|ef| matches!(ef.m, EffectMod::CannotSummon(n) if cost <= n) && ef.controller != player)
}

/// 「相手はそのコストのカードを実行できない」(オーパーツ銃のファイナル革命)に当たらないか
pub fn can_use_cost(e: Env, player: PlayerId, cost: i32) -> bool {
    !e.s.effects.iter().any(|ef| matches!(ef.m, EffectMod::CannotUseCost(n) if n == cost) && ef.controller != player)
}

// ───────────────────────── スナップショット ─────────────────────────

pub fn snap_of(e: Env, uid: i32) -> Snap {
    let card = &e.s.cards[uid as usize];
    let def = &e.reg.defs[card.def as usize];
    let in_play = card.zone == Zone::Battle || card.zone == Zone::Limbo;
    let face = if in_play { def.faces.get(card.face as usize).unwrap_or(&def.faces[0]) } else { &def.faces[0] };
    let civs: Rc<Vec<Civ>> = if in_play { face.civs.clone() } else { def.union_civs.clone() };
    Snap {
        uid,
        def: card.def,
        owner: card.owner,
        face: card.face,
        zone: card.zone,
        multicolor: civs.len() > 1,
        civs,
        cost: face.cost,
        power: face.power.unwrap_or(0),
        pid: card.pid,
    }
}
