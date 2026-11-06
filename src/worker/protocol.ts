import type { ConversationRecord } from '../model/projection.ts'
import type { ExplorerEvent } from './parser.ts'
import type { ExplorerImportView, ExplorerSessionView } from './session-store.ts'

export type ImportPhase = 'reading' | 'extracting' | 'parsing' | 'projecting' | 'rendering'

export interface WorkerFileEntry {
  readonly name: string
  readonly path: string
  readonly bytes: ArrayBuffer
}

export type ExplorerWorkerRequest =
  | { readonly type: 'import'; readonly entries: readonly WorkerFileEntry[] }
  | { readonly type: 'import-files'; readonly entries: readonly { name: string; path: string; file: File }[] }
  | { readonly type: 'session'; readonly sessionId: string; readonly offset: number }
  | { readonly type: 'conversation'; readonly sessionId: string; readonly offset?: number }
  | { readonly type: 'event'; readonly eventId: string }
  | { readonly type: 'media'; readonly name: string }
  | { readonly type: 'attachment'; readonly path: string }

export type ExplorerWorkerResponse =
  | { readonly type: 'ready'; readonly view: ExplorerImportView }
  | { readonly type: 'progress'; readonly phase: ImportPhase }
  | { readonly type: 'session'; readonly session: ExplorerSessionView }
  | { readonly type: 'conversation'; readonly sessionId: string; readonly records: readonly ConversationRecord[]; readonly offset?: number; readonly total?: number; readonly nextOffset?: number }
  | { readonly type: 'event'; readonly eventId: string; readonly event: ExplorerEvent | undefined }
  | { readonly type: 'media'; readonly name: string; readonly bytes: ArrayBuffer | undefined }
  | { readonly type: 'attachment'; readonly path: string; readonly bytes: ArrayBuffer | undefined }
  | { readonly type: 'error'; readonly message: string }
