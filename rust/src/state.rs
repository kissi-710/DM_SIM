//! 状態・行動の JSON 変換(TS 版の GameState / Action と同じ形)。

use crate::ast::R;
use crate::json::Json;
use crate::registry::Registry;
use crate::types::*;
use std::rc::Rc;

fn get<'a>(j: &'a Json, k: &str) -> R<&'a Json> {
    j.get(k).ok_or_else(|| format!("キー {} がありません", k))
}
fn gi(j: &Json, k: &str) -> R<i64> {
    get(j, k)?.as_i64().ok_or_else(|| format!("{} は数値です", k))
}
fn gb(j: &Json, k: &str) -> R<bool> {
    get(j, k)?.as_bool().ok_or_else(|| format!("{} は真偽値です", k))
}
fn gs<'a>(j: &'a Json, k: &str) -> R<&'a str> {
    get(j, k)?.as_str().ok_or_else(|| format!("{} は文字列です", k))
}
fn ints(j: &Json) -> R<Vec<i32>> {
    j.as_arr().ok_or("配列が必要です")?.iter().map(|x| x.as_i64().map(|n| n as i32).ok_or_else(|| "数値が必要です".to_string())).collect()
}
fn jints(v: &[i32]) -> Json {
    Json::Arr(v.iter().map(|&x| Json::int(x as i64)).collect())
}
fn zone(s: &str) -> R<Zone> {
    Zone::parse(s).ok_or_else(|| format!("未知のゾーン: {}", s))
}

pub fn civs_to_json(c: &[Civ]) -> Json {
    Json::Arr(c.iter().map(|c| Json::str(c.name())).collect())
}

// ───────────────────────── Ev / Snap ─────────────────────────

pub fn ev_from_json(reg: &Registry, j: &Json) -> R<Ev> {
    let mut f = Vec::new();
    let mut id = 0;
    let mut caused_by = None;
    let mut ty = sym("");
    let mut turn = 0;
    if let Json::Obj(o) = j {
        for (k, v) in o {
            match k.as_str() {
                "id" => id = v.as_i64().unwrap_or(0) as i32,
                "causedBy" => caused_by = v.as_i64().map(|n| n as i32),
                "type" => ty = sym(v.as_str().unwrap_or("")),
                "turn" => turn = v.as_i64().unwrap_or(0) as i32,
                _ => f.push((sym(k), val_from_json(reg, v))),
            }
        }
    } else {
        return Err("イベントはオブジェクトです".into());
    }
    Ok(Ev { id, caused_by, ty, turn, f })
}

/// JSON → Val。イベントの入れ子(cause)・LKI は専用の型にする
pub fn val_from_json(reg: &Registry, j: &Json) -> Val {
    match j {
        Json::Obj(o) => {
            // Ev らしい(id, type, turn を持つ)ものは Val::Ev に
            if j.get("id").is_some() && j.get("type").is_some() && j.get("turn").is_some() {
                if let Ok(e) = ev_from_json(reg, j) {
                    return Val::Ev(Rc::new(e));
                }
            }
            Val::Obj(Rc::new(o.iter().map(|(k, v)| (sym(k), val_from_json(reg, v))).collect()))
        }
        Json::Arr(a) => Val::List(Rc::new(a.iter().map(|x| val_from_json(reg, x)).collect())),
        _ => Val::from_json(j),
    }
}

pub fn snap_from_json(reg: &Registry, j: &Json) -> R<Snap> {
    let def_id = gs(j, "defId")?;
    Ok(Snap {
        uid: gi(j, "uid")? as i32,
        def: reg.def_index(def_id).ok_or_else(|| format!("未知のカード: {}", def_id))?,
        owner: gi(j, "owner")? as u8,
        face: gi(j, "face")? as i32,
        zone: zone(gs(j, "zone")?)?,
        civs: Rc::new(
            get(j, "civs")?
                .as_arr()
                .ok_or("civs")?
                .iter()
                .map(|c| Civ::parse(c.as_str().unwrap_or("")).ok_or_else(|| "未知の文明".to_string()))
                .collect::<R<Vec<_>>>()?,
        ),
        cost: gi(j, "cost")? as i32,
        power: gi(j, "power")? as i32,
        multicolor: gb(j, "multicolor")?,
        pid: gi(j, "pid")? as i32,
    })
}

fn objref_from(j: &Json) -> R<ObjRef> {
    Ok(ObjRef { uid: gi(j, "uid")? as i32, ep: gi(j, "ep")? as i32 })
}
fn objref_json(r: ObjRef) -> Json {
    Json::obj(vec![("uid", Json::int(r.uid as i64)), ("ep", Json::int(r.ep as i64))])
}
fn ability_from(reg: &Registry, j: &Json) -> R<AbilityRef> {
    let id = gs(j, "defId")?;
    Ok(AbilityRef { def: reg.def_index(id).ok_or_else(|| format!("未知のカード: {}", id))?, face: gi(j, "face")? as u8, idx: gi(j, "idx")? as u16 })
}
fn ability_json(reg: &Registry, a: AbilityRef) -> Json {
    Json::obj(vec![("defId", Json::str(&reg.ids[a.def as usize])), ("face", Json::int(a.face as i64)), ("idx", Json::int(a.idx as i64))])
}

// ───────────────────────── 入力待ち ─────────────────────────

