// Fetches a brotli-compressed file and decompresses it while it downloads.
// Browsers apply HTTP compression at a lower level than this, so shipping
// pre-compressed files cuts the download by about a quarter.
// The decoder is loaded once: initialising it again while a stream is in use
// swaps the module instance out from under that stream.
let decoder;
async function fetchBrotli(url, fetch) {
  decoder ??= import(new URL("./brotli_dec_wasm.js", import.meta.url)).then(async (mod) => {
    await mod.default({ module_or_path: new URL("./brotli_dec_wasm_bg.wasm", import.meta.url) });
    return mod;
  });
  const { DecompressStream, BrotliStreamResultCode } = await decoder;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const stream = new DecompressStream();
  const chunks = [];
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let input = value;
    for (;;) {
      const result = stream.decompress(input, 1 << 22);
      chunks.push(result.buf);
      if (result.code !== BrotliStreamResultCode.NeedsMoreOutput) break;
      input = input.subarray(result.input_offset);
    }
  }
  return new Response(new Blob(chunks), { headers: { "content-type": "application/wasm" } });
}
