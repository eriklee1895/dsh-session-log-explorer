import { useMemo, type ComponentProps } from 'react'
import { JsonView } from 'react-json-view-lite'
import './StructuredJson.css'

type JsonComposite = Record<string, unknown> | readonly unknown[]

const devtoolsStyle: NonNullable<ComponentProps<typeof JsonView>['style']> = {
  container: 'devtools-json-viewer',
  basicChildStyle: 'devtools-json-row',
  label: 'devtools-json-key',
  clickableLabel: 'devtools-json-key',
  nullValue: 'devtools-json-null',
  undefinedValue: 'devtools-json-null',
  numberValue: 'devtools-json-number',
  stringValue: 'devtools-json-string',
  booleanValue: 'devtools-json-boolean',
  otherValue: 'devtools-json-other',
  punctuation: 'devtools-json-punctuation',
  expandIcon: 'devtools-json-expand',
  collapseIcon: 'devtools-json-collapse',
  collapsedContent: 'devtools-json-ellipsis',
  childFieldsContainer: 'devtools-json-children',
  noQuotesForStringValues: false,
  quotesForFieldNames: false,
  ariaLables: { collapseJson: 'Collapse JSON', expandJson: 'Expand JSON' },
  stringifyStringValues: true,
}

function parseJson(value: string): { readonly value: unknown } | undefined {
  if (value.trim() === '') return undefined
  try {
    return { value: JSON.parse(value) as unknown }
  } catch {
    return undefined
  }
}

function jsonComposite(value: unknown): value is JsonComposite {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

/** Expand serialised nested JSON objects while preserving ordinary string values. */
function normalizeJson(value: unknown, depth = 0): unknown {
  if (depth >= 64) return value
  if (typeof value === 'string') {
    const parsed = parseJson(value)?.value
    return jsonComposite(parsed) ? normalizeJson(parsed, depth + 1) : value
  }
  if (Array.isArray(value)) return value.map(child => normalizeJson(child, depth + 1))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeJson(child, depth + 1)]))
}

/** Render JSON with Chrome DevTools-style tree rows and syntax colours. */
export function StructuredJson({ value, empty, className }: {
  readonly value: string
  readonly empty: string
  readonly className?: string
}): React.JSX.Element {
  const large = value.length > 131_072
  const normalized = useMemo(() => {
    if (large) return undefined
    const parsed = parseJson(value)
    return parsed === undefined ? undefined : normalizeJson(parsed.value)
  }, [value, large])
  const save = (): void => {
    const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'dsh-event-content.txt'; link.click()
    setTimeout(() => { URL.revokeObjectURL(url) }, 1_000)
  }
  return <div className={`structured-json${className === undefined ? '' : ` ${className}`}`}>
    {large ? <><p className="large-value-note">内容较大，预览前 32,768 个字符；完整内容可保存到本机。</p><button className="save-content" onClick={save}>保存完整内容</button><pre>{value.slice(0, 32_768)}…</pre></>
      : value === '' ? <p className="empty-value">{empty}</p>
      : normalized === undefined ? <pre>{value}</pre>
        : jsonComposite(normalized) ? <JsonView aria-label="JSON preview" data={normalized} shouldExpandNode={level => level < 3} style={devtoolsStyle} />
          : <code className={`devtools-json-${normalized === null ? 'null' : typeof normalized}`}>{JSON.stringify(normalized)}</code>}
  </div>
}
