import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationRecord } from './model/projection.ts'
import { ExplorerWorkspace } from './ui/ExplorerWorkspace.tsx'
import { StructuredJson } from './ui/StructuredJson.tsx'
import type { ExplorerWorkerRequest, ExplorerWorkerResponse, WorkerFileEntry } from './worker/protocol.ts'
import type { ExplorerEvent } from './worker/parser.ts'
import type { ExplorerImportView, ExplorerSessionView } from './worker/session-store.ts'
import './App.css'

function formatTime(time: number): string {
  return new Date(time).toLocaleString('zh-CN', { hour12: false })
}

const INSPECTOR_MIN_WIDTH = 280
const INSPECTOR_MAX_WIDTH = 960

function clampInspectorWidth(width: number): number {
  return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, width))
}

function sessionDepth(session: ExplorerSessionView, sessions: readonly ExplorerSessionView[]): number {
  let depth = 0
  let parent = session.parentSessionId
  while (parent !== undefined) {
    depth++
    parent = sessions.find(value => value.id === parent)?.parentSessionId
  }
  return depth
}

function UploadGlyph(): React.JSX.Element {
  return <svg aria-hidden="true" className="dropzone-glyph" fill="none" viewBox="0 0 32 32">
    <path d="M8 3h11l5 5v18a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" />
    <path d="M19 3v6h6M16 23V13m0 0-4 4m4-4 4 4" />
  </svg>
}

function Inspector({ event }: { readonly event: ExplorerEvent | undefined }): React.JSX.Element {
  const [tab, setTab] = useState<'details' | 'input' | 'output' | 'raw'>('details')
  if (event === undefined) return <aside className="inspector empty"><h2>事件详情</h2><p>从时间线或对话中选择一个事件。</p></aside>
  const toolInput = typeof event.data.arguments === 'string' ? event.data.arguments : undefined
  const toolOutput = event.type === 'tool/result' ? JSON.stringify(event.data.message, undefined, 2) : undefined
  const content = tab === 'details' ? JSON.stringify(event.data, undefined, 2)
    : tab === 'input' ? toolInput ?? '此事件没有单独记录输入。'
      : tab === 'output' ? toolOutput ?? '此事件没有单独记录输出。'
        : event.rawRecord
  return <aside className="inspector">
    <h2>事件详情</h2>
    <dl>
      <div><dt>类型</dt><dd>{event.type}</dd></div>
      <div><dt>序号</dt><dd>{event.seq}</dd></div>
      <div><dt>时间</dt><dd>{formatTime(event.time)}</dd></div>
    </dl>
    <div className="inspector-tabs"><button aria-pressed={tab === 'details'} onClick={() => { setTab('details') }}>详情</button><button aria-pressed={tab === 'input'} onClick={() => { setTab('input') }}>输入</button><button aria-pressed={tab === 'output'} onClick={() => { setTab('output') }}>输出</button><button aria-pressed={tab === 'raw'} onClick={() => { setTab('raw') }}>原始 JSON</button></div>
    {tab === 'raw' ? <pre>{content}</pre> : <StructuredJson className="inspector-json" value={content} empty="此事件未记录可显示内容。" />}
  </aside>
}

