// Local-only instrumentation. Reports contain sizes/timings, never paths or session content.
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createExplorerServer } from '../scripts/serve.mjs'

if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error('Usage: node benchmarks/browser-import.mjs INPUT DIST PLAYWRIGHT_MODULE [REPORT]')
const readMode = process.env.DSH_READ_MODE || 'worker'
if (!['worker', 'main-buffer', 'main-reader'].includes(readMode)) throw new Error('DSH_READ_MODE must be worker, main-buffer or main-reader')
const { chromium } = await import(pathToFileURL(resolve(process.argv[4])).href)
const temporary = await mkdtemp(join(tmpdir(), 'dsh-import-benchmark-'))
let server
let browser
try {
  await cp(resolve(process.argv[3]), temporary, { recursive: true })
  const assets = join(temporary, 'assets')
  const workerFiles = (await readdir(assets)).filter(file => /^session\.worker-.*\.js$/.test(file))
  if (workerFiles.length !== 1) throw new Error('Expected one built session Worker bundle')
  for (const file of workerFiles) {
    const path = join(assets, file)
    await writeFile(path, `(${instrumentWorker.toString()})();\n${await readFile(path, 'utf8')}`)
  }
  server = await createExplorerServer({ directory: temporary })
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : process.platform === 'linux' ? { executablePath: '/usr/bin/chromium' } : {}),
    args: ['--no-sandbox', '--enable-precise-memory-info'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

  await page.addInitScript(({ readMode }) => {
    const now = () => performance.timeOrigin + performance.now()
    const p = window.__perf = { frames: [], gaps: [], longTasks: [], heap: [], phases: [], mainReads: [],
      sent: 0, received: 0, post: 0, start: 0, ready: 0, created: 0, posted: 0, worker: null, failed: false }
    const BaseWorker = window.Worker
    window.Worker = class extends BaseWorker {
      constructor(...args) {
        const created = now()
        super(...args)
        p.created = created
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'progress') p.phases.push({ phase: data.phase, received: now(), sent: data.__sentAt || 0 })
          if (data.type === 'error') p.failed = true
          if (data.type === 'ready') { p.received = now(); p.sent = data.__sentAt || 0; p.worker = data.__worker || null }
        })
        this.addEventListener('error', () => { p.failed = true })
      }
      postMessage(message, ...rest) {
        if (message.type !== 'import' && message.type !== 'import-files') return super.postMessage(message, ...rest)
        p.start ||= now()
        const post = (data, ...options) => {
          const start = now(); p.posted = start
          const result = super.postMessage(data, ...options)
          p.post = now() - start
          return result
        }
        if (readMode === 'worker' || message.type !== 'import-files') return post(message, ...rest)
        // Experimental A/B adapter only; production behavior is unchanged.
        void Promise.all(message.entries.map(async ({ file, name, path }) => {
          const start = now()
          const bytes = readMode === 'main-buffer' ? await file.arrayBuffer() : await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(new Error('FileReader failed'))
            reader.readAsArrayBuffer(file)
          })
          p.mainReads.push({ start, end: now(), bytes: file.size })
          return { name, path, bytes }
        })).then(entries => { post({ type: 'import', entries }, entries.map(entry => entry.bytes)) }, () => { p.failed = true })
      }
    }
    document.addEventListener('change', event => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'file') p.start = now()
    }, true)
    let previousFrame = performance.now()
    // Include the frame/timer interval straddling DOM commit; it can contain the longest render task.
    const frame = time => {
      if (p.start && (!p.ready || performance.timeOrigin + previousFrame < p.ready)) p.frames.push(time - previousFrame)
      previousFrame = time; requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    let last = performance.now()
    setInterval(() => {
      const time = performance.now()
      if (p.start && (!p.ready || performance.timeOrigin + last < p.ready)) { p.gaps.push(time - last); p.heap.push(performance.memory?.usedJSHeapSize || 0) }
      last = time
    }, 16)
    new PerformanceObserver(list => { p.longTasks.push(...list.getEntries().map(entry => ({ start: performance.timeOrigin + entry.startTime, duration: entry.duration }))) }).observe({ type: 'longtask', buffered: true })
    new MutationObserver(() => {
      if (document.querySelector('.session-tree') && !document.querySelector('[role=dialog]')) p.ready ||= now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  }, { readMode })

  function instrumentWorker() {
    const now = () => performance.timeOrigin + performance.now()
    const timing = { boot: now(), received: 0, reads: [], phases: [] }
    self.addEventListener('message', ({ data }) => {
      if (data.type === 'import' || data.type === 'import-files') timing.received = now()
    })
    const read = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function (...args) {
      const start = now()
      const bytes = this.size
      const kind = this instanceof File ? 'file' : 'blob'
      let last = start
      let maxHeartbeatGapMs = 0
      let heartbeatTicks = 0
      const timer = setInterval(() => {
        const time = now()
        maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, time - last)
        last = time; heartbeatTicks++
      }, 64)
      return read.apply(this, args).then(buffer => {
        const end = now()
        clearInterval(timer)
        timing.reads.push({ start, end, bytes, kind, heartbeatTicks, maxHeartbeatGapMs: Math.max(maxHeartbeatGapMs, end - last) })
        return buffer
      }, error => { clearInterval(timer); throw error })
    }
    const post = self.postMessage.bind(self)
    self.postMessage = (data, ...rest) => {
      const sent = now()
      if (data.type === 'progress') timing.phases.push({ phase: data.phase, sent })
      post({ ...data, __sentAt: sent, ...(data.type === 'ready' ? { __worker: timing } : {}) }, ...rest)
    }
  }

  await page.goto(server.url)
  await page.locator('input[type=file]').first().setInputFiles(resolve(process.argv[2]))
  await page.waitForFunction(() => window.__perf.ready > 0 || window.__perf.failed, {}, { timeout: 120000 })
  if (await page.evaluate(() => window.__perf.failed)) throw new Error('Import failed; inspect the local app for details')
  await page.waitForTimeout(500)
  const data = await page.evaluate(({ readMode }) => {
    const p = window.__perf
    const sorted = p.gaps.slice().sort((a, b) => a - b)
    const relative = time => time ? time - p.start : null
    const phases = p.worker?.phases || []
    const phaseDurations = phases.map((phase, index) => ({ phase: phase.phase, durationMs: (phases[index + 1]?.sent || p.sent) - phase.sent }))
    const reads = [...p.mainReads, ...(p.worker?.reads || [])].map(read => ({ thread: read.kind ? 'worker' : 'main', kind: read.kind || 'file', bytes: read.bytes, startMs: relative(read.start), durationMs: read.end - read.start,
      ...(read.kind ? { heartbeatTicks: read.heartbeatTicks, maxHeartbeatGapMs: read.maxHeartbeatGapMs } : {}) }))
    return { readMode, elapsedMs: p.ready - p.start, postMessageMs: p.post,
      workerStartupMs: p.worker ? p.worker.boot - p.created : null,
      requestDispatchMs: p.worker ? p.worker.received - p.posted : null,
      workerToMainMs: p.sent ? p.received - p.sent : null, readyToDomMs: p.ready - p.received,
      reads, workerPhases: phaseDurations, phaseDeliveries: p.phases.map(phase => ({ phase: phase.phase, startMs: relative(phase.sent), deliveryMs: phase.sent ? phase.received - phase.sent : null })),
      maxFrameGapMs: Math.max(0, ...p.frames), maxHeartbeatGapMs: Math.max(0, ...p.gaps), p95HeartbeatGapMs: sorted[Math.floor(sorted.length * .95)],
      longTasks: p.longTasks.filter(entry => entry.start >= p.start && entry.start <= p.ready).map(entry => ({ startMs: relative(entry.start), durationMs: entry.duration })),
      peakObservedHeapBytes: Math.max(0, ...p.heap), finalHeapBytes: performance.memory?.usedJSHeapSize, domNodes: document.querySelectorAll('*').length }
  }, { readMode })
  data.browser = browser.version()
  if (process.argv[5]) await writeFile(resolve(process.argv[5]), JSON.stringify(data, null, 2))
  console.log(JSON.stringify(data))
} finally {
  await browser?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
