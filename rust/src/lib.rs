//! DM_SIM エンジンの Rust 版(TS 版 src/engine の移植)。
//! TS 版を基準(オラクル)とし、同じ状態・行動から同じ結果になることを差分テストで確かめる。

#[cfg(target_arch = "wasm32")]
pub mod fastalloc;
pub mod ai;
pub mod ast;
pub mod cond;
pub mod derive;
pub mod engine;
pub mod ffi;
pub mod json;
pub mod legal;
pub mod ops;
pub mod procs;
#[macro_use]
pub mod prof;
pub mod registry;
pub mod state;
pub mod types;
pub mod vm;

// WASM では、探索の小さな確保・解放に合わせた高速なアロケータを使う
#[cfg(target_arch = "wasm32")]
#[global_allocator]
static GLOBAL: fastalloc::FastAlloc = fastalloc::FastAlloc::new();
