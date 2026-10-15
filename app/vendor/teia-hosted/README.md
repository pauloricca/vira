# @pauloricca/teia-hosted

Private, UNLICENSED local artifacts for Teia document/compiler APIs, the supplied-
bridge HostedNodeEditor and an independent native Rust runtime profile.

From the Teia repository root, run `npm run build:hosted`. Consume this directory
as a local package after building. The complete API, compatibility, resource,
ownership, milestone and verification documentation ships at `dist/README.md`
([repository source](../docs/hosted.md)). Nothing is published by the build.

For the first host implementation and local npm/Cargo distribution workflow, see
the repository's [host handover](../docs/host-handover.md).

The root entrypoint supplies document/compiler/bridge/session APIs; `./editor`
exports HostedNodeEditor. Import `./flow.css`, `./themes.css`, then `./styles.css`.
React/React DOM 19.1+, React Flow 12.8+ and @xyflow/system 0.0.77 are peers.
`dist/native/teia-kernel` is a complete Rust path-dependency source crate.
`dist/compatibility.json` records versions, source state and artifact checksums.

Native instances share standalone Rust graph scheduling, resource/cache
preparation, validation, smoothing machinery and DSP. Resource-dependent patches
use `Resources`; repeats require explicit capacity/memory budgets. The old
profile name remains a compatibility alias, not a node whitelist. FFT's browser
analysis still needs shared Rust integration and is diagnosed for native use.
Native/contract/equivalence/allocation tests have been run; browser isolation,
macOS deadlines and external-host integration remain unverified.
