//! Instance-only monitoring and staged Buffer access. No exported raw pointers.
//! Prepare plans/replacements on an ordinary thread; move them through a bounded
//! host queue. All live access requires exclusive ownership on the render owner.
use super::*;

pub const MAX_OBSERVATIONS: usize = 128;
pub const MAX_TRANSFER_SAMPLES: usize = 1024;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Identity {
    pub generation: u64,
    pub layout: u64,
}
#[derive(Clone, Copy, Debug)]
pub enum ScopeReset {
    None,
    ZeroCrossing,
}
#[derive(Clone, Copy, Debug)]
pub enum Observation {
    Meter {
        register: u32,
    },
    Scope {
        register: u32,
        seconds: f64,
        points: u32,
        reset: ScopeReset,
    },
    SamplePlayheads {
        binding: u32,
        limit: u32,
    },
    SamplePlayhead {
        binding: u32,
        voice: u32,
    },
    Buffer {
        state: u32,
        points: u32,
    },
    RepeatBuffer {
        address: BufferAddress,
        points: u32,
    },
}
/// Request index maps to the host's stable monitorIds/stateBindings identity.
/// The host owns that mapping; never identify a node by operation order.
pub struct ObservationPlan {
    identity: Identity,
    requests: Vec<Observation>,
}
impl ObservationPlan {
    pub fn prepare(program: &PreparedProgram, requests: &[Observation]) -> Result<Self, Error> {
        if requests.len() > MAX_OBSERVATIONS {
            return Err(Error::Capacity);
        }
        let mut scopes = 0;
        let mut meters = 0;
        for request in requests {
            match *request {
                Observation::Meter { register } => {
                    meters += 1;
                    if register as usize >= MAX_DSP_REGS {
                        return Err(Error::InvalidValues);
                    }
                }
                Observation::Scope {
                    register,
                    seconds,
                    points,
                    ..
                } => {
                    scopes += 1;
                    if register as usize >= MAX_DSP_REGS
                        || !seconds.is_finite()
                        || !(0.01..=30.0).contains(&seconds)
                        || !(32..=LINK_SCOPE_POINTS as u32).contains(&points)
                    {
                        return Err(Error::InvalidValues);
                    }
                }
                Observation::SamplePlayheads { binding, limit } => {
                    if binding as usize >= MAX_DSP_SAMPLE_NODES || limit == 0 || limit > 128 {
                        return Err(Error::InvalidValues);
                    }
                }
                Observation::SamplePlayhead { binding, voice } => {
                    if binding as usize >= MAX_DSP_SAMPLE_NODES
                        || voice as usize >= MAX_DSP_SAMPLE_PLAYER_VOICES
                    {
                        return Err(Error::InvalidValues);
                    }
                }
                Observation::RepeatBuffer { address, points } => {
                    if address.depth == 0
                        || !valid_address(&program.ops, address)
                        || points == 0
                        || points > 1024
                    {
                        return Err(Error::InvalidValues);
                    }
                }
                Observation::Buffer { state, points } => {
                    if !root_buffer(&program.ops, state) || points == 0 || points > 1024 {
                        return Err(Error::InvalidValues);
                    }
                }
            }
        }
        if scopes > MAX_DSP_SCOPES || meters > MAX_DSP_METERS {
            return Err(Error::Capacity);
        }
        Ok(Self {
            identity: program.identity(),
            requests: requests.to_vec(),
        })
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct ObservationValue {
    pub request: usize,
    pub index: usize,
    pub value: f64,
    /// Meter signed mean; Buffer upper bound (value is lower bound).
    pub auxiliary: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct ObservationReport {
    pub identity: Identity,
    pub written: usize,
    pub dropped: usize,
}
/// Compiled repeat-template slot and current active item index. Hosts map stable
/// repeatBindings IDs to slots; indices are resolved at the render boundary.
#[derive(Clone, Copy, Debug, Default)]
pub struct RepeatItem {
    pub template: u32,
    pub item: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct BufferAddress {
    pub state: u32,
    pub path: [RepeatItem; 4],
    pub depth: usize,
}
impl BufferAddress {
    pub fn root(state: u32) -> Self {
        Self {
            state,
            path: [RepeatItem::default(); 4],
            depth: 0,
        }
    }
}
fn valid_address(ops: &[DspOp], address: BufferAddress) -> bool {
    if address.depth > 4 {
        return false;
    }
    let mut start = 0;
    let mut end = ops.len();
    for part in &address.path[..address.depth] {
        let Some((index, op)) = ops
            .iter()
            .enumerate()
            .take(end)
            .skip(start)
            .find(|(_, op)| {
                matches!(op.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN)
                    && op.value as u32 == part.template
            })
        else {
            return false;
        };
        start = index + 1;
        end = op.b as usize;
    }
    let mut index = start;
    while index < end {
        let op = ops[index];
        if matches!(op.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN) {
            index = op.b as usize + 1;
            continue;
        }
        if op.opcode == DSP_OP_BUFFER && op.state as u32 == address.state {
            return true;
        }
        index += 1;
    }
    false
}
/// A copy cursor, not a reference into live memory. Stale after reset/replacement,
/// cancellation or mutation. Capture freezes writes only; playback/heads continue.
#[derive(Debug)]
pub struct BufferCapture {
    identity: Identity,
    owner: u64,
    epoch: u64,
    serial: u64,
    slot: usize,
    repeated: bool,
    sample_rate: f64,
    sample_count: usize,
    position: usize,
}
impl BufferCapture {
    pub fn position(&self) -> usize {
        self.position
    }
    pub fn sample_count(&self) -> usize {
        self.sample_count
    }
    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }
}
/// Prepared off-render, including resampling/clear/copy. Swap returns the retired
/// storage in this same object: retain and drop it on an ordinary thread.
pub struct BufferReplacement {
    identity: Identity,
    address: BufferAddress,
    samples: Box<[f32]>,
    count: usize,
}
impl BufferReplacement {
    pub fn prepare(program: &PreparedProgram, state: u32, samples: &[f32]) -> Result<Self, Error> {
        Self::prepare_at(program, BufferAddress::root(state), samples)
    }
    pub fn prepare_at(
        program: &PreparedProgram,
        address: BufferAddress,
        samples: &[f32],
    ) -> Result<Self, Error> {
        if !valid_address(&program.ops, address)
            || samples.len() < 2
            || samples.len() > MAX_DSP_BUFFER_SAMPLES
            || samples.iter().any(|v| !v.is_finite())
        {
            return Err(Error::InvalidValues);
        }
        let mut storage = vec![0.0; MAX_DSP_BUFFER_SAMPLES].into_boxed_slice();
        storage[..samples.len()].copy_from_slice(samples);
        Ok(Self {
            identity: program.identity(),
            address,
            samples: storage,
            count: samples.len(),
        })
    }
    /// Off-render endpoint-aligned interpolation, matching Resources restoration.
    pub fn prepare_resampled(
        program: &PreparedProgram,
        address: BufferAddress,
        samples: &[f32],
        source_rate: f64,
        target_rate: f64,
    ) -> Result<Self, Error> {
        if samples.len() < 2
            || samples.len() > MAX_DSP_BUFFER_SAMPLES
            || samples.iter().any(|v| !v.is_finite())
            || !source_rate.is_finite()
            || source_rate <= 0.0
            || !target_rate.is_finite()
            || target_rate <= 0.0
        {
            return Err(Error::InvalidValues);
        }
        let count = (samples.len() as f64 * target_rate / source_rate)
            .round()
            .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64) as usize;
        let resampled: Vec<f32> = (0..count)
            .map(|index| {
                let position = index as f64 * (samples.len() - 1) as f64 / (count - 1) as f64;
                let left = position.floor() as usize;
                let right = (left + 1).min(samples.len() - 1);
                let mix = position - left as f64;
                (samples[left] as f64 * (1.0 - mix) + samples[right] as f64 * mix) as f32
            })
            .collect();
        Self::prepare_at(program, address, &resampled)
    }
    pub fn clear(program: &PreparedProgram, state: u32, count: usize) -> Result<Self, Error> {
        Self::clear_at(program, BufferAddress::root(state), count)
    }
    pub fn clear_at(
        program: &PreparedProgram,
        address: BufferAddress,
        count: usize,
    ) -> Result<Self, Error> {
        if !valid_address(&program.ops, address) || !(2..=MAX_DSP_BUFFER_SAMPLES).contains(&count) {
            return Err(Error::InvalidValues);
        }
        Ok(Self {
            identity: program.identity(),
            address,
            samples: vec![0.0; MAX_DSP_BUFFER_SAMPLES].into_boxed_slice(),
            count,
        })
    }
}
pub(super) fn root_buffer(ops: &[DspOp], state: u32) -> bool {
    let mut end = 0;
    for (index, op) in ops.iter().enumerate() {
        if index < end {
            continue;
        }
        if matches!(op.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN) {
            end = op.b as usize + 1;
        }
        if op.opcode == DSP_OP_BUFFER && op.state == state as i32 {
            return true;
        }
    }
    false
}
impl PreparedProgram {
    pub fn identity(&self) -> Identity {
        // Deterministic executable layout checksum; not a content/security hash.
        let mut hash = 0xcbf29ce484222325u64;
        for op in &self.ops {
            for word in [
                op.opcode as u64,
                op.out as u64,
                op.a as u64,
                op.b as u64,
                op.c as u64,
                op.d as u64,
                op.e as u64,
                op.state as u64,
                op.value.to_bits(),
                op.value2.to_bits(),
                op.value3.to_bits(),
                op.value4.to_bits(),
            ] {
                hash = (hash ^ word).wrapping_mul(0x100000001b3);
            }
        }
        Identity {
            generation: self.generation,
            layout: hash,
        }
    }
}
impl Instance {
    pub fn identity(&self) -> Identity {
        self.identity
    }
    /// RT-safe: bounded array configuration; swaps ownership without dropping a
    /// plan or invalidating/freeing a block plan. Native uses scalar execution.
    /// On failure the incoming plan remains owned by the caller.
    pub fn apply_observation(&mut self, plan: &mut Option<ObservationPlan>) -> Result<(), Error> {
        if plan.as_ref().is_some_and(|p| p.identity != self.identity()) {
            return Err(Error::StaleGeneration);
        }
        self.state.DSP_METER_SLOT_COUNT = 0;
        self.state.DSP_SCOPE_SLOT_COUNT = 0;
        if let Some(p) = plan.as_ref() {
            for request in &p.requests {
                match *request {
                    Observation::Meter { register } => {
                        let slot = self.state.DSP_METER_SLOT_COUNT;
                        self.state.DSP_METER_REGS[slot] = register as i32;
                        self.state.DSP_METER_SLOT_COUNT += 1;
                    }
                    Observation::Scope {
                        register,
                        seconds,
                        points,
                        ..
                    } => {
                        let slot = self.state.DSP_SCOPE_SLOT_COUNT;
                        self.state.DSP_SCOPE_REGS[slot] = register as i32;
                        self.state.DSP_SCOPE_POINTS_ACTIVE[slot] = points as usize;
                        self.state.DSP_SCOPE_DECIMATE[slot] =
                            ((seconds * self.sample_rate / points as f64).round() as u32).max(1);
                        self.state.DSP_SCOPE_DECIMATE_COUNTERS[slot] = 0;
                        self.state.DSP_SCOPE_COUNTS[slot] = 0;
                        self.state.DSP_SCOPE_WRITE_INDICES[slot] = 0;
                        self.state.DSP_SCOPE_SLOT_COUNT += 1;
                    }
                    _ => {}
                }
            }
        }
        self.state.DSP_METER_SUMS.fill(0.0);
        self.state.DSP_METER_SIGNED_SUMS.fill(0.0);
        self.state.DSP_METER_COUNTS.fill(0);
        core::mem::swap(&mut self.observation, plan);
        Ok(())
    }
    /// RT-safe, no allocation. At most 128 requests / 1024 points each; Buffer
    /// bins sample one point each (bounded preview, not full-buffer extrema).
    /// Call once per publication interval; meters reset after collection.
    pub fn collect_observation(&mut self, output: &mut [ObservationValue]) -> ObservationReport {
        let mut written = 0;
        let mut dropped = 0;
        let mut meter = 0;
        let mut scope = 0;
        let identity = self.identity();
        let requests = self.observation.as_ref().map_or(&[][..], |p| &p.requests);
        let state = &mut self.state;
        native_state::enter(state, || {
            for (request, kind) in requests.iter().enumerate() {
                let mut emit = |index, value, auxiliary| {
                    if written < output.len() {
                        output[written] = ObservationValue {
                            request,
                            index,
                            value,
                            auxiliary,
                        };
                        written += 1;
                    } else {
                        dropped += 1;
                    }
                };
                match *kind {
                    Observation::Meter { .. } => {
                        emit(0, dspMeterLevel(meter), dspMeterSignedLevel(meter));
                        meter += 1;
                    }
                    Observation::Scope { points, reset, .. } => unsafe {
                        let count = dspScopeCount(scope).min(points) as usize;
                        let start = (dspScopeWriteIndex(scope) as usize + points as usize - count)
                            % points as usize;
                        let samples =
                            std::slice::from_raw_parts(dspScopePtr(scope), points as usize);
                        let mut skip = 0;
                        if matches!(reset, ScopeReset::ZeroCrossing) {
                            for i in 1..count {
                                if samples[(start + i - 1) % points as usize] <= 0.0
                                    && samples[(start + i) % points as usize] > 0.0
                                {
                                    skip = i;
                                    break;
                                }
                            }
                        }
                        for i in skip..count {
                            emit(i - skip, samples[(start + i) % points as usize] as f64, 0.0);
                        }
                        scope += 1;
                    },
                    Observation::SamplePlayheads { binding, limit } => {
                        let count = dspSamplePlayheadCount(binding);
                        for index in 0..count.min(limit) {
                            emit(index as usize, dspSamplePlayheadValue(binding, index), 0.0);
                        }
                        drop(emit);
                        if count > limit {
                            dropped += (count - limit) as usize;
                        }
                    }
                    Observation::SamplePlayhead { binding, voice } => {
                        emit(0, dspSamplePlayheadVoice(binding, voice), 0.0);
                    }
                    Observation::RepeatBuffer { address, points } => unsafe {
                        let slot =
                            kernel_global!(DSP_BUFFER_STATE_SLOTS)[address.state as usize] as usize;
                        if let Some(sequence) = kernel_global!(DSP_BOUNDED_PROGRAM).as_mut() {
                            sequence.buffer_at(&address, 0, slot, |buffer, states, offset| {
                                let length = (states[offset + 3] * self.sample_rate)
                                    .round()
                                    .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64)
                                    as usize;
                                emit(0, states[offset + 1], states[offset + 2]);
                                let samples = buffer.buffer.as_ref().unwrap();
                                for i in 0..points as usize {
                                    let value = samples[i * (length - 1)
                                        / (points as usize).max(2).saturating_sub(1)]
                                        as f64;
                                    emit(i + 1, value, value);
                                }
                            });
                        }
                    },
                    Observation::Buffer { state, points } => unsafe {
                        let slot = dspBufferSlotForState(state);
                        if slot >= 0 {
                            let length = (getDspState(state + 3) * self.sample_rate)
                                .round()
                                .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64)
                                as usize;
                            let ptr = kernel_global!(DSP_BUFFER_BUFFERS)[slot as usize]
                                .as_ref()
                                .unwrap();
                            emit(0, getDspState(state + 1), getDspState(state + 2));
                            for i in 0..points as usize {
                                let v = ptr
                                    [i * (length - 1) / (points as usize).max(2).saturating_sub(1)]
                                    as f64;
                                emit(i + 1, v, v);
                            }
                        }
                    },
                }
            }
            resetDspMeterLevels();
        });
        ObservationReport {
            identity,
            written,
            dropped,
        }
    }
    /// RT-safe O(1) for a root Buffer. Group-expanded states are root.
    /// Use begin_buffer_capture_at for a concrete nested/repeated item.
    pub fn begin_buffer_capture(
        &mut self,
        identity: Identity,
        state: u32,
    ) -> Result<BufferCapture, Error> {
        self.begin_buffer_capture_at(identity, BufferAddress::root(state))
    }
    pub fn begin_buffer_capture_at(
        &mut self,
        identity: Identity,
        address: BufferAddress,
    ) -> Result<BufferCapture, Error> {
        if identity != self.identity() {
            return Err(Error::StaleGeneration);
        }
        if address.depth > 4 {
            return Err(Error::InvalidValues);
        }
        let state = address.state;
        if state as usize >= MAX_DSP_STATE {
            return Err(Error::InvalidValues);
        }
        if address.depth > 0 {
            self.capture_serial = self.capture_serial.checked_add(1).ok_or(Error::Capacity)?;
            let serial = self.capture_serial;
            let rate = self.sample_rate;
            let slot = self.state.DSP_BUFFER_STATE_SLOTS[state as usize] as usize;
            let count = self
                .state
                .DSP_BOUNDED_PROGRAM
                .as_mut()
                .and_then(|p| {
                    p.buffer_at(&address, 0, slot, |buffer, states, offset| {
                        if buffer.capture != 0 {
                            return None;
                        }
                        buffer.capture = serial;
                        buffer.frozen = true;
                        Some(
                            (states[offset + 3] * rate)
                                .round()
                                .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64)
                                as usize,
                        )
                    })
                })
                .flatten()
                .ok_or(Error::Capacity)?;
            return Ok(BufferCapture {
                identity,
                owner: self.owner,
                epoch: self.capture_epoch,
                serial,
                slot,
                repeated: true,
                sample_rate: rate,
                sample_count: count,
                position: 0,
            });
        }
        if !self.root_buffer_states.contains(&state) {
            return Err(Error::InvalidValues);
        }
        let slot = self.state.DSP_BUFFER_STATE_SLOTS[state as usize] as usize;
        if slot >= MAX_DSP_BUFFER_SLOTS || self.captures[slot] != 0 {
            return Err(Error::Capacity);
        }
        self.capture_serial = self.capture_serial.checked_add(1).ok_or(Error::Capacity)?;
        self.captures[slot] = self.capture_serial;
        self.state.DSP_BUFFER_FROZEN[slot] = true;
        let count = (self.state.DSP_STATE[state as usize + 3] * self.sample_rate)
            .round()
            .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64) as usize;
        Ok(BufferCapture {
            identity,
            owner: self.owner,
            epoch: self.capture_epoch,
            serial: self.capture_serial,
            slot,
            repeated: false,
            sample_rate: self.sample_rate,
            sample_count: count,
            position: 0,
        })
    }
    fn valid_capture(&self, capture: &BufferCapture) -> bool {
        capture.owner == self.owner
            && capture.identity == self.identity()
            && capture.epoch == self.capture_epoch
            && (capture.repeated || self.captures[capture.slot] == capture.serial)
    }
    /// Copies at most 1024 floats on the render owner. Repeated capture lookup
    /// visits at most the prepared 1024 item tree. Empty/oversize destinations
    /// fail without progress. Recording resumes only after finish/cancel.
    pub fn read_buffer_capture(
        &mut self,
        capture: &mut BufferCapture,
        output: &mut [f32],
    ) -> Result<usize, Error> {
        if !self.valid_capture(capture) {
            return Err(Error::StaleGeneration);
        }
        if output.is_empty() || output.len() > MAX_TRANSFER_SAMPLES {
            return Err(Error::Capacity);
        }
        let count = output.len().min(capture.sample_count - capture.position);
        if capture.repeated {
            self.state
                .DSP_BOUNDED_PROGRAM
                .as_mut()
                .and_then(|p| {
                    p.capture(capture.serial, &mut |buffer| {
                        let source = buffer.buffer.as_ref().unwrap();
                        output[..count]
                            .copy_from_slice(&source[capture.position..capture.position + count]);
                    })
                })
                .ok_or(Error::StaleGeneration)?;
        } else {
            let source = self.state.DSP_BUFFER_BUFFERS[capture.slot]
                .as_ref()
                .unwrap();
            output[..count].copy_from_slice(&source[capture.position..capture.position + count]);
        }
        capture.position += count;
        Ok(count)
    }
    /// Both completion and cancellation use this O(1) call. Dropping a cursor
    /// alone does not resume recording; hosts must enqueue cancellation.
    pub fn end_buffer_capture(&mut self, capture: &BufferCapture) -> Result<(), Error> {
        if !self.valid_capture(capture) {
            return Err(Error::StaleGeneration);
        }
        if capture.repeated {
            self.state
                .DSP_BOUNDED_PROGRAM
                .as_mut()
                .and_then(|p| {
                    p.capture(capture.serial, &mut |buffer| {
                        buffer.frozen = false;
                        buffer.capture = 0;
                    })
                })
                .ok_or(Error::StaleGeneration)?;
        } else {
            self.captures[capture.slot] = 0;
            self.state.DSP_BUFFER_FROZEN[capture.slot] = false;
        }
        Ok(())
    }
    /// RT-safe O(1) storage swap; rate must match Instance. Capture data may be
    /// resampled with Resources::buffers during off-render replacement instead.
    pub fn replace_buffer(&mut self, replacement: &mut BufferReplacement) -> Result<(), Error> {
        if replacement.identity != self.identity() {
            return Err(Error::StaleGeneration);
        }
        let state = replacement.address.state;
        let slot = self.state.DSP_BUFFER_STATE_SLOTS[state as usize] as usize;
        if replacement.address.depth > 0 {
            let rate = self.sample_rate;
            self.state
                .DSP_BOUNDED_PROGRAM
                .as_mut()
                .and_then(|p| {
                    p.buffer_at(&replacement.address, 0, slot, |buffer, states, offset| {
                        core::mem::swap(buffer.buffer.as_mut().unwrap(), &mut replacement.samples);
                        buffer.capture = 0;
                        buffer.frozen = false;
                        let old_count = (states[offset + 3] * rate)
                            .round()
                            .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64)
                            as usize;
                        states[offset + 3] = replacement.count as f64 / rate;
                        replacement.count = old_count;
                    })
                })
                .ok_or(Error::StaleGeneration)?;
            return Ok(());
        }
        if slot >= MAX_DSP_BUFFER_SLOTS {
            return Err(Error::InvalidValues);
        }
        core::mem::swap(
            self.state.DSP_BUFFER_BUFFERS[slot].as_mut().unwrap(),
            &mut replacement.samples,
        );
        self.captures[slot] = 0;
        self.state.DSP_BUFFER_FROZEN[slot] = false;
        let old_count = (self.state.DSP_STATE[state as usize + 3] * self.sample_rate)
            .round()
            .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64) as usize;
        self.state.DSP_STATE[state as usize + 3] = replacement.count as f64 / self.sample_rate;
        replacement.count = old_count;
        Ok(())
    }
}
