import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeLanguage, pythonImports, selectEngine, snapshotKey } from "../../dist/index.js"

test("normalizeLanguage resolves names and extensions", () => {
  assert.equal(normalizeLanguage("JS"), "javascript")
  assert.equal(normalizeLanguage(" ts "), "typescript")
  assert.equal(normalizeLanguage("py"), "python")
  assert.equal(normalizeLanguage("sqlite3"), "sql")
  assert.equal(normalizeLanguage("python"), "python")
  assert.equal(normalizeLanguage("C++"), "cpp")
  assert.equal(normalizeLanguage("cc"), "cpp")
  assert.equal(normalizeLanguage("golang"), "go")
  assert.equal(normalizeLanguage("rb"), "ruby")
  assert.equal(normalizeLanguage("java"), "java")
  assert.equal(normalizeLanguage("c"), "c")
})

test("normalizeLanguage rejects unsupported languages", () => {
  assert.equal(normalizeLanguage("rust"), null)
  assert.equal(normalizeLanguage(""), null)
})

test("pythonImports finds top-level modules", () => {
  const code = [
    "import os, sys",
    "import numpy as np",
    "from collections.abc import Mapping",
    "  import json",
    "x = 'import fake'",
  ].join("\n")
  assert.deepEqual(pythonImports(code).sort(), ["collections", "json", "numpy", "os", "sys"])
})

test("selectEngine uses MicroPython for plain Python", () => {
  assert.equal(selectEngine("python", "import math\nprint(math.pi)"), "micropython")
  assert.equal(selectEngine("python", "print(1)"), "micropython")
})

test("selectEngine falls back to Pyodide for heavier imports", () => {
  assert.equal(selectEngine("python", "import numpy"), "pyodide")
  assert.equal(selectEngine("python", "from pandas import DataFrame"), "pyodide")
})

test("selectEngine honours an explicit Python mode", () => {
  assert.equal(selectEngine("python", "import numpy", { python: "micropython" }), "micropython")
  assert.equal(selectEngine("python", "print(1)", { python: "pyodide" }), "pyodide")
})

test("selectEngine uses xcc for C unless clang is requested", () => {
  assert.equal(selectEngine("c", "int main(void) { return 0; }"), "xcc")
  assert.equal(selectEngine("c", "int main(void) { return 0; }", { c: "clang" }), "c")
  assert.equal(selectEngine("cpp", "int main() {}"), "cpp")
})

test("selectEngine uses mruby unless the code requires a library", () => {
  assert.equal(selectEngine("ruby", "puts 1"), "mruby")
  assert.equal(selectEngine("ruby", "require 'set'\nputs Set.new"), "ruby")
  assert.equal(selectEngine("ruby", "puts 'require me'"), "mruby")
  assert.equal(selectEngine("ruby", "puts 1", { ruby: "cruby" }), "ruby")
  assert.equal(selectEngine("ruby", "require 'set'", { ruby: "mruby" }), "mruby")
})

test("selectEngine passes other languages through", () => {
  assert.equal(selectEngine("sql", "select 1"), "sql")
  assert.equal(selectEngine("go", "package main"), "go")
  assert.equal(selectEngine("typescript", "let a: number = 1"), "typescript")
})

test("snapshotKey is stable and input-sensitive", async () => {
  const a = await snapshotKey("python", "print(1)")
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(a, await snapshotKey("python", "print(1)"))
  assert.notEqual(a, await snapshotKey("python", "print(2)"))
  assert.notEqual(a, await snapshotKey("python", "print(1)", "input"))
})

test("VERSION matches package.json", async () => {
  const { readFile } = await import("node:fs/promises")
  const { VERSION } = await import("../../dist/version.js")
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"))
  assert.equal(VERSION, pkg.version)
})

test("selectEngine ignores imports of sibling files", () => {
  assert.equal(selectEngine("python", "import helper\nfrom stats import mean", {}, ["main.py", "helper.py", "stats.py"]), "micropython")
  assert.equal(selectEngine("python", "import helper\nimport numpy", {}, ["main.py", "helper.py"]), "pyodide")
})

test("selectEngine uses clang for C split across files", () => {
  assert.equal(selectEngine("c", "int main(void){}", {}, ["main.c", "util.c"]), "c")
  assert.equal(selectEngine("c", "int main(void){}", {}, ["main.c"]), "xcc")
})

test("selectEngine keeps mruby for require_relative", () => {
  assert.equal(selectEngine("ruby", "require_relative 'greeter'"), "mruby")
  assert.equal(selectEngine("ruby", "require 'set'"), "ruby")
})
