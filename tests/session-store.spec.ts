import { describe, expect, it } from 'vitest'
import { ExplorerSessionStore } from '../src/worker/session-store.ts'

const encoder = new TextEncoder()

function conversationArtifact(lengths: readonly number[], id = 'pages'): Uint8Array {
  return encoder.encode([
    JSON.stringify({ type: 'session', version: 4, id, createdAt: 1, delegationDepth: 0, isSeeded: false }),
    ...lengths.map((length, seq) => JSON.stringify({ type: 'user/message', seq, time: seq + 1,
      data: { role: 'user', id: `message-${seq}`, source: 'human', content: [{ type: 'text', text: 'x'.repeat(length) }] } })),
  ].join('\n'))
}

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
  it.each([
    { name: 'record-count limit', lengths: Array<number>(205).fill(10), offsets: [0, 100, 200, 205] },
    { name: 'short character-limited pages', lengths: Array<number>(10).fill(70_000), offsets: [0, 3, 6, 9, 10] },
    { name: 'exact character limit and oversized records', lengths: [131_072, 131_072, 1, 262_144, 1, 300_000, 0, 1], offsets: [0, 2, 3, 4, 5, 6, 8] },
    { name: 'empty record bodies', lengths: Array<number>(205).fill(0), offsets: [0, 100, 200, 205] },
  ])('round-trips every record across $name without skipping pages', async ({ lengths, offsets }) => {
    const store = new ExplorerSessionStore()
    await store.importFile({ name: 'session.v4.jsonl', bytes: conversationArtifact(lengths) })
    let page = store.conversationPage('pages')
    const seen: string[] = []
    for (let index = 0; index < offsets.length - 1; index++) {
      expect(page).toMatchObject({ offset: offsets[index], nextOffset: offsets[index + 1], previousOffset: offsets[Math.max(0, index - 1)] })
      const ids = lengths.slice(offsets[index], offsets[index + 1]).map((_, offset) => `pages:${offsets[index]! + offset}`)
      expect(page.records.map(record => record.eventId)).toEqual(ids)
      seen.push(...page.records.map(record => record.eventId))
      if (index < offsets.length - 2) page = store.conversationPage('pages', page.nextOffset)
    }
    expect(seen).toEqual(lengths.map((_, index) => `pages:${index}`))
    for (let index = offsets.length - 2; index > 0; index--) {
      page = store.conversationPage('pages', page.previousOffset)
      expect(page.offset).toBe(offsets[index - 1])
      expect(store.conversationPage('pages', page.nextOffset).offset).toBe(offsets[index])
    }
    expect(page.previousOffset).toBe(0)
  })

  it('normalizes direct offsets to page boundaries and handles empty/end boundaries', async () => {
    const store = new ExplorerSessionStore()
    await store.importFile({ name: 'session.v4.jsonl', bytes: conversationArtifact(Array<number>(10).fill(70_000)) })
    for (const offset of [-10, Number.NaN, 2.9]) {
      expect(store.conversationPage('pages', offset)).toMatchObject({ offset: 0, nextOffset: 3, previousOffset: 0 })
    }
    expect(store.conversationPage('pages', 8)).toMatchObject({ offset: 6, nextOffset: 9, previousOffset: 3 })
    for (const offset of [10, 1000, Number.POSITIVE_INFINITY]) {
      expect(store.conversationPage('pages', offset)).toMatchObject({ offset: 10, nextOffset: 10, previousOffset: 9, records: [] })
    }
    expect(store.conversationPage('missing')).toMatchObject({ offset: 0, nextOffset: 0, previousOffset: 0, total: 0, records: [] })
    await store.importFile({ name: 'session.v4.jsonl', bytes: conversationArtifact([]) })
    expect(store.conversationPage('pages')).toMatchObject({ offset: 0, nextOffset: 0, previousOffset: 0, total: 0, records: [] })
  })

  it('resets page boundaries when replacing a session with the same id', async () => {
    const store = new ExplorerSessionStore()
    await store.importFile({ name: 'session.v4.jsonl', bytes: conversationArtifact(Array<number>(205).fill(10)) })
    store.conversationPage('pages', 200)
    await store.importFile({ name: 'session.v4.jsonl', bytes: conversationArtifact(Array<number>(10).fill(70_000)) })
    expect(store.conversationPage('pages', 9)).toMatchObject({ offset: 9, nextOffset: 10, previousOffset: 6 })
    expect(store.conversationPage('pages', 6)).toMatchObject({ offset: 6, nextOffset: 9, previousOffset: 3 })
  })

  it('keeps independently paged sessions on their own boundaries', async () => {
    const store = new ExplorerSessionStore()
    await store.importDirectory([
      { name: 'session.v4.jsonl', path: 'session.v4.jsonl', bytes: conversationArtifact(Array<number>(10).fill(70_000)) },
      { name: 'session.v4.jsonl', path: 'subagents/child/session.v4.jsonl', bytes: conversationArtifact(Array<number>(205).fill(10), 'child') },
    ])
    expect(store.conversationPage('pages', 9)).toMatchObject({ offset: 9, previousOffset: 6, nextOffset: 10 })
    expect(store.conversationPage('child', 200)).toMatchObject({ offset: 200, previousOffset: 100, nextOffset: 205 })
    expect(store.conversationPage('pages', 6)).toMatchObject({ offset: 6, previousOffset: 3, nextOffset: 9 })
    expect(store.conversationPage('child', 100)).toMatchObject({ offset: 100, previousOffset: 0, nextOffset: 200 })
  })

  it('sends bounded execution and conversation windows while preserving every raw event in the store', async () => {
    const rows: unknown[] = [{ type: 'session', version: 4, id: 'large', createdAt: 1, delegationDepth: 0, isSeeded: false }]
    let seq = 0
    for (let step = 1; step <= 105; step++) {
      rows.push({ type: 'step/start', seq: seq++, time: step, data: { turn: 1, step } })
      rows.push({ type: 'assistant/message', seq: seq++, time: step, data: { turn: 1, step, message: { content: [{ type: 'text', text: `response-${step}` }] }, stream: [] } })
    }
    const store = new ExplorerSessionStore()
    await store.importFile({ name: 'session.v4.jsonl', bytes: encoder.encode(rows.map(row => JSON.stringify(row)).join('\n')) })
    expect(store.initialView()?.sessions[0]?.execution[0]?.steps).toHaveLength(40)
    expect(store.sessionPage('large', 40)?.execution[0]?.steps[0]?.step).toBe(41)
    expect(store.sessionPage('large', 80)?.execution[0]?.steps).toHaveLength(25)
    expect(store.conversationPage('large').records).toHaveLength(100)
    expect(store.conversationPage('large', 100)).toMatchObject({ total: 105, nextOffset: 105 })
    expect(store.event('large:209')?.seq).toBe(209)
  })
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
