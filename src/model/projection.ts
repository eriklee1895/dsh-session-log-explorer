import { recordOf, type ExplorerEvent, type ParsedSessionJsonl } from '../worker/parser.ts'
import { decodeAssistantStream } from '../worker/chunk-codec.ts'
import { isErrorEvent, messageLabel, messageSource, turnOutcomeLabel, toolResultIdentity } from './event-facts.ts'

export type TimelineKind = 'user' | 'reasoning' | 'tool' | 'assistant' | 'system'

export interface SessionSummary {
  readonly turns: number
  readonly steps: number
  readonly toolCalls: number
  readonly toolResults: number
  readonly errors: number
  readonly durationMs: number
  readonly tokens: Readonly<Record<string, number>>
}

export interface TimelineItem {
  readonly id: string
  readonly eventId: string
  readonly kind: TimelineKind
  readonly label: string
  readonly start: number
  readonly end: number
  readonly eventSeqs: readonly number[]
  readonly turn?: number
  readonly step?: number
  readonly severity?: 'error' | 'diagnostic'
}

export interface ConversationRecord {
  readonly eventId: string
  readonly kind: TimelineKind
  readonly label: string
  readonly content: string
  readonly eventSeqs: readonly number[]
  readonly source?: string
}

export interface ExecutionTool {
  readonly eventId: string
  readonly name: string
  readonly input: string
  readonly output: string
  readonly failed: boolean
  readonly parentCallId?: string
  readonly callEventId?: string
  readonly resultEventId?: string
  readonly status?: 'pending' | 'returned' | 'error' | 'orphan'
}

export interface ExecutionStep {
  readonly id: string
  readonly eventId: string
  readonly turn: number
  readonly step: number
  readonly start: number
  readonly end: number
  readonly eventCount: number
  readonly errors: number
  readonly reasoning: string
  readonly reasoningEventId: string | undefined
  readonly assistant: string
  readonly assistantEventId: string | undefined
  readonly promptEpochEventId: string | undefined
  readonly tools: readonly ExecutionTool[]
}

export type PromptEpochField = 'config' | 'system' | 'tools'

export interface PromptEpoch {
  readonly ordinal: number
  readonly eventId: string
  readonly previousEventId: string | undefined
  readonly reason: 'initial' | 'resume' | 'change' | 'series'
  readonly startsSeries?: true
  readonly turn: number | undefined
  readonly step: number | undefined
  readonly time: number
  readonly config: Readonly<Record<string, unknown>>
  readonly system: string
  readonly tools: readonly unknown[]
  readonly toolNames: readonly string[]
  readonly changedFields: readonly PromptEpochField[]
}

export interface ExecutionTurn {
  readonly id: string
  readonly turn: number
  readonly start: number
  readonly end: number
  readonly prompt: { readonly eventId: string; readonly content: string } | undefined
  readonly promptEpochs: readonly PromptEpoch[]
  readonly steps: readonly ExecutionStep[]
  readonly outcome?: { readonly kind: string; readonly label: string; readonly eventId: string }
  readonly inputs?: readonly { readonly eventId: string; readonly source: string; readonly label: string; readonly preview: string }[]
  readonly inputCount?: number
}

export interface SessionProjection {
  readonly summary: SessionSummary
  readonly timeline: readonly TimelineItem[]
  readonly conversation: readonly ConversationRecord[]
  readonly execution: readonly ExecutionTurn[]
  readonly promptEpochs: readonly PromptEpoch[]
  readonly events: ReadonlyMap<string, ExplorerEvent>
  readonly tools: ReadonlyMap<string, ExecutionTool>
  readonly diagnostics: readonly ConversationRecord[]
}

function eventId(sessionId: string, event: ExplorerEvent): string {
  return `${sessionId}:${String(event.seq)}`
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((item) => {
    const record = recordOf(item)
    if (record?.type === 'text' && typeof record.text === 'string') return [record.text]
    if (record?.type === 'image') return ['[图片]']
    if (record?.type === 'file') return [`[文件：${String(recordOf(record.attachment)?.name ?? 'attachment')}]`]
    if (record?.type === 'tool-result') return [textOf(record.content)]
    if (record?.type === 'tool-addition' || record?.type === 'tool-removal') return [`[${record.type}: ${String(record.toolName)}]`]
    return []
  }).join('')
}

function dataNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function dataIndex(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function positionOf(event: ExplorerEvent): string {
  const data = recordOf(event.data) ?? {}
  const turn = typeof data.turn === 'number' ? data.turn : -1
  const step = typeof data.step === 'number' ? data.step : -1
  return `${String(turn)}:${String(step)}`
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function promptEpochLabel(epoch: PromptEpoch): string {
  if (epoch.reason === 'series' && epoch.changedFields.length === 0) return 'Request Message Series Started'
  if (epoch.reason === 'initial') return 'Initial Request Context'
  if (epoch.reason === 'resume' && epoch.changedFields.length === 0) return 'Request Context Resumed'
  const changed = new Set(epoch.changedFields)
  if (changed.has('system') && changed.has('tools')) return 'System Prompt and Tools Updated'
  if (changed.has('system')) return 'System Prompt Updated'
  if (changed.has('tools')) return 'Tools Updated'
  if (changed.has('config')) return 'Model Configuration Updated'
  return 'Request Header Updated'
}

/** Project a decoded session into the compact records used by every Explorer view. */
export function projectSession(session: ParsedSessionJsonl): SessionProjection {
  const timeline: TimelineItem[] = []
  const conversation: ConversationRecord[] = []
  const promptEpochs: PromptEpoch[] = []
  const events = new Map<string, ExplorerEvent>()
  const tools = new Map<string, ExecutionTool>()
  const diagnostics: ConversationRecord[] = []
  const reasoning = new Map<string, { item: TimelineItem; record: ConversationRecord }>()
  const pendingCalls = new Map<string, { readonly event: ExplorerEvent; readonly step: ExecutionStepBuilder | undefined; readonly tool: ExecutionTool }[]>()
  const stepsById = new Map<string, ExecutionStepBuilder>()
  const turnsByNumber = new Map<number, ExecutionTurnBuilder>()
  const tokens: Record<string, number> = {}
  const surface: ExplorerEvent[] = []
  const ptcCalls = new Map<string, { event: ExplorerEvent; step: ExecutionStepBuilder | undefined; tool: ExecutionTool }>()
  let turnCount = 0
  let steps = 0
  let toolCalls = 0
  let toolResults = 0
  let errors = 0
  let firstTime: number | undefined
  let lastTime: number | undefined
  let activeTurn: number | undefined
  let activeStep: ExecutionStepBuilder | undefined
  let currentPromptEpoch: PromptEpoch | undefined

  const ensureTurn = (turn: number, time: number): ExecutionTurnBuilder => {
    const existing = turnsByNumber.get(turn)
    if (existing !== undefined) {
      existing.start = Math.min(existing.start, time)
      existing.end = Math.max(existing.end, time)
      return existing
    }
    const builder: ExecutionTurnBuilder = {
      id: `${session.header.id}:turn:${String(turn)}`, turn, start: time, end: time,
      prompt: undefined, promptEpochs: [], steps: [], inputs: [],
    }
    turnsByNumber.set(turn, builder)
    return builder
  }

  const ensureStep = (event: ExplorerEvent, id: string): ExecutionStepBuilder | undefined => {
    const data = recordOf(event.data) ?? {}
    const turn = dataIndex(data, 'turn')
    const step = dataIndex(data, 'step')
    if (turn === undefined || step === undefined) return undefined
    activeTurn = turn
    const turnBuilder = ensureTurn(turn, event.time)
    const stepId = `${session.header.id}:step:${String(turn)}:${String(step)}`
    const existing = stepsById.get(stepId)
    if (existing !== undefined) {
      existing.end = Math.max(existing.end, event.time)
      existing.eventCount++
      return existing
    }
    const builder: ExecutionStepBuilder = {
      id: stepId,
      eventId: id,
      turn,
      step,
      start: event.time,
      end: event.time,
      eventCount: 1,
      errors: 0,
      reasoningEventId: undefined,
      assistantEventId: undefined,
      promptEpochEventId: currentPromptEpoch?.eventId,
      reasoningParts: [],
      assistantParts: [],
      tools: [],
    }
    stepsById.set(stepId, builder)
    turnBuilder.steps.push(builder)
    return builder
  }

  const append = (item: TimelineItem, record?: ConversationRecord): void => {
    const owner = recordOf(events.get(item.eventId)?.data)
    timeline.push({ ...item, ...(activeTurn === undefined ? {} : { turn: dataIndex(owner ?? {}, 'turn') ?? activeTurn }),
      ...(dataIndex(owner ?? {}, 'step') === undefined ? {} : { step: dataIndex(owner ?? {}, 'step') }) })
    if (record !== undefined) conversation.push(record)
  }
  for (const event of session.events) {
    const id = eventId(session.header.id, event)
    const data = recordOf(event.data) ?? {}
    if (event.surfaceOp === 'append') surface.push(event)
    else if (event.surfaceOp !== undefined) {
      const op = event.surfaceOp
      const first = surface.findIndex(node => node.seq === op.startSeq)
      const last = surface.findIndex(node => node.seq === op.endSeq)
      if (first < 0 || last < first) throw new Error(`event ${event.seq} replaces missing or reversed surface nodes`)
      surface.splice(first, last - first + 1, event)
    }
    events.set(id, event)
    firstTime = firstTime === undefined ? event.time : Math.min(firstTime, event.time)
    lastTime = lastTime === undefined ? event.time : Math.max(lastTime, event.time)
    if (event.type === 'turn/start') {
      turnCount++
      activeTurn = dataIndex(data, 'turn') ?? activeTurn
      if (activeTurn !== undefined) ensureTurn(activeTurn, event.time)
    }
    if (event.type === 'step/start') steps++
    const step = ensureStep(event, id)
    if (event.type === 'step/start' && step !== undefined) activeStep = step
    const turn = dataIndex(data, 'turn') ?? activeTurn
    if (turn !== undefined) ensureTurn(turn, event.time)
    if (isErrorEvent(event)) {
      errors++
      if (step !== undefined) step.errors++
    }
    if (event.type === 'turn/end') {
      const reason = recordOf(data.reason)
      const kind = typeof reason?.kind === 'string' ? reason.kind : typeof data.reason === 'string' ? data.reason : undefined
      if (turn !== undefined && kind !== undefined) ensureTurn(turn, event.time).outcome = { kind, label: turnOutcomeLabel(kind), eventId: id }
      if (kind === 'error') append({ id, eventId: id, kind: 'system', label: 'Turn 出错', start: event.time, end: event.time, eventSeqs: [event.seq], severity: 'error' })
    }
    if (event.type === 'assistant/attempt') {
      const preview = decodeAssistantStream(data.stream ?? []).slice(0, 8).flatMap(({ chunk }) => typeof chunk.text === 'string' ? [chunk.text.slice(0, 220)] : []).join('')
      const diagnostic = { eventId: id, kind: 'system' as const, label: event.type,
        content: preview || '此尝试未提交为会话消息；查看原始事件。', eventSeqs: [event.seq] }
      diagnostics.push(diagnostic)
      append({ id, eventId: id, kind: 'system', label: event.type, start: event.time, end: event.time, eventSeqs: [event.seq], severity: 'diagnostic' })
      continue
    }

    if (event.type === 'request/header') {
      const header = recordOf(data.header) ?? {}
      const config = recordOf(header.config) ?? {}
      const tools = Array.isArray(header.tools) ? header.tools : []
      const system = session.header.version >= 3
        ? surface.filter(node => node.type === 'system/message').map(node => textOf(recordOf(recordOf(node.data)?.message)?.content)).filter(text => text !== '').join('\n\n')
        : typeof header.system === 'string' ? header.system : ''
      const reason = data.reason === 'initial' || data.reason === 'resume' || data.reason === 'change' || data.reason === 'series'
        ? data.reason
        : 'change'
      const changedFields: PromptEpochField[] = []
      if (currentPromptEpoch !== undefined) {
        if (!sameJson(currentPromptEpoch.config, config)) changedFields.push('config')
        if (currentPromptEpoch.system !== system) changedFields.push('system')
        if (!sameJson(currentPromptEpoch.tools, tools)) changedFields.push('tools')
      }
      const epoch: PromptEpoch = {
        ordinal: promptEpochs.length + 1,
        eventId: id,
        previousEventId: currentPromptEpoch?.eventId,
        reason,
        ...(data.startsSeries === true ? { startsSeries: true as const } : {}),
        turn: activeStep?.turn ?? turn,
        step: activeStep?.step,
        time: event.time,
        config,
        system,
        tools,
        toolNames: tools.flatMap((tool) => {
          const name = typeof tool === 'string' ? tool : recordOf(tool)?.name
          return typeof name === 'string' ? [name] : []
        }),
        changedFields,
      }
      promptEpochs.push(epoch)
      currentPromptEpoch = epoch
      if (activeStep !== undefined) activeStep.promptEpochEventId = id
      const epochTurn = epoch.turn === undefined ? undefined : ensureTurn(epoch.turn, event.time)
      if (epochTurn !== undefined) epochTurn.promptEpochs.push(epoch)
      append({
        id, eventId: id, kind: 'system', label: promptEpochLabel(epoch), start: event.time, end: event.time,
        eventSeqs: [event.seq],
      })
      continue
    }

    if (event.type === 'user/message') {
      const content = textOf(data.content)
      const source = messageSource(data)
      const label = messageLabel(source)
      if (turn !== undefined) {
        const owner = ensureTurn(turn, event.time)
        owner.inputs.push({ eventId: id, source, label, preview: content.slice(0, 220) })
        if (source === 'user' && content !== '' && owner.prompt === undefined) owner.prompt = { eventId: id, content }
      }
      append({ id, eventId: id, kind: 'user', label, start: event.time, end: event.time, eventSeqs: [event.seq] }, {
        eventId: id, kind: 'user', label, source, content, eventSeqs: [event.seq],
      })
      continue
    }
    if (event.type === 'assistant/chunk') {
      const chunk = recordOf(data.chunk)
      if (chunk?.type !== 'reasoning-delta' || typeof chunk.index !== 'number' || typeof chunk.text !== 'string') continue
      if (step !== undefined) {
        step.reasoningEventId ??= id
        step.reasoningParts.push(chunk.text)
      }
      const key = `${positionOf(event)}:${String(chunk.index)}`
      const existing = reasoning.get(key)
      if (existing === undefined) {
        const item: TimelineItem = { id, eventId: id, kind: 'reasoning', label: '模型推理', start: event.time, end: event.time, eventSeqs: [event.seq] }
        const record: ConversationRecord = { eventId: id, kind: 'reasoning', label: '模型推理', content: chunk.text, eventSeqs: [event.seq] }
        reasoning.set(key, { item, record })
        append(item, record)
      } else {
        const nextItem = { ...existing.item, end: event.time, eventSeqs: [...existing.item.eventSeqs, event.seq] }
        const nextRecord = {
          ...existing.record,
          content: existing.record.content + chunk.text,
          eventSeqs: [...existing.record.eventSeqs, event.seq],
        }
        reasoning.set(key, { item: nextItem, record: nextRecord })
        timeline[timeline.indexOf(existing.item)] = nextItem
        conversation[conversation.indexOf(existing.record)] = nextRecord
      }
      continue
    }
    if (event.type === 'tool/call') {
      toolCalls++
      const calls = pendingCalls.get(positionOf(event)) ?? []
      const tool: ExecutionTool = { eventId: id, name: typeof data.name === 'string' ? data.name : '工具调用',
        input: typeof data.arguments === 'string' ? data.arguments : '', output: '', failed: false, callEventId: id, status: 'pending' }
      tools.set(id, tool)
      if (step !== undefined) step.tools.push(tool)
      calls.push({ event, step, tool })
      pendingCalls.set(positionOf(event), calls)
      continue
    }
    if (event.type === 'tool/result') {
      toolResults++
      const message = recordOf(data.message)
      const legacy = Array.isArray(message?.content) ? message.content.map(recordOf).find(block => block?.type === 'tool-result') : undefined
      const { callId: resultId, failed } = toolResultIdentity(data)
      const calls = pendingCalls.get(positionOf(event))
      const callIndex = resultId === undefined ? 0 : calls?.findIndex(call => recordOf(call.event.data)?.callId === resultId) ?? -1
      const call = callIndex < 0 ? undefined : calls?.splice(callIndex, 1)[0]
      const callId = call === undefined ? id : eventId(session.header.id, call.event)
      const name = call?.tool.name ?? '工具调用'
      const content = textOf(legacy?.content ?? message?.content)
      const toolStep = call?.step ?? step
      const completed: ExecutionTool = { eventId: callId, name, input: call?.tool.input ?? '', output: content, failed,
        ...(call === undefined ? {} : { callEventId: callId }), resultEventId: id, status: call === undefined ? 'orphan' : failed ? 'error' : 'returned' }
      tools.set(callId, completed); tools.set(id, completed)
      if (toolStep !== undefined) {
        const index = call === undefined ? -1 : toolStep.tools.indexOf(call.tool)
        if (index < 0) toolStep.tools.push(completed)
        else toolStep.tools[index] = completed
      }
      append({
        id: callId, eventId: callId, kind: 'tool', label: name, start: call?.event.time ?? event.time, end: event.time,
        eventSeqs: call === undefined ? [event.seq] : [call.event.seq, event.seq], ...(failed ? { severity: 'error' as const } : {}),
      }, {
        eventId: callId, kind: 'tool', label: name, content, eventSeqs: call === undefined ? [event.seq] : [call.event.seq, event.seq],
      })
      continue
    }
    if (['tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'tool/code-dispatch-start', 'tool/code-dispatch'].includes(event.type)) {
      const key = typeof data.subCallId === 'string' ? data.subCallId : id
      const call = ptcCalls.get(key)
      const toolStep = call?.step ?? step ?? activeStep
      const tool: ExecutionTool = { eventId: call?.tool.eventId ?? id,
        name: typeof data.name === 'string' ? data.name : 'PTC',
        input: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}),
        output: textOf(data.content), failed: data.isError === true,
        ...(typeof data.parentCallId === 'string' ? { parentCallId: data.parentCallId } : {}),
        ...(event.type.endsWith('-start') ? { callEventId: id, status: 'pending' } : { resultEventId: id,
          ...(call === undefined ? {} : { callEventId: call.event.seq === event.seq ? id : eventId(session.header.id, call.event) }),
          status: call === undefined ? 'orphan' : data.isError === true ? 'error' : 'returned' }),
      }
      tools.set(tool.eventId, tool); tools.set(id, tool)
      const existing = call === undefined || toolStep === undefined ? -1 : toolStep.tools.indexOf(call.tool)
      if (toolStep !== undefined) {
        if (existing < 0) toolStep.tools.push(tool)
        else toolStep.tools[existing] = tool
      }
      if (event.type.endsWith('-start')) ptcCalls.set(key, { event, step: toolStep, tool })
      else {
        ptcCalls.delete(key)
        append({ id: tool.eventId, eventId: tool.eventId, kind: 'tool', label: tool.name, start: call?.event.time ?? event.time, end: event.time,
          eventSeqs: call === undefined ? [event.seq] : [call.event.seq, event.seq], ...(tool.failed ? { severity: 'error' as const } : {}) }, {
          eventId: tool.eventId, kind: 'tool', label: tool.name, content: tool.output, eventSeqs: call === undefined ? [event.seq] : [call.event.seq, event.seq],
        })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = recordOf(data.message)
      const stream = data.stream === undefined ? [] : decodeAssistantStream(data.stream)
      const reasoningChunks = stream.filter(item => item.chunk.type === 'reasoning-delta'
        || (item.chunk.type === 'block-end' && recordOf(item.chunk.block)?.type === 'reasoning'))
      const finalReasoning = Array.isArray(message?.content)
        ? message.content.map(recordOf).filter(block => block?.type === 'reasoning').map(block => block?.text).filter((text): text is string => typeof text === 'string').join('') : ''
      const deltaReasoning = reasoningChunks.filter(item => item.chunk.type === 'reasoning-delta').map(item => item.chunk.text).join('')
      const reasoningText = finalReasoning || deltaReasoning
      if (reasoningText !== '' && (stream.length > 0 || step?.reasoningParts.length === 0)) {
        if (step !== undefined) { step.reasoningEventId ??= id; step.reasoningParts.push(reasoningText) }
        const start = reasoningChunks.length === 0 ? event.time : Math.min(...reasoningChunks.map(item => item.time))
        const end = reasoningChunks.length === 0 ? event.time : Math.max(...reasoningChunks.map(item => item.time))
        append({ id: `${id}:reasoning`, eventId: id, kind: 'reasoning', label: '模型推理', start, end, eventSeqs: [event.seq] }, {
          eventId: id, kind: 'reasoning', label: '模型推理', content: reasoningText, eventSeqs: [event.seq],
        })
      }
      const usage = recordOf(data.usage)
      if (usage !== undefined) {
        for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
          const value = dataNumber(usage, key)
          if (value !== 0) tokens[key] = (tokens[key] ?? 0) + value
        }
      }
      const content = textOf(message?.content)
      if (step !== undefined && content !== '') {
        step.assistantEventId ??= id
        step.assistantParts.push(content)
      }
      if (content !== '') append({ id, eventId: id, kind: 'assistant', label: '模型回复', start: event.time, end: event.time, eventSeqs: [event.seq] }, {
        eventId: id, kind: 'assistant', label: '模型回复', content, eventSeqs: [event.seq],
      })
      continue
    }
    if (!['turn/start', 'turn/end', 'step/start', 'step/end', 'request/header', 'request/context'].includes(event.type)) {
      append({ id, eventId: id, kind: 'system', label: event.type, start: event.time, end: event.time, eventSeqs: [event.seq], ...(isErrorEvent(event) ? { severity: 'error' as const } : {}) }, {
        eventId: id, kind: 'system', label: event.type, content: event.type === 'system/message' || event.type === 'developer/message'
          ? textOf(recordOf(data.message)?.content) : JSON.stringify(event.data), eventSeqs: [event.seq],
      })
    }
    const endedStep = activeStep
    if (event.type === 'step/end' && endedStep !== undefined
      && endedStep.turn === dataIndex(data, 'turn')
      && endedStep.step === dataIndex(data, 'step')) activeStep = undefined
  }
  for (const calls of pendingCalls.values()) for (const call of calls) {
    const id = eventId(session.header.id, call.event)
    timeline.push({ id, eventId: id, kind: 'tool', label: call.tool.name, start: call.event.time, end: call.event.time, eventSeqs: [call.event.seq] })
  }
  const execution = [...turnsByNumber.values()].sort((a, b) => a.turn - b.turn).map(turn => ({
    id: turn.id,
    turn: turn.turn,
    start: turn.start,
    end: turn.end,
    prompt: turn.prompt,
    inputs: turn.inputs,
    ...(turn.outcome === undefined ? {} : { outcome: turn.outcome }),
    promptEpochs: turn.promptEpochs,
    steps: turn.steps.sort((a, b) => a.step - b.step).map(step => ({
      id: step.id,
      eventId: step.eventId,
      turn: step.turn,
      step: step.step,
      start: step.start,
      end: step.end,
      eventCount: step.eventCount,
      errors: step.errors,
      reasoning: step.reasoningParts.join(''),
      reasoningEventId: step.reasoningEventId,
      assistant: step.assistantParts.join('\n'),
      assistantEventId: step.assistantEventId,
      promptEpochEventId: step.promptEpochEventId,
      tools: step.tools,
    })),
  }))
  return {
    summary: {
      turns: turnCount, steps, toolCalls, toolResults, errors,
      durationMs: firstTime === undefined || lastTime === undefined ? 0 : lastTime - firstTime,
      tokens,
    },
    timeline: timeline.sort((a, b) => a.start - b.start || (a.eventSeqs[0] ?? 0) - (b.eventSeqs[0] ?? 0)),
    conversation,
    execution,
    promptEpochs,
    events,
    tools,
    diagnostics,
  }
}

interface ExecutionStepBuilder {
  readonly id: string
  readonly eventId: string
  readonly turn: number
  readonly step: number
  readonly start: number
  end: number
  eventCount: number
  errors: number
  reasoningEventId: string | undefined
  assistantEventId: string | undefined
  promptEpochEventId: string | undefined
  readonly reasoningParts: string[]
  readonly assistantParts: string[]
  readonly tools: ExecutionTool[]
}

interface ExecutionTurnBuilder {
  readonly id: string
  readonly turn: number
  start: number
  end: number
  prompt: { readonly eventId: string; readonly content: string } | undefined
  readonly promptEpochs: PromptEpoch[]
  readonly steps: ExecutionStepBuilder[]
  readonly inputs: { readonly eventId: string; readonly source: string; readonly label: string; readonly preview: string }[]
  outcome?: { readonly kind: string; readonly label: string; readonly eventId: string }
}
