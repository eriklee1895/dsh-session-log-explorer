import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseIntent, registryDecision, readRegistry, validatePack, release, runCommand } from '../.github/scripts/release.mjs'

const name = '@eriklee1895/dsh-session-log-explorer'
const pkg = { name, version: '0.1.3', repository: { url: 'git+https://github.com/eriklee1895/dsh-session-log-explorer.git' } }
const registry = (versions = ['0.1.2'], latest = '0.1.2') => ({
  name, 'dist-tags': { latest },
  versions: Object.fromEntries(versions.map(version => [version, { name, version }])),
})
const archive = Buffer.from('test package bytes')
const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
const required = [
  'package.json', 'README.md', 'README.zh.md', 'LICENSE', 'NOTICE.md',
  'bin/dsh-session-log-explorer.mjs', 'scripts/cli.mjs', 'scripts/serve.mjs',
  'dist/index.html', 'dist/favicon.svg', 'dist/assets/index-123.js',
  'dist/assets/session.worker-123.js', 'dist/assets/index-123.css',
]
const packed = (paths = required) => [{
  name, version: '0.1.3', filename: 'explorer-0.1.3.tgz', integrity,
  files: paths.map(path => ({ path, size: 100, mode: 0o100644 })),
}]

describe('stable release intent', () => {
  it('requires an explicit increase on main, including multi-commit pushes', () => {
    expect(releaseIntent('0.1.3', '0.1.2', 'refs/heads/main')).toEqual({ version: '0.1.3', tag: 'latest' })
    expect(releaseIntent('0.1.2', '0.1.2', 'refs/heads/main')).toHaveProperty('skip')
    expect(() => releaseIntent('0.1.1', '0.1.2', 'refs/heads/main')).toThrow(/increase/)
    expect(() => releaseIntent('0.1.3', undefined, 'refs/heads/main')).toThrow(/previous/)
  })

  it('accepts a matching stable tag and rejects a mismatched tag', () => {
    expect(releaseIntent('0.1.3', undefined, 'refs/tags/v0.1.3')).toEqual({ version: '0.1.3', tag: 'latest' })
    expect(() => releaseIntent('0.1.3', undefined, 'refs/tags/v0.1.4')).toThrow(/match/)
    expect(releaseIntent('0.1.3', '0.1.2', 'refs/heads/feature')).toHaveProperty('skip')
  })

  it.each(['0.1.3-rc.1', '0.1.3+build.1', '0.1.3-rc.1+build.1'])('does not send %s to latest', version => {
    expect(releaseIntent(version, '0.1.2', 'refs/heads/main')).toHaveProperty('skip')
    expect(releaseIntent(version, undefined, `refs/tags/v${version}`)).toHaveProperty('skip')
  })

  it('allows prerelease-to-stable graduation and compares numeric components', () => {
    expect(releaseIntent('0.1.3', '0.1.3-rc.2', 'refs/heads/main')).toHaveProperty('version', '0.1.3')
    expect(releaseIntent('0.1.10', '0.1.9', 'refs/heads/main')).toHaveProperty('version', '0.1.10')
  })

  it.each(['v0.1.3', '01.1.3', '0.1', '0.1.3-01', '0.1.3\n'])('rejects invalid version %j', version => {
    expect(() => releaseIntent(version, '0.1.2', 'refs/heads/main')).toThrow(/version/)
  })
})

describe('immutable versions and monotonic latest', () => {
  it('publishes a new stable version and never retags an existing version', () => {
    expect(registryDecision(registry(), '0.1.3')).toEqual({ publish: true })
    expect(registryDecision(registry(['0.1.2', '0.1.3']), '0.1.3')).toHaveProperty('skip')
  })

  it('blocks old jobs even if a newer published stable version is not latest', () => {
    expect(registryDecision(registry(['0.1.2', '0.1.4'], '0.1.4'), '0.1.3')).toHaveProperty('skip')
    expect(registryDecision(registry(['0.1.2', '0.1.4']), '0.1.3')).toHaveProperty('skip')
    expect(registryDecision(registry(['0.1.2', '0.2.0-rc.1']), '0.1.3')).toEqual({ publish: true })
    expect(registryDecision(registry(['0.1.9'], '0.1.9'), '0.1.10')).toEqual({ publish: true })
  })

  it.each([
    null, {}, { ...registry(), name: 'another-package' },
    { ...registry(), versions: [] }, { ...registry(), 'dist-tags': {} },
    registry(['0.1.2'], '0.1.4'), registry(['0.1.2-rc.1'], '0.1.2-rc.1'),
  ])('fails closed on incomplete or inconsistent registry metadata %#', metadata => {
    expect(() => registryDecision(metadata, '0.1.3')).toThrow(/registry/i)
  })
})

