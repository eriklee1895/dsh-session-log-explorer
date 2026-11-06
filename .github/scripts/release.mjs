import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const repository = 'eriklee1895/dsh-session-log-explorer'
const packageName = '@eriklee1895/dsh-session-log-explorer'
const registryUrl = 'https://registry.npmjs.org'
const execute = promisify(execFile)
const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
const semver = new RegExp(`^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$`)

/** @param {string} command @param {string[]} args @param {(message: string) => void} diagnostic */
export async function runCommand(command, args, diagnostic = message => { process.stderr.write(message) }) {
  try {
    const result = await execute(command, args, { timeout: command === 'git' ? 30_000 : 180_000,
      maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    if (result.stderr) diagnostic(result.stderr)
    return result.stdout
  } catch (error) {
    // Preserve npm's normally redacted auth/provenance/HTTP errors. Never dump env.
    if (error.stdout) diagnostic(error.stdout)
    if (error.stderr) diagnostic(error.stderr)
    throw error
  }
}

function parseVersion(version) {
  const match = typeof version === 'string' && semver.exec(version)
  if (!match || match[0] !== version) throw new Error(`Invalid semantic version: ${version}`)
  return { numbers: match.slice(1, 4).map(BigInt), prerelease: match[4], build: match[5] }
}

function compareCore(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] > right.numbers[index] ? 1 : -1
  }
  return 0
}

export function releaseIntent(version, previousVersion, ref) {
  if (ref !== 'refs/heads/main' && !ref.startsWith('refs/tags/v')) return { skip: 'Not a release ref.' }
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`) throw new Error('Release tag must match package.json version.')
  const current = parseVersion(version)
  if (current.prerelease || current.build) return { skip: 'Only canonical stable X.Y.Z versions publish to latest.' }
  if (ref === 'refs/heads/main') {
    if (!previousVersion) throw new Error('Cannot establish the previous package version.')
    if (version === previousVersion) return { skip: 'No explicit version bump in this push.' }
    const previous = parseVersion(previousVersion)
    const comparison = compareCore(current, previous)
    if (comparison < 0 || (comparison === 0 && !previous.prerelease)) throw new Error('The stable version must increase.')
  }
  return { version, tag: 'latest' }
}

/** @param {any} metadata @param {string} version */
export function registryDecision(metadata, version) {
  if (metadata?.name !== packageName || !metadata.versions || Array.isArray(metadata.versions)
    || typeof metadata.versions !== 'object') throw new Error('Invalid registry package metadata.')
  const latest = metadata['dist-tags']?.latest
  let latestVersion
  try { latestVersion = parseVersion(latest) } catch { throw new Error('Registry latest is missing or invalid.') }
  if (latestVersion.prerelease || latestVersion.build || metadata.versions[latest]?.version !== latest) {
    throw new Error('Registry latest is not a consistent stable version.')
  }
  if (Object.hasOwn(metadata.versions, version)) return { skip: `Version ${version} already exists; never republish or retag it.` }
  const candidate = parseVersion(version)
  for (const published of Object.keys(metadata.versions)) {
    let parsed
    try { parsed = parseVersion(published) } catch { throw new Error('Registry contains an invalid version.') }
    if (!parsed.prerelease && !parsed.build && compareCore(parsed, candidate) >= 0) {
      return { skip: `Newer stable version ${published} exists; latest must not go backwards.` }
    }
  }
  return { publish: true }
}

async function retryRead(operation, pause = wait) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation() } catch (error) {
      if (attempt === 2) throw error
      await pause(500 * (attempt + 1))
    }
  }
}

/** @param {string} name
 * @param {{fetch?: (url: string, options: RequestInit) => Promise<Response>, wait?: (delay: number) => Promise<void>}} options
 */
export async function readRegistry(name, options = {}) {
  try {
    return await retryRead(async () => {
      const response = await (options.fetch ?? fetch)(`${registryUrl}/${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
      })
      // A 404 is a failed lookup, not proof that an immutable version is unused.
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }, options.wait)
  } catch (error) {
    throw new Error(`Registry lookup failed after three reads: ${error.message}`, { cause: error })
  }
}

