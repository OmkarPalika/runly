import { test, expect } from "@playwright/test"

// Postgres runs on PGlite (Postgres compiled to WebAssembly).
const run = (page, request) => page.evaluate((r) => window.runner.run(r), request)

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => window.runner)
})

test("postgres supports tables, serial, joins and window functions", async ({ page }) => {
  test.slow()
  const res = await run(page, {
    language: "postgresql",
    code: `
      create table dept (id serial primary key, name text not null);
      create table emp (id serial primary key, dept_id int references dept, name text, salary numeric);
      insert into dept (name) values ('eng'), ('ops');
      insert into emp (dept_id, name, salary) values (1, 'a', 100), (1, 'b', 200), (2, 'c', 150);
      select d.name, e.name as emp, rank() over (partition by d.id order by e.salary desc) as r
      from emp e join dept d on d.id = e.dept_id order by d.name, r;`,
  })
  expect(res.stderr).toBe("")
  expect(res.engine).toBe("postgres")
  expect(res.stdout).toMatch(/eng\s*\|\s*b\s*\|\s*1/)
  expect(res.stdout).toMatch(/ops\s*\|\s*c\s*\|\s*1/)
})

test("postgres runs plpgsql functions, enums and notices", async ({ page }) => {
  test.slow()
  const res = await run(page, {
    language: "postgres",
    code: `
      create type mood as enum ('sad', 'ok', 'happy');
      create function double_it(n int) returns int language plpgsql as $$
      begin
        raise notice 'doubling %', n;
        return n * 2;
      end $$;
      select double_it(21) as answer, 'happy'::mood as m;`,
  })
  expect(res.stderr).toBe("")
  expect(res.stdout).toContain("doubling 21")
  expect(res.stdout).toMatch(/answer\s*\|\s*m/)
  expect(res.stdout).toMatch(/42\s*\|\s*happy/)
})

test("each postgres run starts from an empty database", async ({ page }) => {
  test.slow()
  await run(page, { language: "postgres", code: "create table t (n int); insert into t values (1);" })
  const res = await run(page, { language: "postgres", code: "create table t (n int); select count(*) as c from t;" })
  expect(res.stderr).toBe("")
  expect(res.stdout).toMatch(/c\s*\n-+\s*\n0/)
})

test("postgres runs files in order and reports errors", async ({ page }) => {
  test.slow()
  const ok = await run(page, {
    language: "postgres",
    files: [
      { name: "schema.sql", content: "create table t (n int);" },
      { name: "seed.sql", content: "insert into t select generate_series(1, 4);" },
      { name: "query.sql", content: "select sum(n) as total from t;" },
    ],
  })
  expect(ok.stderr).toBe("")
  expect(ok.stdout).toMatch(/total\s*\n-+\s*\n10/)
  const bad = await run(page, { language: "postgres", code: "select * from missing;" })
  expect(bad.exitCode).toBe(1)
  expect(bad.stderr).toContain('relation "missing" does not exist')
})
