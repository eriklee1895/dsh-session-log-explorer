import type { ExplorerEvent } from './parser.ts'
import { isErrorEvent, messageSource } from '../model/event-facts.ts'
import { recordOf } from './parser.ts'

export interface SessionSearchRequest {
  readonly query: string
  readonly sessionId?: string
  readonly eventType?: string
  readonly source?: string
  readonly tool?: string
  readonly errorsOnly?: boolean
  readonly offset?: number
}

export interface SessionSearchHit {
  readonly sessionId: string
  readonly eventId: string
  readonly eventType: string
  readonly seq: number
  readonly time: number
  readonly source: string
  readonly tool?: string
  readonly isError: boolean
  readonly excerpt: string
}

export interface SessionSearchPage {
  readonly results: readonly SessionSearchHit[]
  readonly total: number
  readonly offset: number
  readonly previousOffset: number
  readonly nextOffset: number
  readonly facets: { readonly eventTypes: readonly string[]; readonly sources: readonly string[]; readonly tools: readonly string[] }
}

export interface SearchEntry { readonly sessionId: string; readonly eventId: string; readonly event: ExplorerEvent; readonly tool?: string }

/** Traverse parsed JSON values. Never enumerate ExplorerEvent.rawRecord's lazy getter. */
function* textValues(value: unknown): Generator<string> {
  if (typeof value === 'string') { yield value; return }
  if (value === null || typeof value !== 'object') { yield String(value); return }
  const stack = [Object.entries(value)[Symbol.iterator]()]
  while (stack.length > 0) {
    const item = stack[stack.length - 1]!.next()
    if (item.done) { stack.pop(); continue }
    const [key, child] = item.value
    if (child === undefined) continue
    yield key
    if (child !== null && typeof child === 'object') stack.push(Object.entries(child)[Symbol.iterator]())
    else yield String(child)
  }
}

function excerpt(value: string, index: number): string {
  let start = Math.max(0, index - 60)
  if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start]!)) start--
  let end = Math.min(value.length, start + 236)
  if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--
  return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`
}

/** Literal, case-insensitive full-event search with bounded replies and cooperative cancellation. */
export async function searchEvents(entries: Iterable<SearchEntry>, request: SessionSearchRequest,
  isCurrent: () => boolean = () => true): Promise<SessionSearchPage | undefined> {
  const query = request.query.trim().slice(0, 500)
  // Escape the literal query; match offsets stay in the original string even when case folding changes length.
  const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
  const requestedOffset = Math.max(0, Math.floor(request.offset || 0))
  const results: SessionSearchHit[] = []
  const eventTypes = new Set<string>(), sources = new Set<string>(), tools = new Set<string>()
  let total = 0, scanned = 0, yieldedAt = performance.now()
  const active = query !== '' || request.errorsOnly || request.eventType || request.source || request.tool
  for (const entry of entries) {
    if ((scanned++ & 127) === 0) {
      if (!isCurrent()) return undefined
      if (performance.now() - yieldedAt > 10) {
        await new Promise<void>(resolve => { setTimeout(resolve, 0) })
        yieldedAt = performance.now()
        if (!isCurrent()) return undefined
      }
    }
    if (request.sessionId !== undefined && entry.sessionId !== request.sessionId) continue
    const { event } = entry
    const data = recordOf(event.data)
    const source = messageSource(recordOf(data?.message) ?? event.data)
    if (eventTypes.size < 100) eventTypes.add(event.type)
    if (sources.size < 100) sources.add(source)
    if (entry.tool !== undefined && tools.size < 100) tools.add(entry.tool)
    const isError = isErrorEvent(event)
    if (!active || (request.errorsOnly && !isError) || (request.eventType && event.type !== request.eventType)
      || (request.source && source !== request.source) || (request.tool && entry.tool !== request.tool)) continue
    let matched: string | undefined
    if (query === '') matched = event.type
    else for (const text of textValues({ type: event.type, seq: event.seq, time: event.time, data: event.data,
      surfaceOp: event.surfaceOp, sourceEventSeqs: event.sourceEventSeqs, ignorable: event.ignorable })) {
      const match = matcher.exec(text)
      if (match !== null) { matched = excerpt(text, match.index); break }
    }
    if (matched === undefined) continue
    if (total >= requestedOffset && results.length < 50) results.push({ sessionId: entry.sessionId, eventId: entry.eventId,
      eventType: event.type, seq: event.seq, time: event.time, source, tool: entry.tool, isError, excerpt: matched.slice(0, 240) })
    total++
  }
  if (!isCurrent()) return undefined
  const offset = Math.min(requestedOffset, total)
  return { results, total, offset, previousOffset: offset === 0 ? 0 : Math.floor((offset - 1) / 50) * 50,
    nextOffset: offset + results.length,
    facets: { eventTypes: [...eventTypes].sort(), sources: [...sources].sort(), tools: [...tools].sort() } }
}
