//! Parallel rendering for independent Spread items and Spawn instances.
//! Workers render instance-owned state; the audio thread merges outputs in order.
use super::*;
#[cfg(not(target_arch = "wasm32"))]
use std::cell::Cell;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, Ordering};

const MAX_WORKERS: usize = 4;
const STACK_BYTES: usize = 1024 * 1024;
const TLS_BYTES: usize = 64 * 1024;
const STALL_TIMEOUT_MS: f64 = 100.0;

#[link(wasm_import_module = "parallel")]
extern "C" {
    fn now() -> f64;
    fn wake();
}

#[repr(C, align(64))]
struct Control {
    wake: AtomicU32,
    request: AtomicU32,
    done: AtomicU32,
}
static CONTROLS: [Control; MAX_WORKERS] = [const {
    Control {
        wake: AtomicU32::new(0),
        request: AtomicU32::new(0),
        done: AtomicU32::new(0),
    }
}; MAX_WORKERS];
static ACTIVE: AtomicU32 = AtomicU32::new(0);
static FAULT: AtomicU32 = AtomicU32::new(0);

#[repr(align(16))]
struct Stacks([u8; MAX_WORKERS * STACK_BYTES]);
static mut STACKS: Stacks = Stacks([0; MAX_WORKERS * STACK_BYTES]);
// Slot 0 bootstraps the memory on the UI thread; slot 1 belongs to the worklet;
// helpers use slots 2..6. JS checks the linker's TLS size/alignment exports.
#[repr(align(65536))]
struct ThreadLocals([u8; (MAX_WORKERS + 2) * TLS_BYTES]);
static mut THREAD_LOCALS: ThreadLocals = ThreadLocals([0; (MAX_WORKERS + 2) * TLS_BYTES]);
static mut WORKERS: usize = 0;
static mut EPOCH: u32 = 0;
static mut DEADLINE: f64 = 0.0;
static mut PLAN: Option<Plan> = None;
static mut REPEAT_START: usize = 0;
static mut REPEAT_COUNT: usize = 0;
static mut REPEAT_STATES_PTR: *mut f64 = core::ptr::null_mut();
static mut REPEAT_SPAWN_PTR: *mut DspSpawnInstance = core::ptr::null_mut();
static mut REPEAT_RESOURCES_PTR: *mut DspRepeatResourceState = core::ptr::null_mut();
static mut REPEAT_STATE_COUNT: usize = 0;
static mut REPEAT_SAMPLE_RATE: f64 = 48_000.0;
static mut REPEAT_FRAME: usize = 0;
const MAX_PARALLEL_REPEAT_ITEMS: usize = 512;
const MIN_SIMPLE_REPEAT_ITEMS: usize = 96;
// A lane owns one register bank. Workers only write their own bank and their
// own range of results; the coordinator alone merges results in item order.
static mut REPEAT_REGS: [[f64; MAX_DSP_REGS]; MAX_WORKERS + 1] =
    [[0.0; MAX_DSP_REGS]; MAX_WORKERS + 1];
static mut REPEAT_KILL_RESULTS: [f64; MAX_PARALLEL_REPEAT_ITEMS] = [0.0; MAX_PARALLEL_REPEAT_ITEMS];
static mut REPEAT_MORPH_CONSUMED: [[u32; MAX_NODES]; MAX_WORKERS + 1] =
    [[0; MAX_NODES]; MAX_WORKERS + 1];
static mut REPEAT_INVALID_STATE: [f64; MAX_WORKERS + 1] = [0.0; MAX_WORKERS + 1];

// Each worker installs its own view of the instance being rendered. The
// ordinary DSP evaluator uses this view through its register/state accessors,
// so serial and parallel execution run the same node implementation.
pub(super) struct RepeatContext {
    pub regs: *mut f64,
    pub states: *mut f64,
    pub state_start: usize,
    pub state_count: usize,
    pub resources: *mut DspRepeatResourceState,
    pub lane: usize,
}

#[cfg(target_arch = "wasm32")]
#[thread_local]
static mut ACTIVE_REPEAT_CONTEXT: *mut RepeatContext = core::ptr::null_mut();

#[cfg(not(target_arch = "wasm32"))]
std::thread_local! {
    static ACTIVE_REPEAT_CONTEXT: Cell<*mut RepeatContext> = const { Cell::new(core::ptr::null_mut()) };
}

#[inline(always)]
pub(super) fn active_repeat_context() -> *mut RepeatContext {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { ACTIVE_REPEAT_CONTEXT }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        ACTIVE_REPEAT_CONTEXT.with(Cell::get)
    }
}

