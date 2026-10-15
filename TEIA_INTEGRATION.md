# Teia Integration into Vira

**Status:** Architectural vision and requirements (revision 0.2)  
**Scope:** Hosting Teia instruments and effects in Vira, with a host-owned patch library and a dedicated Teia editor window.

## 1. Vision and ownership

Vira is a DJ and audio-mixing application. Teia is a modular, graph-based synthesis and audio-processing environment with a sample-accurate Rust runtime.

Vira should use Teia patches as independently instantiable instruments, effects and hybrid processors. Teia remains an independent engine and editor, not a patch-library manager embedded inside Vira.

**Teia defines and executes patches; Vira owns patch files, instances, routing, transport, persistence and the editor window.**

Teia's reusable editor receives an editable patch document and a host-provided runtime communication interface. It does not discover files, choose where they live, or save directly into Vira's library.

## 2. Patch capabilities

A patch may consume and produce any useful combination of:

- **Audio input:** host-supplied audio, including stereo deck or effects-chain audio.
- **Audio output:** processed or generated audio returned to the host.
- **MIDI:** notes, velocity, CC, pitch bend and other supported events, with sample offsets when applicable.
- **Tempo and transport:** BPM, beat/bar position, running state, playhead position, seeks and loops. Hosted tempo/clock nodes follow Vira rather than free-running independently.
- **Exposed parameters:** defined by Teia's existing Params node or equivalent, including names, stable identifiers, types, ranges, defaults and suitable metadata.

Instruments and effects should not require unrelated runtime systems. Patch capabilities arise from the patch interface, not a rigid category.

## 3. Patch files and library ownership

Vira designates a configurable or conventional directory containing Teia patch files. Vira scans/discovers this directory, chooses patches, reads their editable source representation, and passes that representation to the editor when requested.

Vira owns file paths, naming, browsing, importing, persistence and save conflicts. Teia owns the patch schema, validation, parsing, serialization and compilation/preparation, but does **not** manage the host's library or filesystem.

When a user chooses **Save** in the Teia editor, the editor sends a save request and current patch document to Vira. Vira decides where and how to persist it and returns success or failure. The editor should show the resulting state and not claim a save succeeded before acknowledgement.

Unsaved edits can be applied live. **Apply and Save are separate actions:** the runtime can reflect the current working document without overwriting the file on disk. Closing with unsaved changes and external file modifications should be handled by Vira's window/document lifecycle.

## 4. Patch definitions, preparation and instances

A **patch document** is editable and serializable graph data. A **compiled/prepared patch** is whatever Teia's existing pipeline produces for execution; it need not be a native binary or independent WASM module. A **patch instance** has its own mutable DSP state, such as envelopes, filters, oscillators and delays.

Vira should be able to instantiate multiple patches, including multiple instances of one definition. Reusable immutable compiled data may be shared where supported, but mutable instance state must remain isolated.

Patch compilation/preparation and graph validation should occur outside the real-time audio callback. Vira should be able to safely replace a running instance or its executable graph when edits are applied, with a clear policy for state continuity, audible transitions and failure rollback.

## 5. Teia runtime host interface

Teia should provide a general-purpose host-facing runtime API, independent of Vira-specific concepts. Its conceptual capabilities are:

| Capability | Responsibility |
| --- | --- |
| Parse / validate / serialize | Operate on patch documents supplied by the host |
| Prepare / compile | Turn a document into an executable representation |
| Inspect | Expose audio/MIDI/transport requirements and Params metadata |
| Instantiate / dispose | Manage independent execution state |
| Process | Consume audio buffers, MIDI and host timing; produce audio |
| Control | Apply parameter changes, potentially timestamped or sample-offset |
| Observe | Return parameter state, diagnostics, meters or other supported feedback |
| Replace / reset | Safely update or restart a running patch |

These are requirements, **not prescribed function names**. Avoid filesystem or patch-browser responsibilities in the core runtime API.

### Real-time constraints

Audio processing must avoid blocking, filesystem access and unnecessary allocations. Preserve sample-accurate event scheduling where practical; support Vira's actual buffer size and channel layout. Keep control/UI communication separate from the audio callback and define how changes cross thread boundaries.

Investigate the current Rust/WASM architecture and Vira's audio pipeline before choosing an FFI, WASM or worklet integration. Avoid duplicating the DSP engine or unnecessarily copying audio.

## 6. Hosted Teia editor in a separate Tauri window

Vira opens a **second Tauri window** dedicated to editing the selected Teia patch. This is the preferred UX, not a modal embedded inside Vira's main UI.

The window loads Teia's existing graph editor in a **hosted mode**, conceptually similar to the existing FM1 mode: the same underlying graph editing component and node system, with a tailored interface and capability set.

The mode's exact name is not important; use a clear name such as `hosted` or `vira` after inspecting the current mode architecture. Prefer a generic hosted mode rather than hard-coding Vira-specific behaviour into reusable Teia code.

### Hosted-mode behaviour

- Vira passes the editable patch document and relevant host capabilities to the window/editor.
- The editor does **not** independently start playback, own an audio device, run its own transport, or create a competing audio engine.
- The editor may hide standalone playback controls and show context-relevant nodes, options, transport readouts and parameter tools.
- Editing nodes, links, and parameter definitions reuses the main Teia editor code.
- The editor can display live parameter values, metering and runtime feedback supplied by the host.
- Parameter changes and other suitable controls should reach the active instance immediately.
- Graph changes should be validated/prepared and applied as promptly as safely possible, without writing the patch file automatically.
- Save requests are forwarded to Vira; Vira persists the file and acknowledges the result.

