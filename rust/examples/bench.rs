//! プレイアウトの速度測定: フィクスチャの局面で eval_round を繰り返し、プレイアウト数/秒を出す。
use dmsim::ai::{eval_round, SearchEnv};
use dmsim::json;
use dmsim::registry::Registry;
use std::time::Instant;

fn main() {
    let passes: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(10);
    let text = std::fs::read_to_string("fixtures/games.json").expect("fixtures/games.json がありません");
    let root = json::parse(&text).unwrap();
    let reg = Registry::from_json(root.get("defs").unwrap()).unwrap();
    let mut envs = Vec::new();
    for r in root.get("rounds").unwrap().as_arr().unwrap() {
        let env = SearchEnv::from_json(&reg, r.get("env").unwrap()).unwrap();
        let alive: Vec<usize> = r.get("alive").unwrap().as_arr().unwrap().iter().map(|x| x.as_i64().unwrap() as usize).collect();
        let seeds: Vec<u32> = r.get("seeds").unwrap().as_arr().unwrap().iter().map(|x| x.as_f64().unwrap() as u32).collect();
        envs.push((env, alive, seeds));
    }
    // ウォームアップ
    for (env, alive, seeds) in &envs {
        for &sd in seeds {
            eval_round(&reg, env, sd, alive);
        }
    }
    let t0 = Instant::now();
    let mut n = 0u64;
    let mut sum = 0.0;
    for _ in 0..passes {
        for (env, alive, seeds) in &envs {
            for &sd in seeds {
                let r = eval_round(&reg, env, sd, alive);
                n += alive.len() as u64;
                sum += r.iter().filter(|x| !x.is_nan()).sum::<f64>();
            }
        }
    }
    let dt = t0.elapsed().as_secs_f64();
    #[cfg(feature = "prof")]
    dmsim::prof::p::dump(&["eval_round", "rollout", "rollout_pick", "determinize", "reward", "legal_actions", "play_actions", "attack_actions", "plan_play", "run_proc", "run_sba", "plan_payment", "cost_of", "can_attack", "power_of", "active_statics", "collect", "emit", "move_cards", "enter_battle", "run_effect", "step_owned", "drive", "choose_turn_action"]);
    println!("Rust: {} プレイアウト / {:.3}秒 = {:.0} 回/秒 (検算 {:.3})", n, dt, n as f64 / dt, sum);
}
