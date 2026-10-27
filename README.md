# runbox

Run JavaScript, TypeScript, Python and SQL in the browser. No server, no API keys.

Code runs in a sandboxed iframe with an opaque origin, inside a Web Worker that
is thrown away after every run. It can't see the host page, its cookies or its
storage, and it can only make network requests to the hosts the runtimes load from.

```js
import { createRunner } from "@omkarpalika/runbox"

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
npm install @omkarpalika/runbox
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

Language names are case-insensitive and accept common aliases (`js`, `ts`, `py`,
`sqlite`, ...).

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
| `loadTimeoutMs` | `60000` | Limit for downloading and starting a runtime. |
| `maxOutputBytes` | `65536` | The run is stopped once output reaches this many characters. |
| `python` | `"auto"` | `"auto"`, `"micropython"` or `"pyodide"`. |
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
  error?: string       // the run could not start, or the runtime failed to load
}
```

`onOutput(stream, text)` receives output as it arrives, for live consoles.
Errors in the user's code don't reject; they show up in `stderr` with
`exitCode: 1`. An unsupported language rejects.

`stdin` is passed in up front. In Python, `input()` reads it line by line; in
JavaScript and TypeScript it's available as the `stdin` string.

### `runner.dispose()`

Removes the iframe and resolves any pending runs with `error: "Runner disposed"`.

### Helpers

- `normalizeLanguage(name)` returns a supported language or `null`. Use it to
  decide whether to show a Run button.
- `selectEngine(language, code, python?)` returns the engine a run would use.
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
    sucrase: "https://static.example.com/runbox/sucrase.js",
    micropython: "https://static.example.com/micropython/",
    pyodide: "https://static.example.com/pyodide/",
    sqljs: "https://static.example.com/sql.js/",
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
- Each run starts a fresh worker and terminates it afterwards. Timeouts and the
  output cap stop runaway code.
- The code still runs on the visitor's machine and can use their CPU until the
  timeout fires. Keep `timeoutMs` reasonable.

## How it compares

runbox is for one job: running short snippets inside a page (docs, blog posts,
tutorials) without running a server. Other projects solve neighbouring problems
and are often a better fit:

| | Where code runs | Server needed | Languages | Best for |
|---|---|---|---|---|
| **runbox** | Visitor's browser | No | JS, TS, Python, SQL | Embedding runnable snippets with a small API |
| [Piston](https://github.com/engineer-man/piston) | Your server (Docker) | Yes | Dozens, including compiled ones | Many languages, if you can run and secure a server |
| [Judge0](https://github.com/judge0/judge0) | Your server or hosted API | Yes | Dozens | Online judges and grading, with limits per submission |
| [Runno](https://github.com/taybenlor/runno) | Visitor's browser (WASI) | No | Python, Ruby, JS, C/C++, PHP, SQLite | Ready-made web components with a terminal UI |
| [LiveCodes](https://github.com/live-codes/livecodes) | Visitor's browser | No | Many web and compile-to-JS languages | A full in-page playground with an editor |
| [Sandpack](https://github.com/codesandbox/sandpack) | Browser bundler (+ CodeSandbox services) | Partly | Front-end JS frameworks | Live React/Vue previews |
| [JupyterLite](https://github.com/jupyterlite/jupyterlite) | Visitor's browser | No | Python and other kernels | Whole notebooks, not inline snippets |
| [WebContainers](https://webcontainers.io) | Visitor's browser | No | Node.js | Running Node projects; commercial use needs a licence |

What runbox does differently:

- **Smallest download that works.** Plain Python runs on MicroPython (~300 KB)
  and only switches to Pyodide when the code needs it. JavaScript needs no
  download at all.
- **No UI.** It returns `stdout`, `stderr` and an exit code, so it fits your
  own editor and styling.
- **A fresh worker per run**, terminated afterwards. Memory is released, and
  timeouts actually stop the code.
- **Output caching** built in through `snapshotKey`, so unchanged code doesn't
  need a runtime at all.

If you need compiled languages such as C, Rust, Go or Java today, use Piston or
Judge0 on a server, or Runno for C/C++ in the browser.

## Browser support

Tested on current Chromium, Firefox and WebKit.

## Development

```sh
npm install
npm test                          # build + unit tests
npx playwright install
npm run test:e2e                  # browser tests (needs network for the CDN runtimes)
```

## License

MIT. Runtimes loaded at run time are covered by their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
