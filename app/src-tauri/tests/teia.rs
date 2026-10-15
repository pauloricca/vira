use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
    sync::atomic::Ordering::SeqCst,
};
use teia_kernel::hosted::{ControlEvent, Instance, Operation, PreparedProgram};
use vira::{
    decks::{Frame, PRODUCER_FRAMES},
    teia_audio::{self, Action, Command, Live, Status},
};
mod shared_effects {
    use super::*;
    use teia_kernel::hosted::{CustomWave, Image, Resources, Sample, SequenceEvent, Sequencer};
    include!("../../vendor/teia-kernel/tests/fixtures/shared.rs");

    #[test]
    fn all_shared_resource_fixtures_render_and_request_reset_without_producer_allocations() {
        let mut count = 0;
        for (name, operations, values, resources) in fixtures() {
            let program = PreparedProgram::prepare(1, 7, &operations, &values).unwrap();
            let instance = Instance::new_with_resources(&program, 48000., 128, &resources).unwrap();
            let (mut ports, mut driver) = teia_audio::channel();
            driver.telemetry.latest.store(1, SeqCst);
            ports
                .commands
                .push(Command {
                    id: 1,
                    action: Action::Install {
                        ticket: 1,
                        live: Box::new(Live {
                            instance,
                            generation: 7,
                            values,
                        }),
                    },
                })
                .ok()
                .unwrap();
            let mut frames = block();
            CHANGES.with(|n| n.set(0));
            WATCH.with(|w| w.set(true));
            driver.commands();
            for _ in 0..8 {
                driver.process(&mut frames);
            }
            WATCH.with(|w| w.set(false));
            assert_eq!(CHANGES.with(Cell::get), 0, "{name} render");
            assert_eq!(ports.acks.pop().unwrap().status, Status::Installed);
            ports
                .commands
                .push(Command {
                    id: 2,
                    action: Action::Reset(7),
                })
                .ok()
                .unwrap();
            CHANGES.with(|n| n.set(0));
            WATCH.with(|w| w.set(true));
            driver.commands();
            driver.process(&mut frames);
            WATCH.with(|w| w.set(false));
            assert_eq!(CHANGES.with(Cell::get), 0, "{name} reset");
            assert_eq!(ports.acks.pop().unwrap().status, Status::Updated);
            assert!(
                frames
                    .iter()
                    .all(|f| f.samples.iter().all(|v| v.is_finite())),
                "{name}"
            );
            count += 1;
        }
        assert_eq!(count, 62);
    }
    #[test]
    fn staged_capture_observation_and_replacement_are_allocation_free_on_the_producer() {
        use teia_kernel::hosted::{BufferReplacement, Observation, ObservationPlan};
        use vira::teia_facilities::{Capture, Task};
        fn pump<T>(driver: &mut teia_audio::Driver, worker: &std::thread::JoinHandle<T>) {
            let started = std::time::Instant::now();
            while !worker.is_finished() {
                assert!(started.elapsed() < std::time::Duration::from_secs(7));
                CHANGES.with(|n| n.set(0));
                WATCH.with(|w| w.set(true));
                driver.commands();
                driver.process(&mut block());
                WATCH.with(|w| w.set(false));
                assert_eq!(
                    CHANGES.with(Cell::get),
                    0,
                    "facility boundary allocated/dropped"
                );
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
        let (_, operations, values, resources) = fixtures()
            .into_iter()
            .find(|(name, ..)| *name == "Buffer")
            .unwrap();
        let state = operations.iter().find(|op| op.opcode == 34).unwrap().state as u32;
        let program = PreparedProgram::prepare(1, 7, &operations, &values).unwrap();
        let identity = program.identity();
        let plan = ObservationPlan::prepare(&program, &[Observation::Buffer { state, points: 64 }])
            .unwrap();
        let replacement = BufferReplacement::clear(&program, state, 2).unwrap();
        let (mut ports, mut driver) = teia_audio::channel();
        driver.telemetry.latest.store(1, SeqCst);
        ports
            .commands
            .push(Command {
                id: 1,
                action: Action::Install {
                    ticket: 1,
                    live: Box::new(Live {
                        instance: Instance::new_with_resources(&program, 48000., 128, &resources)
                            .unwrap(),
                        generation: 7,
                        values,
                    }),
                },
            })
            .ok()
            .unwrap();
        driver.commands();
        driver.process(&mut block());
        let host = driver.facilities.host.clone();
        host.enabled.store(true, SeqCst);
        let request = host.clone();
        let worker = std::thread::spawn(move || request.request(7, Task::Observe(Some(plan))));
        pump(&mut driver, &worker);
        assert!(worker.join().unwrap().is_ok());
        let request = host.clone();
        let worker = std::thread::spawn(move || {
            request.request(
                7,
                Task::Capture {
                    identity,
                    state,
                    data: Capture {
                        samples: vec![0.; 960000],
                        count: 0,
                        rate: 0.,
                    },
                },
            )
        });
        pump(&mut driver, &worker);
        let job = worker.join().unwrap().unwrap();
        if let Task::Capture { data, .. } = job.task {
            assert!((2..=960000).contains(&data.count));
            assert_eq!(data.rate, 48000.);
            assert!(data.samples[..data.count].iter().all(|v| v.is_finite()));
        } else {
            panic!("wrong capture reply");
        }
        let request = host.clone();
        let worker = std::thread::spawn(move || request.request(7, Task::Replace(replacement)));
        pump(&mut driver, &worker);
        assert!(worker.join().unwrap().is_ok());
        for _ in 0..20 {
            driver.process(&mut block());
        }
        assert!(host.latest().is_some());
    }
    #[test]
    fn shared_effect_install_render_and_reset_allocate_nothing_on_producer() {
        let names = [
            "LowpassFilter",
            "HighpassFilter",
            "Delay",
            "Chorus",
            "Reverb",
            "Compress",
            "Limiter",
            "Envelope",
            "Follower",
            "Equalizer",
        ];
        let mut tested = Vec::new();
        for (name, operations, values, _) in fixtures() {
            if !names.contains(&name) {
                continue;
            }
            let program = PreparedProgram::prepare(1, 7, &operations, &values).unwrap();
            let mut instance = Instance::new(&program, 48000., 128).unwrap();
            CHANGES.with(|n| n.set(0));
            WATCH.with(|w| w.set(true));
            instance.reset();
            WATCH.with(|w| w.set(false));
            assert_eq!(CHANGES.with(Cell::get), 0, "{name} reset");
            let (mut ports, mut driver) = teia_audio::channel();
            driver.telemetry.latest.store(1, SeqCst);
            ports
                .commands
                .push(Command {
                    id: 1,
                    action: Action::Install {
                        ticket: 1,
                        live: Box::new(Live {
                            instance,
                            generation: 7,
                            values,
                        }),
                    },
                })
                .ok()
                .unwrap();
            let mut frames = block();
            CHANGES.with(|n| n.set(0));
            WATCH.with(|w| w.set(true));
            driver.commands();
            for _ in 0..32 {
                driver.process(&mut frames);
            }
            WATCH.with(|w| w.set(false));
            assert_eq!(CHANGES.with(Cell::get), 0, "{name} producer");
            assert!(frames
                .iter()
                .all(|f| f.samples.iter().all(|v| v.is_finite())));
            assert_eq!(frames[127].cue_samples, [0.1, 0.2]);
            assert_eq!(ports.acks.pop().unwrap().status, Status::Installed);
            tested.push(name);
        }
        for name in names {
            assert!(tested.contains(&name), "Missing fixture {name}");
        }
    }
}
thread_local! { static WATCH: Cell<bool> = const { Cell::new(false) }; static CHANGES: Cell<usize> = const { Cell::new(0) }; }
struct Allocator;
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = WATCH.try_with(|w| {
            if w.get() {
                CHANGES.with(|n| n.set(n.get() + 1));
            }
        });
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let _ = WATCH.try_with(|w| {
            if w.get() {
                CHANGES.with(|n| n.set(n.get() + 1));
            }
        });
        System.dealloc(ptr, layout)
    }
}
#[global_allocator]
static ALLOCATOR: Allocator = Allocator;
fn op(opcode: i32, out: i32, a: i32, b: i32) -> Operation {
    Operation {
        opcode,
        out,
        a,
        b,
        c: -1,
        d: -1,
        e: -1,
        state: -1,
        value: 0.,
        value2: 0.,
        value3: 0.,
        value4: 0.,
    }
}
fn live(generation: u64, value: f64) -> Box<Live> {
    let prepared = PreparedProgram::prepare(
        1,
        generation,
        &[
            op(0, 0, 0, -1),
            op(11, 1, 0, 0),
            op(11, 2, 0, 1),
            op(5, -1, 1, 0),
            op(5, -1, 2, 1),
        ],
        &[value],
    )
    .unwrap();
    Box::new(Live {
        instance: Instance::new(&prepared, 48000., 128).unwrap(),
        generation,
        values: vec![value],
    })
}
fn block() -> [Frame; PRODUCER_FRAMES] {
    [Frame {
        samples: [0.4, -0.2],
        cue_samples: [0.1, 0.2],
        master_bpm: 120.,
        ..Frame::default()
    }; PRODUCER_FRAMES]
}
#[test]
fn refreshed_bend_opcode_preserves_ratio_limits_in_the_master_insert() {
    for exponent in [-100.0_f64, -1.0, 0.0, 1.0, 100.0] {
        // Scale the control-domain ratio before Audio Out so its existing audio
        // clamp cannot hide the 12,000 control-value limit.
        let values = vec![exponent, 1. / 12000.];
        let prepared = PreparedProgram::prepare(
            1,
            7,
            &[
                op(0, 0, 0, -1),
                op(55, 1, 0, -1),
                op(0, 2, 1, -1),
                op(2, 3, 1, 2),
                op(5, -1, 3, 0),
            ],
            &values,
        )
        .unwrap();
        let instance = Instance::new(&prepared, 48000., 128).unwrap();
        let (mut ports, mut driver) = teia_audio::channel();
        driver.telemetry.latest.store(1, SeqCst);
        ports
            .commands
            .push(Command {
                id: 1,
                action: Action::Install {
                    ticket: 1,
                    live: Box::new(Live {
                        instance,
                        generation: 7,
                        values,
                    }),
                },
            })
            .ok()
            .unwrap();
        driver.commands();
        driver.process(&mut block());
        driver.process(&mut block());
        let mut frames = block();
        driver.process(&mut frames);
        let expected = (2.0_f64.powf(exponent.clamp(-32., 32.)).min(12000.) / 12000.) as f32;
        assert_eq!(frames[127].samples, [expected, 0.]);
        assert_eq!(ports.acks.pop().unwrap().status, Status::Installed);
    }
}
#[test]
fn master_insert_controls_preserve_cue_and_allocate_nothing_on_producer() {
    let (mut ports, mut driver) = teia_audio::channel();
    driver.telemetry.latest.store(1, SeqCst);
    ports
        .commands
        .push(Command {
            id: 1,
            action: Action::Install {
                ticket: 1,
                live: live(7, 0.5),
            },
        })
        .ok()
        .unwrap();
    CHANGES.with(|n| n.set(0));
    WATCH.with(|w| w.set(true));
    let mut frames = block();
    driver.commands();
    driver.process(&mut frames);
    driver.process(&mut block());
    WATCH.with(|w| w.set(false));
    assert_eq!(CHANGES.with(Cell::get), 0);
    assert_eq!(ports.acks.pop().unwrap().status, Status::Installed);
    let mut frames = block();
    driver.process(&mut frames);
    assert_eq!(frames[127].samples, [0.2, -0.1]);
    assert_eq!(frames[127].cue_samples, [0.1, 0.2]);
    ports
        .commands
        .push(Command {
            id: 2,
            action: Action::Values {
                ticket: 1,
                generation: 7,
                values: vec![ControlEvent {
                    offset: 0,
                    value_index: 0,
                    value: 0.25,
                    generation: 7,
                }]
                .into_boxed_slice(),
            },
        })
        .ok()
        .unwrap();
    CHANGES.with(|n| n.set(0));
    WATCH.with(|w| w.set(true));
    let mut frames = block();
    driver.commands();
    driver.process(&mut frames);
    WATCH.with(|w| w.set(false));
    assert_eq!(CHANGES.with(Cell::get), 0);
    assert_eq!(frames[0].samples, [0.1, -0.05]);
    assert_eq!(ports.acks.pop().unwrap().generation, 7);
}
#[test]
fn stale_installation_and_controls_leave_last_valid_instance_running() {
    let (mut ports, mut driver) = teia_audio::channel();
    driver.telemetry.latest.store(1, SeqCst);
    ports
        .commands
        .push(Command {
            id: 1,
            action: Action::Install {
                ticket: 1,
                live: live(7, 0.5),
            },
        })
        .ok()
        .unwrap();
    driver.commands();
    driver.process(&mut block());
    ports.acks.pop().unwrap();
    driver.telemetry.latest.store(3, SeqCst);
    ports
        .commands
        .push(Command {
            id: 2,
            action: Action::Install {
                ticket: 2,
                live: live(8, 0.25),
            },
        })
        .ok()
        .unwrap();
    driver.commands();
    driver.process(&mut block());
    assert_eq!(ports.acks.pop().unwrap().status, Status::Superseded);
    ports
        .commands
        .push(Command {
            id: 3,
            action: Action::Values {
                ticket: 3,
                generation: 8,
                values: vec![ControlEvent {
                    offset: 0,
                    value_index: 0,
                    value: 0.1,
                    generation: 8,
                }]
                .into_boxed_slice(),
            },
        })
        .ok()
        .unwrap();
    driver.commands();
    driver.process(&mut block());
    assert_eq!(ports.acks.pop().unwrap().status, Status::Stale);
    let mut frames = block();
    driver.process(&mut frames);
    assert_eq!(frames[127].samples, [0.2, -0.1]);
    assert_eq!(driver.telemetry.generation.load(SeqCst), 7);
    assert!(ports.retired.pop().is_ok());
}

