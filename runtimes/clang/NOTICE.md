# @browserrun/clang

This package contains a build of Clang and LLD from LLVM, compiled to
WebAssembly with the build scripts of [YoWASP clang](https://github.com/YoWASP/clang)
(commit 2ef17b392c97008b0e5116f8b1584b0c32809c2a). The build disables LLVM
assertions and every tool except clang and lld, and leaves out headers for
non-WebAssembly targets. Downloads are brotli-compressed and unpacked with
[brotli-dec-wasm](https://github.com/myl7/brotli-dec-wasm).

Licenses, all in `licenses/`:

- LLVM, Clang, LLD, libc++: Apache-2.0 WITH LLVM-exception (LLVM.txt)
- YoWASP clang build scripts and runtime glue: Apache-2.0 (YoWASP-clang.txt)
- wasi-libc: Apache-2.0 WITH LLVM-exception / Apache-2.0 / MIT (wasi-libc.txt, wasi-libc-MIT.txt)
- musl, as included in wasi-libc: MIT (musl.txt)
- brotli-dec-wasm: MIT (brotli-dec-wasm-MIT.txt)
