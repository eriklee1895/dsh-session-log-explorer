import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, normalize, resolve } from 'node:path'

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

const contentTypeFor = (filename) => MIME_TYPES[extname(filename)] ?? 'application/octet-stream'

const localFile = (directory, pathname) => {
  const relativePath = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '')
  const filename = resolve(directory, relativePath)
  return filename.startsWith(`${directory}/`) || filename === directory ? filename : null
}

const fileIfPresent = async (filename) => {
  try {
    return (await stat(filename)).isFile() ? filename : null
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
  const index = `${root}/index.html`
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const candidate = localFile(root, pathname)
    const filename = candidate ? await fileIfPresent(candidate) : null
    const selected = filename ?? index

    try {
      response.writeHead(200, { 'Content-Type': contentTypeFor(selected), 'Cache-Control': 'no-store' })
      if (request.method === 'GET') response.end(await readFile(selected))
      else response.end()
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Explorer build files were not found. Reinstall the package.')
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
