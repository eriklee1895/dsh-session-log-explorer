// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'

class WorkerStub {
  static latest: WorkerStub | undefined
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor() { WorkerStub.latest = this }
  postMessage(): void {}
  terminate(): void {}
}

describe('import panel', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('presents one large labeled drop region with a file-picker fallback', () => {
    vi.stubGlobal('Worker', WorkerStub)
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click')
    const { container } = render(<App />)

    const dropRegion = screen.getByRole('region', { name: '本地会话拖放区' })
    const fileDropzone = screen.getByRole('button', { name: '导入会话文件' })
    expect(dropRegion).toBeTruthy()
    expect(screen.getByText('DSH Session Log Explorer')).toBeTruthy()
    expect(container.querySelector('img.brand-mark[src="/favicon.svg"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '导入 DSH 会话日志' })).toBeTruthy()
    expect(screen.getByText('选择文件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择会话目录' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '导入会话' })).toBeNull()
    expect(fileDropzone.className).toContain('file-dropzone')

    fireEvent.click(fileDropzone)
    expect(inputClick).toHaveBeenCalledOnce()

    fireEvent.keyDown(fileDropzone, { key: 'Enter' })
    expect(inputClick).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '选择会话目录' }))
    expect(inputClick).toHaveBeenCalledTimes(3)

    fireEvent.dragEnter(fileDropzone)
    expect(dropRegion.className).not.toContain('is-dragging')
    expect(fileDropzone.className).toContain('is-dragging')
  })

  it('renders inspector inputs as structured JSON and exposes a resize separator', () => {
    vi.stubGlobal('Worker', WorkerStub)
    render(<App />)
    const worker = WorkerStub.latest
    if (worker === undefined) throw new Error('worker was not created')
    const session = {
      id: 'root', sourcePath: 'session.jsonl', eventCount: 1,
      summary: { turns: 1, steps: 1, toolCalls: 1, toolResults: 0, errors: 0, durationMs: 0, tokens: {} },
      timeline: [], execution: [],
    }
    act(() => { worker.onmessage?.({ data: { type: 'ready', view: { rootSessionId: 'root', sessions: [session], mediaNames: [], missingMediaNames: [] } } } as MessageEvent) })
    act(() => { worker.onmessage?.({ data: { type: 'event', eventId: 'root:0', event: {
      type: 'tool/call', seq: 0, time: 0, data: { name: 'bash', arguments: '{"command":"pwd"}' }, storageLine: 2, rawRecord: '{}',
    } } } as MessageEvent) })

    fireEvent.click(screen.getByRole('button', { name: '输入' }))
    expect(screen.getByText('{', { exact: true })).toBeTruthy()
    expect(screen.getByRole('separator', { name: 'Resize inspector' }).getAttribute('aria-valuemax')).toBe('960')
  })
})
