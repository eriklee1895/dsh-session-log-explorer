import { projectSession, type ConversationRecord, type ExecutionTool, type ExecutionTurn, type PromptEpoch, type SessionSummary, type TimelineItem } from '../model/projection.ts'
import type { ExplorerEvent } from './parser.ts'
import { recordOf } from './parser.ts'
import { searchEvents, type SearchEntry, type SessionSearchRequest, type SessionSearchPage } from './search.ts'
import { importDshArchive, importDshDirectory, importDshFile, type DshArchiveInput, type DshDirectoryEntry, type ImportedDshArchive, type ImportProgress } from './importer.ts'

export interface ExplorerSessionView {
  readonly id: string
  readonly parentSessionId?: string
  readonly sourcePath: string
  readonly eventCount: number
  readonly summary: SessionSummary
  readonly timeline: readonly TimelineItem[]
  readonly execution: readonly ExecutionTurn[]
  readonly promptEpochs: readonly PromptEpoch[]
  readonly page?: { readonly offset: number; readonly count: number; readonly total: number }
  readonly title?: string
  readonly model?: string
  readonly formatVersion?: number
}

export interface ExplorerImportView {
  readonly rootSessionId: string
  readonly sessions: readonly ExplorerSessionView[]
  readonly mediaNames: readonly string[]
  readonly missingMediaNames: readonly string[]
  readonly attachmentNames?: readonly string[]
}

export interface ExplorerConversationPage {
  readonly records: readonly ConversationRecord[]
  readonly offset: number
  readonly total: number
  readonly previousOffset: number
  readonly nextOffset: number
}

function imageReferences(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) imageReferences(child, refs)
    return
  }
  if (typeof value !== 'object' || value === null) return
  const record = value as Record<string, unknown>
  if (record.type === 'image' && typeof record.attachment === 'object' && record.attachment !== null) {
    const attachment = record.attachment as Record<string, unknown>
    if (typeof attachment.attachmentId === 'string') refs.add(attachment.attachmentId)
  }
  for (const child of Object.values(record)) imageReferences(child, refs)
}

/** Holds the parsed artifact in the Worker and exposes derived view data to the UI. */
export class ExplorerSessionStore {
  private readonly events = new Map<string, ExplorerEvent>()
  private readonly tools = new Map<string, ExecutionTool>()
  private readonly locations = new Map<string, { sessionId: string; offset: number; positionKnown: boolean }>()
  private readonly conversations = new Map<string, readonly ConversationRecord[]>()
  private readonly conversationPageOffsets = new Map<string, number[]>()
  private readonly mediaObjects = new Map<string, Uint8Array>()
  private readonly fileObjects = new Map<string, Uint8Array>()
  private current: ExplorerImportView | undefined

  async importDirectory(entries: readonly DshDirectoryEntry[], progress?: ImportProgress): Promise<ExplorerImportView> {
    return this.setArchive(await importDshDirectory(entries, progress), progress)
  }

  async importArchive(input: DshArchiveInput, progress?: ImportProgress): Promise<ExplorerImportView> {
    return this.setArchive(await importDshArchive(input, progress), progress)
  }

  async importFile(input: DshArchiveInput, progress?: ImportProgress): Promise<ExplorerImportView> {
    const parsed = await importDshFile(input, progress)
    return this.setArchive({ rootSessionId: parsed.header.id, sessions: [{ ...parsed, sourcePath: input.name }], media: new Map() }, progress)
  }

  event(id: string): ExplorerEvent | undefined {
    return this.events.get(id)
  }

  tool(id: string): ExecutionTool | undefined { return this.tools.get(id) }

  reveal(id: string): { sessionId: string; session: ExplorerSessionView; tool?: ExecutionTool; positionKnown: boolean } | undefined {
    const location = this.locations.get(id)
    if (location === undefined) return undefined
    let session = this.sessionPage(location.sessionId, location.offset)
    if (session === undefined) return undefined
    const item = this.current?.sessions.find(value => value.id === location.sessionId)?.timeline.find(value => value.eventId === id)
    if (item !== undefined && !session.timeline.some(value => value.eventId === id)) {
      session = { ...session, timeline: [...session.timeline, item].sort((a, b) => a.start - b.start || (a.eventSeqs[0] ?? 0) - (b.eventSeqs[0] ?? 0)) }
    }
    return { sessionId: location.sessionId, session, tool: this.tools.get(id), positionKnown: location.positionKnown }
  }

