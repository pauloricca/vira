#!/bin/sh
set -eu
export SDKROOT=/sdk
export MACOSX_DEPLOYMENT_TARGET=13.0
export CC_aarch64_apple_darwin=/work/scripts/mac-cc
export CXX_aarch64_apple_darwin=/work/scripts/mac-cxx
export AR_aarch64_apple_darwin=/work/scripts/mac-ar
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/work/scripts/mac-cc
export BINDGEN_EXTRA_CLANG_ARGS='--target=arm64-apple-macos13 -isysroot /sdk -I/sdk/usr/include -F/sdk/System/Library/Frameworks'
cargo build --release --locked --target aarch64-apple-darwin
mkdir -p output/native
# Replace the inode so macOS does not retain a cached signature for an older build.
rm -f output/native/vira-audio-spike
cp target/aarch64-apple-darwin/release/vira-audio-spike output/native/
