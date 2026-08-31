import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import './AgentTrajectory.css'

export type TrajectoryKind = 'system' | 'user' | 'reasoning' | 'assistant' | 'tool'

export interface TrajectoryCell {
  readonly index: number
  readonly isError?: boolean
  readonly kind: TrajectoryKind
  readonly label?: string
  readonly recordId: string
  readonly startedAt: number | null
  readonly text: string
  readonly timeSeconds: number | null
}

export interface TrajectoryGroup {
  readonly cells: readonly TrajectoryCell[]
  readonly description?: string
  readonly step?: number | null
  readonly title: string
}

export interface TrajectoryTurn {
  readonly groups: readonly TrajectoryGroup[]
  readonly turn: number | null
}

export interface TrajectoryRange { readonly start: number; readonly end: number }
export type TrajectoryMode = 'sequence' | 'active' | 'wall'

interface Span extends TrajectoryRange {
  readonly index: number
  readonly isError: boolean
  readonly kind: TrajectoryKind
  readonly label: string
  readonly lane: number
  readonly text: string
}

interface TurnRange extends TrajectoryRange { readonly turn: number }

interface TimelineModel extends TrajectoryRange {
  readonly spans: readonly Span[]
  readonly turns: readonly TurnRange[]
}

function lane(kind: TrajectoryKind): number {
  if (kind === 'tool') return 2
  if (kind === 'reasoning' || kind === 'assistant') return 1
  return 0
}

function defaultLabel(kind: TrajectoryKind): string {
  if (kind === 'user') return 'User prompt'
  if (kind === 'reasoning') return 'Reasoning'
  if (kind === 'assistant') return 'Assistant response'
  if (kind === 'tool') return 'Tool call'
  return 'System event'
}

function cells(turn: TrajectoryTurn): readonly TrajectoryCell[] {
  return turn.groups.flatMap(group => group.cells)
}

function spanOf(cell: TrajectoryCell, start: number, end: number): Span {
  return {
    start,
    end,
    index: cell.index,
    isError: cell.isError === true,
    kind: cell.kind,
    label: cell.label ?? defaultLabel(cell.kind),
    lane: lane(cell.kind),
    text: cell.text,
  }
}

function sequenceModel(turns: readonly TrajectoryTurn[]): TimelineModel | null {
  const spans: Span[] = []
  const turnRanges: TurnRange[] = []
  for (const turn of turns) {
    const records = cells(turn)
    if (records.length === 0) continue
    const start = spans.length
    spans.push(...records.map((cell, offset) => spanOf(cell, start + offset, start + offset + 1)))
    if (turn.turn !== null) turnRanges.push({ start, end: spans.length, turn: turn.turn })
  }
  return spans.length === 0 ? null : { start: 0, end: spans.length, spans, turns: turnRanges }
}

function timedModel(turns: readonly TrajectoryTurn[], removeIdle: boolean): TimelineModel | null {
  const timed = turns.flatMap((turn) => {
    const spans = cells(turn).flatMap((cell): Span[] => cell.startedAt === null ? [] : [spanOf(
      cell,
      cell.startedAt,
      cell.startedAt + Math.max(0, (cell.timeSeconds ?? 0) * 1_000),
    )])
    return spans.length === 0 ? [] : [{ spans, turn: turn.turn }]
  })
  const ordered = timed.flatMap(turn => turn.spans).sort((a, b) => a.start - b.start || a.end - b.end)
  if (ordered.length === 0) return null

  const removedBefore = new Map<Span, number>()
  let removed = 0
  let coveredUntil = ordered[0]?.start ?? 0
  for (const span of ordered) {
    if (removeIdle && span.start > coveredUntil) removed += span.start - coveredUntil
    removedBefore.set(span, removed)
    coveredUntil = Math.max(coveredUntil, span.end)
  }
  const shift = (span: Span): Span => {
    const offset = removedBefore.get(span) ?? 0
    return { ...span, start: span.start - offset, end: span.end - offset }
  }
  const mapped = timed.map(turn => ({ ...turn, spans: turn.spans.map(shift) }))
  const spans = mapped.flatMap(turn => turn.spans)
  const start = Math.min(...spans.map(span => span.start))
  const measuredEnd = Math.max(...spans.map(span => span.end))
  const end = measuredEnd > start ? measuredEnd : start + 1
  const turnRanges = mapped.flatMap(turn => turn.turn === null ? [] : [{
    start: Math.min(...turn.spans.map(span => span.start)),
    end: Math.max(...turn.spans.map(span => span.end)),
    turn: turn.turn,
  }])
  return { start, end, spans, turns: turnRanges }
}