#[inline(always)]
unsafe fn set_active_repeat_context(context: *mut RepeatContext) {
    #[cfg(target_arch = "wasm32")]
    {
        ACTIVE_REPEAT_CONTEXT = context;
    }
    #[cfg(not(target_arch = "wasm32"))]
    ACTIVE_REPEAT_CONTEXT.with(|active| active.set(context));
}

pub(super) unsafe fn record_custom_wave_frame(node: usize, consumed: u32) {
    let context = active_repeat_context();
    let slot = core::ptr::addr_of_mut!(REPEAT_MORPH_CONSUMED)
        .cast::<u32>()
        .add((*context).lane * MAX_NODES + node);
    *slot = (*slot).max(consumed);
}

pub(super) unsafe fn invalid_state_ptr() -> *mut f64 {
    let context = active_repeat_context();
    core::ptr::addr_of_mut!(REPEAT_INVALID_STATE)
        .cast::<f64>()
        .add((*context).lane)
}

struct Plan {
    repeats: Vec<Option<RepeatPlan>>,
}

struct RepeatPlan {
    end: usize,
    collectors: Vec<(usize, DspOp)>,
    collector_positions: Vec<usize>,
    results: UnsafeCell<Box<[f64]>>,
    inputs: Vec<usize>,
    writes: Vec<usize>,
    state_start: usize,
    state_count: usize,
    min_count: usize,
    custom_wave_nodes: Vec<usize>,
    explicit_context_only: bool,
}

fn uses_explicit_context(op: DspOp) -> bool {
    match op.opcode {
        DSP_OP_VALUE
        | DSP_OP_ADD
        | DSP_OP_MUL
        | DSP_OP_SUB
        | DSP_OP_DIV
        | DSP_OP_NEG
        | DSP_OP_BEND
        | DSP_OP_ABS
        | DSP_OP_MAP
        | DSP_OP_FOLD
        | DSP_OP_HARD_CLIP
        | DSP_OP_SOFT_CLIP
        | DSP_OP_ENVELOPE
        | DSP_OP_BLOCK_LATCH
        | DSP_OP_SPREAD_INDEX
        | DSP_OP_SPAWN_INSTANCE_GATE
        | DSP_OP_SPREAD_COLLECT
        | DSP_OP_FEEDBACK_READ
        | DSP_OP_FEEDBACK_WRITE => true,
        DSP_OP_OSC => (0..=4).contains(&op.a) && op.d < 0 && op.e < 0,
        _ => false,
    }
}

// The runner plans dependencies, not node algorithms. Every admitted opcode
// runs through render_dsp_op, the same evaluator used by serial rendering.
// Side-effecting operations are excluded until their shared effects can be
// committed deterministically after the workers finish.
fn repeat_access(op: DspOp) -> Option<(Vec<i32>, usize)> {
    match op.opcode {
        DSP_OP_RANDOM => Some((vec![op.a, op.b, op.c], 4)),
        DSP_OP_OSC if op.a == 6 => {
            Some((vec![op.value2.round() as i32, op.value3.round() as i32], 1))
        }
        DSP_OP_OSC if op.a == 7 => Some((
            vec![op.b, op.value2.round() as i32, op.value3.round() as i32],
            3,
        )),
        DSP_OP_OSC if op.a == 5 => Some((vec![op.c, op.d], 3)),
        DSP_OP_DISTORTION if op.c < 0 && op.value.round() as i32 == 3 => {
            Some((vec![op.a, op.b], 1))
        }
        DSP_OP_SAMPLE if op.value2 < 0.5 => Some((vec![op.b, op.c, op.d, op.e], 1)),
        DSP_OP_SAMPLE_PARAM => Some((vec![op.c], 0)),
        DSP_OP_SPREAD_INDEX | DSP_OP_SPAWN_INSTANCE_GATE => Some((vec![], 0)),
        DSP_OP_END_TRIGGER => Some((vec![], if op.value >= 0.5 { 5 } else { 1 })),
        DSP_OP_ACCUMULATOR => Some((vec![op.a, op.b, op.c, op.d, op.e], 3)),
        DSP_OP_PLAYHEAD => Some((vec![op.a, op.b, op.c, op.e], 2)),
        DSP_OP_TIME => Some((vec![], 1)),
        DSP_OP_SEQUENCER => Some((vec![op.a, op.b, op.c, op.d, op.e], 8)),
        DSP_OP_ROLL_NOTE_EVENT => Some((
            vec![],
            5 + SEQUENCER_MAX_ROWS as usize * if op.value2 >= 0.5 { 3 } else { 2 },
        )),
        DSP_OP_MIDI_NOTE => Some((vec![op.b], 0)),
        DSP_OP_MIDI_CC => Some((vec![op.a, op.b], 0)),
        DSP_OP_DISTORTION if op.c < 0 && op.value.round() as i32 != 3 => {
            Some((vec![op.a, op.b], 0))
        }
        DSP_OP_IMAGE => Some((vec![op.a, op.b], 0)),
        DSP_OP_BUFFER => Some((
            vec![
                op.a,
                op.b,
                op.c,
                op.d,
                op.value2.round() as i32,
                op.value3.round() as i32,
            ],
            7,
        )),
        DSP_OP_OSC if op.a == 5 && op.c >= 0 => {
            let mut reads = vec![op.c, op.d];
            if op.value4 >= 0.5 {
                reads.extend([op.value2.round() as i32, op.value3.round() as i32]);
            }
            Some((reads, 3))
        }
        DSP_OP_OSC if op.a == 9 => {
            let mut reads = vec![op.b, op.c, op.d, op.e];
            if op.value4 >= 0.5 {
                reads.extend([op.value2.round() as i32, op.value3.round() as i32]);
            }
            reads.retain(|&reg| reg >= 0 && (reg as usize) < MAX_DSP_REGS);
            Some((reads, 6))
        }
        _ => access(op),
    }
    .map(|(mut reads, span)| {
        reads.retain(|&reg| reg >= 0 && (reg as usize) < MAX_DSP_REGS);
        (reads, span)
    })
}