/** @param {any} manifest @param {{name: string, version: string}} pkg */
export function validatePack(manifest, pkg) {
  if (!Array.isArray(manifest) || manifest.length !== 1) throw new Error('Expected one packed artifact.')
  const pack = manifest[0]
  if (pack.name !== pkg.name || pack.version !== pkg.version) throw new Error('Packed package identity mismatch.')
  if (typeof pack.filename !== 'string' || basename(pack.filename) !== pack.filename
    || !/^[a-zA-Z0-9._-]+\.tgz$/.test(pack.filename)) throw new Error('Invalid packed filename.')
  if (typeof pack.integrity !== 'string' || !/^sha512-[a-zA-Z0-9+/]+={0,2}$/.test(pack.integrity)
    || Buffer.from(pack.integrity.slice(7), 'base64').length !== 64) throw new Error('Invalid packed integrity.')
  if (!Array.isArray(pack.files)) throw new Error('Packed file list missing.')
  const required = [
    'package.json', 'README.md', 'README.zh.md', 'LICENSE', 'NOTICE.md',
    'bin/dsh-session-log-explorer.mjs', 'scripts/cli.mjs', 'scripts/serve.mjs',
    'dist/index.html', 'dist/favicon.svg',
  ]
  const paths = new Set()
  for (const file of pack.files) {
    const path = file.path
    const segments = typeof path === 'string' ? path.split('/') : []
    const asset = /^dist\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path)
    if (!segments.length || segments.some(segment => segment.startsWith('.') || segment === 'node_modules')
      || path.includes('\\') || (!required.includes(path) && !asset)
      || (file.mode & 0o170000) === 0o120000 || paths.has(path)) throw new Error(`Unintended or duplicate packed file: ${path}`)
    paths.add(path)
  }
  for (const path of required) if (!paths.has(path)) throw new Error(`Packed file missing: ${path}`)
  for (const pattern of [/^dist\/assets\/index-[\w-]+\.js$/, /^dist\/assets\/.*worker[\w.-]*\.js$/, /^dist\/assets\/index-[\w-]+\.css$/]) {
    if (![...paths].some(path => pattern.test(path))) throw new Error(`Packed runtime asset missing: ${pattern}`)
  }
  return { filename: pack.filename, integrity: pack.integrity }
}

/** @param {{pkg: {name: string, version: string, repository: {url: string}}, ref: string, before?: string,
 * run: (command: string, args: string[]) => Promise<string>, query: () => Promise<any>,
 * packDirectory: string, log?: (message: string) => void}} options
 */
export async function release({ pkg, ref, before, run, query, packDirectory, log = console.log }) {
  if (pkg.name !== packageName || pkg.repository?.url !== `git+https://github.com/${repository}.git`) {
    throw new Error('Release package/repository identity mismatch.')
  }
  let previousVersion
  if (ref === 'refs/heads/main') {
    if (!/^[a-f0-9]{40}$/.test(before ?? '') || /^0+$/.test(before)) throw new Error('Missing previous commit for main push.')
    previousVersion = JSON.parse(await run('git', ['show', `${before}:package.json`])).version
  }
  const intent = releaseIntent(pkg.version, previousVersion, ref)
  if (intent.skip) { log(intent.skip); return intent }

  const guard = async () => {
    await retryRead(() => run('git', ['fetch', '--no-tags', 'origin', 'main']))
    await run('git', ['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'])
    const currentMain = JSON.parse(await run('git', ['show', 'FETCH_HEAD:package.json']))
    if (currentMain.version !== pkg.version) return { skip: `Main now targets ${currentMain.version}; this release is superseded.` }
    return registryDecision(await query(), pkg.version)
  }
  const initial = await guard()
  if (initial.skip) { log(initial.skip); return initial }
  await run('pnpm', ['run', 'build'])
  const manifest = JSON.parse(await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory,
    `--registry=${registryUrl}`]))
  const artifact = validatePack(manifest, pkg)
  const tarball = join(packDirectory, artifact.filename)
  const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`
  if (integrity !== artifact.integrity) throw new Error('Packed tarball integrity mismatch.')
  // Stay inside the workflow's publish concurrency lock for both guards and upload.
  const final = await guard()
  if (final.skip) { log(final.skip); return final }
  try {
    // Exactly one mutation. Do not repack, invoke lifecycle scripts, or retag later.
    const output = await run('npm', ['publish', tarball, '--ignore-scripts', '--access', 'public',
      '--tag', 'latest', '--provenance', `--registry=${registryUrl}`, '--fetch-retries=0'])
    log(output)
    return { published: pkg.version }
  } catch (error) {
    let metadata
    try { metadata = await query() } catch { /* Outcome remains unconfirmed. */ }
    if (metadata?.name === packageName && metadata.versions?.[pkg.version]?.dist?.integrity === integrity) {
      log(`Registry confirms ${pkg.version} with the exact packed integrity; no upload retry or dist-tag change.`)
      return { published: pkg.version, reconciled: true }
    }
    throw new Error('Publish outcome unconfirmed. Inspect npm and this run before rerunning; no upload retry was attempted.', { cause: error })
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'push'
    || process.env.GITHUB_REPOSITORY !== repository) throw new Error('Publishing is only allowed in the repository push workflow.')
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
  if (event.deleted) { console.log('Deleted ref: nothing to release.'); return }
  if (event.forced) throw new Error('Forced pushes must not publish automatically.')
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const packDirectory = await mkdtemp(join(tmpdir(), 'dsh-release-'))
  try {
    const result = await release({ pkg, ref: process.env.GITHUB_REF, before: event.before, packDirectory,
      run: runCommand, query: () => readRegistry(packageName),
    })
    console.log(JSON.stringify(result))
  } finally { await rm(packDirectory, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
