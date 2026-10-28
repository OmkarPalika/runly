#!/usr/bin/env sh
# Downloads the prebuilt teavm-javac compiler (https://github.com/konsoletyper/teavm-javac)
# from teavm.org and checks it against SHA256SUMS.
set -eu
cd "$(dirname "$0")"
for f in compiler.wasm compiler.wasm-runtime.js compile-classlib-teavm.bin runtime-classlib-teavm.bin; do
  curl -fsSL -o "$f" "https://teavm.org/playground/$f"
done
sha256sum -c SHA256SUMS
