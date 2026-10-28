#!/usr/bin/env sh
# Builds the yaegi Go interpreter for WASI. Needs Go 1.21 or newer.
set -eu
cd "$(dirname "$0")"
YAEGI_VERSION=v0.16.1
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && go mod init build >/dev/null 2>&1 && go get "github.com/traefik/yaegi@$YAEGI_VERSION" >/dev/null 2>&1 \
  && GOOS=wasip1 GOARCH=wasm go build -trimpath -ldflags="-s -w" -o yaegi.wasm github.com/traefik/yaegi/cmd/yaegi)
mv "$tmp/yaegi.wasm" yaegi.wasm
echo "built $(wc -c < yaegi.wasm) bytes"
