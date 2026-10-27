// Minimal static server for the end-to-end tests.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"

const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const types = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" }

createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  const file = normalize(join(root, path === "/" ? "test/e2e/index.html" : path))
  if (!file.startsWith(normalize(root))) {
    res.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(Number(process.env.PORT ?? 4173))
