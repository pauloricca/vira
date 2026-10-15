// Shared off-render resource preparation. Exported to WASM and used within
// the owned native scope; no separate native scheduler or resource allocator.

/// Opt-in finite repeat policy for the compiled graph's hierarchical contexts. Zero is
/// deliberately not a default: legacy patches retain their dynamic semantics.
/// Returns -1 for invalid budgets, active repeats or excess requested memory.
#[no_mangle]
pub extern "C" fn prepareDspRealtime(repeat_capacity: u32, budget_bytes: u32) -> i32 {
    let capacity = repeat_capacity as usize;
    if capacity == 0 || capacity > 1024 {
        return -1;
    }
    unsafe {
        if kernel_global!(DSP_REPEAT_CAPACITY) != 0 {
            return -1;
        }
        let seed = kernel_global!(DSP_RANDOM_SEED_STREAM);
        let sequence = bounded_repeats::BoundedSequence::prepare(capacity, budget_bytes as usize);
        kernel_global!(DSP_RANDOM_SEED_STREAM) = seed;
        let Some(sequence) = sequence else {
            return -1;
        };
        (&mut *core::ptr::addr_of_mut!(kernel_global!(DSP_MIDI_NOTE_EVENTS)))
            .get_or_insert_with(VecDeque::new)
            .reserve(4096);
        (&mut *core::ptr::addr_of_mut!(kernel_global!(DSP_MIDI_OUTPUT_EVENTS)))
            .get_or_insert_with(VecDeque::new)
            .reserve(MAX_DSP_OPS);
        (&mut *core::ptr::addr_of_mut!(kernel_global!(DSP_MIDI_HELD_NOTES)))
            .get_or_insert_with(Vec::new)
            .reserve(16 * 128);
        kernel_global!(DSP_BOUNDED_PROGRAM) = Some(sequence);
        kernel_global!(DSP_REPEAT_CAPACITY) = capacity;
        kernel_global!(DSP_REPEAT_EXHAUSTIONS) = 0;
    }
    1
}

#[no_mangle]
pub extern "C" fn dspRepeatExhaustions() -> f64 {
    unsafe { kernel_global!(DSP_REPEAT_EXHAUSTIONS) as f64 }
}