fn input_from_json(j: &Json) -> R<InputSpec> {
    Ok(match gs(j, "shape")? {
        "pick" => InputSpec::Pick {
            candidates: ints(get(j, "candidates")?)?,
            min: gi(j, "min")? as i32,
            max: gi(j, "max")? as i32,
            sum: match j.get("sum") {
                Some(sm) => Some((gi(sm, "max")? as i32, ints(get(sm, "costs")?)?)),
                None => None,
            },
        },
        "assign" => InputSpec::Assign {
            items: ints(get(j, "items")?)?,
            slots: get(j, "slots")?
                .as_arr()
                .ok_or("slots")?
                .iter()
                .map(|s| {
                    Ok(SlotSpec { id: gs(s, "id")?.to_string(), to: zone(gs(s, "to")?)?, count: gi(s, "count")? as i32, label: gs(s, "label")?.to_string() })
                })
                .collect::<R<Vec<_>>>()?,
        },
        "option" => InputSpec::Option {
            options: get(j, "options")?.as_arr().ok_or("options")?.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect(),
            pick: gi(j, "pick")? as i32,
            repeat: gb(j, "repeat")?,
            all_if: gb(j, "allIf")?,
            seen: match j.get("seen") {
                Some(s) => Some(ints(s)?),
                None => None,
            },
        },
        "yesno" => InputSpec::YesNo,
        "order" => InputSpec::Order {
            candidates: ints(get(j, "candidates")?)?,
            labels: get(j, "labels")?.as_arr().ok_or("labels")?.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect(),
        },
        "payment" => InputSpec::Payment { need: gi(j, "need")? as i32, mana: ints(get(j, "mana")?)? },
        "ack" => InputSpec::Ack { shown: ints(get(j, "shown")?)? },
        s => return Err(format!("未知の入力形式: {}", s)),
    })
}

