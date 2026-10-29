// Fetches a brotli-compressed file and decompresses it while it downloads.
// Browsers apply HTTP compression at a lower level than this, so shipping
// pre-compressed files cuts the download by about a quarter.
//
// The decompressed file is kept in Cache Storage under its own URL. Later
// page loads skip the download and decompression, and because the response
// has a URL, Chrome can cache the compiled WebAssembly code too.
// The decoder is loaded once: initialising it again while a stream is in use
// swaps the module instance out from under that stream.
let decoder;
async function fetchBrotli(url, fetch) {
  const key = String(url).replace(/\.br$/, "");
  // Cache Storage may be missing or throw (insecure or sandboxed contexts).
  let cache, hit;
  try {
    cache = await globalThis.caches?.open("browserrun-clang");
    hit = await cache?.match(key);
  } catch {
    cache = undefined;
  }
  if (hit) return hit;

  decoder ??= import(new URL("./brotli_dec_wasm.js", import.meta.url)).then(async (mod) => {
    await mod.default({ module_or_path: new URL("./brotli_dec_wasm_bg.wasm", import.meta.url) });
    return mod;
  });
  const { DecompressStream, BrotliStreamResultCode } = await decoder;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const stream = new DecompressStream();
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      let input = value;
      for (;;) {
        const result = stream.decompress(input, 1 << 22);
        if (result.buf.length) controller.enqueue(result.buf);
        if (result.code !== BrotliStreamResultCode.NeedsMoreOutput) break;
        input = input.subarray(result.input_offset);
      }
    },
  });
  const decoded = new Response(body, { headers: { "content-type": "application/wasm" } });
  try {
    cache?.put(key, decoded.clone()).catch(() => {});
  } catch {}
  return decoded;
}
