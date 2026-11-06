import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { zstdCompressSync } from 'node:zlib'
import { parseSessionJsonl } from '../src/worker/parser.ts'
import { projectSession } from '../src/model/projection.ts'
import { importDshArchive, importDshDirectory, importDshFile } from '../src/worker/importer.ts'
import { ExplorerSessionStore } from '../src/worker/session-store.ts'

// Schemas checked against deepseek-ai/deepseek-harness fcc0ad4621:
// session-format-v0-to-v1, llm/src/assistant-stream, core/session/src/types,
// session-format-v3-to-v4/tests/tool-role and session-log-export/src/archive.
const header = (version: number, id = 'root') => ({
  type: 'session', version, id, createdAt: 100, delegationDepth: 0,
  ...(version >= 2 ? { isSeeded: false } : {}),
})
const event = (type: string, data: unknown, seq: number, extra = {}) => ({ type, seq, time: 100 + seq * 10, data, ...extra })
const log = (version: number, rows: readonly unknown[], id = 'root') => [header(version, id), ...rows].map(row => JSON.stringify(row)).join('\n') + '\n'
const entry = (path: string, text: string) => ({ path, name: path.replaceAll('\\', '/').split('/').at(-1)!, bytes: strToU8(text) })

describe('released DSH formats', () => {
  it.each([0, 1, 2, 3, 4])('reads V%i without renumbering source events and keeps raw metadata', version => {
    const row = event('user/message', { content: [{ type: 'text', text: 'hello' }] }, 0, { surfaceOp: 'append' })
    const parsed = parseSessionJsonl(log(version, [row]))
    expect(parsed.header.version).toBe(version)
    expect(parsed.events[0]).toMatchObject({ seq: 0, surfaceOp: 'append', rawRecord: JSON.stringify(row) })
  })

  it('rejects future versions and missing sequence/timing instead of treating snapshots as durable logs', () => {
    expect(() => parseSessionJsonl(log(5, []))).toThrow('unsupported DSH session format version 5')
    expect(() => parseSessionJsonl(log(4, [{ type: 'turn/start', data: { turn: 1 } }]))).toThrow('event seq')
    expect(() => parseSessionJsonl(log(4, [{ type: 'turn/start', seq: 0, data: { turn: 1 } }]))).toThrow('event time')
  })

  it('preserves unknown ignorable payloads and expands physical source ranges', () => {
    const rows = [event('turn/start', { turn: 1 }, 0), event('step/start', { turn: 1, step: 1 }, 1),
      event('plugin:example/record', ['opaque', { n: 1 }], 2, { ignorable: true, sourceEventSeqs: [[0, 1]] })]
    const parsed = parseSessionJsonl(log(4, rows))
    expect(parsed.events[2]).toMatchObject({ data: ['opaque', { n: 1 }], ignorable: true, sourceEventSeqs: [0, 1] })
    expect(projectSession(parsed).events.get('root:2')?.rawRecord).toBe(JSON.stringify(rows[2]))
  })

  it('keeps embedded attempt timing and reasoning linked to its physical event', () => {
    const rows = [event('turn/start', { turn: 1 }, 0), event('step/start', { turn: 1, step: 1 }, 1),
      event('assistant/attempt', { turn: 1, step: 1, stream: [
        { type: 'text-chunks', time0: 121, index: 0, dt: [2], texts: ['partial', ' output'] },
        { type: 'chunk', time: 124, chunk: { type: 'finish', reason: { kind: 'error' } } },
      ] }, 2),
      event('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'think more' }, { type: 'text', text: 'done' }] },
        stream: [{ type: 'reasoning-chunks', time0: 125, index: 0, dt: [-1], texts: ['think', ' more'] }],
        usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 8, cacheWriteTokens: 1 } }, 3)]
    const parsed = parseSessionJsonl(log(4, rows))
    const model = projectSession(parsed)
    expect(parsed.events).toHaveLength(4)
    expect(model.execution[0]?.steps[0]).toMatchObject({ reasoning: 'think more', assistant: 'done', reasoningEventId: 'root:3' })
    expect(model.timeline.find(item => item.kind === 'reasoning')).toMatchObject({ eventId: 'root:3', start: 124, end: 125, eventSeqs: [3] })
    expect(model.conversation.find(item => item.label === 'assistant/attempt')?.content).toContain('partial')
    expect(model.summary.tokens).toMatchObject({ cacheReadTokens: 8, cacheWriteTokens: 1 })
  })

  it('rejects malformed embedded streams including timestamp overflow', () => {
    for (const stream of [
      [{ type: 'reasoning-chunks', time0: 1, index: 0, dt: [], texts: ['a', 'b'] }],
      [{ type: 'reasoning-chunks', time0: Number.MAX_SAFE_INTEGER, index: 0, dt: [1], texts: ['a', 'b'] }],
      [{ type: 'future-record', time: 1 }],
    ]) expect(() => parseSessionJsonl(log(4, [event('assistant/attempt', { turn: 1, step: 1, stream }, 0)]))).toThrow('stream')
  })

  it.each([2, 3, 4])('matches V%i parallel tool results by id, including legacy result blocks and isError without error', version => {
    const result = (id: string, content: string, isError = false) => version < 4
      ? { role: 'user', content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: content }], isError }] }
      : { role: 'tool', toolCallId: id, content: [{ type: 'text', text: content }], isError }
    const parsed = parseSessionJsonl(log(version, [
      event('turn/start', { turn: 1 }, 0), event('step/start', { turn: 1, step: 1 }, 1),
      event('tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }, 2),
      event('tool/call', { turn: 1, step: 1, callId: 'b', name: 'bash', arguments: '{}' }, 3),
      event('tool/result', { turn: 1, step: 1, message: result('b', 'failed', true) }, 4),
      event('tool/result', { turn: 1, step: 1, message: result('a', 'read output') }, 5),
    ]))
    const model = projectSession(parsed)
    expect(model.execution[0]?.steps[0]?.tools).toEqual([
      expect.objectContaining({ name: 'read', output: 'read output', failed: false }),
      expect.objectContaining({ name: 'bash', output: 'failed', failed: true }),
    ])
    expect(model.summary.errors).toBe(1)
  })

  it('keeps unfinished tool calls visible without inventing a result', () => {
    const model = projectSession(parseSessionJsonl(log(4, [event('tool/call', { turn: 1, step: 1, name: 'bash', callId: 'a', arguments: '{}' }, 0)])))
    expect(model.execution[0]?.steps[0]?.tools).toMatchObject([{ name: 'bash', output: '' }])
  })

  it('retains nested PTC dispatch timing, parent identity and actual failure output', () => {
    const rows = [event('turn/start', { turn: 1 }, 0), event('step/start', { turn: 1, step: 1 }, 1),
      event('tool/ptc-dispatch-start', { rootCallId: 'root-call', parentCallId: 'root-call', subCallId: 'nested', name: 'bash', arguments: { command: 'test' } }, 2),
      event('tool/ptc-dispatch', { rootCallId: 'root-call', parentCallId: 'root-call', subCallId: 'nested', name: 'bash', arguments: { command: 'test' }, isError: true, content: [{ type: 'text', text: 'actual stderr' }] }, 3)]
    const model = projectSession(parseSessionJsonl(log(4, rows)))
    expect(model.execution[0]?.steps[0]?.tools).toMatchObject([{ name: 'bash', parentCallId: 'root-call', output: 'actual stderr', failed: true }])
    expect(model.timeline.find(item => item.kind === 'tool')).toMatchObject({ start: 120, end: 130, eventSeqs: [2, 3] })
  })

  it('preserves logical source references in their recorded order', () => {
    const rows = [event('turn/start', { turn: 1 }, 0), event('step/start', { turn: 1, step: 1 }, 1),
      event('plugin:example/record', {}, 2, { ignorable: true, sourceEventSeqs: [1, 0] })]
    expect(parseSessionJsonl(log(4, rows)).events[2]?.sourceEventSeqs).toEqual([1, 0])
    expect(() => parseSessionJsonl(log(4, [...rows.slice(0, 2), event('plugin:example/record', {}, 2, { sourceEventSeqs: [1, 1] })]))).toThrow('unique earlier')
  })

  it('folds system appends, replacements, clears and request series while retaining historical records', () => {
    const system = (text: string) => ({ turn: 1, step: 1, message: { role: 'system', content: text ? [{ type: 'text', text }] : [] } })
    const req = (reason: string) => ({ reason, header: { config: { model: 'deepseek-v4-flash' } } })
    const rows = [event('turn/start', { turn: 1 }, 0), event('step/start', { turn: 1, step: 1 }, 1),
      event('system/message', system('first'), 2, { surfaceOp: 'append' }), event('request/header', req('initial'), 3),
      event('system/message', system('later'), 4, { surfaceOp: 'append' }), event('request/header', req('series'), 5),
      event('system/message', system('head changed'), 6, { surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, sourceEventSeqs: [2] }),
      event('system/message', system(''), 7, { surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4] }),
      event('developer/message', { turn: 1, step: 1, message: { role: 'developer', content: [{ type: 'tool-removal', toolName: 'read' }] } }, 8, { surfaceOp: 'append' }),
      event('request/header', { ...req('change'), startsSeries: true }, 9)]
    const model = projectSession(parseSessionJsonl(log(4, rows)))
    expect(model.promptEpochs.map(epoch => [epoch.system, epoch.reason])).toEqual([['first', 'initial'], ['first\n\nlater', 'series'], ['head changed', 'change']])
    expect(model.promptEpochs[2]).toMatchObject({ startsSeries: true, changedFields: ['system'] })
    expect(model.events.get('root:6')).toMatchObject({ surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, sourceEventSeqs: [2] })
    expect(model.conversation.find(item => item.label === 'developer/message')?.content).toContain('read')
  })
})

