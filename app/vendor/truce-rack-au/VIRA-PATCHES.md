Pinned from truce-rack-au 1.1.5 (MIT OR Apache-2.0), crates.io.
Upstream: https://github.com/truce-audio/truce-rack

VIRA queries AUv2's registered audio elements and stream formats, configures each
input/output bus, installs an input callback per bus, and renders independent
output buses. An audio handle owns the heap-stable input/transport/MIDI callback
contexts; its native AU owner remains on the main thread until plans retire.
MIDI output uses Apple's AUMIDIOutputCallback property with sample offsets and
bounded preallocated event storage. Plugin latency is exposed to VIRA's routing
compensator. Native class-info state and Cocoa editors use the upstream adapter.

AUv3 and UMP MIDI 2.0 output are not included. AUv2 MIDI packets above eight bytes
(Sysex) are not forwarded. Dynamic bus changes require recreating the instance.
Only scanning is isolated; plugin processing is in-process.
