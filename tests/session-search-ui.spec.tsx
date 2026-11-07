// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionSearch } from '../src/ui/SessionSearch.tsx'

afterEach(() => { cleanup(); vi.useRealTimers() })
it('searches beyond the current page with explicit scope and renders snippets as text', () => {
  vi.useFakeTimers()
  const search = vi.fn(), reveal = vi.fn()
  render(<SessionSearch sessionId="root" busy={false} disabled={false} errorFocus={0} onSearch={search} onReveal={reveal}
    page={{ total: 1, offset: 0, previousOffset: 0, nextOffset: 1, facets: { tools: [], sources: [], eventTypes: [] },
      results: [{ sessionId: 'child', eventId: 'child:50', seq: 50, eventType: 'assistant/message', time: 1, source: 'model', isError: false, excerpt: '<script>needle</script>' }] }} />)
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  const input = screen.getByRole('searchbox', { name: '搜索完整事件文本' })
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'needle' } })
  fireEvent.change(screen.getByLabelText('搜索范围'), { target: { value: 'all' } })
  act(() => { vi.advanceTimersByTime(200) })
  expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'needle', sessionId: undefined }))
  expect(screen.getByText('<script>needle</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '定位 assistant/message #50' }))
  expect(reveal).toHaveBeenCalledWith('child:50')
})

it('opens an error-only search from the overview action', () => {
  vi.useFakeTimers()
  const search = vi.fn()
  const props = { sessionId: 'root', busy: false, disabled: false, errorFocus: 0, onSearch: search, onReveal: () => {} }
  const { rerender } = render(<SessionSearch {...props} />)
  rerender(<SessionSearch {...props} errorFocus={1} />)
  act(() => { vi.advanceTimersByTime(200) })
  expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: '', sessionId: 'root', errorsOnly: true }))
  expect((screen.getByLabelText('仅错误事件') as HTMLInputElement).checked).toBe(true)
})
