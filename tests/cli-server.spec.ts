import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
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

  it('serves nested scripts, workers, styles and images with their MIME types for GET and HEAD', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-static-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    await mkdir(join(directory, 'assets'))
    await writeFile(join(directory, 'index.html'), '<main>Explorer</main>')
    const assets = [
      ['assets/index.js', 'export const ready = true', 'text/javascript'],
      ['assets/session.worker.js', 'self.onmessage = () => {}', 'text/javascript'],
      ['assets/index.css', 'main { color: red }', 'text/css'],
      ['favicon.svg', '<svg />', 'image/svg+xml'],
    ] as const
    const explorer = await createExplorerServer({ directory })
    cleanups.push(() => explorer.close())
    for (const [path, body, mime] of assets) {
      await writeFile(join(directory, path), body)
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${explorer.url}${path}`, { method })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain(mime)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.text()).toBe(method === 'GET' ? body : '')
      }
    }
    expect((await fetch(`${explorer.url}assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${explorer.url}assets/missing`)).status).toBe(404)
    expect((await fetch(explorer.url, { method: 'POST' })).status).toBe(405)
  })

  it('rejects malformed escapes and traversal without crashing or reading outside the root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-boundary-'))
    cleanups.push(() => rm(parent, { recursive: true, force: true }))
    const directory = join(parent, 'dist')
    await mkdir(directory)
    await writeFile(join(parent, 'private.txt'), 'private')
    await writeFile(join(directory, 'index.html'), '<main>Explorer</main>')
    const explorer = await createExplorerServer({ directory })
    cleanups.push(() => explorer.close())
    expect((await fetch(`${explorer.url}%zz`)).status).toBe(400)
    expect((await fetch(`${explorer.url}..%2fprivate.txt`)).status).toBe(404)
    expect((await fetch(`${explorer.url}%00.js`)).status).toBe(400)
    expect(await fetch(explorer.url).then(response => response.text())).toBe('<main>Explorer</main>')
  })

  it('returns a proper 404 when the build is absent, including HEAD', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-no-build-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const explorer = await createExplorerServer({ directory })
    cleanups.push(() => explorer.close())
    for (const method of ['GET', 'HEAD']) expect((await fetch(explorer.url, { method })).status).toBe(404)
  })

  it.skipIf(process.platform === 'win32')('does not serve a symlink pointing outside the build', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-symlink-'))
    cleanups.push(() => rm(parent, { recursive: true, force: true }))
    const directory = join(parent, 'dist')
    await mkdir(directory)
    await writeFile(join(parent, 'private.txt'), 'private')
    await symlink(join(parent, 'private.txt'), join(directory, 'leak.txt'))
    const explorer = await createExplorerServer({ directory })
    cleanups.push(() => explorer.close())
    expect((await fetch(`${explorer.url}leak.txt`)).status).toBe(404)
  })
})

describe('static path containment', () => {
  it.each([
    [posix, '/tmp/dist'],
    [posix, '/'],
    [win32, 'C:\\work\\dist'],
    [win32, 'C:\\'],
    [win32, '\\\\server\\share\\dist'],
  ])('accepts descendants and rejects sibling traversal (case %#)', async (paths, directory) => {
    const { localFile } = await import('../scripts/serve.mjs')
    expect(localFile(directory, '/assets/index.js', paths)).toBe(paths.resolve(directory, 'assets/index.js'))
    expect(localFile(directory, '/assets/%E4%B8%AD%E6%96%87.js', paths)).toBe(paths.resolve(directory, 'assets/中文.js'))
    expect(localFile(directory, '/..visible.js', paths)).toBe(paths.resolve(directory, '..visible.js'))
    if (paths.dirname(directory) !== directory) {
      expect(localFile(directory, '/../dist-other/private.js', paths)).toBeNull()
      expect(localFile(directory, '/..%2fprivate.js', paths)).toBeNull()
      if (paths === win32) {
        expect(localFile(directory, '/..%5cprivate.js', paths)).toBeNull()
        expect(localFile(directory, '/D:%5cprivate.js', paths)).toBeNull()
      }
    }
  })
})
