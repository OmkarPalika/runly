# sandrun

Run JavaScript, TypeScript, Python, SQL, C, C++, Go, Java and Ruby in the browser.
No server, no API keys.

Code runs in a sandboxed iframe with an opaque origin, inside a Web Worker that
is thrown away after every run. It can't see the host page, its cookies or its
storage, and it can only make network requests to the hosts the runtimes load from.

```js
import { createRunner } from "@browserrun/sandrun"

const runner = createRunner()

const result = await runner.run({
  language: "python",
  code: "name = input()\nprint(f'hello {name}')",
  stdin: "ada",
})

result.stdout   // "hello ada\n"
result.exitCode // 0
```


## Install

```sh
npm install @browserrun/sandrun
```

It's a browser-only ES module. It has no dependencies; runtimes are downloaded
on first use and cached by the browser.

## Languages

| Language | Engine | First-run download |
|---|---|---|
| JavaScript | the browser's own engine | none |
| TypeScript | types stripped with Sucrase, then run as JavaScript | ~200 KB |
| Python | MicroPython | ~300 KB |
| Python with heavier imports | Pyodide (CPython) | ~10 MB, plus packages |
| SQL | sql.js (SQLite) | ~1 MB |
| Go | yaegi interpreter, built for WASI | ~40 MB (~8 MB compressed) |
| Java | OpenJDK javac and TeaVM, compiled to WebAssembly (teavm-javac) | ~7 MB |
| Ruby | mruby | ~1 MB |
| Ruby that calls `require` | ruby.wasm (CRuby 3.4 with the standard library) | ~30 MB |
| C | xcc | ~0.4 MB |
| C with `c: "clang"`, and C++ | Clang and LLD compiled to WebAssembly (YoWASP), targeting WASI | ~105 MB |

Downloads happen once per runtime, on the first run that needs it, and are then
served from the browser cache. A page that only shows Python never downloads
the C toolchain.

Language names are case-insensitive and accept common aliases (`js`, `ts`, `py`,
`sqlite`, `c++`, `golang`, `rb`, ...).

### Language notes

