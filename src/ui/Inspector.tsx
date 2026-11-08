import { useMemo, useState } from 'react'
import type { ExecutionTool } from '../model/projection.ts'
import { messageLabel, messageSource } from '../model/event-facts.ts'
import { recordOf, type ExplorerEvent } from '../worker/parser.ts'
import { StructuredJson } from './StructuredJson.tsx'

export function Inspector({ event, tool, onEventSelect }: {
  readonly event?: ExplorerEvent
  readonly tool?: ExecutionTool
  readonly onEventSelect: (eventId: string) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'details' | 'input' | 'output' | 'raw'>('details')
  const content = useMemo(() => {
    if (event === undefined) return ''
    const data = recordOf(event.data) ?? {}
    if (tab === 'raw') return event.rawRecord
    if (tab === 'input') return tool?.input ?? (typeof data.arguments === 'string' ? data.arguments : '此事件没有单独记录输入。')
    if (tab === 'output') {
      if (tool?.status === 'pending') return '尚未记录结果。'
      if (tool?.resultEventId !== undefined) return tool.output || '结果已返回，内容为空。'
      return event.type === 'tool/result' ? JSON.stringify(data.message, undefined, 2) ?? '结果字段未记录。' : '此事件没有单独记录输出。'
    }
    return JSON.stringify({ data: event.data, surfaceOp: event.surfaceOp, sourceEventSeqs: event.sourceEventSeqs, ignorable: event.ignorable }, undefined, 2)
  }, [event, tool, tab])
  if (event === undefined) return <aside className="inspector empty"><span className="inspector-glyph" aria-hidden="true">⌘</span><h2>事件详情</h2><p>选择执行记录或搜索结果，查看输入、输出与原始证据。</p><small>原始内容始终保留在本机。</small></aside>
  const data = recordOf(event.data)
  const source = messageSource(recordOf(data?.message) ?? event.data)
  return <aside className="inspector">
    <div className="inspector-heading"><h2>事件详情</h2><code>#{event.seq}</code></div>
    <dl>
      <div><dt>类型</dt><dd>{event.type}</dd></div>
      <div><dt>序号</dt><dd>{event.seq}</dd></div>
      <div><dt>时间</dt><dd>{new Date(event.time).toLocaleString('zh-CN', { hour12: false })}</dd></div>
      <div><dt>来源</dt><dd>{messageLabel(source)}{source === 'unknown' ? '' : ` · ${source}`}</dd></div>
    </dl>
    {tool !== undefined && <section className="tool-evidence" aria-label="工具调用与结果关联">
      <strong>{tool.name}</strong><span className={tool.failed ? 'error-badge' : 'evidence-status'}>{tool.status === 'pending' ? '尚无结果记录' : tool.status === 'orphan' ? '未附带调用事件' : tool.failed ? '工具返回错误' : '已记录结果'}</span>
      <div>{tool.callEventId !== undefined && <button aria-label={`查看调用原始事件 #${tool.callEventId.split(':').at(-1)}`} onClick={() => { onEventSelect(tool.callEventId!) }}>调用 #{tool.callEventId.split(':').at(-1)} ↗</button>}
        {tool.resultEventId !== undefined && <button aria-label={`查看结果原始事件 #${tool.resultEventId.split(':').at(-1)}`} onClick={() => { onEventSelect(tool.resultEventId!) }}>结果 #{tool.resultEventId.split(':').at(-1)} ↗</button>}</div>
    </section>}
    <div className="inspector-tabs">{(['details', 'input', 'output', 'raw'] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value) }}>{({ details: '详情', input: '输入', output: '输出', raw: '原始 JSON' })[value]}</button>)}</div>
    {tab === 'raw' && content.length <= 131_072 ? <pre>{content}</pre> : <StructuredJson className="inspector-json" value={content} empty="此事件未记录可显示内容。" />}
  </aside>
}
