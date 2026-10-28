#!/bin/sh
# Builds a size-trimmed Clang/LLD for WebAssembly, based on YoWASP's build.
# Runs inside an ubuntu:24.04 container with this directory mounted at /work.
set -ex
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-pip ninja-build ccache python3 python-is-python3 git curl ca-certificates xz-utils nodejs npm binaryen >/dev/null
pip install -q --break-system-packages "cmake>=3.31"
cmake --version
export CMAKE_GENERATOR=Ninja
[ -d /build/src ] || cp -r /work/src /build/src
cd /build/src
# The checkout came from Windows; scripts need LF line endings.
for f in build.sh package-npmjs.sh Get-LLVM-Version.cmake npmjs/prepare.py; do tr -d '' < "$f" > "$f.lf" && mv "$f.lf" "$f"; done; chmod +x build.sh package-npmjs.sh
# The commit behind @yowasp/clang 22.0.0-git20542-10. The later LLVM 22.1.0
# commit moved to WASI SDK 29, whose Clang fails to write large output files.
git config --global --add safe.directory '*'
git fetch -q /work/src 2ef17b392c97008b0e5116f8b1584b0c32809c2a
git checkout -q -f 2ef17b392c97008b0e5116f8b1584b0c32809c2a
git submodule update --init --depth 1 --jobs 3

# Size changes on top of YoWASP's configuration:
#  - assertions off
#  - drop every LLVM tool except clang and lld from the multicall binary
#  - one link job at a time (LTO links of LLVM are memory hungry)
sed -i \
  -e 's/-DLLVM_ENABLE_ASSERTIONS=ON/-DLLVM_ENABLE_ASSERTIONS=OFF -DLLVM_PARALLEL_LINK_JOBS=1/' \
  -e 's/-DLLVM_TOOL_LLVM_AR_BUILD=ON/-DLLVM_TOOL_LLVM_AR_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_CXXFILT_BUILD=ON/-DLLVM_TOOL_LLVM_CXXFILT_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_DWARFDUMP_BUILD=ON/-DLLVM_TOOL_LLVM_DWARFDUMP_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_NM_BUILD=ON/-DLLVM_TOOL_LLVM_NM_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_OBJCOPY_BUILD=ON/-DLLVM_TOOL_LLVM_OBJCOPY_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_OBJDUMP_BUILD=ON/-DLLVM_TOOL_LLVM_OBJDUMP_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_READOBJ_BUILD=ON/-DLLVM_TOOL_LLVM_READOBJ_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_SIZE_BUILD=ON/-DLLVM_TOOL_LLVM_SIZE_BUILD=OFF/' \
  -e 's/-DLLVM_TOOL_LLVM_SYMBOLIZER_BUILD=ON/-DLLVM_TOOL_LLVM_SYMBOLIZER_BUILD=OFF/' \
  build.sh
grep -c "BUILD=ON" build.sh || true
./build.sh

ls -la llvm-build/bin/
mkdir -p /work/out
cp llvm-build/bin/llvm /work/out/llvm.wasm
echo BUILD-DONE
