FROM node:22.20.0-bookworm@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7 AS node-runtime

FROM rust:1.90.0-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f AS builder
RUN apt-get update && apt-get install -y --no-install-recommends clang libclang-dev python3-venv ca-certificates && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/zig && /opt/zig/bin/pip install --no-cache-dir ziglang==0.14.1 \
 && rustup target add aarch64-apple-darwin && rustup component add rustfmt
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
ENV PATH=/opt/zig/lib/python3.11/site-packages/ziglang:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /work
RUN mkdir -p /opt/vendor && curl -fsSL https://github.com/breakfastquay/rubberband/archive/refs/tags/v4.0.0.tar.gz -o /tmp/rubberband.tar.gz \
 && echo '24300f48a8014b7c863b573a9647e61b1b19b37875e2cdd92005e64c6424d266  /tmp/rubberband.tar.gz' | sha256sum -c - \
 && tar xzf /tmp/rubberband.tar.gz -C /opt/vendor && rm /tmp/rubberband.tar.gz
ENV RUBBERBAND_SOURCE=/opt/vendor/rubberband-4.0.0

FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d AS preparation
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY preparation/requirements.lock.txt /tmp/requirements.lock.txt
RUN pip install --no-cache-dir -r /tmp/requirements.lock.txt
ENV NUMBA_CACHE_DIR=/tmp/numba OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
WORKDIR /service
COPY preparation/ /service/
CMD ["python", "-u", "service.py"]
