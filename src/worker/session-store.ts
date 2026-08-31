import { projectSession, type ConversationRecord, type ExecutionTurn, type SessionSummary, type TimelineItem } from '../model/projection.ts'
import type { ExplorerEvent } from './parser.ts'
import { importDshArchive, importDshDirectory, importDshFile, type DshArchiveInput, type DshDirectoryEntry, type ImportedDshArchive } from './importer.ts'

export interface ExplorerSessionView {
  readonly id: string
  readonly parentSessionId?: string
  readonly sourcePath: string
  readonly eventCount: number
  readonly summary: SessionSummary
  readonly timeline: readonly TimelineItem[]
  readonly execution: readonly ExecutionTurn[]
}

export interface ExplorerImportView {
  readonly rootSessionId: string
  readonly sessions: readonly ExplorerSessionView[]
  readonly mediaNames: readonly string[]
  readonly missingMediaNames: readonly string[]
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
  private readonly mediaObjects = new Map<string, Uint8Array>()
  private current: ExplorerImportView | undefined

  async importDirectory(entries: readonly DshDirectoryEntry[]): Promise<ExplorerImportView> {
    return this.setArchive(await importDshDirectory(entries))
  }

  async importArchive(input: DshArchiveInput): Promise<ExplorerImportView> {
    return this.setArchive(await importDshArchive(input))
  }

  async importFile(input: DshArchiveInput): Promise<ExplorerImportView> {
    const parsed = await importDshFile(input)
    return this.setArchive({ rootSessionId: parsed.header.id, sessions: [{ ...parsed, sourcePath: input.name }], media: new Map() })
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

  snapshot(): ExplorerImportView | undefined {
    return this.current
  }

  private setArchive(archive: ImportedDshArchive): ExplorerImportView {
    this.events.clear()
    this.conversations.clear()
    this.mediaObjects.clear()
    for (const [name, bytes] of archive.media) this.mediaObjects.set(name, bytes)
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
      }
    })
    const mediaNames = [...archive.media.keys()].sort()
    const missingMediaNames = [...refs].filter(id => !mediaNames.some(name => name === id || name.startsWith(`${id}.`))).sort()
    this.current = { rootSessionId: archive.rootSessionId, sessions, mediaNames, missingMediaNames }
    return this.current
  }
}
