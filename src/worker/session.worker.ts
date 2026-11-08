/// <reference lib="webworker" />

import { ExplorerSessionStore } from './session-store.ts'
import type { ExplorerWorkerRequest, ExplorerWorkerResponse } from './protocol.ts'

const store = new ExplorerSessionStore()
let searchGeneration = 0

function respond(message: ExplorerWorkerResponse): void {
  self.postMessage(message)
}

self.addEventListener('message', (message: MessageEvent<ExplorerWorkerRequest>) => {
  void (async () => {
    try {
      const request = message.data
      if (request.type === 'import' || request.type === 'import-files') {
        searchGeneration++
        respond({ type: 'progress', phase: 'reading' })
        const entries = request.type === 'import' ? request.entries.map(entry => ({ name: entry.name, path: entry.path, bytes: new Uint8Array(entry.bytes) }))
          : await Promise.all(request.entries.map(async entry => ({ name: entry.name, path: entry.path, bytes: new Uint8Array(await entry.file.arrayBuffer()) })))
        if (entries.length === 0) throw new Error('请选择至少一个会话文件')
        const first = entries[0]
        if (first === undefined) throw new Error('请选择至少一个会话文件')
        const progress = (phase: import('./protocol.ts').ImportPhase): void => { respond({ type: 'progress', phase }) }
        if (entries.length === 1 && first.name.endsWith('.zip')) await store.importArchive(first, progress)
        else if (entries.length === 1 && first.path === first.name) await store.importFile(first, progress)
        else await store.importDirectory(entries, progress)
        respond({ type: 'ready', view: store.initialView()! })
        return
      }
      if (request.type === 'search') {
        const generation = ++searchGeneration
        const page = await store.search(request.search, () => generation === searchGeneration)
        if (page !== undefined) respond({ type: 'search', requestId: request.requestId, page })
        return
      }
      if (request.type === 'conversation') {
        respond({ type: 'conversation', sessionId: request.sessionId, ...store.conversationPage(request.sessionId, request.offset) })
        return
      }
      if (request.type === 'session') {
        const session = store.sessionPage(request.sessionId, request.offset)
        if (session !== undefined) respond({ type: 'session', session })
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
      if (request.type === 'attachment') {
        const file = store.attachment(request.path)
        const bytes = file?.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer | undefined
        respond({ type: 'attachment', path: request.path, bytes })
        return
      }
      respond({ type: 'event', eventId: request.eventId, event: store.event(request.eventId), requestId: request.requestId,
        tool: store.tool(request.eventId), ...(request.reveal ? store.reveal(request.eventId) : {}) })
    } catch (error: unknown) {
      respond({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })()
})
