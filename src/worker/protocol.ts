import type { ConversationRecord } from '../model/projection.ts'
import type { ExplorerEvent } from './parser.ts'
import type { ExplorerImportView } from './session-store.ts'

export interface WorkerFileEntry {
  readonly name: string
  readonly path: string
  readonly bytes: ArrayBuffer
}

export type ExplorerWorkerRequest =
  | { readonly type: 'import'; readonly entries: readonly WorkerFileEntry[] }
  | { readonly type: 'conversation'; readonly sessionId: string }
  | { readonly type: 'event'; readonly eventId: string }
  | { readonly type: 'media'; readonly name: string }

export type ExplorerWorkerResponse =
  | { readonly type: 'ready'; readonly view: ExplorerImportView }
  | { readonly type: 'conversation'; readonly sessionId: string; readonly records: readonly ConversationRecord[] }
  | { readonly type: 'event'; readonly eventId: string; readonly event: ExplorerEvent | undefined }
  | { readonly type: 'media'; readonly name: string; readonly bytes: ArrayBuffer | undefined }
  | { readonly type: 'error'; readonly message: string }
