// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSessionLoader } from '../src/useSessionLoader.ts'
import type { ExplorerImportView } from '../src/worker/session-store.ts'

class WorkerStub {
  static instance: WorkerStub
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { WorkerStub.instance = this }
  respond(data: unknown) { act(() => { this.onmessage?.({ data } as MessageEvent) }) }
}
const session = (id: string) => ({ id, sourcePath: 'session.v4.jsonl', eventCount: 2,
  summary: { turns: 1, steps: 1, toolCalls: 0, toolResults: 0, errors: 0, durationMs: 1, tokens: {} }, execution: [], timeline: [], promptEpochs: [] })
const view: ExplorerImportView = { rootSessionId: 'root', sessions: [session('root'), session('child')], mediaNames: [], missingMediaNames: [] }
const page = { results: [], total: 1, offset: 0, previousOffset: 0, nextOffset: 1, facets: { sources: [], tools: [], eventTypes: [] } }
function load() {
  vi.stubGlobal('Worker', WorkerStub)
  const result = renderHook(() => useSessionLoader()).result
  act(() => { result.current.importFiles([new File(['{}'], 'session.zip')]) })
  WorkerStub.instance.respond({ type: 'ready', view })
  return result
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('ignores old search replies and reveals the exact child session/page', () => {
  const result = load()
  act(() => { result.current.runSearch({ query: 'first' }) })
  const first = WorkerStub.instance.postMessage.mock.calls.at(-1)![0]
  act(() => { result.current.runSearch({ query: 'second' }) })
  const second = WorkerStub.instance.postMessage.mock.calls.at(-1)![0]
  WorkerStub.instance.respond({ type: 'search', requestId: first.requestId, page })
  expect(result.current.searchResults).toBeUndefined()
  expect(result.current.searchBusy).toBe(true)
  WorkerStub.instance.respond({ type: 'search', requestId: second.requestId, page })
  expect(result.current.searchResults?.total).toBe(1)
  act(() => { result.current.revealEvent('child:1') })
  const selection = WorkerStub.instance.postMessage.mock.calls.at(-1)![0]
  WorkerStub.instance.respond({ type: 'event', requestId: selection.requestId, eventId: 'child:1',
    event: { type: 'agent/error', seq: 1, time: 1, data: {}, rawRecord: '{}', storageLine: 1 }, sessionId: 'child', session: session('child') })
  expect(result.current.sessionId).toBe('child')
  expect(result.current.selectedEventId).toBe('child:1')
  expect(result.current.searchResults?.total).toBe(1)
})

it('invalidates a current-session search when the selected session changes', () => {
  const result = load()
  act(() => { result.current.runSearch({ query: 'needle', sessionId: 'root' }) })
  const request = WorkerStub.instance.postMessage.mock.calls.at(-1)![0]
  act(() => { result.current.selectSession('child') })
  WorkerStub.instance.respond({ type: 'search', requestId: request.requestId, page })
  expect(result.current.searchResults).toBeUndefined()
  expect(result.current.searchBusy).toBe(false)
})

it('ignores event replies that arrive after changing the selected session', () => {
  const result = load()
  act(() => { result.current.selectEvent('root:1') })
  const request = WorkerStub.instance.postMessage.mock.calls.at(-1)![0]
  act(() => { result.current.selectSession('child') })
  WorkerStub.instance.respond({ type: 'event', requestId: request.requestId, eventId: 'root:1', event: { type: 'agent/error' } })
  expect(result.current.event).toBeUndefined()
  expect(result.current.sessionId).toBe('child')
})
