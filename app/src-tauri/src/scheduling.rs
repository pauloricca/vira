//! No silent fallback: requested native scheduling must succeed or playback fails.
use anyhow::{bail, Result};
use std::sync::atomic::{
    AtomicBool, AtomicU64,
    Ordering::{AcqRel, Release},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Poll,
    Signal,
    Realtime,
}
impl Mode {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "poll" => Ok(Self::Poll),
            "signal" => Ok(Self::Signal),
            "realtime" => Ok(Self::Realtime),
            _ => bail!("worker mode must be poll, signal or realtime"),
        }
    }
    pub fn is_realtime(self) -> bool {
        matches!(self, Self::Realtime)
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Poll => "poll",
            Self::Signal => "signal",
            Self::Realtime => "realtime",
        }
    }
}
#[cfg(target_os = "macos")]
mod native {
    use std::ffi::c_void;
    extern "C" {
        pub fn vira_semaphore_create(out: *mut u32) -> i32;
        pub fn vira_semaphore_signal(sem: u32) -> i32;
        pub fn vira_semaphore_wait(sem: u32) -> i32;
        pub fn vira_semaphore_destroy(sem: u32);
        pub fn vira_worker_create(frames: u32, error: *mut i32) -> *mut c_void;
        pub fn vira_worker_activate(worker: *mut c_void) -> i32;
        pub fn vira_worker_begin(worker: *mut c_void, queued: u32) -> i32;
        pub fn vira_worker_finish(worker: *mut c_void) -> i32;
        pub fn vira_worker_is_realtime() -> i32;
        pub fn vira_worker_destroy(worker: *mut c_void);
    }
}
// The armed/recheck protocol closes the race between checking space and sleeping.
// Semaphore credits cannot grow without bound: a signal consumes one armed flag.
pub struct Wake {
    armed: AtomicBool,
    pub signal_errors: AtomicU64,
    #[cfg(target_os = "macos")]
    sem: u32,
}
impl Wake {
    pub fn new() -> Result<Self> {
        #[cfg(target_os = "macos")]
        {
            let mut sem = 0;
            let code = unsafe { native::vira_semaphore_create(&mut sem) };
            anyhow::ensure!(code == 0, "semaphore_create failed: {code}");
            Ok(Self {
                armed: false.into(),
                signal_errors: 0.into(),
                sem,
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            bail!("signal/realtime worker modes require the native macOS executable")
        }
    }
    pub fn arm(&self) {
        self.armed.store(true, Release);
    }
    pub fn disarm(&self) {
        self.armed.store(false, Release);
    }
    pub fn notify(&self) {
        if self.armed.swap(false, AcqRel) {
            #[cfg(target_os = "macos")]
            if unsafe { native::vira_semaphore_signal(self.sem) } != 0 {
                self.signal_errors
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
    pub fn wait(&self) -> i32 {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::vira_semaphore_wait(self.sem) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            -1
        }
    }
}
impl Drop for Wake {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native::vira_semaphore_destroy(self.sem);
        }
    }
}

pub struct Realtime {
    #[cfg(target_os = "macos")]
    ptr: *mut std::ffi::c_void,
}
impl Realtime {
    pub fn new(frames: u32) -> Result<Self> {
        #[cfg(target_os = "macos")]
        {
            let mut err = 0;
            let ptr = unsafe { native::vira_worker_create(frames, &mut err) };
            anyhow::ensure!(!ptr.is_null(), "AudioWorkIntervalCreate failed: {err}");
            Ok(Self { ptr })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = frames;
            bail!("realtime worker requires macOS")
        }
    }
    pub fn activate(&self) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let err = unsafe { native::vira_worker_activate(self.ptr) };
            anyhow::ensure!(err == 0, "real-time policy/workgroup join failed: {err}");
            anyhow::ensure!(self.is_realtime(), "kernel did not retain real-time policy");
        }
        Ok(())
    }
    pub fn begin(&self, queued: u32) -> i32 {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::vira_worker_begin(self.ptr, queued) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = queued;
            -1
        }
    }
    pub fn finish(&self) -> i32 {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::vira_worker_finish(self.ptr) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            -1
        }
    }
    pub fn is_realtime(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::vira_worker_is_realtime() != 0 }
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
}
impl Drop for Realtime {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native::vira_worker_destroy(self.ptr);
        }
    }
}
