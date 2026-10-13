#!/usr/bin/env python3
"""Translate compiler-driver flags emitted by Rust/cc-rs to Zig's target syntax."""
import os, sys
args=[]
skip=False
for arg in sys.argv[2:]:
    if skip:
        skip=False
        continue
    if arg in ('-arch', '-target', '--target'):
        skip=True
        continue
    if arg.startswith(('--target=', '-mmacosx-version-min=')):
        continue
    args.append(arg)
os.execvp('zig', ['zig',sys.argv[1],'-Wno-elaborated-enum-base','-target','aarch64-macos.13.0','-isysroot','/sdk','-idirafter','/sdk/usr/include','-F/sdk/System/Library/Frameworks','-L/sdk/usr/lib',*args])
