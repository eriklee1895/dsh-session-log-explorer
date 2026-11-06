import { decodeAssistantStream, decodeStorageRecord } from './chunk-codec.ts'

export interface ExplorerSessionHeader {
  readonly type: 'session'
  readonly version: 0 | 1 | 2 | 3 | 4
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly seedLength?: number
  readonly isSeeded?: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth: number
  readonly agentPreset?: string
}

export interface ExplorerEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly ignorable?: true
  readonly sourceEventSeqs?: readonly number[]
  readonly surfaceOp?: 'append' | { readonly op: 'replace'; readonly startSeq: number; readonly endSeq: number }
  readonly storageLine: number
  readonly rawRecord: string
}

export interface ParsedSessionJsonl {
  readonly header: ExplorerSessionHeader
  readonly events: readonly ExplorerEvent[]
}

export function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseHeader(value: unknown): ExplorerSessionHeader {
  const record = recordOf(value)
  if (record?.type !== 'session') throw new Error('first line must be a DSH session header')
  if (![0, 1, 2, 3, 4].includes(record.version as number)) throw new Error(`unsupported DSH session format version ${String(record.version)}`)
  if (typeof record.id !== 'string' || record.id === '') throw new Error('session header id must be a non-empty string')
  if (!Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0) {
    throw new Error('session header createdAt must be a non-negative safe integer')
  }
  if (record.delegationDepth !== undefined && (!Number.isSafeInteger(record.delegationDepth) || (record.delegationDepth as number) < 0)) {
    throw new Error('session header delegationDepth must be a non-negative safe integer')
  }
  if (record.cwd !== undefined && typeof record.cwd !== 'string') throw new Error('session header cwd must be a string')
  if (record.parentSession !== undefined && typeof record.parentSession !== 'string') throw new Error('session header parentSession must be a string')
  if (record.seedLength !== undefined && (!Number.isSafeInteger(record.seedLength) || (record.seedLength as number) < 0)) {
    throw new Error('session header seedLength must be a non-negative safe integer')
  }
  if (record.origin !== undefined && record.origin !== 'subagent') throw new Error('session header origin must be "subagent"')
  if (record.agentPreset !== undefined && typeof record.agentPreset !== 'string') throw new Error('session header agentPreset must be a string')
  if ((record.version as number) >= 2 && typeof record.isSeeded !== 'boolean') throw new Error('session header isSeeded must be a boolean')
  return { ...record, delegationDepth: record.delegationDepth ?? 0 } as unknown as ExplorerSessionHeader
}

function sourceSeqs(value: unknown, seq: number): readonly number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('sourceEventSeqs must be an array')
  const result: number[] = []
  const seen = new Set<number>()
  for (const member of value) {
    const [start, end] = Array.isArray(member) && member.length === 2 ? member : [member, member]
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= seq) {
      throw new Error('sourceEventSeqs must name unique earlier event positions')
    }
    for (let n = start; n <= end; n++) {
      if (seen.has(n)) throw new Error('sourceEventSeqs must name unique earlier event positions')
      seen.add(n)
      result.push(n)
    }
  }
  return result
}

