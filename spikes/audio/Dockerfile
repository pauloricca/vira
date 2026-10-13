FROM rust:1.90.0-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f AS dev
RUN apt-get update && apt-get install -y --no-install-recommends libasound2-dev clang curl ca-certificates python3 time && rm -rf /var/lib/apt/lists/*
WORKDIR /work
RUN mkdir -p /opt/vendor && curl -fsSL https://github.com/breakfastquay/rubberband/archive/refs/tags/v4.0.0.tar.gz -o /tmp/rubberband.tar.gz \
 && echo '24300f48a8014b7c863b573a9647e61b1b19b37875e2cdd92005e64c6424d266  /tmp/rubberband.tar.gz' | sha256sum -c - \
 && tar xzf /tmp/rubberband.tar.gz -C /opt/vendor && rm /tmp/rubberband.tar.gz
ENV RUBBERBAND_SOURCE=/opt/vendor/rubberband-4.0.0
RUN rustup component add rustfmt clippy
CMD ["bash"]

# Cross-build the host executable without installing Rust or native dependencies on macOS.
FROM dev AS mac-builder
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv libclang-dev && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/zig && /opt/zig/bin/pip install --no-cache-dir ziglang==0.14.1 \
 && rustup target add aarch64-apple-darwin
ENV PATH=/opt/zig/lib/python3.11/site-packages/ziglang:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
