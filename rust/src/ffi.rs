//! WASM(および C ABI)から呼ぶための最小の境界。依存なし(wasm-bindgen を使わない)。
//! 使い方(JS 側): dm_alloc で領域を確保 → UTF-8 の JSON を書く → dm_load_registry / dm_begin → dm_rounds。
//! 戻り値は 0 が成功、負がエラー(dm_error_ptr / dm_error_len で UTF-8 のメッセージを読む)。

use crate::ai::{eval_round, SearchEnv};
use crate::json;
use crate::registry::Registry;
use std::cell::RefCell;

thread_local! {
    static REG: RefCell<Option<Registry>> = const { RefCell::new(None) };
    static ENV: RefCell<Option<SearchEnv>> = const { RefCell::new(None) };
    static ERR: RefCell<String> = const { RefCell::new(String::new()) };
}

fn set_err(m: String) -> i32 {
    ERR.with(|e| *e.borrow_mut() = m);
    -1
}

/// JS 側が書き込む領域を確保する
#[no_mangle]
pub extern "C" fn dm_alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// dm_alloc で確保した領域を返す(len は確保時と同じ)
#[no_mangle]
pub extern "C" fn dm_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

#[no_mangle]
pub extern "C" fn dm_error_ptr() -> *const u8 {
    ERR.with(|e| e.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn dm_error_len() -> usize {
    ERR.with(|e| e.borrow().len())
}

fn read_utf8(ptr: *const u8, len: usize) -> Result<&'static str, String> {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(bytes).map_err(|_| "UTF-8 が不正です".to_string())
}

/// カード定義(展開済み。TS 版 registry.defs の JSON)を読み込む。以後の dm_begin はこれを使う。
#[no_mangle]
pub extern "C" fn dm_load_registry(ptr: *const u8, len: usize) -> i32 {
    let r = read_utf8(ptr, len).and_then(|t| json::parse(t)).and_then(|j| Registry::from_json(&j));
    match r {
        Ok(reg) => {
            REG.with(|g| *g.borrow_mut() = Some(reg));
            ENV.with(|g| *g.borrow_mut() = None);
            0
        }
        Err(e) => set_err(e),
    }
}

/// 探索の入力(TS 版 SearchEnv の JSON)を登録する。戻り値は手の数(>= 0)、エラーは負。
#[no_mangle]
pub extern "C" fn dm_begin(ptr: *const u8, len: usize) -> i32 {
    let r = read_utf8(ptr, len).and_then(|t| json::parse(t)).and_then(|j| REG.with(|g| g.borrow().as_ref().ok_or_else(|| "レジストリがありません".to_string()).and_then(|reg| SearchEnv::from_json(reg, &j))));
    match r {
        Ok(env) => {
            let n = env.legal.len() as i32;
            ENV.with(|g| *g.borrow_mut() = Some(env));
            n
        }
        Err(e) => set_err(e),
    }
}

/// seeds[i] のラウンドを alive の手について評価し、out に f64(リトルエンディアン)で n_seeds × n_arms 個書く。
/// 評価できなかった手は NaN。
#[no_mangle]
pub extern "C" fn dm_rounds(seeds_ptr: *const u32, n_seeds: usize, alive_ptr: *const u32, n_alive: usize, out_ptr: *mut f64) -> i32 {
    let seeds = unsafe { std::slice::from_raw_parts(seeds_ptr, n_seeds) };
    let alive: Vec<usize> = unsafe { std::slice::from_raw_parts(alive_ptr, n_alive) }.iter().map(|&x| x as usize).collect();
    REG.with(|rg| {
        ENV.with(|eg| {
            let rb = rg.borrow();
            let eb = eg.borrow();
            let (reg, env) = match (rb.as_ref(), eb.as_ref()) {
                (Some(r), Some(e)) => (r, e),
                _ => return set_err("レジストリまたは探索の入力がありません".to_string()),
            };
            let n_arms = env.legal.len();
            for (i, &sd) in seeds.iter().enumerate() {
                let row = eval_round(reg, env, sd, &alive);
                for (k, v) in row.iter().enumerate() {
                    unsafe { *out_ptr.add(i * n_arms + k) = *v };
                }
            }
            0
        })
    })
}
