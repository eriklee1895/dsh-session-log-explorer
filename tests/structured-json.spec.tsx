// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StructuredJson } from '../src/ui/StructuredJson.tsx'

describe('StructuredJson', () => {
  it('bounds oversized previews and offers the complete text as a local download', () => {
    const { container } = render(<StructuredJson value={JSON.stringify({ payload: 'x'.repeat(200_000) })} empty="none" />)
    expect(container.textContent!.length).toBeLessThan(35_000)
    expect(screen.getByRole('button', { name: '保存完整内容' })).toBeTruthy()
    expect(screen.getByText(/内容较大/)).toBeTruthy()
  })
  afterEach(() => { cleanup() })

  it('renders nested JSON as a DevTools-style inline tree', () => {
    render(<StructuredJson empty="empty" value={'{"arguments":"{\\"command\\":\\"pwd\\"}"}'} />)

    expect(screen.getByRole('tree', { name: 'JSON preview' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Collapse JSON' }).length).toBeGreaterThan(0)
    expect(screen.getByText('arguments:', { exact: true })).toBeTruthy()
    expect(screen.getByText('command:', { exact: true })).toBeTruthy()
    expect(screen.getByText('"pwd"', { exact: true })).toBeTruthy()
  })
})
