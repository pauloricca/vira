#!/bin/sh
set -eu
export SDKROOT=/sdk
export MACOSX_DEPLOYMENT_TARGET=13.0
export CC_aarch64_apple_darwin=/work/scripts/mac-cc
export CXX_aarch64_apple_darwin=/work/scripts/mac-cxx
export AR_aarch64_apple_darwin=/work/scripts/mac-ar
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/work/scripts/mac-cc
export BINDGEN_EXTRA_CLANG_ARGS='--target=arm64-apple-macos13 -isysroot /sdk -I/sdk/usr/include -F/sdk/System/Library/Frameworks'
cargo build --release --locked --features host --target aarch64-apple-darwin
mkdir -p output/native
rm -f output/native/vira-host-spike
cp target/aarch64-apple-darwin/release/vira-audio-spike output/native/vira-host-spike
