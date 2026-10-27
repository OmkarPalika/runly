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
    window.runbox
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
