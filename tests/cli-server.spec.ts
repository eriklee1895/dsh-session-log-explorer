import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExplorerServer } from '../scripts/serve.mjs'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('createExplorerServer', () => {
  it('serves assets and falls back to the explorer page on localhost only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-session-log-explorer-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    await writeFile(join(directory, 'index.html'), '<main>Explorer</main>')
    await writeFile(join(directory, 'app.js'), 'console.log("ready")')

    const explorer = await createExplorerServer({ directory, port: 0 })
    cleanups.push(() => explorer.close())

    expect(explorer.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    await expect(fetch(`${explorer.url}app.js`).then((response) => response.text())).resolves.toBe('console.log("ready")')
    await expect(fetch(`${explorer.url}turn/01`).then((response) => response.text())).resolves.toBe('<main>Explorer</main>')
  })
})
