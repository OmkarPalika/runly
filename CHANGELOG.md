# Changelog

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
