import { describe, expect, it } from 'vitest'
import { parseCliOptions } from '../scripts/cli.mjs'

describe('parseCliOptions', () => {
  it('accepts a local port and can suppress browser opening', () => {
    expect(parseCliOptions(['--port', '4179', '--no-open'])).toEqual({ openBrowser: false, port: 4179 })
  })

  it('rejects ports outside the valid TCP range', () => {
    expect(() => parseCliOptions(['--port', '70000'])).toThrow('Port must be an integer between 0 and 65535.')
  })
})
