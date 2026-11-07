import { useEffect, useRef, useState } from 'react'
import type { SessionSearchPage, SessionSearchRequest } from '../worker/search.ts'
import { messageLabel } from '../model/event-facts.ts'
import './SessionSearch.css'

export function SessionSearch({ sessionId, page, busy, disabled, errorFocus, onSearch, onReveal }: {
  readonly sessionId: string
  readonly page?: SessionSearchPage
  readonly busy: boolean
  readonly disabled: boolean
  readonly errorFocus: number
  readonly onSearch: (request: SessionSearchRequest) => void
  readonly onReveal: (eventId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('current')
  const [eventType, setEventType] = useState('')
  const [source, setSource] = useState('')
  const [tool, setTool] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const search = useRef(onSearch)
  search.current = onSearch
  const scopeId = scope === 'current' ? sessionId : undefined
  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (!disabled && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(true); input.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey) }
  }, [disabled])
  useEffect(() => { if (open && !disabled) input.current?.focus() }, [open, disabled])
  useEffect(() => {
    if (errorFocus === 0) return
    setOpen(true); setErrorsOnly(true); setQuery(''); setScope('current'); setOffset(0)
    setEventType(''); setSource(''); setTool('')
  }, [errorFocus])
  useEffect(() => {
    if (!open || disabled) return
    const timer = setTimeout(() => { search.current({ query, sessionId: scopeId, eventType, source, tool, errorsOnly, offset }) }, 180)
    return () => { clearTimeout(timer) }
  }, [open, disabled, query, scopeId, eventType, source, tool, errorsOnly, offset])
  const options = (values: readonly string[] | undefined, selected: string): string[] => [...new Set([selected, ...values ?? []].filter(Boolean))]
  return <section className={`session-search${open ? ' open' : ''}`} aria-label="完整会话搜索">
    <button className="search-launch" aria-expanded={open} disabled={disabled} onClick={() => { setOpen(value => !value) }}>
      <span aria-hidden="true">⌕</span><strong>搜索完整会话</strong><small>消息 · 工具 · 错误</small><kbd>⌘ / Ctrl K</kbd>
    </button>
    {open && <div className="search-panel" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}>
      <div className="search-query"><input ref={input} type="search" aria-label="搜索完整事件文本" maxLength={500} disabled={disabled}
        placeholder="搜索完整消息、工具参数与输出…" value={query} onChange={event => { setQuery(event.currentTarget.value); setOffset(0) }} />
        <select aria-label="搜索范围" value={scope} disabled={disabled} onChange={event => { setScope(event.currentTarget.value); setOffset(0) }}>
          <option value="current">当前会话</option><option value="all">所有已导入会话</option>
        </select>
      </div>
      <div className="search-filters">
        <select aria-label="事件类型" value={eventType} disabled={disabled} onChange={event => { setEventType(event.currentTarget.value); setOffset(0) }}>
          <option value="">全部事件类型</option>{options(page?.facets.eventTypes, eventType).map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label="消息来源" value={source} disabled={disabled} onChange={event => { setSource(event.currentTarget.value); setOffset(0) }}>
          <option value="">全部消息来源</option>{options(page?.facets.sources, source).map(value => <option value={value} key={value}>{messageLabel(value)}</option>)}
        </select>
        <select aria-label="工具名称" value={tool} disabled={disabled} onChange={event => { setTool(event.currentTarget.value); setOffset(0) }}>
          <option value="">全部工具</option>{options(page?.facets.tools, tool).map(value => <option key={value}>{value}</option>)}
        </select>
        <label><input type="checkbox" checked={errorsOnly} disabled={disabled} onChange={event => { setErrorsOnly(event.currentTarget.checked); setOffset(0) }} />仅错误事件</label>
      </div>
      <div className="search-status" role="status" aria-live="polite">{busy ? '正在搜索完整事件…' : page === undefined ? '输入关键词或选择筛选。' : `${page.total.toLocaleString('zh-CN')} 个匹配事件`}</div>
      {!busy && page !== undefined && page.total > 0 && <>
        <ol className="search-results">{page.results.map(hit => <li key={hit.eventId}>
          <button aria-label={`定位 ${hit.eventType} #${hit.seq}`} disabled={disabled} onClick={() => { onReveal(hit.eventId) }}>
            <span className="search-result-meta"><b className={hit.isError ? 'error-badge' : ''}>{hit.tool ?? hit.eventType}</b><span>{messageLabel(hit.source)}</span><code>{hit.sessionId.slice(0, 10)} · #{hit.seq}</code></span>
            <span className="search-excerpt">{hit.excerpt}</span>
          </button>
        </li>)}</ol>
        <nav className="record-pagination" aria-label="搜索结果分页">
          <button disabled={disabled || page.offset === 0} onClick={() => { setOffset(page.previousOffset) }}>上一组</button>
          <span>{page.offset + 1}–{page.nextOffset} / {page.total}</span>
          <button disabled={disabled || page.nextOffset >= page.total} onClick={() => { setOffset(page.nextOffset) }}>下一组</button>
        </nav>
      </>}
      {!busy && page?.total === 0 && <p className="search-empty">没有匹配的事件。搜索覆盖完整事件，不受当前执行页或摘要长度限制。</p>}
      <p className="search-note">结果按会话及原始序号列出。定位将打开对应执行页和原始事件；所有搜索均在本机完成。</p>
    </div>}
  </section>
}
