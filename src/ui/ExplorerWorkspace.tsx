import { Fragment, useMemo, useState } from 'react'
import type { ConversationRecord, ExecutionTurn, PromptEpoch, TimelineItem } from '../model/projection.ts'
import type { ExplorerConversationPage, ExplorerSessionView } from '../worker/session-store.ts'
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
import { LazyDetails } from './LazyDetails.tsx'
import './ExplorerWorkspace.css'

type WorkspaceView = 'overview' | 'execution' | 'timeline' | 'conversation'

export interface ExplorerWorkspaceProps {
  readonly onErrorSearch?: () => void
  readonly loading?: boolean
  readonly onPageChange?: (offset: number) => void
  readonly conversationPage?: Omit<ExplorerConversationPage, 'records'>
  readonly onConversationPageChange?: (offset?: number) => void
  readonly session: ExplorerSessionView
  readonly conversation: readonly ConversationRecord[]
  readonly selectedEventId: string | undefined
  readonly onEventSelect: (eventId: string) => void
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000))
  return `${String(Math.floor(seconds / 60))} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

function Overview({ session, onErrorSearch }: Pick<ExplorerWorkspaceProps, 'session' | 'onErrorSearch'>): React.JSX.Element {
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
        <div><dt>错误事件</dt><dd><button className="metric-link" disabled={session.summary.errors === 0 || onErrorSearch === undefined} onClick={onErrorSearch}>{session.summary.errors} ↗</button></dd></div>
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
    const turnNumber = turn.turn ?? -1
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
  const turnNumbers = trajectoryTurns.map((turn, index) => turn.turn ?? -1)
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
      <input aria-label="Search trajectory" title="仅筛选当前页的摘要；完整文本请使用上方会话搜索" placeholder="筛选本页摘要" type="search" value={search} onChange={(event) => { setSearch(event.currentTarget.value) }} />
    </div>
    <div className="trajectory-ledger"><table aria-label="Trajectory records">
      <thead><tr><th>#</th><th>Event</th><th>Content</th><th>Time</th></tr></thead>
      <tbody>{trajectoryTurns.map((turn, turnIndex) => {
        const turnNumber = turn.turn ?? -1
        const turnRows = filtered.filter(row => row.turn === turnNumber)
        if (turnRows.length === 0) return null
        const collapsed = collapsedTurns.has(turnNumber)
        return <Fragment key={turnNumber}>
          <tr className="trajectory-turn-row"><th colSpan={4}><button onClick={() => { setCollapsedTurns((value) => {
            const next = new Set(value); if (next.has(turnNumber)) next.delete(turnNumber); else next.add(turnNumber); return next
          }) }}><span>{collapsed ? '▸' : '▾'} {turn.turn === null ? '未关联 Turn 的记录' : `Turn ${turnNumber}`}</span><small>{turnRows.length} records</small></button></th></tr>
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
    {records.map(record => <button className={`conversation-card ${record.kind}${record.eventId === selectedEventId ? ' selected' : ''}`} key={`${record.eventId}:${record.kind}`} onClick={() => { onEventSelect(record.eventId) }}>
      <span className="conversation-meta"><b>{record.label}</b>{record.source !== undefined && <code>{record.source}</code>}<code>#{record.eventSeqs[0]}</code></span><p>{record.content.slice(0, 16_384)}</p>
      {record.content.length > 16_384 && <small className="preview-note">正文显示预览。点击卡片查看完整原始事件。</small>}
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
  const code = `EPOCH ${String(epoch.ordinal).padStart(2, '0')}`
  const reference = `epoch ${String(epoch.ordinal).padStart(2, '0')}`
  return <div className="step-prompt-context">
    <span>CONTEXT · {code}</span>
    <strong>{typeof epoch.config.model === 'string' ? epoch.config.model : 'model not recorded'}</strong>
    <small>{epoch.toolNames.length} {epoch.toolNames.length === 1 ? 'TOOL' : 'TOOLS'}</small>
    <button aria-label={`View effective context ${reference}`} onClick={() => { onEventSelect(epoch.eventId) }}>VIEW EFFECTIVE CONTEXT</button>
  </div>
}

function Execution({ epochs, turns, onEventSelect, selectedEventId, focusedTurn, focusedStep }: {
  readonly epochs: readonly PromptEpoch[]
  readonly turns: readonly ExecutionTurn[]
  readonly onEventSelect: (eventId: string) => void
  readonly selectedEventId?: string
  readonly focusedTurn?: number
  readonly focusedStep?: number
}): React.JSX.Element {
  const stepCount = turns.reduce((count, turn) => count + turn.steps.length, 0)
  const epochById = new Map(epochs.map(epoch => [epoch.eventId, epoch] as const))
  const selectedStep = (step: ExecutionTurn['steps'][number]): boolean => selectedEventId !== undefined
    && ([step.eventId, step.reasoningEventId, step.assistantEventId, ...step.tools.flatMap(tool => [tool.eventId, tool.callEventId, tool.resultEventId])].includes(selectedEventId)
      || (step.turn === focusedTurn && step.step === focusedStep))
  return <section className="execution" aria-label="执行叙事">
    <header className="execution-intro"><span>EXECUTION REVIEW</span><p>{turns.length} turns · {stepCount} steps · reconstructed from recorded agent decisions</p></header>
    <PromptEpochReview epochs={epochs} onEventSelect={onEventSelect} />
    {turns.map((turn, turnIndex) => <LazyDetails className="execution-turn" key={turn.id} initialOpen={selectedEventId === undefined ? turnIndex === 0 : turn.turn === focusedTurn || turn.steps.some(selectedStep) || turn.inputs?.some(input => input.eventId === selectedEventId) === true || turn.outcome?.eventId === selectedEventId} summary={<><span>TURN {String(turn.turn).padStart(2, '0')}</span><span className="outcome-badge" data-kind={turn.outcome?.kind}>{turn.outcome?.label ?? '终态未记录'}</span><small>{turn.steps.length} STEPS</small></>}>{() => <>
      {turn.outcome !== undefined && <div className="turn-status-line"><span className="outcome-badge" data-kind={turn.outcome.kind}>{turn.outcome.label}</span><button className="raw-link" onClick={() => { onEventSelect(turn.outcome!.eventId) }}>查看 Turn 终态原始事件 ↗</button></div>}
      {(turn.inputs?.length ?? 0) > 0 && <LazyDetails className="turn-inputs" summary={<span>输入与上下文 · {turn.inputCount ?? turn.inputs!.length} 条</span>}>{() => <>
        <ol>{turn.inputs!.map(input => <li key={input.eventId}><button onClick={() => { onEventSelect(input.eventId) }}><span className="source-badge" data-source={input.source}>{input.label}</span><p>{input.preview}</p></button></li>)}</ol>
        {(turn.inputCount ?? 0) > turn.inputs!.length && <small>当前显示前 {turn.inputs!.length} 条，完整记录可按消息来源搜索。</small>}
      </>}</LazyDetails>}
      {turn.prompt !== undefined && <LazyDetails className="turn-prompt" summary={<><span>USER PROMPT</span><p>{preview(turn.prompt.content, 180)}</p></>}>{() => <>
        <div className="detail-body">{turn.prompt!.previewed && <p className="preview-note">请求内容为预览，原始事件保留完整文本。</p>}<p>{turn.prompt!.content}</p><button onClick={() => {
          const eventId = turn.prompt?.eventId
          if (eventId !== undefined) onEventSelect(eventId)
        }}>VIEW RAW EVENT</button></div>
      </>}</LazyDetails>}
      <ol>{turn.steps.map((step, stepIndex) => <li key={step.id}>
        <LazyDetails className={`execution-step${selectedStep(step) ? ' focused' : ''}`} initialOpen={selectedEventId === undefined ? turnIndex === 0 && stepIndex === 0 : selectedStep(step)} summary={<><span>STEP {String(step.step).padStart(2, '0')}</span>{step.tools.length > 0 && <em className="step-tool-trail">{step.tools.map(tool => tool.name).join(' → ')}</em>}<small>{step.eventCount.toLocaleString('en-US')} RECORDS · {step.tools.length} TOOLS</small></>}>{() => <div className="step-body">
            {step.previewed && <p className="preview-note">长文本显示预览。各内容的原始事件保留完整记录。</p>}
            <StepPromptContext epoch={step.promptEpochEventId === undefined ? undefined : epochById.get(step.promptEpochEventId)} onEventSelect={onEventSelect} />
            {step.reasoning !== '' && <LazyDetails className="step-block reasoning" summary={<><span>REASONING</span><p>{preview(step.reasoning)}</p></>}>{() => <>
              <div className="detail-body"><p>{step.reasoning}</p>{step.reasoningEventId !== undefined && <button onClick={() => {
                if (step.reasoningEventId !== undefined) onEventSelect(step.reasoningEventId)
              }}>VIEW RAW EVENT</button>}</div>
            </>}</LazyDetails>}
            {step.tools.length > 0 && <ol className="step-tools" aria-label="Tool calls in execution order">{step.tools.map(tool => <li key={tool.eventId}><LazyDetails className={`execution-tool${tool.failed ? ' failed' : ''}`} summary={<><strong>{tool.name}{tool.parentCallId !== undefined ? ' · PTC' : ''}</strong><span>{preview(tool.output !== '' ? tool.output : tool.input, 120) || '查看工具详情'}</span></>}>{() => <div className="tool-details">
                {tool.previewed && <p className="preview-note">参数或结果为预览；原始事件可查看或保存完整内容。</p>}
                <section><h4>INPUT</h4><StructuredJson value={tool.input} empty="No input parameters were recorded." /></section>
                <section><h4>{tool.failed ? 'ERROR OUTPUT' : 'RESULT'}</h4><StructuredJson value={tool.output} empty={tool.status === 'pending' ? '尚未记录结果。' : tool.resultEventId !== undefined ? '结果已返回，内容为空。' : 'No model-visible result was recorded.'} /></section>
                <button onClick={() => { onEventSelect(tool.eventId) }}>VIEW RAW EVENT</button>
                {tool.resultEventId !== undefined && <button className="raw-link" onClick={() => { onEventSelect(tool.resultEventId!) }}>查看结果原始事件 ↗</button>}
              </div>}</LazyDetails></li>)}</ol>}
            {step.assistant !== '' && <LazyDetails className="step-block assistant" summary={<><span>ASSISTANT RESPONSE</span><p>{preview(step.assistant)}</p></>}>{() => <>
              <div className="detail-body"><p>{step.assistant}</p>{step.assistantEventId !== undefined && <button onClick={() => {
                if (step.assistantEventId !== undefined) onEventSelect(step.assistantEventId)
              }}>VIEW RAW EVENT</button>}</div>
            </>}</LazyDetails>}
          </div>}</LazyDetails>
      </li>)}</ol>
    </>}</LazyDetails>)}
  </section>
}

/** The three linked Explorer views for one selected DSH session. */
export function ExplorerWorkspace({
  session,
  loading = false, onPageChange, conversationPage, onConversationPageChange,
  onErrorSearch,
  conversation,
  selectedEventId,
  onEventSelect,
}: ExplorerWorkspaceProps): React.JSX.Element {
  const [view, setView] = useState<WorkspaceView>('execution')
  const labels = useMemo(() => ({ overview: '概览', execution: '执行', timeline: '时间线', conversation: '对话' }), [])
  return <section className="workspace">
    <header className="workspace-toolbar">
      <div className="workspace-readout"><b>会话记录</b><small>{session.eventCount.toLocaleString('zh-CN')} 条事件</small></div>
      <nav aria-label="工作台视图">{(Object.keys(labels) as WorkspaceView[]).map(key => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); if (key === 'conversation') onConversationPageChange?.(0) }}>{labels[key]}</button>)}</nav>
      {session.summary.errors > 0 && <button className="error-shortcut" aria-label="查看所有错误" onClick={onErrorSearch} disabled={onErrorSearch === undefined}>{session.summary.errors} 个错误事件 ↗</button>}
    </header>
    {loading && <p className="view-loading" role="status"><span className="session-loading-spinner" aria-hidden="true" />正在加载会话视图…</p>}
    {session.page !== undefined && session.page.total > session.page.count && view !== 'overview' && view !== 'conversation' && <nav className="record-pagination" aria-label="执行记录分页">
      <button disabled={loading || session.page.offset === 0} onClick={() => { onPageChange?.(Math.max(0, session.page!.offset - 40)) }}>上一页</button>
      <span>执行记录 {session.page.offset + 1}–{session.page.offset + session.page.count} / {session.page.total}</span>
      <button disabled={loading || session.page.offset + session.page.count >= session.page.total} onClick={() => { onPageChange?.(session.page!.offset + session.page!.count) }}>下一页</button>
    </nav>}
    {view === 'conversation' && conversationPage !== undefined && conversationPage.total > 0 && <nav className="record-pagination" aria-label="对话记录分页">
      <button disabled={loading || conversationPage.offset === 0} onClick={() => { onConversationPageChange?.(conversationPage.previousOffset) }}>较早记录</button>
      <span>对话记录 {conversationPage.offset + 1}–{conversationPage.nextOffset} / {conversationPage.total}</span>
      <button disabled={loading || conversationPage.nextOffset >= conversationPage.total} onClick={() => { onConversationPageChange?.(conversationPage.nextOffset) }}>较新记录</button>
    </nav>}
    {view === 'overview'  && <Overview session={session} onErrorSearch={onErrorSearch} />}
    {view === 'execution' && <Execution epochs={session.promptEpochs} turns={session.execution} onEventSelect={onEventSelect} selectedEventId={selectedEventId}
      focusedTurn={session.timeline.find(item => item.eventId === selectedEventId)?.turn} focusedStep={session.timeline.find(item => item.eventId === selectedEventId)?.step} />}
    {view === 'timeline' && session.page !== undefined && session.page.total > session.page.count && <p className="view-loading">时间线展示当前页的执行记录，可切换页码查看其余记录。</p>}
    {view === 'timeline' && <Timeline key={session.page?.offset ?? 0} items={session.timeline} onEventSelect={onEventSelect} selectedEventId={selectedEventId} turns={session.execution} />}
    {view === 'conversation' && <Conversation records={conversation} selectedEventId={selectedEventId} onEventSelect={onEventSelect} />}
    {view === 'execution' && session.timeline.some(item => item.severity !== undefined) && <section className="page-diagnostics" aria-label="当前页诊断事件"><h3>诊断与错误证据</h3>
      <ul>{session.timeline.filter(item => item.severity !== undefined).map(item => <li className={item.severity === 'error' ? 'is-error' : ''} key={item.id}><button onClick={() => { onEventSelect(item.eventId) }}>{item.label} · #{item.eventSeqs[0]} ↗</button></li>)}</ul>
      <p>此处展示当前页诊断；模型 attempt 不属于已提交的对话。完整错误可使用上方错误筛选。</p>
    </section>}
  </section>
}
