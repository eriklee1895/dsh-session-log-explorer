import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { importDshArchive } from '../src/worker/importer.ts'

function session(id: string, parentSession?: string): string {
  return [
    JSON.stringify({
      type: 'session',
      version: 0,
      id,
      createdAt: 1_700_000_000_000,
      delegationDepth: parentSession === undefined ? 0 : 1,
      ...(parentSession === undefined ? {} : { parentSession }),
    }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: 1_700_000_000_100, data: { turn: 0 } }),
  ].join('\n') + '\n'
}

describe('importDshArchive', () => {
  it('loads the root, descendant sessions, and media from a DSH export ZIP', async () => {
    const archive = zipSync({
      'session.jsonl': strToU8(session('root')),
      'subagents/child/session.jsonl': strToU8(session('child', 'root')),
      'media/sha256:image.png': Uint8Array.of(137, 80, 78, 71),
    })

    const result = await importDshArchive({ name: 'dsh-session-root.zip', bytes: archive })

    expect(result.rootSessionId).toBe('root')
    expect(result.sessions.map(value => value.header.id)).toEqual(['root', 'child'])
    expect(result.sessions[1]?.parentSessionId).toBe('root')
    expect(result.media.get('sha256:image.png')).toEqual(Uint8Array.of(137, 80, 78, 71))
  })

  it('refuses a ZIP that has no root session artifact', async () => {
    await expect(importDshArchive({ name: 'missing-root.zip', bytes: zipSync({ 'notes.txt': strToU8('no session') }) }))
      .rejects.toThrow('ZIP does not contain session.jsonl')
  })
})
