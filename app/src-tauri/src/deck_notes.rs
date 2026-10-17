//! Timestamped MIDI note control for deck transposition. Shares the instrument
//! queue's route ownership/cancellation, but renders into the deck pitch control.
use crate::teia_midi;
use std::sync::atomic::Ordering::SeqCst;
use teia_kernel::hosted::EventKind;
pub struct Lane {
    pub midi: teia_midi::Render,
    held: [u64; 2048],
    serial: u64,
    selected: Option<u8>,
    generation: u64,
    pub manual: f64,
}
impl Lane {
    pub fn new() -> Self {
        Self {
            midi: teia_midi::channel(),
            held: [0; 2048],
            serial: 0,
            selected: None,
            generation: 0,
            manual: 0.,
        }
    }
    pub fn prepare(&mut self, generation: u64, pitch: f64) {
        if generation != self.generation || self.midi.host.muted.load(SeqCst) {
            if generation != self.generation {
                self.manual = pitch;
            }
            self.generation = generation;
            self.held.fill(0);
            self.selected = None;
            self.midi.host.invalidate();
            self.midi.host.generation.store(generation, SeqCst);
            self.midi.host.muted.store(false, SeqCst);
        }
        self.midi.prepare_input(self.midi.host.epoch.load(SeqCst));
    }
    pub fn pitch(&mut self, frame: u64) -> f64 {
        let mut changed = false;
        while let Some(input) = self.midi.input_before(frame + 1) {
            if input.generation != self.generation {
                continue;
            }
            changed = true;
            match input.kind {
                EventKind::NoteOn {
                    channel,
                    note,
                    velocity,
                } => {
                    let index = (channel as usize - 1) * 128 + note as usize;
                    if velocity > 0. {
                        self.serial += 1;
                        self.held[index] = self.serial;
                    } else {
                        self.held[index] = 0;
                    }
                }
                EventKind::NoteOff { channel, note } => {
                    self.held[(channel as usize - 1) * 128 + note as usize] = 0
                }
                _ => {}
            }
        }
        if changed {
            self.selected = self
                .held
                .iter()
                .enumerate()
                .filter(|(_, serial)| **serial > 0)
                .max_by_key(|(_, serial)| **serial)
                .map(|(pitch, _)| (pitch % 128) as u8);
        }
        self.selected.map_or(self.manual, |pitch| {
            (self.manual + pitch as f64 - 60.).clamp(-6., 6.)
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timed_notes_restore_manual_pitch_and_cancel_pending_route() {
        let mut lane = Lane::new();
        lane.prepare(1, -1.);
        let h = lane.midi.host.clone();
        h.enqueue(
            10,
            EventKind::NoteOn {
                channel: 1,
                note: 64,
                velocity: 1.,
            },
        );
        h.enqueue(
            20,
            EventKind::NoteOn {
                channel: 1,
                note: 62,
                velocity: 1.,
            },
        );
        h.enqueue(
            30,
            EventKind::NoteOff {
                channel: 1,
                note: 62,
            },
        );
        h.enqueue(
            40,
            EventKind::NoteOff {
                channel: 1,
                note: 64,
            },
        );
        lane.prepare(1, -1.);
        assert_eq!(lane.pitch(9), -1.);
        assert_eq!(lane.pitch(10), 3.);
        assert_eq!(lane.pitch(20), 1.);
        assert_eq!(lane.pitch(30), 3.);
        assert_eq!(lane.pitch(40), -1.);
        h.anchor(100, 1_000_000_000);
        assert!(h.enqueue_routed_time(
            1_000_000_000,
            EventKind::NoteOn {
                channel: 1,
                note: 67,
                velocity: 1.
            },
            2
        ));
        lane.prepare(1, -1.);
        assert_eq!(lane.pitch(100), 6.);
        h.cancel_route(2);
        lane.prepare(1, 6.);
        assert_eq!(lane.pitch(101), -1.);
        assert!(h.enqueue_routed_time(
            2_000_000_000,
            EventKind::NoteOn {
                channel: 1,
                note: 65,
                velocity: 1.
            },
            2
        ));
        h.cancel_route(2);
        lane.prepare(1, -1.);
        assert_eq!(lane.pitch(100_000), -1.);
    }
    #[test]
    fn replacement_drops_old_notes_and_adopts_new_manual_pitch() {
        let mut lane = Lane::new();
        lane.prepare(1, 0.);
        lane.midi.host.enqueue(
            0,
            EventKind::NoteOn {
                channel: 1,
                note: 64,
                velocity: 1.,
            },
        );
        lane.prepare(1, 0.);
        assert_eq!(lane.pitch(0), 4.);
        lane.prepare(2, -2.);
        assert_eq!(lane.pitch(1), -2.);
    }
}
