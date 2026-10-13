#!/bin/sh
set -eu
npm ci
npm run build
export SDKROOT=/sdk
export MACOSX_DEPLOYMENT_TARGET=13.0
export CC_aarch64_apple_darwin=/work/scripts/mac-cc
export CXX_aarch64_apple_darwin=/work/scripts/mac-cxx
export AR_aarch64_apple_darwin=/work/scripts/mac-ar
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/work/scripts/mac-cc
export BINDGEN_EXTRA_CLANG_ARGS='--target=arm64-apple-macos13 -isysroot /sdk -I/sdk/usr/include -F/sdk/System/Library/Frameworks'
cargo build --manifest-path src-tauri/Cargo.toml --release --locked --target aarch64-apple-darwin
mkdir -p output/VIRA.app/Contents/MacOS output/VIRA.app/Contents/Resources
# Replace the inode, following the spike's cross-build setup.
rm -f output/VIRA.app/Contents/MacOS/vira
cp src-tauri/target/aarch64-apple-darwin/release/vira output/VIRA.app/Contents/MacOS/vira
cp scripts/Info.plist output/VIRA.app/Contents/Info.plist
python3 scripts/build-icon.py
printf 'APPL????' > output/VIRA.app/Contents/PkgInfo
