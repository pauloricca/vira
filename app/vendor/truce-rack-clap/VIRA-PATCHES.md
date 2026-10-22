Pinned from truce-rack-clap 1.1.5 (MIT OR Apache-2.0), crates.io.
Upstream: https://github.com/truce-audio/truce-rack

VIRA supplies a persistent non-null clap_host with main-thread callbacks, GUI
resize requests and timer support. Discovery accepts direct bundles recursively.
Declared audio and note ports replace the upstream fixed-stereo assumption.
An independent audio handle owns processing state, preallocated event conversion
and fixed bus pointer arrays. Parameter changes cross a bounded, coalescing queue;
output events are bounded and delivered to VIRA's musical routing worker. Audio
start/stop runs on the producer when a node leaves the applied plan. Editor and
state access stay on the main thread while the native owner outlives audio plans.

Dynamic audio-port reconfiguration and full CLAP host extension coverage remain
unsupported. Processing is in-process; only scanning is isolated. GUI timer
callbacks have a minimum servicing granularity of about 33 ms.