describe('bounded registry reads', () => {
  it('retries a transient read and uses the public registry without cached metadata', async () => {
    const requests: Array<[string, RequestInit]> = []
    const data = await readRegistry(name, {
      fetch: async (url: string, options: RequestInit) => {
        requests.push([url, options])
        if (requests.length === 1) throw new Error('connection reset')
        return new Response(JSON.stringify(registry()))
      }, wait: async () => {},
    })
    expect(data).toEqual(registry())
    expect(requests).toHaveLength(2)
    expect(requests[0][0]).toBe('https://registry.npmjs.org/%40eriklee1895%2Fdsh-session-log-explorer')
    expect(requests[0][1]).toMatchObject({ headers: { 'cache-control': 'no-cache' } })
    expect(requests[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([404, 429, 503, 'invalid-json', 'offline'])('fails closed after bounded retries for %s', async failure => {
    let reads = 0
    await expect(readRegistry(name, {
      fetch: async () => {
        reads += 1
        if (failure === 'offline') throw new Error('offline')
        if (failure === 'invalid-json') return new Response('{')
        return new Response('unavailable', { status: failure as number })
      }, wait: async () => {},
    })).rejects.toThrow(/registry/i)
    expect(reads).toBe(3)
  })
})

describe('packed artifact validation', () => {
  it('accepts the runtime artifact and returns its exact filename and integrity', () => {
    expect(validatePack(packed(), pkg)).toEqual({ filename: 'explorer-0.1.3.tgz', integrity })
  })

  it.each(['tests/fixtures/session.jsonl', '.env', '.git/config', '.agents/skills/key.md',
    'scripts/release.mjs', 'dist/private.jsonl', 'dist/.env', 'dist/assets/credentials.pem',
    'dist/assets/../session.js', 'dist/assets/node_modules/key.js', 'dist/assets/key.js.map',
    'dist\\assets\\key.js',
  ])('rejects unintended package file %s', path => {
    expect(() => validatePack(packed([...required, path]), pkg)).toThrow(/file/)
  })

  it.each(required)('rejects a package missing %s', path => {
    expect(() => validatePack(packed(required.filter(file => file !== path)), pkg)).toThrow(/missing/)
  })

  it('rejects malformed manifests, identities, paths and symbolic links', () => {
    for (const manifest of [[], [{ ...packed()[0], version: '0.1.2' }],
      [{ ...packed()[0], name: 'other' }], [{ ...packed()[0], filename: '../package.tgz' }],
      [{ ...packed()[0], integrity: 'sha512-bad' }],
      [{ ...packed()[0], files: [{ path: 'scripts/cli.mjs', mode: 0o120777 }] }],
    ]) expect(() => validatePack(manifest, pkg)).toThrow()
  })
})

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function scenario(options: {
  previous?: string; main?: string; mainAfterPack?: string; metadata?: unknown;
  finalMetadata?: unknown; recoveryMetadata?: unknown; queryError?: boolean; errorOnQuery?: number;
  publishError?: boolean; corrupt?: boolean;
  ref?: string; ancestor?: boolean;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'release-test-'))
  directories.push(directory)
  await writeFile(join(directory, 'explorer-0.1.3.tgz'), options.corrupt ? 'corrupted' : archive)
  const calls: string[][] = []
  let queries = 0
  let didPack = false
  const run = async (command: string, args: string[]) => {
    calls.push([command, ...args])
    if (command === 'git' && args[0] === 'show') return JSON.stringify({ version: args[1] === 'FETCH_HEAD:package.json'
      ? (didPack ? options.mainAfterPack : undefined) ?? options.main ?? '0.1.3' : options.previous ?? '0.1.2' })
    if (command === 'git' && args[0] === 'merge-base' && options.ancestor === false) throw new Error('not on main')
    if (command === 'npm' && args[0] === 'pack') { didPack = true; return JSON.stringify(packed()) }
    if (command === 'npm' && args[0] === 'publish' && options.publishError) throw new Error('upload disconnected')
    return ''
  }
  const query = async () => {
    queries += 1
    if (options.queryError || options.errorOnQuery === queries) throw new Error('registry unavailable')
    if (queries > 2 && options.recoveryMetadata) return options.recoveryMetadata
    return queries > 1 ? options.finalMetadata ?? options.metadata ?? registry() : options.metadata ?? registry()
  }
  const result = release({ pkg, ref: options.ref ?? 'refs/heads/main', before: 'a'.repeat(40),
    run, query, packDirectory: directory, log: () => {} })
  return { result, calls, queryCount: () => queries, directory }
}

describe('release transaction (no real uploads)', () => {
  it('builds, validates and publishes exactly the packed archive once with explicit latest/provenance/OIDC-compatible flags', async () => {
    const { result, calls, directory } = await scenario()
    await expect(result).resolves.toHaveProperty('published', '0.1.3')
    expect(calls).toContainEqual(['pnpm', 'run', 'build'])
    expect(calls.filter(call => call[0] === 'npm' && call[1] === 'publish')).toEqual([[
      'npm', 'publish', join(directory, 'explorer-0.1.3.tgz'), '--ignore-scripts',
      '--access', 'public', '--tag', 'latest', '--provenance', '--registry=https://registry.npmjs.org', '--fetch-retries=0',
    ]])
    expect(calls.filter(call => call[0] === 'npm' && call[1] === 'pack')).toHaveLength(1)
  })

  it('skips a documentation-only push without even querying npm', async () => {
    const { result, calls, queryCount } = await scenario({ previous: '0.1.3' })
    await expect(result).resolves.toHaveProperty('skip')
    expect(queryCount()).toBe(0)
    expect(calls.some(call => call[0] === 'npm')).toBe(false)
  })

  it.each([
    { metadata: registry(['0.1.2', '0.1.3']) }, { main: '0.1.4' },
    { mainAfterPack: '0.1.4' }, { finalMetadata: registry(['0.1.2', '0.1.4'], '0.1.4') },
  ])('does not upload an existing or superseded release %#', async options => {
    const { result, calls } = await scenario(options)
    await expect(result).resolves.toHaveProperty('skip')
    expect(calls.some(call => call[1] === 'publish')).toBe(false)
  })

  it.each([{ queryError: true }, { corrupt: true }, { ancestor: false, ref: 'refs/tags/v0.1.3' }])('blocks uploading when validation fails %#', async options => {
    const { result, calls } = await scenario(options)
    await expect(result).rejects.toThrow()
    expect(calls.some(call => call[1] === 'publish')).toBe(false)
  })

  it('does not blindly retry a failed upload whose result is still unconfirmed', async () => {
    const { result, calls } = await scenario({ publishError: true })
    await expect(result).rejects.toThrow(/unconfirmed/)
    expect(calls.filter(call => call[1] === 'publish')).toHaveLength(1)
  })

  it('recognizes an upload that succeeded before the connection broke by matching integrity', async () => {
    const metadata = registry(['0.1.2', '0.1.3'], '0.1.3')
    Object.assign(metadata.versions['0.1.3'], { dist: { integrity } })
    const { result, calls } = await scenario({ publishError: true, recoveryMetadata: metadata })
    await expect(result).resolves.toEqual({ published: '0.1.3', reconciled: true })
    expect(calls.filter(call => call[1] === 'publish')).toHaveLength(1)
  })

  it.each(['different-integrity', 'read-failed'])('leaves an uncertain upload for inspection when %s', async failure => {
    const metadata = registry(['0.1.2', '0.1.3'], '0.1.3')
    Object.assign(metadata.versions['0.1.3'], { dist: { integrity: 'sha512-other' } })
    const { result, calls } = await scenario({ publishError: true, recoveryMetadata: metadata,
      errorOnQuery: failure === 'read-failed' ? 3 : undefined })
    await expect(result).rejects.toThrow(/unconfirmed/)
    expect(calls.filter(call => call[1] === 'publish')).toHaveLength(1)
  })
})

it('preserves subprocess rejection diagnostics so OIDC failures can be diagnosed', async () => {
  const diagnostics: string[] = []
  await expect(runCommand(process.execPath, ['-e',
    'process.stderr.write("npm error EOIDC: workflow identity mismatch\\n"); process.exit(1)',
  ], (message: string) => { diagnostics.push(message) })).rejects.toThrow()
  expect(diagnostics.join('')).toContain('npm error EOIDC: workflow identity mismatch')
})
