import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createExplorerServer } from './serve.mjs'

const cliDirectory = dirname(fileURLToPath(import.meta.url))

export const parseCliOptions = (argumentsList) => {
  const options = { openBrowser: true, port: 0 }

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--no-open') options.openBrowser = false
    else if (argument === '--port') {
      const port = Number(argumentsList[index + 1])
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error('Port must be an integer between 0 and 65535.')
      }
      options.port = port
      index += 1
    } else if (argument !== '--help' && argument !== '-h') {
      throw new Error(`Unknown option: ${argument}`)
    }
  }

  return options
}

const openBrowser = (url) => {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' })
  child.unref()
}

const usage = `DSH Session Log Explorer\n\nUsage:\n  npx @eriklee1895/dsh-session-log-explorer [options]\n\nOptions:\n  --port <number>  Use a specific local port (default: an available port)\n  --no-open        Do not open a browser automatically\n  -h, --help       Show this help message\n`

export const runCli = async (argumentsList = process.argv.slice(2)) => {
  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    process.stdout.write(usage)
    return
  }

  const options = parseCliOptions(argumentsList)
  const directory = resolve(cliDirectory, '../dist')
  const explorer = await createExplorerServer({ directory, port: options.port })
  process.stdout.write(`DSH Session Log Explorer is running at ${explorer.url}\nPress Ctrl+C to stop.\n`)
  if (options.openBrowser) openBrowser(explorer.url)

  const shutdown = async () => {
    await explorer.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
