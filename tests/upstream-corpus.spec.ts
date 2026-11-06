import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSessionJsonl } from '../src/worker/parser.ts'
import { projectSession } from '../src/model/projection.ts'

/** Upstream golden snapshots intentionally omit envelope coordinates. Restore them only in tests. */
function restoreSnapshot(text: string): string {
  const rows: Record<string, unknown>[] = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
  const header = rows[0]!
  let seq = 0
  for (const row of rows.slice(1)) {
    const packed = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(String(row.type))
    row[packed ? 'seq0' : 'seq'] = seq
    row[packed ? 'time0' : 'time'] = Number(header.createdAt) + seq
    const data = row.data as Record<string, unknown>
    const count = packed ? (data.texts ?? data.args) as unknown[] : [row]
    seq += count.length
  }
  return rows.map(row => JSON.stringify(row)).join('\n') + '\n'
}

function logsUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? logsUnder(join(directory, entry.name)) : /^session(?:\.[0-9]+)?(?:\.v[1-4])?\.jsonl$/.test(entry.name) ? [join(directory, entry.name)] : [])
}

describe('public upstream snapshot payloads', () => {
  it.each([0, 1, 2, 3, 4])('reads and projects the pinned V%i regression fixture', version => {
    const text = readFileSync(new URL(`./fixtures/upstream/v${version}.jsonl`, import.meta.url), 'utf8')
    const session = parseSessionJsonl(text)
    expect(session.header.version).toBe(version)
    const projection = projectSession(session)
    expect(projection.events.size).toBe(session.events.length)
    expect(projection.summary.turns).toBe(session.events.filter(event => event.type === 'turn/start').length)
    expect(projection.summary.toolCalls).toBe(session.events.filter(event => event.type === 'tool/call').length)
    expect(projection.execution.length).toBeGreaterThan(0)
    for (const event of session.events) expect(JSON.parse(event.rawRecord)).toBeTypeOf('object')
  })

  it.skipIf(!process.env.DSH_SOURCE_DIR)('reads every public session snapshot in an explicitly selected upstream checkout', () => {
    const paths = logsUnder(join(process.env.DSH_SOURCE_DIR!, 'snapshots'))
    expect(paths.length).toBeGreaterThan(0)
    const failures: string[] = []
    const versions = new Set<number>()
    let eventCount = 0
    for (const path of paths) {
      try {
        const session = parseSessionJsonl(restoreSnapshot(readFileSync(path, 'utf8')))
        versions.add(session.header.version)
        const projection = projectSession(session)
        expect(projection.events.size).toBe(session.events.length)
        eventCount += session.events.length
      } catch (error) { failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    console.info(`Upstream corpus: ${paths.length} snapshots, ${eventCount} events, formats ${[...versions].sort().join(',')}`)
    expect(failures).toEqual([])
  })
})