fn repeat_plan(ops: &[DspOp], start: usize, end: usize) -> Option<RepeatPlan> {
    let spawn = ops[start].opcode == DSP_OP_SPAWN_BEGIN;
    if (!spawn && ops[start].opcode != DSP_OP_SPREAD_BEGIN) || end <= start + 1 {
        return None;
    }
    let collector_indices: Vec<usize> = (start + 1..end)
        .filter(|&index| ops[index].opcode == DSP_OP_SPREAD_COLLECT)
        .collect();
    if collector_indices.is_empty() {
        return None;
    }
    let state_start = ops[start].state.max(0) as usize;
    let state_count = ops[start].value2.round().max(0.0) as usize;
    if state_start.saturating_add(state_count) > MAX_DSP_STATE {
        return None;
    }
    let collectors: Vec<(usize, DspOp)> = collector_indices
        .iter()
        .map(|&index| (index, ops[index]))
        .collect();
    let mut collector_outputs = Vec::new();
    for (_, item) in &collectors {
        if item.a < 0
            || item.a as usize >= MAX_DSP_REGS
            || item.out < 0
            || item.out as usize >= MAX_DSP_REGS
            || item.a == item.out
            || !matches!(item.b, 0 | 1)
            || collector_outputs.contains(&(item.out as usize))
        {
            return None;
        }
        collector_outputs.push(item.out as usize);
    }
    let mut writes = Vec::new();
    let mut has_oscillator = false;
    let mut has_heavy_op = false;
    let mut custom_wave_nodes = Vec::new();
    for op in (start + 1..end)
        .filter(|index| !collector_indices.contains(index))
        .map(|index| ops[index])
    {
        let (_, state_span) = repeat_access(op)?;
        if op.opcode == DSP_OP_SPREAD_INDEX && spawn
            || op.opcode == DSP_OP_SPAWN_INSTANCE_GATE && !spawn
        {
            return None;
        }
        if state_span > 0 {
            has_oscillator |= op.opcode == DSP_OP_OSC;
            has_heavy_op |= op.opcode != DSP_OP_OSC;
            if op.state < state_start as i32
                || (op.state as usize).saturating_add(state_span) > state_start + state_count
            {
                return None;
            }
        }
        if op.opcode == DSP_OP_END_TRIGGER
            && (op.a < state_start as i32
                || (op.a as usize).saturating_add(if op.value >= 0.5 { 6 } else { 3 })
                    > state_start + state_count)
        {
            return None;
        }
        if op.opcode == DSP_OP_ROLL_NOTE_EVENT
            && (op.a < state_start as i32
                || (op.a as usize).saturating_add(8) > state_start + state_count)
        {
            return None;
        }
        if op.opcode == DSP_OP_OSC && op.a == 9 {
            let node = op.value.round() as usize;
            if node >= MAX_NODES {
                return None;
            }
            if !custom_wave_nodes.contains(&node) {
                custom_wave_nodes.push(node);
            }
        }
        if op.out >= 0 {
            if op.out as usize >= MAX_DSP_REGS {
                return None;
            }
            writes.push(op.out as usize);
        }
        if op.opcode == DSP_OP_BUFFER || (op.opcode == DSP_OP_REVERB && op.value2 >= 1.0) {
            if op.e < 0 || op.e as usize >= MAX_DSP_REGS {
                return None;
            }
            writes.push(op.e as usize);
        }
    }
    if collector_outputs.iter().any(|out| writes.contains(out)) {
        return None;
    }
    let mut seen_writes = Vec::new();
    let mut inputs = Vec::new();
    for index in start + 1..end {
        if collector_indices.contains(&index) {
            let reg = ops[index].a as usize;
            if !seen_writes.contains(&reg) {
                if writes.contains(&reg) {
                    return None;
                }
                if !inputs.contains(&reg) {
                    inputs.push(reg);
                }
            }
            continue;
        }
        let op = ops[index];
        let (reads, _) = repeat_access(op)?;
        for reg in reads {
            let reg = reg as usize;
            if !seen_writes.contains(&reg) {
                if writes.contains(&reg) {
                    return None;
                }
                if !inputs.contains(&reg) {
                    inputs.push(reg);
                }
            }
        }
        if op.out >= 0 && !seen_writes.contains(&(op.out as usize)) {
            seen_writes.push(op.out as usize);
        }
        if (op.opcode == DSP_OP_BUFFER || (op.opcode == DSP_OP_REVERB && op.value2 >= 1.0))
            && !seen_writes.contains(&(op.e as usize))
        {
            seen_writes.push(op.e as usize);
        }
    }
    if collector_outputs.iter().any(|out| inputs.contains(out)) {
        return None;
    }
    if spawn && ops[start].c >= 0 && !writes.contains(&(ops[start].c as usize)) {
        return None;
    }
    writes.sort_unstable();
    writes.dedup();
    let min_count = if has_heavy_op {
        8
    } else if has_oscillator {
        16
    } else {
        MIN_SIMPLE_REPEAT_ITEMS
    };
    let mut collector_positions = vec![usize::MAX; end - start];
    for (position, &index) in collector_indices.iter().enumerate() {
        collector_positions[index - start] = position;
    }
    Some(RepeatPlan {
        end,
        collectors,
        collector_positions,
        results: UnsafeCell::new(
            vec![0.0; MAX_PARALLEL_REPEAT_ITEMS * collector_indices.len()].into_boxed_slice(),
        ),
        inputs,
        writes,
        state_start,
        state_count,
        min_count,
        custom_wave_nodes,
        explicit_context_only: ops[start + 1..end]
            .iter()
            .copied()
            .all(uses_explicit_context),
    })
}

