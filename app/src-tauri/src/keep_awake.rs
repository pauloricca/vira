//! Keep the Mac and its display awake for the entire GUI app lifetime.
use std::{sync::mpsc, thread, time::Duration};

extern "C" {
    fn vira_keep_awake_create(display: i32, assertion: *mut u32) -> i32;
    fn vira_keep_awake_activity(assertion: *mut u32) -> i32;
    fn vira_keep_awake_release(assertion: u32);
}

pub struct KeepAwake {
    stop: mpsc::Sender<()>,
    worker: Option<thread::JoinHandle<()>>,
}

impl KeepAwake {
    pub fn start() -> std::io::Result<Self> {
        let (stop, receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("vira-keep-awake".into())
            .spawn(move || {
                let mut assertions = Vec::new();
                for display in [0, 1] {
                    let mut id = 0;
                    let result = unsafe { vira_keep_awake_create(display, &mut id) };
                    if result == 0 {
                        assertions.push(id);
                    } else {
                        eprintln!(
                            "VIRA could not prevent idle sleep (display={display}): {result}"
                        );
                    }
                }
                let mut activity = 0;
                loop {
                    let result = unsafe { vira_keep_awake_activity(&mut activity) };
                    if result != 0 {
                        eprintln!("VIRA could not renew session activity: {result}");
                    }
                    match receiver.recv_timeout(Duration::from_secs(15)) {
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        _ => break,
                    }
                }
                if activity != 0 {
                    assertions.push(activity);
                }
                for id in assertions {
                    unsafe { vira_keep_awake_release(id) };
                }
            })?;
        Ok(Self {
            stop,
            worker: Some(worker),
        })
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
