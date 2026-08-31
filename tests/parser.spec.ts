import { describe, expect, it } from 'vitest'
import { parseSessionJsonl } from '../src/worker/parser.ts'

const header = {
  type: 'session',
  version: 0,
  id: 'root-session',
  createdAt: 1_700_000_000_000,
  delegationDepth: 0,
}

describe('parseSessionJsonl', () => {
  it('expands packed reasoning chunks into their contiguous logical events', () => {
    const result = parseSessionJsonl([
      JSON.stringify(header),
      JSON.stringify({
        type: 'reasoning-chunks',
        seq0: 0,
        time0: 1_700_000_000_100,
        data: {
          turn: 0,
          step: 0,
          index: 0,
          texts: ['first', ' second', ' third'],
          dt: [4, 6],
        },
      }),
    ].join('\n') + '\n')

    expect(result.header.id).toBe('root-session')
    expect(result.events.map(event => [event.seq, event.time, event.type])).toEqual([
      [0, 1_700_000_000_100, 'assistant/chunk'],
      [1, 1_700_000_000_104, 'assistant/chunk'],
      [2, 1_700_000_000_110, 'assistant/chunk'],
    ])
    expect(result.events.map(event => event.data.chunk)).toEqual([
      { type: 'reasoning-delta', index: 0, text: 'first' },
      { type: 'reasoning-delta', index: 0, text: ' second' },
      { type: 'reasoning-delta', index: 0, text: ' third' },
    ])
  })

  it('refuses logs without a current DSH session header', () => {
    expect(() => parseSessionJsonl('{"type":"turn/start","seq":0,"time":0,"data":{"turn":0}}\n'))
      .toThrow('first line must be a DSH session header')
  })

  it('refuses a session written by an unsupported DSH format version', () => {
    expect(() => parseSessionJsonl(`${JSON.stringify({ ...header, version: 1 })}\n`))
      .toThrow('unsupported DSH session format version 1')
  })

  it('refuses malformed packed rows rather than dropping their chunks', () => {
    expect(() => parseSessionJsonl(`${JSON.stringify(header)}\n${JSON.stringify({ type: 'reasoning-chunks', seq0: 0, time0: 1, data: {} })}\n`))
      .toThrow('line 2 cannot decode')
  })
})
