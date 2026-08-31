import type { ExplorerEvent, ParsedSessionJsonl } from '../worker/parser.ts'

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
}

export interface ConversationRecord {
  readonly eventId: string
  readonly kind: TimelineKind
  readonly label: string
  readonly content: string
  readonly eventSeqs: readonly number[]
}

export interface ExecutionTool {
  readonly eventId: string
  readonly name: string
  readonly input: string
  readonly output: string
  readonly failed: boolean
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
  readonly reason: 'initial' | 'resume' | 'change'
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
}

export interface SessionProjection {
  readonly summary: SessionSummary
  readonly timeline: readonly TimelineItem[]
  readonly conversation: readonly ConversationRecord[]
  readonly execution: readonly ExecutionTurn[]
  readonly promptEpochs: readonly PromptEpoch[]
  readonly events: ReadonlyMap<string, ExplorerEvent>
}

function eventId(sessionId: string, event: ExplorerEvent): string {
  return `${sessionId}:${String(event.seq)}`
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((item) => {
    const record = recordOf(item)
    if (record?.type === 'text' && typeof record.text === 'string') return [record.text]
    if (record?.type === 'image') return ['[图片]']
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
  const turn = typeof event.data.turn === 'number' ? event.data.turn : -1
  const step = typeof event.data.step === 'number' ? event.data.step : -1
  return `${String(turn)}:${String(step)}`
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function promptEpochLabel(epoch: PromptEpoch): string {
  if (epoch.reason === 'initial') return 'Initial System Prompt'
  if (epoch.reason === 'resume' && epoch.changedFields.length === 0) return 'System Prompt Resumed'
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
  const reasoning = new Map<string, { item: TimelineItem; record: ConversationRecord }>()
  const pendingCalls = new Map<string, { readonly event: ExplorerEvent; readonly step: ExecutionStepBuilder | undefined }[]>()
  const stepsById = new Map<string, ExecutionStepBuilder>()
  const turnsByNumber = new Map<number, ExecutionTurnBuilder>()
  const tokens: Record<string, number> = {}
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
      prompt: undefined, promptEpochs: [], steps: [],
    }
    turnsByNumber.set(turn, builder)
    return builder
  }

  const ensureStep = (event: ExplorerEvent, id: string): ExecutionStepBuilder | undefined => {
    const turn = dataIndex(event.data, 'turn')
    const step = dataIndex(event.data, 'step')
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
    timeline.push(item)
    if (record !== undefined) conversation.push(record)
  }
  for (const event of session.events) {
    const id = eventId(session.header.id, event)
    events.set(id, event)
    firstTime = firstTime === undefined ? event.time : Math.min(firstTime, event.time)
    lastTime = lastTime === undefined ? event.time : Math.max(lastTime, event.time)
    if (event.type === 'turn/start') {
      turnCount++
      activeTurn = dataIndex(event.data, 'turn') ?? activeTurn
      if (activeTurn !== undefined) ensureTurn(activeTurn, event.time)
    }
    if (event.type === 'step/start') steps++
    const step = ensureStep(event, id)
    if (event.type === 'step/start' && step !== undefined) activeStep = step
    const turn = dataIndex(event.data, 'turn') ?? activeTurn
    if (turn !== undefined) ensureTurn(turn, event.time)

    if (event.type === 'request/header') {
      const header = recordOf(event.data.header) ?? {}
      const config = recordOf(header.config) ?? {}
      const tools = Array.isArray(header.tools) ? header.tools : []
      const system = typeof header.system === 'string' ? header.system : ''
      const reason = event.data.reason === 'initial' || event.data.reason === 'resume' || event.data.reason === 'change'
        ? event.data.reason
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
        turn: activeStep?.turn ?? turn,
        step: activeStep?.step,
        time: event.time,
        config,
        system,
        tools,
        toolNames: tools.flatMap((tool) => {
          const name = recordOf(tool)?.name
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
      const content = textOf(event.data.content)
      if (turn !== undefined && content !== '') ensureTurn(turn, event.time).prompt = { eventId: id, content }
      append({ id, eventId: id, kind: 'user', label: '用户输入', start: event.time, end: event.time, eventSeqs: [event.seq] }, {
        eventId: id, kind: 'user', label: '用户输入', content, eventSeqs: [event.seq],
      })
      continue
    }
    if (event.type === 'assistant/chunk') {
      const chunk = recordOf(event.data.chunk)
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
      calls.push({ event, step })
      pendingCalls.set(positionOf(event), calls)
      continue
    }
    if (event.type === 'tool/result') {
      toolResults++
      if (event.data.error !== undefined) errors++
      const calls = pendingCalls.get(positionOf(event))
      const call = calls?.shift()
      const callId = call === undefined ? id : eventId(session.header.id, call.event)
      const name = typeof call?.event.data.name === 'string' ? call.event.data.name : '工具调用'
      const content = textOf(recordOf(event.data.message)?.content)
      const toolStep = call?.step ?? step
      if (toolStep !== undefined) toolStep.tools.push({
        eventId: callId,
        name,
        input: typeof call?.event.data.arguments === 'string' ? call.event.data.arguments : '',
        output: content,
        failed: event.data.error !== undefined,
      })
      append({
        id: callId, eventId: callId, kind: 'tool', label: name, start: call?.event.time ?? event.time, end: event.time,
        eventSeqs: call === undefined ? [event.seq] : [call.event.seq, event.seq],
      }, {
        eventId: callId, kind: 'tool', label: name, content, eventSeqs: call === undefined ? [event.seq] : [call.event.seq, event.seq],
      })
      continue
    }
    if (event.type === 'assistant/message') {
      const message = recordOf(event.data.message)
      const usage = recordOf(event.data.usage)
      if (usage !== undefined) {
        for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens']) {
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
    if (event.type === 'agent/error') {
      errors++
      if (step !== undefined) step.errors++
    }
    if (!['turn/start', 'turn/end', 'step/start', 'step/end', 'request/header', 'request/context'].includes(event.type)) {
      append({ id, eventId: id, kind: 'system', label: event.type, start: event.time, end: event.time, eventSeqs: [event.seq] }, {
        eventId: id, kind: 'system', label: event.type, content: JSON.stringify(event.data), eventSeqs: [event.seq],
      })
    }
    const endedStep = activeStep
    if (event.type === 'step/end' && endedStep !== undefined
      && endedStep.turn === dataIndex(event.data, 'turn')
      && endedStep.step === dataIndex(event.data, 'step')) activeStep = undefined
  }
  const execution = [...turnsByNumber.values()].sort((a, b) => a.turn - b.turn).map(turn => ({
    id: turn.id,
    turn: turn.turn,
    start: turn.start,
    end: turn.end,
    prompt: turn.prompt,
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
}
