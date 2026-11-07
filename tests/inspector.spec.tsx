// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Inspector } from '../src/ui/Inspector.tsx'
import type { ExplorerEvent } from '../src/worker/parser.ts'

const call: ExplorerEvent = { type: 'tool/call', seq: 1, time: 1, storageLine: 1, rawRecord: '{"seq":1}',
  data: { turn: 1, step: 1, name: 'shell', arguments: '{"cmd":"recorded only"}' } }
afterEach(() => { cleanup() })
it('shows the linked result when inspecting its call and preserves both raw navigation targets', () => {
  const select = vi.fn()
  render(<Inspector event={call} tool={{ eventId: 'root:1', callEventId: 'root:1', resultEventId: 'root:2',
    name: 'shell', input: '{"cmd":"recorded only"}', output: 'actual recorded output', failed: false, status: 'returned' }} onEventSelect={select} />)
  fireEvent.click(screen.getByRole('button', { name: '输出' }))
  expect(screen.getByText('actual recorded output')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '查看结果原始事件 #2' }))
  expect(select).toHaveBeenLastCalledWith('root:2')
  fireEvent.click(screen.getByRole('button', { name: '查看调用原始事件 #1' }))
  expect(select).toHaveBeenLastCalledWith('root:1')
  fireEvent.click(screen.getByRole('button', { name: '原始 JSON' }))
  expect(screen.getByText('{"seq":1}')).toBeTruthy()
})

it.each([
  { status: 'pending' as const, resultEventId: undefined, text: '尚未记录结果。' },
  { status: 'returned' as const, resultEventId: 'root:2', text: '结果已返回，内容为空。' },
])('distinguishes $status from an empty result', ({ status, resultEventId, text }) => {
  render(<Inspector event={call} tool={{ eventId: 'root:1', callEventId: 'root:1', resultEventId, name: 'shell', input: '{}', output: '', failed: false, status }} onEventSelect={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '输出' }))
  expect(screen.getByText(text)).toBeTruthy()
})
