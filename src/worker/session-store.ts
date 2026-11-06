import { projectSession, type ConversationRecord, type ExecutionTurn, type PromptEpoch, type SessionSummary, type TimelineItem } from '../model/projection.ts'
import type { ExplorerEvent } from './parser.ts'
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
        execution.push({ ...turn, steps, promptEpochs: epochs })
        if (turn.prompt !== undefined) ids.add(turn.prompt.eventId)
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
      this.conversations.set(session.header.id, projection.conversation)
      return {
        id: session.header.id,
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
