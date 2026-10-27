/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs inside a classic Web Worker created by the sandbox frame (module
// workers cannot start from a blob URL in an opaque-origin frame). This function
// is serialized with Function.prototype.toString, so it must not reference
// anything outside its own body.

export function workerMain(): void {
  const scope = self as any
  const post = (msg: unknown) => scope.postMessage(msg)
  const write = (stream: "stdout" | "stderr") => (text: string) =>
    post({ type: "output", stream, text })
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
      "_runbox_lines = iter(" + JSON.stringify(input.split("\n")) + ")",
      "def input(prompt=''):",
      "    try:",
      "        return next(_runbox_lines)",
      "    except StopIteration:",
      "        raise EOFError('EOF when reading a line')",
    ].join("\n")

  const runJavaScript = async (code: string, input: string) => {
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

  const engines: Record<string, (job: any) => Promise<void>> = {
    javascript: (job) => runJavaScript(job.code, job.stdin),

    typescript: async (job) => {
      const { transform } = await import(job.runtimes.sucrase)
      const js = transform(job.code, { transforms: ["typescript"], disableESTransforms: true }).code
      await runJavaScript(js, job.stdin)
    },

    micropython: async (job) => {
      const base = job.runtimes.micropython
      const { loadMicroPython } = await import(base + "micropython.mjs")
      const outDecoder = new TextDecoder()
      const errDecoder = new TextDecoder()
      const mp = await loadMicroPython({
        url: base + "micropython.wasm",
        // Unbuffered output arrives as raw bytes.
        linebuffer: false,
        stdout: (b: Uint8Array) => stdout(outDecoder.decode(b, { stream: true })),
        stderr: (b: Uint8Array) => stderr(errDecoder.decode(b, { stream: true })),
      })
      mp.runPython(pythonStdin(job.stdin))
      post({ type: "ready" })
      await mp.runPythonAsync(job.code)
    },

    pyodide: async (job) => {
      const base = job.runtimes.pyodide
      const { loadPyodide } = await import(base + "pyodide.mjs")
      const py = await loadPyodide({
        indexURL: base,
        stdout: (t: string) => stdout(t + "\n"),
        stderr: (t: string) => stderr(t + "\n"),
      })
      await py.loadPackagesFromImports(job.code)
      py.runPython(pythonStdin(job.stdin))
      post({ type: "ready" })
      await py.runPythonAsync(job.code)
    },

    sql: async (job) => {
      const base = job.runtimes.sqljs
      const source = await (await fetch(base + "sql-wasm.js")).text()
      // sql-wasm.js is a UMD script; evaluated at global scope it defines initSqlJs.
      ;(0, eval)(source)
      const SQL = await scope.initSqlJs({ locateFile: (file: string) => base + file })
      const db = new SQL.Database()
      post({ type: "ready" })
      try {
        const results = db.exec(job.code) as { columns: string[]; values: unknown[][] }[]
        stdout(results.map((r) => formatTable(r.columns, r.values)).join("\n\n") + (results.length ? "\n" : ""))
      } finally {
        db.close()
      }
    },
  }

  scope.onmessage = async (event: MessageEvent) => {
    const job = event.data
    try {
      await engines[job.engine](job)
      post({ type: "done", exitCode: 0 })
    } catch (err) {
      stderr(errorText(err).replace(/\n?$/, "\n"))
      post({ type: "done", exitCode: 1 })
    }
  }
}
