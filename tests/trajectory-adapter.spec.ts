import { describe, expect, it } from 'vitest'
import { adaptTrajectoryTurns } from '../src/ui/trajectory-adapter.ts'

describe('adaptTrajectoryTurns', () => {
  it('maps offline execution records onto native trajectory lanes and timing', () => {
    const turns = [{
      id: 'turn:1', turn: 1, start: 100, end: 1_620,
      prompt: { eventId: 'root:1', content: 'hello' },
      promptEpochs: [],
      steps: [{
        id: 'step:1:1', eventId: 'root:2', turn: 1, step: 1, start: 120, end: 1_620,
        eventCount: 5, errors: 0, reasoning: 'think', reasoningEventId: 'root:2',
        assistant: 'done', assistantEventId: 'root:4',
        promptEpochEventId: undefined,
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

  it('places prompt epochs before the model decisions they govern', () => {
    const epoch = {
      ordinal: 1, eventId: 'root:10', previousEventId: undefined, reason: 'initial' as const,
      turn: 1, step: 1, time: 110, config: { provider: 'deepseek', model: 'deepseek-chat' },
      system: 'Follow repository instructions.', tools: [], toolNames: [], changedFields: [],
    }
    const turns = [{
      id: 'turn:1', turn: 1, start: 100, end: 220,
      prompt: { eventId: 'root:1', content: 'hello' }, promptEpochs: [epoch],
      steps: [{
        id: 'step:1:1', eventId: 'root:2', turn: 1, step: 1, start: 110, end: 220,
        eventCount: 3, errors: 0, reasoning: 'think', reasoningEventId: 'root:2',
        assistant: '', assistantEventId: undefined, promptEpochEventId: 'root:10', tools: [],
      }],
    }]
    const items = [
      { id: 'root:1', eventId: 'root:1', kind: 'user' as const, label: 'user', start: 100, end: 100, eventSeqs: [1] },
      { id: 'root:10', eventId: 'root:10', kind: 'system' as const, label: 'Initial Request Context', start: 110, end: 110, eventSeqs: [10] },
      { id: 'root:2', eventId: 'root:2', kind: 'reasoning' as const, label: 'reasoning', start: 120, end: 220, eventSeqs: [2] },
    ]

    const cells = adaptTrajectoryTurns(turns, items)[0]?.groups[1]?.cells
    expect(cells?.map(cell => [cell.kind, cell.label, cell.recordId])).toEqual([
      ['system', 'Initial Request Context', 'root:10'],
      ['reasoning', 'Reasoning', 'root:2'],
    ])
  })
})
