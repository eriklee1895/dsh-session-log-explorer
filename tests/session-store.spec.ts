import { describe, expect, it } from 'vitest'
import { ExplorerSessionStore } from '../src/worker/session-store.ts'

const encoder = new TextEncoder()

function artifact(id: string, parentSession?: string): Uint8Array {
  return encoder.encode([
    JSON.stringify({ type: 'session', version: 0, id, createdAt: 1_700_000_000_000, delegationDepth: parentSession === undefined ? 0 : 1, ...(parentSession === undefined ? {} : { parentSession }) }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: 10, data: { turn: 0 } }),
    JSON.stringify({ type: 'user/message', seq: 1, time: 12, data: { role: 'user', id: 'm', source: 'human', content: [{ type: 'text', text: id }] } }),
  ].join('\n') + '\n')
}

function artifactWithMissingImage(): Uint8Array {
  return encoder.encode([
    JSON.stringify({ type: 'session', version: 0, id: 'missing-image', createdAt: 1_700_000_000_000, delegationDepth: 0 }),
    JSON.stringify({ type: 'user/message', seq: 0, time: 10, data: { role: 'user', id: 'm', source: 'human', content: [{ type: 'image', attachment: { attachmentId: 'sha256:missing' } }] } }),
  ].join('\n') + '\n')
}

describe('ExplorerSessionStore', () => {
  it('keeps session content private until an event detail is requested', async () => {
    const store = new ExplorerSessionStore()
    const view = await store.importDirectory([
      { path: 'session.jsonl', name: 'session.jsonl', bytes: artifact('root') },
      { path: 'subagents/child/session.jsonl', name: 'session.jsonl', bytes: artifact('child', 'root') },
      { path: 'media/sha256:image.png', name: 'sha256:image.png', bytes: Uint8Array.of(137, 80, 78, 71) },
    ])

    expect(view.rootSessionId).toBe('root')
    expect(view.sessions[0]).toMatchObject({ id: 'root', eventCount: 2 })
    expect(view.sessions[0]).not.toHaveProperty('parentSessionId')
    expect(view.sessions[0]).not.toHaveProperty('conversation')
    expect(view.sessions[1]).toMatchObject({ id: 'child', parentSessionId: 'root', eventCount: 2 })
    expect(store.conversation('root')).toMatchObject([{ content: 'root' }])
    expect(store.event('root:1')?.type).toBe('user/message')
    expect(store.event('root:1')?.data).toBeTypeOf('object')
    expect(store.media('sha256:image.png')).toEqual(Uint8Array.of(137, 80, 78, 71))
  })

  it('reports image references absent from the selected export', async () => {
    const store = new ExplorerSessionStore()
    const view = await store.importDirectory([{ path: 'session.jsonl', name: 'session.jsonl', bytes: artifactWithMissingImage() }])

    expect(view.missingMediaNames).toEqual(['sha256:missing'])
  })
})
