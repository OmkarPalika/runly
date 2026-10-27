import { frameMain } from "./frame.js"
import { normalizeLanguage, selectEngine, type Engine, type PythonMode } from "./languages.js"
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
}

export const DEFAULT_RUNTIMES: RuntimeUrls = {
  sucrase: `https://cdn.jsdelivr.net/npm/@omkarpalika/runbox@${VERSION}/dist/runtimes/sucrase.js`,
  micropython: "https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.29.0-6/",
  pyodide: "https://cdn.jsdelivr.net/npm/pyodide@314.0.7/",
  sqljs: "https://cdn.jsdelivr.net/npm/sql.js@1.15.2/dist/",
}

export interface RunnerOptions {
  /** Max time for the code itself, after the runtime has loaded. Default 10 000 ms. */
  timeoutMs?: number
  /** Max time to download and start a runtime. Default 60 000 ms. */
  loadTimeoutMs?: number
  /** Output beyond this many characters is dropped and the run stopped. Default 65 536. */
  maxOutputBytes?: number
  /** Which Python engine to use. "auto" picks MicroPython unless the code imports more. */
  python?: PythonMode
  /** Override where runtimes are loaded from. */
  runtimes?: Partial<RuntimeUrls>
  /** Element the hidden sandbox iframe is attached to. Default document.body. */
  container?: HTMLElement
}

export interface RunRequest {
  language: string
  code: string
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

  const onMessage = (event: MessageEvent) => {
    if (!frame || event.source !== frame.contentWindow) return
    const msg = event.data
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
      const engine = selectEngine(language, request.code, options.python)
      await ensureFrame()
      const id = String(nextId++)
      return new Promise<RunResult>((resolve) => {
        pending.set(id, { engine, stdout: "", stderr: "", onOutput: request.onOutput, resolve })
        frame!.contentWindow!.postMessage(
          {
            type: "run",
            id,
            engine,
            code: request.code,
            stdin: request.stdin ?? "",
            runtimes,
            timeoutMs: options.timeoutMs ?? 10_000,
            loadTimeoutMs: options.loadTimeoutMs ?? 60_000,
            maxOutputBytes: options.maxOutputBytes ?? 65_536,
          },
          "*",
        )
      })
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
