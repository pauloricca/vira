Pinned from truce-rack-vst3 1.1.5 (MIT OR Apache-2.0), downloaded from crates.io.
Upstream: https://github.com/truce-audio/truce-rack

VIRA changes:
- Query actual audio/event buses instead of assuming stereo effects; activate all
  buses and pass independent planar buffers for sidechains and auxiliary outputs.
- Support recursive discovery and direct bundle probing.
- Provide IHostApplication and IComponentHandler. Forward GUI parameter edits to
  preallocated IParameterChanges queues on the next process call.
- Reuse event objects and bounded event storage; adapt buses without allocations.
- Synchronize controller state after loading component state.
- Close editors before termination and retain the library until all COM objects
  have been released. Fix unsigned-char bindings on non-Apple platforms.

Additional VIRA changes:
- Split native control ownership from an exclusive audio handle, so GUI/state
  operations do not acquire VIRA's DSP lock.
- Version component and controller state together; accept legacy component blobs.
- Expose declared factory categories/vendor, stable IDs, latency and event outputs.
- Route native and host parameter edits to the processor, and forward note/CC
  output events to VIRA. Use IPlugFrame for plugin-initiated editor resizing and
  the optional content-scale interface.

Current constraints: no VST2, dynamic bus reconfiguration, or VST3 IMidiMapping
for CC/pitch-bend input. VIRA maps each audio bus to a stereo cable: mono is
 duplicated/downmixed, channels beyond L/R are silent inputs and omitted outputs.
Plugin processing is in-process; discovery alone is isolated. VIRA provides
host-side latency compensation in routing.rs, outside this adapter.
