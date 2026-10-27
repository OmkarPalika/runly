export const LANGUAGES = ["javascript", "typescript", "python", "sql"] as const

export type Language = (typeof LANGUAGES)[number]

/** Engine that actually executes a run. Python has a small and a full one. */
export type Engine = "javascript" | "typescript" | "micropython" | "pyodide" | "sql"

const ALIASES: Record<string, Language> = {
  js: "javascript",
  mjs: "javascript",
  node: "javascript",
  ts: "typescript",
  py: "python",
  python3: "python",
  sqlite: "sql",
  sqlite3: "sql",
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

/** Pick the engine for a language. Python uses MicroPython unless the code needs more. */
export function selectEngine(language: Language, code: string, python: PythonMode = "auto"): Engine {
  if (language !== "python") return language
  if (python !== "auto") return python
  const needsFull = pythonImports(code).some((m) => !MICROPYTHON_MODULES.has(m))
  return needsFull ? "pyodide" : "micropython"
}