- **C** uses [xcc](https://github.com/tyfkda/xcc), a small C compiler that
  runs in the browser. It covers C99/C11 and the common parts of the standard
  library, and checks array bounds and `NULL` dereferences at run time. For
  full GCC/Clang compatibility pass `c: "clang"`. `main`'s return value
  becomes the exit code.
- **C++** is compiled with Clang (`-O1`, `wasm32-wasi`, `-fno-exceptions`,
  because the WASI C++ library has no exception support).
- In both, `long` is 32 bits (WebAssembly is a 32-bit target).
- **Go** is interpreted by [yaegi](https://github.com/traefik/yaegi), not
  compiled. It covers the language and most of the standard library; cgo,
  `unsafe` tricks and some reflection-heavy packages won't work.
- **Java** compiles with OpenJDK's javac, then TeaVM turns the bytecode into
  WebAssembly. Put your code in a class with a `main` method; a `public` class
  determines the file name. `System.in` isn't supported.
- **Ruby** runs on [mruby](https://mruby.org), a compact Ruby, unless the
  code calls `require`; then it runs on CRuby 3.4. Force one with
  `ruby: "mruby"` or `ruby: "cruby"`. Both read `stdin` through `gets`.

### How Python picks an engine

With the default `python: "auto"`, a snippet runs on MicroPython unless it
imports something MicroPython doesn't ship (`numpy`, `pandas`, `statistics`,
...). Those runs go to Pyodide, which also installs the imported packages it
knows about. Force one engine with `python: "micropython"` or `python: "pyodide"`.

## API

### `createRunner(options?)`

| Option | Default | |
|---|---|---|
| `timeoutMs` | `10000` | Limit for the code itself, measured after the runtime has loaded. |
| `loadTimeoutMs` | `120000` | Limit for downloading and starting a runtime (and compiling, for C, C++ and Java). |
| `maxOutputBytes` | `65536` | The run is stopped once output reaches this many characters. |
| `python` | `"auto"` | `"auto"`, `"micropython"` or `"pyodide"`. |
| `c` | `"xcc"` | `"xcc"` or `"clang"`. |
| `ruby` | `"auto"` | `"auto"`, `"mruby"` or `"cruby"`. |
| `runtimes` | jsDelivr | Override where each runtime is loaded from (see below). |
| `container` | `document.body` | Where the hidden sandbox iframe is attached. |

The iframe is created on the first `run`, not when the runner is created.

### `runner.run({ language, code, stdin?, onOutput? })`

Resolves with:

```ts
{
  stdout: string
  stderr: string
  exitCode: number     // 0 on success, 1 on an error, timeout or truncation
  timedOut: boolean
  truncated: boolean
  durationMs: number
  engine: "javascript" | "typescript" | "micropython" | "pyodide" | "sql"
        | "xcc" | "c" | "cpp" | "go" | "java" | "mruby" | "ruby"
  error?: string       // the run could not start, or the runtime failed to load
}
```

`onOutput(stream, text)` receives output as it arrives, for live consoles.
Errors in the user's code don't reject; they show up in `stderr` with
`exitCode: 1`. An unsupported language rejects.

`stdin` is passed in up front. In Python, `input()` reads it line by line; in
JavaScript and TypeScript it's available as the `stdin` string; C, C++, Go and
Ruby read it from standard input as usual. Java doesn't support it.

### `runner.preload(language, code?)`

Starts downloading and initialising a runtime in the background, so the first
Run is fast. Call it when a code block scrolls into view:

```js
new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) runner.preload(e.target.dataset.lang)
}).observe(codeBlock)
```

Pass the code for Python so the right engine (MicroPython or Pyodide) is warmed.

### `runner.dispose()`

Removes the iframe and resolves any pending runs with `error: "Runner disposed"`.

### Helpers

- `normalizeLanguage(name)` returns a supported language or `null`. Use it to
  decide whether to show a Run button.
- `selectEngine(language, code, { python, c, ruby }?)` returns the engine a run would use.
- `snapshotKey(language, code, stdin?)` returns a SHA-256 key for caching output.

## Caching output

Most readers run code exactly as it was written. Run it once when the code is
saved, store the result under `snapshotKey(...)`, and show the stored output
until someone edits the code. Then no runtime needs to load at all.

```js
const key = await snapshotKey(block.language, block.code)
const cached = await store.get(key)
const result = cached ?? (await runner.run(block))
```

## Self-hosting runtimes

By default runtimes come from jsDelivr, pinned to exact versions. To serve them
yourself, copy the files and point `runtimes` at them:

```js
createRunner({
  runtimes: {
    sucrase: "https://static.example.com/sandrun/sucrase.js",
    micropython: "https://static.example.com/micropython/",
    pyodide: "https://static.example.com/pyodide/",
    sqljs: "https://static.example.com/sql.js/",
    wasi: "https://static.example.com/sandrun/wasi.js",
    xccjs: "https://static.example.com/sandrun/xcc.js",
    xcc: "https://static.example.com/xcc-wasm/",
    mrubyjs: "https://static.example.com/sandrun/mruby.js",
    mruby: "https://static.example.com/mruby-wasm-js/",
    clang: "https://static.example.com/yowasp-clang/",
    go: "https://static.example.com/@browserrun/go/",
    java: "https://static.example.com/@browserrun/java/",
    rubyjs: "https://static.example.com/ruby-wasm-wasi/",
    ruby: "https://static.example.com/ruby-3.4-wasm-wasi/",
  },
})
```

Whatever host you use must send `Access-Control-Allow-Origin: *`, because the
sandbox has an opaque origin. The sandbox's Content Security Policy allows
network access to exactly these hosts.

## Security notes

- The iframe uses `sandbox="allow-scripts"` without `allow-same-origin`, so the
  code has no access to the host's DOM, cookies, `localStorage` or IndexedDB.
- Network access is limited by CSP to the runtime hosts.
- Each language runs in its own worker. The runtime stays loaded between runs,
  but every run gets fresh program state (a new interpreter, VM, database or
  module instance). Runs for the same language are queued.
- A run that times out or hits the output cap has its worker terminated; the
  next run starts a new one. JavaScript and TypeScript use a new worker for
  every run, since they share the worker's global scope.
- The code still runs on the visitor's machine and can use their CPU until the
  timeout fires. Keep `timeoutMs` reasonable.

## How it compares

sandrun is for one job: running short snippets inside a page (docs, blog posts,
tutorials) without running a server. Other projects solve neighbouring problems
and are often a better fit:

| | Where code runs | Server needed | Languages | Best for |
|---|---|---|---|---|
| **sandrun** | Visitor's browser | No | JS, TS, Python, SQL, C, C++, Go, Java, Ruby | Embedding runnable snippets with a small API |
| [Piston](https://github.com/engineer-man/piston) | Your server (Docker) | Yes | Dozens, including compiled ones | Many languages, if you can run and secure a server |
| [Judge0](https://github.com/judge0/judge0) | Your server or hosted API | Yes | Dozens | Online judges and grading, with limits per submission |
| [Runno](https://github.com/taybenlor/runno) | Visitor's browser (WASI) | No | Python, Ruby, JS, C/C++, PHP, SQLite | Ready-made web components with a terminal UI |
| [LiveCodes](https://github.com/live-codes/livecodes) | Visitor's browser | No | Many web and compile-to-JS languages | A full in-page playground with an editor |
| [Sandpack](https://github.com/codesandbox/sandpack) | Browser bundler (+ CodeSandbox services) | Partly | Front-end JS frameworks | Live React/Vue previews |
| [JupyterLite](https://github.com/jupyterlite/jupyterlite) | Visitor's browser | No | Python and other kernels | Whole notebooks, not inline snippets |
| [WebContainers](https://webcontainers.io) | Visitor's browser | No | Node.js | Running Node projects; commercial use needs a licence |

What sandrun does differently:

- **Smallest download that works.** Each runtime loads only when a run needs
  it. Plain Python runs on MicroPython (~300 KB) and only switches to Pyodide
  when the code needs it. JavaScript needs no download at all.
- **No UI.** It returns `stdout`, `stderr` and an exit code, so it fits your
  own editor and styling.
- **Warm runtimes, fresh state.** A language's runtime loads once per page;
  every run still starts from a clean interpreter. Timeouts terminate the
  worker, so runaway code is actually stopped.
- **`preload()`** warms a runtime before the reader presses Run.
- **Output caching** built in through `snapshotKey`, so unchanged code doesn't
  need a runtime at all.

Rust isn't supported: its compiler is too large to ship to a browser. For Rust,
or for languages sandrun doesn't cover, use Piston or Judge0 on a server.

## Benchmark

sandrun against [Runno](https://github.com/taybenlor/runno) 0.10.0 on Chromium.
Each program sums the integers below 1,000,000 and prints the result.

- **First run**: fresh page, empty browser cache (download, start-up and run).
- **Next run**: the same code again on the same page.
- **After reload**: first run after reloading the page, files in the HTTP cache.

| Language | sandrun first run | sandrun next run | sandrun after reload | Runno first run | Runno next run | Runno after reload |
|---|---|---|---|---|---|---|
| JavaScript | **31 ms** | **11 ms** | **19 ms** | 1.03 s | 217 ms | 225 ms |
| Python | **1.25 s** | **1.03 s** | **1.03 s** | 3.15 s | 2.59 s | 1.92 s |
| SQL | **279 ms** | **4 ms** | **71 ms** | did not finish | | |
| C | **147 ms** | **12 ms** | **55 ms** | 3.50 s | 1.82 s | 1.92 s |
| C++ | 6.53 s | **2.95 s** | 6.55 s | **5.41 s** | 3.65 s | **4.45 s** |
| Ruby | **648 ms** | **412 ms** | **644 ms** | 3.48 s | 901 ms | 848 ms |
| TypeScript | 63 ms | 34 ms | 43 ms | not supported | | |
| Go | 1.16 s | 418 ms | 1.01 s | not supported | | |
| Java | 1.43 s | 666 ms | 1.49 s | not supported | | |

Single measurements on one machine and connection; treat gaps under ~20% as
noise. Runno is faster for C++ on a fresh page because its Clang build is
smaller. Method, caveats and how to reproduce:
[bench/RESULTS.md](bench/RESULTS.md).

## Browser support

Tested on current Chromium, Firefox and WebKit.

## Development

```sh
npm install
npm test                          # build + unit tests
sh runtimes/go/build.sh           # build yaegi.wasm (needs Go 1.21+)
sh runtimes/java/fetch.sh         # download and verify teavm-javac
npx playwright install
npm run test:e2e                  # browser tests (needs network for the CDN runtimes)
```

The Go and Java runtimes are published as separate packages
([@browserrun/go](runtimes/go) and [@browserrun/java](runtimes/java)) so that installing
sandrun doesn't pull tens of megabytes into your `node_modules`.

## License

MIT. Runtimes loaded at run time are covered by their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
