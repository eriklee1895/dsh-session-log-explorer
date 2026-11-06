import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSessionLoader } from './useSessionLoader.ts'
import { ExplorerWorkspace } from './ui/ExplorerWorkspace.tsx'
import { StructuredJson } from './ui/StructuredJson.tsx'
import { recordOf, type ExplorerEvent } from './worker/parser.ts'
import type { ExplorerSessionView } from './worker/session-store.ts'
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
  const data = recordOf(event.data) ?? {}
  const toolInput = typeof data.arguments === 'string' ? data.arguments : undefined
  const toolOutput = event.type === 'tool/result' ? JSON.stringify(data.message, undefined, 2) : undefined
  const content = tab === 'details' ? JSON.stringify({ data: event.data, surfaceOp: event.surfaceOp, sourceEventSeqs: event.sourceEventSeqs, ignorable: event.ignorable }, undefined, 2)
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
  const fileInput = useRef<HTMLInputElement | null>(null)
  const directoryInput = useRef<HTMLInputElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const cancelButton = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const { view, revision, sessionId, conversation, conversationPage, event, selectedEventId, error, notice, loading, viewLoading,
    mediaUrls, importFiles, cancelImport, selectSession, selectEvent, requestPage, requestConversation, post } = useSessionLoader()
  const [isDragging, setDragging] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(400)
  const isLoading = loading !== undefined
  useLayoutEffect(() => {
    content.current?.toggleAttribute('inert', isLoading)
    if (isLoading) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      cancelButton.current?.focus()
    } else if (previousFocus.current !== null) {
      const target = previousFocus.current.isConnected && previousFocus.current !== document.body ? previousFocus.current
        : content.current?.querySelector<HTMLElement>('.session-tree button.selected, .file-dropzone')
      target?.focus(); previousFocus.current = null
    }
  }, [isLoading])
  const selected = useMemo(() => view?.sessions.find(session => session.id === sessionId), [view, sessionId])
  const missingMediaNames = view?.missingMediaNames ?? []
  const openFilePicker = (): void => { if (!isLoading) fileInput.current?.click() }
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

  return <main className="app-shell">
    <div ref={content}>
    <header className="app-header import-header"><strong><img aria-hidden="true" className="brand-mark" src="/favicon.svg" />DSH Session Log Explorer</strong><span>Offline DeepSeek Harness Session Viewer</span></header>
    <input ref={fileInput} className="visually-hidden" type="file" accept=".jsonl,.zstd,.zip" multiple disabled={isLoading} onChange={(event) => { const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; importFiles(files) }} />
    <input ref={(node) => { directoryInput.current = node; node?.setAttribute('webkitdirectory', '') }} className="visually-hidden" type="file" multiple disabled={isLoading} onChange={(event) => { const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; importFiles(files) }} />
    {view === undefined ? <section className="import-panel" aria-label="本地会话拖放区">
      <div className="import-kicker"><span>IMPORT SESSION</span></div>
      <h1>导入 DSH 会话日志</h1><p>将会话文件拖入下方区域。解析在浏览器 Worker 内完成，不会上传任何内容。</p>
      <div aria-busy={isLoading} aria-disabled={isLoading} aria-label="导入会话文件" className={`file-dropzone${isDragging ? ' is-dragging' : ''}`} onClick={openFilePicker} onDragEnter={(event) => { event.preventDefault(); if (!isLoading) setDragging(true) }} onDragOver={(event) => { event.preventDefault() }} onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }} onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles([...event.dataTransfer.files]) }} onKeyDown={handleDropzoneKeyDown} role="button" tabIndex={0}><UploadGlyph /><div><strong>拖放会话文件</strong><span>或从本机选择文件</span></div><small>JSONL · JSONL.ZSTD · DSH ZIP</small><span className="file-dropzone-action">{isLoading ? '正在加载…' : '选择文件'}</span></div>
      <button className="directory-import" disabled={isLoading} onClick={() => { directoryInput.current?.click() }}>选择会话目录</button>
      <dl className="import-specs"><div><dt>支持格式</dt><dd>JSONL · ZSTD · ZIP</dd></div><div><dt>会话目录</dt><dd>从目录入口选择</dd></div><div><dt>格式版本</dt><dd>DSH SESSION V0–V4</dd></div></dl>
    </section> : <section className="explorer-layout" style={{ '--inspector-width': `${String(inspectorWidth)}px` } as CSSProperties}>
      <aside className="session-tree"><h2><span>SESSION TREE</span><small>{view.sessions.length} NODES</small></h2>{view.sessions.map(session => <button className={session.id === selected?.id ? 'selected' : ''} key={session.id} onClick={() => { selectSession(session.id) }} style={{ paddingInlineStart: `${String(12 + sessionDepth(session, view.sessions) * 18)}px` }}><strong>{session.id === view.rootSessionId ? 'ROOT SESSION' : 'SUBAGENT'}</strong><span>{session.summary.turns} turns · {session.summary.toolCalls} tools</span></button>)}<p>{view.mediaNames.length} LOCAL MEDIA ATTACHMENTS</p><button className="replace-session" disabled={isLoading} onClick={openFilePicker}>REPLACE SESSION</button></aside>
      <section className="content">{selected !== undefined && <ExplorerWorkspace key={`${revision}:${selected.id}`} loading={viewLoading} onPageChange={requestPage} conversationPage={conversationPage} onConversationPageChange={requestConversation} session={selected} conversation={conversation} selectedEventId={selectedEventId} onEventSelect={selectEvent} />}</section>
      <div aria-label="Resize inspector" aria-orientation="vertical" aria-valuemax={INSPECTOR_MAX_WIDTH} aria-valuemin={INSPECTOR_MIN_WIDTH} aria-valuenow={inspectorWidth} className="inspector-resize" onKeyDown={resizeInspectorWithKeyboard} onPointerDown={beginInspectorResize} role="separator" tabIndex={0} />
      <aside className="inspector-rail"><Inspector event={event} />
        {(view.attachmentNames?.length ?? 0) > 0 && <section className="media-panel">
          <h2>LOCAL FILES</h2>
          {view.attachmentNames?.map(path => <button key={path} onClick={() => { post({ type: 'attachment', path }) }}>{path.split('/').at(-1)}</button>)}
        </section>}
        {(mediaUrls.size > 0 || missingMediaNames.length > 0) && <section className="media-panel">
          <h2>LOCAL MEDIA</h2>
          {[...mediaUrls].map(([name, url]) => <figure key={name}><img src={url} alt={name} /><figcaption>{name}</figcaption></figure>)}
          {missingMediaNames.map(name => <p className="missing-media" key={name}>缺少媒体：{name}</p>)}
        </section>}
      </aside>
    </section>}
    {error !== undefined && <p className="error import-feedback" role="alert">{error}</p>}
    {notice !== undefined && <p className="import-feedback" role="status">{notice}</p>}
    </div>
    {loading !== undefined && <section className="session-loading-backdrop" role="dialog" aria-modal="true" aria-labelledby="session-loading-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); cancelImport() }
      if (event.key === 'Tab') { event.preventDefault(); cancelButton.current?.focus() }
    }}>
      <div className="session-loading-card">
        <span className="session-loading-spinner" aria-hidden="true" />
        <div role="status" aria-live="polite" aria-atomic="true">
          <h2 id="session-loading-title">{loading.replacing ? '正在替换会话' : '正在加载会话'}</h2>
          <p>{{ reading: '正在读取文件…', extracting: '正在解压文件…', parsing: '正在解析会话…', projecting: '正在整理执行记录…', rendering: '正在准备会话视图…' }[loading.phase]}</p>
        </div>
        <p className="session-loading-note">大文件可能需要一些时间。所有内容始终留在本机。</p>
        <button ref={cancelButton} onClick={cancelImport}>取消加载</button>
      </div>
    </section>}
  </main>
}
