//! 差分テスト: TS 版(基準)が書き出した「状態 → 合法手 → 行動 → 次の状態」の列を、Rust 版が再現できるか。
//! フィクスチャは `npx tsx scripts/dump-fixtures.ts rust/fixtures/games.json` で作る(無ければスキップ)。

use dmsim::engine::step;
use dmsim::json::{self, Json};
use dmsim::legal::legal_actions;
use dmsim::registry::Registry;
use dmsim::state::*;

/// 比較しない項目(文言だけで、動作に関係しない)
fn strip(j: &Json) -> Json {
    match j {
        Json::Obj(o) => Json::Obj(
            o.iter()
                .filter(|(k, _)| k != "prompt" && k != "label" && k != "labels" && k != "hints")
                .map(|(k, v)| (k.clone(), strip(v)))
                .collect(),
        ),
        Json::Arr(a) => Json::Arr(a.iter().map(strip).collect()),
        _ => j.clone(),
    }
}

fn load() -> Option<(Registry, Json)> {
    let path = std::path::Path::new("fixtures/games.json");
    if !path.exists() {
        eprintln!("fixtures/games.json がありません(スキップ)");
        return None;
    }
    let text = std::fs::read_to_string(path).unwrap();
    let root = json::parse(&text).unwrap();
    let reg = Registry::from_json(root.get("defs").unwrap()).unwrap();
    Some((reg, root))
}

#[test]
fn state_roundtrip() {
    let Some((reg, root)) = load() else { return };
    for (gi, g) in root.get("games").unwrap().as_arr().unwrap().iter().enumerate() {
        for (i, sj) in g.get("states").unwrap().as_arr().unwrap().iter().enumerate() {
            let st = state_from_json(&reg, sj).unwrap_or_else(|e| panic!("game {} state {}: 読み込み失敗: {}", gi, i, e));
            let back = state_to_json(&reg, &st);
            if let Some(d) = strip(&back).diff(&strip(sj), "") {
                panic!("game {} state {}: JSON の往復が一致しません: {}", gi, i, d);
            }
        }
    }
}

#[test]
fn legal_and_step_match_ts() {
    let Some((reg, root)) = load() else { return };
    let mut steps = 0;
    for (gi, g) in root.get("games").unwrap().as_arr().unwrap().iter().enumerate() {
        let states = g.get("states").unwrap().as_arr().unwrap();
        let legals = g.get("legal").unwrap().as_arr().unwrap();
        let actions = g.get("actions").unwrap().as_arr().unwrap();
        for i in 0..actions.len() {
            let st = state_from_json(&reg, &states[i]).unwrap();
            // 合法手(順序も含めて一致)
            let legal = legal_actions(&st, &reg);
            let got = Json::Arr(legal.iter().map(|a| action_to_json(&reg, a)).collect());
            if let Some(d) = strip(&got).diff(&strip(&legals[i]), "") {
                panic!("game {} step {}: 合法手が一致しません: {}", gi, i, d);
            }
            // step
            let a = action_from_json(&reg, &actions[i]).unwrap();
            let out = step(&reg, &st, &a).unwrap_or_else(|e| panic!("game {} step {}: step が失敗: {} (行動 {})", gi, i, e, actions[i]));
            let got = state_to_json(&reg, &out.state);
            if let Some(d) = strip(&got).diff(&strip(&states[i + 1]), "") {
                panic!("game {} step {}: 次の状態が一致しません: {}\n行動: {}", gi, i, d, actions[i]);
            }
            steps += 1;
        }
    }
    eprintln!("{} 手が TS 版と一致しました", steps);
}

#[test]
fn eval_round_matches_ts() {
    use dmsim::ai::{eval_round, SearchEnv};
    let Some((reg, root)) = load() else { return };
    let rounds = match root.get("rounds").and_then(|r| r.as_arr()) {
        Some(r) => r,
        None => return,
    };
    let mut n = 0;
    let mut maxdiff: f64 = 0.0;
    for (ri, r) in rounds.iter().enumerate() {
        let env = SearchEnv::from_json(&reg, r.get("env").unwrap()).unwrap_or_else(|e| panic!("round {}: env の読み込み失敗: {}", ri, e));
        let alive: Vec<usize> = r.get("alive").unwrap().as_arr().unwrap().iter().map(|x| x.as_i64().unwrap() as usize).collect();
        let seeds = r.get("seeds").unwrap().as_arr().unwrap();
        let rows = r.get("rows").unwrap().as_arr().unwrap();
        for (si, sd) in seeds.iter().enumerate() {
            let got = eval_round(&reg, &env, sd.as_f64().unwrap() as u32, &alive);
            let want = rows[si].as_arr().unwrap();
            assert_eq!(got.len(), want.len());
            for (k, (g, w)) in got.iter().zip(want).enumerate() {
                match w {
                    Json::Null => assert!(g.is_nan(), "round {} seed {} arm {}: 期待は NaN だが {}", ri, si, k, g),
                    _ => {
                        let wv = w.as_f64().unwrap();
                        let d = (g - wv).abs();
                        maxdiff = maxdiff.max(d);
                        assert!(d < 1e-9, "round {} seed {} arm {}: {} と {} (差 {})", ri, si, k, g, wv, d);
                    }
                }
                n += 1;
            }
        }
    }
    eprintln!("{} 個の報酬が一致(最大差 {:e})", n, maxdiff);
}
