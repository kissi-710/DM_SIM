//! DM_SIM エンジンの Rust 版(TS 版 src/engine の移植)。
//! TS 版を基準(オラクル)とし、同じ状態・行動から同じ結果になることを差分テストで確かめる。

pub mod ai;
pub mod ast;
pub mod cond;
pub mod derive;
pub mod engine;
pub mod json;
pub mod legal;
pub mod ops;
pub mod procs;
pub mod registry;
pub mod state;
pub mod types;
pub mod vm;
