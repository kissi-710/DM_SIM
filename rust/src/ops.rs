//! 原始操作(src/engine/ops.ts): イベント発行・誘発の収集・ゾーン移動・置換パイプライン。
//! 規約: 入力待ち(ask)は、状態を変更する前に行う。再実行しても二重に変更されない。

use crate::ast::*;
use crate::cond::*;
use crate::derive::*;
use crate::registry::{Face, Feat, Registry};
use crate::types::*;
use std::rc::Rc;

pub enum Stop {
    Need(NeedInput),
    Fail(String),
}

pub type Res<T> = Result<T, Stop>;

pub fn fail<T>(m: impl Into<String>) -> Res<T> {
    Err(Stop::Fail(m.into()))
}

pub struct Ctx<'a> {
    pub s: State,
    pub reg: &'a Registry,
    /// この step で発生したイベント
    pub out: Vec<Rc<Ev>>,
    /// 入力待ちの回答を消費する位置
    pub ask_idx: usize,
    /// 「質問は変更の前に行う」規約の検査用
    pub rng0: i32,
    pub seq0: i32,
    /// 現在の因果の元(イベント ID or フレーム ID)
    pub cause: Option<i32>,
    /// この step のイベントを out に集めるか(プレイアウトでは不要)
    pub keep_out: bool,
}

impl<'a> Ctx<'a> {
    pub fn new(s: State, reg: &'a Registry) -> Ctx<'a> {
        let (rng0, seq0) = (s.rng, s.seq);
        Ctx { s, reg, out: Vec::new(), ask_idx: 0, rng0, seq0, cause: None, keep_out: true }
    }
    pub fn env(&self) -> Env<'_> {
        Env { s: &self.s, reg: self.reg }
    }
}

/// そのイベントの種類を監視する能力が、対局のデッキのカードにあるか(なければ、イベントを発行しない)。
/// TS 版(ops.ts の listens)と同じ: デッキが分からない状態では、カードDB全体で調べる
pub fn listens(c: &Ctx, ty: Sym) -> bool {
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

/// バトルゾーンの一番上のカードの、使用中の面
pub fn top_face<'a>(e: Env<'a>, uid: i32) -> &'a Face {
    let card = &e.s.cards[uid as usize];
    e.reg.face(card.def, chars_lite(e, uid, -1).face_idx)
}

/// 効果フレームを積む(手順を行う)。出る時の置換の「その後」・かわりの手順・山札がない時の置換などで使う
pub fn push_effect(c: &mut Ctx, ability: AbilityRef, source: ObjRef, controller: PlayerId, trigger: Option<Rc<Ev>>, no_optional: bool) {
    let lki = Rc::new(snap_of(c.env(), source.uid));
    let id = c.s.next_id();
    c.s.cont.push(Frame::Effect(EffectFrame { id, caused_by: c.cause, ability, source, lki, controller, pc: 0, vars: Vec::new(), trigger, no_optional }));
}

/// 置換の対象の持ち主・使い手の関係(want: self / opponent / any。pl = 置換を持つカードの持ち主)
fn rel_pl(want: Option<Rel>, actual: PlayerId, pl: PlayerId) -> bool {
    match want {
        None | Some(Rel::Any) => true,
        Some(Rel::Self_) => actual == pl,
        Some(Rel::Opponent) => actual != pl,
    }
}

/// クリーチャーが召喚された後の処理: 「このターン、次に召喚する自分のクリーチャー」の効果を使い切る。
/// sa の効果は、召喚されたクリーチャーに、そのターンのスピードアタッカーを与える。
pub fn on_summoned(c: &mut Ctx, uid: i32) {
    if c.s.effects.is_empty() {
        return;
    }
    let (owner, zone, pid) = {
        let card = &c.s.cards[uid as usize];
        (card.owner, card.zone, card.pid)
    };
    let mine: Vec<bool> = c.s.effects.iter().filter_map(|e| if let EffectMod::NextSummon { sa, .. } = e.m { if e.controller == owner { Some(sa) } else { None } } else { None }).collect();
    if mine.is_empty() {
        return;
    }
    c.s.effects.retain(|e| !(matches!(e.m, EffectMod::NextSummon { .. }) && e.controller == owner));
    if zone == Zone::Battle && mine.iter().any(|&sa| sa) {
        let id = c.s.next_id();
        let turn = c.s.turn;
        c.s.effects.push(ContEffect { id, pid, m: EffectMod::Grant(s::KW_SPEED_ATTACKER), until: Duration::EndOfTurn { turn }, controller: owner });
    }
}

/// 封印を1つ墓地に置く: owner の、cmd_civs と同じ文明を持つ封印されたクリーチャーのそれぞれから、封印を1つ
fn release_seals(c: &mut Ctx, owner: PlayerId, cmd_civs: &[Civ], evs: &mut Vec<Rc<Ev>>) {
    let n = c.s.players[owner as usize].battle.len();
    for i in 0..n {
        if c.s.players[owner as usize].battle[i].seals.is_empty() {
            continue;
        }
        let top = c.s.players[owner as usize].battle[i].cards[0];
        let civs = top_face(c.env(), top).civs.clone();
        if !civs.iter().any(|x| cmd_civs.contains(x)) {
            continue;
        }
        let u = c.s.players[owner as usize].battle[i].seals.remove(0);
        let usnap = Rc::new(snap_of(c.env(), u));
        let uowner = c.s.cards[u as usize].owner;
        {
            let uc = &mut c.s.cards[u as usize];
            uc.zone = Zone::Grave;
            uc.ep += 1;
            uc.pid = -1;
        }
        c.s.players[uowner as usize].grave.push(u);
        evs.push(emit(
            c,
            s::MOVED,
            vec![
                (s::CARD, Val::Int(u as i64)),
                (s::OWNER, Val::Int(uowner as i64)),
                (s::FROM, Val::zone(Zone::Battle)),
                (s::TO, Val::zone(Zone::Grave)),
                (sym("cause"), Val::Str(sym("sealRelease"))),
                (s::KIND, Val::Str(s::CREATURE)),
                (s::EX, Val::Bool(false)),
                (s::LKI, Val::Snap(usnap)),
                (s::UNDERNEATH, Val::Bool(true)),
            ],
        ));
    }
}

/// カードを、持ち主の山札の上から depth 枚目の位置に、横向きに刺す(終葬 5.S.D.)。横向きのカードを手札に加えたプレイヤーは、ゲームに負ける
pub fn stab_into_deck(c: &mut Ctx, uids: &[i32], depth: i32) {
    let mut evs: Vec<Rc<Ev>> = Vec::new();
    for &uid in uids {
        let (from, owner) = {
            let card = &c.s.cards[uid as usize];
            (card.zone, card.owner)
        };
        let snap = Rc::new(snap_of(c.env(), uid));
        remove_from_zone(c, uid);
        let n = c.s.players[owner as usize].deck.len();
        c.s.players[owner as usize].deck.insert(((depth - 1).max(0) as usize).min(n), uid);
        {
            let card = &mut c.s.cards[uid as usize];
            card.zone = Zone::Deck;
            card.ep += 1;
            card.pid = -1;
            card.tapped = false;
            card.ex = false;
            card.ex_pid = -1;
            card.face = 0;
            card.up = false;
            card.side = true;
        }
        evs.push(emit(
            c,
            s::MOVED,
            vec![
                (s::CARD, Val::Int(uid as i64)),
                (s::OWNER, Val::Int(owner as i64)),
                (s::FROM, Val::zone(from)),
                (s::TO, Val::zone(Zone::Deck)),
                (sym("cause"), Val::Str(sym("stab"))),
                (s::KIND, Val::Str(s::CREATURE)),
                (s::EX, Val::Bool(false)),
                (s::LKI, Val::Snap(snap)),
            ],
        ));
    }
    c.s.batch_no += 1;
    collect_batch(c, &evs);
    c.s.dirty_sba = true;
}

/// カードをいまのゾーンから取り除く(置き先は呼び出し側が決める)
pub fn remove_zone_card(c: &mut Ctx, uid: i32) {
    remove_from_zone(c, uid);
}

// ───────────────────────── 質問(ask) ─────────────────────────

/// 入力を求める。回答が揃っていれば返し、無ければ Need を返して drive に止めさせる。
pub fn ask(c: &mut Ctx, spec: NeedInput) -> Res<Val> {
    if c.ask_idx < c.s.rans.len() {
        let v = c.s.rans[c.ask_idx].clone();
        c.ask_idx += 1;
        return Ok(v);
    }
    if c.s.rng != c.rng0 || c.s.seq != c.seq0 {
        return fail(format!("内部エラー: 状態を変更した後に入力を求めました({})", spec.why.name()));
    }
    Err(Stop::Need(spec))
}

// ───────────────────────── イベント ─────────────────────────

pub fn emit(c: &mut Ctx, ty: Sym, payload: Vec<(Sym, Val)>) -> Rc<Ev> {
    crate::prof!(17);
    let id = c.s.next_id();
    let ev = Rc::new(Ev { id, caused_by: c.cause, ty, turn: c.s.turn, f: payload });
    if c.keep_out {
        c.out.push(ev.clone());
    }
    c.s.turn_log.push(ev.clone());
    ev
}

fn ability_val(reg: &Registry, a: AbilityRef) -> Val {
    Val::Obj(Rc::new(vec![
        (s::DEFID, Val::Str(reg.id_syms[a.def as usize])),
        (s::FACE, Val::Int(a.face as i64)),
        (s::IDX, Val::Int(a.idx as i64)),
    ]))
}

// ───────────────────────── 誘発の収集(effects 5.1) ─────────────────────────

