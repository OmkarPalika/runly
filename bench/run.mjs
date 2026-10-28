// Benchmarks sandrun against Runno on the languages both support.
//
// For each tool and language, in a fresh browser profile (empty cache):
//   cold   - first run on the page: download + start + execute
//   warm   - second run on the same page
//   reload - first run after reloading the page (files now in the HTTP cache)
//
// Usage: node bench/server.js & node bench/run.mjs [--browser chromium]
import { chromium, firefox, webkit } from "@playwright/test"
import { writeFile } from "node:fs/promises"

const browserName = process.argv.includes("--browser") ? process.argv[process.argv.indexOf("--browser") + 1] : "chromium"
const BASE = "http://localhost:4174/bench/"
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null

const programs = {
  javascript: { sandrun: "javascript", runno: "quickjs", code: "let s = 0; for (let i = 0; i < 1e6; i++) s += i; console.log(s)" },
  python: { sandrun: "python", runno: "python", code: "s = 0\nfor i in range(1000000):\n    s += i\nprint(s)" },
  sql: { sandrun: "sql", runno: "sqlite", code: "create table t(x); insert into t values (1), (2), (3); select sum(x) from t;" },
  c: { sandrun: "c", runno: "clang", code: '#include <stdio.h>\nint main(void) { long s = 0; for (long i = 0; i < 1000000; i++) s += i; printf("%ld\\n", s); }' },
  cpp: { sandrun: "cpp", runno: "clangpp", code: '#include <iostream>\nint main() { long s = 0; for (long i = 0; i < 1000000; i++) s += i; std::cout << s << "\\n"; }' },
  ruby: { sandrun: "ruby", runno: "ruby", code: "puts (0...1_000_000).sum" },
  // sandrun only (Runno doesn't support these)
  typescript: { sandrun: "typescript", code: "const n: number = 21; console.log(n * 2)" },
  go: { sandrun: "go", code: 'package main\n\nimport "fmt"\n\nfunc main() {\n\ts := 0\n\tfor i := 0; i < 1000000; i++ {\n\t\ts += i\n\t}\n\tfmt.Println(s)\n}\n' },
  java: { sandrun: "java", code: "public class Main { public static void main(String[] a) { long s = 0; for (long i = 0; i < 1000000; i++) s += i; System.out.println(s); } }" },
}

const browsers = { chromium, firefox, webkit }
const browser = await browsers[browserName].launch()
const rows = []

for (const [label, p] of Object.entries(programs)) {
  if (only && !only.includes(label)) continue
  for (const tool of ["sandrun", "runno"]) {
    const lang = p[tool]
    if (!lang) continue
    const context = await browser.newContext()
    const page = await context.newPage()
    // Any single run that takes longer than this counts as a failure.
    const run = async () => {
      await page.waitForFunction(() => window.bench, null, { timeout: 30_000 })
      return Promise.race([
        page.evaluate(([l, c]) => window.bench(l, c), [lang, p.code]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 180 s")), 180_000)),
      ])
    }
    try {
      await page.goto(BASE + tool + ".html")
      const cold = await run()
      const warm = await run()
      await page.reload()
      const reload = await run()
      rows.push({ language: label, tool, cold: cold.ms, warm: warm.ms, reload: reload.ms, ok: cold.ok && warm.ok && reload.ok, out: cold.out.trim().slice(0, 60) })
    } catch (err) {
      rows.push({ language: label, tool, error: String(err).slice(0, 80) })
    }
    console.log(JSON.stringify(rows.at(-1)))
    await context.close()
  }
}
await browser.close()

const fmt = (n) => (n === undefined ? "-" : n >= 1000 ? (n / 1000).toFixed(2) + " s" : Math.round(n) + " ms")
const table = [
  `Browser: ${browserName}. Each cell is one measurement; network conditions vary.`,
  "",
  "| Language | Tool | Cold run | Warm run | After reload | Correct output |",
  "|---|---|---|---|---|---|",
  ...rows.map((r) =>
    r.error
      ? `| ${r.language} | ${r.tool} | ${r.error} | | | no |`
      : `| ${r.language} | ${r.tool} | ${fmt(r.cold)} | ${fmt(r.warm)} | ${fmt(r.reload)} | ${r.ok ? "yes" : "no"} |`,
  ),
].join("\n")
if (!only) await writeFile(new URL(`results-${browserName}.md`, import.meta.url), table + "\n")
console.log(table)
