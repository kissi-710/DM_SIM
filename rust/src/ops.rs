//! 原始操作(src/engine/ops.ts): イベント発行・誘発の収集・ゾーン移動・置換パイプライン。
//! 規約: 入力待ち(ask)は、状態を変更する前に行う。再実行しても二重に変更されない。

use crate::ast::*;
use crate::cond::*;
use crate::derive::*;
use crate::registry::Registry;
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
}

impl<'a> Ctx<'a> {
    pub fn new(s: State, reg: &'a Registry) -> Ctx<'a> {
        let (rng0, seq0) = (s.rng, s.seq);
        Ctx { s, reg, out: Vec::new(), ask_idx: 0, rng0, seq0, cause: None }
    }
    pub fn env(&self) -> Env<'_> {
        Env { s: &self.s, reg: self.reg }
    }
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
    let id = c.s.next_id();
    let ev = Rc::new(Ev { id, caused_by: c.cause, ty, turn: c.s.turn, f: payload });
    c.out.push(ev.clone());
    c.s.turn_log.push(ev.clone());
    ev
}

fn ability_val(reg: &Registry, a: AbilityRef) -> Val {
    Val::Obj(Rc::new(vec![
        (sym("defId"), Val::Str(sym(&reg.ids[a.def as usize]))),
        (sym("face"), Val::Int(a.face as i64)),
        (sym("idx"), Val::Int(a.idx as i64)),
    ]))
}

// ───────────────────────── 誘発の収集(effects 5.1) ─────────────────────────

