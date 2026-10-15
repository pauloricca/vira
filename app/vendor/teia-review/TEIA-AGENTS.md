# Agent Instructions

## Node Port Naming

- Use lowercase, human-readable English names for all node input and output labels. Separate words with spaces; do not use camelCase, PascalCase, snake_case, kebab-case, abbreviations, or programming-oriented naming conventions.

## Do Not Start or Functionally Test the App Without Permission

- Never start, serve, preview, or otherwise run the application unless the user explicitly asks in the current conversation to run it or to test its functionality.
- This includes direct and indirect launch paths such as `npm start`, `npm run dev`, `npm run preview`, the repository's `start` script, local server scripts, Docker/Compose services, browser automation, and any command that launches the app or binds its ports.
- Never open the app in a new browser tab or window, navigate or refresh an existing app tab, or use browser/computer automation against it unless the user explicitly asks in the current conversation. This applies even when opening the app would ordinarily be part of testing or verification.
- Do not assume that a running app or server belongs to the agent. Do not stop, restart, replace, or reconfigure an existing process unless the user explicitly asks.
- Do not perform smoke, integration, end-to-end, browser, audio, or other functional/runtime tests unless the user explicitly asks to test functionality.
- After making changes, validate only with non-running checks that do not launch the app, such as builds, TypeScript typechecks, linting, formatting checks, or static compilation checks.
- Report which non-running checks passed, then hand the changes back to the user for functional testing.
- If a requested validation command would start the app or could interfere with an existing instance, do not run it; explain that it was skipped under this instruction.
- At every implementation handoff, tell the user how to make the change visible and test it. Choose the applicable case explicitly:
  1. **Already applied:** the running development app should receive the change immediately (for example through hot reload); tell the user what to inspect or exercise.
  2. **Refresh required:** the user must refresh the existing app; say whether an ordinary refresh is sufficient and then give the functional check.
  3. **Rebuild and restart required:** the user must rebuild and start the app again; name the relevant build/start commands when known, then give the functional check.
- If more than one case applies to different parts of a change, separate them clearly. Never carry out the refresh, restart, app launch, or functional test yourself unless the user explicitly asks.

## Preserve the Running Docker Configuration During Builds

- A static host build such as `npm run build` is allowed without additional permission. A Docker/Compose rebuild, container recreation, restart, or invocation of `./start` is not a static build and remains prohibited unless the user explicitly asks for it.
- Engine-build exception: after changing the Rust/WASM audio engine, always run `npm run build:wasm` before handoff so the updated kernel is copied into the editor assets; this required artifact build is permitted even though its script uses Docker, but it does not grant permission to start, restart, refresh, or functionally test the app.
- The running Docker app bind-mounts this repository and serves `editor/dist`, so a host build replaces the bundle used by the user's app. Before building, preserve the active theme from the existing Docker container configuration or from the user's stated launch configuration. Determine it with read-only inspection only; do not open the app, refresh a tab, restart a container, or infer a theme from visual appearance.
- Build the Docker-served bundle with both `VITE_TEIA_THEME` set to the active theme and `VITE_TEIA_PATCH_STORAGE=local`. The latter is required so `SV` saves to the local patch library instead of downloading a file.
- Do not run an unconfigured `npm run build` while the Docker app is running, because it compiles the default theme and storage mode into `editor/dist`. Use the equivalent of `VITE_TEIA_THEME="$ACTIVE_THEME" VITE_TEIA_PATCH_STORAGE=local npm run build`.
- If the active theme cannot be determined reliably through read-only inspection or prior user context, do not build. Run another non-mutating check such as `npm run typecheck`, and tell the user that the build was skipped to avoid replacing their active theme.
- A build does not grant permission to refresh the user's tab or functionally test the result. Tell the user that an ordinary refresh is required and let them perform it.

## Keep the README in Sync

- For every task, review the completed change before handoff and decide whether `README.md` now needs to be added to or amended. Make any required README changes as part of the same task.
- Give special attention to user-visible UI behavior and workflows, all keyboard shortcuts and modifier-key gestures, and any added, removed, renamed, or behaviorally changed node type.
- When a node changes, keep both its description and its signature (input and output port names) accurate. Include changes to dynamic ports, renamed ports, defaults, modes, or other controls when they affect how a user connects or operates the node.
- Also update setup, build, configuration, persistence, file-format, compiler, and architecture documentation whenever the corresponding behavior changes.
- Do not edit the README merely to create churn. If no documentation is affected, leave it unchanged and state at handoff that README impact was checked.

## Keep FM-1 Support Tracking in Sync

- `firmware/fm1/support.json` is the single editable capability contract, validated by `firmware/fm1/support.schema.json`. Frontend warnings, editor/CLI export gates, binary upload preflight and the generated reference must consume it. Never add independent support lists to these consumers. `SUPPORT.md` and `limits.json` are generated outputs; do not edit them manually.
- Every functionality change or FM-1 implementation change must update the relevant contract entries in the same task: node status, blocked inputs/outputs, compiler opcode/mode/function rules, encoded instructions and their first firmware/package versions, limits and evidence as applicable. JSON declarations do not implement DSP: update the relevant backend handlers as well. Unsupported and unknown enabled nodes block export; partial support must have concrete restrictions represented in the contract and enforced by the compiler.
- Record web/firmware divergence using the feature's structured `drift` object (`webBehavior`, `firmwareBehavior`, `requiredWork`), not only prose in a README. When firmware catches up, remove or narrow that drift and its port restrictions, update support status and version evidence, and regenerate the reference. Keep verification separate from implementation.

- When adding or changing nodes, ports, compiler behavior, FM-1 DSP, controls, MIDI, storage or firmware protocols, review `firmware/fm1/support.json` and follow `firmware/fm1/SUPPORT.md#keeping-this-current`. Add an explicit entry for every new node, even if unsupported.
- Every web-engine change requires an FM-1 parity review, including Rust/WASM kernels, audio worklets, runtime scheduling, graph compilation, DSP algorithms, defaults, ranges, timing, modulation and bug fixes. This applies even when no FM-1 file or automatically watched source changes.
- When the web engine gains or changes behavior that the current FM-1 firmware does not match, update `firmware/fm1/support.json` in the same task: mark the affected feature `partial` or `unsupported`, and describe the web behavior, the firmware's current behavior and the work needed to catch up in its structured `drift` fields and notes. Add a separate feature entry when the gap is not adequately represented by an existing node entry. If parity cannot be established from evidence, use `unknown` and state what needs checking; never leave an unqualified `supported` claim for an unaudited change.
- Keep the target firmware and implementation version truthful: a web-engine change does not advance the firmware version or prove that firmware support was added. Preserve historical evidence, but downgrade current verification where it no longer establishes the changed behavior. Tracking a gap does not require implementing the firmware change in the same task.
- For engine changes with no FM-1 parity impact (such as a behavior-preserving refactor), leave feature statuses unchanged and explicitly state the reason in the handoff. Do not merely refresh source fingerprints to silence the check. In all other cases, update the register and regenerate the support matrix before handoff, even if the automatic check would already pass.
- Separate implementation status from host/hardware verification. Record exact firmware and evidence; do not carry older verification forward implicitly.
- After reviewing the source changes and updating the register, acknowledge source fingerprints with `node scripts/fm1-support.mjs --record-review`, regenerate with `npm run fm1:support:write`, and run `npm run fm1:support:check`. These commands only audit files; they do not authorize functional testing.
