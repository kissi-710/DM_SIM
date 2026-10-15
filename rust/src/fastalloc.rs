//! WASM 用の高速なアロケータ(単一スレッド前提)。
//! 探索は、小さな Vec・Rc を大量に作っては捨てる(状態の複製・プレイアウト)ので、標準の dlmalloc では
//! malloc/free が時間の約 4 分の 1 を占める。サイズクラスごとの空きリストに、解放した領域を積んで再利用する。
//! 領域は OS(ホスト)に返さない(Worker の寿命の間、使い回す)。結合・分割はしない。
#![cfg(target_arch = "wasm32")]

use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;

const SMALL_STEP: usize = 16;
const SMALL_MAX: usize = 1024; // 16 刻みで 64 クラス
const N_SMALL: usize = SMALL_MAX / SMALL_STEP;
const N_LARGE: usize = 12; // 2 のべき乗: 2K, 4K, ... 4M
const LARGE_MIN_SHIFT: usize = 11;
const PAGE: usize = 65536;
const REFILL_PAGES: usize = 64; // 4MB ずつ増やす

struct State {
    bump: usize,
    end: usize,
    small: [usize; N_SMALL],
    large: [usize; N_LARGE],
}

pub struct FastAlloc(UnsafeCell<State>);
unsafe impl Sync for FastAlloc {}

impl FastAlloc {
    pub const fn new() -> FastAlloc {
        FastAlloc(UnsafeCell::new(State { bump: 0, end: 0, small: [0; N_SMALL], large: [0; N_LARGE] }))
    }
}

#[inline]
fn class_of(size: usize) -> (bool, usize, usize) {
    // (小さいか, クラスの添字, 実際に確保するバイト数)
    if size <= SMALL_MAX {
        let c = if size == 0 { 0 } else { (size - 1) / SMALL_STEP };
        (true, c, (c + 1) * SMALL_STEP)
    } else {
        let mut shift = LARGE_MIN_SHIFT;
        while (1usize << shift) < size {
            shift += 1;
        }
        (false, shift - LARGE_MIN_SHIFT, 1usize << shift)
    }
}

unsafe fn grow(st: &mut State, need: usize) -> bool {
    let pages = core::cmp::max(REFILL_PAGES, (need + PAGE - 1) / PAGE);
    let prev = core::arch::wasm32::memory_grow(0, pages);
    if prev == usize::MAX {
        return false;
    }
    let base = prev * PAGE;
    // 直前の bump の残りは捨てる(新しい領域の先頭から使う)。連続していれば延長する
    if st.end == base && st.bump != 0 {
        st.end = base + pages * PAGE;
    } else {
        st.bump = base;
        st.end = base + pages * PAGE;
    }
    true
}

unsafe impl GlobalAlloc for FastAlloc {
    #[inline]
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let st = &mut *self.0.get();
        let align = l.align();
        // 16 バイトを超える配置は、サイズを揃えて確保する(クラスの先頭が 16 の倍数なので、align ≤ 16 は満たす)
        let size = if align > SMALL_STEP { core::cmp::max(l.size(), align) } else { l.size() };
        let (small, ci, bytes) = class_of(size);
        let head = if small { &mut st.small[ci] } else { match st.large.get_mut(ci) { Some(h) => h, None => return core::ptr::null_mut() } };
        if *head != 0 {
            let p = *head;
            *head = *(p as *const usize);
            return p as *mut u8;
        }
        if align > SMALL_STEP {
            // まれな配置: bump から切り出す(再利用しない)
            let mut p = (st.bump + align - 1) & !(align - 1);
            if p + bytes > st.end {
                if !grow(st, bytes + align) {
                    return core::ptr::null_mut();
                }
                p = (st.bump + align - 1) & !(align - 1);
            }
            st.bump = p + bytes;
            return p as *mut u8;
        }
        let mut p = (st.bump + 15) & !15;
        if st.bump == 0 || p + bytes > st.end {
            if !grow(st, bytes + 16) {
                return core::ptr::null_mut();
            }
            p = (st.bump + 15) & !15;
        }
        st.bump = p + bytes;
        p as *mut u8
    }

    #[inline]
    unsafe fn dealloc(&self, ptr: *mut u8, l: Layout) {
        let st = &mut *self.0.get();
        let align = l.align();
        let size = if align > SMALL_STEP { core::cmp::max(l.size(), align) } else { l.size() };
        let (small, ci, _) = class_of(size);
        // align > 16 のブロックは bump から切ったもので、同じクラスの空きリストに積んでも、
        // 次の確保が同じ align で来るとは限らない。安全のため、積まずに捨てる。
        if align > SMALL_STEP {
            return;
        }
        let head = if small { &mut st.small[ci] } else { match st.large.get_mut(ci) { Some(h) => h, None => return } };
        *(ptr as *mut usize) = *head;
        *head = ptr as usize;
    }

    #[inline]
    unsafe fn realloc(&self, ptr: *mut u8, l: Layout, new_size: usize) -> *mut u8 {
        let (_, _, old_bytes) = class_of(l.size());
        let (_, _, new_bytes) = class_of(new_size);
        // 同じクラスに収まるなら、そのまま使う
        if l.align() <= SMALL_STEP && old_bytes == new_bytes {
            return ptr;
        }
        let nl = Layout::from_size_align_unchecked(new_size, l.align());
        let np = self.alloc(nl);
        if !np.is_null() {
            core::ptr::copy_nonoverlapping(ptr, np, core::cmp::min(l.size(), new_size));
            self.dealloc(ptr, l);
        }
        np
    }
}
