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

  // Report download progress of runtime files. Each worker serves one engine,
  // which the first message names.
  let engine = ""
  const nativeFetch = scope.fetch.bind(scope)
  scope.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response: Response = await nativeFetch(input, init)
    if (!response.ok || !response.body) return response
    const url = response.url || String(input)
    const total = Number(response.headers.get("content-length")) || 0
    let loaded = 0
    let last = 0
    const report = () => scope.postMessage({ type: "progress", engine, url, loaded, total })
    const counted = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.byteLength
          if (performance.now() - last > 100) {
            last = performance.now()
            report()
          }
          controller.enqueue(chunk)
        },
        flush: report,
      }),
    )
    const copy = new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers })
    Object.defineProperty(copy, "url", { value: url })
    return copy
  }

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
    const rubyClass = (err as any).rubyClass
    if (rubyClass) return `${rubyClass}: ${err.message}`
    return err.name === "PythonError" ? err.message : `${err.name}: ${err.message}`
  }

  const pythonStdin = (input: string) =>
    [
      "_sandrun_lines = iter(" + JSON.stringify(input.split("\n")) + ")",
      "def input(prompt=''):",
      "    try:",
      "        return next(_sandrun_lines)",
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

  // Merge the files of one Go package: a single package clause, the union of
  // their imports, then each file's declarations.
  const mergeGo = (files: SourceFile[]): string => {
    const imports = new Set<string>()
    const bodies = files.map((f) =>
      f.content
        .replace(/^\s*package\s+\w+\s*$/m, "")
        .replace(/^\s*import\s*\(([\s\S]*?)\)/gm, (_, list: string) => {
          for (const line of list.split("\n")) if (line.trim()) imports.add(line.trim())
          return ""
        })
        .replace(/^\s*import\s+((?:\w+\s+)?"[^"]+")\s*$/gm, (_, spec: string) => {
          imports.add(spec)
          return ""
        }),
    )
    const imported = [...imports].map((i) => "\t" + i).join("\n")
    return `package main\n\nimport (\n${imported}\n)\n\n${bodies.join("\n")}`
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
    wasiShim: (job) => once("wasi", () => import(job.runtimes.wasi)),

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

    xcc: (job) =>
      once("xcc", async () => {
        const [lib, cc, runtime] = await Promise.all([
          import(job.runtimes.xccjs),
          WebAssembly.compileStreaming(fetch(job.runtimes.xcc + "build/cc.wasm")),
          WebAssembly.compileStreaming(fetch(job.runtimes.xcc + "build/runtime.wasm")),
        ])
        return { lib, cc, runtime }
      }),

    mruby: (job) =>
      once("mruby", async () => {
        const [lib] = await Promise.all([import(job.runtimes.mrubyjs), once("wasi", () => import(job.runtimes.wasi))])
        return lib.createVM
      }),

    ruby: (job) =>
      once("ruby", async () => {
        scope.importScripts(job.runtimes.rubyjs + "dist/browser.umd.js")
        return WebAssembly.compileStreaming(fetch(job.runtimes.ruby + "dist/ruby+stdlib.wasm"))
      }),
  }

  const compileC = async (job: any, driver: "clang" | "clang++", source: string): Promise<number> => {
    const runClang = await loaders.cpp(job)
    // The toolchain logs download progress with console.log, which would end
    // up in stdout. Silence it while compiling.
    const log = scope.console.log
    scope.console.log = () => {}
    // Every file is available to #include; each source file is compiled.
    let files: Record<string, Uint8Array>
    const inputs = sourcesOf(job, source)
    const sourceExt = driver === "clang" ? /\.c$/ : /\.(c|cc|cpp|cxx|c\+\+)$/
    const sources = inputs.map((f) => f.name).filter((n, i) => i === 0 || sourceExt.test(n))
    const compile = (flags: string[], onStderr: (b: Uint8Array | null) => void) =>
      runClang([driver, ...sources, "-O1", ...flags, "-o", "main.wasm"], Object.fromEntries(inputs.map((f) => [f.name, f.content])), {
        stdout: decoderFor(stdout),
        stderr: onStderr,
      })
    try {
      if (driver === "clang") {
        files = await compile([], decoderFor(stderr))
      } else {
        // The WASI libc++ is built without exception support.
        const flags = ["-std=c++20", "-fno-exceptions"]
        // In C++20 mode libc++ includes many headers only for compatibility,
        // which more than doubles the time to parse <iostream>. Leave them out
        // first, and if that fails (the code may rely on them), compile again
        // with them. Diagnostics are held until we know which attempt counts.
        const held: Uint8Array[] = []
        try {
          files = await compile([...flags, "-D_LIBCPP_REMOVE_TRANSITIVE_INCLUDES"], (b) => b && held.push(b.slice()))
          const write = decoderFor(stderr)
          held.forEach((b) => write(b))
        } catch (err: any) {
          if (typeof err?.code !== "number") throw err
          files = await compile(flags, decoderFor(stderr))
        }
      }
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

  type SourceFile = { name: string; content: string }
  // The run's files with the entry point first; an unnamed entry gets `entry`.
  const sourcesOf = (job: any, entry: string): SourceFile[] =>
    (job.files ?? [{ name: "", content: job.code }]).map((f: SourceFile, i: number) =>
      i === 0 && !f.name ? { name: entry, content: f.content } : f,
    )

  // Resolves a relative import ("./lib", "lib.js") to one of the run's files.
  const findFile = (files: SourceFile[], spec: string, exts: string[]) => {
    const base = spec.replace(/^\.\//, "")
    for (const name of [base, ...exts.map((e) => base + e), ...exts.map((e) => base + "/index" + e)]) {
      const file = files.find((f) => f.name === name)
      if (file) return file
    }
  }

  // JavaScript or TypeScript split across files: each file becomes a CommonJS
  // module (ES imports are rewritten by Sucrase), and the entry point runs with
  // a `require` that resolves the other files.
  const runModules = async (job: any, files: SourceFile[], typescript: boolean) => {
    const { transform } = await loaders.typescript(job)
    const exts = [".ts", ".tsx", ".js", ".mjs", ".cjs"]
    const compile = (f: SourceFile) =>
      transform(f.content, { transforms: typescript ? ["typescript", "imports"] : ["imports"], filePath: f.name }).code
    const cache = new Map<string, any>()
    const require = (spec: string) => {
      const file = findFile(files, spec, exts)
      if (!file) throw new Error(`Cannot find module '${spec}'`)
      if (!cache.has(file.name)) {
        const module = { exports: {} as any }
        cache.set(file.name, module)
        new Function("require", "module", "exports", compile(file))(require, module, module.exports)
      }
      return cache.get(file.name).exports
    }
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    const entry = { exports: {} }
    cache.set(files[0].name, entry)
    post({ type: "ready" })
    await new AsyncFunction("stdin", "require", "module", "exports", compile(files[0]))(job.stdin, require, entry, entry.exports)
  }

  // Ruby: `require_relative "x"` lines are replaced by the file's contents, once
  // per file, which works the same in mruby (no file system) and CRuby.
  const inlineRuby = (files: SourceFile[]) => {
    const seen = new Set<string>()
    const expand = (file: SourceFile): string => {
      seen.add(file.name)
      return file.content.replace(/^[ \t]*require_relative[ \t(]+["']([^"']+)["'][ \t)]*$/gm, (line, spec) => {
        const target = findFile(files, spec, [".rb"])
        if (!target) return line
        return seen.has(target.name) ? "" : expand(target)
      })
    }
    return expand(files[0])
  }

  const engines: Record<string, (job: any) => Promise<number | void>> = {
    javascript: (job) =>
      job.files?.length > 1 ? runModules(job, sourcesOf(job, "main.js"), false) : runJavaScript(job.code, job.stdin),

    typescript: async (job) => {
      if (job.files?.length > 1) return runModules(job, sourcesOf(job, "main.ts"), true)
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
      // Sibling modules go next to the entry point, which is on sys.path.
      for (const f of sourcesOf(job, "main.py").slice(1)) mp.FS.writeFile("/" + f.name, f.content)
      mp.runPython(pythonStdin(job.stdin))
      post({ type: "ready" })
      await mp.runPythonAsync(job.code)
    },

    pyodide: async (job) => {
      const py = await loaders.pyodide(job)
      py.setStdout({ batched: (t: string) => stdout(t + "\n") })
      py.setStderr({ batched: (t: string) => stderr(t + "\n") })
      const files = sourcesOf(job, "main.py")
      await py.loadPackagesFromImports(files.map((f: SourceFile) => f.content).join("\n"), { messageCallback: () => {} })
      // Sibling modules are written to the working directory, which is on
      // sys.path. Pyodide outlives the run, so drop earlier copies of them.
      const local = files.slice(1).map((f: SourceFile) => f.name)
      for (const f of files.slice(1)) py.FS.writeFile(f.name, f.content)
      py.runPython(
        `import sys, importlib\nfor m in ${JSON.stringify(local.map((n: string) => n.replace(/\.py$/, "")))}: sys.modules.pop(m, None)\nimportlib.invalidate_caches()`,
      )
      // Fresh globals per run; imported modules stay cached in sys.modules.
      const globals = py.globals.get("dict")()
      try {
        py.runPython(pythonStdin(job.stdin), { globals })
        post({ type: "ready" })
        await py.runPythonAsync(job.code, { globals })
      } finally {
        globals.destroy()
        for (const name of local) py.FS.unlink(name)
      }
    },

    sql: async (job) => {
      const SQL = await loaders.sql(job)
      const db = new SQL.Database()
      post({ type: "ready" })
      try {
        const sql = sourcesOf(job, "main.sql").map((f: SourceFile) => f.content).join(";\n")
        const results = db.exec(sql) as { columns: string[]; values: unknown[][] }[]
        stdout(results.map((r) => formatTable(r.columns, r.values)).join("\n\n") + (results.length ? "\n" : ""))
      } finally {
        db.close()
      }
    },

    // xcc is packaged as a REPL: the program is compiled as one cell, then
    // main() is evaluated as a second cell, whose printed result is main's
    // return value.
    xcc: async (job) => {
      const { lib, cc, runtime } = await loaders.xcc(job)
      const lines = job.stdin.split("\n")
      const repl = await lib.CRepl.create({
        ccModule: cc,
        runtimeModule: runtime,
        runtimeMap: lib.runtimeMap,
        headers: lib.headers,
        stdout,
        // Diagnostics name the REPL cell; report it as the source file instead.
        stderr: (t: string) => stderr(t.replace(/cell\[\d+\]/g, "main.c")),
        stdin: () => (lines.length ? lines.shift() + "\n" : null),
      })
      const compiled = await repl.run(job.code)
      if (compiled.status !== "ok") return 1
      post({ type: "ready" })
      const ran = await repl.run("main()")
      if (ran.status !== "ok") return 1
      const code = /\((?:int|long)\)\s*(-?\d+)/.exec(ran.result ?? "")
      return code ? Number(code[1]) & 255 : 0
    },

    c: (job) => compileC(job, "clang", "main.c"),

    cpp: (job) => compileC(job, "clang++", "main.cpp"),

    go: async (job) => {
      const module = await loaders.go(job)
      const files = sourcesOf(job, "main.go")
      // yaegi runs one file, so a package split across files is merged.
      const code = files.length > 1 ? mergeGo(files) : files[0].content
      return runWasi(job, module, ["yaegi", "run", "/w/main.go"], { "main.go": code })
    },

    java: async (job) => {
      const { load, compiler } = await loaders.java(job)
      compiler.clearSourceFiles()
      compiler.clearOutputFiles()
      // javac requires a public class to live in a file of the same name.
      for (const f of job.files ?? [{ name: "", content: job.code }]) {
        const name = /public\s+(?:(?:final|abstract)\s+)*class\s+(\w+)/.exec(f.content)?.[1] ?? (f.name.replace(/\.java$/, "") || "Main")
        compiler.addSourceFile(`${name}.java`, f.content)
      }
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

    mruby: async (job) => {
      const createVM = await loaders.mruby(job)
      const shim = await loaders.wasiShim(job)
      // The package's own WASI layer prints through console.log and drops
      // blank lines, so stdio goes through the shared WASI shim instead.
      const wasi = new shim.WASI(
        [],
        [],
        [
          new shim.OpenFile(new shim.File(new TextEncoder().encode(job.stdin))),
          new shim.ConsoleStdout(decoderFor(stdout)),
          new shim.ConsoleStdout(decoderFor(stderr)),
        ],
        { debug: false },
      )
      const vm = await createVM({
        wasm: job.runtimes.mruby + "mruby-js.wasm",
        wasi: wasi.wasiImport,
        onStart: (instance: WebAssembly.Instance) => wasi.initialize(instance),
      })
      post({ type: "ready" })
      vm.eval(inlineRuby(sourcesOf(job, "main.rb")), { filename: "main.rb" })
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
      vm.eval(inlineRuby(sourcesOf(job, "main.rb")))
    },
  }

  scope.onmessage = async (event: MessageEvent) => {
    const msg = event.data
    engine = msg.engine
    if (msg.type === "preload") {
      // Load in the background; a failure surfaces on the next real run.
      const loading = loaders[msg.engine]?.(msg)
      if (msg.engine === "cpp" || msg.engine === "c") {
        // The browser compiles Clang's functions the first time they run, which
        // makes the first compile on a page about 2 s slower. Compile a small
        // program now so that cost is paid before the visitor presses Run.
        const quiet = { stdout: () => {}, stderr: () => {} }
        const warmUp = "#include <iostream>\nint main() { std::cout << 1; }\n"
        loading?.then((runClang: any) =>
          runClang(["clang++", "w.cpp", "-O1", "-std=c++20", "-fno-exceptions", "-D_LIBCPP_REMOVE_TRANSITIVE_INCLUDES", "-o", "w.wasm"], { "w.cpp": warmUp }, quiet),
        ).catch(() => {})
      }
      loading?.catch(() => {})
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
