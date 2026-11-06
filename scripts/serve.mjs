import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import path, { extname, join, resolve } from 'node:path'

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const contentTypeFor = (filename) => MIME_TYPES[extname(filename)] ?? 'application/octet-stream'

/** Resolve a URL path only when it stays inside the static root on the selected platform. */
export const localFile = (directory, pathname, paths = path) => {
  const relativePath = decodeURIComponent(pathname).replace(/^[/\\]+/, '')
  if (relativePath.includes('\0')) throw new URIError('Invalid path')
  const filename = paths.resolve(directory, relativePath)
  const fromRoot = paths.relative(directory, filename)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${paths.sep}`) && !paths.isAbsolute(fromRoot) ? filename : null
}

const fileIfPresent = async (filename, root) => {
  try {
    const actual = await realpath(filename)
    const relative = path.relative(await realpath(root), actual)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
    return (await stat(actual)).isFile() ? actual : null
  } catch {
    return null
  }
}

/**
 * Serve a built DSH Session Log Explorer from the loopback interface only.
 *
 * @param {{ directory: string, port?: number }} options
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export const createExplorerServer = async ({ directory, port = 0 }) => {
  const root = resolve(directory)
  const index = join(root, 'index.html')
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    let pathname
    let candidate
    try {
      pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      candidate = localFile(root, pathname)
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : 'Invalid request path.')
      return
    }
    const filename = candidate ? await fileIfPresent(candidate, root) : null
    const decoded = decodeURIComponent(pathname)
    const isAsset = decoded.startsWith('/assets/') || extname(decoded) !== ''
    const selected = filename ?? (candidate && !isAsset ? await fileIfPresent(index, root) : null)

    try {
      if (selected === null) throw new Error('File not found')
      const body = request.method === 'GET' ? await readFile(selected) : undefined
      response.writeHead(200, { 'Content-Type': contentTypeFor(selected), 'Cache-Control': 'no-store' })
      response.end(body)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : 'Explorer build files were not found. Reinstall the package.')
    }
  })

  await new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer)
    server.listen(port, '127.0.0.1', resolveServer)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The explorer server did not report a local port.')
  const url = `http://127.0.0.1:${address.port}/`

  return {
    url,
    close: () => new Promise((resolveServer, rejectServer) => server.close((error) => (error ? rejectServer(error) : resolveServer()))),
  }
}
