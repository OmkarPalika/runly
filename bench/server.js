// Serves the repo for the benchmark. Runno needs cross-origin isolation, so its
// page gets COOP/COEP headers; runly's page doesn't need them.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" }

createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  const file = normalize(join(root, path))
  if (!file.startsWith(normalize(root))) return res.writeHead(403).end()
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": types[extname(file)] ?? "application/octet-stream" }
  if (path.endsWith("runno.html")) {
    headers["Cross-Origin-Opener-Policy"] = "same-origin"
    headers["Cross-Origin-Embedder-Policy"] = "require-corp"
  }
  try {
    res.writeHead(200, headers).end(await readFile(file))
  } catch {
    res.writeHead(404).end()
  }
}).listen(4174)
