import { describe, expect, it } from 'vitest'
import { ExplorerSessionStore } from '../src/worker/session-store.ts'

const encode = new TextEncoder()
function artifact(id: string, count = 105): Uint8Array {
  const rows: unknown[] = [{ type: 'session', version: 4, id, createdAt: 1, delegationDepth: 0, isSeeded: false }]
  let seq = 0
  for (let step = 1; step <= count; step++) {
    rows.push({ type: 'step/start', seq: seq++, time: step, data: { turn: 1, step } })
    rows.push({ type: 'assistant/message', seq: seq++, time: step, data: { turn: 1, step,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(220) + ` Needle 中文 ${step} <script>` }] }, stream: [] } })
  }
  return encode.encode(rows.map(row => JSON.stringify(row)).join('\n'))
}

describe('Worker session search', () => {
  it('searches full text beyond previews and execution pages, with bounded stable result pages', async () => {
    const store = new ExplorerSessionStore()
    await store.importFile({ name: 'session.v4.jsonl', bytes: artifact('root') })
    const first = await store.search({ query: 'needle 中文', sessionId: 'root' })
    expect(first?.total).toBe(105)
    expect(first?.results).toHaveLength(50)
    expect(first?.results[0]).toMatchObject({ sessionId: 'root', eventId: 'root:1', seq: 1 })
    expect(first?.results[0]?.excerpt).toContain('Needle 中文 1')
    expect(first?.results.every(result => result.excerpt.length <= 240)).toBe(true)
    const second = await store.search({ query: 'needle 中文', sessionId: 'root', offset: first!.nextOffset })
    expect(second?.results[0]?.eventId).toBe('root:101')
    expect(new Set([...first!.results, ...second!.results].map(result => result.eventId)).size).toBe(100)
    const last = await store.search({ query: 'needle 中文', sessionId: 'root', offset: 100 })
    expect(last?.results).toHaveLength(5)
    expect(last?.nextOffset).toBe(105)
    expect(store.reveal('root:209')).toMatchObject({ sessionId: 'root', session: { id: 'root', page: { offset: 80 } } })
    expect((await store.search({ query: '209', eventType: 'assistant/message' }))?.results.map(result => result.eventId)).toEqual(['root:209'])
  })

  it('keeps current/all-session scopes explicit and supports error/tool/source/type filters', async () => {
    const store = new ExplorerSessionStore()
    const events = [
      { type: 'session', version: 4, id: 'child', createdAt: 1, delegationDepth: 1, origin: 'subagent', parentSession: 'root', isSeeded: false },
      { type: 'tool/call', seq: 0, time: 1, data: { turn: 1, step: 1, callId: 'c', name: 'shell', arguments: 'needle input' } },
      { type: 'tool/result', seq: 1, time: 2, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c', isError: true, content: [{ type: 'text', text: 'needle failure' }] } } },
      { type: 'user/message', seq: 2, time: 3, data: { role: 'user', source: { kind: 'future-context' }, content: [{ type: 'text', text: 'needle source' }] } },
    ]
    await store.importDirectory([{ name: 'session.v4.jsonl', path: 'session.v4.jsonl', bytes: artifact('root', 1) },
      { name: 'session.v4.jsonl', path: 'subagents/child/session.v4.jsonl', bytes: encode.encode(events.map(row => JSON.stringify(row)).join('\n')) }])
    expect((await store.search({ query: 'needle', sessionId: 'root' }))?.total).toBe(1)
    expect((await store.search({ query: 'needle' }))?.total).toBe(4)
    expect((await store.search({ query: '', errorsOnly: true }))?.results.map(result => result.eventId)).toEqual(['child:1'])
    expect((await store.search({ query: 'needle', tool: 'shell' }))?.results.map(result => result.eventId)).toEqual(['child:0', 'child:1'])
    expect((await store.search({ query: '', source: 'future-context' }))?.results.map(result => result.eventId)).toEqual(['child:2'])
    expect((await store.search({ query: '', eventType: 'tool/result' }))?.total).toBe(1)
    expect(store.reveal('child:1')?.tool).toMatchObject({ callEventId: 'child:0', resultEventId: 'child:1', output: 'needle failure' })
  })

  it('handles empty/missing scopes, literal punctuation and cancelled searches', async () => {
    const store = new ExplorerSessionStore()
    expect((await store.search({ query: '' }))?.results).toEqual([])
    await store.importFile({ name: 'session.v4.jsonl', bytes: artifact('root', 1) })
    expect((await store.search({ query: '<script>' }))?.total).toBe(1)
    expect((await store.search({ query: '.*' }))?.total).toBe(0)
    expect((await store.search({ query: 'undefined' }))?.total).toBe(0)
    expect((await store.search({ query: 'ignorable' }))?.total).toBe(0)
    expect((await store.search({ query: 'needle', sessionId: 'missing' }))?.total).toBe(0)
    expect(await store.search({ query: 'needle' }, () => false)).toBeUndefined()
    expect(store.reveal('missing:0')).toBeUndefined()
  })
})