/// Complete register/state access description for every allowed opcode. New
/// opcodes default to serial until their hidden state and side effects have
/// been audited. State-indexed caches and effect buffers have the same owner
/// as the scalar state range. Program upload allocates their buffers up front.
fn access(op: DspOp) -> Option<(Vec<i32>, usize)> {
    let (mut reads, states) = match op.opcode {
        DSP_OP_VALUE | DSP_OP_BUTTON => (vec![], if op.opcode == DSP_OP_BUTTON { 3 } else { 0 }),
        DSP_OP_ADD | DSP_OP_MUL | DSP_OP_SUB | DSP_OP_DIV | DSP_OP_FOLD | DSP_OP_HARD_CLIP
        | DSP_OP_SOFT_CLIP => (vec![op.a, op.b], 0),
        DSP_OP_ABS | DSP_OP_NEG | DSP_OP_BEND | DSP_OP_INPUT => (vec![op.a], 0),
        DSP_OP_MAP => (vec![op.a, op.b, op.c, op.d, op.e], 0),
        DSP_OP_FUNCTION => (vec![op.b, op.c, op.d], 0),
        DSP_OP_QUANTISE => (vec![op.a, op.b, op.c], 0),
        DSP_OP_OSC if (0..=4).contains(&op.a) || op.a == 12 => {
            let mut inputs = vec![op.b, op.d, op.e];
            if op.a == 12 {
                inputs.extend([op.value as i32, op.c]);
            }
            if op.value4 >= 0.5 {
                inputs.extend([op.value2.round() as i32, op.value3.round() as i32]);
            }
            (inputs, if op.e >= 0 { 4 } else { 1 })
        }
        DSP_OP_FILTER => (
            vec![op.b, op.c, op.d, op.e],
            match op.a {
                4 | 7 => 12,
                5 | 6 => 1,
                _ => 4,
            },
        ),
        DSP_OP_FEEDBACK_READ => (vec![], 1),
        DSP_OP_FEEDBACK_WRITE => (vec![op.a], 1),
        DSP_OP_SELECT => (vec![op.a, op.b, op.c], 4),
        DSP_OP_REVERB if op.value2 >= 1.0 => (
            vec![op.a, op.b, op.c, op.d, op.value2.round() as i32 - 1],
            reverb::STATE_COUNT,
        ),
        DSP_OP_DELAY | DSP_OP_CHORUS | DSP_OP_REVERB => (vec![op.a, op.b, op.c, op.d], 1),
        DSP_OP_ENVELOPE | DSP_OP_COMPRESS => {
            let packed = op.value.round() as i32;
            let mut inputs = vec![
                op.a,
                op.b,
                op.c,
                op.d,
                op.e,
                packed.rem_euclid(MAX_DSP_REGS as i32),
                packed.div_euclid(MAX_DSP_REGS as i32),
            ];
            if op.opcode == DSP_OP_COMPRESS {
                inputs.push(op.value2.round() as i32);
            }
            if op.opcode == DSP_OP_ENVELOPE {
                inputs.push(op.value2.round() as i32 - 1);
            }
            (inputs, if op.opcode == DSP_OP_ENVELOPE { 7 } else { 1 })
        }
        DSP_OP_FOLLOWER => (vec![op.a, op.b, op.c], 1),
        DSP_OP_DC_BLOCK => (vec![op.a], 2),
        DSP_OP_LIMITER => (vec![op.a, op.b, op.c, op.d, op.e], 2),
        DSP_OP_SLEW => (
            vec![op.a, op.b],
            if op.value3 >= 0.5 {
                4
            } else if op.value2 >= 0.5 {
                2
            } else {
                1
            },
        ),
        DSP_OP_BLOCK_LATCH => (vec![op.a], 1),
        _ => return None,
    };
    reads.retain(|&reg| reg >= 0 && (reg as usize) < MAX_DSP_REGS);
    Some((reads, states))
}

