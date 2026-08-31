// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExplorerWorkspace } from '../src/ui/ExplorerWorkspace.tsx'

const session = {
  id: 'root',
  sourcePath: 'session.jsonl',
  eventCount: 4,
  summary: { turns: 1, steps: 1, toolCalls: 1, toolResults: 1, errors: 0, durationMs: 100, tokens: {} },
  promptEpochs: [],
  execution: [{
    id: 'root:turn:1', turn: 1, start: 10, end: 30, prompt: { eventId: 'root:1', content: 'show me the worktree' }, promptEpochs: [], steps: [{
      id: 'root:step:1:1', eventId: 'root:2', turn: 1, step: 1, start: 20, end: 30, eventCount: 2, errors: 0,
      reasoning: 'inspect repository', reasoningEventId: 'root:2', assistant: 'done', assistantEventId: 'root:2',
      promptEpochEventId: undefined,
      tools: [
        { eventId: 'root:2', name: 'bash', input: '{"command":"pwd"}', output: '{"path":"/workspace"}', failed: false },
        { eventId: 'root:3', name: 'glob', input: '{"pattern":"*.ts"}', output: '{"matches":[]}', failed: false },
      ],
    }],
  }],
  timeline: [
    { id: 'root:1', eventId: 'root:1', kind: 'user' as const, label: '用户输入', start: 10, end: 10, eventSeqs: [1] },
    { id: 'root:2', eventId: 'root:2', kind: 'tool' as const, label: 'bash', start: 20, end: 30, eventSeqs: [2, 3] },
  ],
}

