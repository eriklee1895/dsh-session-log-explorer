// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

// jsdom does not calculate layout; the browser check covers actual geometry.
// This guards the grid sizing rule that keeps multi-line session buttons intact.
it('sizes session tree rows to their content when the sidebar must scroll', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/App.css', 'utf8')
  document.head.append(style)
  const sidebar = document.createElement('aside')
  sidebar.className = 'session-tree'
  document.body.append(sidebar)

  expect(getComputedStyle(sidebar).gridAutoRows).toBe('max-content')
})

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren() })