fn build_plan(ops: &[DspOp]) -> Plan {
    let mut repeats = (0..ops.len()).map(|_| None).collect::<Vec<_>>();
    let mut start = 0;
    while start < ops.len() {
        if matches!(ops[start].opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN) {
            let end = ops[start].b.max(start as i32) as usize;
            if end < ops.len() {
                repeats[start] = repeat_plan(ops, start, end);
            }
            start = (end + 1).min(ops.len());
        } else {
            start += 1;
        }
    }
    Plan { repeats }
}

pub(super) fn clear_plan() {
    unsafe {
        PLAN = None;
    }
}

// The coordinator replaces this only between render calls. A helper's last
// plan reference ends before publishing `done`, which the coordinator acquires
// before returning. Helpers touch only atomics until the next request.
unsafe fn current_plan() -> Option<&'static Plan> {
    (*core::ptr::addr_of!(PLAN)).as_ref()
}

#[no_mangle]
pub extern "C" fn configureDspParallel(workers: u32) {
    unsafe {
        WORKERS = (workers as usize).min(MAX_WORKERS);
    }
}

#[no_mangle]
pub extern "C" fn compileDspParallelPlan() {
    unsafe {
        let ops = core::slice::from_raw_parts(
            core::ptr::addr_of!(kernel_global!(DSP_OPS)).cast::<DspOp>(),
            kernel_global!(DSP_OP_COUNT),
        );
        PLAN = Some(build_plan(ops));
    }
}

#[no_mangle]
pub extern "C" fn dspParallelRepeatCount() -> u32 {
    unsafe {
        current_plan().map_or(0, |plan| {
            plan.repeats.iter().filter(|item| item.is_some()).count() as u32
        })
    }
}
#[no_mangle]
pub extern "C" fn dspParallelControlPtr(worker: u32) -> *const i32 {
    if worker as usize >= MAX_WORKERS {
        return core::ptr::null();
    }
    &CONTROLS[worker as usize] as *const Control as *const i32
}
#[no_mangle]
pub extern "C" fn dspParallelStackTop(worker: u32) -> u32 {
    if worker as usize >= MAX_WORKERS {
        return 0;
    }
    unsafe {
        core::ptr::addr_of_mut!(STACKS.0)
            .cast::<u8>()
            .add((worker as usize + 1) * STACK_BYTES) as u32
    }
}
#[no_mangle]
pub extern "C" fn dspParallelTlsPtr(thread: u32) -> u32 {
    if thread as usize >= MAX_WORKERS + 2 {
        return 0;
    }
    unsafe {
        core::ptr::addr_of_mut!(THREAD_LOCALS.0)
            .cast::<u8>()
            .add(thread as usize * TLS_BYTES) as u32
    }
}
#[no_mangle]
pub extern "C" fn dspParallelFault() -> u32 {
    FAULT.load(Ordering::Acquire)
}
pub(super) fn failed() -> bool {
    dspParallelFault() != 0
}

pub(super) fn begin_quantum() -> bool {
    if failed() {
        return false;
    }
    unsafe {
        if !current_plan().is_some_and(|plan| plan.repeats.iter().any(Option::is_some)) {
            return true;
        }
        EPOCH = EPOCH.wrapping_add(1).max(1);
        DEADLINE = now() + STALL_TIMEOUT_MS;
        ACTIVE.store(0, Ordering::Release);
    }
    true
}
pub(super) fn end_quantum() {
    ACTIVE.store(0, Ordering::Release);
}