function modelFor(turns: readonly TrajectoryTurn[], mode: TrajectoryMode): TimelineModel | null {
  if (mode === 'active') return timedModel(turns, true)
  if (mode === 'wall') return timedModel(turns, false)
  return sequenceModel(turns)
}

export function trajectoryFocusIndexes(
  turns: readonly TrajectoryTurn[],
  range: TrajectoryRange,
  mode: TrajectoryMode,
): ReadonlySet<number> {
  const model = modelFor(turns, mode)
  return new Set(model?.spans.filter(span => span.start <= range.end && span.end >= range.start).map(span => span.index))
}

function formatElapsed(milliseconds: number): string {
  const value = Math.max(0, milliseconds)
  if (value < 1_000) return `${String(Math.round(value))}ms`
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1_000)
  return `${String(minutes)}m ${String(seconds)}s`
}

function modeDescription(mode: TrajectoryMode): string {
  if (mode === 'active') return 'Recorded work duration with idle gaps removed.'
  if (mode === 'wall') return 'Recorded timing including waits and idle gaps.'
  return 'Equal-width records in execution order.'
}

function formatRange(range: TrajectoryRange, model: TimelineModel, mode: TrajectoryMode): string {
  if (mode === 'sequence') {
    const first = Math.max(1, Math.floor(range.start) + 1)
    const last = Math.min(model.spans.length, Math.max(first, Math.ceil(range.end)))
    return `Records ${String(first)}–${String(last)}`
  }
  return `${formatElapsed(range.start - model.start)}–${formatElapsed(range.end - model.start)}`
}

function scaleLabel(value: number, model: TimelineModel, mode: TrajectoryMode): string {
  if (mode !== 'sequence') return formatElapsed(value - model.start)
  return `#${String(Math.min(model.spans.length, Math.max(1, Math.floor(value) + 1)))}`
}

interface DragState {
  readonly button: number
  readonly pointerId: number
  readonly startClientX: number
  readonly startDomain: TrajectoryRange
  moved: boolean
}

const modes: readonly { readonly label: string; readonly value: TrajectoryMode }[] = [
  { label: 'Sequence', value: 'sequence' },
  { label: 'Active time', value: 'active' },
  { label: 'Wall clock', value: 'wall' },
]