describe('generation-addressed imports', () => {
  it('selects the numeric highest generation per session, strips the selected folder and accepts Windows separators', async () => {
    const root4 = log(4, [], 'root')
    const child = [JSON.stringify({ ...header(4, 'child'), parentSession: 'root', origin: 'subagent', delegationDepth: 1 }), ''].join('\n')
    const entries = [entry('export\\session.jsonl', log(0, [], 'root')), entry('export\\session.v4.jsonl', root4),
      entry('export\\subagents\\child\\session.v4.jsonl', child)]
    expect((await importDshDirectory(entries)).sessions.map(session => [session.header.version, session.header.id])).toEqual([[4, 'root'], [4, 'child']])
    const zip = zipSync(Object.fromEntries(entries.map(value => [value.path.replaceAll('\\', '/'), value.bytes])))
    expect((await importDshArchive({ name: 'export.zip', bytes: zip })).sessions).toHaveLength(2)
  })

  it('never silently falls back from a newer unsupported generation or corrupt highest generation', async () => {
    await expect(importDshDirectory([entry('session.v4.jsonl', log(4, [])), entry('session.v10.jsonl', log(10, []))])).rejects.toThrow('unsupported DSH session format version 10')
    await expect(importDshDirectory([entry('session.jsonl', log(0, [])), entry('session.v4.jsonl', 'broken')])).rejects.toThrow('cannot parse')
  })

  it('rejects filename/header mismatches, duplicate paths and parent cycles', async () => {
    await expect(importDshDirectory([entry('session.v4.jsonl', log(0, []))])).rejects.toThrow('generation')
    await expect(importDshDirectory([entry('session.jsonl', log(0, [])), entry('session.jsonl', log(0, []))])).rejects.toThrow('duplicate')
    const selfParent = `${JSON.stringify({ ...header(4), parentSession: 'root', origin: 'subagent' })}\n`
    await expect(importDshDirectory([entry('session.v4.jsonl', selfParent)])).rejects.toThrow('cycle')
  })

  it.each([0, 1, 2, 3, 4])('reads concatenated Zstandard frames for V%i', async version => {
    const text = log(version, [event('turn/start', { turn: 1 }, 0)])
    const split = text.indexOf('\n') + 1
    const bytes = new Uint8Array(Buffer.concat([zstdCompressSync(text.slice(0, split)), zstdCompressSync(text.slice(split))]))
    expect((await importDshFile({ name: 'session.jsonl.zstd', bytes })).header.version).toBe(version)
  })

  it('distinguishes a seeded ordinary fork from subagent lineage and retains file attachments', async () => {
    const fork = `${JSON.stringify({ ...header(4, 'fork'), parentSession: 'source', isSeeded: true })}\n`
      + JSON.stringify(event('session/end-seed', { inherited: true }, 0)) + '\n'
    const store = new ExplorerSessionStore()
    const view = await store.importDirectory([entry('session.v4.jsonl', fork), { path: 'files/ab/abcdef/report.txt', name: 'report.txt', bytes: strToU8('report') }])
    expect(view.sessions[0]).not.toHaveProperty('parentSessionId')
    expect(store.attachment('files/ab/abcdef/report.txt')).toEqual(strToU8('report'))
    expect(store.event('fork:0')?.type).toBe('session/end-seed')
  })
})