unsafe fn activate_workers() {
    if ACTIVE.load(Ordering::Relaxed) == EPOCH {
        return;
    }
    ACTIVE.store(EPOCH, Ordering::Release);
    for control in CONTROLS.iter().take(WORKERS) {
        control.wake.store(EPOCH, Ordering::Release);
    }
    wake();
}

#[inline]
fn local_sanitize(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-12_000.0, 12_000.0)
    } else {
        0.0
    }
}

unsafe fn render_repeat_lane(start: usize, count: usize, lane: usize) {
    let plan = current_plan().unwrap().repeats[start].as_ref().unwrap();
    let worker_count = WORKERS + 1;
    let partition = if lane == 0 { WORKERS } else { lane - 1 };
    let base = count / worker_count;
    let remainder = count % worker_count;
    let first = partition * base + partition.min(remainder);
    let last = first + base + usize::from(partition < remainder);
    let regs = &mut *core::ptr::addr_of_mut!(REPEAT_REGS)
        .cast::<[f64; MAX_DSP_REGS]>()
        .add(lane);
    for &reg in &plan.inputs {
        regs[reg] = kernel_global!(DSP_REGS)[reg];
    }
    let mut left = 0.0;
    let mut right = 0.0;
    for item in first..last {
        let spawn = kernel_global!(DSP_OPS)[start].opcode == DSP_OP_SPAWN_BEGIN;
        let (state_ptr, resources, gate) = if spawn {
            let instance = &mut *REPEAT_SPAWN_PTR.add(item);
            (
                instance.states.as_mut_ptr(),
                &mut instance.resources as *mut DspRepeatResourceState,
                if instance.gate { 1.0 } else { 0.0 },
            )
        } else {
            (
                if REPEAT_STATE_COUNT == 0 {
                    core::ptr::null_mut()
                } else {
                    REPEAT_STATES_PTR.add(item * REPEAT_STATE_COUNT)
                },
                if REPEAT_RESOURCES_PTR.is_null() {
                    core::ptr::null_mut()
                } else {
                    REPEAT_RESOURCES_PTR.add(item)
                },
                0.0,
            )
        };
        let mut context = RepeatContext {
            regs: regs.as_mut_ptr(),
            states: state_ptr,
            state_start: plan.state_start,
            state_count: REPEAT_STATE_COUNT,
            resources,
            lane,
        };
        let node_context = DspNodeContext {
            regs: context.regs,
            states: context.states,
            state_start: context.state_start,
            state_count: context.state_count,
            invalid_state: core::ptr::addr_of_mut!(REPEAT_INVALID_STATE)
                .cast::<f64>()
                .add(lane),
            item,
            gate,
        };
        if spawn && kernel_global!(DSP_OPS)[start].c >= 0 {
            regs[kernel_global!(DSP_OPS)[start].c as usize] = 0.0;
        }
        if !plan.explicit_context_only {
            set_active_repeat_context(&mut context);
        }
        for index in start + 1..plan.end {
            let collector_position = plan.collector_positions[index - start];
            if collector_position != usize::MAX {
                let result = (*plan.results.get())
                    .as_mut_ptr()
                    .add(item * plan.collectors.len() + collector_position);
                *result = regs[plan.collectors[collector_position].1.a as usize];
                continue;
            }
            let op = kernel_global!(DSP_OPS)[index];
            let repeated_resources = if !resources.is_null()
                && matches!(
                    op.opcode,
                    DSP_OP_SAMPLE
                        | DSP_OP_SAMPLE_PARAM
                        | DSP_OP_RANDOM
                        | DSP_OP_OSC
                        | DSP_OP_DISTORTION
                ) {
                Some(&mut *resources)
            } else {
                None
            };
            render_dsp_op::<true>(
                op,
                REPEAT_FRAME,
                REPEAT_SAMPLE_RATE,
                &mut left,
                &mut right,
                Some(node_context),
                repeated_resources,
            );
        }
        if !plan.explicit_context_only {
            set_active_repeat_context(core::ptr::null_mut());
        }
        if spawn && kernel_global!(DSP_OPS)[start].c >= 0 {
            *core::ptr::addr_of_mut!(REPEAT_KILL_RESULTS)
                .cast::<f64>()
                .add(item) = regs[kernel_global!(DSP_OPS)[start].c as usize];
        }
    }
}

