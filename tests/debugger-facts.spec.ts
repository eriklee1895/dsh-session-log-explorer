import { describe, expect, it } from 'vitest'
import { parseSessionJsonl } from '../src/worker/parser.ts'
import { projectSession } from '../src/model/projection.ts'
import { adaptTrajectoryTurns } from '../src/ui/trajectory-adapter.ts'
import { ExplorerSessionStore } from '../src/worker/session-store.ts'

function project(rows: readonly { type: string; data: unknown }[]) {
  return projectSession(parseSessionJsonl([
    JSON.stringify({ type: 'session', version: 4, id: 'facts', createdAt: 1, delegationDepth: 0, isSeeded: false }),
    ...rows.map((row, seq) => JSON.stringify({ ...row, seq, time: seq + 10 })),
  ].join('\n')))
}
const message = (kind: string, text: string) => ({ type: 'user/message', data: {
  role: 'user', id: text, source: { kind }, content: [{ type: 'text', text }],
} })

describe('recorded debugger facts', () => {
  it('keeps errors outside entered steps available in the initial bounded view', async () => {
    const store = new ExplorerSessionStore()
    const rows = [{ type: 'session', version: 4, id: 'loose', createdAt: 1, delegationDepth: 0, isSeeded: false },
      { type: 'agent/error', seq: 0, time: 1, data: { message: 'before a turn' } },
      { type: 'turn/start', seq: 1, time: 2, data: { turn: 1 } },
      { type: 'agent/error', seq: 2, time: 3, data: { message: 'no entered step' } }]
    await store.importFile({ name: 'session.v4.jsonl', bytes: new TextEncoder().encode(rows.map(row => JSON.stringify(row)).join('\n')) })
    const view = store.initialView()!.sessions[0]!
    expect(view.timeline.filter(item => item.severity === 'error').map(item => item.eventId)).toEqual(['loose:0', 'loose:2'])
    expect(adaptTrajectoryTurns(view.execution, view.timeline).flatMap(turn => turn.groups.flatMap(group => group.cells)).map(cell => cell.recordId)).toEqual(['loose:2', 'loose:0'])
  })

  it('preserves the human request when runtime, agent and child notices follow it', () => {
    const model = project([{ type: 'turn/start', data: { turn: 1 } }, message('runtime-context', 'environment'),
      message('user', 'actual request'), message('agent-message', 'peer words'), message('subagent-settled', 'runtime notice'),
      message('future-producer', 'opaque source')])
    expect(model.execution[0]?.prompt).toEqual({ eventId: 'facts:2', content: 'actual request' })
    expect(model.conversation.map(record => record.source)).toEqual(['runtime-context', 'user', 'agent-message', 'subagent-settled', 'future-producer'])
    expect(model.conversation.map(record => record.label)).toEqual(['运行时上下文', '用户输入', 'Agent 消息', '子代理通知', '消息 · future-producer'])
    expect(model.execution[0]?.inputs?.map(input => input.eventId)).toEqual(['facts:1', 'facts:2', 'facts:3', 'facts:4', 'facts:5'])
  })

  it.each(['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked', 'future-reason'])('retains the recorded %s turn outcome', kind => {
    const model = project([{ type: 'turn/start', data: { turn: 1 } }, { type: 'turn/end', data: { turn: 1, reason: { kind } } }])
    expect(model.execution[0]?.outcome).toMatchObject({ kind, eventId: 'facts:1' })
    expect(model.events.get('facts:1')?.type).toBe('turn/end')
  })

  it('keeps unsettled attempts out of conversation and makes step-less errors navigable', () => {
    const model = project([{ type: 'turn/start', data: { turn: 1 } },
      { type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [] } },
      { type: 'agent/error', data: { message: 'failure outside an entered step' } }])
    expect(model.execution[0]?.outcome).toBeUndefined()
    expect(model.conversation.some(record => record.eventId === 'facts:1')).toBe(false)
    expect(model.diagnostics.map(record => record.eventId)).toContain('facts:1')
    expect(model.timeline.find(record => record.eventId === 'facts:2')).toMatchObject({ severity: 'error' })
    const cells = adaptTrajectoryTurns(model.execution, model.timeline).flatMap(turn => turn.groups.flatMap(group => group.cells))
    expect(cells.find(cell => cell.recordId === 'facts:2')).toMatchObject({ isError: true })
  })

  it('links reversed parallel results to their own calls and keeps pending/orphan identities', () => {
    const model = project([{ type: 'turn/start', data: { turn: 1 } }, { type: 'step/start', data: { turn: 1, step: 1 } },
      ...['a', 'b', 'pending'].map(callId => ({ type: 'tool/call', data: { turn: 1, step: 1, callId, name: callId, arguments: callId } })),
      ...['b', 'a', 'orphan'].map(toolCallId => ({ type: 'tool/result', data: { turn: 1, step: 1,
        message: { role: 'tool', toolCallId, isError: toolCallId === 'b', content: [{ type: 'text', text: toolCallId + '-output' }] } } }))])
    expect(model.tools.get('facts:2')).toMatchObject({ callEventId: 'facts:2', resultEventId: 'facts:6', output: 'a-output', status: 'returned' })
    expect(model.tools.get('facts:5')).toMatchObject({ callEventId: 'facts:3', resultEventId: 'facts:5', output: 'b-output', status: 'error' })
    expect(model.tools.get('facts:4')).toMatchObject({ callEventId: 'facts:4', status: 'pending' })
    expect(model.tools.get('facts:7')).toMatchObject({ resultEventId: 'facts:7', status: 'orphan' })
    expect(model.tools.get('facts:7')?.callEventId).toBeUndefined()
  })
})
