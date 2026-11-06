/** Browser-safe decoder for DSH's lossless packed assistant-chunk storage rows. */

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function invalid(tag: string, reason: string): never {
  throw new Error(`malformed ${tag} storage row: ${reason}`)
}

interface BaseRun {
  readonly turn: number
  readonly step: number
  readonly index: number
  readonly dt: readonly number[]
}

function runBase(tag: string, data: Record<string, unknown>, payload: 'texts' | 'args'): BaseRun & { readonly values: readonly string[] } {
  if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') invalid(tag, 'turn/step/index must be numbers')
  const values = data[payload]
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== 'string')) invalid(tag, `${payload} must be a non-empty string array`)
  const dt = data.dt
  if (!Array.isArray(dt) || dt.some(value => !Number.isSafeInteger(value))) invalid(tag, 'dt must be an array of safe integers')
  if (dt.length !== values.length - 1) invalid(tag, `dt length ${String(dt.length)} does not match ${String(values.length)} members`)
  return { turn: data.turn, step: data.step, index: data.index, dt: dt as number[], values: values as string[] }
}

function envelope(
  tag: string,
  row: Record<string, unknown>,
): { readonly seq0: number; readonly time0: number; readonly data: Record<string, unknown> } {
  if (!exactKeys(row, ['type', 'seq0', 'time0', 'data'])) invalid(tag, 'envelope must be exactly {type, seq0, time0, data}')
  if (!Number.isSafeInteger(row.seq0) || (row.seq0 as number) < 0) invalid(tag, 'seq0 must be a non-negative safe integer')
  if (!Number.isSafeInteger(row.time0)) invalid(tag, 'time0 must be a safe integer')
  const data = recordOf(row.data)
  if (data === undefined) invalid(tag, 'data must be an object')
  return { seq0: row.seq0 as number, time0: row.time0 as number, data }
}

function times(time0: number, gaps: readonly number[]): readonly number[] {
  const output = [time0]
  for (const gap of gaps) {
    const previous = output.at(-1)
    if (previous === undefined) throw new Error('packed chunk row has no time anchor')
    if (!Number.isSafeInteger(previous + gap)) throw new Error('packed chunk timestamp exceeds safe integers')
    output.push(previous + gap)
  }
  return output
}

function textRow(tag: 'text-chunks' | 'reasoning-chunks', row: Record<string, unknown>): unknown[] {
  const { seq0, time0, data } = envelope(tag, row)
  const run = runBase(tag, data, 'texts')
  const chunkType = tag === 'text-chunks' ? 'text-delta' : 'reasoning-delta'
  const at = times(time0, run.dt)
  return run.values.map((text, index) => ({
    type: 'assistant/chunk', seq: seq0 + index, time: at[index],
    data: { turn: run.turn, step: run.step, chunk: { type: chunkType, index: run.index, text } },
  }))
}

export interface TimedAssistantChunk {
  readonly time: number
  readonly chunk: Record<string, unknown>
}

/** Decode V2+ embedded runs without inventing Session sequence positions. */
export function decodeAssistantStream(value: unknown): readonly TimedAssistantChunk[] {
  if (!Array.isArray(value)) throw new Error('assistant stream must be an array')
  return value.flatMap((candidate): TimedAssistantChunk[] => {
    const row = recordOf(candidate)
    if (row === undefined) throw new Error('assistant stream record must be an object')
    if (row.type === 'chunk') {
      const chunk = recordOf(row.chunk)
      if (!exactKeys(row, ['type', 'time', 'chunk']) || !Number.isSafeInteger(row.time) || chunk === undefined || typeof chunk.type !== 'string') {
        throw new Error('invalid assistant stream raw chunk')
      }
      return [{ time: row.time as number, chunk }]
    }
    if (row.type !== 'text-chunks' && row.type !== 'reasoning-chunks' && row.type !== 'tool-call-chunks') {
      throw new Error(`unsupported assistant stream record ${String(row.type)}`)
    }
    if (!Number.isSafeInteger(row.index) || (row.index as number) < 0) throw new Error('assistant stream index must be non-negative')
    const { index, ...rest } = row
    const data: Record<string, unknown> = { ...rest, turn: 0, step: 0, index }
    delete data.type
    delete data.time0
    const expanded = decodeStorageRecord({ type: row.type, seq0: 0, time0: row.time0, data })
    return expanded.map(event => {
      const decoded = event as { time: number; data: { chunk: Record<string, unknown> } }
      return { time: decoded.time, chunk: decoded.data.chunk }
    })
  })
}

function toolRow(row: Record<string, unknown>): unknown[] {
  const tag = 'tool-call-chunks'
  const { seq0, time0, data } = envelope(tag, row)
  const run = runBase(tag, data, 'args')
  if (typeof data.id !== 'string') invalid(tag, 'id must be a string')
  if (data.name !== undefined && typeof data.name !== 'string') invalid(tag, 'name must be a string')
  const at = times(time0, run.dt)
  return run.values.map((argumentsDelta, index) => ({
    type: 'assistant/chunk', seq: seq0 + index, time: at[index],
    data: { turn: run.turn, step: run.step, chunk: { type: 'tool-call-delta', index: run.index, id: data.id, ...(data.name === undefined ? {} : { name: data.name }), argumentsDelta } },
  }))
}

/** Expand one DSH storage record or return its ordinary event unchanged. */
export function decodeStorageRecord(value: unknown): readonly unknown[] {
  const row = recordOf(value)
  if (row === undefined) return [value]
  if (row.type === 'text-chunks' || row.type === 'reasoning-chunks') return textRow(row.type, row)
  if (row.type === 'tool-call-chunks') return toolRow(row)
  return [value]
}
