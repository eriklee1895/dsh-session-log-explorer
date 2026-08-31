import { describe, expect, it } from 'vitest'
import {
  trajectoryFocusIndexes,
  type TrajectoryMode,
  type TrajectoryTurn,
} from '../src/ui/AgentTrajectory.tsx'

const turns: readonly TrajectoryTurn[] = [{
  turn: 1,
  groups: [{
    title: 'Step 1',
    cells: [
      { index: 1, kind: 'tool', recordId: 'root:1', startedAt: 0, text: 'first', timeSeconds: 1 },
      { index: 2, kind: 'tool', recordId: 'root:2', startedAt: 11_000, text: 'second', timeSeconds: 1 },
    ],
  }],
}]

describe('agent trajectory timing modes', () => {
  it('removes idle gaps only from active-time focus ranges', () => {
    const active: TrajectoryMode = 'active'
    const wall: TrajectoryMode = 'wall'

    expect([...trajectoryFocusIndexes(turns, { start: 1_500, end: 1_900 }, active)]).toEqual([2])
    expect([...trajectoryFocusIndexes(turns, { start: 1_500, end: 1_900 }, wall)]).toEqual([])
    expect([...trajectoryFocusIndexes(turns, { start: 10_500, end: 11_500 }, wall)]).toEqual([2])
  })
})
