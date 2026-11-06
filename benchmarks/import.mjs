// Node 24+: generate deterministic public data or compare isolated import phases.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate'

if (process.argv[2] === 'generate') {
  const directory = resolve(process.argv[3] ?? '/tmp/dsh-import-benchmark')
  const turns = Number(process.argv[4] ?? 100)
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > 10_000) throw new Error('turns must be an integer from 1 to 10000')
  let seed = 123456789
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/'
  const noise = length => {
    let text = ''
    for (let index = 0; index < length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += alphabet[(seed >>> 24) & 63] }
    return text
  }
  const rows = [{ type: 'session', version: 4, id: 'synthetic-large', createdAt: 100, isSeeded: false, delegationDepth: 0 }]
  let seq = 0
  const add = (type, data, extra = {}) => { rows.push({ type, seq: seq++, time: 100 + seq, data, ...extra }) }
  for (let turn = 1; turn <= turns; turn++) {
    add('turn/start', { turn })
    add('user/message', { role: 'user', content: [{ type: 'text', text: `Synthetic review ${turn}` }] }, { surfaceOp: 'append' })
    for (let step = 1; step <= 10; step++) {
      const callId = `call-${turn}-${step}`
      add('step/start', { turn, step })
      add('assistant/message', { turn, step, message: { role: 'assistant', content: [{ type: 'text', text: `Synthetic step ${step}` }] }, stream: [] }, { surfaceOp: 'append' })
      add('tool/call', { turn, step, callId, name: 'read', arguments: '{"path":"synthetic.txt"}' })
      add('tool/result', { turn, step, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({ lines: Array.from({ length: 8 }, (_, line) => ({ line, text: noise(1024) })) }) }] } }, { surfaceOp: 'append' })
      add('step/end', { turn, step })
    }
    add('turn/end', { turn, reason: { kind: 'completed' } })
  }
  const bytes = strToU8(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  const zip = zipSync({ 'session.v4.jsonl': [bytes, { mtime: new Date('2026-01-01T00:00:00Z') }] })
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'session.v4.jsonl'), bytes)
  await writeFile(join(directory, 'session.zip'), zip)
  console.log(JSON.stringify({ jsonlBytes: bytes.length, zipBytes: zip.length, events: seq, turns, steps: turns * 10,
    jsonlSha256: createHash('sha256').update(bytes).digest('hex') }))
} else if (process.argv[2] === 'phases' && process.argv[3] && process.argv[4]) {
  const root = resolve(process.argv[3]), input = resolve(process.argv[4])
  const parser = await import(pathToFileURL(join(root, 'src/worker/parser.ts')).href)
  const { projectSession } = await import(pathToFileURL(join(root, 'src/model/projection.ts')).href)
  const start = performance.now()
  const bytes = await readFile(input), read = performance.now()
  const unpacked = input.endsWith('.zip') ? unzipSync(bytes)['session.v4.jsonl'] : bytes, extracted = performance.now()
  const session = parser.parseSessionJsonlBytes ? parser.parseSessionJsonlBytes(unpacked) : parser.parseSessionJsonl(strFromU8(unpacked))
  const parsed = performance.now()
  const projected = projectSession(session), done = performance.now()
  console.log(JSON.stringify({ fileBytes: bytes.length, readMs: read - start, unzipMs: extracted - read,
    decodeAndParseMs: parsed - extracted, projectMs: done - parsed, events: session.events.length, steps: projected.summary.steps,
    rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, maxRssKiB: process.resourceUsage().maxRSS }))
} else {
  throw new Error('Usage: node benchmarks/import.mjs generate DIRECTORY [TURNS] | phases REPOSITORY INPUT')
}
