//! Prepared hierarchical repeat pools. Each parent item owns its child pools;
//! there is no context aliasing, lazy allocation, or render-time Vec resizing.
use super::*;
pub(super) const MAX_REPEAT_DEPTH: usize = 4;
pub(super) const MAX_TOTAL_REPEAT_ITEMS: usize = 1024;
pub(super) struct BoundedSequence {
    instructions: Vec<Instruction>,
}
enum Instruction {
    Op(DspOp),
    Repeat(Repeat),
}
struct Repeat {
    op: DspOp,
    items: Vec<Item>,
    active: usize,
    previous: bool,
    previous_release: bool,
    collectors: Vec<DspOp>,
}
struct Item {
    states: Vec<f64>,
    resources: DspRepeatResourceState,
    body: BoundedSequence,
    tag: f64,
    gate: bool,
    killed: bool,
}
struct Budget {
    bytes: usize,
    items: usize,
    limit: usize,
    capacity: usize,
}
impl BoundedSequence {
    pub(super) unsafe fn prepare(capacity: usize, limit: usize) -> Option<Self> {
        let mut budget = Budget {
            bytes: 0,
            items: 0,
            limit,
            capacity,
        };
        let sequence = Self::range(0, kernel_global!(DSP_OP_COUNT), 0, &mut budget)?;
        if sequence.allocated_bytes() > limit {
            return None;
        }
        Some(sequence)
    }
    pub(super) fn allocated_bytes(&self) -> usize {
        self.instructions.capacity() * std::mem::size_of::<Instruction>()
            + self
                .instructions
                .iter()
                .map(|instruction| match instruction {
                    Instruction::Op(_) => 0,
                    Instruction::Repeat(repeat) => {
                        repeat.items.capacity() * std::mem::size_of::<Item>()
                            + repeat.collectors.capacity() * std::mem::size_of::<DspOp>()
                            + repeat
                                .items
                                .iter()
                                .map(|item| {
                                    item.states.capacity() * 8
                                        + item.body.allocated_bytes()
                                        + item.resources.allocated_buffer_bytes()
                                        + item.resources.samples.capacity()
                                            * std::mem::size_of::<DspSamplePlaybackState>()
                                        + item.resources.effect_buffers.capacity()
                                            * std::mem::size_of::<DspRepeatEffectBufferState>()
                                        + item.resources.buffers.capacity()
                                            * std::mem::size_of::<DspRepeatBufferState>()
                                })
                                .sum::<usize>()
                    }
                })
                .sum::<usize>()
    }
    unsafe fn range(start: usize, end: usize, depth: usize, budget: &mut Budget) -> Option<Self> {
        let mut instructions = Vec::new();
        let mut index = start;
        while index < end {
            let op = kernel_global!(DSP_OPS)[index];
            if !matches!(op.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN) {
                budget.bytes = budget
                    .bytes
                    .checked_add(std::mem::size_of::<Instruction>())?;
                if budget.bytes > budget.limit {
                    return None;
                }
                instructions.push(Instruction::Op(op));
                index += 1;
                continue;
            }
            if depth >= MAX_REPEAT_DEPTH || op.b < 0 || op.b as usize >= end {
                return None;
            }
            let end_repeat = op.b as usize;
            let layout = dsp_template_resource_layout(index, end_repeat);
            let per_item = layout.state_count * 8
                + layout.sample_indices.len() * std::mem::size_of::<DspSamplePlaybackState>()
                + layout.effect_slots.len() * MAX_DSP_DELAY_SAMPLES * 4
                + layout.buffer_slots.len() * MAX_DSP_BUFFER_SAMPLES * 4
                + std::mem::size_of::<Item>()
                + 512;
            budget.items = budget.items.checked_add(budget.capacity)?;
            budget.bytes = budget
                .bytes
                .checked_add(per_item.checked_mul(budget.capacity)?)?;
            if budget.items > MAX_TOTAL_REPEAT_ITEMS || budget.bytes > budget.limit {
                return None;
            }
            let mut items = Vec::with_capacity(budget.capacity);
            for _ in 0..budget.capacity {
                let body = Self::range(index + 1, end_repeat, depth + 1, budget)?;
                let resources = DspRepeatResourceState::new(&layout);
                if !resources.is_prepared() {
                    return None;
                }
                items.push(Item {
                    states: vec![0.0; layout.state_count],
                    resources,
                    body,
                    tag: 0.0,
                    gate: false,
                    killed: false,
                });
            }
            // Only immediate collectors belong to this repeat.
            let mut collectors = Vec::new();
            let mut child = index + 1;
            while child < end_repeat {
                let inner = kernel_global!(DSP_OPS)[child];
                if matches!(inner.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN) {
                    child = inner.b as usize + 1;
                    continue;
                }
                if inner.opcode == DSP_OP_SPREAD_COLLECT {
                    collectors.push(inner);
                }
                child += 1;
            }
            instructions.push(Instruction::Repeat(Repeat {
                op,
                items,
                active: 0,
                previous: false,
                previous_release: false,
                collectors,
            }));
            index = end_repeat + 1;
        }
        Some(Self { instructions })
    }
    pub(super) fn reset(&mut self, preserve: &[bool; MAX_DSP_BUFFER_SLOTS]) {
        for instruction in &mut self.instructions {
            if let Instruction::Repeat(repeat) = instruction {
                repeat.active = 0;
                repeat.previous = false;
                repeat.previous_release = false;
                for item in &mut repeat.items {
                    item.reset(preserve);
                }
            }
        }
    }
    pub(super) unsafe fn render(
        &mut self,
        frame: usize,
        rate: f64,
        left: &mut f64,
        right: &mut f64,
        mut resources: Option<&mut DspRepeatResourceState>,
    ) {
        for instruction in &mut self.instructions {
            match instruction {
                Instruction::Op(op) => {
                    let op = *op;
                    render_dsp_op::<false>(
                        op,
                        frame,
                        rate,
                        left,
                        right,
                        None,
                        resources.as_deref_mut(),
                    );
                }
                Instruction::Repeat(repeat) => repeat.render(frame, rate, left, right),
            }
        }
    }
}
impl Item {
    fn reset(&mut self, preserve: &[bool; MAX_DSP_BUFFER_SLOTS]) {
        self.states.fill(0.0);
        self.resources.reset_for_transport(preserve);
        self.body.reset(preserve);
        self.gate = false;
        self.killed = false;
    }
}
impl Repeat {
    unsafe fn render(&mut self, frame: usize, rate: f64, left: &mut f64, right: &mut f64) {
        let spawn = self.op.opcode == DSP_OP_SPAWN_BEGIN;
        let input = dsp_reg(self.op.a);
        let trigger = input >= ENVELOPE_TRIGGER_THRESHOLD;
        let release = if self.op.d >= 0 {
            dsp_reg(self.op.d)
        } else {
            0.0
        };
        let release_active = release >= ENVELOPE_TRIGGER_THRESHOLD;
        if spawn {
            if release_active && !self.previous_release {
                for item in &mut self.items[..self.active] {
                    if (item.tag - release).abs() <= 0.000001 {
                        item.gate = false;
                    }
                }
            }
            if trigger && !self.previous {
                if self.active < self.items.len() {
                    let item = &mut self.items[self.active];
                    item.reset(&[false; MAX_DSP_BUFFER_SLOTS]);
                    item.resources.random_state = next_dsp_random_seed();
                    item.tag = input;
                    item.gate = true;
                    self.active += 1;
                } else {
                    kernel_global!(DSP_REPEAT_EXHAUSTIONS) += 1;
                }
            }
        } else {
            let requested = input.floor().max(0.0) as usize;
            let count = requested.min(self.items.len());
            if requested > count {
                kernel_global!(DSP_REPEAT_EXHAUSTIONS) += 1;
            }
            for item in &mut self.items[self.active.min(count)..count] {
                item.reset(&[false; MAX_DSP_BUFFER_SLOTS]);
                item.resources.random_state = next_dsp_random_seed();
            }
            self.active = count;
        }
        self.previous = trigger;
        self.previous_release = release_active;
        set_dsp_reg(self.op.out, self.active as f64);
        for collector in &self.collectors {
            set_dsp_reg(collector.out, if collector.b == 1 { 1.0 } else { 0.0 });
        }
        let saved = (
            kernel_global!(DSP_REPEAT_STATE_PTR),
            kernel_global!(DSP_REPEAT_STATE_START),
            kernel_global!(DSP_REPEAT_STATE_COUNT),
            kernel_global!(DSP_SPREAD_ITEM_INDEX),
            kernel_global!(DSP_SPAWN_INSTANCE_GATE),
        );
        let mut index = 0;
        while index < self.active {
            let item = &mut self.items[index];
            item.resources.load_into_workspace();
            set_dsp_repeat_state(self.op.state.max(0) as usize, &mut item.states);
            kernel_global!(DSP_SPREAD_ITEM_INDEX) = index;
            kernel_global!(DSP_SPAWN_INSTANCE_GATE) = if item.gate { 1.0 } else { 0.0 };
            if spawn && self.op.c >= 0 {
                set_dsp_reg(self.op.c, 0.0);
            }
            item.body
                .render(frame, rate, left, right, Some(&mut item.resources));
            let kill = spawn && self.op.c >= 0 && dsp_reg(self.op.c) >= ENVELOPE_TRIGGER_THRESHOLD;
            let remove = kill && !item.killed;
            item.killed = kill;
            item.resources.save_from_workspace();
            if remove {
                item.reset(&[false; MAX_DSP_BUFFER_SLOTS]);
                self.active -= 1;
                self.items[index..=self.active].rotate_left(1);
            } else {
                index += 1;
            }
        }
        kernel_global!(DSP_REPEAT_STATE_PTR) = saved.0;
        kernel_global!(DSP_REPEAT_STATE_START) = saved.1;
        kernel_global!(DSP_REPEAT_STATE_COUNT) = saved.2;
        kernel_global!(DSP_SPREAD_ITEM_INDEX) = saved.3;
        kernel_global!(DSP_SPAWN_INSTANCE_GATE) = saved.4;
    }
}

