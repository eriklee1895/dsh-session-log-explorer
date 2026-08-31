import { decodeStorageRecord } from './chunk-codec.ts'

export interface ExplorerSessionHeader {
  readonly type: 'session'
  readonly version: 0
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly seedLength?: number
  readonly origin?: 'subagent'
  readonly delegationDepth: number
  readonly agentPreset?: string
}

export interface ExplorerEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
  readonly storageLine: number
  readonly rawRecord: string
}

export interface ParsedSessionJsonl {
  readonly header: ExplorerSessionHeader
  readonly events: readonly ExplorerEvent[]
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseHeader(value: unknown): ExplorerSessionHeader {
  const record = recordOf(value)
  if (record?.type !== 'session') throw new Error('first line must be a DSH session header')
  if (record.version !== 0) throw new Error(`unsupported DSH session format version ${String(record.version)}`)
  if (typeof record.id !== 'string' || record.id === '') throw new Error('session header id must be a non-empty string')
  if (!Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0) {
    throw new Error('session header createdAt must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(record.delegationDepth) || (record.delegationDepth as number) < 0) {
    throw new Error('session header delegationDepth must be a non-negative safe integer')
  }
  if (record.cwd !== undefined && typeof record.cwd !== 'string') throw new Error('session header cwd must be a string')
  if (record.parentSession !== undefined && typeof record.parentSession !== 'string') throw new Error('session header parentSession must be a string')
  if (record.seedLength !== undefined && (!Number.isSafeInteger(record.seedLength) || (record.seedLength as number) < 0)) {
    throw new Error('session header seedLength must be a non-negative safe integer')
  }
  if (record.origin !== undefined && record.origin !== 'subagent') throw new Error('session header origin must be "subagent"')
  if (record.agentPreset !== undefined && typeof record.agentPreset !== 'string') throw new Error('session header agentPreset must be a string')
  return record as unknown as ExplorerSessionHeader
}

function eventOf(value: unknown, storageLine: number, rawRecord: string): ExplorerEvent {
  const record = recordOf(value)
  if (record === undefined || typeof record.type !== 'string') throw new Error(`line ${String(storageLine)} is not a session event`)
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 0) {
    throw new Error(`line ${String(storageLine)} event seq must be a non-negative safe integer`)
  }
  if (!Number.isSafeInteger(record.time)) throw new Error(`line ${String(storageLine)} event time must be a safe integer`)
  const data = recordOf(record.data)
  if (data === undefined) throw new Error(`line ${String(storageLine)} event data must be an object`)
  return {
    type: record.type,
    seq: record.seq as number,
    time: record.time as number,
    data,
    storageLine,
    rawRecord,
  }
}

/** Parse one plaintext DSH v0 session artifact without changing its contents. */
export function parseSessionJsonl(text: string): ParsedSessionJsonl {
  const lines = text.split('\n')
  const first = lines[0]
  if (first === undefined || first === '') throw new Error('first line must be a DSH session header')
  let headerValue: unknown
  try {
    headerValue = JSON.parse(first)
  } catch {
    throw new Error('first line must be a DSH session header')
  }
  const header = parseHeader(headerValue)
  const events: ExplorerEvent[] = []
  let expectedSeq = 0
  for (let index = 1; index < lines.length; index++) {
    const rawRecord = lines[index]
    if (rawRecord === undefined || rawRecord === '') continue
    const storageLine = index + 1
    let stored: unknown
    try {
      stored = JSON.parse(rawRecord)
    } catch {
      throw new Error(`line ${String(storageLine)} is not valid JSON`)
    }
    let expanded: readonly unknown[]
    try {
      expanded = decodeStorageRecord(stored)
    } catch (error: unknown) {
      throw new Error(`line ${String(storageLine)} cannot decode: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const decoded of expanded) {
      const event = eventOf(decoded, storageLine, rawRecord)
      if (event.seq !== expectedSeq) {
        throw new Error(`line ${String(storageLine)} event seq ${String(event.seq)} does not continue expected seq ${String(expectedSeq)}`)
      }
      events.push(event)
      expectedSeq++
    }
  }
  return { header, events }
}
