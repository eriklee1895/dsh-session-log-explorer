import { strFromU8, unzipSync } from 'fflate'
import { decompress } from 'fzstd'
import { parseSessionJsonl, recordOf, type ParsedSessionJsonl } from './parser.ts'

export interface DshArchiveInput {
  readonly name: string
  readonly bytes: Uint8Array
}

export interface DshDirectoryEntry extends DshArchiveInput {
  readonly path: string
}

export interface ImportedSession extends ParsedSessionJsonl {
  readonly parentSessionId?: string
  readonly sourcePath: string
}

export interface ImportedDshArchive {
  readonly rootSessionId: string
  readonly sessions: readonly ImportedSession[]
  readonly media: ReadonlyMap<string, Uint8Array>
  readonly files?: ReadonlyMap<string, Uint8Array>
}

async function decompressZstd(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('zstd' as unknown as CompressionFormat))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
      // Browsers that expose DecompressionStream may still lack the zstd format.
    }
  }
  try {
    return decompress(bytes)
  } catch (error: unknown) {
    throw new Error(`cannot decompress Zstandard session artifact: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Parse one standalone plaintext or Zstandard-compressed DSH session artifact. */
export async function importDshFile(input: DshArchiveInput): Promise<ParsedSessionJsonl> {
  if (input.name.endsWith('.jsonl')) return parseSessionJsonl(strFromU8(input.bytes))
  if (input.name.endsWith('.jsonl.zstd')) return parseSessionJsonl(strFromU8(await decompressZstd(input.bytes)))
  throw new Error(`unsupported session artifact ${JSON.stringify(input.name)}`)
}

function generation(path: string): number | undefined {
  const match = /^session(?:\.v([1-9][0-9]*))?\.jsonl(?:\.zstd)?$/.exec(path.split('/').at(-1) ?? '')
  if (match === null) return undefined
  const version = Number(match[1] ?? 0)
  if (!Number.isSafeInteger(version)) throw new Error('session generation is too large')
  return version
}

function normalizedEntries(entries: readonly DshDirectoryEntry[]): readonly DshDirectoryEntry[] {
  const seen = new Set<string>()
  const normalized = entries.map(entry => {
    const path = entry.path.replaceAll('\\', '/')
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('unsafe archive entry path')
    }
    if (seen.has(path)) throw new Error(`duplicate entry path ${JSON.stringify(path)}`)
    seen.add(path)
    return { ...entry, path }
  })
  const roots = normalized.filter(entry => generation(entry.path) !== undefined && !entry.path.split('/').includes('subagents'))
  const depth = Math.min(...roots.map(entry => entry.path.split('/').length))
  const prefixes = new Set(roots.filter(entry => entry.path.split('/').length === depth).map(entry => entry.path.slice(0, entry.path.lastIndexOf('/') + 1)))
  if (prefixes.size > 1) throw new Error('source contains multiple root session directories')
  const prefix = [...prefixes][0] ?? ''
  return normalized.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }))
}

function sessionPaths(entries: readonly DshDirectoryEntry[]): readonly string[] {
  const selected = new Map<string, string>()
  for (const entry of entries) {
    const version = generation(entry.path)
    const folder = entry.path.slice(0, entry.path.lastIndexOf('/') + 1)
    if (version === undefined || (folder !== '' && !/^subagents\/[^/]+\/$/.test(folder))) continue
    const previous = selected.get(folder)
    if (previous === undefined || version > generation(previous)!
      || (version === generation(previous) && previous.endsWith('.zstd') && !entry.path.endsWith('.zstd'))) selected.set(folder, entry.path)
  }
  const root = selected.get('')
  if (root === undefined) throw new Error('ZIP does not contain session.jsonl or a versioned session log')
  return [root, ...[...selected.entries()].filter(([folder]) => folder !== '').map(([, path]) => path).sort()]
}

async function importEntries(input: readonly DshDirectoryEntry[]): Promise<ImportedDshArchive> {
  const entries = normalizedEntries(input)
  const byPath = new Map(entries.map(entry => [entry.path, entry] as const))
  const sessions: ImportedSession[] = []
  const ids = new Set<string>()
  for (const sourcePath of sessionPaths(entries)) {
    const source = byPath.get(sourcePath)
    if (source === undefined) throw new Error(`session artifact ${JSON.stringify(sourcePath)} is missing`)
    let parsed: ParsedSessionJsonl
    try {
      parsed = await importDshFile(source)
      if (parsed.header.version !== generation(sourcePath)) throw new Error('filename generation does not match session header version')
    } catch (error: unknown) {
      throw new Error(`cannot parse ${JSON.stringify(sourcePath)}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (ids.has(parsed.header.id)) throw new Error(`source contains duplicate session id ${JSON.stringify(parsed.header.id)}`)
    ids.add(parsed.header.id)
    sessions.push({
      ...parsed,
      sourcePath,
      ...((parsed.header.origin === 'subagent' || (parsed.header.version < 4 && parsed.header.seedLength === undefined && parsed.header.isSeeded !== true))
        && parsed.header.parentSession !== undefined ? { parentSessionId: parsed.header.parentSession } : {}),
    })
  }
  const media = new Map<string, Uint8Array>()
  const files = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry.path.startsWith('media/') && !entry.path.endsWith('/')) media.set(entry.path.slice('media/'.length), entry.bytes)
    if (entry.path.startsWith('files/') && !entry.path.endsWith('/')) files.set(entry.path, entry.bytes)
  }
  const parents = new Map(sessions.flatMap(session => session.parentSessionId === undefined ? [] : [[session.header.id, session.parentSessionId] as const]))
  for (const session of sessions) for (const event of session.events) {
    const data = recordOf(event.data)
    if (event.type === 'subagent/catalog' && typeof data?.childId === 'string' && ids.has(data.childId)) parents.set(data.childId, session.header.id)
  }
  for (const session of sessions) {
    const visited = new Set<string>([session.header.id])
    let parent = parents.get(session.header.id)
    while (parent !== undefined) {
      if (visited.has(parent)) throw new Error('session parent cycle')
      visited.add(parent)
      parent = parents.get(parent)
    }
  }
  const rootSession = sessions[0]
  if (rootSession === undefined) throw new Error('source has no root session')
  return { rootSessionId: rootSession.header.id, sessions: sessions.map(session => ({ ...session,
    ...(parents.has(session.header.id) ? { parentSessionId: parents.get(session.header.id) } : {}),
  })), media, files }
}

/** Decode one ZIP made by DSH's session-log exporter without writing imported bytes. */
export async function importDshArchive(input: DshArchiveInput): Promise<ImportedDshArchive> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(input.bytes)
  } catch (error: unknown) {
    throw new Error(`cannot read ZIP ${JSON.stringify(input.name)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return importEntries(Object.entries(entries).map(([path, bytes]) => ({ path, name: path.split('/').at(-1) ?? path, bytes })))
}

/** Parse a user-selected DSH directory with optional descendant and media files. */
export async function importDshDirectory(entries: readonly DshDirectoryEntry[]): Promise<ImportedDshArchive> {
  return importEntries(entries)
}
