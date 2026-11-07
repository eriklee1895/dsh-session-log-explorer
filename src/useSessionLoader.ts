import { startTransition, useEffect, useRef, useState } from 'react'
import type { ConversationRecord, ExecutionTool } from './model/projection.ts'
import type { SessionSearchPage, SessionSearchRequest } from './worker/search.ts'
import type { ExplorerEvent } from './worker/parser.ts'
import type { ExplorerWorkerRequest, ExplorerWorkerResponse, ImportPhase } from './worker/protocol.ts'
import type { ExplorerImportView } from './worker/session-store.ts'

interface PendingImport { readonly worker: Worker; readonly replacing: boolean; view?: ExplorerImportView }

/** Stage each import in its own Worker so cancellation and failure preserve the current session. */
export function useSessionLoader() {
  const worker = useRef<Worker | null>(null)
  const pending = useRef<PendingImport | null>(null)
  const selected = useRef<string>()
  const currentView = useRef<ExplorerImportView>()
  const media = useRef<ReadonlyMap<string, string>>(new Map())
  const searchRequestId = useRef(0)
  const searchScopeSession = useRef<string>()
  const eventRequestId = useRef(0)
  const [view, setView] = useState<ExplorerImportView>()
  const [revision, setRevision] = useState(0)
  const [sessionId, setSessionId] = useState<string>()
  const [conversation, setConversation] = useState<readonly ConversationRecord[]>([])
  const [conversationPage, setConversationPage] = useState({ offset: 0, total: 0, previousOffset: 0, nextOffset: 0 })
  const [event, setEvent] = useState<ExplorerEvent>()
  const [eventTool, setEventTool] = useState<ExecutionTool>()
  const [searchResults, setSearchResults] = useState<SessionSearchPage>()
  const [searchBusy, setSearchBusy] = useState(false)
  const [navigationRevision, setNavigationRevision] = useState(0)
  const [selectedEventId, setSelectedEventId] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [loading, setLoading] = useState<{ readonly phase: ImportPhase; readonly replacing: boolean }>()
  const [viewLoading, setViewLoading] = useState(false)
  const [mediaUrls, setMediaUrls] = useState<ReadonlyMap<string, string>>(new Map())

  const post = (message: ExplorerWorkerRequest): void => { worker.current?.postMessage(message) }
  const clearMedia = (): void => {
    for (const url of media.current.values()) URL.revokeObjectURL(url)
    media.current = new Map()
    setMediaUrls(media.current)
  }
  const fail = (instance: Worker, message: string): void => {
    if (pending.current?.worker === instance) {
      instance.terminate()
      pending.current = null
      setLoading(undefined)
    } else if (worker.current !== instance) return
    setViewLoading(false)
    setSearchBusy(false)
    setError(message)
  }
  const connect = (instance: Worker): Worker => {
    instance.onerror = event => { event.preventDefault(); fail(instance, event.message || '无法加载会话，请重试。') }
    instance.onmessage = ({ data }: MessageEvent<ExplorerWorkerResponse>) => {
      const task = pending.current
      if (instance !== worker.current && task?.worker !== instance) return
      if (task !== null && instance !== task.worker) return
      if (data.type === 'error') { fail(instance, data.message); return }
      if (data.type === 'progress') {
        if (task?.worker === instance) setLoading({ phase: data.phase, replacing: task.replacing })
        return
      }
      if (data.type === 'ready') {
        if (task !== null && task.worker !== instance) return
        if (task !== null) {
          task.view = data.view
          setLoading({ phase: 'rendering', replacing: task.replacing })
        }
        startTransition(() => {
          setView(previous => task === null || pending.current === task ? data.view : previous)
          setSessionId(previous => task === null || pending.current === task ? data.view.rootSessionId : previous)
          setRevision(previous => task !== null && pending.current === task ? previous + 1 : previous)
        })
        return
      }
      if (instance !== worker.current) return
      if (data.type === 'search') {
        if (data.requestId !== searchRequestId.current) return
        setSearchResults(data.page); setSearchBusy(false)
        return
      }
      if (data.type === 'session') {
        if (data.session.id !== selected.current) return
        setView(previous => previous === undefined ? previous : { ...previous,
          sessions: previous.sessions.map(session => session.id === data.session.id ? data.session : session) })
        setViewLoading(false)
      }
      if (data.type === 'conversation' && data.sessionId === selected.current) {
        setConversation(data.records)
        setConversationPage({ offset: data.offset, total: data.total, previousOffset: data.previousOffset, nextOffset: data.nextOffset })
        setViewLoading(false)
      }
      if (data.type === 'event') {
        if (data.requestId !== undefined && data.requestId !== eventRequestId.current) return
        if (data.session !== undefined && data.sessionId !== undefined) {
          if (searchScopeSession.current !== undefined && searchScopeSession.current !== data.sessionId) {
            searchRequestId.current++; setSearchResults(undefined); setSearchBusy(false)
          }
          selected.current = data.sessionId; setSessionId(data.sessionId)
          setView(previous => previous === undefined ? previous : { ...previous,
            sessions: previous.sessions.map(session => session.id === data.session!.id ? data.session! : session) })
          setConversation([]); setConversationPage({ offset: 0, total: 0, previousOffset: 0, nextOffset: 0 })
          setNavigationRevision(value => value + 1)
          setViewLoading(false)
        }
        setSelectedEventId(data.eventId); setEvent(data.event); setEventTool(data.tool)
      }
      if (data.type === 'attachment' && data.bytes !== undefined) {
        const url = URL.createObjectURL(new Blob([data.bytes], { type: 'application/octet-stream' }))
        const link = document.createElement('a')
        link.href = url; link.download = data.path.split('/').at(-1) ?? 'attachment'; link.click()
        setTimeout(() => { URL.revokeObjectURL(url) }, 1_000)
      }
      if (data.type === 'media' && data.bytes !== undefined) {
        const next = new Map(media.current)
        next.set(data.name, URL.createObjectURL(new Blob([data.bytes])))
        media.current = next; setMediaUrls(next)
      }
    }
    return instance
  }

  useEffect(() => {
    return () => {
      pending.current?.worker.terminate(); pending.current = null
      worker.current?.terminate(); worker.current = null
      for (const url of media.current.values()) URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    currentView.current = view
    const task = pending.current
    if (view === undefined || (task !== null && task.view !== view)) return
    if (task !== null) {
      worker.current?.terminate(); worker.current = task.worker; pending.current = null
      clearMedia(); setConversation([]); setConversationPage({ offset: 0, total: 0, previousOffset: 0, nextOffset: 0 })
      setEvent(undefined); setSelectedEventId(undefined); setError(undefined); setLoading(undefined)
      setEventTool(undefined); setSearchResults(undefined); setSearchBusy(false)
      selected.current = view.rootSessionId
      for (const name of view.mediaNames) post({ type: 'media', name })
    } else if (selected.current === undefined) selected.current = view.rootSessionId
  }, [view])

  const importFiles = (files: readonly File[]): void => {
    if (pending.current !== null || files.length === 0) return
    setError(undefined); setNotice(undefined)
    let instance: Worker
    try { instance = connect(new Worker(new URL('./worker/session.worker.ts', import.meta.url), { type: 'module' })) }
    catch (error) { setError(error instanceof Error ? error.message : '无法加载会话，请重试。'); return }
    const task = { worker: instance, replacing: currentView.current !== undefined }
    pending.current = task
    searchRequestId.current++; eventRequestId.current++
    setSearchResults(undefined); setSearchBusy(false)
    setViewLoading(false)
    setLoading({ phase: 'reading', replacing: task.replacing })
    try { instance.postMessage({ type: 'import-files', entries: files.map(file => ({ name: file.name, path: file.webkitRelativePath || file.name, file })) } satisfies ExplorerWorkerRequest) }
    catch (error) { fail(instance, error instanceof Error ? error.message : '无法读取文件，请重试。') }
  }
  const cancelImport = (): void => {
    if (pending.current === null) return
    const replacing = pending.current.replacing
    pending.current.worker.terminate(); pending.current = null
    setLoading(undefined); setNotice(replacing ? '已取消加载，原会话已保留。' : '已取消加载，可以重新选择文件。')
  }
  const selectSession = (id: string): void => {
    eventRequestId.current++
    if (searchScopeSession.current !== undefined) { searchRequestId.current++; setSearchResults(undefined); setSearchBusy(false) }
    selected.current = id; setSessionId(id); setEvent(undefined); setSelectedEventId(undefined)
    setEventTool(undefined)
    setConversation([]); setViewLoading(true); post({ type: 'session', sessionId: id, offset: 0 })
  }
  const requestPage = (offset: number): void => {
    if (selected.current === undefined || viewLoading) return
    setViewLoading(true); post({ type: 'session', sessionId: selected.current, offset })
  }
  const requestConversation = (offset = 0): void => {
    if (selected.current === undefined) return
    setViewLoading(true); post({ type: 'conversation', sessionId: selected.current, offset })
  }
  const selectEvent = (eventId: string, reveal = false): void => { post({ type: 'event', eventId, requestId: ++eventRequestId.current, reveal }) }
  const revealEvent = (eventId: string): void => { selectEvent(eventId, true) }
  const runSearch = (search: SessionSearchRequest): void => {
    if (worker.current === null || pending.current !== null) return
    setSearchResults(undefined); setSearchBusy(true)
    searchScopeSession.current = search.sessionId
    post({ type: 'search', requestId: ++searchRequestId.current, search })
  }

  return { view, revision, sessionId, conversation, conversationPage, event, selectedEventId, error, notice, loading, viewLoading,
    mediaUrls, importFiles, cancelImport, selectSession, selectEvent, requestPage, requestConversation, post,
    eventTool, searchResults, searchBusy, runSearch, revealEvent, navigationRevision }
}