pub(super) unsafe fn render_repeat(
    start: usize,
    count: usize,
    states: *mut f64,
    spawn: *mut DspSpawnInstance,
    resources: *mut DspRepeatResourceState,
    state_count: usize,
    frame: usize,
    sample_rate: f64,
) -> bool {
    if WORKERS == 0 || count > MAX_PARALLEL_REPEAT_ITEMS || failed() {
        return false;
    }
    let Some(plan) = current_plan()
        .and_then(|plan| plan.repeats.get(start))
        .and_then(Option::as_ref)
    else {
        return false;
    };
    if count < plan.min_count {
        return false;
    }
    // Very small bodies are cheaper to keep on the audio thread.
    if plan.end - start < 5 {
        return false;
    }
    if plan.state_count != state_count
        || (state_count > 0 && states.is_null() && spawn.is_null())
        || (kernel_global!(DSP_OPS)[start].opcode == DSP_OP_SPAWN_BEGIN) != !spawn.is_null()
    {
        return false;
    }
    REPEAT_START = start;
    REPEAT_COUNT = count;
    REPEAT_STATES_PTR = states;
    REPEAT_SPAWN_PTR = spawn;
    REPEAT_RESOURCES_PTR = resources;
    REPEAT_STATE_COUNT = state_count;
    REPEAT_FRAME = frame;
    REPEAT_SAMPLE_RATE = sample_rate;
    activate_workers();
    for control in CONTROLS.iter().take(WORKERS) {
        control.request.fetch_add(1, Ordering::Release);
    }
    render_repeat_lane(start, count, 0);
    if !wait_for_workers() {
        return true;
    }
    for &node in &plan.custom_wave_nodes {
        for lane in 0..=WORKERS {
            kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node] =
                kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node]
                    .max(REPEAT_MORPH_CONSUMED[lane][node]);
            REPEAT_MORPH_CONSUMED[lane][node] = 0;
        }
    }
    for item in 0..count {
        for (position, (_, collector)) in plan.collectors.iter().enumerate() {
            let value = (*plan.results.get())[item * plan.collectors.len() + position];
            let total = dsp_reg(collector.out);
            set_dsp_reg(
                collector.out,
                local_sanitize(if collector.b == 1 {
                    total * value
                } else {
                    total + value
                }),
            );
        }
    }
    let main_regs = &*core::ptr::addr_of!(REPEAT_REGS).cast::<[f64; MAX_DSP_REGS]>();
    for &reg in &plan.writes {
        kernel_global!(DSP_REGS)[reg] = main_regs[reg];
    }
    kernel_global!(DSP_SPREAD_ITEM_INDEX) = count - 1;
    true
}

pub(super) unsafe fn repeat_kill_result(item: usize) -> f64 {
    *core::ptr::addr_of!(REPEAT_KILL_RESULTS)
        .cast::<f64>()
        .add(item)
}

unsafe fn wait_for_workers() -> bool {
    for control in CONTROLS.iter().take(WORKERS) {
        let request = control.request.load(Ordering::Relaxed);
        let mut spins = 0u32;
        while control.done.load(Ordering::Acquire) != request {
            std::hint::spin_loop();
            spins = spins.wrapping_add(1);
            if spins % 1024 == 0 && now() >= DEADLINE {
                FAULT.store(1, Ordering::Release);
                ACTIVE.store(0, Ordering::Release);
                return false;
            }
        }
    }
    true
}

