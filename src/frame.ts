/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs inside the sandboxed iframe (opaque origin: no cookies, no storage, no
// access to the host page). Each run gets its own worker, which is terminated
// when the run ends, so memory is released and runaway code is stopped.
// Serialized with Function.prototype.toString — keep it self-contained.

export function frameMain(workerSource: string): void {
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }))
  const reply = (msg: unknown) => parent.postMessage(msg, "*")

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    const job = event.data
    if (!job || job.type !== "run") return

    const started = performance.now()
    const worker = new Worker(workerUrl)
    let bytes = 0
    let finished = false
    let runTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: Record<string, unknown>) => {
      if (finished) return
      finished = true
      clearTimeout(loadTimer)
      clearTimeout(runTimer)
      worker.terminate()
      reply({
        type: "done",
        id: job.id,
        exitCode: 1,
        timedOut: false,
        truncated: false,
        durationMs: Math.round(performance.now() - started),
        ...result,
      })
    }

    const loadTimer = setTimeout(
      () => finish({ error: "Runtime took too long to load", timedOut: true }),
      job.loadTimeoutMs,
    )

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === "ready") {
        clearTimeout(loadTimer)
        runTimer = setTimeout(() => finish({ timedOut: true }), job.timeoutMs)
      } else if (msg.type === "output") {
        if (finished) return
        const room = job.maxOutputBytes - bytes
        const text = msg.text.length > room ? msg.text.slice(0, Math.max(room, 0)) : msg.text
        bytes += text.length
        if (text) reply({ type: "output", id: job.id, stream: msg.stream, text })
        if (msg.text.length > room) finish({ truncated: true })
      } else if (msg.type === "done") {
        finish({ exitCode: msg.exitCode })
      }
    }
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault()
      finish({ error: e.message || "Worker failed to start" })
    }
    worker.postMessage(job)
  })

  reply({ type: "frame-ready" })
}
