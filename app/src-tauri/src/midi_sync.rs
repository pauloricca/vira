//! MIDI clock and periodic Start messages anchored to the global beat.
use crate::instruments::Instrument;
use std::collections::{BTreeMap, HashSet};

pub struct Event {
    pub output: i32,
    pub bytes: Vec<u8>,
    pub ns: u64,
}
#[derive(Default)]
struct Clock {
    next_tick: Option<i64>,
    last_stamp: u64,
    advance_ms: f64,
}
struct Plays {
    output: i32,
    bars: u8,
    advance_ms: f64,
    next_group: i64,
}
#[derive(Default)]
pub struct Scheduler {
    clocks: BTreeMap<i32, Clock>,
    plays: BTreeMap<String, Plays>,
    last_beat: Option<f64>,
}
fn stamp(now: u64, target: f64, beat: f64, bpm: f64) -> u64 {
    now.saturating_add(((target - beat).max(0.) * 60. / bpm * 1e9) as u64)
}
impl Scheduler {
    pub fn tick(
        &mut self,
        instruments: &[Instrument],
        available: &HashSet<i32>,
        running: bool,
        beat: f64,
        bpm: f64,
        now: u64,
    ) -> Vec<Event> {
        if !running || !beat.is_finite() || !bpm.is_finite() || bpm <= 0. {
            // Keep Play cursors while paused: resuming at the same boundary must
            // not retrigger it. No transport messages accompany run-state changes.
            for clock in self.clocks.values_mut() {
                clock.next_tick = None;
            }
            return Vec::new();
        }
        let jumped = self
            .last_beat
            .is_some_and(|last| beat < last - 0.01 || beat - last > 0.25);
        self.last_beat = Some(beat);
        let mut selected = BTreeMap::<i32, f64>::new();
        for instrument in instruments {
            if let Some(port) = instrument.midi_output.as_ref() {
                if available.contains(&port.device) && port.send_clock {
                    let advance = selected.entry(port.device).or_default();
                    *advance = advance.max(instrument.advance_ms);
                }
            }
        }
        let mut events = Vec::new();
        self.clocks
            .retain(|output, _| selected.contains_key(output));
        for (&output, &advance_ms) in &selected {
            let state = self.clocks.entry(output).or_default();
            let clock_beat = beat + advance_ms / 1000. * bpm / 60.;
            let changed = state.advance_ms != advance_ms;
            state.advance_ms = advance_ms;
            let first = (clock_beat * 24. - 1e-7).ceil() as i64;
            let next = if jumped || changed {
                first
            } else {
                state.next_tick.unwrap_or(first).max(first)
            };
            let end = ((clock_beat + 0.005 * bpm / 60.) * 24. + 1e-7).floor() as i64;
            for tick in next..=end {
                let ns = stamp(now, tick as f64 / 24., clock_beat, bpm).max(state.last_stamp);
                events.push(Event {
                    output,
                    bytes: vec![0xf8],
                    ns,
                });
                state.last_stamp = ns;
            }
            state.next_tick = Some(next.max(end.saturating_add(1)));
        }
        let mut active = HashSet::new();
        for instrument in instruments {
            let Some(port) = instrument.midi_output.as_ref() else {
                continue;
            };
            if !port.send_transport || !available.contains(&port.device) {
                continue;
            }
            active.insert(instrument.id.clone());
            // Each instrument's Play schedule uses its own latency compensation.
            let advance_ms = instrument.advance_ms;
            let play_beat = beat + advance_ms / 1000. * bpm / 60.;
            let period = port.transport_bars as f64 * 4.;
            let first = ((play_beat / period - 1e-9).ceil() as i64).max(0);
            let state = self.plays.entry(instrument.id.clone()).or_insert(Plays {
                output: port.device,
                bars: port.transport_bars,
                advance_ms,
                next_group: first,
            });
            if jumped
                || state.output != port.device
                || state.bars != port.transport_bars
                || state.advance_ms != advance_ms
            {
                *state = Plays {
                    output: port.device,
                    bars: port.transport_bars,
                    advance_ms,
                    next_group: first,
                };
            }
            let next = state.next_group.max(first);
            let end = ((play_beat + 0.005 * bpm / 60.) / period + 1e-9).floor() as i64;
            for group in next..=end {
                events.push(Event {
                    output: port.device,
                    bytes: vec![0xfa],
                    ns: stamp(now, group as f64 * period, play_beat, bpm),
                });
            }
            state.next_group = next.max(end.saturating_add(1));
        }
        self.plays.retain(|id, _| active.contains(id));
        // Put Start before a simultaneous clock pulse and combine identical
        // messages requested by instruments sharing a port.
        events.sort_by_key(|e| (e.ns, e.output, e.bytes[0] != 0xfa));
        events.dedup_by(|a, b| a.output == b.output && a.ns == b.ns && a.bytes == b.bytes);
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn instrument(clock: bool, transport: bool) -> Instrument {
        serde_json::from_value(json!({"id":"synth","name":"Synth","midi_output":{"device":42,"channel":1,"send_clock":clock,"send_transport":transport}})).unwrap()
    }
    #[test]
    fn clock_uses_instrument_advance_at_each_tempo_with_a_bounded_queue() {
        let available = HashSet::from([42]);
        for bpm in [60., 120., 180.] {
            for advance_ms in [0., 10., 1250.] {
                let mut s = Scheduler::default();
                let mut item = instrument(true, false);
                item.advance_ms = advance_ms;
                let mut events = Vec::new();
                for ms in 0..100 {
                    let now = 1_000_000_000 + ms * 1_000_000;
                    let batch = s.tick(
                        &[item.clone()],
                        &available,
                        true,
                        8. + ms as f64 / 1000. * bpm / 60.,
                        bpm,
                        now,
                    );
                    assert!(batch.iter().all(|e| e.ns >= now && e.ns <= now + 5_000_001));
                    events.extend(batch);
                }
                let first_tick = ((8. + advance_ms / 1000. * bpm / 60.) * 24. - 1e-7).ceil();
                assert!(!events.is_empty());
                for (index, event) in events.iter().enumerate() {
                    let expected = 1_000_000_000.
                        + ((first_tick + index as f64) / 24. - 8.) * 60. / bpm * 1e9
                        - advance_ms * 1e6;
                    assert_eq!(event.bytes, [0xf8]);
                    assert!(event.ns.abs_diff(expected.round() as u64) <= 2);
                }
            }
        }
    }

    #[test]
    fn shared_clock_stream_is_24_ppqn_and_advance_edits_realign() {
        let available = HashSet::from([42]);
        let mut first = instrument(true, false);
        let mut shared = first.clone();
        shared.id = "shared".into();
        let mut s = Scheduler::default();
        let mut events = Vec::new();
        for ms in 0..500 {
            events.extend(s.tick(
                &[first.clone(), shared.clone()],
                &available,
                true,
                ms as f64 / 500.,
                120.,
                1_000_000_000 + ms * 1_000_000,
            ));
        }
        let pulses: Vec<_> = events.iter().filter(|e| e.ns < 1_500_000_000).collect();
        assert_eq!(pulses.len(), 24);
        for (index, event) in pulses.iter().enumerate() {
            assert_eq!(event.bytes, [0xf8]);
            assert!(
                event
                    .ns
                    .abs_diff(1_000_000_000 + index as u64 * 500_000_000 / 24)
                    <= 2
            );
        }
        first.advance_ms = 1250.;
        s.tick(
            &[first.clone()],
            &available,
            true,
            1.02,
            120.,
            1_510_000_000,
        );
        first.advance_ms = 0.;
        let edited = s.tick(&[first], &available, true, 1.04, 120., 1_520_000_000);
        assert_eq!(edited.len(), 1);
        assert_eq!(edited[0].bytes, [0xf8]);
        assert!(edited[0].ns.abs_diff(1_520_833_333) <= 2);
    }
    #[test]
    fn shared_output_plays_use_each_instruments_own_advance() {
        let available = HashSet::from([42]);
        let mut clock = instrument(true, false);
        clock.advance_ms = 100.;
        let mut play = instrument(false, true);
        play.id = "play".into();
        play.advance_ms = 10.;
        let events =
            Scheduler::default().tick(&[clock, play], &available, true, 3.976, 120., 1_000_000_000);
        let plays: Vec<_> = events.iter().filter(|e| e.bytes == [0xfa]).collect();
        assert_eq!(plays.len(), 1);
        assert!(plays[0].ns.abs_diff(1_002_000_000) <= 2);
    }
    #[test]
    fn all_intervals_repeat_on_global_groups_and_pause_never_sends_transport() {
        let available = HashSet::from([42]);
        for bars in [1, 2, 4, 16, 32] {
            let mut item = instrument(false, true);
            item.midi_output.as_mut().unwrap().transport_bars = bars;
            let mut s = Scheduler::default();
            let mut events = Vec::new();
            let steps = bars as u64 * 80; // two groups, one tick each 0.1 beat
            for step in 0..=steps {
                let beat = step as f64 / 10.;
                let now = 1_000_000_000 + step * 50_000_000;
                events.extend(s.tick(&[item.clone()], &available, true, beat, 120., now));
                assert!(s
                    .tick(&[item.clone()], &available, false, beat, 120., now)
                    .is_empty());
                assert!(s
                    .tick(&[item.clone()], &available, true, beat, 120., now)
                    .is_empty());
            }
            assert_eq!(events.len(), 3, "interval {bars}");
            for (index, event) in events.iter().enumerate() {
                assert_eq!(event.bytes, [0xfa]);
                assert_eq!(
                    event.ns,
                    1_000_000_000 + index as u64 * bars as u64 * 2_000_000_000
                );
            }
        }
    }
    #[test]
    fn plays_honor_advance_without_clock_at_multiple_tempos_and_large_advances() {
        let available = HashSet::from([42]);
        for bpm in [60., 120., 180.] {
            for advance_ms in [10., 1250.] {
                let mut s = Scheduler::default();
                let mut item = instrument(false, true);
                item.advance_ms = advance_ms;
                // 2 ms before the early send time for global beat 16.
                let beat = 16. - (advance_ms / 1000. + 0.002) * bpm / 60.;
                let events = s.tick(&[item.clone()], &available, true, beat, bpm, 1_000_000_000);
                assert_eq!(events.len(), 1);
                assert_eq!(events[0].bytes, [0xfa]);
                assert!(events[0].ns.abs_diff(1_002_000_000) <= 2);
                assert!(s
                    .tick(
                        &[item],
                        &available,
                        true,
                        beat + 0.001 * bpm / 60.,
                        bpm,
                        1_001_000_000
                    )
                    .is_empty());
            }
        }
    }
    #[test]
    fn joins_wait_for_boundaries_and_edits_jumps_and_disconnects_never_send_stop_or_continue() {
        let available = HashSet::from([42]);
        let mut s = Scheduler::default();
        let mut item = instrument(false, true);
        assert!(s
            .tick(&[item.clone()], &available, true, 1., 120., 1_000_000_000)
            .is_empty());
        assert!(s
            .tick(&[item.clone()], &available, false, 1., 120., 1_001_000_000)
            .is_empty());
        assert!(s
            .tick(&[item.clone()], &available, true, 2., 120., 1_500_000_000)
            .is_empty());
        assert_eq!(
            s.tick(
                &[item.clone()],
                &available,
                true,
                3.998,
                120.,
                2_499_000_000
            )[0]
            .bytes,
            [0xfa]
        );
        item.midi_output.as_mut().unwrap().transport_bars = 4;
        assert!(s
            .tick(&[item.clone()], &available, true, 4.1, 120., 2_550_000_000)
            .is_empty());
        assert!(s
            .tick(
                &[item.clone()],
                &HashSet::new(),
                true,
                16.,
                120.,
                8_000_000_000
            )
            .is_empty());
        assert!(s
            .tick(&[item.clone()], &available, true, 17., 120., 8_500_000_000)
            .is_empty());
        let events = s.tick(&[item], &available, true, 32., 120., 16_000_000_000);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].bytes, [0xfa]);
        assert!(s
            .tick(&[], &available, true, 32.1, 120., 16_050_000_000)
            .is_empty());
    }
    #[test]
    fn instruments_keep_independent_intervals_and_shared_messages_are_deduplicated() {
        let available = HashSet::from([42, 43]);
        let first = instrument(false, true);
        let mut second = instrument(false, true);
        second.id = "second".into();
        second.midi_output.as_mut().unwrap().transport_bars = 4;
        second.midi_output.as_mut().unwrap().device = 43;
        let items = [first.clone(), second];
        let mut s = Scheduler::default();
        assert_eq!(
            s.tick(&items, &available, true, 0., 120., 1_000_000_000)
                .len(),
            2
        );
        let events = s.tick(&items, &available, true, 4., 120., 3_000_000_000);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].output, 42);
        let mut shared = first.clone();
        shared.id = "shared".into();
        let mut s = Scheduler::default();
        assert_eq!(
            s.tick(&[first, shared], &available, true, 0., 120., 1_000_000_000)
                .len(),
            1
        );
    }
    #[test]
    fn clock_and_play_share_advance_and_start_precedes_the_bar_clock_pulse() {
        let available = HashSet::from([42]);
        let mut item = instrument(true, true);
        item.advance_ms = 10.;
        let mut s = Scheduler::default();
        let events = s.tick(&[item], &available, true, 3.976, 120., 1_000_000_000);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].bytes, [0xfa]);
        assert_eq!(events[1].bytes, [0xf8]);
        assert_eq!(events[0].ns, events[1].ns);
        assert!(events[0].ns.abs_diff(1_002_000_000) <= 2);
    }
}
