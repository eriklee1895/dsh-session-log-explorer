import { Fragment, useMemo, useState } from 'react'
import type { ConversationRecord, ExecutionTurn, PromptEpoch, TimelineItem } from '../model/projection.ts'
import type { ExplorerSessionView } from '../worker/session-store.ts'
import {
  AgentTrajectory,
  trajectoryFocusIndexes,
  type TrajectoryKind,
  type TrajectoryMode,
  type TrajectoryRange,
} from './AgentTrajectory.tsx'
import { StructuredJson } from './StructuredJson.tsx'
import { PromptEpochReview } from './PromptEpochReview.tsx'
import { adaptTrajectoryTurns } from './trajectory-adapter.ts'
import './ExplorerWorkspace.css'

type WorkspaceView = 'overview' | 'execution' | 'timeline' | 'conversation'

export interface ExplorerWorkspaceProps {
  readonly session: ExplorerSessionView
  readonly conversation: readonly ConversationRecord[]
  readonly selectedEventId: string | undefined
  readonly onEventSelect: (eventId: string) => void
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000))
  return `${String(Math.floor(seconds / 60))} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

function Overview({ session }: Pick<ExplorerWorkspaceProps, 'session'>): React.JSX.Element {
  const cards = [
    ['Turns', session.summary.turns],
    ['Steps', session.summary.steps],
    ['工具调用', session.summary.toolCalls],
    ['总耗时', duration(session.summary.durationMs)],
  ] as const
  return <section className="overview-grid" aria-label="会话概览">
    {cards.map(([label, value], index) => <article className="metric-card" key={label}>
      <span className="metric-index">0{index + 1}</span>
      <span>{label}</span><strong>{value}</strong>
    </article>)}
    <article className="overview-detail">
      <h2>执行摘要</h2>
      <dl>
        <div><dt>逻辑事件</dt><dd>{session.eventCount}</dd></div>
        <div><dt>工具结果</dt><dd>{session.summary.toolResults}</dd></div>
        <div><dt>错误</dt><dd>{session.summary.errors}</dd></div>
        <div><dt>推理 Token</dt><dd>{session.summary.tokens.reasoningTokens ?? '未记录'}</dd></div>
        <div><dt>输出 Token</dt><dd>{session.summary.tokens.outputTokens ?? '未记录'}</dd></div>
      </dl>
    </article>
  </section>
}

function briefDuration(ms: number): string {
  if (ms < 1_000) return `${String(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

interface TrajectoryRow {
  readonly content: string
  readonly eventId: string
  readonly groupId: string
  readonly id: string
  readonly index: number
  readonly kind: TrajectoryKind
  readonly label: string
  readonly step: number | null
  readonly timeMs: number | undefined
  readonly turn: number
}

function Timeline({ turns, items, selectedEventId, onEventSelect }: {
  readonly turns: readonly ExecutionTurn[]
  readonly items: readonly TimelineItem[]
  readonly selectedEventId: string | undefined
  readonly onEventSelect: (eventId: string) => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<TrajectoryMode>('sequence')
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(() => new Set())
  const [callsCollapsed, setCallsCollapsed] = useState(false)
  const [range, setRange] = useState<TrajectoryRange | null>(null)
  const trajectoryTurns = useMemo(() => adaptTrajectoryTurns(turns, items), [items, turns])
  const trajectoryCells = useMemo(
    () => trajectoryTurns.flatMap(turn => turn.groups.flatMap(group => group.cells)), [trajectoryTurns],
  )
  const trajectoryIndexByEvent = useMemo(
    () => new Map(trajectoryCells.map(cell => [cell.recordId, cell.index] as const)), [trajectoryCells],
  )
  const eventByTrajectoryIndex = useMemo(
    () => new Map(trajectoryCells.map(cell => [cell.index, cell.recordId] as const)), [trajectoryCells],
  )
  const rows = useMemo(() => trajectoryTurns.flatMap((turn, turnIndex) => {
    const turnNumber = turn.turn ?? turnIndex + 1
    return turn.groups.flatMap((group, groupIndex) => group.cells.map((cell): TrajectoryRow => ({
      content: cell.text,
      eventId: cell.recordId,
      groupId: `${String(turnNumber)}:${String(groupIndex)}`,
      id: `${String(turnNumber)}:${String(groupIndex)}:${String(cell.index)}`,
      index: cell.index,
      kind: cell.kind,
      label: cell.label ?? cell.kind,
      step: group.step ?? null,
      timeMs: cell.timeSeconds === null ? undefined : cell.timeSeconds * 1_000,
      turn: turnNumber,
    })))
  }), [trajectoryTurns])
  const focusedIndexes = useMemo(() => range === null ? null
    : trajectoryFocusIndexes(trajectoryTurns, range, mode), [mode, range, trajectoryTurns])
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return rows.filter(row => !callsCollapsed || row.kind !== 'tool').filter(row => needle === ''
      || `${row.label} ${row.content}`.toLocaleLowerCase().includes(needle)).filter(row => focusedIndexes === null
        || focusedIndexes.has(row.index))
  }, [callsCollapsed, focusedIndexes, rows, search])
  const searchMatchIndexes = useMemo(() => search.trim() === '' ? null : new Set(filtered.flatMap((row) => {
    return [row.index]
  })), [filtered, search])
  const turnNumbers = trajectoryTurns.map((turn, index) => turn.turn ?? index + 1)
  const allTurnsCollapsed = turnNumbers.length > 0 && turnNumbers.every(turn => collapsedTurns.has(turn))
  const toggleTurns = (): void => { setCollapsedTurns(allTurnsCollapsed ? new Set() : new Set(turnNumbers)) }
  return <section className="trajectory-workbench" aria-label="Trajectory timeline">
    <AgentTrajectory
      mode={mode} onModeChange={setMode} onRangeChange={setRange}
      onRecordSelect={(index) => { const eventId = eventByTrajectoryIndex.get(index); if (eventId !== undefined) onEventSelect(eventId) }}
      range={range} searchMatchIndexes={searchMatchIndexes}
      selectedIndex={selectedEventId === undefined ? null : trajectoryIndexByEvent.get(selectedEventId) ?? null}
      turns={trajectoryTurns}
    />
    <div className="trajectory-controls" role="toolbar" aria-label="Trajectory controls">
      <span>{focusedIndexes === null ? `${String(rows.length)} records` : `${String(focusedIndexes.size)} of ${String(rows.length)} records in focus`}</span>
      <button aria-pressed={allTurnsCollapsed} onClick={toggleTurns}>{allTurnsCollapsed ? 'Expand turns' : 'Collapse turns'}</button>
      <button aria-pressed={callsCollapsed} onClick={() => { setCallsCollapsed(value => !value) }}>{callsCollapsed ? 'Show tool calls' : 'Hide tool calls'}</button>
      <input aria-label="Search trajectory" placeholder="Search records" type="search" value={search} onChange={(event) => { setSearch(event.currentTarget.value) }} />
    </div>
    <div className="trajectory-ledger"><table aria-label="Trajectory records">
      <thead><tr><th>#</th><th>Event</th><th>Content</th><th>Time</th></tr></thead>
      <tbody>{trajectoryTurns.map((turn, turnIndex) => {
        const turnNumber = turn.turn ?? turnIndex + 1
        const turnRows = filtered.filter(row => row.turn === turnNumber)
        if (turnRows.length === 0) return null
        const collapsed = collapsedTurns.has(turnNumber)
        return <Fragment key={turnNumber}>
          <tr className="trajectory-turn-row"><th colSpan={4}><button onClick={() => { setCollapsedTurns((value) => {
            const next = new Set(value); if (next.has(turnNumber)) next.delete(turnNumber); else next.add(turnNumber); return next
          }) }}><span>{collapsed ? '▸' : '▾'} Turn {turnNumber}</span><small>{turnRows.length} records</small></button></th></tr>
          {!collapsed && turn.groups.map((group, groupIndex) => {
            const groupRows = turnRows.filter(row => row.groupId === `${String(turnNumber)}:${String(groupIndex)}`)
            if (groupRows.length === 0) return null
            return <Fragment key={`${String(turnNumber)}:${String(groupIndex)}`}>
              {group.step !== null && group.step !== undefined && <tr className="trajectory-step-row"><th colSpan={4}>{group.title}<small>{group.description}</small></th></tr>}
              {groupRows.map(row => <TrajectoryLedgerRow
                key={row.id} onSelect={onEventSelect} row={row}
                selected={selectedEventId === row.eventId}
              />)}
            </Fragment>
          })}
        </Fragment>
      })}</tbody>
    </table></div>
  </section>
}

function TrajectoryLedgerRow({ row, selected, onSelect }: {
  readonly row: TrajectoryRow
  readonly selected: boolean
  readonly onSelect: (eventId: string) => void
}): React.JSX.Element {
  return <tr className={`trajectory-record-row ${row.kind}${selected ? ' selected' : ''}`}>
    <td>#{row.index}</td><td><span>{row.label}</span></td><td><button aria-label={row.kind === 'tool' ? `Tool ${row.label}` : row.label} onClick={() => { onSelect(row.eventId) }}>{preview(row.content, 180)}</button></td><td>{row.timeMs === undefined ? '—' : briefDuration(row.timeMs)}</td>
  </tr>
}

function Conversation({ records, selectedEventId, onEventSelect }: {
  readonly records: readonly ConversationRecord[]
  readonly selectedEventId: string | undefined
  readonly onEventSelect: (eventId: string) => void
}): React.JSX.Element {
  return <section className="conversation" aria-label="会话记录">
    {records.map(record => <button className={`conversation-card ${record.kind}${record.eventId === selectedEventId ? ' selected' : ''}`} key={record.eventId} onClick={() => { onEventSelect(record.eventId) }}>
      <span>{record.label}</span><p>{record.content}</p>
    </button>)}
  </section>
}

function preview(content: string, limit = 220): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

function StepPromptContext({ epoch, onEventSelect }: {
  readonly epoch: PromptEpoch | undefined
  readonly onEventSelect: (eventId: string) => void
}): React.JSX.Element | null {
  if (epoch === undefined) return null
  const code = `E${String(epoch.ordinal).padStart(2, '0')}`
  return <div className="step-prompt-context">
    <span>PROMPT {code}</span>
    <strong>{typeof epoch.config.model === 'string' ? epoch.config.model : 'model not recorded'}</strong>
    <small>{epoch.toolNames.length} {epoch.toolNames.length === 1 ? 'TOOL' : 'TOOLS'}</small>
    <button aria-label={`View effective prompt ${code}`} onClick={() => { onEventSelect(epoch.eventId) }}>VIEW EFFECTIVE PROMPT</button>
  </div>
}

function Execution({ epochs, turns, onEventSelect }: {
  readonly epochs: readonly PromptEpoch[]
  readonly turns: readonly ExecutionTurn[]
  readonly onEventSelect: (eventId: string) => void
}): React.JSX.Element {
  const stepCount = turns.reduce((count, turn) => count + turn.steps.length, 0)
  const epochById = new Map(epochs.map(epoch => [epoch.eventId, epoch] as const))
  return <section className="execution" aria-label="执行叙事">
    <header className="execution-intro"><span>EXECUTION REVIEW</span><p>{turns.length} turns · {stepCount} steps · reconstructed from recorded agent decisions</p></header>
    <PromptEpochReview epochs={epochs} onEventSelect={onEventSelect} />
    {turns.map((turn, turnIndex) => <details className="execution-turn" key={turn.id} open={turnIndex === 0}>
      <summary><span>TURN {String(turn.turn).padStart(2, '0')}</span><small>{turn.steps.length} STEPS</small></summary>
      {turn.prompt !== undefined && <details className="turn-prompt">
        <summary><span>USER PROMPT</span><p>{preview(turn.prompt.content, 180)}</p></summary>
        <div className="detail-body"><p>{turn.prompt.content}</p><button onClick={() => {
          const eventId = turn.prompt?.eventId
          if (eventId !== undefined) onEventSelect(eventId)
        }}>VIEW RAW EVENT</button></div>
      </details>}
      <ol>{turn.steps.map((step, stepIndex) => <li key={step.id}>
        <details className="execution-step" open={turnIndex === 0 && stepIndex === 0}>
          <summary><span>STEP {String(step.step).padStart(2, '0')}</span>{step.tools.length > 0 && <em className="step-tool-trail">{step.tools.map(tool => tool.name).join(' → ')}</em>}<small>{step.eventCount.toLocaleString('en-US')} RECORDS · {step.tools.length} TOOLS</small></summary>
          <div className="step-body">
            <StepPromptContext epoch={step.promptEpochEventId === undefined ? undefined : epochById.get(step.promptEpochEventId)} onEventSelect={onEventSelect} />
            {step.reasoning !== '' && <details className="step-block reasoning">
              <summary><span>REASONING</span><p>{preview(step.reasoning)}</p></summary>
              <div className="detail-body"><p>{step.reasoning}</p>{step.reasoningEventId !== undefined && <button onClick={() => {
                if (step.reasoningEventId !== undefined) onEventSelect(step.reasoningEventId)
              }}>VIEW RAW EVENT</button>}</div>
            </details>}
            {step.tools.length > 0 && <ol className="step-tools" aria-label="Tool calls in execution order">{step.tools.map(tool => <li key={tool.eventId}><details className={`execution-tool${tool.failed ? ' failed' : ''}`}>
              <summary><strong>{tool.name}</strong><span>{preview(tool.output !== '' ? tool.output : tool.input, 120) || '查看工具详情'}</span></summary>
              <div className="tool-details">
                <section><h4>INPUT</h4><StructuredJson value={tool.input} empty="No input parameters were recorded." /></section>
                <section><h4>{tool.failed ? 'ERROR OUTPUT' : 'RESULT'}</h4><StructuredJson value={tool.output} empty="No model-visible result was recorded." /></section>
                <button onClick={() => { onEventSelect(tool.eventId) }}>VIEW RAW EVENT</button>
              </div>
            </details></li>)}</ol>}
            {step.assistant !== '' && <details className="step-block assistant">
              <summary><span>ASSISTANT RESPONSE</span><p>{preview(step.assistant)}</p></summary>
              <div className="detail-body"><p>{step.assistant}</p>{step.assistantEventId !== undefined && <button onClick={() => {
                if (step.assistantEventId !== undefined) onEventSelect(step.assistantEventId)
              }}>VIEW RAW EVENT</button>}</div>
            </details>}
          </div>
        </details>
      </li>)}</ol>
    </details>)}
  </section>
}

/** The three linked Explorer views for one selected DSH session. */
export function ExplorerWorkspace({
  session,
  conversation,
  selectedEventId,
  onEventSelect,
}: ExplorerWorkspaceProps): React.JSX.Element {
  const [view, setView] = useState<WorkspaceView>('execution')
  const labels = useMemo(() => ({ overview: '概览', execution: '执行', timeline: '时间线', conversation: '对话' }), [])
  return <section className="workspace">
    <header className="workspace-toolbar">
      <div className="workspace-readout"><b>会话记录</b><small>{session.eventCount.toLocaleString('zh-CN')} 条事件</small></div>
      <nav aria-label="工作台视图">{(Object.keys(labels) as WorkspaceView[]).map(key => <button key={key} aria-pressed={view === key} onClick={() => { setView(key) }}>{labels[key]}</button>)}</nav>
    </header>
    {view === 'overview' && <Overview session={session} />}
    {view === 'execution' && <Execution epochs={session.promptEpochs} turns={session.execution} onEventSelect={onEventSelect} />}
    {view === 'timeline' && <Timeline items={session.timeline} onEventSelect={onEventSelect} selectedEventId={selectedEventId} turns={session.execution} />}
    {view === 'conversation' && <Conversation records={conversation} selectedEventId={selectedEventId} onEventSelect={onEventSelect} />}
  </section>
}
