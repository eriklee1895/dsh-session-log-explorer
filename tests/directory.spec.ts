import { describe, expect, it } from 'vitest'
import { importDshDirectory } from '../src/worker/importer.ts'

const encoder = new TextEncoder()

function artifact(id: string, parentSession?: string): Uint8Array {
  return encoder.encode([
    JSON.stringify({
      type: 'session', version: 0, id, createdAt: 1_700_000_000_000, delegationDepth: parentSession === undefined ? 0 : 1,
      ...(parentSession === undefined ? {} : { parentSession }),
    }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: 1_700_000_000_100, data: { turn: 0 } }),
  ].join('\n') + '\n')
}

describe('importDshDirectory', () => {
  it('loads a selected DSH session directory and its media without uploading bytes', async () => {
    const result = await importDshDirectory([
      { path: 'session.jsonl', name: 'session.jsonl', bytes: artifact('root') },
      { path: 'subagents/child/session.jsonl', name: 'session.jsonl', bytes: artifact('child', 'root') },
      { path: 'media/sha256:image.png', name: 'sha256:image.png', bytes: Uint8Array.of(137, 80, 78, 71) },
    ])

    expect(result.rootSessionId).toBe('root')
    expect(result.sessions.map(session => session.header.id)).toEqual(['root', 'child'])
    expect(result.media.has('sha256:image.png')).toBe(true)
  })
})
