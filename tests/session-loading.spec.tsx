// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import type { ExplorerImportView } from '../src/worker/session-store.ts'

class WorkerStub {
  static instances: WorkerStub[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { WorkerStub.instances.push(this) }
  respond(data: unknown): void { act(() => { this.onmessage?.({ data } as MessageEvent) }) }
}

const view = (id = 'root', eventCount = 1): ExplorerImportView => ({
  rootSessionId: id, sessions: [{ id, sourcePath: 'session.v4.jsonl', eventCount,
    summary: { turns: 1, steps: 1, toolCalls: 0, toolResults: 0, errors: 0, durationMs: 0, tokens: {} },
    execution: [], timeline: [], promptEpochs: [] }], mediaNames: [], missingMediaNames: [],
})
const sample = (): File => {
  const file = new File(['{}'], 'session.zip')
  Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(async () => new ArrayBuffer(2)) })
  return file
}
const start = (container: HTMLElement, file = sample()): WorkerStub => {
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
  return WorkerStub.instances.at(-1)!
}
const mount = () => {
  WorkerStub.instances = []
  vi.stubGlobal('Worker', WorkerStub)
  return render(<App />)
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('session loading', () => {
  it('shows an accessible loading dialog, sends Files to the worker and rejects duplicate imports', () => {
    const { container } = mount()
    const file = sample()
    const pending = start(container, file)
    expect(screen.getByRole('dialog', { name: '正在加载会话' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('正在读取文件')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消加载' }))
    expect(screen.getByRole('button', { name: '取消加载' }).closest('main')?.querySelector('[inert]')).toBeTruthy()
    start(container, file)
    expect(pending.postMessage).toHaveBeenCalledTimes(1)
    expect(pending.postMessage.mock.calls[0]?.[0]).toMatchObject({ type: 'import-files', entries: [{ file }] })
    expect(file.arrayBuffer).not.toHaveBeenCalled()
  })

  it('updates real phases, completes and allows loading the same file again', async () => {
    const { container } = mount()
    const file = sample()
    const pending = start(container, file)
    pending.respond({ type: 'progress', phase: 'parsing' })
    expect(screen.getByRole('status').textContent).toContain('正在解析会话')
    pending.respond({ type: 'ready', view: view() })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(screen.getByText('ROOT SESSION')).toBeTruthy()
    expect((container.querySelector('input[type=file]') as HTMLInputElement).value).toBe('')
    const replacement = start(container, file)
    expect(replacement).not.toBe(pending)
    expect(screen.getByRole('dialog', { name: '正在替换会话' })).toBeTruthy()
  })

  it('keeps the existing session on replacement failure and can retry successfully', async () => {
    const { container } = mount()
    start(container).respond({ type: 'ready', view: view('old', 7) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const replacement = start(container)
    expect((container.querySelector('.replace-session') as HTMLButtonElement).disabled).toBe(true)
    replacement.respond({ type: 'error', message: 'cannot read ZIP' })
    expect(screen.getByRole('alert').textContent).toContain('cannot read ZIP')
    expect(container.querySelector('.workspace-readout')?.textContent).toContain('7 条事件')
    const retry = start(container)
    retry.respond({ type: 'ready', view: view('new', 9) })
    await waitFor(() => { expect(container.querySelector('.workspace-readout')?.textContent).toContain('9 条事件') })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels the pending worker, ignores stale responses and preserves the previous worker', async () => {
    const { container } = mount()
    const original = start(container)
    original.respond({ type: 'ready', view: view('old', 7) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    const replacement = start(container)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(replacement.terminate).toHaveBeenCalledOnce()
    expect(original.terminate).not.toHaveBeenCalled()
    replacement.respond({ type: 'ready', view: view('stale', 99) })
    expect(container.querySelector('.workspace-readout')?.textContent).toContain('7 条事件')
    expect(screen.getByRole('status').textContent).toContain('已取消加载')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((container.querySelector('.replace-session') as HTMLButtonElement).disabled).toBe(false)
    start(container).respond({ type: 'ready', view: view('retry', 11) })
    await waitFor(() => { expect(container.querySelector('.workspace-readout')?.textContent).toContain('11 条事件') })
  })

  it('clears a worker crash and can retry, while an empty picker result starts no import', () => {
    const { container } = mount()
    const count = WorkerStub.instances.length
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [] } })
    expect(WorkerStub.instances).toHaveLength(count)
    expect(screen.queryByRole('dialog')).toBeNull()
    const pending = start(container)
    act(() => { pending.onerror?.(new ErrorEvent('error', { message: 'worker crashed' })) })
    expect(screen.getByRole('alert').textContent).toContain('worker crashed')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(start(container)).not.toBe(pending)
  })

  it('resets a successful same-session replacement and ignores old-worker responses during loading', async () => {
    const { container } = mount()
    const original = start(container)
    original.respond({ type: 'ready', view: view('same', 7) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: '对话' }))
    const replacement = start(container)
    original.respond({ type: 'session', session: view('same', 77).sessions[0] })
    expect(container.querySelector('.workspace-readout')?.textContent).toContain('7 条事件')
    replacement.respond({ type: 'ready', view: view('same', 9) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(container.querySelector('.workspace-readout')?.textContent).toContain('9 条事件')
    expect(screen.getByRole('button', { name: '执行' }).getAttribute('aria-pressed')).toBe('true')
  })
})
