//! Exclusive render-owner facilities. Commands/results own their allocations;
//! a capture copies at most 1024 samples per render boundary, never on IPC.
use anyhow::{ensure, Result};
use rtrb::{Consumer, Producer};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering::SeqCst},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use teia_kernel::hosted::*;
pub const OBS_VALUES: usize = 2048;
pub struct Capture {
    pub samples: Vec<f32>,
    pub count: usize,
    pub rate: f64,
}
pub enum Task {
    Observe(Option<ObservationPlan>),
    Capture {
        identity: Identity,
        state: u32,
        data: Capture,
    },
    Replace(BufferReplacement),
}
pub struct Job {
    pub id: u64,
    pub epoch: u64,
    pub generation: u64,
    pub task: Task,
    pub error: Option<Error>,
}
#[derive(Clone, Copy)]
pub struct Reading {
    pub serial: u64,
    pub generation: u64,
    pub layout: u64,
    pub count: usize,
    pub dropped: usize,
    pub values: [ObservationValue; OBS_VALUES],
    pub event_overflows: u64,
    pub queued_notes: usize,
}
struct Ports {
    commands: Producer<Box<Job>>,
    results: Consumer<Box<Job>>,
    readings: Consumer<Reading>,
}
pub struct Host {
    ports: Mutex<Ports>,
    gate: Mutex<()>,
    sequence: AtomicU64,
    pub epoch: AtomicU64,
    pub enabled: AtomicBool,
}
struct Active {
    job: Box<Job>,
    token: BufferCapture,
}
pub struct Render {
    pub host: Arc<Host>,
    commands: Consumer<Box<Job>>,
    results: Producer<Box<Job>>,
    readings: Producer<Reading>,
    active: Option<Active>,
    serial: u64,
    divider: usize,
    scratch: [ObservationValue; OBS_VALUES],
}
pub fn channel() -> Render {
    let (tx, rx) = rtrb::RingBuffer::new(8);
    let (done, results) = rtrb::RingBuffer::new(8);
    let (out, readings) = rtrb::RingBuffer::new(4);
    let host = Arc::new(Host {
        ports: Mutex::new(Ports {
            commands: tx,
            results,
            readings,
        }),
        gate: Mutex::new(()),
        sequence: 0.into(),
        epoch: 0.into(),
        enabled: false.into(),
    });
    Render {
        host,
        commands: rx,
        results: done,
        readings: out,
        active: None,
        serial: 0,
        divider: 0,
        scratch: [ObservationValue::default(); OBS_VALUES],
    }
}
impl Host {
    pub fn cancel(&self) {
        self.epoch.fetch_add(1, SeqCst);
        self.enabled.store(false, SeqCst);
    }
    pub fn disable(&self, generation: u64) {
        self.cancel();
        let job = Box::new(Job {
            id: 0,
            epoch: self.epoch.load(SeqCst),
            generation,
            task: Task::Observe(None),
            error: None,
        });
        let _ = self.ports.lock().unwrap().commands.push(job);
    }
    pub fn request(&self, generation: u64, task: Task) -> Result<Box<Job>> {
        let epoch = self.epoch.load(SeqCst);
        let _gate = self.gate.lock().unwrap();
        ensure!(
            self.epoch.load(SeqCst) == epoch,
            "Facility request cancelled before admission"
        );
        let id = self.sequence.fetch_add(1, SeqCst) + 1;
        let job = Box::new(Job {
            id,
            generation,
            epoch: self.epoch.load(SeqCst),
            task,
            error: None,
        });
        {
            let mut ports = self.ports.lock().unwrap();
            while ports.results.pop().is_ok() {}
            ports
                .commands
                .push(job)
                .map_err(|_| anyhow::anyhow!("Teia facilities queue is full"))?;
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(8) {
            {
                let mut ports = self.ports.lock().unwrap();
                while let Ok(job) = ports.results.pop() {
                    if job.id == id {
                        ensure!(job.error.is_none(), "Teia facility failed: {:?}", job.error);
                        return Ok(job);
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        self.cancel();
        anyhow::bail!("Timed out; Buffer capture cancelled and writes will resume at the next render boundary")
    }
    pub fn latest(&self) -> Option<Reading> {
        let mut ports = self.ports.lock().unwrap();
        let mut latest = None;
        while let Ok(frame) = ports.readings.pop() {
            latest = Some(frame);
        }
        latest
    }
}
impl Render {
    pub fn boundary(&mut self, mut instance: Option<&mut Instance>) {
        if self.active.as_ref().is_some_and(|a| {
            a.job.epoch != self.host.epoch.load(SeqCst)
                || instance
                    .as_ref()
                    .is_none_or(|i| i.identity().generation != a.job.generation)
        }) {
            let active = self.active.as_mut().unwrap();
            if active.job.error.is_none() {
                if let Some(i) = instance.as_deref_mut() {
                    let _ = i.end_buffer_capture(&active.token);
                }
                active.job.error = Some(Error::StaleGeneration);
            }
            if self.results.slots() > 0 {
                let active = self.active.take().unwrap();
                let _ = self.results.push(active.job);
            }
        }
        if self.results.slots() < 2 {
            return;
        }
        if let Ok(mut job) = self.commands.pop() {
            if job.epoch != self.host.epoch.load(SeqCst)
                || instance
                    .as_ref()
                    .is_none_or(|i| i.identity().generation != job.generation)
            {
                job.error = Some(Error::StaleGeneration);
                let _ = self.results.push(job);
            } else {
                let i = instance.as_deref_mut().unwrap();
                let result = match &mut job.task {
                    Task::Observe(plan) => {
                        let result = i.apply_observation(plan);
                        if result.is_ok() {
                            self.serial = job.id;
                        }
                        result
                    }
                    Task::Replace(replacement) => i.replace_buffer(replacement),
                    Task::Capture {
                        identity, state, ..
                    } => {
                        if self.active.is_some() {
                            Err(Error::Capacity)
                        } else {
                            match i.begin_buffer_capture(*identity, *state) {
                                Ok(token) => {
                                    self.active = Some(Active { job, token });
                                    return self.copy_chunk(instance);
                                }
                                Err(e) => Err(e),
                            }
                        }
                    }
                };
                job.error = result.err();
                let _ = self.results.push(job);
            }
        }
        self.copy_chunk(instance);
    }
    fn copy_chunk(&mut self, mut instance: Option<&mut Instance>) {
        if self.results.slots() == 0 {
            return;
        }
        if let Some(active) = self.active.as_mut() {
            let result = if let Some(i) = instance.as_deref_mut() {
                if let Task::Capture { data, .. } = &mut active.job.task {
                    data.count = active.token.sample_count();
                    data.rate = active.token.sample_rate();
                    let start = active.token.position();
                    let end = (start + MAX_TRANSFER_SAMPLES).min(data.count);
                    i.read_buffer_capture(&mut active.token, &mut data.samples[start..end])
                        .map(|_| ())
                } else {
                    unreachable!()
                }
            } else {
                Err(Error::StaleGeneration)
            };
            if result.is_err() || active.token.position() == active.token.sample_count() {
                let mut active = self.active.take().unwrap();
                if let Some(i) = instance.as_deref_mut() {
                    let _ = i.end_buffer_capture(&active.token);
                }
                active.job.error = result.err();
                let _ = self.results.push(active.job);
            }
        }
    }
    pub fn collect(&mut self, instance: &mut Instance) {
        self.divider += 1;
        if self.divider < 19 || !self.host.enabled.load(SeqCst) || self.readings.slots() == 0 {
            return;
        }
        self.divider = 0;
        let report = instance.collect_observation(&mut self.scratch);
        let feedback = instance.feedback();
        let _ = self.readings.push(Reading {
            serial: self.serial,
            generation: report.identity.generation,
            layout: report.identity.layout,
            count: report.written,
            dropped: report.dropped,
            values: self.scratch,
            event_overflows: feedback.event_overflows,
            queued_notes: feedback.queued_notes,
        });
    }
}
