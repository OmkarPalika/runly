# Benchmark results

sandrun 0.1.0 against [Runno](https://github.com/taybenlor/runno) `@runno/runtime`
0.10.0, on the languages both support, plus sandrun-only languages for reference.

- **Cold run**: first run on a fresh page with an empty browser cache
  (download, start-up and execution).
- **Warm run**: second run on the same page.
- **After reload**: first run after reloading the page, with files in the HTTP cache.

Each program sums the integers below 1,000,000 (except SQL and TypeScript,
which are trivial) and prints the result. Chromium (Playwright), Windows,
home broadband, single measurement per cell, 2026-10-28. Treat differences
under ~20% as noise. Reproduce with `node bench/server.js & node bench/run.mjs`.

| Language | Tool | Cold run | Warm run | After reload | Correct output |
|---|---|---|---|---|---|
| JavaScript | sandrun | 31 ms | 11 ms | 19 ms | yes |
| JavaScript | Runno (QuickJS) | 1.03 s | 217 ms | 225 ms | yes |
| Python | sandrun (MicroPython) | 1.25 s | 1.03 s | 1.03 s | yes |
| Python | Runno (CPython) | 3.15 s | 2.59 s | 1.92 s | yes |
| SQL | sandrun (sql.js) | 279 ms | 4 ms | 71 ms | yes |
| SQL | Runno (sqlite) | did not finish in 180 s | | | no |
| C | sandrun (xcc, default) | 147 ms | 12 ms | 55 ms | yes |
| C | sandrun (Clang, `c: "clang"`) | 3.07 s | 101 ms | 2.33 s | yes |
| C | Runno (Clang) | 3.34 s | 1.76 s | 1.88 s | yes |
| C++ | sandrun (Clang) | 4.85 s | 2.32 s | 5.00 s | yes |
| C++ | Runno (Clang) | 6.24 s | 4.17 s | 4.37 s | yes |
| Ruby | sandrun (mruby, default) | 648 ms | 412 ms | 644 ms | yes |
| Ruby | sandrun (CRuby, with `require`) | 1.50 s | 280 ms | 1.27 s | yes |
| Ruby | Runno | 2.90 s | 694 ms | 790 ms | yes |
| TypeScript | sandrun | 63 ms | 34 ms | 43 ms | yes |
| Go | sandrun (yaegi) | 1.16 s | 418 ms | 1.01 s | yes |
| Java | sandrun (teavm-javac) | 1.43 s | 666 ms | 1.49 s | yes |

## Reading the numbers

- sandrun is faster on warm runs in every shared language, because it keeps each
  runtime loaded between runs.
- sandrun is faster on cold runs for JavaScript, Python, SQL, C and Ruby. For C,
  the default xcc compiler (~0.4 MB) makes the first run about 20× faster than
  with Clang. C++ rows are medians of five rounds (Runno's first runs ranged
  from 4.4 s to 34 s). sandrun compiles C++ about twice as fast once Clang is
  loaded, mainly by leaving out headers libc++ includes only for
  compatibility; Runno is slightly faster on the first compile after a reload,
  when the browser is still compiling Clang's own code.
- mruby starts faster than CRuby but runs this CPU-bound loop more slowly
  (412 ms against 280 ms warm), so the default trades peak speed for a 1 MB
  download.
- Python here measures a CPU-bound loop. MicroPython is a smaller, slower
  interpreter than CPython; for heavier numeric code sandrun switches to
  Pyodide (CPython), which this table doesn't exercise.
- The Runno SQLite run may be a setup problem on our side rather than a Runno
  bug; we used `headlessRunCode("sqlite", code)` as documented.
- Download sizes aren't reported: the browser doesn't expose requests made
  from workers inside a sandboxed frame reliably.