/** Standalone browser shell for reviewing locally selected DSH session artifacts. */
export function App(): React.JSX.Element {
  const worker = useRef<Worker | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const directoryInput = useRef<HTMLInputElement | null>(null)
  const [view, setView] = useState<ExplorerImportView>()
  const [sessionId, setSessionId] = useState<string>()
  const [conversation, setConversation] = useState<readonly ConversationRecord[]>([])
  const [event, setEvent] = useState<ExplorerEvent>()
  const [selectedEventId, setSelectedEventId] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [isDragging, setDragging] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(400)
  const [mediaUrls, setMediaUrls] = useState<ReadonlyMap<string, string>>(new Map())
  const mediaUrlsRef = useRef<ReadonlyMap<string, string>>(new Map())

  const post = (message: ExplorerWorkerRequest, transfer: Transferable[] = []): void => { worker.current?.postMessage(message, transfer) }
  useEffect(() => {
    const instance = new Worker(new URL('./worker/session.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = ({ data }: MessageEvent<ExplorerWorkerResponse>) => {
      if (data.type === 'error') { setLoading(false); setError(data.message); return }
      if (data.type === 'ready') {
        for (const url of mediaUrlsRef.current.values()) URL.revokeObjectURL(url)
        mediaUrlsRef.current = new Map()
        setMediaUrls(mediaUrlsRef.current)
        setLoading(false); setError(undefined); setView(data.view); setSessionId(data.view.rootSessionId); post({ type: 'conversation', sessionId: data.view.rootSessionId })
        for (const name of data.view.mediaNames) post({ type: 'media', name })
        return
      }
      if (data.type === 'conversation') { setConversation(data.records); return }
      if (data.type === 'event') { setSelectedEventId(data.eventId); setEvent(data.event) }
      if (data.type === 'media' && data.bytes !== undefined) {
        const next = new Map(mediaUrlsRef.current)
        next.set(data.name, URL.createObjectURL(new Blob([data.bytes])))
        mediaUrlsRef.current = next
        setMediaUrls(next)
      }
    }
    return () => { instance.terminate(); for (const url of mediaUrlsRef.current.values()) URL.revokeObjectURL(url); worker.current = null }
  }, [])

  const selected = useMemo(() => view?.sessions.find(session => session.id === sessionId), [view, sessionId])
  const missingMediaNames = view?.missingMediaNames ?? []
  const selectSession = (id: string): void => { setSessionId(id); setEvent(undefined); setSelectedEventId(undefined); post({ type: 'conversation', sessionId: id }) }
  const selectEvent = (eventId: string): void => { setSelectedEventId(eventId); post({ type: 'event', eventId }) }
  const openFilePicker = (): void => { fileInput.current?.click() }
  const setInspectorWidthFromPointer = (clientX: number): void => { setInspectorWidth(clampInspectorWidth(window.innerWidth - clientX)) }
  const beginInspectorResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setInspectorWidthFromPointer(event.clientX)
    const move = (pointer: PointerEvent): void => { setInspectorWidthFromPointer(pointer.clientX) }
    const end = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  const resizeInspectorWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setInspectorWidth(width => clampInspectorWidth(width + (event.key === 'ArrowLeft' ? 24 : -24)))
  }
  const handleDropzoneKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFilePicker() }
  }
  const importFiles = async (files: readonly File[]): Promise<void> => {
    setLoading(true); setError(undefined); setEvent(undefined); setSelectedEventId(undefined)
    const entries = await Promise.all(files.map(async (file): Promise<WorkerFileEntry> => ({
      name: file.name,
      path: file.webkitRelativePath || file.name,
      bytes: await file.arrayBuffer(),
    })))
    post({ type: 'import', entries }, entries.map(entry => entry.bytes))
  }

  return <main className="app-shell">
    <header className="app-header import-header"><strong><img aria-hidden="true" className="brand-mark" src="/favicon.svg" />DSH Session Log Explorer</strong><span>Offline DeepSeek Harness Session Viewer</span></header>
    <input ref={fileInput} className="visually-hidden" type="file" accept=".jsonl,.zstd,.zip" multiple onChange={(event) => { void importFiles([...event.currentTarget.files ?? []]) }} />
    <input ref={(node) => { directoryInput.current = node; node?.setAttribute('webkitdirectory', '') }} className="visually-hidden" type="file" multiple onChange={(event) => { void importFiles([...event.currentTarget.files ?? []]) }} />
    {view === undefined ? <section className="import-panel" aria-label="本地会话拖放区">
      <div className="import-kicker"><span>IMPORT SESSION</span></div>
      <h1>导入 DSH 会话日志</h1><p>将会话文件拖入下方区域。解析在浏览器 Worker 内完成，不会上传任何内容。</p>
      <div aria-busy={loading} aria-label="导入会话文件" className={`file-dropzone${isDragging ? ' is-dragging' : ''}`} onClick={openFilePicker} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => { event.preventDefault() }} onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }} onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles([...event.dataTransfer.files]) }} onKeyDown={handleDropzoneKeyDown} role="button" tabIndex={0}><UploadGlyph /><div><strong>拖放会话文件</strong><span>或从本机选择文件</span></div><small>JSONL · JSONL.ZSTD · DSH ZIP</small><span className="file-dropzone-action">{loading ? '正在解析…' : '选择文件'}</span></div>
      <button className="directory-import" onClick={() => { directoryInput.current?.click() }}>选择会话目录</button>
      <dl className="import-specs"><div><dt>支持格式</dt><dd>JSONL · ZSTD · ZIP</dd></div><div><dt>会话目录</dt><dd>从目录入口选择</dd></div><div><dt>格式版本</dt><dd>DSH SESSION V0</dd></div></dl>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
    </section> : <section className="explorer-layout" style={{ '--inspector-width': `${String(inspectorWidth)}px` } as CSSProperties}>
      <aside className="session-tree"><h2><span>SESSION TREE</span><small>{view.sessions.length} NODES</small></h2>{view.sessions.map(session => <button className={session.id === selected?.id ? 'selected' : ''} key={session.id} onClick={() => { selectSession(session.id) }} style={{ paddingInlineStart: `${String(12 + sessionDepth(session, view.sessions) * 18)}px` }}><strong>{session.id === view.rootSessionId ? 'ROOT SESSION' : 'SUBAGENT'}</strong><span>{session.summary.turns} turns · {session.summary.toolCalls} tools</span></button>)}<p>{view.mediaNames.length} LOCAL MEDIA ATTACHMENTS</p><button className="replace-session" onClick={openFilePicker}>REPLACE SESSION</button></aside>
      <section className="content">{selected !== undefined && <ExplorerWorkspace session={selected} conversation={conversation} selectedEventId={selectedEventId} onEventSelect={selectEvent} />}</section>
      <div aria-label="Resize inspector" aria-orientation="vertical" aria-valuemax={INSPECTOR_MAX_WIDTH} aria-valuemin={INSPECTOR_MIN_WIDTH} aria-valuenow={inspectorWidth} className="inspector-resize" onKeyDown={resizeInspectorWithKeyboard} onPointerDown={beginInspectorResize} role="separator" tabIndex={0} />
      <aside className="inspector-rail"><Inspector event={event} />
        {(mediaUrls.size > 0 || missingMediaNames.length > 0) && <section className="media-panel">
          <h2>LOCAL MEDIA</h2>
          {[...mediaUrls].map(([name, url]) => <figure key={name}><img src={url} alt={name} /><figcaption>{name}</figcaption></figure>)}
          {missingMediaNames.map(name => <p className="missing-media" key={name}>缺少媒体：{name}</p>)}
        </section>}
      </aside>
    </section>}
  </main>
}
