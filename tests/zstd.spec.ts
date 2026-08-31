import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { importDshFile } from '../src/worker/importer.ts'

describe('importDshFile', () => {
  it('reads a Zstandard-compressed DSH session artifact', async () => {
    const jsonl = [
      JSON.stringify({ type: 'session', version: 0, id: 'compressed', createdAt: 1_700_000_000_000, delegationDepth: 0 }),
      JSON.stringify({ type: 'turn/start', seq: 0, time: 1_700_000_000_100, data: { turn: 0 } }),
    ].join('\n') + '\n'

    const result = await importDshFile({ name: 'session.jsonl.zstd', bytes: zstdCompressSync(jsonl) })

    expect(result.header.id).toBe('compressed')
    expect(result.events).toHaveLength(1)
  })

  it('reads the concatenated Zstandard frames written by the default DSH backend', async () => {
    const header = `${JSON.stringify({ type: 'session', version: 0, id: 'framed', createdAt: 1_700_000_000_000, delegationDepth: 0 })}\n`
    const events = `${JSON.stringify({ type: 'turn/start', seq: 0, time: 1_700_000_000_100, data: { turn: 0 } })}\n`
    const bytes = new Uint8Array(Buffer.concat([zstdCompressSync(header), zstdCompressSync(events)]))

    const result = await importDshFile({ name: 'session.jsonl.zstd', bytes })

    expect(result.header.id).toBe('framed')
    expect(result.events).toHaveLength(1)
  })

  it('refuses an unsupported file extension', async () => {
    await expect(importDshFile({ name: 'session.txt', bytes: new TextEncoder().encode('not a session') }))
      .rejects.toThrow('unsupported session artifact')
  })

  it('refuses damaged Zstandard bytes', async () => {
    await expect(importDshFile({ name: 'damaged.jsonl.zstd', bytes: Uint8Array.of(0, 1, 2, 3) }))
      .rejects.toThrow('cannot decompress Zstandard session artifact')
  })
})