  search(request: SessionSearchRequest, isCurrent?: () => boolean): Promise<SessionSearchPage | undefined> {
    const entries = function* (store: ExplorerSessionStore): Generator<SearchEntry> {
      for (const [eventId, event] of store.events) yield { eventId, event, sessionId: store.locations.get(eventId)!.sessionId,
        tool: store.tools.get(eventId)?.name }
    }
    return searchEvents(entries(this), request, isCurrent)
  }

  conversation(sessionId: string): readonly ConversationRecord[] | undefined {
    return this.conversations.get(sessionId)
  }

  media(name: string): Uint8Array | undefined {
    return this.mediaObjects.get(name)
  }

  attachment(path: string): Uint8Array | undefined {
    return this.fileObjects.get(path)
  }

  snapshot(): ExplorerImportView | undefined {
    return this.current
  }

  /** Transfer a bounded execution window; full events and projections stay in the Worker. */
  sessionPage(sessionId: string, offset = 0): ExplorerSessionView | undefined {
    const session = this.current?.sessions.find(value => value.id === sessionId)
    if (session === undefined) return undefined
    const total = session.execution.reduce((count, turn) => count + Math.max(1, turn.steps.length), 0)
    const start = Math.max(0, Math.min(Math.floor(offset), Math.max(0, total - 1)))
    const end = start + 40
    const execution: ExecutionTurn[] = []
    const ids = new Set<string>()
    let position = 0
    for (const turn of session.execution) {
      const count = Math.max(1, turn.steps.length)
      const steps = turn.steps.slice(Math.max(0, start - position), Math.max(0, end - position))
      if (position < end && position + count > start) {
        const epochs = turn.promptEpochs.filter(epoch => epoch.step === undefined || steps.some(step => step.step === epoch.step))
        const clip = (text: string): string => text.slice(0, 16_384)
        const responseSteps = steps.map(step => ({ ...step, reasoning: clip(step.reasoning), assistant: clip(step.assistant),
          previewed: step.reasoning.length > 16_384 || step.assistant.length > 16_384,
          tools: step.tools.map(tool => ({ ...tool, input: clip(tool.input), output: clip(tool.output),
            previewed: tool.input.length > 16_384 || tool.output.length > 16_384 })) }))
        execution.push({ ...turn, steps: responseSteps, promptEpochs: epochs, inputs: turn.inputs?.slice(0, 20), inputCount: turn.inputs?.length ?? 0,
          prompt: turn.prompt === undefined ? undefined : { ...turn.prompt, content: clip(turn.prompt.content), previewed: turn.prompt.content.length > 16_384 } })
        if (turn.prompt !== undefined) ids.add(turn.prompt.eventId)
        for (const input of turn.inputs?.slice(0, 20) ?? []) ids.add(input.eventId)
        if (turn.outcome !== undefined) ids.add(turn.outcome.eventId)
        for (const epoch of epochs) ids.add(epoch.eventId)
        for (const step of steps) {
          if (step.reasoningEventId !== undefined) ids.add(step.reasoningEventId)
          if (step.assistantEventId !== undefined) ids.add(step.assistantEventId)
          if (step.promptEpochEventId !== undefined) ids.add(step.promptEpochEventId)
          for (const tool of step.tools) ids.add(tool.eventId)
        }
      }
      position += count
      if (position >= end) break
    }
    const annotations = session.timeline.filter(item => item.severity !== undefined
      && (item.turn === undefined || execution.some(turn => turn.turn === item.turn
        && (item.step === undefined || turn.steps.some(step => step.step === item.step))))).slice(0, 40)
    for (const item of annotations) ids.add(item.eventId)
    const epochs = session.promptEpochs.filter(epoch => ids.has(epoch.eventId))
    const previous = new Set(epochs.flatMap(epoch => epoch.previousEventId === undefined ? [] : [epoch.previousEventId]))
    return { ...session, execution, timeline: session.timeline.filter(item => ids.has(item.eventId)),
      promptEpochs: session.promptEpochs.filter(epoch => ids.has(epoch.eventId) || previous.has(epoch.eventId)),
      page: { offset: start, count: Math.min(40, Math.max(0, total - start)), total } }
  }

  initialView(): ExplorerImportView | undefined {
    if (this.current === undefined) return undefined
    return { ...this.current, sessions: this.current.sessions.map(session => session.id === this.current?.rootSessionId
      ? this.sessionPage(session.id)!
      : { ...session, execution: [], timeline: [], promptEpochs: [] }) }
  }

