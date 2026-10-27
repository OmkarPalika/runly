/**
 * Stable key for caching the output of a run. Store the result of a run under
 * this key when the code is published, and show it again for unchanged code
 * without loading any runtime.
 */
export async function snapshotKey(language: string, code: string, stdin = ""): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([language, code, stdin]))
  const digest = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
