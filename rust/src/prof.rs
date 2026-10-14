//! 開発用の簡易プロファイラ(feature "prof")。関数の入口で `prof!(ID)` を置くと、その包含時間(サイクル)を集計する。

#[cfg(feature = "prof")]
pub mod p {
    use std::cell::RefCell;
    thread_local! {
        pub static T: RefCell<[u64; 40]> = const { RefCell::new([0; 40]) };
        pub static N: RefCell<[u64; 40]> = const { RefCell::new([0; 40]) };
    }
    pub struct G(usize, u64);
    impl G {
        #[inline(always)]
        pub fn new(i: usize) -> G {
            G(i, unsafe { core::arch::x86_64::_rdtsc() })
        }
    }
    impl Drop for G {
        #[inline(always)]
        fn drop(&mut self) {
            let d = unsafe { core::arch::x86_64::_rdtsc() } - self.1;
            T.with(|t| t.borrow_mut()[self.0] += d);
            N.with(|t| t.borrow_mut()[self.0] += 1);
        }
    }
    pub fn dump(names: &[&str]) {
        T.with(|t| {
            N.with(|n| {
                let t = t.borrow();
                let n = n.borrow();
                let total = t[0].max(1);
                for (i, nm) in names.iter().enumerate() {
                    if n[i] > 0 {
                        println!("{:>2} {:<22} {:>6.1}%  {:>9} 回  {:>8.0} cyc/回", i, nm, t[i] as f64 * 100.0 / total as f64, n[i], t[i] as f64 / n[i] as f64);
                    }
                }
            })
        });
    }
}

#[macro_export]
macro_rules! prof {
    ($i:expr) => {
        #[cfg(feature = "prof")]
        let _prof_guard = $crate::prof::p::G::new($i);
    };
}
