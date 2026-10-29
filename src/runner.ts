import { frameMain } from "./frame.js"
import { normalizeLanguage, selectEngine, type CMode, type Engine, type PythonMode, type RubyMode } from "./languages.js"
import { VERSION } from "./version.js"
import { workerMain } from "./worker.js"

/** Base URLs the sandbox loads runtimes from. Point these at your own copies to self-host. */
export interface RuntimeUrls {
  /** ES module URL exporting `transform` (sucrase). A single-file build ships in this package. */
  sucrase: string
  /** Directory containing micropython.mjs and micropython.wasm. */
  micropython: string
  /** Directory containing pyodide.mjs and its assets. */
  pyodide: string
  /** Directory containing sql-wasm.js and sql-wasm.wasm. */
  sqljs: string
  /** ES module URL of PGlite (a single-file build ships in this package). Used for Postgres. */
  pglitejs: string
  /** Root of the @electric-sql/pglite package (dist/pglite.wasm, dist/initdb.wasm, dist/pglite.data). */
  pglite: string
  /** ES module URL of browser_wasi_shim (a single-file build ships in this package). Used for C, C++ and Go. */
  wasi: string
  /** ES module URL of the xcc C compiler glue (a single-file build ships in this package). */
  xccjs: string
  /** Root of the @basthon/xcc-wasm package (build/cc.wasm, build/runtime.wasm). */
  xcc: string
  /** Root of the @browserrun/clang package (gen/bundle.js and its assets). */
  clang: string
  /** Directory containing yaegi.wasm (the @browserrun/go package). */
  go: string
  /** Directory containing the TeaVM javac build (the @browserrun/java package). */
  java: string
  /** ES module URL of the mruby glue (a single-file build ships in this package). */
  mrubyjs: string
  /** Root of the @takahashim/mruby-wasm-js package (mruby-js.wasm). */
  mruby: string
  /** Root of the @ruby/wasm-wasi package (dist/browser.umd.js). */
  rubyjs: string
  /** Root of a Ruby build package (dist/ruby+stdlib.wasm). */
  ruby: string
}

export const DEFAULT_RUNTIMES: RuntimeUrls = {
  sucrase: `https://cdn.jsdelivr.net/npm/@browserrun/sandrun@${VERSION}/dist/runtimes/sucrase.js`,
  micropython: "https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.29.0-6/",
  pyodide: "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/",
  sqljs: "https://cdn.jsdelivr.net/npm/sql.js@1.15.2/dist/",
  pglitejs: `https://cdn.jsdelivr.net/npm/@browserrun/sandrun@${VERSION}/dist/runtimes/pglite.js`,
  pglite: "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.13/",
  wasi: `https://cdn.jsdelivr.net/npm/@browserrun/sandrun@${VERSION}/dist/runtimes/wasi.js`,
  xccjs: `https://cdn.jsdelivr.net/npm/@browserrun/sandrun@${VERSION}/dist/runtimes/xcc.js`,
  xcc: "https://cdn.jsdelivr.net/npm/@basthon/xcc-wasm@0.1.0/",
  clang: "https://cdn.jsdelivr.net/npm/@browserrun/clang@0.1.1/",
  go: "https://cdn.jsdelivr.net/npm/@browserrun/go@0.1.0/",
  java: "https://cdn.jsdelivr.net/npm/@browserrun/java@0.1.0/",
  mrubyjs: `https://cdn.jsdelivr.net/npm/@browserrun/sandrun@${VERSION}/dist/runtimes/mruby.js`,
  mruby: "https://cdn.jsdelivr.net/npm/@takahashim/mruby-wasm-js@0.2.0/",
  rubyjs: "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/",
  ruby: "https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.10.1/",
}

export interface RunnerOptions {
  /** Max time for the code itself, after the runtime has loaded. Default 10 000 ms. */
  timeoutMs?: number
  /** Max time to download and start a runtime, including compilation. Default 120 000 ms. */
  loadTimeoutMs?: number
  /** Output beyond this many characters is dropped and the run stopped. Default 65 536. */
  maxOutputBytes?: number
  /** Which Python engine to use. "auto" picks MicroPython unless the code imports more. */
  python?: PythonMode
  /** Which C compiler to use. "xcc" (default, ~0.4 MB) or "clang" (~14 MB download, closer to GCC/Clang behaviour). */
  c?: CMode
  /** Which Ruby to use. "auto" picks mruby (~1 MB) unless the code calls `require`; "cruby" is full Ruby 3.4. */
  ruby?: RubyMode
  /** Override where runtimes are loaded from. */
  runtimes?: Partial<RuntimeUrls>
  /**
   * Called while a runtime downloads, from a run or a preload. `loaded` and
   * `total` are bytes summed over the engine's files; `total` is 0 when the
   * server doesn't send sizes.
   */
  onProgress?: (progress: Progress) => void
  /** Element the hidden sandbox iframe is attached to. Default document.body. */
  container?: HTMLElement
}

export interface Progress {
  engine: Engine
  loaded: number
  total: number
}

export interface SourceFile {
  name: string
  content: string
}

export interface RunRequest {
  language: string
  /** The program. Optional when `files` is given. */
  code?: string
  /**
   * Several files run together; the first is the entry point. The others can be
   * imported or included by name (`import helper`, `#include "util.h"`,
   * `require_relative "lib"`, `import "./lib.js"`). SQL runs every file in order.
   */
  files?: SourceFile[]
  stdin?: string
  /** Called with each chunk of output as it is produced. */
  onOutput?: (stream: "stdout" | "stderr", text: string) => void
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  truncated: boolean
  durationMs: number
  engine: Engine
  /** Set when the run could not start or the runtime failed to load. */
  error?: string
}

