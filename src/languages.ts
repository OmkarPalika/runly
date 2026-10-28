export const LANGUAGES = ["javascript", "typescript", "python", "sql", "c", "cpp", "go", "java", "ruby"] as const

export type Language = (typeof LANGUAGES)[number]

/**
 * Engine that actually executes a run. Python, C and Ruby each have a small
 * engine and a full one.
 */
export type Engine =
  | "javascript"
  | "typescript"
  | "micropython"
  | "pyodide"
  | "sql"
  | "xcc"
  | "c"
  | "cpp"
  | "go"
  | "java"
  | "mruby"
  | "ruby"

const ALIASES: Record<string, Language> = {
  js: "javascript",
  mjs: "javascript",
  node: "javascript",
  ts: "typescript",
  py: "python",
  python3: "python",
  sqlite: "sql",
  sqlite3: "sql",
  h: "c",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  golang: "go",
  rb: "ruby",
}

/** Map a language name or file extension to a supported language, or null. */
export function normalizeLanguage(name: string): Language | null {
  const key = name.trim().toLowerCase()
  const lang = ALIASES[key] ?? key
  return (LANGUAGES as readonly string[]).includes(lang) ? (lang as Language) : null
}

// Modules the MicroPython build ships with. Anything else (numpy, pandas,
// requests, ...) needs CPython, so the run goes to Pyodide instead.
const MICROPYTHON_MODULES = new Set([
  "array",
  "asyncio",
  "binascii",
  "builtins",
  "collections",
  "errno",
  "gc",
  "hashlib",
  "heapq",
  "io",
  "json",
  "math",
  "micropython",
  "os",
  "random",
  "re",
  "select",
  "struct",
  "sys",
  "time",
])

/** Top-level module names imported by a Python snippet. */
export function pythonImports(code: string): string[] {
  const names = new Set<string>()
  for (const line of code.split("\n")) {
    const from = /^\s*from\s+([\w.]+)\s+import\b/.exec(line)
    if (from) {
      names.add(from[1].split(".")[0])
      continue
    }
    const imp = /^\s*import\s+(.+)$/.exec(line)
    if (!imp) continue
    for (const part of imp[1].split(",")) {
      const mod = part.trim().split(/\s+/)[0]
      if (mod) names.add(mod.split(".")[0])
    }
  }
  return [...names]
}

export type PythonMode = "auto" | "micropython" | "pyodide"
export type CMode = "xcc" | "clang"
export type RubyMode = "auto" | "mruby" | "cruby"

export interface EngineOptions {
  /** "auto" (default) uses MicroPython unless the code imports more. */
  python?: PythonMode
  /** "xcc" (default) is a small C compiler; "clang" is full Clang. */
  c?: CMode
  /** "auto" (default) uses mruby unless the code calls `require`. */
  ruby?: RubyMode
}

/** Pick the engine for a language, preferring the smallest one that can run the code. */
export function selectEngine(language: Language, code: string, options: EngineOptions = {}): Engine {
  switch (language) {
    case "python": {
      const mode = options.python ?? "auto"
      if (mode !== "auto") return mode
      return pythonImports(code).some((m) => !MICROPYTHON_MODULES.has(m)) ? "pyodide" : "micropython"
    }
    case "c":
      return options.c === "clang" ? "c" : "xcc"
    case "ruby": {
      const mode = options.ruby ?? "auto"
      if (mode === "mruby") return "mruby"
      if (mode === "cruby") return "ruby"
      // mruby has no require; anything that loads a library needs CRuby.
      return /^\s*require(_relative)?\b/m.test(code) ? "ruby" : "mruby"
    }
    default:
      return language
  }
}
