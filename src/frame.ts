/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs inside the sandboxed iframe (opaque origin: no cookies, no storage, no
// access to the host page). Serialized with Function.prototype.toString — keep
// it self-contained.
//
// Each engine gets one worker that is kept warm between runs, so its runtime
// only loads once. Runs for the same engine are queued. A run that times out,
// overflows its output or crashes the worker gets the worker terminated; the
// next run starts a fresh one. JavaScript and TypeScript use a throwaway worker
// per run, since they have nothing worth keeping and share a global scope.

export function frameMain(workerSource: string): void {
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }))
  const reply = (msg: unknown) => parent.postMessage(msg, "*")
  const disposable = new Set(["javascript", "typescript"])

  interface Slot {
    worker: Worker
    busy: boolean
    queue: any[]
  }
  const slots = new Map<string, Slot>()

  // Download progress goes straight to the page, whether or not a run is waiting.
  const spawn = () => {
    const worker = new Worker(workerUrl)
    worker.addEventListener("message", (e) => {
      if (e.data?.type === "progress") reply(e.data)
    })
    return worker
  }

  const slotFor = (engine: string): Slot => {
    let slot = slots.get(engine)
    if (!slot) {
      slot = { worker: spawn(), busy: false, queue: [] }
      slots.set(engine, slot)
    }
    return slot
  }

  const kill = (engine: string, slot: Slot) => {
    slot.worker.terminate()
    if (slots.get(engine) === slot) slots.delete(engine)
    // Anything still queued moves to a fresh worker.
    for (const job of slot.queue) start(job)
  }

  const execute = (job: any, slot: Slot, keep: boolean) => {
    slot.busy = true
    const { worker } = slot
    const started = performance.now()
    let bytes = 0
    let finished = false
    let runTimer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: Record<string, unknown>, healthy: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(loadTimer)
      clearTimeout(runTimer)
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
      reply({
        type: "done",
        id: job.id,
        exitCode: 1,
        timedOut: false,
        truncated: false,
        durationMs: Math.round(performance.now() - started),
        ...result,
      })
      slot.busy = false
      if (!keep || !healthy) {
        if (keep) kill(job.engine, slot)
        else worker.terminate()
        return
      }
      const next = slot.queue.shift()
      if (next) execute(next, slot, true)
    }

    const loadTimer = setTimeout(
      () => finish({ error: "Runtime took too long to load", timedOut: true }, false),
      job.loadTimeoutMs,
    )

    const onMessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.id !== job.id) return
      if (msg.type === "ready") {
        clearTimeout(loadTimer)
        runTimer = setTimeout(() => finish({ timedOut: true }, false), job.timeoutMs)
      } else if (msg.type === "output") {
        if (finished) return
        const room = job.maxOutputBytes - bytes
        const text = msg.text.length > room ? msg.text.slice(0, Math.max(room, 0)) : msg.text
        bytes += text.length
        if (text) reply({ type: "output", id: job.id, stream: msg.stream, text })
        if (msg.text.length > room) finish({ truncated: true }, false)
      } else if (msg.type === "done") {
        finish({ exitCode: msg.exitCode }, true)
      }
    }
    const onError = (e: ErrorEvent) => {
      e.preventDefault()
      finish({ error: e.message || "Worker failed to start" }, false)
    }
    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    worker.postMessage(job)
  }

  const start = (job: any) => {
    if (disposable.has(job.engine)) {
      execute(job, { worker: spawn(), busy: false, queue: [] }, false)
      return
    }
    const slot = slotFor(job.engine)
    if (slot.busy) slot.queue.push(job)
    else execute(job, slot, true)
  }

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return
    const msg = event.data
    if (msg?.type === "run") start(msg)
    else if (msg?.type === "preload" && !disposable.has(msg.engine)) {
      slotFor(msg.engine).worker.postMessage(msg)
    }
  })

  reply({ type: "frame-ready" })
}