/// Called once per quantum from a persistent Worker. Between quanta JS uses
/// Atomics.wait; inside a quantum jobs synchronize through acquire/release.
#[no_mangle]
pub extern "C" fn runDspParallelWorker(worker: u32, epoch: u32) {
    let worker = worker as usize;
    if worker >= MAX_WORKERS {
        return;
    }
    let control = &CONTROLS[worker];
    let mut completed = control.done.load(Ordering::Relaxed);
    while ACTIVE.load(Ordering::Acquire) == epoch && !failed() {
        let request = control.request.load(Ordering::Acquire);
        if request != completed {
            unsafe {
                render_repeat_lane(REPEAT_START, REPEAT_COUNT, worker + 1);
            }
            completed = request;
            control.done.store(completed, Ordering::Release);
        } else {
            std::hint::spin_loop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn op(opcode: i32, out: i32, a: i32, b: i32) -> DspOp {
        DspOp {
            opcode,
            out,
            a,
            b,
            ..EMPTY_DSP_OP
        }
    }
    #[test]
    fn repeat_plan_rejects_cross_item_register_dependency() {
        let ops = [
            op(DSP_OP_SPREAD_BEGIN, -1, 0, 3),
            op(DSP_OP_ADD, 2, 2, 1),
            op(DSP_OP_SPREAD_COLLECT, 3, 2, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        assert!(repeat_plan(&ops, 0, 3).is_none());
    }

    #[test]
    fn repeat_plan_rejects_collector_feedback_and_stateful_ops() {
        let mut ops = [
            op(DSP_OP_SPREAD_BEGIN, -1, 0, 3),
            op(DSP_OP_ADD, 2, 3, 1),
            op(DSP_OP_SPREAD_COLLECT, 3, 2, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        assert!(repeat_plan(&ops, 0, 3).is_none());
        ops[1] = op(DSP_OP_OSC, 2, 0, 1);
        assert!(repeat_plan(&ops, 0, 3).is_none());
    }

    #[test]
    fn repeat_plan_accepts_independent_arithmetic() {
        let ops = [
            op(DSP_OP_SPREAD_BEGIN, -1, 0, 4),
            op(DSP_OP_SPREAD_INDEX, 1, -1, -1),
            op(DSP_OP_MUL, 2, 1, 3),
            op(DSP_OP_SPREAD_COLLECT, 4, 2, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        let plan = repeat_plan(&ops, 0, 4).unwrap();
        assert_eq!(plan.collectors[0].1.out, 4);
        assert_eq!(plan.inputs, vec![3]);
        assert_eq!(plan.min_count, 96);
    }

    #[test]
    fn repeat_plan_accepts_item_local_oscillator_state() {
        let mut begin = op(DSP_OP_SPREAD_BEGIN, -1, 0, 3);
        begin.state = 8;
        begin.value2 = 1.0;
        let mut oscillator = op(DSP_OP_OSC, 2, 0, 1);
        oscillator.state = 8;
        let ops = [
            begin,
            oscillator,
            op(DSP_OP_SPREAD_COLLECT, 3, 2, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        let plan = repeat_plan(&ops, 0, 3).unwrap();
        assert_eq!(plan.state_count, 1);
        assert_eq!(plan.min_count, 16);
    }

    #[test]
    fn repeat_plan_accepts_spawn_gate_envelope_and_kill() {
        let mut begin = op(DSP_OP_SPAWN_BEGIN, 20, 0, 5);
        begin.c = 4;
        begin.value2 = 8.0;
        let mut envelope = op(DSP_OP_ENVELOPE, 2, 1, 1);
        envelope.state = 0;
        let mut end_trigger = op(DSP_OP_END_TRIGGER, 4, 0, -1);
        end_trigger.state = 7;
        let ops = [
            begin,
            op(DSP_OP_SPAWN_INSTANCE_GATE, 1, -1, -1),
            envelope,
            op(DSP_OP_SPREAD_COLLECT, 3, 2, 0),
            end_trigger,
            op(DSP_OP_SPAWN_END, -1, -1, -1),
        ];
        assert_eq!(repeat_plan(&ops, 0, 5).unwrap().min_count, 8);
    }

    #[test]
    fn repeat_plan_accepts_instance_owned_effect_buffer() {
        let mut begin = op(DSP_OP_SPREAD_BEGIN, -1, 0, 3);
        begin.value2 = 1.0;
        let mut effect = op(DSP_OP_DELAY, 2, 1, 1);
        effect.state = 0;
        let ops = [
            begin,
            effect,
            op(DSP_OP_SPREAD_COLLECT, 3, 2, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        assert!(repeat_plan(&ops, 0, 3).is_some());
    }

    #[test]
    fn repeat_plan_accepts_audio_sample_and_keeps_video_serial() {
        let mut begin = op(DSP_OP_SPREAD_BEGIN, -1, 0, 4);
        begin.value2 = 1.0;
        let mut parameter = op(DSP_OP_SAMPLE_PARAM, -1, 0, 1);
        parameter.c = 1;
        let mut sample = op(DSP_OP_SAMPLE, 2, 0, 1);
        sample.c = 1;
        sample.d = 1;
        sample.e = 1;
        sample.state = 0;
        let mut ops = [
            begin,
            parameter,
            sample,
            op(DSP_OP_SPREAD_COLLECT, 3, 2, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        assert_eq!(repeat_plan(&ops, 0, 4).unwrap().min_count, 8);
        ops[2].value2 = 1.0;
        assert!(repeat_plan(&ops, 0, 4).is_none());
    }

    #[test]
    fn repeat_plan_accepts_independent_group_outputs() {
        let ops = [
            op(DSP_OP_SPREAD_BEGIN, -1, 0, 5),
            op(DSP_OP_ADD, 2, 0, 1),
            op(DSP_OP_SPREAD_COLLECT, 4, 2, 0),
            op(DSP_OP_MUL, 3, 0, 1),
            op(DSP_OP_SPREAD_COLLECT, 5, 3, 0),
            op(DSP_OP_SPREAD_END, -1, -1, -1),
        ];
        let plan = repeat_plan(&ops, 0, 5).unwrap();
        assert_eq!(plan.collectors.len(), 2);
    }
}
