# Plugin hosting verification — 22 October 2026

The implementation uses vendored truce-rack 1.1.5 adapters for VST3, CLAP and
AUv2. `src-tauri/src/plugin_host.rs` is VIRA's format boundary. The adapter patch
receipts describe changes and remaining format limitations.

## Automated checks

- Full backend run: 283 tests passed before the final targeted additions.
- New regressions cover shared device-clock anchors for dynamically created
  hosts, parallel-path latency alignment/history preservation and excessive-delay
  rejection, nested bundle fingerprints/cache quarantine persistence, and MIDI
  output byte translation.
- Focused final backend run: 4 plugin tests, 31 routing tests and 5 MIDI tests
  passed. These include the four new regressions above.
- Full frontend run: 483 passed, two failed in App/Instruments tests. Isolated
  rerun of App, Instruments, Vst and PluginControls passed all 111 tests. Do not
  describe the initial full run as an all-green run.
- Final affected frontend run: all 48 tests in PluginControls, Vst and Routing passed.
- New UI coverage checks native parameter ranges, read-only controls, host setter
  commands, selected pinned controls and explicit retries of quarantined scans.
- TypeScript/Vite production build and the macOS cross-build use Docker.

## Native macOS checks

The rebuilt app's standalone checks do not open the live VIRA session. At the
96 kHz engine rate, each DSP check rendered 96000 frames, checked finite/audible
output, changed a native parameter, captured state, loaded it into a fresh
instance, and checked the restored value. A worker also continued rendering
while the main/control side captured state repeatedly.

| Plugin | Format | Peak | State bytes | Concurrent blocks observed |
| --- | --- | ---: | ---: | ---: |
| Dexed | VST3 | 0.131346 | 6194 | 69 |
| Dexed | CLAP | 0.131346 | 6110 | 47 |
| Dexed | AUv2 | 0.131346 | 7595 | 128 |
| Apple AUDelay | AUv2 | 0.070711 | 183 | 5 |

The final app also passed AUDelay's changed-parameter assertion. These are
functional checks, not hardware latency or dropout benchmarks.

Native editor checks opened Dexed and completed three close/reopen cycles on the
same instance for each format. The CLAP check exposed an unnecessary `set_size`
call for a non-resizable GUI; the adapter now returns its fixed size without that
call. Editor-cycle checks do not constitute a visual layout or compatibility
matrix for arbitrary plugins.

Commands, run against the Docker-built executable on macOS:

```sh
app/output/VIRA.app/Contents/MacOS/vira --vst-check /Library/Audio/Plug-Ins/VST3/Dexed.vst3
app/output/VIRA.app/Contents/MacOS/vira --vst-check /Library/Audio/Plug-Ins/CLAP/Dexed.clap
app/output/VIRA.app/Contents/MacOS/vira --vst-check au:aumu:Dexd:DGSB
app/output/VIRA.app/Contents/MacOS/vira --vst-check au:aufx:dely:appl
VIRA_PLUGIN_EDITOR_CYCLES=3 app/output/VIRA.app/Contents/MacOS/vira --vst-editor-check /Library/Audio/Plug-Ins/VST3/Dexed.vst3
VIRA_PLUGIN_EDITOR_CYCLES=3 app/output/VIRA.app/Contents/MacOS/vira --vst-editor-check /Library/Audio/Plug-Ins/CLAP/Dexed.clap
VIRA_PLUGIN_EDITOR_CYCLES=3 app/output/VIRA.app/Contents/MacOS/vira --vst-editor-check au:aumu:Dexd:DGSB
```

## Practical limits

Playback plugins remain in-process. VIRA avoids sharing its DSP mutex with UI or
state operations, but cannot guarantee that a third-party plugin's own state
implementation never blocks its processor. Native exceptions/access violations
are not isolated. Discovery alone has child-process crash/timeout isolation.

Audio pins carry stereo per bus. Native multi-bus/sidechain layouts are adapted,
but full surround-channel routing is not provided. Bus changes require recreating
and reconnecting a node. Timeline parameter automation, VST3 IMidiMapping for
CC/bend input, AUv3, LV2 and VST2 remain outside this change.

MIDI output preserves per-block sample offsets and reaches the existing musical
routing worker. It is not a same-block plugin event graph; processing/worker
lookahead can add latency when feeding another internal instrument. End-to-end
plugin MIDI output routing and hardware timing have not been validated with a
MIDI-generating third-party plugin. Long SysEx and UMP MIDI 2.0 are not forwarded.

Latency compensation is validated with synthetic graph regressions. No installed
lookahead effect was used to measure end-to-end hardware alignment. Delay limits
are explicit (960000 frames per path, 32 MB total). Editor lifecycle was checked
with Dexed; arbitrary plugin resize, DPI and callback behavior still requires
compatibility testing.
