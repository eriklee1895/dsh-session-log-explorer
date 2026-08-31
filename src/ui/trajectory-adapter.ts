import type { ExecutionTurn, TimelineItem } from '../model/projection.ts'
import type { TrajectoryCell, TrajectoryTurn } from './AgentTrajectory.tsx'

function preview(value: string, limit = 180): string {
  const compact = value.replaceAll(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`
}

function duration(value: number): string {
  const milliseconds = Math.max(0, value)
  if (milliseconds < 1_000) return `${String(milliseconds)}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
  return `${(milliseconds / 60_000).toFixed(1)}m`
}

/** Adapt decoded offline records to the explorer's trajectory model. */
export function adaptTrajectoryTurns(
  turns: readonly ExecutionTurn[],
  items: readonly TimelineItem[],
): readonly TrajectoryTurn[] {
  const timing = new Map(items.map(item => [item.eventId, item] as const))
  let index = 0
  const cell = (
    eventId: string,
    input: Omit<TrajectoryCell, 'index' | 'recordId' | 'startedAt' | 'timeSeconds'>,
  ): TrajectoryCell => {
    const item = timing.get(eventId)
    return {
      ...input,
      index: ++index,
      recordId: eventId,
      startedAt: item?.start ?? null,
      timeSeconds: item === undefined ? null : Math.max(0, item.end - item.start) / 1_000,
    }
  }
  return turns.map((turn) => {
    const groups: TrajectoryTurn['groups'][number][] = []
    if (turn.prompt !== undefined) {
      groups.push({ title: 'User prompt', step: null, cells: [cell(turn.prompt.eventId, {
        kind: 'user', label: 'User', text: preview(turn.prompt.content),
      })] })
    }
    for (const step of turn.steps) {
      const cells: TrajectoryCell[] = []
      if (step.reasoning !== '' && step.reasoningEventId !== undefined) cells.push(cell(step.reasoningEventId, {
        kind: 'reasoning', label: 'Reasoning', text: preview(step.reasoning),
      }))
      for (const tool of step.tools) cells.push(cell(tool.eventId, {
        kind: 'tool', label: tool.name, text: preview(tool.output !== '' ? tool.output : tool.input),
        ...(tool.failed ? { isError: true } : {}),
      }))
      if (step.assistant !== '' && step.assistantEventId !== undefined) cells.push(cell(step.assistantEventId, {
        kind: 'assistant', label: 'Assistant', text: preview(step.assistant),
      }))
      if (cells.length > 0) groups.push({
        title: `Step ${String(step.step)}`,
        description: `${duration(step.end - step.start)} · ${step.eventCount.toLocaleString('en-US')} events`,
        step: step.step,
        cells,
      })
    }
    return { turn: turn.turn, groups }
  })
}
