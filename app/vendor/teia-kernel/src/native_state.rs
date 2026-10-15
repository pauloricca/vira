//! Native state indirection for the shared DSP evaluator. Never used by WASM.
use super::*;
use std::cell::Cell;

macro_rules! owned_state {
    ($($name:ident: $ty:ty = $initial:expr;)*) => {
        #[allow(non_snake_case)]
        pub(super) struct KernelState { $(pub(super) $name: $ty,)* }
        // Template owns no allocated resources; pointers/Options are empty.
        struct Initial(KernelState);
        unsafe impl Sync for Initial {}
        static INITIAL: Initial = Initial(KernelState { $($name: $initial,)* });
    };
}
engine_fields!(owned_state);
impl KernelState {
    /// Preparation only. Allocate and copy directly on the heap: no large
    /// whole-instance or per-field arrays on the execution thread's stack.
    pub(super) fn new() -> Box<Self> {
        unsafe {
            let layout = std::alloc::Layout::new::<Self>();
            let ptr = std::alloc::alloc(layout) as *mut Self;
            if ptr.is_null() {
                std::alloc::handle_alloc_error(layout);
            }
            core::ptr::copy_nonoverlapping(&INITIAL.0, ptr, 1);
            Box::from_raw(ptr)
        }
    }
}

thread_local! {
    static ACTIVE: Cell<*mut KernelState> = const { Cell::new(core::ptr::null_mut()) };
    // Legacy C exports have a per-thread default; hosted instances never touch it.
    static DEFAULT: std::cell::OnceCell<std::cell::UnsafeCell<Box<KernelState>>> = const { std::cell::OnceCell::new() };
}
#[inline(always)]
pub(super) fn current() -> *mut KernelState {
    ACTIVE.with(|active| {
        let ptr = active.get();
        if !ptr.is_null() {
            ptr
        } else {
            DEFAULT.with(|default| unsafe {
                (&mut **default
                    .get_or_init(|| std::cell::UnsafeCell::new(KernelState::new()))
                    .get()) as *mut KernelState
            })
        }
    })
}
pub(super) fn enter<T>(state: &mut KernelState, operation: impl FnOnce() -> T) -> T {
    struct Restore(*mut KernelState);
    impl Drop for Restore {
        fn drop(&mut self) {
            ACTIVE.with(|active| active.set(self.0));
        }
    }
    ACTIVE.with(|active| {
        let restore = Restore(active.replace(state));
        let result = operation();
        drop(restore);
        result
    })
}