pub fn input_to_json(i: &InputSpec) -> Json {
    match i {
        InputSpec::Pick { candidates, min, max, sum } => {
            let mut v = vec![
                ("shape", Json::str("pick")),
                ("candidates", jints(candidates)),
                ("min", Json::int(*min as i64)),
                ("max", Json::int(*max as i64)),
            ];
            if let Some((m, costs)) = sum {
                v.push(("sum", Json::obj(vec![("max", Json::int(*m as i64)), ("costs", jints(costs))])));
            }
            Json::obj(v)
        }
        InputSpec::Assign { items, slots } => Json::obj(vec![
            ("shape", Json::str("assign")),
            ("items", jints(items)),
            (
                "slots",
                Json::Arr(
                    slots
                        .iter()
                        .map(|s| {
                            Json::obj(vec![
                                ("id", Json::str(&s.id)),
                                ("to", Json::str(s.to.name())),
                                ("count", Json::int(s.count as i64)),
                                ("label", Json::str(&s.label)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ]),
        InputSpec::Option { options, pick, repeat, all_if, seen } => {
            let mut v = vec![
                ("shape", Json::str("option")),
                ("options", Json::Arr(options.iter().map(|o| Json::str(o)).collect())),
                ("pick", Json::int(*pick as i64)),
                ("repeat", Json::Bool(*repeat)),
                ("allIf", Json::Bool(*all_if)),
            ];
            if let Some(s) = seen {
                v.push(("seen", jints(s)));
            }
            Json::obj(v)
        }
        InputSpec::YesNo => Json::obj(vec![("shape", Json::str("yesno"))]),
        InputSpec::Order { candidates, labels } => Json::obj(vec![
            ("shape", Json::str("order")),
            ("candidates", jints(candidates)),
            ("labels", Json::Arr(labels.iter().map(|o| Json::str(o)).collect())),
        ]),
        InputSpec::Payment { need, mana } => Json::obj(vec![("shape", Json::str("payment")), ("need", Json::int(*need as i64)), ("mana", jints(mana))]),
        InputSpec::Ack { shown } => Json::obj(vec![("shape", Json::str("ack")), ("shown", jints(shown))]),
    }
}

fn pending_from_json(j: &Json) -> R<Pending> {
    Ok(Pending {
        id: gi(j, "id")? as i32,
        player: gi(j, "player")? as u8,
        why: Why::parse(gs(j, "why")?).ok_or("why")?,
        input: match j.get("input") {
            Some(Json::Null) | None => None,
            Some(i) => Some(input_from_json(i)?),
        },
        source: match j.get("source") {
            Some(Json::Null) | None => None,
            Some(s) => Some(objref_from(s)?),
        },
    })
}

pub fn pending_to_json(p: &Pending) -> Json {
    let mut v = vec![
        ("id", Json::int(p.id as i64)),
        ("player", Json::int(p.player as i64)),
        ("why", Json::str(p.why.name())),
        ("input", p.input.as_ref().map_or(Json::Null, input_to_json)),
    ];
    if p.why != Why::TurnAction {
        v.push(("source", p.source.map_or(Json::Null, objref_json)));
    }
    Json::obj(v)
}

// ───────────────────────── 状態 ─────────────────────────

fn mod_from_json(j: &Json) -> R<EffectMod> {
    Ok(match gs(j, "kind")? {
        "cannotAttack" => EffectMod::CannotAttack,
        "powerAdd" => EffectMod::PowerAdd(gi(j, "n")? as i32),
        "grant" => EffectMod::Grant(sym(gs(j, "keyword")?)),
        "cannotBeChosen" => EffectMod::CannotBeChosen,
        "cannotBeAttacked" => EffectMod::CannotBeAttacked,
        "mustBlock" => EffectMod::MustBlock,
        "cannotCast" => EffectMod::CannotCast(j.get("n").and_then(|x| x.as_i64()).map(|n| n as i32)),
        "cannotUseCost" => EffectMod::CannotUseCost(gi(j, "n")? as i32),
        "cannotSummon" => EffectMod::CannotSummon(gi(j, "maxCost")? as i32),
        "cannotBlock" => EffectMod::CannotBlock,
        "breaker" => EffectMod::Breaker(gi(j, "n")? as i32),
        "untapAfterAttack" => EffectMod::UntapAfterAttack,
        "cannotActCost" => EffectMod::CannotActCost(gi(j, "n")? as i32),
        "cannotAttackAny" => EffectMod::CannotAttackAny,
        "cannotLose" => EffectMod::CannotLose,
        "noUntap" => EffectMod::NoUntap { pids: ints(get(j, "pids")?)?, uids: ints(get(j, "uids")?)? },
        "nextSummon" => EffectMod::NextSummon { delta: gi(j, "delta")? as i32, sa: gb(j, "sa")? },
        "oncePerTurnActs" => EffectMod::OncePerTurnActs,
        "cannotCastLte" => EffectMod::CannotCastLte(gi(j, "n")? as i32),
        "ignoreCost" => EffectMod::IgnoreCost(gi(j, "n")? as i32),
        "ignoreAll" => EffectMod::IgnoreAll,
        "cannotLeave" => EffectMod::CannotLeave,
        "startShield" => EffectMod::StartShield,
        "owe" => EffectMod::Owe { civ: Civ::parse(gs(j, "civ")?).ok_or("owe.civ")?, n: gi(j, "n")? as i32 },
        k => return Err(format!("未知の効果: {}", k)),
    })
}

fn mod_to_json(m: &EffectMod) -> Json {
    match m {
        EffectMod::CannotAttack => Json::obj(vec![("kind", Json::str("cannotAttack"))]),
        EffectMod::PowerAdd(n) => Json::obj(vec![("kind", Json::str("powerAdd")), ("n", Json::int(*n as i64))]),
        EffectMod::Grant(k) => Json::obj(vec![("kind", Json::str("grant")), ("keyword", Json::Str(k.name().to_string()))]),
        EffectMod::CannotBeChosen => Json::obj(vec![("kind", Json::str("cannotBeChosen"))]),
        EffectMod::CannotBeAttacked => Json::obj(vec![("kind", Json::str("cannotBeAttacked"))]),
        EffectMod::MustBlock => Json::obj(vec![("kind", Json::str("mustBlock"))]),
        EffectMod::CannotCast(n) => {
            let mut v = vec![("kind", Json::str("cannotCast"))];
            if let Some(n) = n {
                v.push(("n", Json::int(*n as i64)));
            }
            Json::obj(v)
        }
        EffectMod::CannotUseCost(n) => Json::obj(vec![("kind", Json::str("cannotUseCost")), ("n", Json::int(*n as i64))]),
        EffectMod::CannotSummon(n) => Json::obj(vec![("kind", Json::str("cannotSummon")), ("maxCost", Json::int(*n as i64))]),
        EffectMod::CannotBlock => Json::obj(vec![("kind", Json::str("cannotBlock"))]),
        EffectMod::Breaker(n) => Json::obj(vec![("kind", Json::str("breaker")), ("n", Json::int(*n as i64))]),
        EffectMod::UntapAfterAttack => Json::obj(vec![("kind", Json::str("untapAfterAttack"))]),
        EffectMod::CannotActCost(n) => Json::obj(vec![("kind", Json::str("cannotActCost")), ("n", Json::int(*n as i64))]),
        EffectMod::CannotAttackAny => Json::obj(vec![("kind", Json::str("cannotAttackAny"))]),
        EffectMod::CannotLose => Json::obj(vec![("kind", Json::str("cannotLose"))]),
        EffectMod::NoUntap { pids, uids } => Json::obj(vec![("kind", Json::str("noUntap")), ("pids", jints(pids)), ("uids", jints(uids))]),
        EffectMod::NextSummon { delta, sa } => Json::obj(vec![("kind", Json::str("nextSummon")), ("delta", Json::int(*delta as i64)), ("sa", Json::Bool(*sa))]),
        EffectMod::OncePerTurnActs => Json::obj(vec![("kind", Json::str("oncePerTurnActs"))]),
        EffectMod::CannotCastLte(n) => Json::obj(vec![("kind", Json::str("cannotCastLte")), ("n", Json::int(*n as i64))]),
        EffectMod::IgnoreCost(n) => Json::obj(vec![("kind", Json::str("ignoreCost")), ("n", Json::int(*n as i64))]),
        EffectMod::IgnoreAll => Json::obj(vec![("kind", Json::str("ignoreAll"))]),
        EffectMod::CannotLeave => Json::obj(vec![("kind", Json::str("cannotLeave"))]),
        EffectMod::StartShield => Json::obj(vec![("kind", Json::str("startShield"))]),
        EffectMod::Owe { civ, n } => Json::obj(vec![("kind", Json::str("owe")), ("civ", Json::str(civ.name())), ("n", Json::int(*n as i64))]),
    }
}

fn until_from_json(j: &Json) -> R<Duration> {
    Ok(match gs(j, "kind")? {
        "endOfTurn" => Duration::EndOfTurn { turn: gi(j, "turn")? as i32 },
        "untilTurnStart" => Duration::UntilTurnStart { player: gi(j, "player")? as u8, after_turn: gi(j, "afterTurn")? as i32 },
        "untilOppTurnEnd" => Duration::UntilOppTurnEnd { player: gi(j, "player")? as u8, after_turn: gi(j, "afterTurn")? as i32 },
        "source" => Duration::Source { uid: gi(j, "uid")? as i32, ep: gi(j, "ep")? as i32 },
        k => return Err(format!("未知の期限: {}", k)),
    })
}

fn until_to_json(d: &Duration) -> Json {
    match d {
        Duration::EndOfTurn { turn } => Json::obj(vec![("kind", Json::str("endOfTurn")), ("turn", Json::int(*turn as i64))]),
        Duration::UntilTurnStart { player, after_turn } => {
            Json::obj(vec![("kind", Json::str("untilTurnStart")), ("player", Json::int(*player as i64)), ("afterTurn", Json::int(*after_turn as i64))])
        }
        Duration::UntilOppTurnEnd { player, after_turn } => {
            Json::obj(vec![("kind", Json::str("untilOppTurnEnd")), ("player", Json::int(*player as i64)), ("afterTurn", Json::int(*after_turn as i64))])
        }
        Duration::Source { uid, ep } => Json::obj(vec![("kind", Json::str("source")), ("uid", Json::int(*uid as i64)), ("ep", Json::int(*ep as i64))]),
    }
}

fn vars_from_json(reg: &Registry, j: &Json) -> Vars {
    match j {
        Json::Obj(o) => o.iter().map(|(k, v)| (sym(k), val_from_json(reg, v))).collect(),
        _ => vec![],
    }
}

fn vars_to_json(v: &Vars, n: &Names) -> Json {
    Json::Obj(v.iter().map(|(k, x)| (k.name().to_string(), x.to_json(n))).collect())
}

fn perm_from_json(j: &Json) -> R<Perm> {
    let mut p = Perm::new(gi(j, "pid")? as i32, ints(get(j, "cards")?)?, gb(j, "tapped")?, gb(j, "sick")?, gi(j, "enteredTurn")? as i32);
    p.hyper = j.get("hyper").and_then(|x| x.as_bool()).unwrap_or(false);
    if let Some(s) = j.get("seals") {
        p.seals = ints(s)?;
    }
    p.rush = j.get("rush").and_then(|x| x.as_i64()).map(|n| n as i32);
    p.rush_if_attacked = j.get("rushIfAttacked").and_then(|x| x.as_bool()).unwrap_or(false);
    p.crossed_on = j.get("crossedOn").and_then(|x| x.as_i64()).map(|n| n as i32);
    p.end_bottom = j.get("endBottom").and_then(|x| x.as_i64()).map(|n| n as i32);
    p.ninja_bottom = j.get("ninjaBottom").and_then(|x| x.as_i64()).map(|n| n as i32);
    Ok(p)
}

/// 対局のデッキが持つ機能のビット(TS 版の gameHas)。デッキが分からない状態では、カードDB全体で見る
pub fn feats_of(reg: &Registry, deck_ids: &[Vec<u16>]) -> u64 {
    if deck_ids.len() < 2 || deck_ids[0].is_empty() || deck_ids[1].is_empty() {
        return reg.feat_any;
    }
    let mut m = 0u64;
    for l in deck_ids {
        for &d in l {
            m |= reg.feat_def[d as usize];
        }
    }
    m
}

pub fn state_from_json(reg: &Registry, j: &Json) -> R<State> {
    let mut cards = Vec::new();
    for c in get(j, "cards")?.as_arr().ok_or("cards")? {
        let id = gs(c, "defId")?;
        cards.push(Card {
            def: reg.def_index(id).ok_or_else(|| format!("未知のカード: {}", id))?,
            owner: gi(c, "owner")? as u8,
            zone: zone(gs(c, "zone")?)?,
            ep: gi(c, "ep")? as i32,
            tapped: gb(c, "tapped")?,
            ex: gb(c, "ex")?,
            ex_pid: gi(c, "exPid")? as i32,
            pid: gi(c, "pid")? as i32,
            face: gi(c, "face")? as i32,
            up: c.get("up").and_then(|x| x.as_bool()).unwrap_or(false),
            side: c.get("side").and_then(|x| x.as_bool()).unwrap_or(false),
        });
    }
    let pj = get(j, "players")?.as_arr().ok_or("players")?;
    let mk = |p: &Json| -> R<PlayerZones> {
        Ok(PlayerZones {
            deck: ints(get(p, "deck")?)?,
            hand: ints(get(p, "hand")?)?,
            mana: ints(get(p, "mana")?)?,
            shield: ints(get(p, "shield")?)?,
            grave: ints(get(p, "grave")?)?,
            hyper: match p.get("hyper") {
                Some(h) => ints(h)?,
                None => Vec::new(),
            },
            battle: get(p, "battle")?.as_arr().ok_or("battle")?.iter().map(perm_from_json).collect::<R<Vec<_>>>()?,
        })
    };
    let players = [mk(&pj[0])?, mk(&pj[1])?];

    let mut cont = Vec::new();
    for f in get(j, "cont")?.as_arr().ok_or("cont")? {
        match gs(f, "kind")? {
            "effect" => {
                let trigger = match f.get("trigger") {
                    Some(Json::Null) | None => None,
                    Some(t) => Some(Rc::new(ev_from_json(reg, t)?)),
                };
                cont.push(Frame::Effect(EffectFrame {
                    id: gi(f, "id")? as i32,
                    caused_by: f.get("causedBy").and_then(|x| x.as_i64()).map(|n| n as i32),
                    ability: ability_from(reg, get(f, "ability")?)?,
                    source: objref_from(get(f, "source")?)?,
                    lki: Rc::new(snap_from_json(reg, get(f, "lki")?)?),
                    controller: gi(f, "controller")? as u8,
                    pc: gi(f, "pc")? as usize,
                    vars: vars_from_json(reg, get(f, "vars")?),
                    trigger,
                    no_optional: f.get("noOptional").and_then(|x| x.as_bool()).unwrap_or(false),
                }));
            }
            "proc" => cont.push(Frame::Proc(ProcFrame {
                id: gi(f, "id")? as i32,
                caused_by: f.get("causedBy").and_then(|x| x.as_i64()).map(|n| n as i32),
                name: ProcName::parse(gs(f, "name")?).ok_or("proc name")?,
                stage: gi(f, "stage")? as i32,
                vars: vars_from_json(reg, get(f, "vars")?),
            })),
            k => return Err(format!("未知のフレーム: {}", k)),
        }
    }
    let mut pool = Vec::new();
    for e in get(j, "pool")?.as_arr().ok_or("pool")? {
        pool.push(PoolEntry {
            id: gi(e, "id")? as i32,
            batch: gi(e, "batch")? as i32,
            ability: match e.get("ability") {
                Some(Json::Null) | None => None,
                Some(a) => Some(ability_from(reg, a)?),
            },
            kind: match gs(e, "kind")? {
                "ability" => PoolKind::Ability,
                "shieldTrigger" => PoolKind::ShieldTrigger,
                "gStrike" => PoolKind::GStrike,
                k => return Err(format!("未知のプール種別: {}", k)),
            },
            source: objref_from(get(e, "source")?)?,
            lki: Rc::new(snap_from_json(reg, get(e, "lki")?)?),
            controller: gi(e, "controller")? as u8,
            event: match e.get("event") {
                Some(Json::Null) | None => None,
                Some(v) => Some(Rc::new(ev_from_json(reg, v)?)),
            },
            st_layer: gb(e, "stLayer")?,
            declared: e.get("declared").and_then(|x| x.as_bool()).unwrap_or(false),
        });
    }
    let mut effects = Vec::new();
    for e in get(j, "effects")?.as_arr().ok_or("effects")? {
        effects.push(ContEffect {
            id: gi(e, "id")? as i32,
            pid: gi(e, "pid")? as i32,
            m: mod_from_json(get(e, "mod")?)?,
            until: until_from_json(get(e, "until")?)?,
            controller: gi(e, "controller")? as u8,
        });
    }
    let turn_log = get(j, "turnLog")?.as_arr().ok_or("turnLog")?.iter().map(|e| ev_from_json(reg, e).map(Rc::new)).collect::<R<Vec<_>>>()?;
    let mut usage = Vec::new();
    if let Json::Obj(o) = get(j, "usage")? {
        for (k, v) in o {
            usage.push((UKey::parse(k), v.as_i64().unwrap_or(0)));
        }
    }
    let cj = get(j, "cfg")?;
    let cfg = Cfg {
        turn_limit: gi(cj, "turnLimit")? as i32,
        solitaire: gb(cj, "solitaire")?,
        auto_order: {
            let a = get(cj, "autoOrder")?.as_arr().ok_or("autoOrder")?;
            [a[0].as_bool().unwrap_or(false), a[1].as_bool().unwrap_or(false)]
        },
        ack_reveals: {
            let a = get(cj, "ackReveals")?.as_arr().ok_or("ackReveals")?;
            [a[0].as_bool().unwrap_or(false), a[1].as_bool().unwrap_or(false)]
        },
        waiting_policy: match gs(cj, "waitingPolicy")? {
            "newFirst" => WaitingPolicy::NewFirst,
            "oldFirst" => WaitingPolicy::OldFirst,
            _ => WaitingPolicy::Pool,
        },
        sba_after_each_step: gs(cj, "sbaTiming")? == "afterEachStep",
        skip_runs_end_triggers: gb(cj, "skipRunsEndTriggers")?,
        max_frame_steps: gi(cj, "maxFrameSteps")? as i32,
    };
    let mut deck_ids = Vec::new();
    for d in get(j, "deckIds")?.as_arr().ok_or("deckIds")? {
        deck_ids.push(
            d.as_arr()
                .ok_or("deckIds")?
                .iter()
                .map(|x| {
                    let id = x.as_str().unwrap_or("");
                    reg.def_index(id).ok_or_else(|| format!("未知のカード: {}", id))
                })
                .collect::<R<Vec<_>>>()?,
        );
    }
    let mut by_def: Vec<Vec<i32>> = vec![Vec::new(); reg.defs.len()];
    for (i, c) in cards.iter().enumerate() {
        by_def[c.def as usize].push(i as i32);
    }
    Ok(State {
        cards,
        players,
        limbo: ints(get(j, "limbo")?)?,
        turn: gi(j, "turn")? as i32,
        active: gi(j, "active")? as u8,
        step: Step::parse(gs(j, "step")?).ok_or("step")?,
        first: gi(j, "first")? as u8,
        cont,
        pool,
        effects,
        turn_log,
        usage,
        pending: match j.get("pending") {
            Some(Json::Null) | None => None,
            Some(p) => Some(pending_from_json(p)?),
        },
        rans: get(j, "rans")?.as_arr().ok_or("rans")?.iter().map(|x| val_from_json(reg, x)).collect(),
        rng: gi(j, "rng")? as i32,
        seq: gi(j, "seq")? as i32,
        next_pid: gi(j, "nextPid")? as i32,
        batch_no: gi(j, "batchNo")? as i32,
        winner: match get(j, "winner")? {
            Json::Null => Winner::None,
            Json::Num(n) => Winner::P(*n as u8),
            Json::Str(_) => Winner::Draw,
            _ => return Err("winner".into()),
        },
        lose_reason: j.get("loseReason").and_then(|x| x.as_str()).map(|s| s.to_string()),
        skip_turn: gb(j, "skipTurn")?,
        extra_turns: match j.get("extraTurns") {
            Some(a) => Some(ints(a)?.into_iter().map(|x| x as u8).collect()),
            None => None,
        },
        resume: j.get("resume").and_then(|x| x.as_i64()).map(|n| n as u8),
        sealed: j.get("sealed").and_then(|x| x.as_bool()).unwrap_or(false),
        pending_loss: match j.get("pendingLoss") {
            Some(a) => Some(ints(a)?.into_iter().map(|x| x as u8).collect()),
            None => None,
        },
        piles: match j.get("piles") {
            Some(Json::Obj(o)) => {
                let mut v: Vec<(i32, Vec<i32>)> = Vec::new();
                for (k, x) in o {
                    v.push((k.parse::<i32>().map_err(|_| "piles key".to_string())?, ints(x)?));
                }
                v.sort_by_key(|(k, _)| *k);
                Some(v)
            }
            _ => None,
        },
        mana_charged: gb(j, "manaCharged")?,
        breaking: ints(get(j, "breaking")?)?,
        feats: feats_of(reg, &deck_ids),
        deck_ids: Rc::new(deck_ids),
        known_deck: match j.get("knownDeck") {
            Some(Json::Arr(per)) if per.len() == 2 => {
                let mut out: [Vec<Vec<(i32, i32)>>; 2] = [Vec::new(), Vec::new()];
                for (p, groups) in per.iter().enumerate() {
                    for g in groups.as_arr().ok_or("knownDeck")? {
                        let mut grp = Vec::new();
                        for e in g.as_arr().ok_or("knownDeck")? {
                            grp.push((gi(e, "uid")? as i32, gi(e, "ep")? as i32));
                        }
                        out[p].push(grp);
                    }
                }
                Some(out)
            }
            _ => None,
        },
        cards_by_def: Rc::new(by_def),
        cfg: Rc::new(cfg),
        dirty_sba: gb(j, "dirtySba")?,
        v: gi(j, "v")? as i32,
    })
}

pub fn state_to_json(reg: &Registry, s: &State) -> Json {
    let n = reg.names();
    let cards = Json::Arr(
        s.cards
            .iter()
            .map(|c| {
                let mut v = vec![
                    ("defId", Json::str(&reg.ids[c.def as usize])),
                    ("owner", Json::int(c.owner as i64)),
                    ("zone", Json::str(c.zone.name())),
                    ("ep", Json::int(c.ep as i64)),
                    ("tapped", Json::Bool(c.tapped)),
                    ("ex", Json::Bool(c.ex)),
                    ("exPid", Json::int(c.ex_pid as i64)),
                    ("pid", Json::int(c.pid as i64)),
                    ("face", Json::int(c.face as i64)),
                ];
                if c.up {
                    v.push(("up", Json::Bool(true)));
                }
                if c.side {
                    v.push(("side", Json::Bool(true)));
                }
                Json::obj(v)
            })
            .collect(),
    );
    let players = Json::Arr(
        s.players
            .iter()
            .map(|p| {
                Json::obj(vec![
                    ("deck", jints(&p.deck)),
                    ("hand", jints(&p.hand)),
                    ("mana", jints(&p.mana)),
                    ("shield", jints(&p.shield)),
                    ("grave", jints(&p.grave)),
                    ("hyper", jints(&p.hyper)),
                    (
                        "battle",
                        Json::Arr(
                            p.battle
                                .iter()
                                .map(|b| {
                                    let mut v = vec![
                                        ("pid", Json::int(b.pid as i64)),
                                        ("cards", jints(&b.cards)),
                                        ("tapped", Json::Bool(b.tapped)),
                                        ("sick", Json::Bool(b.sick)),
                                        ("enteredTurn", Json::int(b.entered_turn as i64)),
                                    ];
                                    if b.hyper {
                                        v.push(("hyper", Json::Bool(true)));
                                    }
                                    if !b.seals.is_empty() {
                                        v.push(("seals", jints(&b.seals)));
                                    }
                                    if let Some(r) = b.rush {
                                        v.push(("rush", Json::int(r as i64)));
                                    }
                                    if b.rush_if_attacked {
                                        v.push(("rushIfAttacked", Json::Bool(true)));
                                    }
                                    if let Some(x) = b.crossed_on {
                                        v.push(("crossedOn", Json::int(x as i64)));
                                    }
                                    if let Some(x) = b.end_bottom {
                                        v.push(("endBottom", Json::int(x as i64)));
                                    }
                                    if let Some(x) = b.ninja_bottom {
                                        v.push(("ninjaBottom", Json::int(x as i64)));
                                    }
                                    Json::obj(v)
                                })
                                .collect(),
                        ),
                    ),
                ])
            })
            .collect(),
    );
    let cont = Json::Arr(
        s.cont
            .iter()
            .map(|f| match f {
                Frame::Effect(e) => {
                    let mut v = vec![
                        ("kind", Json::str("effect")),
                        ("id", Json::int(e.id as i64)),
                        ("causedBy", e.caused_by.map_or(Json::Null, |c| Json::int(c as i64))),
                        ("ability", ability_json(reg, e.ability)),
                        ("source", objref_json(e.source)),
                        ("lki", e.lki.to_json(&n)),
                        ("controller", Json::int(e.controller as i64)),
                        ("pc", Json::int(e.pc as i64)),
                        ("vars", vars_to_json(&e.vars, &n)),
                        ("trigger", e.trigger.as_ref().map_or(Json::Null, |t| t.to_json(&n))),
                    ];
                    if e.no_optional {
                        v.push(("noOptional", Json::Bool(true)));
                    }
                    Json::obj(v)
                }
                Frame::Proc(p) => Json::obj(vec![
                    ("kind", Json::str("proc")),
                    ("id", Json::int(p.id as i64)),
                    ("causedBy", p.caused_by.map_or(Json::Null, |c| Json::int(c as i64))),
                    ("name", Json::str(p.name.name())),
                    ("stage", Json::int(p.stage as i64)),
                    ("vars", vars_to_json(&p.vars, &n)),
                ]),
            })
            .collect(),
    );
    let pool = Json::Arr(
        s.pool
            .iter()
            .map(|e| {
                let mut fields = vec![
                    ("id", Json::int(e.id as i64)),
                    ("batch", Json::int(e.batch as i64)),
                    ("ability", e.ability.map_or(Json::Null, |a| ability_json(reg, a))),
                    (
                        "kind",
                        Json::str(match e.kind {
                            PoolKind::Ability => "ability",
                            PoolKind::ShieldTrigger => "shieldTrigger",
                            PoolKind::GStrike => "gStrike",
                        }),
                    ),
                    ("source", objref_json(e.source)),
                    ("lki", e.lki.to_json(&n)),
                    ("controller", Json::int(e.controller as i64)),
                    ("event", e.event.as_ref().map_or(Json::Null, |v| v.to_json(&n))),
                    ("stLayer", Json::Bool(e.st_layer)),
                ];
                // 使用宣言済みの時だけ書く(TS 側は、宣言した時に declared: true を足す)
                if e.declared {
                    fields.push(("declared", Json::Bool(true)));
                }
                Json::obj(fields)
            })
            .collect(),
    );
    let effects = Json::Arr(
        s.effects
            .iter()
            .map(|e| {
                Json::obj(vec![
                    ("id", Json::int(e.id as i64)),
                    ("pid", Json::int(e.pid as i64)),
                    ("mod", mod_to_json(&e.m)),
                    ("until", until_to_json(&e.until)),
                    ("controller", Json::int(e.controller as i64)),
                ])
            })
            .collect(),
    );
    let c = &s.cfg;
    let cfg = Json::obj(vec![
        ("turnLimit", Json::int(c.turn_limit as i64)),
        ("solitaire", Json::Bool(c.solitaire)),
        ("autoOrder", Json::Arr(vec![Json::Bool(c.auto_order[0]), Json::Bool(c.auto_order[1])])),
        ("ackReveals", Json::Arr(vec![Json::Bool(c.ack_reveals[0]), Json::Bool(c.ack_reveals[1])])),
        (
            "waitingPolicy",
            Json::str(match c.waiting_policy {
                WaitingPolicy::Pool => "pool",
                WaitingPolicy::NewFirst => "newFirst",
                WaitingPolicy::OldFirst => "oldFirst",
            }),
        ),
        ("sbaTiming", Json::str(if c.sba_after_each_step { "afterEachStep" } else { "afterEffect" })),
        ("skipRunsEndTriggers", Json::Bool(c.skip_runs_end_triggers)),
        ("maxFrameSteps", Json::int(c.max_frame_steps as i64)),
    ]);
    let mut out = Json::obj(vec![
        ("v", Json::int(s.v as i64)),
        ("cards", cards),
        ("players", players),
        ("limbo", jints(&s.limbo)),
        ("turn", Json::int(s.turn as i64)),
        ("active", Json::int(s.active as i64)),
        ("step", Json::str(s.step.name())),
        ("first", Json::int(s.first as i64)),
        ("cont", cont),
        ("pool", pool),
        ("effects", effects),
        ("turnLog", Json::Arr(s.turn_log.iter().map(|e| e.to_json(&n)).collect())),
        ("usage", Json::Obj(s.usage.iter().map(|(k, v)| (k.to_str(), Json::int(*v))).collect())),
        ("pending", s.pending.as_ref().map_or(Json::Null, pending_to_json)),
        ("rans", Json::Arr(s.rans.iter().map(|v| v.to_json(&n)).collect())),
        ("rng", Json::int(s.rng as i64)),
        ("seq", Json::int(s.seq as i64)),
        ("nextPid", Json::int(s.next_pid as i64)),
        ("batchNo", Json::int(s.batch_no as i64)),
        (
            "winner",
            match s.winner {
                Winner::None => Json::Null,
                Winner::P(p) => Json::int(p as i64),
                Winner::Draw => Json::str("draw"),
            },
        ),
        ("loseReason", s.lose_reason.as_ref().map_or(Json::Null, |r| Json::str(r))),
        ("skipTurn", Json::Bool(s.skip_turn)),
        ("manaCharged", Json::Bool(s.mana_charged)),
        ("breaking", jints(&s.breaking)),
        (
            "deckIds",
            Json::Arr(s.deck_ids.iter().map(|d| Json::Arr(d.iter().map(|&x| Json::str(&reg.ids[x as usize])).collect())).collect()),
        ),
        ("cfg", cfg),
        ("dirtySba", Json::Bool(s.dirty_sba)),
    ]);
    if let Json::Obj(o) = &mut out {
        if let Some(a) = &s.extra_turns {
            o.push(("extraTurns".to_string(), Json::Arr(a.iter().map(|&x| Json::int(x as i64)).collect())));
        }
        if let Some(r) = s.resume {
            o.push(("resume".to_string(), Json::int(r as i64)));
        }
        if s.sealed {
            o.push(("sealed".to_string(), Json::Bool(true)));
        }
        if let Some(a) = &s.pending_loss {
            o.push(("pendingLoss".to_string(), Json::Arr(a.iter().map(|&x| Json::int(x as i64)).collect())));
        }
        if let Some(pl) = &s.piles {
            o.push(("piles".to_string(), Json::Obj(pl.iter().map(|(k, v)| (k.to_string(), jints(v))).collect())));
        }
    }
    if let (Json::Obj(o), Some(kd)) = (&mut out, &s.known_deck) {
        let per: Vec<Json> = kd
            .iter()
            .map(|groups| {
                Json::Arr(
                    groups
                        .iter()
                        .map(|g| Json::Arr(g.iter().map(|&(uid, ep)| Json::obj(vec![("uid", Json::int(uid as i64)), ("ep", Json::int(ep as i64))])).collect()))
                        .collect(),
                )
            })
            .collect();
        o.push(("knownDeck".to_string(), Json::Arr(per)));
    }
    out
}

// ───────────────────────── 行動 ─────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Player,
    Creature(i32),
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PlayExtra {
    pub onto: Option<i32>,
    pub tap: Option<Vec<i32>>,
    pub pay: Option<Vec<i32>>,
    /// マナを払うかわりの別のコスト(altCost の id)
    pub alt: Option<String>,
    /// 別のコストで捨てる手札(uid)
    pub discard: Option<Vec<i32>>,
    /// 別のコストでタップする自分のクリーチャーの山(pid)
    pub tap_alt: Option<Vec<i32>>,
    /// 超無限墓地進化で、下に重ねる自分の墓地のクリーチャー(uid)
    pub under: Option<Vec<i32>>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    ChargeMana(i32),
    SkipMana,
    PlayCard { uid: i32, from: Option<Zone>, face: Option<i32>, extra: Option<PlayExtra> },
    Attack { attacker: i32, target: Target },
    EndMain,
    EndTurn,
    /// ハイパー化(pid = ハイパー化するクリーチャーの山、tap = タップする他のクリーチャーの山)
    Hyperize { pid: i32, tap: Vec<i32> },
    /// クロス(gear = クロスギアの山、target = クロスするクリーチャーの山)
    Cross { gear: i32, target: i32 },
    Answer { id: i32, value: Val },
}

pub fn target_to_json(t: &Target) -> Json {
    match t {
        Target::Player => Json::obj(vec![("kind", Json::str("player"))]),
        Target::Creature(p) => Json::obj(vec![("kind", Json::str("creature")), ("pid", Json::int(*p as i64))]),
    }
}

pub fn target_from_json(j: &Json) -> R<Target> {
    match gs(j, "kind")? {
        "player" => Ok(Target::Player),
        "creature" => Ok(Target::Creature(gi(j, "pid")? as i32)),
        k => Err(format!("未知の攻撃先: {}", k)),
    }
}

pub fn extra_to_json(e: &PlayExtra) -> Json {
    let mut v = Vec::new();
    if let Some(o) = e.onto {
        v.push(("onto", Json::int(o as i64)));
    }
    if let Some(t) = &e.tap {
        v.push(("tap", jints(t)));
    }
    if let Some(p) = &e.pay {
        v.push(("pay", jints(p)));
    }
    if let Some(a) = &e.alt {
        v.push(("alt", Json::str(a)));
    }
    if let Some(d) = &e.discard {
        v.push(("discard", jints(d)));
    }
    if let Some(t) = &e.tap_alt {
        v.push(("tapAlt", jints(t)));
    }
    if let Some(u) = &e.under {
        v.push(("under", jints(u)));
    }
    Json::obj(v)
}

fn extra_from_json(j: &Json) -> R<PlayExtra> {
    Ok(PlayExtra {
        onto: j.get("onto").and_then(|x| x.as_i64()).map(|n| n as i32),
        tap: match j.get("tap") {
            Some(t) => Some(ints(t)?),
            None => None,
        },
        pay: match j.get("pay") {
            Some(t) => Some(ints(t)?),
            None => None,
        },
        alt: j.get("alt").and_then(|x| x.as_str()).map(|s| s.to_string()),
        discard: match j.get("discard") {
            Some(t) => Some(ints(t)?),
            None => None,
        },
        tap_alt: match j.get("tapAlt") {
            Some(t) => Some(ints(t)?),
            None => None,
        },
        under: match j.get("under") {
            Some(t) => Some(ints(t)?),
            None => None,
        },
    })
}

pub fn action_from_json(reg: &Registry, j: &Json) -> R<Action> {
    Ok(match gs(j, "type")? {
        "CHARGE_MANA" => Action::ChargeMana(gi(j, "uid")? as i32),
        "SKIP_MANA" => Action::SkipMana,
        "END_MAIN" => Action::EndMain,
        "END_TURN" => Action::EndTurn,
        "HYPERIZE" => Action::Hyperize { pid: gi(j, "pid")? as i32, tap: ints(get(j, "tap")?)? },
        "CROSS" => Action::Cross { gear: gi(j, "gear")? as i32, target: gi(j, "target")? as i32 },
        "PLAY_CARD" => Action::PlayCard {
            uid: gi(j, "uid")? as i32,
            from: match j.get("from") {
                Some(f) => Some(zone(f.as_str().unwrap_or(""))?),
                None => None,
            },
            face: j.get("face").and_then(|x| x.as_i64()).map(|n| n as i32),
            extra: match j.get("extra") {
                Some(Json::Null) | None => None,
                Some(e) => Some(extra_from_json(e)?),
            },
        },
        "ATTACK" => Action::Attack { attacker: gi(j, "attacker")? as i32, target: target_from_json(get(j, "target")?)? },
        "ANSWER" => Action::Answer { id: gi(j, "id")? as i32, value: val_from_json(reg, get(j, "value")?) },
        t => return Err(format!("未知の行動: {}", t)),
    })
}

pub fn action_to_json(reg: &Registry, a: &Action) -> Json {
    match a {
        Action::ChargeMana(u) => Json::obj(vec![("type", Json::str("CHARGE_MANA")), ("uid", Json::int(*u as i64))]),
        Action::SkipMana => Json::obj(vec![("type", Json::str("SKIP_MANA"))]),
        Action::EndMain => Json::obj(vec![("type", Json::str("END_MAIN"))]),
        Action::EndTurn => Json::obj(vec![("type", Json::str("END_TURN"))]),
        Action::Hyperize { pid, tap } => Json::obj(vec![("type", Json::str("HYPERIZE")), ("pid", Json::int(*pid as i64)), ("tap", jints(tap))]),
        Action::Cross { gear, target } => Json::obj(vec![("type", Json::str("CROSS")), ("gear", Json::int(*gear as i64)), ("target", Json::int(*target as i64))]),
        Action::PlayCard { uid, from, face, extra } => {
            let mut v = vec![("type", Json::str("PLAY_CARD")), ("uid", Json::int(*uid as i64))];
            if let Some(f) = from {
                v.push(("from", Json::str(f.name())));
            }
            if let Some(f) = face {
                v.push(("face", Json::int(*f as i64)));
            }
            if let Some(e) = extra {
                v.push(("extra", extra_to_json(e)));
            }
            Json::obj(v)
        }
        Action::Attack { attacker, target } => {
            Json::obj(vec![("type", Json::str("ATTACK")), ("attacker", Json::int(*attacker as i64)), ("target", target_to_json(target))])
        }
        Action::Answer { id, value } => {
            Json::obj(vec![("type", Json::str("ANSWER")), ("id", Json::int(*id as i64)), ("value", value.to_json(&reg.names()))])
        }
    }
}

// ───────────────────────── Val との変換(フレームの変数) ─────────────────────────

pub fn extra_to_val(e: &PlayExtra) -> Val {
    let mut v: Vec<(Sym, Val)> = Vec::new();
    if let Some(o) = e.onto {
        v.push((s::ONTO, Val::Int(o as i64)));
    }
    if let Some(t) = &e.tap {
        v.push((s::TAP, Val::ints(t)));
    }
    if let Some(p) = &e.pay {
        v.push((s::PAY, Val::ints(p)));
    }
    if let Some(a) = &e.alt {
        v.push((sym("alt"), Val::Str(sym(a))));
    }
    if let Some(d) = &e.discard {
        v.push((sym("discard"), Val::ints(d)));
    }
    if let Some(t) = &e.tap_alt {
        v.push((sym("tapAlt"), Val::ints(t)));
    }
    if let Some(u) = &e.under {
        v.push((sym("under"), Val::ints(u)));
    }
    Val::Obj(Rc::new(v))
}

pub fn extra_from_val(v: &Val) -> Option<PlayExtra> {
    match v {
        Val::Obj(_) => Some(PlayExtra {
            onto: v.get(s::ONTO).and_then(|x| x.as_i32()),
            tap: v.get(s::TAP).map(|x| x.to_i32s()),
            pay: v.get(s::PAY).map(|x| x.to_i32s()),
            alt: v.get(sym("alt")).and_then(|x| x.as_sym()).map(|x| x.name().to_string()),
            discard: v.get(sym("discard")).map(|x| x.to_i32s()),
            tap_alt: v.get(sym("tapAlt")).map(|x| x.to_i32s()),
            under: v.get(sym("under")).map(|x| x.to_i32s()),
        }),
        _ => None,
    }
}

pub fn target_to_val(t: &Target) -> Val {
    match t {
        Target::Player => Val::Obj(Rc::new(vec![(s::KIND, Val::Str(s::PLAYER))])),
        Target::Creature(p) => Val::Obj(Rc::new(vec![(s::KIND, Val::Str(s::CREATURE)), (s::PID, Val::Int(*p as i64))])),
    }
}

pub fn target_from_val(v: &Val) -> Option<Target> {
    let kind = v.get(s::KIND)?.as_sym()?;
    if kind == s::PLAYER {
        Some(Target::Player)
    } else {
        Some(Target::Creature(v.get(s::PID)?.as_i32()?))
    }
}