export interface Runner {
  run(request: RunRequest): Promise<RunResult>
  /**
   * Start downloading and initialising a language's runtime in the background,
   * e.g. when a code block scrolls into view, so the first run is fast. Pass
   * the code to pick the right Python engine.
   */
  preload(language: string, code?: string): void
  /** Remove the sandbox iframe and cancel pending runs. */
  dispose(): void
}

interface Pending {
  engine: Engine
  stdout: string
  stderr: string
  onOutput?: RunRequest["onOutput"]
  resolve: (result: RunResult) => void
}

function originOf(url: string): string {
  return new URL(url).origin
}

function buildFrameDocument(runtimes: RuntimeUrls): string {
  const origins = [...new Set(Object.values(runtimes).map(originOf))].join(" ")
  // 'unsafe-eval' covers user JavaScript and WebAssembly compilation; network
  // access is limited to the runtime hosts.
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: ${origins}`,
    "worker-src blob:",
    `connect-src ${origins}`,
  ].join("; ")
  const workerSource = `(${workerMain.toString()})()`
  const script = `(${frameMain.toString()})(${JSON.stringify(workerSource).replace(/</g, "\\u003c")})`
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>${script}</script>`
}

/** Create a runner. The sandbox iframe is created lazily on the first run. */
export function createRunner(options: RunnerOptions = {}): Runner {
  const runtimes: RuntimeUrls = { ...DEFAULT_RUNTIMES, ...options.runtimes }
  const pending = new Map<string, Pending>()
  let frame: HTMLIFrameElement | null = null
  let ready: Promise<void> | null = null
  let nextId = 0

  const downloads = new Map<string, Map<string, { loaded: number; total: number }>>()

  const onMessage = (event: MessageEvent) => {
    if (!frame || event.source !== frame.contentWindow) return
    const msg = event.data
    if (msg?.type === "progress") {
      const files = downloads.get(msg.engine) ?? new Map()
      downloads.set(msg.engine, files)
      files.set(msg.url, { loaded: msg.loaded, total: msg.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      options.onProgress?.({ engine: msg.engine, loaded, total })
      return
    }
    const run = pending.get(msg?.id)
    if (!run) return
    if (msg.type === "output") {
      run[msg.stream as "stdout" | "stderr"] += msg.text
      run.onOutput?.(msg.stream, msg.text)
    } else if (msg.type === "done") {
      pending.delete(msg.id)
      run.resolve({
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: msg.exitCode,
        timedOut: msg.timedOut,
        truncated: msg.truncated,
        durationMs: msg.durationMs,
        engine: run.engine,
        ...(msg.error ? { error: msg.error } : {}),
      })
    }
  }

  const ensureFrame = (): Promise<void> => {
    if (ready) return ready
    ready = new Promise((resolve) => {
      const el = document.createElement("iframe")
      el.setAttribute("sandbox", "allow-scripts")
      el.setAttribute("aria-hidden", "true")
      el.tabIndex = -1
      el.style.display = "none"
      const onReady = (event: MessageEvent) => {
        if (event.source === el.contentWindow && event.data?.type === "frame-ready") {
          window.removeEventListener("message", onReady)
          resolve()
        }
      }
      window.addEventListener("message", onReady)
      window.addEventListener("message", onMessage)
      el.srcdoc = buildFrameDocument(runtimes)
      ;(options.container ?? document.body).appendChild(el)
      frame = el
    })
    return ready
  }

  return {
    async run(request) {
      const language = normalizeLanguage(request.language)
      if (!language) throw new Error(`Unsupported language: ${request.language}`)
      const files: SourceFile[] = request.files?.length
        ? request.files
        : [{ name: "", content: request.code ?? "" }]
      const names = files.map((f) => f.name)
      const engine = selectEngine(language, files.map((f) => f.content).join("\n"), options, names)
      await ensureFrame()
      const id = String(nextId++)
      return new Promise<RunResult>((resolve) => {
        pending.set(id, { engine, stdout: "", stderr: "", onOutput: request.onOutput, resolve })
        frame!.contentWindow!.postMessage(
          {
            type: "run",
            id,
            engine,
            code: files[0].content,
            files,
            stdin: request.stdin ?? "",
            runtimes,
            timeoutMs: options.timeoutMs ?? 10_000,
            loadTimeoutMs: options.loadTimeoutMs ?? 120_000,
            maxOutputBytes: options.maxOutputBytes ?? 65_536,
          },
          "*",
        )
      })
    },

    preload(language, code = "") {
      const lang = normalizeLanguage(language)
      if (!lang) return
      const engine = selectEngine(lang, code, options)
      ensureFrame().then(() => frame?.contentWindow?.postMessage({ type: "preload", engine, runtimes }, "*"))
    },

    dispose() {
      window.removeEventListener("message", onMessage)
      frame?.remove()
      frame = null
      ready = null
      for (const [id, run] of pending) {
        pending.delete(id)
        run.resolve({
          stdout: run.stdout,
          stderr: run.stderr,
          exitCode: 1,
          timedOut: false,
          truncated: false,
          durationMs: 0,
          engine: run.engine,
          error: "Runner disposed",
        })
      }
    },
  }
}
