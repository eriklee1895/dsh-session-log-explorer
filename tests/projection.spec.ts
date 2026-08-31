import { describe, expect, it } from 'vitest'
import { parseSessionJsonl } from '../src/worker/parser.ts'
import { projectSession } from '../src/model/projection.ts'

function parsed() {
  return parseSessionJsonl([
    JSON.stringify({ type: 'session', version: 0, id: 'projected', createdAt: 1_700_000_000_000, delegationDepth: 0 }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: 100, data: { turn: 0 } }),
    JSON.stringify({ type: 'step/start', seq: 1, time: 110, data: { turn: 0, step: 0 } }),
    JSON.stringify({ type: 'user/message', seq: 2, time: 120, data: { role: 'user', id: 'u1', source: 'human', content: [{ type: 'text', text: 'hello' }] } }),
    JSON.stringify({ type: 'assistant/chunk', seq: 3, time: 130, data: { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } } }),
    JSON.stringify({ type: 'assistant/chunk', seq: 4, time: 140, data: { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: ' more' } } }),
    JSON.stringify({ type: 'tool/call', seq: 5, time: 150, data: { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"pwd"}' } }),
    JSON.stringify({ type: 'tool/result', seq: 6, time: 180, data: { turn: 0, step: 0, message: { role: 'tool', content: [{ type: 'text', text: '/workspace' }] } } }),
    JSON.stringify({ type: 'assistant/message', seq: 7, time: 190, data: { turn: 0, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, usage: { inputTokens: 3, outputTokens: 2, reasoningTokens: 4 } } }),
    JSON.stringify({ type: 'step/end', seq: 8, time: 195, data: { turn: 0, step: 0 } }),
    JSON.stringify({ type: 'turn/end', seq: 9, time: 200, data: { turn: 0, reason: { kind: 'completed' } } }),
    JSON.stringify({ type: 'plugin/custom-event', seq: 10, time: 210, data: { enabled: true } }),
  ].join('\n') + '\n')
}

describe('projectSession', () => {
  it('builds one timeline item for a tool call and its result', () => {
    const model = projectSession(parsed())

    expect(model.summary).toMatchObject({ turns: 1, steps: 1, toolCalls: 1, durationMs: 110 })
    expect(model.timeline.find(item => item.kind === 'tool')).toMatchObject({ label: 'bash', start: 150, end: 180 })
    expect(model.timeline.filter(item => item.kind === 'reasoning')).toHaveLength(1)
    expect(model.timeline.find(item => item.kind === 'system')).toMatchObject({ label: 'plugin/custom-event', eventId: 'projected:10' })
  })

  it('keeps conversation records linked to their event ids', () => {
    const model = projectSession(parsed())

    expect(model.conversation.map(record => record.kind)).toEqual(['user', 'reasoning', 'tool', 'assistant', 'system'])
    expect(model.conversation[2]).toMatchObject({ eventId: 'projected:5', label: 'bash' })
  })

  it('groups physical events into an execution turn and step narrative', () => {
    const model = projectSession(parsed())

    expect(model.execution).toHaveLength(1)
    expect(model.execution[0]).toMatchObject({
      turn: 0,
      prompt: { content: 'hello' },
      steps: [{
        step: 0,
        reasoning: 'think more',
        assistant: 'done',
        tools: [{ name: 'bash', input: '{"cmd":"pwd"}', output: '/workspace' }],
      }],
    })
  })
})
