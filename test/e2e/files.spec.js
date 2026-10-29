import { test, expect } from "@playwright/test"

// Multi-file runs: `files` lists every file, the first is the entry point.
const run = (page, request) => page.evaluate((r) => window.runner.run(r), request)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => window.runner)
})

const expectOk = (res, stdout) => {
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe(stdout)
  expect(res.exitCode).toBe(0)
}

test("python imports a sibling module", async ({ page }) => {
  const res = await run(page, {
    language: "python",
    files: [
      { name: "main.py", content: "from helper import greet\nprint(greet('py'))" },
      { name: "helper.py", content: "def greet(n):\n    return 'hi ' + n" },
    ],
  })
  expectOk(res, "hi py\n")
  expect(res.engine).toBe("micropython")
})

test("python with numpy imports a sibling module on Pyodide", async ({ page }) => {
  test.slow()
  const res = await run(page, {
    language: "python",
    files: [
      { name: "main.py", content: "import stats\nprint(stats.total([1, 2, 3]))" },
      { name: "stats.py", content: "import numpy as np\ndef total(xs):\n    return int(np.sum(xs))" },
    ],
  })
  expectOk(res, "6\n")
  expect(res.engine).toBe("pyodide")
})

test("javascript imports a sibling module", async ({ page }) => {
  const res = await run(page, {
    language: "javascript",
    files: [
      { name: "main.js", content: "import { add } from './math.js'\nimport double from './double'\nconsole.log(add(2, 3), double(4))" },
      { name: "math.js", content: "export const add = (a, b) => a + b" },
      { name: "double.js", content: "export default (n) => n * 2" },
    ],
  })
  expectOk(res, "5 8\n")
})

test("javascript supports require between files", async ({ page }) => {
  const res = await run(page, {
    language: "javascript",
    files: [
      { name: "index.js", content: "const { twice } = require('./lib')\nconsole.log(twice(21))" },
      { name: "lib.js", content: "module.exports = { twice: (n) => n * 2 }" },
    ],
  })
  expectOk(res, "42\n")
})

test("typescript imports a sibling module", async ({ page }) => {
  const res = await run(page, {
    language: "typescript",
    files: [
      { name: "main.ts", content: "import { Point, dist } from './geo'\nconst p: Point = { x: 3, y: 4 }\nconsole.log(dist(p))" },
      { name: "geo.ts", content: "export interface Point { x: number; y: number }\nexport const dist = (p: Point): number => Math.hypot(p.x, p.y)" },
    ],
  })
  expectOk(res, "5\n")
})

test("cpp compiles several sources and headers", async ({ page }) => {
  const res = await run(page, {
    language: "cpp",
    files: [
      { name: "main.cpp", content: '#include <iostream>\n#include "math.h"\nint main() { std::cout << add(2, 3) << "\\n"; }' },
      { name: "math.h", content: "#pragma once\nint add(int a, int b);" },
      { name: "math.cpp", content: '#include "math.h"\nint add(int a, int b) { return a + b; }' },
    ],
  })
  expectOk(res, "5\n")
})

test("c with several files uses clang", async ({ page }) => {
  const res = await run(page, {
    language: "c",
    files: [
      { name: "main.c", content: '#include <stdio.h>\n#include "util.h"\nint main(void) { printf("%d\\n", sq(7)); return 0; }' },
      { name: "util.h", content: "int sq(int x);" },
      { name: "util.c", content: "int sq(int x) { return x * x; }" },
    ],
  })
  expectOk(res, "49\n")
  expect(res.engine).toBe("c")
})

test("java compiles several classes", async ({ page }) => {
  const res = await run(page, {
    language: "java",
    files: [
      { name: "Main.java", content: "public class Main { public static void main(String[] a) { System.out.println(Greeter.greet(\"java\")); } }" },
      { name: "Greeter.java", content: 'public class Greeter { static String greet(String n) { return "hi " + n; } }' },
    ],
  })
  expectOk(res, "hi java\n")
})

test("go runs a package split across files", async ({ page }) => {
  const res = await run(page, {
    language: "go",
    files: [
      { name: "main.go", content: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println(greet("go")) }\n' },
      { name: "greet.go", content: 'package main\n\nfunc greet(n string) string { return "hi " + n }\n' },
    ],
  })
  expectOk(res, "hi go\n")
})

test("ruby loads a sibling file with require_relative", async ({ page }) => {
  const res = await run(page, {
    language: "ruby",
    files: [
      { name: "main.rb", content: "require_relative 'greeter'\nputs Greeter.hi('rb')" },
      { name: "greeter.rb", content: "module Greeter\n  def self.hi(n) = \"hi #{n}\"\nend" },
    ],
  })
  expectOk(res, "hi rb\n")
  expect(res.engine).toBe("mruby")
})

test("sql runs files in order", async ({ page }) => {
  const res = await run(page, {
    language: "sql",
    files: [
      { name: "schema.sql", content: "create table t (n int); insert into t values (1), (2);" },
      { name: "query.sql", content: "select sum(n) as total from t;" },
    ],
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toContain("3")
})

test("a single file in files behaves like code", async ({ page }) => {
  const res = await run(page, { language: "python", files: [{ name: "main.py", content: "print(1)" }] })
  expectOk(res, "1\n")
})