describe('ExplorerWorkspace', () => {
  afterEach(() => { cleanup() })

  it('renders the canonical one-based DSH positions without shifting them', () => {
    render(<ExplorerWorkspace
      session={session}
      conversation={[
        { eventId: 'root:1', kind: 'user', label: '用户输入', content: 'show me the worktree', eventSeqs: [1] },
        { eventId: 'root:2', kind: 'tool', label: 'bash', content: '/workspace', eventSeqs: [2, 3] },
      ]}
      selectedEventId="root:2"
      onEventSelect={() => {}}
    />)

    expect(screen.getByRole('navigation', { name: '工作台视图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '执行' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('TURN 01')).toBeTruthy()
    expect(screen.getByText('STEP 01')).toBeTruthy()
    expect(screen.getByText('bash → glob')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Tool calls in execution order' })).toBeTruthy()
    expect(screen.queryByText('RUN / 01')).toBeNull()
    expect(screen.getByText('会话记录')).toBeTruthy()
    expect(screen.getByText('USER PROMPT')).toBeTruthy()
    expect(screen.getByText('REASONING')).toBeTruthy()
    expect(screen.getByText('ASSISTANT RESPONSE')).toBeTruthy()
  })

  it('collapses reasoning and formats tool JSON without changing the selected event link', () => {
    const selected: string[] = []
    const onEventSelect = (eventId: string): void => { selected.push(eventId) }
    render(<ExplorerWorkspace
      session={session}
      conversation={[]}
      selectedEventId={undefined}
      onEventSelect={onEventSelect}
    />)

    expect(screen.getByText('USER PROMPT').closest('details')?.open).toBe(false)
    expect(screen.getByText('REASONING').closest('details')?.open).toBe(false)
    expect(screen.getByText('ASSISTANT RESPONSE').closest('details')?.open).toBe(false)
    const tool = screen.getByText('bash').closest('details')
    expect(tool?.open).toBe(false)
    fireEvent.click(screen.getByText('bash'))
    expect(screen.getByText('command:', { exact: true })).toBeTruthy()
    expect(screen.getByText('path:', { exact: true })).toBeTruthy()
    fireEvent.click(within(tool as HTMLElement).getByRole('button', { name: 'VIEW RAW EVENT' }))
    expect(selected).toEqual(['root:2'])
  })

  it('links the agent trajectory overview to its event ledger', () => {
    const selected: string[] = []
    const trajectorySession = {
      ...session,
      eventCount: 7,
      summary: { ...session.summary, turns: 2, steps: 2 },
      execution: [...session.execution, {
        id: 'root:turn:2', turn: 2, start: 100, end: 130,
        prompt: { eventId: 'root:4', content: 'verify the tests' }, promptEpochs: [],
        steps: [{
          id: 'root:step:2:1', eventId: 'root:5', turn: 2, step: 1, start: 110, end: 130,
          eventCount: 3, errors: 0, reasoning: 'run focused checks', reasoningEventId: 'root:5',
          assistant: 'all green', assistantEventId: 'root:6', promptEpochEventId: undefined, tools: [],
        }],
      }],
      timeline: [...session.timeline,
        { id: 'root:4', eventId: 'root:4', kind: 'user' as const, label: '用户输入', start: 100, end: 100, eventSeqs: [4] },
        { id: 'root:5', eventId: 'root:5', kind: 'reasoning' as const, label: '模型推理', start: 110, end: 120, eventSeqs: [5] },
        { id: 'root:6', eventId: 'root:6', kind: 'assistant' as const, label: '模型回复', start: 130, end: 130, eventSeqs: [6] },
      ],
    }
    render(<ExplorerWorkspace
      session={trajectorySession}
      conversation={[
        { eventId: 'root:1', kind: 'user', label: '用户输入', content: 'show me the worktree', eventSeqs: [1] },
        { eventId: 'root:2', kind: 'tool', label: 'bash', content: '/workspace', eventSeqs: [2, 3] },
      ]}
      selectedEventId="root:2"
      onEventSelect={(eventId) => { selected.push(eventId) }}
    />)

    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    expect(screen.getByLabelText('Timeline overview; drag horizontally to focus events')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Trajectory controls' })).toBeTruthy()
    const scale = within(screen.getByRole('group', { name: 'Time scale' }))
    expect(scale.getByRole('button', { name: 'Sequence' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(scale.getByRole('button', { name: 'Wall clock' }))
    expect(scale.getByRole('button', { name: 'Wall clock' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('list', { name: 'Timeline scale' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Focus Turn 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Focus Turn 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset timeline view' })).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Trajectory records' })
    expect(screen.getByRole('columnheader', { name: '#' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Event' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Content' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tool bash' }))
    expect(selected).toEqual(['root:2'])
    fireEvent.click(screen.getByRole('button', { name: 'Focus Turn 2' }))
    expect(within(table).queryByRole('button', { name: /Turn 1/ })).toBeNull()
    expect(within(table).getByRole('button', { name: /Turn 2/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    expect(screen.getByText('show me the worktree')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '脱敏' })).toBeNull()
  })

  it('presents prompt epochs without repeating unchanged resume snapshots', () => {
    const selected: string[] = []
    const initial = {
      ordinal: 1, eventId: 'root:10', previousEventId: undefined, reason: 'initial' as const,
      turn: 1, step: 1, time: 12, config: { provider: 'deepseek', model: 'deepseek-chat' },
      system: 'You are DSH.\n\nFollow repository instructions.',
      tools: [{ name: 'bash', description: 'Run a command' }], toolNames: ['bash'], changedFields: [],
    }
    const resumed = {
      ...initial, ordinal: 2, eventId: 'root:11', previousEventId: 'root:10', reason: 'resume' as const,
      step: 2, time: 18,
    }
    const changed = {
      ...initial, ordinal: 3, eventId: 'root:12', previousEventId: 'root:11', reason: 'change' as const,
      step: 3, time: 24, system: 'You are DSH.\n\nFollow updated repository instructions.',
      tools: [...initial.tools, { name: 'read', description: 'Read a file' }], toolNames: ['bash', 'read'],
      changedFields: ['system', 'tools'] as const,
    }
    const promptSession = {
      ...session,
      promptEpochs: [initial, resumed, changed],
      timeline: [...session.timeline,
        { id: 'root:10', eventId: 'root:10', kind: 'system' as const, label: 'Initial Request Context', start: 12, end: 12, eventSeqs: [10] },
        { id: 'root:11', eventId: 'root:11', kind: 'system' as const, label: 'Request Context Resumed', start: 18, end: 18, eventSeqs: [11] },
        { id: 'root:12', eventId: 'root:12', kind: 'system' as const, label: 'System Prompt and Tools Updated', start: 24, end: 24, eventSeqs: [12] },
      ],
      execution: [{
        ...session.execution[0], promptEpochs: [initial, resumed, changed],
        steps: [{ ...session.execution[0].steps[0], promptEpochEventId: 'root:10' }],
      }],
    }

    render(<ExplorerWorkspace
      session={promptSession}
      conversation={[]}
      selectedEventId={undefined}
      onEventSelect={(eventId) => { selected.push(eventId) }}
    />)

    const review = screen.getByRole('region', { name: 'Prompt epochs' })
    expect(within(review).getByText('MODEL REQUEST CONTEXT')).toBeTruthy()
    expect(within(review).getByText('1 INITIAL · 1 RESUME · 1 UPDATE')).toBeTruthy()
    const initialCard = within(review).getByText('INITIAL REQUEST CONTEXT').closest('details')
    const resumeCard = within(review).getByText('SESSION RESUMED · CONTEXT UNCHANGED').closest('details')
    const changeCard = within(review).getByText('SYSTEM PROMPT + TOOLS UPDATED').closest('details')
    expect(initialCard?.open).toBe(false)
    expect(resumeCard?.textContent).toContain('SYSTEM PROMPT, MODEL, AND TOOLS UNCHANGED FROM E01')
    expect(resumeCard?.querySelector('pre')).toBeNull()
    fireEvent.click(within(initialCard as HTMLElement).getByText('INITIAL REQUEST CONTEXT'))
    expect(initialCard?.querySelector('.prompt-document pre')?.textContent).toContain('Follow repository instructions.')
    fireEvent.click(within(changeCard as HTMLElement).getByText('SYSTEM PROMPT + TOOLS UPDATED'))
    expect(changeCard?.querySelector('.prompt-document pre')?.textContent).toContain('Follow updated repository instructions.')
    fireEvent.click(within(initialCard as HTMLElement).getByRole('button', { name: 'View raw request header E01' }))
    expect(selected).toEqual(['root:10'])
    expect(screen.getByText('CONTEXT E01')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View effective context E01' }))
    expect(selected).toEqual(['root:10', 'root:10'])
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    fireEvent.click(screen.getByRole('button', { name: 'Initial Request Context' }))
    expect(selected).toEqual(['root:10', 'root:10', 'root:10'])
  })
})
