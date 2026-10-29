# Changelog

## 0.4.0

- Postgres: `language: "postgres"` (also `postgresql`, `pg`) runs real
  PostgreSQL via PGlite, with PL/pgSQL functions, enums and notices. Each run
  starts from an empty database.

## 0.3.0

- `files` runs several files together: Python modules, JavaScript and
  TypeScript imports, C and C++ sources and headers, Go packages, Java classes,
  Ruby `require_relative` and SQL scripts.
- `onProgress` reports runtime download progress.
- Pyodide now loads from Pyodide's own CDN path, so packages such as numpy
  install. The npm copy doesn't include package wheels.

## 0.1.0

First release.

- JavaScript, TypeScript, Python (MicroPython or Pyodide), SQL (sql.js),
  C (xcc, or Clang), C++ (Clang to WASI), Go (yaegi), Java (teavm-javac) and
  Ruby (mruby, or CRuby via ruby.wasm when the code uses `require`).
- Sandboxed iframe with an opaque origin. One warm worker per language keeps
  its runtime loaded; every run gets fresh program state.
- `runner.preload()` to warm a runtime before the first run.
- Run timeouts, load timeouts and an output cap.
- Streaming output, stdin, and `snapshotKey` for caching results.