function eventOf(value: unknown, storageLine: number, rawRecord: string, expectedSeq: number): ExplorerEvent {
  const record = recordOf(value)
  if (record === undefined || typeof record.type !== 'string') throw new Error(`line ${String(storageLine)} is not a session event`)
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 0) {
    throw new Error(`line ${String(storageLine)} event seq must be a non-negative safe integer`)
  }
  if (record.seq !== expectedSeq) throw new Error(`line ${storageLine} event seq ${String(record.seq)} does not continue expected seq ${expectedSeq}`)
  if (!Number.isSafeInteger(record.time)) throw new Error(`line ${String(storageLine)} event time must be a safe integer`)
  const data = recordOf(record.data)
  if (data === undefined && record.ignorable !== true) throw new Error(`line ${String(storageLine)} event data must be an object`)
  if (!Object.hasOwn(record, 'data')) throw new Error(`line ${String(storageLine)} event data is missing`)
  const seq = record.seq as number
  const refs = sourceSeqs(record.sourceEventSeqs, seq)
  const op = record.surfaceOp
  let surfaceOp: ExplorerEvent['surfaceOp']
  if (op === 'append') surfaceOp = op
  else if (op !== undefined) {
    const replace = recordOf(op)
    const start = replace?.startSeq ?? replace?.start
    const end = replace?.endSeq ?? replace?.end
    if (replace?.op !== 'replace' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || (start as number) < 0 || (end as number) < 0 || (start as number) >= seq || (end as number) >= seq) {
      throw new Error(`line ${storageLine} has invalid surfaceOp`)
    }
    surfaceOp = { op: 'replace', startSeq: start as number, endSeq: end as number }
  }
  if (record.type === 'assistant/message' || record.type === 'assistant/attempt') {
    if (data?.stream !== undefined) {
      try { decodeAssistantStream(data.stream) } catch (error) {
        throw new Error(`line ${storageLine} cannot decode assistant stream: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return {
    type: record.type,
    seq: record.seq as number,
    time: record.time as number,
    data: record.data,
    ...(record.ignorable === true ? { ignorable: true } : {}),
    ...(refs === undefined ? {} : { sourceEventSeqs: refs }),
    ...(surfaceOp === undefined ? {} : { surfaceOp }),
    storageLine,
    rawRecord,
  }
}

/** Incrementally accepts complete storage lines without retaining a second split-line array. */
class SessionJsonlReader {
  private header: ExplorerSessionHeader | undefined
  private readonly events: ExplorerEvent[] = []
  private storageLine = 0

  line(rawRecord: string, readRaw?: () => string): void {
    this.storageLine++
    if (this.storageLine === 1) {
      let value: unknown
      try { value = JSON.parse(rawRecord) } catch { throw new Error('first line must be a DSH session header') }
      this.header = parseHeader(value)
      return
    }
    if (rawRecord === '' || rawRecord === '\r') return
    let stored: unknown
    try { stored = JSON.parse(rawRecord) } catch { throw new Error(`line ${this.storageLine} is not valid JSON`) }
    let expanded: readonly unknown[]
    try { expanded = decodeStorageRecord(stored) } catch (error) {
      throw new Error(`line ${this.storageLine} cannot decode: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const decoded of expanded) {
      const event = eventOf(decoded, this.storageLine, rawRecord, this.events.length)
      if (readRaw !== undefined) Object.defineProperty(event, 'rawRecord', { get: readRaw, enumerable: true })
      this.events.push(event)
    }
  }

  finish(): ParsedSessionJsonl {
    if (this.header === undefined) throw new Error('first line must be a DSH session header')
    return { header: this.header, events: this.events }
  }
}

/** Read V0–V4 without migrating or renumbering durable events. */
export function parseSessionJsonl(text: string): ParsedSessionJsonl {
  const reader = new SessionJsonlReader()
  let start = 0
  let end: number
  while ((end = text.indexOf('\n', start)) >= 0) { reader.line(text.slice(start, end)); start = end + 1 }
  if (start < text.length || text.length === 0) reader.line(text.slice(start))
  return reader.finish()
}

/** Decode one UTF-8 storage line at a time; retain immutable source bytes for on-demand raw inspection. */
export function parseSessionJsonlBytes(bytes: Uint8Array): ParsedSessionJsonl {
  const reader = new SessionJsonlReader()
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  let start = 0
  const line = (from: number, to: number): void => {
    const readRaw = (): string => decoder.decode(bytes.subarray(from, to))
    reader.line(readRaw(), readRaw)
  }
  let end: number
  while ((end = bytes.indexOf(10, start)) >= 0) { line(start, end); start = end + 1 }
  if (start < bytes.length || bytes.length === 0) line(start, bytes.length)
  return reader.finish()
}