#[test]
fn midi_events_keep_sample_offsets_and_ignore_retired_generations() {
    let values = vec![0.0];
    let prepared = PreparedProgram::prepare(
        1,
        7,
        &[op(0, 0, 0, -1), op(27, 1, 3, 0), op(5, -1, 1, 0)],
        &values,
    )
    .unwrap();
    let instance = Instance::new(&prepared, 48000., 128).unwrap();
    let (mut ports, mut driver) = teia_audio::channel();
    driver.telemetry.latest.store(1, SeqCst);
    ports
        .commands
        .push(Command {
            id: 1,
            action: Action::Install {
                ticket: 1,
                live: Box::new(Live {
                    instance,
                    generation: 7,
                    values,
                }),
            },
        })
        .ok()
        .unwrap();
    driver.commands();
    driver.process(&mut block());
    driver.process(&mut block());
    let midi = driver.midi.host.clone();
    midi.generation.store(6, SeqCst);
    assert!(midi.enqueue(
        16,
        teia_kernel::hosted::EventKind::NoteOn {
            channel: 1,
            note: 60,
            velocity: 1.
        }
    ));
    midi.generation.store(7, SeqCst);
    assert!(midi.enqueue(
        32,
        teia_kernel::hosted::EventKind::NoteOn {
            channel: 1,
            note: 60,
            velocity: 1.
        }
    ));
    assert!(midi.enqueue(
        64,
        teia_kernel::hosted::EventKind::NoteOff {
            channel: 1,
            note: 60
        }
    ));
    let mut frames = block();
    CHANGES.with(|n| n.set(0));
    WATCH.with(|w| w.set(true));
    driver.process(&mut frames);
    WATCH.with(|w| w.set(false));
    assert_eq!(CHANGES.with(Cell::get), 0);
    assert!(frames[..32].iter().all(|f| f.samples[0] == 0.));
    assert!(frames[32..64].iter().all(|f| f.samples[0] == 1.));
    assert!(frames[64..].iter().all(|f| f.samples[0] == 0.));
    assert_eq!(frames[127].cue_samples, [0.1, 0.2]);
}

#[test]
fn patch_clock_advances_with_idle_decks_and_uses_sample_timeline() {
    let (mut ports, mut driver) = teia_audio::channel();
    driver.telemetry.latest.store(1, SeqCst);
    ports
        .commands
        .push(Command {
            id: 1,
            action: Action::Install {
                ticket: 1,
                live: live(7, 1.),
            },
        })
        .ok()
        .unwrap();
    driver.commands();
    driver.process(&mut block());
    ports.acks.pop().unwrap();
    ports
        .commands
        .push(Command {
            id: 2,
            action: Action::Clock(true),
        })
        .ok()
        .unwrap();
    driver.commands();
    driver.process(&mut block());
    assert!(driver.telemetry.timeline_running.load(SeqCst));
    assert!(f64::from_bits(driver.telemetry.beat.load(SeqCst)) > 0.);
}
