# VIRA native input adapter

The archived sources in `../teia-kernel` and `../teia-hosted` remain unchanged and
continue to pass `scripts/verify-teia.mjs`. This crate's build script copies the
kernel sources into Cargo's output directory and adds VIRA's native-only input
routing API there. Exact source anchors fail the build if the snapshot changes.

`app/teia-inputs-plugin.ts` annotates AudioInput operations with their stable node
IDs when Vite/Vitest compiles the hosted editor. VIRA resolves those IDs to routing
pins, including Group scopes. The adapter stores the resulting register-to-bus
map on the instance, outside its program identity, so buffer capture and recovery
keep their original compatibility checks.

Each patch supports up to 32 independent stereo input buses in VIRA's 128-frame
producer blocks. The existing stereo `process_host` API is unchanged. Routed
processing uses fixed instance-owned storage and performs no render-time allocation.

Validate with the app's Docker builder: the VIRA library tests include distinct
input signal isolation and live port reconciliation; `hosted_conformance` covers
the original hosted runtime behavior.