/// イベントを監視している能力を探して、待機プールに入れる。
pub fn collect(c: &mut Ctx, ev: &Rc<Ev>) {
    crate::prof!(16);
    let reg = c.reg;
    let by_def = match reg.trig_by_def.get(ev.ty.0 as usize) {
        Some(Some(b)) => b,
        _ => return,
    };
    let batch = c.s.batch_no;
    // 誘発能力を持つ定義のカードだけを、uid の昇順で調べる(全カードの走査と同じ順序)
    let mut cands: Vec<usize> = Vec::new();
    if let Some(Some(defs)) = reg.trig_defs.get(ev.ty.0 as usize) {
        // 定義ごとのカード一覧は、複製せずに借りて、uid だけを取り出す
        let by = &c.s.cards_by_def;
        for &d in defs {
            cands.extend(by[d as usize].iter().map(|&u| u as usize));
        }
    }
    cands.sort_unstable();
    for uid in cands {
        let (def, zone, face) = {
            let card = &c.s.cards[uid];
            (card.def, card.zone, card.face)
        };
        let refs = &by_def[def as usize];
        if refs.is_empty() {
            continue;
        }
        // バトルゾーンでは山の一番上だけが能力を持つ
        if zone == Zone::Battle {
            let pid = c.s.cards[uid].pid;
            match c.s.perm(pid) {
                Some(pm) if pm.cards[0] == uid as i32 => {}
                _ => continue,
            }
            if !c.s.effects.is_empty() && is_ignored(c.env(), uid as i32) {
                continue; // 能力を無視されている
            }
        }
        for r in refs {
            let spec = match &reg.defs[r.def as usize].faces[r.face as usize].abilities[r.idx as usize] {
                Ability::Trigger { spec, .. } => spec,
                _ => continue,
            };
            let watch_ok = match &spec.watch {
                Some(w) => w.contains(&zone),
                None => zone == Zone::Battle,
            };
            if !watch_ok {
                continue;
            }
            // 使用中の面(バトルゾーン)。場以外では面0の能力だけが働く
            if zone == Zone::Battle {
                if r.face as i32 != face {
                    continue;
                }
            } else if r.face != 0 {
                continue;
            }
            try_trigger(c, ev, uid as i32, r.face, r.idx, spec, batch);
        }
    }
    // バトルゾーンを離れたカード自身の、離れた時の能力(lookBack)。離れる直前の面の能力を使う
    if ev.ty == s::MOVED && ev.sym_of(s::FROM) == Some(s::Z_BATTLE) && ev.get(s::UNDERNEATH).is_none() {
        if let Some(Val::Snap(lki)) = ev.get(s::LKI) {
            if let Some(uid) = ev.int(s::CARD) {
                let uid = uid as i32;
                let card_zone = c.s.cards[uid as usize].zone;
                let def = c.s.cards[uid as usize].def;
                if card_zone != Zone::Battle {
                    let refs = &by_def[def as usize];
                    for r in refs {
                        let spec = match &reg.defs[r.def as usize].faces[r.face as usize].abilities[r.idx as usize] {
                            Ability::Trigger { spec, .. } => spec,
                            _ => continue,
                        };
                        if !spec.look_back || r.face as i32 != lki.face {
                            continue;
                        }
                        try_trigger(c, ev, uid, r.face, r.idx, spec, batch);
                    }
                }
            }
        }
    }
}

fn try_trigger(c: &mut Ctx, ev: &Rc<Ev>, uid: i32, face: u8, idx: u16, spec: &TriggerSpec, batch: i32) {
    let reg = c.reg;
    let (controller, ep, def) = {
        let card = &c.s.cards[uid as usize];
        (card.owner, card.ep, card.def)
    };
    {
        let e = c.env();
        let snap = snap_of(e, uid);
        let mut cc = CC::new(e, controller).with_self(uid);
        cc.self_snap = Some(&snap);
        if !spec.on.iter().any(|p| match_pattern(&cc, p, ev)) {
            return;
        }
    }
    let ev_card = ev.get(s::CARD).and_then(|v| v.as_int());
    match spec.subject {
        Some(Subject::Self_) if ev_card != Some(uid as i64) => return,
        Some(Subject::Other) if ev_card == Some(uid as i64) => return,
        _ => {}
    }
    match spec.turn {
        Some(TurnSel::Own) if c.s.active != controller => return,
        Some(TurnSel::Opponent) if c.s.active == controller => return,
        _ => {}
    }
    if let Some(nth) = spec.nth_this_turn {
        let mut n = 0;
        for e in &c.s.turn_log {
            if e.ty == ev.ty && e.get(s::OWNER) == ev.get(s::OWNER) && e.get(s::KIND) == ev.get(s::KIND) {
                n += 1;
            }
            if e.id == ev.id {
                break;
            }
        }
        if n != nth {
            return;
        }
    }
    if let Some(nm) = spec.nth_min {
        let mut n = 0;
        for e in &c.s.turn_log {
            if e.ty == ev.ty && e.get(s::OWNER) == ev.get(s::OWNER) && (ev.get(s::CAUSE).is_none() || e.get(s::CAUSE) == ev.get(s::CAUSE)) {
                n += 1;
            }
            if e.id == ev.id {
                break;
            }
        }
        if n < nm {
            return;
        }
    }
    let key = UKey::Lim { uid, ep, face: face as i32, idx: idx as i32, hash: false };
    let kh = UKey::Lim { uid, ep, face: face as i32, idx: idx as i32, hash: true };
    if let Some(per) = spec.limit_per_turn {
        let used = c.s.usage_get(&key);
        if used == Some(c.s.turn as i64) && c.s.usage_get(&kh).unwrap_or(0) >= per as i64 {
            return;
        }
    }
    // spec.if は、誘発した時点では見ない(総合ルール 603.4: 解決の時点で条件を満たしていれば解決される)
    let aref = AbilityRef { def, face, idx };
    // トリガー抑制(キーナリー): 置換効果の一種として処理する。
    if suppresses_trigger(c, ev, uid, controller) {
        return;
    }
    if spec.limit_per_turn.is_some() {
        let turn = c.s.turn as i64;
        if c.s.usage_get(&key) != Some(turn) {
            c.s.usage_set(&kh, 0);
        }
        c.s.usage_set(&key, turn);
        let n = c.s.usage_get(&kh).unwrap_or(0) + 1;
        c.s.usage_set(&kh, n);
    }
    let lki = {
        let e = c.env();
        Rc::new(snap_of(e, uid))
    };
    let id = c.s.next_id();
    let entry = PoolEntry {
        id,
        batch,
        ability: Some(aref),
        kind: PoolKind::Ability,
        source: ObjRef { uid, ep },
        lki,
        controller,
        event: Some(ev.clone()),
        st_layer: false,
        declared: false,
    };
    c.s.pool.push(entry);
    // 「能力がトリガーした時」(オルゲイト)は、実際に誘発した能力だけを見る
    let prev = c.cause;
    let trig = emit(
        c,
        s::ABILITY_TRIGGERED,
        vec![
            (s::ABILITY, ability_val(reg, aref)),
            (s::SOURCE, Val::Int(uid as i64)),
            (s::CONTROLLER, Val::Int(controller as i64)),
            (s::CAUSE, Val::Ev(ev.clone())),
            (s::ENTRY, Val::Int(id as i64)),
        ],
    );
    c.cause = prev;
    collect(c, &trig);
}