export function AgentTrajectory({
  turns,
  mode,
  range,
  selectedIndex,
  searchMatchIndexes,
  onModeChange,
  onRangeChange,
  onRecordSelect,
}: {
  readonly turns: readonly TrajectoryTurn[]
  readonly mode: TrajectoryMode
  readonly range: TrajectoryRange | null
  readonly selectedIndex: number | null
  readonly searchMatchIndexes: ReadonlySet<number> | null
  readonly onModeChange: (mode: TrajectoryMode) => void
  readonly onRangeChange: (range: TrajectoryRange | null) => void
  readonly onRecordSelect: (index: number) => void
}): React.JSX.Element {
  const model = useMemo(() => modelFor(turns, mode), [mode, turns])
  const track = useRef<HTMLDivElement | null>(null)
  const drag = useRef<DragState | null>(null)
  const [viewport, setViewport] = useState<TrajectoryRange | null>(null)
  const [draft, setDraft] = useState<TrajectoryRange | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    setViewport(null)
    setDraft(null)
  }, [mode, model?.start, model?.end])

  const domain = model === null ? { start: 0, end: 1 } : viewport ?? model
  const domainWidth = Math.max(1, domain.end - domain.start)
  const timeAt = (clientX: number): number => {
    const bounds = track.current?.getBoundingClientRect()
    if (bounds === undefined) return domain.start
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width)))
    return domain.start + ratio * domainWidth
  }
  const setZoom = (factor: number): void => {
    if (model === null) return
    const fullWidth = model.end - model.start
    const nextWidth = Math.min(fullWidth, Math.max(fullWidth / 100, domainWidth * factor))
    const middle = (domain.start + domain.end) / 2
    let start = middle - nextWidth / 2
    start = Math.min(model.end - nextWidth, Math.max(model.start, start))
    setViewport(nextWidth >= fullWidth ? null : { start, end: start + nextWidth })
  }
  const resetView = (): void => {
    setViewport(null)
    setDraft(null)
    onRangeChange(null)
  }

  useEffect(() => {
    const node = track.current
    if (node === null || model === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const bounds = node.getBoundingClientRect()
      const anchor = domain.start + ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * domainWidth
      const factor = event.deltaY > 0 ? 1.25 : 0.8
      const fullWidth = model.end - model.start
      const nextWidth = Math.min(fullWidth, Math.max(fullWidth / 100, domainWidth * factor))
      const ratio = (anchor - domain.start) / domainWidth
      let start = anchor - nextWidth * ratio
      start = Math.min(model.end - nextWidth, Math.max(model.start, start))
      setViewport(nextWidth >= fullWidth ? null : { start, end: start + nextWidth })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => { node.removeEventListener('wheel', onWheel) }
  }, [domain.end, domain.start, domainWidth, model])

  const changeMode = (nextMode: TrajectoryMode): void => {
    if (nextMode === mode) return
    onRangeChange(null)
    onModeChange(nextMode)
  }
  const header = <header className="agent-trajectory-header">
    <div className="agent-trajectory-heading"><strong>AGENT TRAJECTORY</strong><span>{modeDescription(mode)}</span></div>
    <div aria-label="Time scale" className="agent-trajectory-modes" role="group">
      {modes.map(option => <button aria-pressed={option.value === mode} key={option.value} onClick={() => { changeMode(option.value) }} type="button">{option.label}</button>)}
    </div>
    <div className="agent-trajectory-zoom">
      <button aria-label="Zoom out timeline" disabled={model === null} onClick={() => { setZoom(1.5) }} type="button">−</button>
      <button aria-label="Zoom in timeline" disabled={model === null} onClick={() => { setZoom(0.65) }} type="button">+</button>
      <button aria-label="Reset timeline view" disabled={model === null} onClick={resetView} type="button">Reset</button>
    </div>
  </header>

  if (model === null) return <section className="agent-trajectory" aria-label="Trajectory timeline">
    {header}<div className="agent-trajectory-empty">No recorded timing is available for this scale.</div>
  </section>

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 && event.button !== 2) return
    if ((event.target as HTMLElement).closest('button') !== null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      button: event.button,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startDomain: domain,
      moved: false,
    }
    if (event.button === 0) setDraft({ start: timeAt(event.clientX), end: timeAt(event.clientX) })
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null || state.pointerId !== event.pointerId) return
    state.moved ||= Math.abs(event.clientX - state.startClientX) >= 3
    if (state.button === 0) {
      setDraft({
        start: Math.min(timeAt(state.startClientX), timeAt(event.clientX)),
        end: Math.max(timeAt(state.startClientX), timeAt(event.clientX)),
      })
      return
    }
    const bounds = track.current?.getBoundingClientRect()
    if (bounds === undefined) return
    const delta = ((event.clientX - state.startClientX) / Math.max(1, bounds.width))
      * (state.startDomain.end - state.startDomain.start)
    const width = state.startDomain.end - state.startDomain.start
    let start = state.startDomain.start - delta
    start = Math.min(model.end - width, Math.max(model.start, start))
    setViewport({ start, end: start + width })
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null || state.pointerId !== event.pointerId) return
    drag.current = null
    if (state.button === 0) {
      if (state.moved && draft !== null) onRangeChange(draft)
      else {
        const point = timeAt(event.clientX)
        const nearest = model.spans.reduce((best, span) =>
          Math.abs((span.start + span.end) / 2 - point) < Math.abs((best.start + best.end) / 2 - point)
            ? span
            : best)
        onRecordSelect(nearest.index)
      }
    } else if (!state.moved) onRangeChange(null)
    setDraft(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setZoom(0.65)
    } else if (event.key === '-') {
      event.preventDefault()
      setZoom(1.5)
    } else if (event.key === '0' || event.key === 'Escape') {
      event.preventDefault()
      resetView()
    }
  }

  const percentage = (value: number): number => ((value - domain.start) / domainWidth) * 100
  const ticks = Array.from({ length: 5 }, (_, index) => domain.start + (domainWidth * index) / 4)
  const activeRange = draft ?? range
  const activeCell = model.spans.find(span => span.index === (hoveredIndex ?? selectedIndex))
  const focusedCount = range === null ? model.spans.length : trajectoryFocusIndexes(turns, range, mode).size

  return <section className="agent-trajectory" aria-label="Trajectory timeline">
    {header}
    <div className="agent-trajectory-plot">
      <div aria-hidden="true" className="agent-trajectory-lanes"><span>INPUT</span><span>MODEL</span><span>TOOLS</span></div>
      <div className="agent-trajectory-chart">
        <div className="agent-trajectory-ruler">
          <ol aria-label="Timeline scale">{ticks.map((tick, index) => <li key={index} style={{ '--left': `${String(percentage(tick))}%` } as CSSProperties}>{scaleLabel(tick, model, mode)}</li>)}</ol>
          {model.turns.filter(turn => turn.end >= domain.start && turn.start <= domain.end).map(turn => <button
            aria-label={`Focus Turn ${String(turn.turn)}`}
            className="agent-trajectory-turn"
            key={turn.turn}
            onClick={() => { onRangeChange({ start: turn.start, end: turn.end }) }}
            style={{ '--left': `${String(percentage(Math.max(domain.start, turn.start)))}%` } as CSSProperties}
            type="button"
          >T{turn.turn}</button>)}
        </div>
        <div
          aria-label="Timeline overview; drag horizontally to focus events"
          className="agent-trajectory-track"
          onContextMenu={(event) => { event.preventDefault() }}
          onDoubleClick={resetView}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          ref={track}
          tabIndex={0}
        >
          {ticks.map((tick, index) => <span className="agent-trajectory-grid" key={index} style={{ '--left': `${String(percentage(tick))}%` } as CSSProperties} />)}
          {model.turns.filter(turn => turn.end >= domain.start && turn.start <= domain.end).map((turn, index) => <span
            className={`agent-trajectory-turn-band band-${String(index % 2)}`}
            key={turn.turn}
            style={{
              '--left': `${String(percentage(Math.max(domain.start, turn.start)))}%`,
              '--width': `${String(Math.max(0, percentage(Math.min(domain.end, turn.end)) - percentage(Math.max(domain.start, turn.start))))}%`,
            } as CSSProperties}
          />)}
          {activeRange !== null && <span className="agent-trajectory-selection" style={{
            '--left': `${String(percentage(activeRange.start))}%`,
            '--width': `${String(percentage(activeRange.end) - percentage(activeRange.start))}%`,
          } as CSSProperties} />}
          {model.spans.filter(span => span.end >= domain.start && span.start <= domain.end).map(span => <button
            aria-label={`${span.label}: ${span.text || 'No content'}${mode === 'sequence' ? '' : `, ${formatElapsed(span.end - span.start)}`}`}
            className={`agent-trajectory-span ${span.kind}${span.isError ? ' error' : ''}${span.index === selectedIndex ? ' current' : ''}${searchMatchIndexes !== null && !searchMatchIndexes.has(span.index) ? ' dim' : ''}`}
            data-record-index={span.index}
            key={span.index}
            onBlur={() => { setHoveredIndex(null) }}
            onClick={(event) => { event.stopPropagation(); onRecordSelect(span.index) }}
            onFocus={() => { setHoveredIndex(span.index) }}
            onMouseEnter={() => { setHoveredIndex(span.index) }}
            onMouseLeave={() => { setHoveredIndex(null) }}
            style={{
              '--lane': span.lane,
              '--left': `${String(percentage(Math.max(domain.start, span.start)))}%`,
              '--width': `${String(Math.max(0.25, percentage(Math.min(domain.end, span.end)) - percentage(Math.max(domain.start, span.start))))}%`,
            } as CSSProperties}
            type="button"
          />)}
        </div>
      </div>
    </div>
    <footer className="agent-trajectory-footer">
      <span>{activeCell === undefined ? 'Select a record, or drag across the plot to focus the ledger.' : <><b>{activeCell.label}</b><em>{activeCell.text || 'No content'}</em></>}</span>
      <small>{range === null ? `${String(model.spans.length)} records` : `${formatRange(range, model, mode)} · ${String(focusedCount)} records`}</small>
    </footer>
  </section>
}