**FM1 mode is an architectural precedent for varying the editor UI, not a requirement to reuse FM1's exact restrictions.** Hosted mode should expose nodes relevant to Vira's capabilities, especially audio input, MIDI, tempo/clock and Params.

### Communication bridge

In the standalone browser editor, Teia's JavaScript already communicates with a WASM runtime instance. Reuse that communication model where sensible, but do not assume the editor window can hold or directly invoke the same WASM object as Vira's real-time engine.

Tauri windows have separate JavaScript contexts, and the audio runtime may live in an AudioWorklet or another execution context. Therefore, investigate a **host-supplied editor bridge/adapter** that presents the operations and feedback Teia's editor needs while Vira transports commands and events to the actual runtime.

The bridge should cover:

1. Loading/replacing the editable document.
2. Parameter and other real-time control updates.
3. Graph edits and requests to prepare/apply updated patches.
4. Runtime feedback, meters, state and errors.
5. Save requests and save acknowledgements.
6. Window close/unsaved-change coordination.

Prefer efficient event or message channels; avoid unnecessary high-frequency UI traffic and avoid routing audio sample buffers through the editor window. A direct runtime binding remains acceptable in standalone mode.

## 7. Live editing versus saving

**Live application is the default; saving is explicit.**

Parameter changes should update the running instance with low latency, without requiring graph recompilation unless Teia's semantics demand it. Structural graph edits may require validation, recompilation/preparation and an atomic or otherwise safe swap at an audio block boundary.

The editor should retain an editable working document even if a particular change fails to compile; Vira should keep the last valid running version and report the error back to the editor. Consider debouncing expensive rebuilds while preserving a responsive experience.

Runtime feedback should travel back to the editor without coupling the editor to Vira's internal DSP topology. Avoid creating a second runtime merely for editor preview when the goal is to edit the live hosted instance.

## 8. Vira's patch and instance management

Vira is responsible for:

- Locating patch files in its configured patch directory.
- Loading a patch and selecting where it runs (deck effect, other effects chain, instrument, etc.).
- Creating, enabling, bypassing, suspending, resetting and destroying runtime instances.
- Supplying audio, MIDI and transport timing.
- Displaying host-side controls derived from Teia's Params metadata.
- Opening/focusing a Tauri editor window for the selected patch/instance.
- Applying editor changes to the intended instance(s).
- Saving the document on an explicit editor save request.
- Persisting project/session state, including patch references and per-instance parameter values.

The host must define what happens if several instances use one patch file and one instance is edited: whether the edit applies to one instance, all instances or only future instances. This must be explicit, not an accidental side effect of shared compiled data.

Bypass, suspend and destruction are distinct. Preserve tails and state where appropriate, without burning unnecessary CPU. Consider patch versioning and missing/moved files when restoring sessions.

## 9. Separation of responsibilities

| Layer | Owns | Does not own |
| --- | --- | --- |
| Teia core | Graph semantics, nodes, Params schema, compilation, DSP and serialization | Vira's file library, deck routing or project state |
| Teia host runtime API | Instances, processing, MIDI/timing/control inputs, feedback | Filesystem discovery or host UI |
| Teia editor | Graph editing, hosted UI variant, working document, editor-side bridge integration | Host patch directory, audio device or saving directly to Vira files |
| Vira | Patch files, runtime placement, audio/transport/MIDI routing, editor Tauri window, saving and sessions | Reimplementing Teia's graph/DSP/editor |

## 10. Implementation priorities

First establish a thin, reliable end-to-end path:

1. Vira reads a Teia patch file and creates an instance using the existing Rust/WASM runtime.
2. Audio, MIDI and transport information flow from Vira into the instance; audio flows back.
3. Vira discovers Params metadata and updates parameters in real time.
4. Vira opens a separate Tauri window containing the Teia editor in hosted mode, passing the editable document.
5. Editor changes reach the **same hosted runtime instance** through a suitable bridge; runtime feedback returns to the editor.
6. Graph edits are applied safely without implicit disk saves.
7. The editor's Save action asks Vira to persist the patch file and receives acknowledgement.
8. Multiple independent instances and saved session restoration are verified.

Implement incrementally based on what the codebases already support. Do not demand seamless state preservation across every graph edit for the first milestone, but avoid designs that prevent it later.

## 11. Questions for codebase investigation

- How do Teia's current FM1 mode and standalone editor share UI code, and how should hosted mode be expressed?
- What JavaScript-to-WASM runtime object/interface does the current editor use? Which parts can be adapted into a host bridge?
- Where does Vira's audio processing actually run, and how can Teia's Rust runtime be hosted there?
- What messaging/IPC is suitable between Vira's main window, the editor Tauri window and the audio execution context?
- What is the exact patch file format and its current compilation/preparation path?
- How can the runtime accept external audio, MIDI and transport without internal competing clocks?
- How can parameter changes be sent quickly and runtime feedback observed efficiently?
- What happens on graph edit failures, repeated rapid edits and runtime replacement?
- How should Save/Save As, dirty state, conflicts and multiple editor windows work?
- How should edits to a shared patch definition affect multiple active instances?
- Which requirements are already implemented, and which need extensions?

## 12. Definition of success

A user can select a Teia patch file from Vira's library, run it as an instrument or effect with Vira's audio, MIDI and clock, adjust its exposed parameters, and open a **separate Tauri editor window** showing the familiar Teia graph editor in hosted mode. Edits affect the running patch promptly, runtime feedback reaches the editor, and **only an explicit Save request** asks Vira to write the patch file. Teia remains an independent engine and editor, with no responsibility for Vira's patch library.