/// 相手のクリーチャーが出てその能力がトリガーする時、かわりにトリガーしない(置換効果)
fn suppresses_trigger(c: &Ctx, ev: &Rc<Ev>, src_uid: i32, controller: PlayerId) -> bool {
    if ev.ty != s::ENTERED {
        return false;
    }
    // 出たクリーチャー自身の能力だけが対象
    if ev.get(s::CARD).and_then(|v| v.as_int()) != Some(src_uid as i64) {
        return false;
    }
    let e = c.env();
    let reg = c.reg;
    for p in 0..2u8 {
        for perm in &c.s.players[p as usize].battle {
            let uid = perm.cards[0];
            let info = info_of(e, uid);
            if info.replaces.is_empty() {
                continue;
            }
            let card = &c.s.cards[uid as usize];
            let face = reg.face(card.def, chars_lite(e, uid, -1).face_idx);
            for &ri in &info.replaces {
                if let Ability::Replace { match_, apply: ReplaceApply::CancelTrigger, while_, .. } = &face.abilities[ri as usize] {
                    if let Some(w) = while_ {
                        if !eval_cond(&CC::new(e, p).with_self(uid), w) {
                            continue;
                        }
                    }
                    let cc = CC::new(e, p).with_self(uid);
                    let mut pat = match_.clone();
                    pat.ty = s::ABILITY_TRIGGERED;
                    // {...ev, type: 'abilityTriggered', controller, cause: ev}
                    let mut f: Vec<(Sym, Val)> = ev.f.iter().filter(|(k, _)| *k != s::CONTROLLER && *k != s::CAUSE).cloned().collect();
                    f.push((s::CONTROLLER, Val::Int(controller as i64)));
                    f.push((s::CAUSE, Val::Ev(ev.clone())));
                    let tmp = Ev { id: ev.id, caused_by: ev.caused_by, ty: s::ABILITY_TRIGGERED, turn: ev.turn, f };
                    if !match_pattern(&cc, &pat, &tmp) {
                        continue;
                    }
                    if ev.get(s::OWNER).and_then(|v| v.as_int()) != Some(p as i64) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// 現在のバッチで発生したイベントの誘発をまとめて収集する
pub fn collect_batch(c: &mut Ctx, evs: &[Rc<Ev>]) {
    // 「発生源がいる間」の継続効果は、発生源がゾーンを離れたら失効する(spec 3.13-6)
    if c.s.effects.iter().any(|e| matches!(e.until, Duration::Source { .. })) {
        let cards = &c.s.cards;
        let keep: Vec<ContEffect> = c
            .s
            .effects
            .iter()
            .filter(|e| match e.until {
                Duration::Source { uid, ep } => cards[uid as usize].ep == ep,
                _ => true,
            })
            .cloned()
            .collect();
        c.s.effects = keep;
    }
    for ev in evs {
        collect(c, ev);
    }
}

// ───────────────────────── ゾーン移動 ─────────────────────────

#[derive(Clone, Debug)]
pub struct MoveOpts {
    pub to: Zone,
    pub cause: Sym,
    /// 山札の上/下(deck のみ)。None と Some(true) は上、Some(false) は下
    pub pos: Option<bool>,
    /// 重ねる山(進化・侵略)
    pub onto: Option<i32>,
    pub via: Option<Sym>,
    /// バトルゾーンへ出す時にタップ状態か
    pub tapped: bool,
    /// 支払ったマナの枚数
    pub paid: Option<i32>,
    pub cost: Option<i32>,
    pub free: bool,
    /// 置換を適用しない(置換の結果の出来事)
    pub no_replace: bool,
    pub face: Option<i32>,
    /// 進化・侵略などで下に入るカードを一緒に動かさない
    pub alone: bool,
    /// シールドゾーンへ表向きで置く(G城の実行)
    pub up: bool,
    /// このカードの下に重ねるカード(無月の門・超無限墓地進化など)。バトルゾーンのカードは、その山ごと下に入る
    pub under: Option<Vec<i32>>,
    /// 出す前にいたゾーン(プレイ中は limbo にいるので、元のゾーンを伝える。置換の判定に使う)
    pub from: Option<Zone>,
    /// この移動を起こした効果の使い手(置換の判定に使う。イベントには載せない)
    pub by: Option<PlayerId>,
}

impl MoveOpts {
    pub fn new(to: Zone, cause: Sym) -> MoveOpts {
        MoveOpts { to, cause, pos: None, onto: None, via: None, tapped: false, paid: None, cost: None, free: false, no_replace: false, face: None, alone: false, up: false, under: None, from: None, by: None }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MoveResult {
    pub uid: i32,
    pub moved: bool,
    pub to: Zone,
    pub ep: i32,
}

fn remove_from_zone(c: &mut Ctx, uid: i32) {
    let (owner, zone, pid) = {
        let card = &c.s.cards[uid as usize];
        (card.owner as usize, card.zone, card.pid)
    };
    let s = &mut c.s;
    match zone {
        Zone::Deck | Zone::Hand | Zone::Mana | Zone::Shield | Zone::Grave | Zone::Hyper => {
            let own = &mut s.players[owner];
            let arr = match zone {
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
        Zone::Limbo => {
            if let Some(i) = s.limbo.iter().position(|x| *x == uid) {
                s.limbo.remove(i);
            }
        }
        Zone::Battle => {
            if let Some((po, pi)) = s.perm_by_pid(pid) {
                let perm = &mut s.players[po as usize].battle[pi];
                if let Some(i) = perm.cards.iter().position(|x| *x == uid) {
                    perm.cards.remove(i);
                }
                if perm.cards.is_empty() {
                    s.players[po as usize].battle.remove(pi);
                }
            }
        }
    }
}

fn place_in_zone(c: &mut Ctx, uid: i32, to: Zone, pos: Option<bool>) -> Res<()> {
    let owner = c.s.cards[uid as usize].owner as usize;
    let own = &mut c.s.players[owner];
    match to {
        Zone::Deck => {
            if pos == Some(false) {
                own.deck.push(uid);
            } else {
                own.deck.insert(0, uid);
            }
        }
        Zone::Hand => own.hand.push(uid),
        Zone::Mana => own.mana.push(uid),
        Zone::Shield => own.shield.push(uid),
        Zone::Grave => own.grave.push(uid),
        Zone::Hyper => own.hyper.push(uid),
        Zone::Limbo => c.s.limbo.push(uid),
        Zone::Battle => return fail("battle への移動は enterBattle を使う"),
    }
    Ok(())
}

enum Also {
    ExShieldToGrave(i32),
    SmaxSacrifice(Vec<i32>),
    /// かわりに、その手順を行う(src = 手順を持つカード。省略 = 動くカード自身)
    Steps { ability: AbilityRef, src: Option<i32> },
}

struct Proposal {
    uid: i32,
    from: Zone,
    to: Zone,
    cause: Sym,
    pos: Option<bool>,
    cancelled: bool,
    also: Option<Also>,
    replaced: bool,
    by: Option<PlayerId>,
}

/// カードを移動する(バッチ)。置換を判定し、移動し、イベントを発行して誘発を収集する。
/// 置換の選択が必要なら、状態を変更する前に ask する。
pub fn move_cards(c: &mut Ctx, uids: &[i32], opts: &MoveOpts) -> Res<Vec<MoveResult>> {
    crate::prof!(18);
    let mut proposals: Vec<Proposal> = uids
        .iter()
        .map(|&uid| {
            let card = &c.s.cards[uid as usize];
            // 表向きのシールド(G城)がシールドゾーンを離れる時は、かわりに墓地に置く(手札に加わらない)。
            // カードを重ねた山の一番上(piles に載る。煌龍 サッヴァークなど)は、これではない: 山ごと手札に加わる
            let in_pile = c.s.piles.as_ref().map_or(false, |pl| pl.iter().any(|(k, _)| *k == uid));
            if card.zone == Zone::Shield && card.up && !in_pile && opts.to != Zone::Shield && opts.to != Zone::Grave {
                Proposal { uid, from: card.zone, to: Zone::Grave, cause: s::REPLACED, pos: opts.pos, cancelled: false, also: None, replaced: true, by: opts.by }
            } else {
                Proposal { uid, from: card.zone, to: opts.to, cause: opts.cause, pos: opts.pos, cancelled: false, also: None, replaced: false, by: opts.by }
            }
        })
        .collect();
    // フェーズA: 置換の判定(状態を変更しない)
    if !opts.no_replace {
        for p in proposals.iter_mut() {
            apply_replacements(c, p)?;
        }
    }
    // フェーズB: 実行
    let mut results = Vec::new();
    let mut evs: Vec<Rc<Ev>> = Vec::new();
    for p in &proposals {
        if p.cancelled && p.also.is_none() {
            results.push(MoveResult { uid: p.uid, moved: false, to: p.from, ep: c.s.cards[p.uid as usize].ep });
            continue;
        }
        match &p.also {
            Some(Also::ExShieldToGrave(sh)) => {
                // EXライフ: かわりにシールドを墓地に置く(クリーチャーは離れない)
                do_move(c, *sh, Zone::Grave, s::EX_LIFE_SWAP, None, &mut evs, opts)?;
                results.push(MoveResult { uid: p.uid, moved: false, to: p.from, ep: c.s.cards[p.uid as usize].ep });
                continue;
            }
            Some(Also::SmaxSacrifice(picks)) => {
                let mut o2 = opts.clone();
                o2.no_replace = true;
                for &u in picks {
                    do_move(c, u, Zone::Grave, s::DESTROY, None, &mut evs, &o2)?;
                }
                results.push(MoveResult { uid: p.uid, moved: false, to: p.from, ep: c.s.cards[p.uid as usize].ep });
                continue;
            }
            Some(Also::Steps { ability, src }) => {
                // かわりに、そのカードの手順を行う(手札から捨てられる時に出す、など)。手順は、いまの処理の後に行う
                let (powner, pep) = {
                    let card = &c.s.cards[p.uid as usize];
                    (card.owner, card.ep)
                };
                let srcu = src.unwrap_or(p.uid);
                let (sowner, sep) = {
                    let sc = &c.s.cards[srcu as usize];
                    (sc.owner, sc.ep)
                };
                // 手順の中から、動くはずだったカードを `$ev.card` で参照できるようにする
                let evp = Rc::new(Ev { id: c.s.next_id(), caused_by: None, ty: sym("replaced"), turn: c.s.turn, f: vec![(s::CARD, Val::Int(p.uid as i64)), (s::OWNER, Val::Int(powner as i64))] });
                push_effect(c, *ability, ObjRef { uid: srcu, ep: sep }, sowner, Some(evp), true);
                results.push(MoveResult { uid: p.uid, moved: false, to: p.from, ep: pep });
                continue;
            }
            None => {}
        }
        let r = do_move(c, p.uid, p.to, p.cause, p.pos, &mut evs, opts)?;
        results.push(r);
    }
    c.s.batch_no += 1;
    collect_batch(c, &evs);
    c.s.dirty_sba = true;
    Ok(results)
}

/// マナゾーンに置かれる時にタップ状態か。多色カード(ツインパクトは両面の和集合)はタップして置く(spec 3.4.1 M-1)。
fn enters_mana_tapped(c: &Ctx, uid: i32, opts: &MoveOpts) -> bool {
    let e = c.env();
    let owner = c.s.cards[uid as usize].owner;
    // 相手のカードは、マナゾーンにタップして置かれる(影速 ザ・トリッパー)
    if game_has(e, Feat::OppManaTapped) && any_static(e, |st| matches!(st.m, StaticMod::OppManaTapped) && st.controller != owner) {
        return true;
    }
    mana_civs(e, uid).len() > 1 || opts.tapped
}

/// 実際の移動(置換は済んでいる)。進化の山は下のカードも一緒に動かす。
fn do_move(c: &mut Ctx, uid: i32, to: Zone, cause: Sym, pos: Option<bool>, evs: &mut Vec<Rc<Ev>>, opts: &MoveOpts) -> Res<MoveResult> {
    let (from, face, was_ex, owner, pid) = {
        let card = &c.s.cards[uid as usize];
        (card.zone, card.face, card.ex, card.owner, card.pid)
    };
    let e = c.env();
    let snap = Rc::new(snap_of(e, uid));
    let hint = if from == Zone::Battle || from == Zone::Limbo { face } else { -1 };
    let face_ty = chars_lite(e, uid, hint).ty;
    let kind = face_ty.kind_sym();
    // 山(進化元)を一緒に動かす
    let mut under: Vec<i32> = Vec::new();
    let mut seal_cards: Vec<i32> = Vec::new();
    // スター進化: 離れる時、かわりに一番上のカードだけが離れる
    let alone = opts.alone || (from == Zone::Battle && c.reg.face(c.s.cards[uid as usize].def, face).star);
    if from == Zone::Battle && to != Zone::Battle && !alone {
        if let Some(pm) = c.s.perm(pid) {
            if pm.cards[0] == uid {
                under = pm.cards[1..].to_vec();
                seal_cards = pm.seals.clone(); // 封印は、山が離れる時に、墓地に置かれる
            }
        }
    }
    // 山札に横向きに刺されたカード(終葬 5.S.D.): 山札から出る時に印を外す。手札に加えたプレイヤーは、ゲームに負ける
    if c.s.cards[uid as usize].side {
        c.s.cards[uid as usize].side = false;
        if from == Zone::Deck && to == Zone::Hand {
            c.s.pending_loss.get_or_insert_with(Vec::new).push(owner);
            c.s.dirty_sba = true;
        }
    }
    if to == Zone::Battle {
        return enter_battle(c, uid, opts, evs);
    }
    // シールドの山: ブレイク・墓地送りでは山ごと動く。それ以外(1枚だけを選んで動かす)は、そのカードだけが抜け、下のカードがシールドになる
    let mut under_shield: Vec<i32> = Vec::new();
    if from == Zone::Shield {
        let pile = c.s.piles.as_mut().and_then(|pl| pl.iter().position(|(k, _)| *k == uid).map(|i| pl.remove(i).1));
        if let Some(pile) = pile {
            if cause == s::BREAK || cause == sym("burn") {
                under_shield = pile;
            } else {
                let nt = pile[0];
                let rest: Vec<i32> = pile[1..].to_vec();
                let list = &mut c.s.players[owner as usize].shield;
                if let Some(i) = list.iter().position(|x| *x == uid) {
                    list[i] = nt;
                }
                if !rest.is_empty() {
                    let pl = c.s.piles.get_or_insert_with(Vec::new);
                    pl.push((nt, rest));
                    pl.sort_by_key(|(k, _)| *k);
                }
            }
        }
    }
    remove_from_zone(c, uid);
    {
        let card = &mut c.s.cards[uid as usize];
        card.zone = to;
        card.ep += 1;
        card.pid = -1;
        card.tapped = false;
        card.ex = false;
        card.ex_pid = -1;
        card.face = 0;
        card.up = to == Zone::Shield && opts.up;
    }
    // 移動先のゾーンでの特性で判定する(TS 版と同じ。ツインパクトは、場(バトルゾーン)の面ではなく、マナゾーンでは両面の文明で多色)
    if to == Zone::Mana {
        let t = enters_mana_tapped(c, uid, opts);
        c.s.cards[uid as usize].tapped = t;
    }
    place_in_zone(c, uid, to, pos)?;
    let mut f = vec![
        (s::CARD, Val::Int(uid as i64)),
        (s::OWNER, Val::Int(owner as i64)),
        (s::FROM, Val::zone(from)),
        (s::TO, Val::zone(to)),
        (s::CAUSE, Val::Str(cause)),
        (s::KIND, Val::Str(kind)),
        (s::EX, Val::Bool(was_ex)),
        (s::LKI, Val::Snap(snap)),
    ];
    if let Some(v) = opts.via {
        f.push((s::VIA, Val::Str(v)));
    }
    if c.s.cards[uid as usize].up {
        f.push((s::UP, Val::Bool(true)));
    }
    evs.push(emit(c, s::MOVED, f));
    for u in under_shield {
        let usnap = Rc::new(snap_of(c.env(), u));
        let uowner = c.s.cards[u as usize].owner;
        remove_from_zone(c, u);
        {
            let uc = &mut c.s.cards[u as usize];
            uc.zone = to;
            uc.ep += 1;
            uc.pid = -1;
            uc.face = 0;
            uc.up = false;
        }
        let t = if to == Zone::Mana { enters_mana_tapped(c, u, opts) } else { false };
        c.s.cards[u as usize].tapped = t;
        place_in_zone(c, u, to, pos)?;
        evs.push(emit(
            c,
            s::MOVED,
            vec![
                (s::CARD, Val::Int(u as i64)),
                (s::OWNER, Val::Int(uowner as i64)),
                (s::FROM, Val::zone(Zone::Shield)),
                (s::TO, Val::zone(to)),
                (s::CAUSE, Val::Str(cause)),
                (s::KIND, Val::Str(s::CREATURE)),
                (s::EX, Val::Bool(false)),
                (s::LKI, Val::Snap(usnap)),
                (s::UNDERNEATH, Val::Bool(true)),
            ],
        ));
    }
    for u in under {
        let usnap = Rc::new(snap_of(c.env(), u));
        let uowner = c.s.cards[u as usize].owner;
        remove_from_zone(c, u);
        {
            let uc = &mut c.s.cards[u as usize];
            uc.zone = to;
            uc.ep += 1;
            uc.pid = -1;
            uc.tapped = false;
            uc.face = 0;
        }
        if to == Zone::Mana {
            let t = enters_mana_tapped(c, u, opts);
            c.s.cards[u as usize].tapped = t;
        }
        place_in_zone(c, u, to, pos)?;
        evs.push(emit(
            c,
            s::MOVED,
            vec![
                (s::CARD, Val::Int(u as i64)),
                (s::OWNER, Val::Int(uowner as i64)),
                (s::FROM, Val::zone(Zone::Battle)),
                (s::TO, Val::zone(to)),
                (s::CAUSE, Val::Str(cause)),
                (s::KIND, Val::Str(s::CREATURE)),
                (s::EX, Val::Bool(false)),
                (s::LKI, Val::Snap(usnap)),
                (s::UNDERNEATH, Val::Bool(true)),
            ],
        ));
    }
    // 封印されていたカードは、墓地に置かれる
    for u in seal_cards {
        if c.s.cards[u as usize].zone != Zone::Battle {
            continue;
        }
        let usnap = Rc::new(snap_of(c.env(), u));
        let uowner = c.s.cards[u as usize].owner;
        {
            let uc = &mut c.s.cards[u as usize];
            uc.zone = Zone::Grave;
            uc.ep += 1;
            uc.pid = -1;
            uc.face = 0;
        }
        c.s.players[uowner as usize].grave.push(u);
        evs.push(emit(
            c,
            s::MOVED,
            vec![
                (s::CARD, Val::Int(u as i64)),
                (s::OWNER, Val::Int(uowner as i64)),
                (s::FROM, Val::zone(Zone::Battle)),
                (s::TO, Val::zone(Zone::Grave)),
                (sym("cause"), Val::Str(sym("seal"))),
                (s::KIND, Val::Str(s::CREATURE)),
                (s::EX, Val::Bool(false)),
                (s::LKI, Val::Snap(usnap)),
                (s::UNDERNEATH, Val::Bool(true)),
            ],
        ));
    }
    let ep = c.s.cards[uid as usize].ep;
    Ok(MoveResult { uid, moved: true, to, ep })
}

// ───────────────────────── バトルゾーンへ出す ─────────────────────────

/// カードをバトルゾーンに出す(新しい山、または onto の山の上)。EXライフもここで処理する。
pub fn enter_battle(c: &mut Ctx, uid: i32, opts: &MoveOpts, evs: &mut Vec<Rc<Ev>>) -> Res<MoveResult> {
    crate::prof!(19);
    let (from, owner, def) = {
        let card = &c.s.cards[uid as usize];
        (card.zone, card.owner, card.def)
    };
    let snap = Rc::new(snap_of(c.env(), uid));
    let face_idx = opts.face.unwrap_or(c.s.cards[uid as usize].face);
    let via = opts.via.unwrap_or(s::EFFECT);
    // 出る時の置換(「相手のクリーチャーが出る時、かわりに〜に置く」)。状態を変更する前に判定する
    if game_has(c.env(), Feat::EntryReplace) && !opts.no_replace {
        if let Some(rep) = entry_replacement(c, uid, opts, face_idx, via)? {
            return apply_entry_replacement(c, uid, &rep);
        }
    }
    // 相手の表向きのシールド(G城)がある間、召喚以外の方法で出る時は、かわりにマナゾーンに置く
    if from != Zone::Battle && via != s::SUMMON && shield_static(c.env(), opp(owner), |m| matches!(m, StaticMod::NonSummonEntryToMana)) {
        let mut o2 = opts.clone();
        o2.to = Zone::Mana;
        return do_move(c, uid, Zone::Mana, s::REPLACED, None, evs, &o2);
    }
    remove_from_zone(c, uid);
    {
        let card = &mut c.s.cards[uid as usize];
        card.zone = Zone::Battle;
        card.ep += 1;
        card.face = face_idx;
        card.tapped = false;
    }
    let perm_pid: i32;
    let mut base: Vec<i32> = Vec::new();
    if let Some(under) = opts.under.as_ref().filter(|u| !u.is_empty()) {
        // 下に重ねるカードを集める(バトルゾーンのカードは山ごと。他のゾーンのカードは、バトルゾーンへ移す)
        let mut pile: Vec<i32> = vec![uid];
        let mut seen: Vec<i32> = Vec::new();
        for &u in under {
            let (uzone, upid) = {
                let uc = &c.s.cards[u as usize];
                (uc.zone, uc.pid)
            };
            if uzone == Zone::Battle {
                if seen.contains(&upid) {
                    continue;
                }
                seen.push(upid);
                let (po, pi) = match c.s.perm_by_pid(upid) {
                    Some(x) => x,
                    None => continue,
                };
                let perm = c.s.players[po as usize].battle.remove(pi);
                pile.extend(perm.cards.iter().copied());
            } else {
                let usnap = Rc::new(snap_of(c.env(), u));
                let uowner = c.s.cards[u as usize].owner;
                remove_from_zone(c, u);
                {
                    let uc = &mut c.s.cards[u as usize];
                    uc.zone = Zone::Battle;
                    uc.ep += 1;
                    uc.tapped = false;
                    uc.face = 0;
                }
                pile.push(u);
                evs.push(emit(
                    c,
                    s::MOVED,
                    vec![
                        (s::CARD, Val::Int(u as i64)),
                        (s::OWNER, Val::Int(uowner as i64)),
                        (s::FROM, Val::zone(uzone)),
                        (s::TO, Val::zone(Zone::Battle)),
                        (s::CAUSE, Val::Str(opts.cause)),
                        (s::KIND, Val::Str(s::CREATURE)),
                        (s::EX, Val::Bool(false)),
                        (s::LKI, Val::Snap(usnap)),
                        (s::UNDERNEATH, Val::Bool(true)),
                    ],
                ));
            }
        }
        perm_pid = c.s.next_pid;
        c.s.next_pid += 1;
        let turn = c.s.turn;
        for &u in &pile {
            c.s.cards[u as usize].pid = perm_pid;
        }
        base = pile[1..].to_vec();
        c.s.players[owner as usize].battle.push(Perm::new(perm_pid, pile, opts.tapped, true, turn));
    } else if let Some(onto) = opts.onto {
        let (po, pi) = match c.s.perm_by_pid(onto) {
            Some(x) => x,
            None => return fail("重ねる山がありません"),
        };
        let turn = c.s.turn;
        let perm = &mut c.s.players[po as usize].battle[pi];
        base = perm.cards.clone();
        perm.cards.insert(0, uid);
        perm_pid = perm.pid;
        // L3: 進化しても同一のクリーチャーとして扱い、タップ・召喚酔い・継続効果は進化後も続く。出たターンだけ更新する
        perm.entered_turn = turn;
        c.s.cards[uid as usize].pid = perm_pid;
    } else {
        perm_pid = c.s.next_pid;
        c.s.next_pid += 1;
        // 「タップして出る」(プチョヘンザ): 相手の常在型能力。進化で重なる時は、すでにいる山なので対象外
        let mut tapped_in = opts.tapped || enters_tapped_by_static(c.env(), uid, owner, face_idx);
        if !tapped_in && game_has(c.env(), Feat::EnterTapped) {
            let e = c.env();
            // 各ターン、はじめて出る相手のクリーチャーは、タップして出る
            if !c.s.turn_log.iter().any(|ev| ev.ty == s::ENTERED && ev.int(s::OWNER) == Some(owner as i64)) {
                tapped_in = any_static(e, |st| matches!(st.m, StaticMod::EnterTappedFirst) && st.controller != owner);
            }
            if !tapped_in {
                tapped_in = any_static(e, |st| matches!(st.m, StaticMod::EnterTapped) && st.controller != owner);
            }
        }
        let perm = Perm::new(perm_pid, vec![uid], tapped_in, true, c.s.turn);
        c.s.cards[uid as usize].pid = perm_pid;
        c.s.players[owner as usize].battle.push(perm);
    }
    let ekind = c.reg.face(def, face_idx).ty.kind_sym();
    evs.push(emit(
        c,
        s::MOVED,
        vec![
            (s::CARD, Val::Int(uid as i64)),
            (s::OWNER, Val::Int(owner as i64)),
            (s::FROM, Val::zone(from)),
            (s::TO, Val::zone(Zone::Battle)),
            (s::CAUSE, Val::Str(opts.cause)),
            (s::KIND, Val::Str(ekind)),
            (s::EX, Val::Bool(false)),
            (s::LKI, Val::Snap(snap)),
            (s::VIA, Val::Str(via)),
        ],
    ));
    // 侵略でバトルゾーンの別の山から移動する場合は「出た」扱いにならない(decks.md)
    let from_battle = from == Zone::Battle;
    if !from_battle {
        let mut f = vec![
            (s::CARD, Val::Int(uid as i64)),
            (s::OWNER, Val::Int(owner as i64)),
            (s::VIA, Val::Str(via)),
            (s::PAID, Val::Int(opts.paid.unwrap_or(0) as i64)),
        ];
        if let Some(cost) = opts.cost {
            f.push((s::COST, Val::Int(cost as i64)));
        }
        f.push((s::FREE, Val::Bool(opts.free)));
        f.push((s::PID, Val::Int(perm_pid as i64)));
        f.push((s::KIND, Val::Str(ekind)));
        f.push((s::FACE, Val::Int(face_idx as i64)));
        // 出た元のゾーン。「山札から出た時」などを見る能力があるゲームだけ、イベントに残す(既存の対戦の記録を変えない)
        if game_has(c.env(), Feat::EnteredFrom) {
            f.push((s::FROM, Val::zone(opts.from.unwrap_or(from))));
        }
        evs.push(emit(c, s::ENTERED, f));
    }
    if opts.onto.is_some() {
        evs.push(emit(
            c,
            s::EVOLVED,
            vec![
                (s::CARD, Val::Int(uid as i64)),
                (s::OWNER, Val::Int(owner as i64)),
                (s::PID, Val::Int(perm_pid as i64)),
                (s::BASE, Val::ints(&base)),
                (s::VIA, Val::Str(via)),
            ],
        ));
    }
    // コマンドが出た時、その持ち主は、そのコマンドと同じ文明を持つ自身のカードから、封印を1つ墓地に置く
    if c.s.sealed && !from_battle && ekind == s::CREATURE {
        let face = c.reg.face(def, face_idx);
        if face.races.iter().any(|r| r.contains("コマンド")) {
            let civs = face.civs.clone();
            release_seals(c, owner, &civs, evs);
        }
    }
    // フィールドは、1枚だけ出していられる。新しく出したら、前のフィールドは墓地に置かれる
    if ekind == sym("field") && opts.onto.is_none() {
        let olds: Vec<i32> = c.s.players[owner as usize]
            .battle
            .iter()
            .filter(|pm| pm.pid != perm_pid && {
                let tc = &c.s.cards[pm.cards[0] as usize];
                c.reg.face(tc.def, tc.face).ty == FaceType::Field
            })
            .map(|pm| pm.cards[0])
            .collect();
        if !olds.is_empty() {
            move_cards(c, &olds, &MoveOpts::new(Zone::Grave, sym("fieldReplace")))?;
        }
    }
    // EXライフ: 出る時、山札の上1枚をシールドにする
    let info_exlife = c.reg.info(def, face_idx).ex_life;
    if info_exlife && opts.onto.is_none() {
        if let Some(&sh) = c.s.players[owner as usize].deck.first() {
            remove_from_zone(c, sh);
            {
                let sc = &mut c.s.cards[sh as usize];
                sc.zone = Zone::Shield;
                sc.ep += 1;
                sc.ex = true;
                sc.ex_pid = perm_pid;
            }
            c.s.players[owner as usize].shield.push(sh);
            let ssnap = Rc::new(snap_of(c.env(), sh));
            evs.push(emit(
                c,
                s::MOVED,
                vec![
                    (s::CARD, Val::Int(sh as i64)),
                    (s::OWNER, Val::Int(owner as i64)),
                    (s::FROM, Val::zone(Zone::Deck)),
                    (s::TO, Val::zone(Zone::Shield)),
                    (s::CAUSE, Val::Str(s::EX_LIFE)),
                    (s::KIND, Val::Str(s::CREATURE)),
                    (s::EX, Val::Bool(true)),
                    (s::LKI, Val::Snap(ssnap)),
                ],
            ));
        }
    }
    let ep = c.s.cards[uid as usize].ep;
    Ok(MoveResult { uid, moved: true, to: Zone::Battle, ep })
}

/// 出る時の置換の結果
pub struct EntryRep {
    pub to: Zone,
    pub stay: bool,
    pub then: Option<(i32, u16, PlayerId)>,
}

/// 出る時の置換(entry_replacement の結果)を実行する: かわりの行き先に置き、置いた後の手順があれば積む
pub fn apply_entry_replacement(c: &mut Ctx, uid: i32, rep: &EntryRep) -> Res<MoveResult> {
    // 出ない: いまのゾーン(プレイ中なら、元のゾーン)に残る
    if !rep.stay || c.s.cards[uid as usize].zone == Zone::Limbo {
        let mut o = MoveOpts::new(rep.to, s::REPLACED);
        o.no_replace = true;
        move_cards(c, &[uid], &o)?;
    }
    // 置いた後の手順(ベイB セガーレ: その後、自分はこのクリーチャーをマナゾーンに置く)
    if let Some((src, idx, owner)) = rep.then {
        let (sdef, sface, sep) = {
            let sc = &c.s.cards[src as usize];
            (sc.def, sc.face, sc.ep)
        };
        push_effect(c, AbilityRef { def: sdef, face: sface as u8, idx }, ObjRef { uid: src, ep: sep }, owner, None, true);
    }
    Ok(MoveResult { uid, moved: false, to: rep.to, ep: c.s.cards[uid as usize].ep })
}

/// 出る時の置換(match.type = 'enter')。バトルゾーンの、能力を無視されていないカードが持つ。
/// 当てはまるものがあれば、かわりに置く先のゾーンを返す(複数なら、出るカードの持ち主が選ぶ)。
pub fn entry_replacement(c: &mut Ctx, uid: i32, opts: &MoveOpts, face_idx: i32, via: Sym) -> Res<Option<EntryRep>> {
    struct ECand {
        label: String,
        to: Zone,
        optional: bool,
        stay: bool,
        then: Option<(i32, u16, PlayerId)>,
    }
    let (owner, ep, def, czone) = {
        let card = &c.s.cards[uid as usize];
        (card.owner, card.ep, card.def, card.zone)
    };
    let origin = opts.from.unwrap_or(czone);
    let mut cands: Vec<ECand> = Vec::new();
    {
        let e = c.env();
        let sym_move = sym("move");
        let sym_enter = sym("enter");
        // 「山札から手札以外のゾーンに置かれる時」の置換(move)も、バトルゾーンへ出る時に当てはまる
        if origin == Zone::Deck {
            for pl in 0..2u8 {
                for perm in &c.s.players[pl as usize].battle {
                    let src = perm.cards[0];
                    if src == uid {
                        continue;
                    }
                    let info = info_of(e, src);
                    if info.replaces.is_empty() {
                        continue;
                    }
                    let face = top_face(e, src);
                    for &ri in &info.replaces {
                        if let Ability::Replace { match_, apply: ReplaceApply::ChangeDest { to, .. }, optional, while_, label } = &face.abilities[ri as usize] {
                            if match_.ty != sym_move || match_.from != Some(s::Z_DECK) {
                                continue;
                            }
                            if match_.not_to == Some(s::Z_BATTLE) {
                                continue;
                            }
                            if !rel_pl(match_.owner, owner, pl) {
                                continue;
                            }
                            if let Some(w) = while_ {
                                if !eval_cond(&CC::new(e, pl).with_self(src), w) {
                                    continue;
                                }
                            }
                            cands.push(ECand { label: label.clone().unwrap_or_else(|| "かわりに置く".to_string()), to: *to, optional: *optional, stay: false, then: None });
                        }
                    }
                }
            }
        }
        for p in 0..2u8 {
            for perm in &c.s.players[p as usize].battle {
                let src = perm.cards[0];
                if src == uid {
                    continue;
                }
                let info = info_of(e, src);
                if info.replaces.is_empty() {
                    continue;
                }
                let face = top_face(e, src);
                for &ri in &info.replaces {
                    if let Ability::Replace { match_, apply, optional, while_, label } = &face.abilities[ri as usize] {
                        if match_.ty != sym_enter {
                            continue;
                        }
                        let (to_z, is_stay, then) = match apply {
                            ReplaceApply::ChangeDest { to, then } => (*to, false, then.is_some()),
                            ReplaceApply::Stay => (origin, true, false),
                            _ => continue,
                        };
                        if !rel_pl(match_.owner, owner, p) {
                            continue;
                        }
                        if match_.turn == Some(TurnSel::Own) && c.s.active != p {
                            continue;
                        }
                        if match_.turn == Some(TurnSel::Opponent) && c.s.active == p {
                            continue;
                        }
                        if let Some(v) = match_.via {
                            if via != v {
                                continue;
                            }
                        }
                        if let Some(v) = match_.not_via {
                            if via == v {
                                continue;
                            }
                        }
                        if let Some(v) = match_.from {
                            if origin.sym() != v {
                                continue;
                            }
                        }
                        if let Some(v) = match_.not_from {
                            if origin.sym() == v {
                                continue;
                            }
                        }
                        let cc = CC::new(e, p).with_self(src).with_it(uid, face_idx);
                        if let Some(w) = while_ {
                            if !eval_cond(&CC::new(e, p).with_self(src), w) {
                                continue;
                            }
                        }
                        if let Some(m) = &match_.cond {
                            if !eval_cond(&cc, m) {
                                continue;
                            }
                        }
                        cands.push(ECand {
                            label: label.clone().unwrap_or_else(|| "かわりに置く".to_string()),
                            to: to_z,
                            optional: *optional,
                            stay: is_stay,
                            then: if then { Some((src, ri, p)) } else { None },
                        });
                    }
                }
            }
        }
    }
    if cands.is_empty() {
        return Ok(None);
    }
    let mut chosen = 0usize;
    // 同じ行き先に置く強制の置換が重なっているだけなら、どれを使っても同じ(聞かない)
    let same_dest = cands.iter().all(|x| !x.optional && x.to == cands[0].to && x.then.is_none());
    if !same_dest && (cands.len() > 1 || cands[0].optional) {
        let mut options: Vec<String> = cands.iter().map(|x| x.label.clone()).collect();
        options.push("置換しない".to_string());
        let ans = ask(
            c,
            NeedInput {
                player: owner,
                why: Why::ReplaceChoice,
                input: Some(InputSpec::Option { options, pick: 1, repeat: false, all_if: false, seen: None }),
                source: Some(ObjRef { uid, ep }),
            },
        )?;
        chosen = ans.to_i32s().first().copied().unwrap_or(0) as usize;
        if chosen >= cands.len() {
            return Ok(None);
        }
    }
    let _ = def;
    let ch = cands.swap_remove(chosen);
    Ok(Some(EntryRep { to: ch.to, stay: ch.stay, then: ch.then }))
}

/// 各ターン、はじめて自分のクリーチャーがバトルする時に勝つ効果を、いま使えるか(使えるなら、使ったと記録する)
fn first_battle_wins_for(c: &mut Ctx, owner: PlayerId) -> bool {
    let key = UKey::Other(format!("fbw:{}", owner));
    let turn = c.s.turn as i64;
    if c.s.usage_get(&key) == Some(turn) {
        return false;
    }
    let e = c.env();
    if !any_static(e, |st| matches!(st.m, StaticMod::FirstBattleWins) && st.controller == owner) {
        return false;
    }
    c.s.usage_set(&key, turn);
    true
}

// ───────────────────────── バトル ─────────────────────────

pub struct BattleResult {
    pub a_pid: i32,
    pub d_pid: i32,
    pub a_top: i32,
    pub d_top: i32,
    pub a_owner: PlayerId,
}

/// 2体のクリーチャーをバトルさせる(攻撃によるバトルと、効果によるバトルで共通)。
/// パワーの大きい方が勝ち、同じなら両方破壊される。スレイヤーは、勝敗にかかわらず相手を破壊する。
/// 破壊と battleEnded の誘発の収集まで行う。解決(settle)は呼び出し側。どちらかがいなければ None。
pub fn resolve_battle(c: &mut Ctx, a_pid: i32, d_pid: i32) -> Res<Option<BattleResult>> {
    let (po, pi) = match c.s.perm_by_pid(a_pid) {
        Some(x) => x,
        None => return Ok(None),
    };
    let (dop, di) = match c.s.perm_by_pid(d_pid) {
        Some(x) => x,
        None => return Ok(None),
    };
    let (mut pa, mut pd) = {
        let e = c.env();
        (battle_power(e, &c.s.players[po as usize].battle[pi]), battle_power(e, &c.s.players[dop as usize].battle[di]))
    };
    // 各ターン、はじめて自分のクリーチャーがバトルする時、そのクリーチャーはそのバトルに勝つ(輝く革命 ボルシャック・フレア)
    if game_has(c.env(), Feat::FirstBattleWins) {
        let aw = first_battle_wins_for(c, po);
        let dw = first_battle_wins_for(c, dop);
        if aw && !dw {
            pa = i64::MAX;
        } else if dw && !aw {
            pd = i64::MAX;
        }
    }
    let e = c.env();
    let a_top = c.s.players[po as usize].battle[pi].cards[0];
    let d_top = c.s.players[dop as usize].battle[di].cards[0];
    let mut losers: Vec<i32> = Vec::new();
    let mut winner: Option<i32> = None;
    if pa > pd {
        losers.push(d_top);
        winner = Some(a_top);
    } else if pa < pd {
        losers.push(a_top);
        winner = Some(d_top);
    } else {
        losers.push(a_top);
        losers.push(d_top);
    }
    // スレイヤー: バトルの後、バトルした相手を破壊する(勝敗にかかわらず)
    let a_slay = has_keyword(e, &c.s.players[po as usize].battle[pi], Kw::Slayer);
    let d_slay = has_keyword(e, &c.s.players[dop as usize].battle[di], Kw::Slayer);
    if a_slay && !losers.contains(&d_top) {
        losers.push(d_top);
    }
    if d_slay && !losers.contains(&a_top) {
        losers.push(a_top);
    }
    let (a_owner, d_owner) = (po, dop);
    move_cards(c, &losers, &MoveOpts::new(Zone::Grave, s::DESTROY))?;
    let win_pid = winner.map(|w| if w == a_top { a_pid } else { d_pid });
    let mut fv: Vec<(Sym, Val)> = vec![
        (s::ATTACKER, Val::Int(a_pid as i64)),
        (s::DEFENDER, Val::Int(d_pid as i64)),
        (s::WINNER, win_pid.map_or(Val::Null, |p| Val::Int(p as i64))),
        (s::CARD, winner.map_or(Val::Null, |w| Val::Int(w as i64))),
        (s::WINNER_CARD, winner.map_or(Val::Null, |w| Val::Int(w as i64))),
        (
            s::LOSER_CARD,
            match winner {
                None => Val::Null,
                Some(w) => Val::Int(if w == a_top { d_top } else { a_top } as i64),
            },
        ),
    ];
    if let Some(w) = winner {
        fv.push((s::LOSER_OWNER, Val::Int(if w == a_top { d_owner } else { a_owner } as i64)));
        fv.push((s::WINNER_OWNER, Val::Int(if w == a_top { a_owner } else { d_owner } as i64)));
    }
    fv.push((s::DRAW, Val::Bool(winner.is_none())));
    let ev = emit(c, s::BATTLE_ENDED, fv);
    c.s.batch_no += 1;
    collect_batch(c, &[ev]);
    Ok(Some(BattleResult { a_pid, d_pid, a_top, d_top, a_owner }))
}

// ───────────────────────── 置換パイプライン(effects 8) ─────────────────────────

enum Cand {
    ChangeDest { to: Zone, label: String, optional: bool },
    Smax { picks: Vec<i32>, label: String },
    ExLife { shield: i32, label: String },
    /// かわりに、その手順を行う(src = 手順を持つカード)
    Steps { ability: AbilityRef, src: i32, label: String, optional: bool },
}

impl Cand {
    fn label(&self) -> &str {
        match self {
            Cand::ChangeDest { label, .. } | Cand::Smax { label, .. } | Cand::ExLife { label, .. } | Cand::Steps { label, .. } => label,
        }
    }
    fn optional(&self) -> bool {
        match self {
            Cand::ChangeDest { optional, .. } => *optional,
            Cand::Smax { .. } => true,
            Cand::ExLife { .. } => false,
            Cand::Steps { optional, .. } => *optional,
        }
    }
}

/// 提案に置換効果を適用する。1つの出来事に1回だけで、連鎖しない(101.5)。
/// 複数あるか任意の場合は、持ち主に選ばせる(ask)。
fn apply_replacements(c: &mut Ctx, p: &mut Proposal) -> Res<()> {
    // どのカードの、どの移動にも当てはまる置換(「山札から手札以外のゾーンに置かれる時、かわりに墓地に置く」など)
    if game_has(c.env(), Feat::MoveReplace) {
        apply_move_replacements(c, p)?;
        if p.replaced {
            return Ok(());
        }
    }
    // 手札から捨てられる時の置換(自身の能力)
    if game_has(c.env(), Feat::HandReplace) && p.from == Zone::Hand && p.to == Zone::Grave && p.cause == sym("discard") {
        apply_hand_replacement(c, p)?;
        return Ok(());
    }
    apply_leave_replacements(c, p)
}

/// match.type = 'move': バトルゾーンのカードが持つ、他のカードの移動の置換(changeDest)
fn apply_move_replacements(c: &mut Ctx, p: &mut Proposal) -> Res<()> {
    struct MCand {
        label: String,
        to: Zone,
        optional: bool,
    }
    let (powner, pep) = {
        let card = &c.s.cards[p.uid as usize];
        (card.owner, card.ep)
    };
    let mut cands: Vec<MCand> = Vec::new();
    {
        let e = c.env();
        let sym_move = sym("move");
        for pl in 0..2u8 {
            for perm in &c.s.players[pl as usize].battle {
                let src = perm.cards[0];
                let info = info_of(e, src);
                if info.replaces.is_empty() {
                    continue;
                }
                let face = top_face(e, src);
                for &ri in &info.replaces {
                    if let Ability::Replace { match_, apply: ReplaceApply::ChangeDest { to, .. }, optional, while_, label } = &face.abilities[ri as usize] {
                        if match_.ty != sym_move {
                            continue;
                        }
                        if !rel_pl(match_.owner, powner, pl) {
                            continue;
                        }
                        if let Some(f) = match_.from {
                            if p.from.sym() != f {
                                continue;
                            }
                        }
                        if let Some(f) = match_.not_from {
                            if p.from.sym() == f {
                                continue;
                            }
                        }
                        if match_.turn == Some(TurnSel::Opponent) && c.s.active == pl {
                            continue;
                        }
                        if match_.turn == Some(TurnSel::Own) && c.s.active != pl {
                            continue;
                        }
                        if let Some(z) = match_.to {
                            if p.to.sym() != z {
                                continue;
                            }
                        }
                        if let Some(z) = match_.not_to {
                            if p.to.sym() == z {
                                continue;
                            }
                        }
                        if let Some(cs) = match_.cause {
                            if p.cause != cs {
                                continue;
                            }
                        }
                        if *to == p.to {
                            continue; // 行き先が変わらない置換は、起こらない
                        }
                        if let Some(w) = while_ {
                            if !eval_cond(&CC::new(e, pl).with_self(src), w) {
                                continue;
                            }
                        }
                        if let Some(m) = &match_.cond {
                            if !eval_cond(&CC::new(e, pl).with_self(src).with_it(p.uid, -1), m) {
                                continue;
                            }
                        }
                        cands.push(MCand { label: label.clone().unwrap_or_else(|| "かわりに置く".to_string()), to: *to, optional: *optional });
                    }
                }
            }
        }
    }
    if cands.is_empty() {
        return Ok(());
    }
    let mut chosen = 0usize;
    // 同じ行き先に置く強制の置換が重なっているだけなら、どれを使っても同じ(聞かない)
    let same_dest = cands.iter().all(|x| !x.optional && x.to == cands[0].to);
    if !same_dest && (cands.len() > 1 || cands[0].optional) {
        let mut options: Vec<String> = cands.iter().map(|x| x.label.clone()).collect();
        options.push("置換しない".to_string());
        let ans = ask(
            c,
            NeedInput {
                player: powner,
                why: Why::ReplaceChoice,
                input: Some(InputSpec::Option { options, pick: 1, repeat: false, all_if: false, seen: None }),
                source: Some(ObjRef { uid: p.uid, ep: pep }),
            },
        )?;
        chosen = ans.to_i32s().first().copied().unwrap_or(0) as usize;
        if chosen >= cands.len() {
            return Ok(());
        }
    }
    p.to = cands[chosen].to;
    p.cause = s::REPLACED;
    p.replaced = true;
    Ok(())
}

/// 手札から捨てられるカード自身の置換(「捨てられる時、墓地に置くかわりに出してもよい」など)
fn apply_hand_replacement(c: &mut Ctx, p: &mut Proposal) -> Res<()> {
    let (powner, pep, def) = {
        let card = &c.s.cards[p.uid as usize];
        (card.owner, card.ep, card.def)
    };
    let reg = c.reg;
    let info = reg.info(def, 0);
    let face = reg.face(def, 0);
    let sym_moved = s::MOVED;
    for &ri in &info.replaces {
        if let Ability::Replace { match_, apply: ReplaceApply::Steps(_), optional, while_, label } = &face.abilities[ri as usize] {
            if match_.ty != sym_moved || match_.from != Some(s::Z_HAND) {
                continue;
            }
            if let Some(cs) = match_.cause {
                if p.cause != cs {
                    continue;
                }
            }
            if match_.turn == Some(TurnSel::Opponent) && c.s.active == powner {
                continue;
            }
            if match_.turn == Some(TurnSel::Own) && c.s.active != powner {
                continue;
            }
            // 相手の効果で捨てられる時だけ
            if match_.by_opponent && (p.by.is_none() || p.by == Some(powner)) {
                continue;
            }
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(c.env(), powner).with_self(p.uid), w) {
                    continue;
                }
            }
            if *optional {
                let lab = label.clone().unwrap_or_else(|| "かわりの処理を行う".to_string());
                let ans = ask(
                    c,
                    NeedInput {
                        player: powner,
                        why: Why::ReplaceChoice,
                        input: Some(InputSpec::Option { options: vec![lab, "置換しない".to_string()], pick: 1, repeat: false, all_if: false, seen: None }),
                        source: Some(ObjRef { uid: p.uid, ep: pep }),
                    },
                )?;
                if ans.to_i32s().first().copied().unwrap_or(1) != 0 {
                    return Ok(());
                }
            }
            p.cancelled = true;
            p.also = Some(Also::Steps { ability: AbilityRef { def, face: 0, idx: ri }, src: None });
            p.replaced = true;
            return Ok(());
        }
    }
    Ok(())
}

fn apply_leave_replacements(c: &mut Ctx, p: &mut Proposal) -> Res<()> {
    let reg = c.reg;
    let (owner, def, ep, c_pid) = {
        let card = &c.s.cards[p.uid as usize];
        (card.owner, card.def, card.ep, card.pid)
    };
    if p.from != Zone::Battle {
        return Ok(());
    }
    // 「離れない」(ペトローバ・ハイパー・エン・ゲルス): バトルゾーンを離れる移動はすべて起きない
    if p.to != Zone::Battle && cannot_leave(c.env(), p.uid, Some(p.cause)) {
        p.cancelled = true;
        return Ok(());
    }
    match c.s.perm(c_pid) {
        Some(pm) if pm.cards[0] == p.uid => {}
        _ => return Ok(()),
    }
    if p.to == Zone::Battle {
        return Ok(());
    }
    let mut cands: Vec<Cand> = Vec::new();
    let ex_life;
    {
        let e = c.env();
        let info = info_of(e, p.uid);
        ex_life = info.ex_life;
        let face_def = reg.face(def, chars_lite(e, p.uid, -1).face_idx);
        let sym_leave = sym("leave");
        // カード自身の置換効果(破壊 → マナゾーン / S-MAX進化の身代わり)
        for &ri in &info.replaces {
            if let Ability::Replace { match_, apply, optional, while_, label } = &face_def.abilities[ri as usize] {
                if let Some(w) = while_ {
                    if !eval_cond(&CC::new(e, owner).with_self(p.uid), w) {
                        continue;
                    }
                }
                if match_.ty != s::MOVED && match_.ty != sym_leave {
                    continue;
                }
                if let Some(f) = match_.from {
                    if f != p.from.sym() {
                        continue;
                    }
                }
                if let Some(cs) = match_.cause {
                    if cs != p.cause {
                        continue;
                    }
                }
                if let Some(m) = &match_.cond {
                    if !eval_cond(&CC::new(e, owner).with_self(p.uid).with_it(p.uid, -1), m) {
                        continue;
                    }
                }
                match apply {
                    ReplaceApply::Steps(_) => {
                        let face_i = chars_lite(e, p.uid, -1).face_idx as u8;
                        cands.push(Cand::Steps {
                            ability: AbilityRef { def, face: face_i, idx: ri },
                            src: p.uid,
                            label: label.clone().unwrap_or_else(|| "かわりの処理を行う".to_string()),
                            optional: *optional,
                        });
                    }
                    ReplaceApply::ChangeDest { to, .. } => {
                        let lab = match label {
                            Some(l) => l.clone(),
                            None => format!("かわりに{}に置く", if *to == Zone::Mana { "マナゾーン" } else { to.name() }),
                        };
                        cands.push(Cand::ChangeDest { to: *to, label: lab, optional: *optional });
                    }
                    ReplaceApply::SmaxSacrifice => {
                        if let Some(picks) = smax_victims_env(e, owner, p.uid) {
                            cands.push(Cand::Smax { picks, label: label.clone().unwrap_or_else(|| "かわりに表向きのカード3枚を破壊する".to_string()) });
                        }
                    }
                    ReplaceApply::CancelTrigger | ReplaceApply::Stay => {}
                }
            }
        }
        // 他のクリーチャーが離れる時の置換(match.type = 'leave'。ウルトラ・セイバー・表向きのシールドの身代わりなど)
        if game_has(e, Feat::LeaveReplace) {
            for pl in 0..2u8 {
                for perm in &c.s.players[pl as usize].battle {
                    let src = perm.cards[0];
                    if src == p.uid {
                        continue;
                    }
                    let sinfo = info_of(e, src);
                    if sinfo.replaces.is_empty() {
                        continue;
                    }
                    let sface = top_face(e, src);
                    let sc = &c.s.cards[src as usize];
                    for &ri in &sinfo.replaces {
                        if let Ability::Replace { match_, apply: ReplaceApply::Steps(_), optional, while_, label } = &sface.abilities[ri as usize] {
                            if match_.ty != sym_leave {
                                continue;
                            }
                            if !rel_pl(match_.owner, owner, pl) {
                                continue;
                            }
                            if let Some(f) = match_.from {
                                if f != p.from.sym() {
                                    continue;
                                }
                            }
                            if let Some(cs) = match_.cause {
                                if cs != p.cause {
                                    continue;
                                }
                            }
                            if let Some(w) = while_ {
                                if !eval_cond(&CC::new(e, pl).with_self(src), w) {
                                    continue;
                                }
                            }
                            if let Some(m) = &match_.cond {
                                if !eval_cond(&CC::new(e, pl).with_self(src).with_it(p.uid, -1), m) {
                                    continue;
                                }
                            }
                            cands.push(Cand::Steps {
                                ability: AbilityRef { def: sc.def, face: sc.face as u8, idx: ri },
                                src,
                                label: label.clone().unwrap_or_else(|| "かわりの処理を行う".to_string()),
                                optional: *optional,
                            });
                        }
                    }
                }
            }
        }
    }
    // EXライフ: 離れる時、かわりにシールドを墓地に置く
    if ex_life {
        let sh = c.s.players[owner as usize].shield.iter().copied().find(|u| {
            let sc = &c.s.cards[*u as usize];
            sc.ex && sc.ex_pid == c_pid
        });
        if let Some(sh) = sh {
            cands.push(Cand::ExLife { shield: sh, label: "EXライフ: かわりにシールドを1枚墓地に置く".to_string() });
        }
    }
    if cands.is_empty() {
        return Ok(());
    }
    let mut chosen = 0usize;
    let need_ask = cands.len() > 1 || cands[0].optional();
    if need_ask {
        let labels: Vec<String> = cands.iter().map(|x| x.label().to_string()).collect();
        let all_opt = cands.iter().all(|x| x.optional());
        let any_opt = cands.iter().any(|x| x.optional());
        let mut options = labels;
        if all_opt || any_opt {
            options.push("置換しない".to_string());
        }
        let ans = ask(
            c,
            NeedInput {
                player: owner,
                why: Why::ReplaceChoice,
                input: Some(InputSpec::Option { options, pick: 1, repeat: false, all_if: false, seen: None }),
                source: Some(ObjRef { uid: p.uid, ep }),
            },
        )?;
        chosen = ans.to_i32s().first().copied().unwrap_or(0) as usize;
        if chosen >= cands.len() {
            return Ok(()); // 置換しない
        }
    }
    match cands.swap_remove(chosen) {
        Cand::ChangeDest { to, .. } => {
            p.to = to;
            p.cause = s::REPLACED;
        }
        Cand::Steps { ability, src, .. } => {
            p.cancelled = true;
            p.also = Some(Also::Steps { ability, src: Some(src) });
        }
        Cand::Smax { picks: pool, .. } => {
            // 3枚ちょうどなら選択の余地がない。それより多ければ、持ち主が破壊する3枚を選ぶ
            let picks: Vec<i32> = if pool.len() == 3 {
                pool
            } else {
                let ans = ask(
                    c,
                    NeedInput {
                        player: owner,
                        why: Why::Select,
                        input: Some(InputSpec::Pick { candidates: pool, min: 3, max: 3, sum: None }),
                        source: Some(ObjRef { uid: p.uid, ep }),
                    },
                )?;
                ans.to_i32s()
            };
            p.cancelled = true;
            p.also = Some(Also::SmaxSacrifice(picks));
        }
        Cand::ExLife { shield, .. } => {
            p.cancelled = true;
            p.also = Some(Also::ExShieldToGrave(shield));
        }
    }
    p.replaced = true;
    Ok(())
}

/// ジャオウガの身代わりで破壊できる、自分の表向きのカード(自身を除く)。3枚に満たなければ None。
/// 公式 Q&A 41461: 「表向きでバトルゾーンに存在するカードを破壊できます」。マナゾーンのカードは含まない。
pub fn smax_victims(c: &Ctx, owner: PlayerId, self_uid: i32) -> Option<Vec<i32>> {
    smax_victims_env(c.env(), owner, self_uid)
}

pub fn smax_victims_env(e: Env, owner: PlayerId, self_uid: i32) -> Option<Vec<i32>> {
    let pool: Vec<i32> = e.s.players[owner as usize].battle.iter().map(|perm| perm.cards[0]).filter(|&u| u != self_uid).collect();
    if pool.len() < 3 {
        None
    } else {
        Some(pool)
    }
}

// ───────────────────────── 基本操作 ─────────────────────────

pub fn draw_cards(c: &mut Ctx, player: PlayerId, n: i64) -> Res<i32> {
    let mut drawn = 0;
    for _ in 0..n {
        let uid = match c.s.players[player as usize].deck.first() {
            Some(&u) => u,
            None => {
                // 山札が0枚の時にドローしても何も起こらない(114.6)。「引く時、山札がなければ、かわりに〜」の置換があれば、その手順を行う
                if game_has(c.env(), Feat::DrawEmpty) {
                    draw_empty_replacement(c, player);
                }
                break;
            }
        };
        move_cards(c, &[uid], &MoveOpts::new(Zone::Hand, s::DRAW))?;
        drawn += 1;
    }
    Ok(drawn)
}

/// 山札がない時に引く時の置換(不死鳥縫合 ブラック・ビッグバン): あれば、その手順を行う効果を積む
fn draw_empty_replacement(c: &mut Ctx, player: PlayerId) {
    let mut found: Option<(i32, u16, u16, i32)> = None;
    {
        let e = c.env();
        let sym_de = sym("drawEmpty");
        'outer: for perm in &c.s.players[player as usize].battle {
            let src = perm.cards[0];
            let info = info_of(e, src);
            if info.replaces.is_empty() {
                continue;
            }
            let face = top_face(e, src);
            let sc = &c.s.cards[src as usize];
            for &ri in &info.replaces {
                if let Ability::Replace { match_, apply: ReplaceApply::Steps(_), while_, .. } = &face.abilities[ri as usize] {
                    if match_.ty != sym_de {
                        continue;
                    }
                    if let Some(w) = while_ {
                        if !eval_cond(&CC::new(e, player).with_self(src), w) {
                            continue;
                        }
                    }
                    found = Some((src, sc.face as u16, ri, sc.ep));
                    break 'outer;
                }
            }
        }
    }
    if let Some((src, face, ri, ep)) = found {
        let def = c.s.cards[src as usize].def;
        push_effect(c, AbilityRef { def, face: face as u8, idx: ri }, ObjRef { uid: src, ep }, player, None, false);
    }
}

pub fn shuffle_in_place(s: &mut State, arr: &mut [i32]) {
    let n = arr.len();
    if n < 2 {
        return;
    }
    let mut i = n - 1;
    while i > 0 {
        let j = s.rng_int(i + 1);
        arr.swap(i, j);
        i -= 1;
    }
}

pub fn shuffle_deck(c: &mut Ctx, player: PlayerId) {
    if deck_locked(c.env(), player) {
        return; // 山札の順序を変えられない(5.S.D.)
    }
    let mut deck = std::mem::take(&mut c.s.players[player as usize].deck);
    shuffle_in_place(&mut c.s, &mut deck);
    c.s.players[player as usize].deck = deck;
    // 山札全体を混ぜたら、公開された札の位置の手がかりは失われる
    if let Some(kd) = c.s.known_deck.as_mut() {
        kd[player as usize].clear();
    }
}

pub fn set_tapped(c: &mut Ctx, uid: i32, tapped: bool) {
    let (zone, pid, owner) = {
        let card = &c.s.cards[uid as usize];
        (card.zone, card.pid, card.owner)
    };
    if zone == Zone::Battle {
        if let Some((po, pi)) = c.s.perm_by_pid(pid) {
            c.s.players[po as usize].battle[pi].tapped = tapped;
        }
        emit(c, if tapped { s::TAPPED } else { s::UNTAPPED }, vec![(s::CARD, Val::Int(uid as i64)), (s::OWNER, Val::Int(owner as i64))]);
    } else {
        c.s.cards[uid as usize].tapped = tapped;
    }
}

/// 山札の上から1枚をシールドにする(裏向き)
pub fn add_shield_from_deck(c: &mut Ctx, player: PlayerId) -> Res<Option<i32>> {
    let uid = match c.s.players[player as usize].deck.first() {
        Some(&u) => u,
        None => return Ok(None),
    };
    move_cards(c, &[uid], &MoveOpts::new(Zone::Shield, s::ADD_SHIELD))?;
    Ok(Some(uid))
}
