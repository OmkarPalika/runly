# @browserrun/clang

Clang 22 and LLD built for WASI, trimmed for download size. sandrun loads it to
compile C and C++ (C++20 by default) in the browser. About 14 MB on the wire.

## Building

1. Build the compiler (several hours; needs about 14 GB of RAM for the final
   link). Clone YoWASP/clang into `src/` next to `build.sh`, then:

   ```sh
   docker run --name clang-build -v clang-build:/build -v "$PWD:/work" ubuntu:24.04 sh /work/build.sh
   ```

2. Transpile and package (Node 20+, `brotli`):

   ```sh
   cd /build/src/npmjs && npm install && npm run transpile
   sh package.sh /build/src <dir with brotli-dec-wasm's web build>
   ```

The output lands in `gen/`. See NOTICE.md for what is included and its licenses.
