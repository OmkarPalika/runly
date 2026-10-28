/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs inside a classic Web Worker created by the sandbox frame (module
// workers cannot start from a blob URL in an opaque-origin frame). This function
// is serialized with Function.prototype.toString, so it must not reference
// anything outside its own body.
//
// A worker serves one engine. It loads the engine's runtime once and keeps it
// for later runs; each run still gets fresh program state (a new interpreter,
// VM, database or module instance), so runs can't see each other.

export function workerMain(): void {
  const scope = self as any
  let current = ""
  const post = (msg: Record<string, unknown>) => scope.postMessage({ ...msg, id: current })
  const write = (stream: "stdout" | "stderr") => (text: string) => post({ type: "output", stream, text })
  const stdout = write("stdout")
  const stderr = write("stderr")

  const format = (value: unknown): string => {
    if (typeof value === "string") return value
    if (value instanceof Error) return value.stack ?? String(value)
    try {
      const json = JSON.stringify(value)
      return json === undefined ? String(value) : json
    } catch {
      return String(value)
    }
  }

  // Python errors already carry a formatted traceback in their message.
  const errorText = (err: unknown): string => {
    if (!(err instanceof Error)) return String(err)
    return err.name === "PythonError" ? err.message : `${err.name}: ${err.message}`
  }

  const pythonStdin = (input: string) =>
    [
      "_runly_lines = iter(" + JSON.stringify(input.split("\n")) + ")",
      "def input(prompt=''):",
      "    try:",
      "        return next(_runly_lines)",
      "    except StopIteration:",
      "        raise EOFError('EOF when reading a line')",
    ].join("\n")

  // User code and some runtimes print through console.
  const line = (stream: (t: string) => void) => (...args: unknown[]) =>
    stream(args.map(format).join(" ") + "\n")
  scope.console = {
    ...scope.console,
    log: line(stdout),
    info: line(stdout),
    debug: line(stdout),
    warn: line(stderr),
    error: line(stderr),
  }

  // Load something once per worker. A failed load is forgotten so the next
  // run can retry it.
  const cache: Record<string, Promise<any>> = {}
  const once = (key: string, load: () => Promise<any>): Promise<any> =>
    (cache[key] ??= load().catch((err) => {
      delete cache[key]
      throw err
    }))

  const fetchBytes = async (url: string) => new Int8Array(await (await fetch(url)).arrayBuffer())

  const decoderFor = (stream: (t: string) => void) => {
    const decoder = new TextDecoder()
    return (b: Uint8Array | null) => {
      if (b) stream(decoder.decode(b, { stream: true }))
    }
  }

  const runJavaScript = async (code: string, input: string) => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    post({ type: "ready" })
    await new AsyncFunction("stdin", code)(input)
  }

  const formatTable = (columns: string[], rows: unknown[][]): string => {
    const cells = [columns, ...rows.map((r) => r.map((v) => (v === null ? "NULL" : String(v))))]
    const widths = columns.map((_, i) => Math.max(...cells.map((r) => String(r[i]).length)))
    const fmt = (r: unknown[]) => r.map((v, i) => String(v).padEnd(widths[i])).join(" | ").trimEnd()
    return [fmt(cells[0]), widths.map((w) => "-".repeat(w)).join("-+-"), ...cells.slice(1).map(fmt)].join("\n")
  }

  // Run a WASI command with stdin, streamed stdout/stderr and an in-memory
  // working directory mounted at /w. Returns the exit code.
  const runWasi = async (
    job: any,
    module: WebAssembly.Module,
    args: string[],
    files: Record<string, string | Uint8Array>,
  ): Promise<number> => {
    const shim = await once("wasi", () => import(job.runtimes.wasi))
    const encoder = new TextEncoder()
    const dir = new Map(
      Object.entries(files).map(([name, data]) => [
        name,
        new shim.File(typeof data === "string" ? encoder.encode(data) : data),
      ]),
    )
    const wasi = new shim.WASI(
      args,
      [],
      [
        new shim.OpenFile(new shim.File(encoder.encode(job.stdin))),
        new shim.ConsoleStdout(decoderFor(stdout)),
        new shim.ConsoleStdout(decoderFor(stderr)),
        new shim.PreopenDirectory("/w", dir),
      ],
      { debug: false },
    )
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport })
    post({ type: "ready" })
    return wasi.start(instance)
  }

  // The engine table. `load` fetches and initialises the runtime (cached per
  // worker); `run` executes one job with it.
  const loaders: Record<string, (job: any) => Promise<any>> = {
    typescript: (job) => once("sucrase", () => import(job.runtimes.sucrase)),

    micropython: (job) =>
      once("micropython", async () => (await import(job.runtimes.micropython + "micropython.mjs")).loadMicroPython),

    pyodide: (job) =>
      once("pyodide", async () => {
        const { loadPyodide } = await import(job.runtimes.pyodide + "pyodide.mjs")
        return loadPyodide({ indexURL: job.runtimes.pyodide })
      }),

    sql: (job) =>
      once("sql", async () => {
        const source = await (await fetch(job.runtimes.sqljs + "sql-wasm.js")).text()
        // sql-wasm.js is a UMD script; evaluated at global scope it defines initSqlJs.
        ;(0, eval)(source)
        return scope.initSqlJs({ locateFile: (file: string) => job.runtimes.sqljs + file })
      }),

    c: (job) => loaders.cpp(job),

    cpp: (job) =>
      once("clang", async () => {
        const toolchain = await import(job.runtimes.clang + "gen/bundle.js")
        await once("wasi", () => import(job.runtimes.wasi))
        return toolchain.runClang
      }),

    go: (job) =>
      once("go", async () => {
        await once("wasi", () => import(job.runtimes.wasi))
        return WebAssembly.compileStreaming(fetch(job.runtimes.go + "yaegi.wasm"))
      }),

    java: (job) =>
      once("java", async () => {
        const base = job.runtimes.java
        const { load } = await import(base + "compiler.wasm-runtime.js")
        const [lib, sdk, classlib] = await Promise.all([
          load(base + "compiler.wasm"),
          fetchBytes(base + "compile-classlib-teavm.bin"),
          fetchBytes(base + "runtime-classlib-teavm.bin"),
        ])
        const compiler = lib.exports.createCompiler()
        compiler.setSdk(sdk)
        compiler.setTeaVMClasslib(classlib)
        // Listeners can't be removed, so one listener reports to whichever
        // run is current (stderr posts with the current run's id).
        compiler.onDiagnostic((d: any) => {
          if (d.severity === "error" || d.severity === "warning") {
            const where = d.fileName ? `${d.fileName}:${d.lineNumber}: ` : ""
            stderr(`${where}${d.severity}: ${d.message}\n`)
          }
        })
        return { load, compiler }
      }),

    ruby: (job) =>
      once("ruby", async () => {
        scope.importScripts(job.runtimes.rubyjs + "dist/browser.umd.js")
        return WebAssembly.compileStreaming(fetch(job.runtimes.ruby + "dist/ruby+stdlib.wasm"))
      }),
  }

  const compileC = async (job: any, driver: "clang" | "clang++", source: string): Promise<number> => {
    const runClang = await loaders.cpp(job)
    let files: Record<string, Uint8Array>
    // The toolchain logs download progress with console.log, which would end
    // up in stdout. Silence it while compiling.
    const log = scope.console.log
    scope.console.log = () => {}
    try {
      // The WASI libc++ is built without exception support.
      const flags = driver === "clang++" ? ["-fno-exceptions"] : []
      files = await runClang([driver, source, "-O1", ...flags, "-o", "main.wasm"], { [source]: job.code }, {
        stdout: decoderFor(stdout),
        stderr: decoderFor(stderr),
      })
    } catch (err: any) {
      // Compile errors have already been written to stderr.
      if (typeof err?.code === "number") return err.code || 1
      throw err
    } finally {
      scope.console.log = log
    }
    const module = await WebAssembly.compile(files["main.wasm"] as BufferSource)
    return runWasi(job, module, ["main"], {})
  }

  // Single-quoted Ruby literal: only backslash and quote need escaping.
  const rubyString = (text: string) => `'${text.replace(/[\\']/g, (c) => "\\" + c)}'`

  const engines: Record<string, (job: any) => Promise<number | void>> = {
    javascript: (job) => runJavaScript(job.code, job.stdin),

    typescript: async (job) => {
      const { transform } = await loaders.typescript(job)
      const js = transform(job.code, { transforms: ["typescript"], disableESTransforms: true }).code
      await runJavaScript(js, job.stdin)
    },

    micropython: async (job) => {
      const loadMicroPython = await loaders.micropython(job)
      // A new interpreter per run keeps globals from leaking between runs.
      const mp = await loadMicroPython({
        url: job.runtimes.micropython + "micropython.wasm",
        // Unbuffered output arrives as raw bytes.
        linebuffer: false,
        stdout: decoderFor(stdout),
        stderr: decoderFor(stderr),
      })
      mp.runPython(pythonStdin(job.stdin))
      post({ type: "ready" })
      await mp.runPythonAsync(job.code)
    },

    pyodide: async (job) => {
      const py = await loaders.pyodide(job)
      py.setStdout({ batched: (t: string) => stdout(t + "\n") })
      py.setStderr({ batched: (t: string) => stderr(t + "\n") })
      await py.loadPackagesFromImports(job.code)
      // Fresh globals per run; imported modules stay cached in sys.modules.
      const globals = py.globals.get("dict")()
      try {
        py.runPython(pythonStdin(job.stdin), { globals })
        post({ type: "ready" })
        await py.runPythonAsync(job.code, { globals })
      } finally {
        globals.destroy()
      }
    },

    sql: async (job) => {
      const SQL = await loaders.sql(job)
      const db = new SQL.Database()
      post({ type: "ready" })
      try {
        const results = db.exec(job.code) as { columns: string[]; values: unknown[][] }[]
        stdout(results.map((r) => formatTable(r.columns, r.values)).join("\n\n") + (results.length ? "\n" : ""))
      } finally {
        db.close()
      }
    },

    c: (job) => compileC(job, "clang", "main.c"),

    cpp: (job) => compileC(job, "clang++", "main.cpp"),

    go: async (job) => {
      const module = await loaders.go(job)
      return runWasi(job, module, ["yaegi", "run", "/w/main.go"], { "main.go": job.code })
    },

    java: async (job) => {
      const { load, compiler } = await loaders.java(job)
      compiler.clearSourceFiles()
      compiler.clearOutputFiles()
      // javac requires a public class to live in a file of the same name.
      const name = /public\s+(?:(?:final|abstract)\s+)*class\s+(\w+)/.exec(job.code)?.[1] ?? "Main"
      compiler.addSourceFile(`${name}.java`, job.code)
      if (!compiler.compile()) return 1
      const mainClass = compiler.detectMainClasses()[0]
      if (!mainClass) {
        stderr("No class with a main method was found\n")
        return 1
      }
      if (!compiler.generateWebAssembly({ outputName: "app", mainClass })) return 1
      const app = await load(compiler.getWebAssemblyOutputFile("app.wasm"))
      post({ type: "ready" })
      app.exports.main([])
    },

    ruby: async (job) => {
      const module = await loaders.ruby(job)
      // ruby.wasm writes raw stdout/stderr text through console.log/warn.
      scope.console.log = stdout
      scope.console.warn = stderr
      // A new VM per run; the compiled module is reused.
      const { vm } = await scope["ruby-wasm-wasi"].DefaultRubyVM(module)
      vm.eval(`require "stringio"; $stdin = StringIO.new(${rubyString(job.stdin)})`)
      post({ type: "ready" })
      vm.eval(job.code)
    },
  }

  scope.onmessage = async (event: MessageEvent) => {
    const msg = event.data
    if (msg.type === "preload") {
      // Load in the background; a failure surfaces on the next real run.
      loaders[msg.engine]?.(msg).catch(() => {})
      return
    }
    current = msg.id
    try {
      const exitCode = await engines[msg.engine](msg)
      post({ type: "done", exitCode: exitCode ?? 0 })
    } catch (err) {
      stderr(errorText(err).replace(/\n?$/, "\n"))
      post({ type: "done", exitCode: 1 })
    }
  }
}