/// イベントを監視している能力を探して、待機プールに入れる。
pub fn collect(c: &mut Ctx, ev: &Rc<Ev>) {
    let reg = c.reg;
    let by_def = match reg.trig_by_def.get(&ev.ty) {
        Some(b) => b,
        None => return,
    };
    let batch = c.s.batch_no;
    let n = c.s.cards.len();
    for uid in 0..n {
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
    let key = format!("{}:{}:{}:{}", uid, ep, face, idx);
    if let Some(per) = spec.limit_per_turn {
        let used = c.s.usage_get(&key);
        if used == Some(c.s.turn as i64) && c.s.usage_get(&format!("{}#", key)).unwrap_or(0) >= per as i64 {
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
        let kh = format!("{}#", key);
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
            let face = reg.face(card.def, chars_of(e, uid, -1).face_idx);
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
}

impl MoveOpts {
    pub fn new(to: Zone, cause: Sym) -> MoveOpts {
        MoveOpts { to, cause, pos: None, onto: None, via: None, tapped: false, paid: None, cost: None, free: false, no_replace: false, face: None, alone: false }
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
        Zone::Deck | Zone::Hand | Zone::Mana | Zone::Shield | Zone::Grave => {
            let own = &mut s.players[owner];
            let arr = match zone {
                Zone::Deck => &mut own.deck,
                Zone::Hand => &mut own.hand,
                Zone::Mana => &mut own.mana,
                Zone::Shield => &mut own.shield,
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
        Zone::Limbo => c.s.limbo.push(uid),
        Zone::Battle => return fail("battle への移動は enterBattle を使う"),
    }
    Ok(())
}

enum Also {
    ExShieldToGrave(i32),
    SmaxSacrifice(Vec<i32>),
}

struct Proposal {
    uid: i32,
    from: Zone,
    to: Zone,
    cause: Sym,
    pos: Option<bool>,
    cancelled: bool,
    also: Option<Also>,
}

/// カードを移動する(バッチ)。置換を判定し、移動し、イベントを発行して誘発を収集する。
/// 置換の選択が必要なら、状態を変更する前に ask する。
pub fn move_cards(c: &mut Ctx, uids: &[i32], opts: &MoveOpts) -> Res<Vec<MoveResult>> {
    let mut proposals: Vec<Proposal> = uids
        .iter()
        .map(|&uid| Proposal { uid, from: c.s.cards[uid as usize].zone, to: opts.to, cause: opts.cause, pos: opts.pos, cancelled: false, also: None })
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
    chars_of(c.env(), uid, -1).civs.len() > 1 || opts.tapped
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
    let kind = if chars_of(e, uid, hint).ty == FaceType::Spell { s::SPELL } else { s::CREATURE };
    // 山(進化元)を一緒に動かす
    let mut under: Vec<i32> = Vec::new();
    if from == Zone::Battle && to != Zone::Battle && !opts.alone {
        if let Some(pm) = c.s.perm(pid) {
            if pm.cards[0] == uid {
                under = pm.cards[1..].to_vec();
            }
        }
    }
    if to == Zone::Battle {
        return enter_battle(c, uid, opts, evs);
    }
    remove_from_zone(c, uid);
    let tapped_in_mana = to == Zone::Mana && enters_mana_tapped(c, uid, opts);
    {
        let card = &mut c.s.cards[uid as usize];
        card.zone = to;
        card.ep += 1;
        card.pid = -1;
        card.tapped = false;
        card.ex = false;
        card.ex_pid = -1;
        if to == Zone::Mana {
            card.tapped = tapped_in_mana;
        }
        card.face = 0;
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
    evs.push(emit(c, s::MOVED, f));
    for u in under {
        let usnap = Rc::new(snap_of(c.env(), u));
        let uowner = c.s.cards[u as usize].owner;
        remove_from_zone(c, u);
        let tapped = if to == Zone::Mana { enters_mana_tapped(c, u, opts) } else { false };
        {
            let uc = &mut c.s.cards[u as usize];
            uc.zone = to;
            uc.ep += 1;
            uc.pid = -1;
            uc.tapped = tapped;
            uc.face = 0;
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
    let ep = c.s.cards[uid as usize].ep;
    Ok(MoveResult { uid, moved: true, to, ep })
}

// ───────────────────────── バトルゾーンへ出す ─────────────────────────

/// カードをバトルゾーンに出す(新しい山、または onto の山の上)。EXライフもここで処理する。
pub fn enter_battle(c: &mut Ctx, uid: i32, opts: &MoveOpts, evs: &mut Vec<Rc<Ev>>) -> Res<MoveResult> {
    let (from, owner, def) = {
        let card = &c.s.cards[uid as usize];
        (card.zone, card.owner, card.def)
    };
    let snap = Rc::new(snap_of(c.env(), uid));
    let face_idx = opts.face.unwrap_or(c.s.cards[uid as usize].face);
    let via = opts.via.unwrap_or(s::EFFECT);
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
    if let Some(onto) = opts.onto {
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
        let perm = Perm { pid: perm_pid, cards: vec![uid], tapped: opts.tapped, sick: true, entered_turn: c.s.turn };
        c.s.cards[uid as usize].pid = perm_pid;
        c.s.players[owner as usize].battle.push(perm);
    }
    evs.push(emit(
        c,
        s::MOVED,
        vec![
            (s::CARD, Val::Int(uid as i64)),
            (s::OWNER, Val::Int(owner as i64)),
            (s::FROM, Val::zone(from)),
            (s::TO, Val::zone(Zone::Battle)),
            (s::CAUSE, Val::Str(opts.cause)),
            (s::KIND, Val::Str(s::CREATURE)),
            (s::EX, Val::Bool(false)),
            (s::LKI, Val::Snap(snap)),
            (s::VIA, Val::Str(via)),
        ],
    ));
    // 侵略でバトルゾーンの別の山から移動する場合は「出た」扱いにならない(decks.md)
    if from != Zone::Battle {
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
        f.push((s::KIND, Val::Str(s::CREATURE)));
        f.push((s::FACE, Val::Int(face_idx as i64)));
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

// ───────────────────────── 置換パイプライン(effects 8) ─────────────────────────

enum Cand {
    ChangeDest { to: Zone, label: String, optional: bool },
    Smax { picks: Vec<i32>, label: String },
    ExLife { shield: i32, label: String },
}

impl Cand {
    fn label(&self) -> &str {
        match self {
            Cand::ChangeDest { label, .. } | Cand::Smax { label, .. } | Cand::ExLife { label, .. } => label,
        }
    }
    fn optional(&self) -> bool {
        match self {
            Cand::ChangeDest { optional, .. } => *optional,
            Cand::Smax { .. } => true,
            Cand::ExLife { .. } => false,
        }
    }
}

/// 提案に置換効果を適用する。1つの出来事に1回だけで、連鎖しない(101.5)。
/// 複数あるか任意の場合は、持ち主に選ばせる(ask)。
fn apply_replacements(c: &mut Ctx, p: &mut Proposal) -> Res<()> {
    let reg = c.reg;
    let (owner, pid, def, face, ep, c_pid) = {
        let card = &c.s.cards[p.uid as usize];
        (card.owner, card.pid, card.def, card.face, card.ep, card.pid)
    };
    let _ = pid;
    if p.from != Zone::Battle {
        return Ok(());
    }
    match c.s.perm(c_pid) {
        Some(pm) if pm.cards[0] == p.uid => {}
        _ => return Ok(()),
    }
    if p.to == Zone::Battle {
        return Ok(());
    }
    let e = c.env();
    let info = info_of(e, p.uid);
    let face_def = reg.face(def, chars_of(e, p.uid, -1).face_idx);
    let mut cands: Vec<Cand> = Vec::new();
    // カード自身の置換効果(破壊 → マナゾーン / S-MAX進化の身代わり)
    for &ri in &info.replaces {
        if let Ability::Replace { match_, apply, optional, while_, label } = &face_def.abilities[ri as usize] {
            if let Some(w) = while_ {
                if !eval_cond(&CC::new(e, owner).with_self(p.uid), w) {
                    continue;
                }
            }
            if match_.ty != s::MOVED {
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
            match apply {
                ReplaceApply::ChangeDest(to) => {
                    let lab = match label {
                        Some(l) => l.clone(),
                        None => format!("かわりに{}に置く", if *to == Zone::Mana { "マナゾーン" } else { to.name() }),
                    };
                    cands.push(Cand::ChangeDest { to: *to, label: lab, optional: *optional });
                }
                ReplaceApply::SmaxSacrifice => {
                    if let Some(picks) = smax_victims(c, owner, p.uid) {
                        cands.push(Cand::Smax { picks, label: label.clone().unwrap_or_else(|| "かわりに表向きのカード3枚を破壊する".to_string()) });
                    }
                }
                ReplaceApply::CancelTrigger => {}
            }
        }
    }
    // EXライフ: 離れる時、かわりにシールドを墓地に置く
    if info.ex_life {
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
    let _ = face;
    match cands.swap_remove(chosen) {
        Cand::ChangeDest { to, .. } => {
            p.to = to;
            p.cause = s::REPLACED;
        }
        Cand::Smax { picks, .. } => {
            p.cancelled = true;
            p.also = Some(Also::SmaxSacrifice(picks));
        }
        Cand::ExLife { shield, .. } => {
            p.cancelled = true;
            p.also = Some(Also::ExShieldToGrave(shield));
        }
    }
    Ok(())
}

/// ジャオウガの身代わり: 自分の表向きのカード3枚(バトルゾーン・マナゾーン)
fn smax_victims(c: &Ctx, owner: PlayerId, self_uid: i32) -> Option<Vec<i32>> {
    let mut face_up: Vec<i32> = Vec::new();
    for perm in &c.s.players[owner as usize].battle {
        if perm.cards[0] == self_uid {
            continue;
        }
        face_up.push(perm.cards[0]);
    }
    for &u in &c.s.players[owner as usize].mana {
        face_up.push(u);
    }
    if face_up.len() < 3 {
        return None;
    }
    // 選択はコストの小さいものから(価値の低いマナ・クリーチャーを優先)
    let e = c.env();
    let mut scored: Vec<(i32, f64)> = face_up.iter().map(|&u| (u, value_of(e, u))).collect();
    scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    Some(scored.iter().take(3).map(|x| x.0).collect())
}

fn value_of(e: Env, u: i32) -> f64 {
    let card = &e.s.cards[u as usize];
    let ch = chars_of(e, u, -1);
    (if card.zone == Zone::Battle { 10.0 + ch.power as f64 / 1000.0 } else { 0.0 }) + ch.cost as f64
}

// ───────────────────────── 基本操作 ─────────────────────────

pub fn draw_cards(c: &mut Ctx, player: PlayerId, n: i64) -> Res<i32> {
    let mut drawn = 0;
    for _ in 0..n {
        let uid = match c.s.players[player as usize].deck.first() {
            Some(&u) => u,
            None => break, // 山札が0枚の時にドローしても何も起こらない(114.6)
        };
        move_cards(c, &[uid], &MoveOpts::new(Zone::Hand, s::DRAW))?;
        drawn += 1;
    }
    Ok(drawn)
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
    let mut deck = std::mem::take(&mut c.s.players[player as usize].deck);
    shuffle_in_place(&mut c.s, &mut deck);
    c.s.players[player as usize].deck = deck;
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
