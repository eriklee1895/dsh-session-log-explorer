import { recordOf, type ExplorerEvent } from '../worker/parser.ts'

/** Preserve producer attribution; user-role messages are not necessarily human input. */
export function messageSource(data: unknown): string {
  const source = recordOf(data)?.source
  const kind = typeof source === 'string' ? source : recordOf(source)?.kind
  return kind === 'human' ? 'user' : typeof kind === 'string' ? kind : 'unknown'
}

export function messageLabel(source: string): string {
  const labels: Readonly<Record<string, string>> = {
    user: '用户输入', 'runtime-context': '运行时上下文', 'agent-message': 'Agent 消息',
    'team-message': '团队消息', 'subagent-settled': '子代理通知', goal: '目标续轮',
    compaction: '压缩摘要', unknown: '来源未记录', model: '模型', tool: '工具', 'system-prompt': '系统提示词',
  }
  return Object.hasOwn(labels, source) ? labels[source]! : `消息 · ${source}`
}

export function turnOutcomeLabel(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    completed: '已完成', aborted: '已取消', blocked: '已阻止', error: '出错',
    'max-tokens': 'Token 上限', interrupted: '中断后补记', forked: '分叉边界',
  }
  return Object.hasOwn(labels, kind) ? labels[kind]! : kind
}

export function toolResultIdentity(data: unknown): { callId: unknown; failed: boolean } {
  const result = recordOf(data) ?? {}
  const message = recordOf(result.message)
  const legacy = Array.isArray(message?.content) ? message.content.map(recordOf).find(block => block?.type === 'tool-result') : undefined
  return { callId: message?.toolCallId ?? legacy?.toolCallId,
    failed: message?.isError === true || legacy?.isError === true || result.error !== undefined }
}

export function isErrorEvent(event: ExplorerEvent): boolean {
  const data = recordOf(event.data)
  return event.type === 'agent/error' || event.type.endsWith('/error')
    || (event.type === 'tool/result' && toolResultIdentity(data).failed)
    || (event.type === 'turn/end' && recordOf(data?.reason)?.kind === 'error')
    || ((event.type === 'tool/ptc-dispatch' || event.type === 'tool/code-dispatch') && data?.isError === true)
}
