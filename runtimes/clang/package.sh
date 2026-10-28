#!/bin/sh
# Packages a finished YoWASP Clang build (see build.sh) as @browserrun/clang.
# Usage: package.sh <yowasp-clang checkout> <decoder dir>
# Needs node >= 20 and brotli.
set -e
src=$(cd "$1" && pwd)
decoder=$(cd "$2" && pwd)
here=$(cd "$(dirname "$0")" && pwd)

# Clang's builtin headers cover every target. Only WebAssembly is built, so
# the intrinsics headers for other processors are dead weight.
rm -rf "$src/usr-trimmed"
cp -r "$src/wasi-prefix/usr" "$src/usr-trimmed"
cd "$src/usr-trimmed/include"
rm -rf sanitizer ppc_wrappers openmp_wrappers cuda_wrappers llvm_libc_wrappers \
  llvm_offload_wrappers zos_wrappers hlsl profile xray orc fuzzer
rm -f opencl-* altivec.h vecintrin.h hexagon* hvx_* *intrin*.h avx*.h amx*.h \
  mm_malloc.h mm3dnow.h cpuid.h cet.h __clang_cuda* __clang_hip* __clang_spirv* \
  arm_* arm64intr.h armintr.h riscv_* andes_vector.h sifive_vector.h hlsl.h \
  msa.h velintrin* s390intrin.h
rm -rf "$src/usr-trimmed/share/libc++"

cd "$src/npmjs"
npx yowasp-pack-resources gen/llvm-resources.js gen ../usr-trimmed usr
npm run build

out="$here/gen"
rm -rf "$out" && mkdir -p "$out"
cat "$here/fetch-brotli.js" gen/bundle.js > "$out/bundle.js"
sed -i \
  -e 's#fetch3(new URL("./llvm.core.wasm", import.meta.url))#fetchBrotli(new URL("./llvm.core.wasm.br", import.meta.url), fetch3)#' \
  -e 's#fetch3(new URL("./llvm-resources.tar", import.meta.url))#fetchBrotli(new URL("./llvm-resources.tar.br", import.meta.url), fetch3)#' \
  "$out/bundle.js"
[ "$(grep -c 'fetchBrotli(new URL' "$out/bundle.js")" = 2 ] || { echo "bundle patch did not apply" >&2; exit 1; }
cp gen/llvm.core2.wasm gen/llvm.core3.wasm gen/llvm.core4.wasm "$out/"
brotli -q 11 -w 24 -c gen/llvm.core.wasm > "$out/llvm.core.wasm.br"
brotli -q 11 -w 24 -c gen/llvm-resources.tar > "$out/llvm-resources.tar.br"
cp "$decoder/brotli_dec_wasm.js" "$decoder/brotli_dec_wasm_bg.wasm" "$out/"
ls -l "$out"