  conversationPage(sessionId: string, offset = 0): ExplorerConversationPage {
    const all = this.conversations.get(sessionId) ?? []
    const target = Math.max(0, Math.min(Math.floor(offset || 0), all.length))
    const offsets = this.conversationPageOffsets.get(sessionId) ?? [0]
    if (this.conversations.has(sessionId)) this.conversationPageOffsets.set(sessionId, offsets)
    // Extend the boundary index only as far as requested. Revisiting a page does not rescan the log.
    let end = offsets.at(-1)!
    while (end < all.length && end <= target) {
      const start = end
      let characters = 0
      while (end < all.length && end - start < 100) {
        const length = all[end]!.content.length
        if (end > start && characters + length > 262_144) break
        characters += length
        end++
      }
      offsets.push(end)
    }
    // Snap direct offsets to the containing page, so next/previous remain exact inverses.
    let lower = 0
    let upper = offsets.length
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2)
      if (offsets[middle]! <= target) lower = middle
      else upper = middle
    }
    const start = offsets[lower]!
    end = offsets[lower + 1] ?? start
    return { records: all.slice(start, end), offset: start, total: all.length,
      previousOffset: offsets[Math.max(0, lower - 1)]!, nextOffset: end }
  }

  private setArchive(archive: ImportedDshArchive, progress?: ImportProgress): ExplorerImportView {
    progress?.('projecting')
    this.events.clear()
    this.tools.clear()
    this.locations.clear()
    this.conversations.clear()
    this.conversationPageOffsets.clear()
    this.mediaObjects.clear()
    this.fileObjects.clear()
    for (const [name, bytes] of archive.media) this.mediaObjects.set(name, bytes)
    for (const [path, bytes] of archive.files ?? []) this.fileObjects.set(path, bytes)
    const refs = new Set<string>()
    const sessions = archive.sessions.map((session) => {
      const projection = projectSession(session)
      for (const event of session.events) imageReferences(event.data, refs)
      for (const [id, event] of projection.events) this.events.set(id, event)
      for (const [id, tool] of projection.tools) this.tools.set(id, tool)
      const turnPages = new Map<number, number>()
      const stepPages = new Map<string, number>()
      const owners = new Map<string, { turn?: number; step?: number }>(projection.timeline.map(item => [item.eventId, item]))
      let position = 0
      for (const turn of projection.execution) {
        turnPages.set(turn.turn, Math.floor(position / 40) * 40)
        if (turn.steps.length === 0) position++
        for (const step of turn.steps) {
          stepPages.set(`${turn.turn}:${step.step}`, Math.floor(position++ / 40) * 40)
          for (const id of [step.eventId, step.reasoningEventId, step.assistantEventId,
            ...step.tools.flatMap(tool => [tool.eventId, tool.callEventId, tool.resultEventId])]) {
            if (id !== undefined) owners.set(id, { turn: turn.turn, step: step.step })
          }
        }
      }
      // Epoch coordinates belong to the header's own recording, not later steps reusing it.
      for (const epoch of projection.promptEpochs) owners.set(epoch.eventId, { turn: epoch.turn, step: epoch.step })
      for (const [id, event] of projection.events) {
        const data = recordOf(event.data)
        const turn = typeof data?.turn === 'number' ? data.turn : owners.get(id)?.turn
        const step = typeof data?.step === 'number' ? data.step : owners.get(id)?.step
        const offset = stepPages.get(`${turn}:${step}`) ?? turnPages.get(turn ?? -1)
        this.locations.set(id, { sessionId: session.header.id, offset: offset ?? 0, positionKnown: offset !== undefined })
      }
      this.conversations.set(session.header.id, projection.conversation)
      let title: unknown
      for (let index = session.events.length - 1; index >= 0; index--) {
        const event = session.events[index]!
        if (event.type === 'session/title' && typeof recordOf(event.data)?.title === 'string') { title = recordOf(event.data)!.title; break }
      }
      const model = projection.promptEpochs.at(-1)?.config.model
      return {
        id: session.header.id,
        ...(typeof title === 'string' ? { title } : {}), ...(typeof model === 'string' ? { model } : {}), formatVersion: session.header.version,
        ...(session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId }),
        sourcePath: session.sourcePath,
        eventCount: session.events.length,
        summary: projection.summary,
        timeline: projection.timeline,
        execution: projection.execution,
        promptEpochs: projection.promptEpochs,
      }
    })
    const mediaNames = [...archive.media.keys()].sort()
    const missingMediaNames = [...refs].filter(id => !mediaNames.some(name => name === id || name.startsWith(`${id}.`))).sort()
    this.current = { rootSessionId: archive.rootSessionId, sessions, mediaNames, missingMediaNames, attachmentNames: [...this.fileObjects.keys()].sort() }
    return this.current
  }
}
