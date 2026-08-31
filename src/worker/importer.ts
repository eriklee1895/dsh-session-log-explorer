import { strFromU8, unzipSync } from 'fflate'
import { decompress } from 'fzstd'
import { parseSessionJsonl, type ParsedSessionJsonl } from './parser.ts'

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

function sessionPaths(entries: readonly DshDirectoryEntry[]): readonly string[] {
  const paths = entries.map(entry => entry.path).filter(path => path === 'session.jsonl'
    || path === 'session.jsonl.zstd'
    || /^subagents\/[^/]+\/session\.jsonl(?:\.zstd)?$/.test(path))
  const root = paths.includes('session.jsonl')
    ? 'session.jsonl'
    : paths.includes('session.jsonl.zstd') ? 'session.jsonl.zstd' : undefined
  if (root === undefined) throw new Error('ZIP does not contain session.jsonl')
  return [root, ...paths.filter(path => path !== root).sort()]
}

async function importEntries(entries: readonly DshDirectoryEntry[]): Promise<ImportedDshArchive> {
  const byPath = new Map(entries.map(entry => [entry.path, entry] as const))
  const sessions: ImportedSession[] = []
  const ids = new Set<string>()
  for (const sourcePath of sessionPaths(entries)) {
    const source = byPath.get(sourcePath)
    if (source === undefined) throw new Error(`session artifact ${JSON.stringify(sourcePath)} is missing`)
    let parsed: ParsedSessionJsonl
    try {
      parsed = await importDshFile(source)
    } catch (error: unknown) {
      throw new Error(`cannot parse ${JSON.stringify(sourcePath)}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (ids.has(parsed.header.id)) throw new Error(`source contains duplicate session id ${JSON.stringify(parsed.header.id)}`)
    ids.add(parsed.header.id)
    sessions.push({
      ...parsed,
      sourcePath,
      ...(parsed.header.parentSession === undefined ? {} : { parentSessionId: parsed.header.parentSession }),
    })
  }
  const media = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry.path.startsWith('media/') && !entry.path.endsWith('/')) media.set(entry.path.slice('media/'.length), entry.bytes)
  }
  const rootSession = sessions[0]
  if (rootSession === undefined) throw new Error('source has no root session')
  return { rootSessionId: rootSession.header.id, sessions, media }
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