#[cfg(all(not(target_arch = "wasm32"), not(feature = "parallel")))]
impl BoundedSequence {
    pub(super) fn buffer_at<T>(
        &mut self,
        address: &hosted::BufferAddress,
        depth: usize,
        slot: usize,
        f: impl FnOnce(&mut DspRepeatBufferState, &mut [f64], usize) -> T,
    ) -> Option<T> {
        let part = address.path.get(depth)?;
        for instruction in &mut self.instructions {
            if let Instruction::Repeat(repeat) = instruction {
                if repeat.op.value as u32 != part.template {
                    continue;
                }
                if part.item >= repeat.active {
                    return None;
                }
                let item = &mut repeat.items[part.item];
                if depth + 1 < address.depth {
                    return item.body.buffer_at(address, depth + 1, slot, f);
                }
                if !item.body.instructions.iter().any(|i| matches!(i,Instruction::Op(op) if op.opcode == DSP_OP_BUFFER && op.state as u32 == address.state)) { return None; }
                let offset = address.state.checked_sub(repeat.op.state as u32)? as usize;
                if offset + 6 >= item.states.len() {
                    return None;
                }
                let buffer = item.resources.buffers.iter_mut().find(|b| b.slot == slot)?;
                return Some(f(buffer, &mut item.states, offset));
            }
        }
        None
    }
    pub(super) fn capture<T>(
        &mut self,
        serial: u64,
        f: &mut impl FnMut(&mut DspRepeatBufferState) -> T,
    ) -> Option<T> {
        for instruction in &mut self.instructions {
            if let Instruction::Repeat(repeat) = instruction {
                for item in &mut repeat.items[..repeat.active] {
                    for buffer in &mut item.resources.buffers {
                        if buffer.capture == serial {
                            return Some(f(buffer));
                        }
                    }
                    if let Some(result) = item.body.capture(serial, f) {
                        return Some(result);
                    }
                }
            }
        }
        None
    }
}

impl BoundedSequence {
    pub(super) fn has_sample(&self, slot: usize) -> bool {
        self.instructions
            .iter()
            .any(|instruction| match instruction {
                Instruction::Repeat(repeat) => repeat.items.first().is_some_and(|item| {
                    item.resources
                        .samples
                        .iter()
                        .any(|s| s.sample_index == slot)
                        || item.body.has_sample(slot)
                }),
                _ => false,
            })
    }
    pub(super) fn visit_samples(&self, slot: usize, visitor: &mut impl FnMut(f64, f64)) {
        for instruction in &self.instructions {
            if let Instruction::Repeat(repeat) = instruction {
                for item in &repeat.items[..repeat.active] {
                    for state in &item.resources.samples {
                        for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                            let value = dsp_sample_playhead_from_state(slot, state, voice);
                            if value >= 0.0 {
                                visitor(value, state.playback_ages[voice]);
                            }
                        }
                    }
                    item.body.visit_samples(slot, visitor);
                }
            }
        }
    }
}
