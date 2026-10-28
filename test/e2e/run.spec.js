import { test, expect } from "@playwright/test"

const run = (page, request) => page.evaluate((r) => window.runner.run(r), request)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => window.runner)
})

test("javascript prints and reads stdin", async ({ page }) => {
  const res = await run(page, {
    language: "js",
    code: "console.log('hi', 1 + 1, {a: 1}); console.error('oops'); console.log(stdin.toUpperCase())",
    stdin: "abc",
  })
  expect(res.stdout).toBe('hi 2 {"a":1}\nABC\n')
  expect(res.stderr).toBe("oops\n")
  expect(res.exitCode).toBe(0)
})

test("javascript supports top-level await", async ({ page }) => {
  const res = await run(page, { language: "javascript", code: "await null; console.log('done')" })
  expect(res.stdout).toBe("done\n")
})

test("javascript errors set exit code 1", async ({ page }) => {
  const res = await run(page, { language: "javascript", code: "throw new TypeError('bad')" })
  expect(res.exitCode).toBe(1)
  expect(res.stderr).toContain("TypeError: bad")
})

test("typescript types are stripped", async ({ page }) => {
  const res = await run(page, {
    language: "ts",
    code: "interface P { n: number }\nconst p: P = { n: 4 }\nconsole.log(p.n * 2)",
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("8\n")
})

test("python runs on micropython with input()", async ({ page }) => {
  const res = await run(page, {
    language: "python",
    code: "import math\nname = input()\nprint('hello', name, round(math.pi, 2))",
    stdin: "ada",
  })
  expect(res.engine).toBe("micropython")
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("hello ada 3.14\n")
})

test("python exceptions report a traceback", async ({ page }) => {
  const res = await run(page, { language: "python", code: "1/0" })
  expect(res.exitCode).toBe(1)
  expect(res.stderr).toContain("ZeroDivisionError")
})

test("python with heavier imports runs on pyodide", async ({ page }) => {
  const res = await run(page, { language: "python", code: "import statistics\nprint(statistics.mean([1, 2, 3]))" })
  expect(res.engine).toBe("pyodide")
  expect(res.stderr).toBe("")
  expect(res.stdout.trim()).toBe("2")
})

test("sql prints result tables", async ({ page }) => {
  const res = await run(page, {
    language: "sql",
    code: "create table t(a, b); insert into t values (1, 'x'), (2, null); select * from t;",
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("a | b\n--+-----\n1 | x\n2 | NULL\n")
})

test("infinite loops are stopped by the timeout", async ({ page }) => {
  const res = await run(page, { language: "javascript", code: "while (true) {}" })
  expect(res.timedOut).toBe(true)
  expect(res.durationMs).toBeLessThan(8000)
  const after = await run(page, { language: "javascript", code: "console.log('still works')" })
  expect(after.stdout).toBe("still works\n")
})

test("output is capped", async ({ page }) => {
  const res = await page.evaluate(() =>
    window.runly
      .createRunner({ maxOutputBytes: 100 })
      .run({ language: "javascript", code: "for (;;) console.log('x'.repeat(50))" }),
  )
  expect(res.truncated).toBe(true)
  expect(res.stdout.length).toBeLessThanOrEqual(100)
})

test("code cannot reach the host page, its cookies or storage", async ({ page }) => {
  const res = await run(page, {
    language: "javascript",
    code: [
      "const out = []",
      "out.push(typeof window)",
      "try { out.push(String(self.origin)) } catch (e) { out.push('no-origin') }",
      "try { indexedDB.open('x'); out.push('idb-ok') } catch (e) { out.push('idb-blocked') }",
      "try { await fetch('/'); out.push('fetch-ok') } catch (e) { out.push('fetch-blocked') }",
      "console.log(out.join(','))",
    ].join("\n"),
  })
  const [win, origin, , net] = res.stdout.trim().split(",")
  expect(win).toBe("undefined")
  expect(origin).toBe("null")
  expect(net).toBe("fetch-blocked")
})

test("unsupported languages are rejected", async ({ page }) => {
  const err = await page.evaluate(() => window.runner.run({ language: "cobol", code: "" }).catch((e) => e.message))
  expect(err).toBe("Unsupported language: cobol")
})

test("c compiles and reads stdin", async ({ page }) => {
  const res = await run(page, {
    language: "c",
    code: '#include <stdio.h>\nint main(void) { int n; scanf("%d", &n); printf("%d\\n", n * n); return 0; }',
    stdin: "7",
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("49\n")
  expect(res.exitCode).toBe(0)
})

test("c compile errors are reported", async ({ page }) => {
  const res = await run(page, { language: "c", code: "int main(void) { return x; }" })
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr).toContain("undeclared identifier")
})

test("c exit codes are returned", async ({ page }) => {
  const res = await run(page, { language: "c", code: "int main(void) { return 3; }" })
  expect(res.exitCode).toBe(3)
})

test("cpp runs with the standard library", async ({ page }) => {
  const res = await run(page, {
    language: "c++",
    code: '#include <iostream>\n#include <vector>\n#include <numeric>\nint main() { std::vector<int> v{1, 2, 3}; std::cout << std::accumulate(v.begin(), v.end(), 0) << "\\n"; }',
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("6\n")
})

test("go runs with stdin", async ({ page }) => {
  const res = await run(page, {
    language: "go",
    code: 'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n\t"strings"\n)\n\nfunc main() {\n\ts := bufio.NewScanner(os.Stdin)\n\ts.Scan()\n\tfmt.Println("hi", strings.ToUpper(s.Text()))\n}\n',
    stdin: "gopher",
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("hi GOPHER\n")
})

test("go errors set a non-zero exit code", async ({ page }) => {
  const res = await run(page, { language: "go", code: "package main\n\nfunc main() { undefinedThing() }\n" })
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr).toContain("undefined")
})

test("ruby prints and reads stdin", async ({ page }) => {
  const res = await run(page, {
    language: "rb",
    code: 'name = gets.chomp\nputs "hello #{name}"\nputs [1, 2, 3].sum',
    stdin: "matz",
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("hello matz\n6\n")
})

test("ruby exceptions are reported", async ({ page }) => {
  const res = await run(page, { language: "ruby", code: "raise ArgumentError, 'nope'" })
  expect(res.exitCode).toBe(1)
  expect(res.stderr).toContain("nope")
})

test("java compiles and runs", async ({ page }) => {
  const res = await run(page, {
    language: "java",
    code: [
      "import java.util.*;",
      "public class Hello {",
      "  public static void main(String[] args) {",
      "    List<Integer> xs = List.of(3, 1, 2);",
      "    System.out.println(xs.stream().mapToInt(Integer::intValue).sum());",
      '    System.out.println("hello java");',
      "  }",
      "}",
    ].join("\n"),
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toBe("6\nhello java\n")
  expect(res.exitCode).toBe(0)
})

test("java compile errors are reported", async ({ page }) => {
  const res = await run(page, {
    language: "java",
    code: "public class Main { public static void main(String[] a) { int x = \"no\"; } }",
  })
  expect(res.exitCode).toBe(1)
  expect(res.stderr).toContain("Main.java")
})

test("warm runs reuse the runtime but not program state", async ({ page }) => {
  const first = await run(page, { language: "python", code: "import statistics\nx = 41\nprint(x + 1)" })
  expect(first.stdout).toBe("42\n")
  const second = await run(page, {
    language: "python",
    code: "import statistics\ntry:\n    print(x)\nexcept NameError:\n    print('fresh')",
  })
  expect(second.stdout).toBe("fresh\n")
  expect(second.durationMs).toBeLessThan(first.durationMs)
})

test("runs for the same engine are queued", async ({ page }) => {
  const results = await page.evaluate(() =>
    Promise.all(
      [1, 2, 3].map((n) => window.runner.run({ language: "sql", code: `select ${n} as n;` })),
    ),
  )
  expect(results.map((r) => r.stdout.trim().split("\n").pop())).toEqual(["1", "2", "3"])
})

test("a timed-out warm worker is replaced", async ({ page }) => {
  const stuck = await run(page, { language: "python", code: "while True:\n    pass" })
  expect(stuck.timedOut).toBe(true)
  const after = await run(page, { language: "python", code: "print('recovered')" })
  expect(after.stdout).toBe("recovered\n")
})

test("preload makes the first run faster", async ({ page }) => {
  await page.evaluate(() => window.runner.preload("sql"))
  await page.waitForTimeout(3000)
  const res = await run(page, { language: "sql", code: "select 1 as one;" })
  expect(res.stdout).toContain("one")
  expect(res.durationMs).toBeLessThan(500)
})
