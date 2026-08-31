/// <reference lib="webworker" />

import { ExplorerSessionStore } from './session-store.ts'
import type { ExplorerWorkerRequest, ExplorerWorkerResponse } from './protocol.ts'

const store = new ExplorerSessionStore()

function respond(message: ExplorerWorkerResponse): void {
  self.postMessage(message)
}

self.addEventListener('message', (message: MessageEvent<ExplorerWorkerRequest>) => {
  void (async () => {
    try {
      const request = message.data
      if (request.type === 'import') {
        const entries = request.entries.map(entry => ({ name: entry.name, path: entry.path, bytes: new Uint8Array(entry.bytes) }))
        if (entries.length === 0) throw new Error('请选择至少一个会话文件')
        const first = entries[0]
        if (first === undefined) throw new Error('请选择至少一个会话文件')
        const view = entries.length === 1 && first.name.endsWith('.zip')
          ? await store.importArchive(first)
          : entries.length === 1 && first.path === first.name
            ? await store.importFile(first)
            : await store.importDirectory(entries)
        respond({ type: 'ready', view })
        return
      }
      if (request.type === 'conversation') {
        respond({ type: 'conversation', sessionId: request.sessionId, records: store.conversation(request.sessionId) ?? [] })
        return
      }
      if (request.type === 'media') {
        const media = store.media(request.name)
        const bytes = media === undefined
          ? undefined
          : media.buffer.slice(media.byteOffset, media.byteOffset + media.byteLength) as ArrayBuffer
        respond({ type: 'media', name: request.name, bytes })
        return
      }
      respond({ type: 'event', eventId: request.eventId, event: store.event(request.eventId) })
    } catch (error: unknown) {
      respond({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })()
})
