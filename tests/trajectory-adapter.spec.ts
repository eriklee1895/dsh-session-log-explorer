import { describe, expect, it } from 'vitest'
import { adaptTrajectoryTurns } from '../src/ui/trajectory-adapter.ts'

describe('adaptTrajectoryTurns', () => {
  it('maps offline execution records onto native trajectory lanes and timing', () => {
    const turns = [{
      id: 'turn:1', turn: 1, start: 100, end: 1_620,
      prompt: { eventId: 'root:1', content: 'hello' },
      steps: [{
        id: 'step:1:1', eventId: 'root:2', turn: 1, step: 1, start: 120, end: 1_620,
        eventCount: 5, errors: 0, reasoning: 'think', reasoningEventId: 'root:2',
        assistant: 'done', assistantEventId: 'root:4',
        tools: [{ eventId: 'root:3', name: 'bash', input: '{"command":"pwd"}', output: '/workspace', failed: false }],
      }],
    }]
    const items = [
      { id: 'root:1', eventId: 'root:1', kind: 'user' as const, label: 'user', start: 100, end: 100, eventSeqs: [1] },
      { id: 'root:2', eventId: 'root:2', kind: 'reasoning' as const, label: 'reasoning', start: 120, end: 180, eventSeqs: [2] },
      { id: 'root:3', eventId: 'root:3', kind: 'tool' as const, label: 'bash', start: 190, end: 250, eventSeqs: [3] },
      { id: 'root:4', eventId: 'root:4', kind: 'assistant' as const, label: 'assistant', start: 260, end: 260, eventSeqs: [4] },
    ]

    const model = adaptTrajectoryTurns(turns, items)
    expect(model[0]?.groups.flatMap(group => group.cells).map(cell => cell.kind)).toEqual([
      'user', 'reasoning', 'tool', 'assistant',
    ])
    expect(model[0]?.groups[1]?.cells[0]).toMatchObject({ startedAt: 120, timeSeconds: 0.06 })
    expect(model[0]?.groups[1]?.cells[1]).toMatchObject({ startedAt: 190, timeSeconds: 0.06 })
    expect(model[0]?.groups[1]?.cells[2]).toMatchObject({ recordId: 'root:4', startedAt: 260 })
    expect(model[0]?.groups[1]?.description).toBe('1.5s · 5 events')
  })
})
